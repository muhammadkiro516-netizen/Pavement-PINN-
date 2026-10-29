"""SPEC M10 / §5: end-to-end latency of every AI engine on every usable device of this machine.

Records: CPU name, OpenVINO version, available devices with their full names, Intel AMX flag
(Linux lscpu / /proc/cpuinfo), and p50/p95/p99 per engine. Non-Intel hosts are labelled
HOST_NON_INTEL so the numbers are never presented as Intel hardware evidence.

Run from the repo root:  inference/.venv/Scripts/python bench/run_all.py [--runs 30] [--no-slm]
On Linux:                 inference/.venv/bin/python bench/run_all.py
Writes measurements/bench_<host>.json
"""
from __future__ import annotations

import argparse
import json
import platform
import socket
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "inference"))

import openvino as ov  # noqa: E402


def cpu_name() -> str:
    if sys.platform.startswith("linux"):
        for line in Path("/proc/cpuinfo").read_text().splitlines():
            if line.startswith("model name"):
                return line.split(":", 1)[1].strip()
    return platform.processor() or platform.machine()


def amx() -> bool | None:
    if not sys.platform.startswith("linux"):
        return None  # not detectable this way on Windows/macOS
    flags = Path("/proc/cpuinfo").read_text()
    return "amx_tile" in flags


def pct(xs: list[float]) -> dict:
    a = np.array(xs)
    return {"p50": round(float(np.percentile(a, 50)), 2), "p95": round(float(np.percentile(a, 95)), 2), "p99": round(float(np.percentile(a, 99)), 2), "n": len(xs)}


def timed(fn, runs: int, warmup: int = 3) -> dict:
    for _ in range(warmup):
        fn()
    out = []
    for _ in range(runs):
        t = time.perf_counter()
        fn()
        out.append((time.perf_counter() - t) * 1000)
    return pct(out)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--runs", type=int, default=30)
    ap.add_argument("--no-slm", action="store_true")
    args = ap.parse_args()
    core = ov.Core()
    devices = {d: str(core.get_property(d, "FULL_DEVICE_NAME")) for d in core.available_devices}
    cpu = cpu_name()
    intel = "intel" in cpu.lower()
    result: dict = {
        "measuredAt": datetime.now(timezone.utc).isoformat(),
        "host": socket.gethostname(),
        "hostLabel": "HOST" if intel else "HOST_NON_INTEL",
        "cpu": cpu,
        "openvino": ov.__version__,
        "devices": devices,
        "amxTile": amx(),
        "engines": {},
        "notes": [],
    }
    try:
        result["commit"] = subprocess.check_output(["git", "rev-parse", "--short", "HEAD"], cwd=ROOT, text=True).strip()
    except Exception:  # noqa: BLE001
        result["commit"] = None

    photo = (ROOT / "public" / "photos" / "jalan-berlubang.jpg").read_bytes()
    import cv2

    from app.cv import engine, scene

    result["engines"]["cv_live_detect_scene_cpu_ms"] = timed(lambda: engine.analyze_live(photo), args.runs)
    result["engines"]["cv_full_pipeline_cpu_ms"] = timed(lambda: engine.analyze_image(photo), max(5, args.runs // 3))
    bgr = cv2.imdecode(np.frombuffer(photo, np.uint8), cv2.IMREAD_COLOR)
    if scene.classify(bgr) is not None:
        result["engines"]["clip_scene_cpu_ms"] = timed(lambda: scene.classify(bgr), args.runs)

    from app.diagnose import diagnose
    from app.main import _strain_batch

    req = {"segment_id": "BENCH", "road_class": "KABUPATEN", "esal_year": 150000, "prior": {"h1": 50, "h2": 200, "E1": 2500, "E2": 200, "cbr": 4}}
    result["engines"]["pinn2_diagnose_2000_samples_ms"] = timed(lambda: diagnose(req, _strain_batch), max(5, args.runs // 3), warmup=1)

    from app.surrogate import load_surrogate

    s = load_surrogate()
    if s is not None:
        F = np.random.default_rng(0).uniform(s.fmin, s.fmax, (256, len(s.fmin))).astype(np.float32)
        for dev in devices:
            if dev != "CPU" and "intel" not in devices[dev].lower():
                result["notes"].append(f"{dev} ({devices[dev]}) skipped: OpenVINO GPU/NPU plugins target Intel hardware")
                continue
            try:
                compiled = core.compile_model(str(ROOT / "models" / "pi-surrogate-v1_int8.xml"), dev)
                result["engines"][f"pinn_surrogate_int8_batch256_{dev}_ms"] = timed(lambda: compiled(F), args.runs)
            except Exception as exc:  # noqa: BLE001
                result["notes"].append(f"surrogate on {dev}: {str(exc)[:120]}")

    if not args.no_slm:
        from app import slm

        m = slm.load_slm()
        if m is None:
            result["notes"].append("SLM not installed")
        else:
            out = m.generate("Tulis satu kalimat tentang pentingnya merawat jalan.", max_new_tokens=64)
            result["engines"]["slm"] = {"device": m.device, "tokens_per_s": out["tokens_per_s"], "ttft_ms": out["ttft_ms"], "new_tokens": out["new_tokens"], "deviceNotes": m.device_errors}

    out_dir = ROOT / "measurements"
    out_dir.mkdir(exist_ok=True)
    path = out_dir / f"bench_{socket.gethostname().lower()}.json"
    path.write_text(json.dumps(result, indent=2))
    print(json.dumps(result["engines"], indent=1))
    print(f"wrote {path}")


if __name__ == "__main__":
    main()
