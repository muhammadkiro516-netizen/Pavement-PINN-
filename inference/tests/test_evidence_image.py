import base64

import cv2
import numpy as np
import pytest

from app import evidence_image as ei


def _jpeg(image: np.ndarray) -> bytes:
    ok, buf = cv2.imencode(".jpg", image)
    assert ok
    return buf.tobytes()


def _scene(seed: int = 1) -> np.ndarray:
    rng = np.random.default_rng(seed)
    blocks = rng.integers(0, 255, size=(12, 16, 3), dtype=np.uint8)
    return cv2.resize(blocks, (800, 600), interpolation=cv2.INTER_NEAREST)


def test_phash_is_stable_under_recompression_and_differs_for_another_scene():
    a = ei.phash(_scene(1))
    again = ei.phash(cv2.imdecode(np.frombuffer(_jpeg(_scene(1)), np.uint8), cv2.IMREAD_COLOR))
    other = ei.phash(_scene(2))
    distance = lambda x, y: bin(int(x, 16) ^ int(y, 16)).count("1")
    assert len(a) == 16
    assert distance(a, again) <= 8
    assert distance(a, other) > 8


def test_process_strips_metadata_stamps_and_returns_a_jpeg():
    plain = ei.process(_jpeg(_scene()))
    stamped = ei.process(_jpeg(_scene()), watermark="DEMO")
    out = base64.b64decode(stamped["jpeg_base64"])
    assert out[:2] == b"\xff\xd8"
    assert b"Exif" not in out
    assert plain["jpeg_base64"] != stamped["jpeg_base64"]
    assert plain["phash"] == stamped["phash"], "the hash describes the source photo"


def test_process_shrinks_large_photos():
    big = cv2.resize(_scene(), (3200, 2400), interpolation=cv2.INTER_NEAREST)
    assert ei.process(_jpeg(big))["width"] == 1600


def test_unreadable_image_is_refused():
    with pytest.raises(ValueError):
        ei.process(b"not an image")


def test_marker_gives_scale_only_when_present():
    assert ei.find_marker(_jpeg(_scene()))["found"] is False
    marker = cv2.aruco.generateImageMarker(cv2.aruco.getPredefinedDictionary(cv2.aruco.DICT_4X4_50), 7, 200)
    canvas = np.full((600, 800), 255, dtype=np.uint8)
    canvas[200:400, 300:500] = marker
    result = ei.find_marker(_jpeg(cv2.cvtColor(canvas, cv2.COLOR_GRAY2BGR)))
    assert result["found"] is True
    assert result["marker_id"] == 7
    assert result["px_per_mm"] == pytest.approx(1.0, abs=0.02), "200 px marker of 200 mm"


def test_no_blur_is_claimed_when_it_did_not_run(monkeypatch):
    monkeypatch.setattr(ei, "FACE_MODEL", ei.FACE_MODEL.with_name("missing.onnx"))
    result = ei.process(_jpeg(_scene()))
    assert result["faces_blurred"] is None
    assert result["plates_blurred"] is None


def test_face_model_runs_on_a_scene_without_faces():
    assert ei.process(_jpeg(_scene()))["faces_blurred"] == 0
