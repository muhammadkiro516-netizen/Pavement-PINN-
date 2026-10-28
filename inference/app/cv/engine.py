"""Shared road-damage Computer Vision engine (OpenVINO).

One engine serves every input: a photo goes through `analyze_image(bytes)`, a video frame
through `analyze_frame(bgr)` from the video adapter; both end in `_analyze_bgr`, so a frame
and the same frame saved as a photo run the identical preprocessing, models and rules.

Pipeline: input validation -> letterbox preprocessing -> YOLO detection (road-damage
classes) -> YOLO crack segmentation -> mask geometry -> severity rules -> confidence and
quality checks -> structured result.

What this engine does NOT do: physical size or depth. Every measurement is in image pixels;
there is no camera calibration, scale reference or depth model, so physical depth is
`not_estimable` and severity is a provisional image-space estimate.
"""
from __future__ import annotations

import base64
import hashlib
import json
import os
import threading
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

import cv2
import numpy as np

from . import scene as scene_mod

MODELS_DIR = Path(__file__).resolve().parents[3] / "models" / "cv"
REGISTRY_PATH = MODELS_DIR / "cv_registry.json"
ENGINE_VERSION = "cv-engine-1.0.0"

MAX_IMAGE_BYTES = 5 * 1024 * 1024
MIN_SIDE_PX = 160  # below this the photo is rejected as unusable
LOW_RES_SIDE_PX = 480  # below this a warning is attached
BLUR_LAPLACIAN_VAR = 60.0
DARK_MEAN = 45.0
BRIGHT_MEAN = 225.0

Stage = Callable[[str], None]


class CvError(Exception):
    """An error with a stable code, kept separate per pipeline phase."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass
class _Model:
    id: str
    compiled: object
    device: str
    imgsz: int
    names: list[str]
    cfg: dict
    # One OpenVINO compiled model shares one implicit infer request: concurrent callers (jobs
    # thread, sync analysis, live preview) must not run it at the same time.
    lock: threading.Lock = field(default_factory=threading.Lock)

    def infer(self, x: np.ndarray):
        with self.lock:
            return self.compiled(x)


def _read_names(xml: Path) -> list[str]:
    meta = xml.parent / "metadata.yaml"
    names: dict[int, str] = {}
    in_names = False
    for line in meta.read_text(encoding="utf-8").splitlines():
        if line.startswith("names:"):
            in_names = True
            continue
        if in_names:
            if not line.startswith("  "):
                break
            k, v = line.strip().split(":", 1)
            names[int(k)] = v.strip()
    return [names[i] for i in sorted(names)]


class _Runtime:
    _lock = threading.Lock()
    _instance: "_Runtime | None" = None

    def __init__(self):
        import openvino as ov

        if not REGISTRY_PATH.exists():
            raise CvError("MODEL_UNAVAILABLE", f"No CV registry at {REGISTRY_PATH}.")
        self.registry = json.loads(REGISTRY_PATH.read_text(encoding="utf-8"))
        self.core = ov.Core()
        self.openvino_version = ov.__version__
        self.available_devices = list(self.core.available_devices)
        wanted = os.environ.get("CV_DEVICE", "CPU").upper()
        self.detector = self._load(self.registry["detector"], wanted)
        seg_cfg = self.registry.get("segmenter")
        self.segmenter = self._load(seg_cfg, wanted) if seg_cfg and (MODELS_DIR / seg_cfg["xml"]).exists() else None
        self.warmup_ms = self._warmup()

    def _load(self, cfg: dict, wanted: str) -> _Model:
        xml = MODELS_DIR / cfg["xml"]
        if not xml.exists() or not xml.with_suffix(".bin").exists():
            raise CvError("MODEL_UNAVAILABLE", f"Model artefact missing: {xml.name}")
        model = self.core.read_model(str(xml))
        shape = list(model.inputs[0].get_partial_shape().to_shape())
        if shape != [1, 3, cfg["imgsz"], cfg["imgsz"]]:
            raise CvError("MODEL_INCOMPATIBLE", f"{cfg['id']}: input shape {shape} does not match imgsz {cfg['imgsz']}.")
        device = wanted if wanted in self.available_devices or wanted == "AUTO" else "CPU"
        try:
            compiled = self.core.compile_model(model, device)
        except Exception:  # accelerator missing or unsupported op: CPU fallback
            device = "CPU"
            compiled = self.core.compile_model(model, device)
        names = _read_names(xml)
        if cfg["task"] == "detect":
            unmapped = [n for n in names if n not in cfg["labels"]]
            if unmapped:
                raise CvError("MODEL_INCOMPATIBLE", f"{cfg['id']}: labels without taxonomy mapping: {unmapped}")
        return _Model(cfg["id"], compiled, device, cfg["imgsz"], names, cfg)

    def _warmup(self) -> float:
        t = time.perf_counter()
        dummy = np.zeros((1, 3, 640, 640), dtype=np.float32)
        self.detector.infer(dummy)
        if self.segmenter:
            self.segmenter.infer(dummy)
        return round((time.perf_counter() - t) * 1000, 1)

    @classmethod
    def get(cls) -> "_Runtime":
        with cls._lock:
            if cls._instance is None:
                cls._instance = _Runtime()
            return cls._instance


def runtime_info() -> dict:
    try:
        rt = _Runtime.get()
    except CvError as exc:
        return {"status": exc.code, "message": exc.message}
    except Exception as exc:  # openvino import or compile failure
        return {"status": "MODEL_UNAVAILABLE", "message": str(exc)}
    return {
        "status": "READY",
        "engine_version": ENGINE_VERSION,
        "openvino_version": rt.openvino_version,
        "available_devices": rt.available_devices,
        "warmup_ms": rt.warmup_ms,
        "detector": {"id": rt.detector.id, "device": rt.detector.device, "labels": rt.detector.names},
        "segmenter": None if rt.segmenter is None else {"id": rt.segmenter.id, "device": rt.segmenter.device, "labels": rt.segmenter.names},
    }


# ---------------------------------------------------------------- input adapter (image)

def decode_image(data: bytes) -> np.ndarray:
    if not data:
        raise CvError("INVALID_IMAGE", "No image bytes received.")
    if len(data) > MAX_IMAGE_BYTES:
        raise CvError("INVALID_IMAGE", "Image is larger than 5 MB.")
    head = data[:12]
    if not (head[:3] == b"\xff\xd8\xff" or head[:8] == b"\x89PNG\r\n\x1a\n" or (head[:4] == b"RIFF" and head[8:12] == b"WEBP")):
        raise CvError("INVALID_IMAGE", "Image content is not JPEG, PNG or WebP.")
    # IMREAD_COLOR applies EXIF orientation; metadata is not kept beyond decoding.
    img = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        raise CvError("INVALID_IMAGE", "Image could not be decoded.")
    return img


def assess_quality(bgr: np.ndarray) -> dict:
    h, w = bgr.shape[:2]
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    small = cv2.resize(gray, (min(w, 1024), int(h * min(w, 1024) / w))) if w > 1024 else gray
    sharpness = float(cv2.Laplacian(small, cv2.CV_64F).var())
    brightness = float(gray.mean())
    warnings: list[str] = []
    if min(h, w) < LOW_RES_SIDE_PX:
        warnings.append("LOW_RESOLUTION")
    if sharpness < BLUR_LAPLACIAN_VAR:
        warnings.append("BLURRY")
    if brightness < DARK_MEAN:
        warnings.append("TOO_DARK")
    if brightness > BRIGHT_MEAN:
        warnings.append("OVEREXPOSED")
    usable = min(h, w) >= MIN_SIDE_PX
    return {
        "imageUsable": usable,
        "sharpnessLaplacianVar": round(sharpness, 1),
        "meanBrightness": round(brightness, 1),
        "warnings": warnings,
        "overallStatus": "UNUSABLE" if not usable else ("DEGRADED" if warnings else "GOOD"),
    }


# ---------------------------------------------------------------- preprocessing

def letterbox(bgr: np.ndarray, size: int) -> tuple[np.ndarray, float, tuple[int, int]]:
    """Resize keeping aspect ratio and pad to size x size with grey 114 (Ultralytics convention)."""
    h, w = bgr.shape[:2]
    r = min(size / h, size / w)
    nh, nw = round(h * r), round(w * r)
    resized = cv2.resize(bgr, (nw, nh), interpolation=cv2.INTER_LINEAR)
    top, left = (size - nh) // 2, (size - nw) // 2
    canvas = np.full((size, size, 3), 114, dtype=np.uint8)
    canvas[top:top + nh, left:left + nw] = resized
    tensor = canvas[:, :, ::-1].transpose(2, 0, 1)[None].astype(np.float32) / 255.0
    return np.ascontiguousarray(tensor), r, (left, top)


def _decode_boxes(pred: np.ndarray, nc: int, conf: float, iou: float, r: float, pad: tuple[int, int], w: int, h: int,
                  class_agnostic: bool = False):
    """YOLOv8 head (4 + nc [+ mask coeffs], N) -> NMS'd boxes in original pixels."""
    p = pred.T
    scores_all = p[:, 4:4 + nc]
    cls = scores_all.argmax(1)
    scores = scores_all[np.arange(len(p)), cls]
    keep = scores >= conf
    p, cls, scores = p[keep], cls[keep], scores[keep]
    if not len(p):
        return np.zeros((0, 4)), cls, scores, p[:, 4 + nc:]
    xywh = p[:, :4]
    x1 = (xywh[:, 0] - xywh[:, 2] / 2 - pad[0]) / r
    y1 = (xywh[:, 1] - xywh[:, 3] / 2 - pad[1]) / r
    x2 = (xywh[:, 0] + xywh[:, 2] / 2 - pad[0]) / r
    y2 = (xywh[:, 1] + xywh[:, 3] / 2 - pad[1]) / r
    boxes = np.stack([x1.clip(0, w), y1.clip(0, h), x2.clip(0, w), y2.clip(0, h)], 1)
    # class-aware NMS by offsetting boxes per class
    offset = 0 if class_agnostic else cls[:, None] * 10000.0
    shifted = boxes + offset
    idx = cv2.dnn.NMSBoxes([[float(a), float(b), float(c - a), float(d - b)] for a, b, c, d in shifted], scores.astype(float).tolist(), conf, iou)
    idx = np.array(idx, dtype=int).reshape(-1)
    order = idx[np.argsort(-scores[idx])] if len(idx) else idx
    return boxes[order], cls[order], scores[order], p[order, 4 + nc:]


# ---------------------------------------------------------------- geometry

def _skeleton(mask: np.ndarray) -> np.ndarray:
    """Morphological skeleton (Lantuejoul) of a binary mask."""
    img = (mask > 0).astype(np.uint8)
    skel = np.zeros_like(img)
    kernel = cv2.getStructuringElement(cv2.MORPH_CROSS, (3, 3))
    for _ in range(200):
        eroded = cv2.erode(img, kernel)
        opened = cv2.dilate(eroded, kernel)
        skel |= img - opened
        img = eroded
        if not img.any():
            break
    return skel


def mask_metrics(mask: np.ndarray) -> dict | None:
    area = int(mask.sum())
    if area < 20:
        return None
    skel = _skeleton(mask)
    length = int(skel.sum())
    dist = cv2.distanceTransform(mask.astype(np.uint8), cv2.DIST_L2, 3)
    widths = 2 * dist[skel > 0] if length else np.array([0.0])
    ys, xs = np.nonzero(mask)
    pts = np.stack([xs, ys], 1).astype(np.float64)
    cov = np.cov(pts.T) if len(pts) > 2 else np.eye(2)
    evals, evecs = np.linalg.eigh(cov)
    major = evecs[:, 1]
    angle = float(np.degrees(np.arctan2(major[1], major[0]))) % 180
    elong = float(np.sqrt(evals[1] / max(evals[0], 1e-6)))
    n_comp = cv2.connectedComponents(mask.astype(np.uint8))[0] - 1
    return {
        "areaPixels": area,
        "skeletonLengthPixels": length,
        "estimatedWidthPixels": round(float(np.median(widths)), 2),
        "maxWidthPixels": round(float(widths.max()), 2),
        "orientationDeg": round(angle, 1),
        "elongation": round(elong, 2),
        "components": int(n_comp),
    }


# ---------------------------------------------------------------- severity (policy cv-severity-v1)

SEVERITY_RANK = {"unknown": 0, "minor": 1, "moderate": 2, "severe": 3}


def assess_severity(kind: str, bbox_frac: float, metrics: dict | None, img_w: int) -> dict:
    """Image-space rules; thresholds are policy parameters, not calibrated physical limits."""
    ev: list[str] = [f"bbox covers {bbox_frac * 100:.1f}% of the image"]
    if kind == "pothole":
        level = "severe" if bbox_frac >= 0.08 else "moderate" if bbox_frac >= 0.02 else "minor"
        ev.append("rule pothole: >=8% severe, >=2% moderate (relative image area; depth not measured)")
        return {"level": level, "basis": "bbox_area_fraction", "confidence": "low", "evidence": ev}
    if kind == "area":
        frac = bbox_frac
        if metrics:
            frac = max(frac * 0.5, metrics["areaPixels"] / (img_w * img_w))
            ev.append(f"segmented crack area {metrics['areaPixels']} px, {metrics['components']} component(s)")
        level = "severe" if frac >= 0.15 else "moderate" if frac >= 0.04 else "minor"
        ev.append("rule area-cracking: >=15% severe, >=4% moderate")
        return {"level": level, "basis": "mask_or_bbox_area", "confidence": "low", "evidence": ev}
    # linear cracks: normalised width in px per 1000 px of image width
    if metrics and metrics["skeletonLengthPixels"] > 0:
        w_norm = metrics["estimatedWidthPixels"] * 1000.0 / img_w
        ev.append(f"median crack width {metrics['estimatedWidthPixels']} px ({w_norm:.1f} px per 1000 px image width), "
                  f"skeleton length {metrics['skeletonLengthPixels']} px")
        level = "severe" if w_norm >= 12 else "moderate" if w_norm >= 5 else "minor"
        ev.append("rule linear crack: width >=12 severe, >=5 moderate (px/1000 px; not mm)")
        return {"level": level, "basis": "segmentation_width", "confidence": "low", "evidence": ev}
    level = "moderate" if bbox_frac >= 0.15 else "minor"
    ev.append("no crack mask in this box; rule falls back to bbox size (>=15% moderate)")
    return {"level": level, "basis": "bbox_area_fraction", "confidence": "very_low", "evidence": ev}


# ---------------------------------------------------------------- overlay

PALETTE = [(56, 56, 255), (31, 112, 255), (29, 178, 255), (49, 210, 207), (10, 249, 72), (23, 204, 146), (134, 219, 61)]


def render_overlay(bgr: np.ndarray, detections: list[dict], crack_mask: np.ndarray | None) -> bytes:
    out = bgr.copy()
    if crack_mask is not None and crack_mask.any():
        tint = np.zeros_like(out)
        tint[:] = (255, 0, 255)
        m = crack_mask.astype(bool)
        out[m] = cv2.addWeighted(out, 0.45, tint, 0.55, 0)[m]
    t = max(2, round(min(out.shape[:2]) / 300))
    for i, d in enumerate(detections):
        x1, y1, x2, y2 = map(int, d["bbox"])
        color = PALETTE[d["classIndex"] % len(PALETTE)]
        cv2.rectangle(out, (x1, y1), (x2, y2), color, t)
        text = f"#{i + 1} {d['modelLabel']} {d['confidence']:.2f}"
        fs = t / 3
        (tw, th), _ = cv2.getTextSize(text, cv2.FONT_HERSHEY_SIMPLEX, fs, max(1, t // 2))
        cv2.rectangle(out, (x1, max(0, y1 - th - 8)), (x1 + tw + 6, y1), color, -1)
        cv2.putText(out, text, (x1 + 3, y1 - 5), cv2.FONT_HERSHEY_SIMPLEX, fs, (255, 255, 255), max(1, t // 2), cv2.LINE_AA)
    scale = 1280 / max(out.shape[:2])
    if scale < 1:
        out = cv2.resize(out, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
    ok, buf = cv2.imencode(".jpg", out, [cv2.IMWRITE_JPEG_QUALITY, 85])
    return buf.tobytes()


# ---------------------------------------------------------------- core

PAINT_DELTA = 50.0  # mask brighter than the image median by this much = lane paint, not a crack


def _segment(rt: _Runtime, tensor: np.ndarray, r: float, pad: tuple[int, int], w: int, h: int, gray: np.ndarray):
    seg = rt.segmenter
    road_level = float(np.median(gray))
    outs = seg.infer(tensor)
    pred = outs[seg.compiled.outputs[0]][0]
    proto = outs[seg.compiled.outputs[1]][0]  # (32, 160, 160)
    cfg = seg.cfg
    boxes, _, scores, coefs = _decode_boxes(pred, len(seg.names), cfg["conf_accept"], cfg["iou_nms"], r, pad, w, h, True)
    union = np.zeros((h, w), dtype=np.uint8)
    instances = []
    if not len(boxes):
        return union, instances
    c, mh, mw = proto.shape
    masks = 1 / (1 + np.exp(-(coefs @ proto.reshape(c, -1)))).reshape(-1, mh, mw)
    size = seg.imgsz
    nh, nw = round(h * r), round(w * r)
    for box, score, m in zip(boxes, scores, masks):
        m = cv2.resize(m, (size, size), interpolation=cv2.INTER_LINEAR)[pad[1]:pad[1] + nh, pad[0]:pad[0] + nw]
        m = cv2.resize(m, (w, h), interpolation=cv2.INTER_LINEAR) > cfg["mask_threshold"]
        x1, y1, x2, y2 = box.astype(int)
        crop = np.zeros_like(m)
        crop[y1:y2, x1:x2] = m[y1:y2, x1:x2]
        if crop.sum() < 20:
            continue
        inst = {"bbox": [round(float(v), 1) for v in box], "confidence": round(float(score), 4)}
        mean_level = float(gray[crop].mean())
        # Cracks are darker than the surface; painted markings are brighter. A bright mask is
        # reported but not counted as crack evidence.
        if mean_level > road_level + PAINT_DELTA:
            inst.update(filtered="LIKELY_LANE_MARKING", meanGray=round(mean_level, 1), surfaceMedianGray=round(road_level, 1))
            instances.append(inst)
            continue
        union |= crop.astype(np.uint8)
        inst["metrics"] = mask_metrics(crop.astype(np.uint8))
        instances.append(inst)
    return union, instances


def _analyze_bgr(bgr: np.ndarray, source_type: str, source_ref: str, stage: Stage | None = None) -> dict:
    stage = stage or (lambda _s: None)
    timings: dict[str, float] = {}
    t0 = time.perf_counter()
    h, w = bgr.shape[:2]
    quality = assess_quality(bgr)
    analysis_id = f"CVA-{uuid.uuid4().hex[:16].upper()}"
    base = {"analysisId": analysis_id, "sourceType": source_type, "engineVersion": ENGINE_VERSION,
            "image": {"width": w, "height": h, "sourceReference": source_ref}, "quality": quality}
    if not quality["imageUsable"]:
        return {**base, "status": "failed", "failure": {"code": "IMAGE_UNUSABLE", "stage": "validate",
                "message": f"Image is too small ({w}x{h}); at least {MIN_SIDE_PX}px on the short side is needed."},
                "detections": [], "timings": {"totalMs": round((time.perf_counter() - t0) * 1000, 1)}}

    stage("model_loading")
    try:
        rt = _Runtime.get()
    except CvError as exc:
        raise
    except Exception as exc:
        raise CvError("MODEL_UNAVAILABLE", f"CV runtime failed to start: {exc}") from exc

    stage("preprocessing")
    tp = time.perf_counter()
    tensor, r, pad = letterbox(bgr, rt.detector.imgsz)
    timings["preprocessingMs"] = round((time.perf_counter() - tp) * 1000, 1)

    stage("detecting")
    ti = time.perf_counter()
    try:
        out = rt.detector.infer(tensor)[rt.detector.compiled.outputs[0]][0]
    except Exception as exc:
        raise CvError("INFERENCE_FAILED", f"Detector inference failed: {exc}") from exc
    timings["detectionMs"] = round((time.perf_counter() - ti) * 1000, 1)
    dcfg = rt.detector.cfg
    boxes, cls, scores, _ = _decode_boxes(out, len(rt.detector.names), dcfg["conf_candidate"], dcfg["iou_nms"], r, pad, w, h)

    crack_mask, seg_instances, seg_ran = None, [], False
    if rt.segmenter is not None:
        stage("segmenting")
        ts = time.perf_counter()
        try:
            crack_mask, seg_instances = _segment(rt, tensor, r, pad, w, h, cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY))
            seg_ran = True
        except Exception as exc:
            raise CvError("INFERENCE_FAILED", f"Segmentation inference failed: {exc}") from exc
        timings["segmentationMs"] = round((time.perf_counter() - ts) * 1000, 1)
    timings["inferenceMs"] = round(timings["detectionMs"] + timings.get("segmentationMs", 0.0), 1)

    stage("evaluating")
    tq = time.perf_counter()
    detections, candidates = [], []
    for box, c, s in zip(boxes, cls, scores):
        name = rt.detector.names[int(c)]
        lab = dcfg["labels"][name]
        x1, y1, x2, y2 = box
        frac = float((x2 - x1) * (y2 - y1) / (w * h))
        metrics = None
        if crack_mask is not None and lab["kind"] in ("linear", "area"):
            sub = np.zeros_like(crack_mask)
            ix1, iy1, ix2, iy2 = map(int, box)
            sub[iy1:iy2, ix1:ix2] = crack_mask[iy1:iy2, ix1:ix2]
            metrics = mask_metrics(sub)
        d = {
            "classIndex": int(c), "modelLabel": name, "taxonomyCode": lab["taxonomy"], "damageType": lab["damageType"],
            "label": lab["label"], "confidence": round(float(s), 4), "bbox": [round(float(v), 1) for v in box],
            "bboxAreaFraction": round(frac, 5), "segmentationMetrics": metrics,
            "severity": assess_severity(lab["kind"], frac, metrics, w),
        }
        (detections if s >= dcfg["conf_accept"] else candidates).append(d)
    timings["postprocessingMs"] = round((time.perf_counter() - tq) * 1000, 1)

    stage("validating")
    reasons: list[str] = []
    if detections:
        top = detections[0]
        status = "completed"
        if top["confidence"] < 0.4:
            status = "review_required"
            reasons.append(f"Top detection confidence {top['confidence']:.2f} is below 0.40.")
        if quality["warnings"]:
            status = "review_required"
            reasons.append("Image quality warnings: " + ", ".join(quality["warnings"]) + ".")
        types = {d["taxonomyCode"] for d in detections}
        if len(types) > 1:
            reasons.append(f"Multiple damage types detected ({len(types)}); primary is the highest-confidence detection.")
    elif candidates:
        status = "review_required"
        reasons.append(f"Only low-confidence candidates (max {candidates[0]['confidence']:.2f}) below the 0.25 acceptance threshold.")
    else:
        status = "inconclusive"
        reasons.append("No road damage detected. The model cannot confirm the photo shows a road, so this is not a 'road in good condition' verdict.")
        kept = [i for i in seg_instances if not i.get("filtered")]
        if kept:
            reasons.append(f"The crack segmenter found {len(kept)} crack region(s) the detector did not confirm.")
            status = "review_required"
    if not seg_ran:
        reasons.append("Crack segmentation model unavailable; crack metrics come from boxes only.")

    # Scene understanding (optional CLIP model): not-road, surface condition, standing water.
    stage("scene")
    tsc = time.perf_counter()
    try:
        scene_res = scene_mod.classify(bgr)
    except Exception as exc:  # the scene model must never break the evidence pipeline
        scene_res = None
        reasons.append(f"Scene model failed: {exc}")
    if scene_res is not None:
        timings["sceneMs"] = round((time.perf_counter() - tsc) * 1000, 1)
    index = scene_mod.surface_damage_index(boxes if len(boxes) else np.zeros((0, 4)), crack_mask, w, h)
    hazards: list[str] = []
    total = scene_mod.total_failure(index, scene_res)
    if scene_res is not None:
        if not scene_res["isRoad"]:
            status = "review_required"
            reasons.append("The scene model thinks this photo may not show a road; an officer checks it.")
        if scene_res["water"]["flooded"]:
            hazards.append("GENANGAN")
            reasons.append(f"Standing water / flooding likely (scene model {scene_res['water']['p']:.2f}).")
            if status == "inconclusive":
                status = "review_required"
        if total:
            hazards.append("RUSAK_TOTAL")
            reasons.append(f"Surface largely destroyed: visual index {index:.0f}/100 and scene model agree; an officer confirms.")
            status = "review_required" if status != "completed" else status

    primary = detections[0] if detections else None
    overall = "unknown"
    for d in detections:
        if SEVERITY_RANK[d["severity"]["level"]] > SEVERITY_RANK[overall]:
            overall = d["severity"]["level"]
    overlay = render_overlay(bgr, detections + candidates, crack_mask)
    mask_png = None
    if crack_mask is not None and crack_mask.any():
        ok, buf = cv2.imencode(".png", crack_mask * 255)
        mask_png = base64.b64encode(buf.tobytes()).decode()
    timings["totalMs"] = round((time.perf_counter() - t0) * 1000, 1)

    return {
        **base,
        "status": status,
        "statusReasons": reasons,
        "model": {
            "detector": {"modelId": rt.detector.id, "runtime": f"openvino-{rt.openvino_version}", "device": rt.detector.device,
                         "labels": rt.detector.names, "confAccept": dcfg["conf_accept"], "confCandidate": dcfg["conf_candidate"]},
            "segmenter": None if rt.segmenter is None else {"modelId": rt.segmenter.id, "runtime": f"openvino-{rt.openvino_version}",
                                                            "device": rt.segmenter.device, "ran": seg_ran},
            "labelsVersion": rt.registry["labels_version"],
            "severityPolicy": rt.registry["severity_policy"],
        },
        "detections": detections,
        "lowConfidenceCandidates": candidates,
        "segmentation": None if not seg_ran else {
            "instances": seg_instances,
            "totalCrackPixels": int(crack_mask.sum()) if crack_mask is not None else 0,
            "maskPngBase64": mask_png,
        },
        "primary": None if primary is None else {"taxonomyCode": primary["taxonomyCode"], "damageType": primary["damageType"],
                                                 "label": primary["label"], "confidence": primary["confidence"]},
        "overallSeverity": overall,
        "scene": scene_res,
        "surfaceIndex": index,
        "hazards": hazards,
        "measurements": {"coordinateSpace": "image_pixels", "metricCalibrationStatus": "unavailable",
                         "physicalDepthStatus": "not_estimable", "relativeDepthStatus": "not_available",
                         "note": "No calibration, scale reference or depth model: physical size and depth are not estimated."},
        "overlayJpegBase64": base64.b64encode(overlay).decode(),
        "timings": timings,
    }


_live_lock = threading.Lock()


def analyze_live(data: bytes) -> dict:
    """Fast path for the camera preview: detector + scene only (no segmentation, no overlay).
    Never queues: when another live frame is being processed it raises BUSY, so the preview
    always shows the newest frame. Results are hints; the captured photo still goes through the
    full pipeline as evidence."""
    if not _live_lock.acquire(blocking=False):
        raise CvError("BUSY", "Previous frame still processing.")
    try:
        t0 = time.perf_counter()
        bgr = decode_image(data)
        h, w = bgr.shape[:2]
        rt = _Runtime.get()
        tensor, r, pad = letterbox(bgr, rt.detector.imgsz)
        out = rt.detector.infer(tensor)[rt.detector.compiled.outputs[0]][0]
        dcfg = rt.detector.cfg
        boxes, cls, scores, _ = _decode_boxes(out, len(rt.detector.names), dcfg["conf_candidate"], dcfg["iou_nms"], r, pad, w, h)
        found = []
        for box, c, sc in zip(boxes, cls, scores):
            lab = dcfg["labels"][rt.detector.names[int(c)]]
            found.append({"bbox": [round(float(v), 1) for v in box], "taxonomyCode": lab["taxonomy"], "label": lab["label"],
                          "confidence": round(float(sc), 4), "accepted": bool(sc >= dcfg["conf_accept"])})
        tq = time.perf_counter()
        scene_res = scene_mod.classify(bgr)
        scene_ms = round((time.perf_counter() - tq) * 1000, 1)
        gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
        warnings = []
        if cv2.Laplacian(gray, cv2.CV_64F).var() < BLUR_LAPLACIAN_VAR:
            warnings.append("BLURRY")
        if gray.mean() < DARK_MEAN:
            warnings.append("TOO_DARK")
        index = scene_mod.surface_damage_index(boxes if len(boxes) else np.zeros((0, 4)), None, w, h)
        return {"frame": {"w": w, "h": h}, "boxes": found, "scene": scene_res, "surfaceIndex": index,
                "quality": {"warnings": warnings}, "ms": {"total": round((time.perf_counter() - t0) * 1000, 1), "scene": scene_ms}}
    finally:
        _live_lock.release()


def analyze_image(data: bytes, stage: Stage | None = None) -> dict:
    """Image adapter: validate and decode bytes, then run the shared engine."""
    (stage or (lambda _s: None))("validating_input")
    bgr = decode_image(data)
    sha = hashlib.sha256(data).hexdigest()
    result = _analyze_bgr(bgr, "image", f"sha256:{sha}", stage)
    result["image"]["sha256"] = sha
    result["image"]["bytes"] = len(data)
    return result


def analyze_frame(bgr: np.ndarray, ref: str, stage: Stage | None = None) -> dict:
    """Video-frame adapter entry: the frame is already decoded BGR."""
    return _analyze_bgr(bgr, "video_frame", ref, stage)
