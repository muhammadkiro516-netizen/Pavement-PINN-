"""Intel evidence in one command (docs/LEAN_PLAN.md "Intel evidence").

    inference/.venv/Scripts/python -I inference/scripts/benchmark.py

1. Quantises the road-damage detector to INT8 with NNCF post-training quantisation, calibrated
   on the road photos in public/ (no labels needed for calibration).
2. Measures how often INT8 finds the same objects as FP32 on those photos (agreement, not
   accuracy: there are no labels here).
3. Benchmarks every model (detector FP32/INT8, crack segmenter, PINN surrogate FP32/FP16/INT8)
   on every OpenVINO device present (CPU, GPU = Intel iGPU, NPU on Core Ultra).
4. Writes measurements/benchmark-<host>.json and src/data/measurements/summary.json, which the
   Evidence page (/bukti/) shows. Nothing is typed by hand.
"""
from __future__ import annotations

import datetime as dt
import json
import platform
import socket
import statistics
import time
from pathlib import Path

import cv2
import numpy as np
import openvino as ov

ROOT = Path(__file__).resolve().parents[2]
MODELS = ROOT / "models"
DET = MODELS / "cv" / "rdd-yolov8n-v1" / "rdd_yolov8.xml"
DET_INT8 = MODELS / "cv" / "rdd-yolov8n-v1" / "rdd_yolov8_int8.xml"
SEG = MODELS / "cv" / "crackseg-yolov8s-v1" / "crackseg_yolov8s.xml"
SURROGATE = {p: MODELS / f"pi-surrogate-v1_{p.lower()}.xml" for p in ("FP32", "FP16", "INT8")}
PHOTOS = sorted((ROOT / "public" / "dataset-reference").rglob("*.jpg")) + sorted((ROOT / "public" / "test-fixtures").glob("*.jpg"))
WARMUP, RUNS = 5, 40


def letterbox(path: Path, size: int = 640) -> np.ndarray:
    bgr = cv2.imread(str(path), cv2.IMREAD_COLOR)
    h, w = bgr.shape[:2]
    r = min(size / h, size / w)
    nh, nw = round(h * r), round(w * r)
    canvas = np.full((size, size, 3), 114, np.uint8)
    top, left = (size - nh) // 2, (size - nw) // 2
    canvas[top:top + nh, left:left + nw] = cv2.resize(bgr, (nw, nh), interpolation=cv2.INTER_LINEAR)
    return (canvas[:, :, ::-1].transpose(2, 0, 1)[None].astype(np.float32) / 255.0).copy()


def quantise_detector(core: ov.Core) -> None:
    import nncf

    model = core.read_model(DET)
    data = [letterbox(p) for p in PHOTOS]
    quantised = nncf.quantize(model, nncf.Dataset(data), subset_size=len(data), preset=nncf.QuantizationPreset.MIXED)
    ov.save_model(quantised, DET_INT8)


def boxes(output: np.ndarray, conf: float = 0.25) -> list[tuple[int, np.ndarray]]:
    """[1, 4+nc, N] YOLOv8 head -> (class, xyxy) above conf, greedy NMS per class."""
    pred = output[0].T
    scores = pred[:, 4:]
    cls = scores.argmax(1)
    best = scores.max(1)
    keep = best >= conf
    xywh, cls, best = pred[keep, :4], cls[keep], best[keep]
    xyxy = np.c_[xywh[:, :2] - xywh[:, 2:] / 2, xywh[:, :2] + xywh[:, 2:] / 2]
    idx = cv2.dnn.NMSBoxes(xyxy.tolist(), best.tolist(), conf, 0.5)
    return [(int(cls[i]), xyxy[i]) for i in np.array(idx).flatten()]


def iou(a: np.ndarray, b: np.ndarray) -> float:
    x1, y1 = max(a[0], b[0]), max(a[1], b[1])
    x2, y2 = min(a[2], b[2]), min(a[3], b[3])
    inter = max(0.0, x2 - x1) * max(0.0, y2 - y1)
    union = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter
    return inter / union if union > 0 else 0.0


def agreement(core: ov.Core) -> dict:
    fp32 = core.compile_model(DET, "CPU")
    int8 = core.compile_model(DET_INT8, "CPU")
    matched = total = 0
    for p in PHOTOS:
        x = letterbox(p)
        ref = boxes(fp32(x)[0])
        got = boxes(int8(x)[0])
        total += len(ref)
        for c, b in ref:
            if any(c2 == c and iou(b, b2) >= 0.5 for c2, b2 in got):
                matched += 1
    return {"photos": len(PHOTOS), "fp32Objects": total, "int8Matched": matched, "agreement": matched / total if total else None}


def bench(core: ov.Core, xml: Path, device: str, sample: np.ndarray) -> dict | None:
    try:
        compiled = core.compile_model(xml, device, {"PERFORMANCE_HINT": "LATENCY"})
    except Exception as exc:  # device cannot run this model
        print(f"  skip {xml.name} on {device}: {exc}")
        return None
    req = compiled.create_infer_request()
    for _ in range(WARMUP):
        req.infer({0: sample})
    times = []
    for _ in range(RUNS):
        t = time.perf_counter()
        req.infer({0: sample})
        times.append((time.perf_counter() - t) * 1000)
    times.sort()
    p50 = statistics.median(times)
    return {"p50Ms": p50, "p90Ms": times[int(0.9 * (len(times) - 1))], "fps": 1000 / p50 if p50 else 0.0}


def main() -> None:
    core = ov.Core()
    devices = core.available_devices
    cpu = core.get_property("CPU", "FULL_DEVICE_NAME")
    print(f"OpenVINO {ov.__version__} · {cpu} · devices {devices}")

    if not DET_INT8.exists():
        print("NNCF: quantising the detector to INT8 ...")
        quantise_detector(core)
    agree = agreement(core)
    print(f"INT8 vs FP32 agreement: {agree}")

    image = letterbox(PHOTOS[0])
    surrogate_in = core.read_model(SURROGATE["FP32"]).inputs[0]
    features = np.zeros([d if d > 0 else 256 for d in surrogate_in.get_partial_shape().get_min_shape()], np.float32)
    jobs = [
        ("Deteksi kerusakan (YOLOv8n)", "FP32", DET, image),
        ("Deteksi kerusakan (YOLOv8n)", "INT8 (NNCF)", DET_INT8, image),
        ("Segmentasi retak (YOLOv8s-seg)", "FP32", SEG, image),
        *[(f"PINN surrogate (batch {features.shape[0]})", f"{p}{' (NNCF)' if p == 'INT8' else ''}", xml, features) for p, xml in SURROGATE.items()],
    ]
    latency = []
    for device in devices:
        for name, precision, xml, sample in jobs:
            r = bench(core, xml, device, sample)
            if r:
                row = {"model": name, "precision": precision, "device": device, **{k: round(v, 3) for k, v in r.items()}}
                print(f"  {row}")
                latency.append(row)

    now = dt.datetime.now(dt.timezone.utc).isoformat()
    machine = {"cpu": cpu, "devices": devices, "openvino": ov.__version__, "host": socket.gethostname(), "os": platform.platform()}
    record = {"generatedAt": now, "machine": machine, "latency": latency, "int8Agreement": agree, "runs": RUNS, "warmup": WARMUP}
    out = ROOT / "measurements"
    out.mkdir(exist_ok=True)
    (out / f"benchmark-{socket.gethostname()}.json").write_text(json.dumps(record, indent=2))

    summary_path = ROOT / "src" / "data" / "measurements" / "summary.json"
    summary = json.loads(summary_path.read_text())
    summary.update({"generatedAt": now, "machine": {k: machine[k] for k in ("cpu", "devices", "openvino")}, "latency": latency, "int8Agreement": agree})
    summary_path.write_text(json.dumps(summary, indent=2))
    print(f"Wrote {out.name}/benchmark-{socket.gethostname()}.json and src/data/measurements/summary.json")


if __name__ == "__main__":
    main()
