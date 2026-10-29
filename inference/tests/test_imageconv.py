import cv2
import numpy as np
import pytest

from app import imageconv


def _encode(ext: str) -> bytes:
    img = np.full((400, 600, 3), 128, np.uint8)
    ok, buf = cv2.imencode(ext, img)
    assert ok
    return buf.tobytes()


@pytest.mark.parametrize("ext", [".png", ".bmp", ".tiff", ".webp"])
def test_any_readable_format_becomes_jpeg(ext):
    out = imageconv.to_jpeg(_encode(ext), max_side=300)
    assert out[:2] == b"\xff\xd8"
    img = cv2.imdecode(np.frombuffer(out, np.uint8), cv2.IMREAD_COLOR)
    assert max(img.shape[:2]) == 300


def test_heic_is_supported_when_decoder_present():
    if imageconv.pillow_heif is None:
        pytest.skip("pillow-heif not installed")
    from PIL import Image
    import io

    buf = io.BytesIO()
    Image.new("RGB", (320, 240), (90, 90, 90)).save(buf, format="HEIF")
    assert imageconv.to_jpeg(buf.getvalue())[:2] == b"\xff\xd8"


def test_garbage_is_rejected():
    with pytest.raises(imageconv.ConvertError):
        imageconv.to_jpeg(b"not an image at all")
