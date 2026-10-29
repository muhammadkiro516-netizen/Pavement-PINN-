"""Normalise any photo the phone gallery hands us (HEIC/HEIF, AVIF, TIFF, BMP, GIF, ...) to JPEG.

Used only when the browser itself cannot decode the file. The output carries no EXIF (location
and device data are dropped), is rotated upright, and its long side is at most `max_side` px.
"""
from __future__ import annotations

import io

import cv2
import numpy as np

try:  # HEIC/HEIF/AVIF support; optional so the service still starts without it
    import pillow_heif

    pillow_heif.register_heif_opener()
except Exception:  # pragma: no cover
    pillow_heif = None

MAX_INPUT_BYTES = 25 * 1024 * 1024


class ConvertError(ValueError):
    pass


def _via_pillow(data: bytes, max_side: int) -> bytes | None:
    try:
        from PIL import Image, ImageOps
    except ImportError:  # pragma: no cover
        return None
    try:
        with Image.open(io.BytesIO(data)) as im:
            im.seek(0)
            im = ImageOps.exif_transpose(im).convert("RGB")
            im.thumbnail((max_side, max_side))
            out = io.BytesIO()
            im.save(out, "JPEG", quality=85)
            return out.getvalue()
    except Exception:
        return None


def _via_opencv(data: bytes, max_side: int) -> bytes | None:
    img = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        return None
    k = min(1.0, max_side / max(img.shape[:2]))
    if k < 1.0:
        img = cv2.resize(img, (round(img.shape[1] * k), round(img.shape[0] * k)), interpolation=cv2.INTER_AREA)
    ok, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 85])
    return buf.tobytes() if ok else None


def to_jpeg(data: bytes, max_side: int = 1920) -> bytes:
    if not data:
        raise ConvertError("Empty file.")
    if len(data) > MAX_INPUT_BYTES:
        raise ConvertError("File larger than 25 MB.")
    out = _via_pillow(data, max_side) or _via_opencv(data, max_side)
    if out is None:
        raise ConvertError("Not a readable image.")
    return out
