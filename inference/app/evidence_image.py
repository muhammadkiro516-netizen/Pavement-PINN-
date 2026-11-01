"""Evidence image checks for v5 capture (05_CAPTURE_AND_MEASUREMENT.md §3, §8).

Re-encoding drops EXIF. Faces are blurred with YuNet (opencv_zoo, MIT), not evaluated on Indonesian
street scenes, so the count is a count and not a privacy guarantee. No plate detector is available
yet, so `plates_blurred` stays None and the caller must not claim plate blur. The perceptual hash
finds reused photos.
"""
from __future__ import annotations

import base64
from pathlib import Path

import cv2
import numpy as np

MARKER_SIZE_MM = 200.0
FACE_MODEL = Path(__file__).resolve().parents[2] / "models" / "privacy" / "face_detection_yunet_2023mar.onnx"
_aruco = cv2.aruco.ArucoDetector(cv2.aruco.getPredefinedDictionary(cv2.aruco.DICT_4X4_50), cv2.aruco.DetectorParameters())


def _decode(data: bytes) -> np.ndarray:
    image = cv2.imdecode(np.frombuffer(data, dtype=np.uint8), cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError("Not a readable image.")
    return image


def phash(image: np.ndarray) -> str:
    """64-bit DCT perceptual hash as 16 hex digits."""
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    small = cv2.resize(gray, (32, 32), interpolation=cv2.INTER_AREA).astype(np.float32)
    low = cv2.dct(small)[:8, :8].flatten()
    median = np.median(low[1:])
    value = 0
    for bit in low > median:
        value = (value << 1) | int(bit)
    return f"{value:016x}"


def _find_faces(image: np.ndarray) -> list[tuple[int, int, int, int]] | None:
    """Face boxes, or None when the model file is missing so nobody reports a blur that did not run."""
    if not FACE_MODEL.exists():
        return None
    h, w = image.shape[:2]
    detector = cv2.FaceDetectorYN.create(str(FACE_MODEL), "", (w, h), 0.7)
    _, found = detector.detect(image)
    if found is None:
        return []
    return [(max(0, int(f[0])), max(0, int(f[1])), int(f[2]), int(f[3])) for f in found]


def _blur(image: np.ndarray, rects) -> None:
    for x, y, w, h in rects:
        roi = image[y : y + h, x : x + w]
        if roi.size == 0:
            continue
        k = max(15, (max(w, h) // 3) | 1)
        image[y : y + h, x : x + w] = cv2.GaussianBlur(roi, (k, k), 0)


def _stamp(image: np.ndarray, text: str) -> None:
    h, w = image.shape[:2]
    scale = max(0.6, w / 900)
    thick = max(1, int(scale * 2))
    (tw, th), base = cv2.getTextSize(text, cv2.FONT_HERSHEY_SIMPLEX, scale, thick)
    pad = int(8 * scale)
    cv2.rectangle(image, (w - tw - 2 * pad, 0), (w, th + base + 2 * pad), (44, 199, 255), -1)
    cv2.putText(image, text, (w - tw - pad, th + pad), cv2.FONT_HERSHEY_SIMPLEX, scale, (21, 16, 13), thick, cv2.LINE_AA)


def process(data: bytes, watermark: str | None = None, max_edge: int = 1600) -> dict:
    image = _decode(data)
    source_hash = phash(image)
    h, w = image.shape[:2]
    if max(h, w) > max_edge:
        ratio = max_edge / max(h, w)
        image = cv2.resize(image, (int(w * ratio), int(h * ratio)), interpolation=cv2.INTER_AREA)
    faces = _find_faces(image)
    _blur(image, faces or [])
    if watermark:
        _stamp(image, watermark[:40])
    ok, encoded = cv2.imencode(".jpg", image, [cv2.IMWRITE_JPEG_QUALITY, 82])
    if not ok:
        raise ValueError("Could not encode the image.")
    return {
        "phash": source_hash,
        "faces_blurred": None if faces is None else len(faces),
        "plates_blurred": None,
        "width": int(image.shape[1]),
        "height": int(image.shape[0]),
        "jpeg_base64": base64.b64encode(encoded.tobytes()).decode("ascii"),
    }


def find_marker(data: bytes) -> dict:
    """ArUco 4x4 marker of known size gives the metric scale of a nadir photo."""
    image = _decode(data)
    corners, ids, _ = _aruco.detectMarkers(cv2.cvtColor(image, cv2.COLOR_BGR2GRAY))
    if ids is None or len(ids) == 0:
        return {"found": False, "marker_id": None, "px_per_mm": None, "tilt_ratio": None, "marker_size_mm": MARKER_SIZE_MM}
    quad = corners[0].reshape(4, 2)
    sides = [float(np.linalg.norm(quad[i] - quad[(i + 1) % 4])) for i in range(4)]
    mean_side = sum(sides) / 4
    return {
        "found": True,
        "marker_id": int(np.asarray(ids).flatten()[0]),
        "px_per_mm": round(mean_side / MARKER_SIZE_MM, 4),
        # 1.0 is a square view; a larger value means the photo was taken at an angle.
        "tilt_ratio": round(max(sides) / max(min(sides), 1e-6), 3),
        "marker_size_mm": MARKER_SIZE_MM,
    }
