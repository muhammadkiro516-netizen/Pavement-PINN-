"""Scene understanding for road photos: is it a road, what does the surface look like, is there
standing water. Zero-shot CLIP ViT-B/32 on OpenVINO (models/cv/clip/, fetched by
inference/scripts/fetch_clip.py; prompt embeddings by build_clip_scenes.py).

The object detector (YOLO, 7 RDD classes) finds individual defects; it has no notion of a
flooded road, a road that has lost its asphalt, or a photo that is not a road at all. CLIP
fills those gaps. It is zero-shot and not calibrated on Indonesian roads, so every output is
labelled `calibrated: false` and only routes the report (human review), never decides.

Three independent heads (softmax within a head, never across):
  road     : road / not_road
  surface  : good / cracked / potholed / broken (asphalt destroyed) / unpaved
  water    : flooded / dry
"""
from __future__ import annotations

import json
import os
import threading
from pathlib import Path

import cv2
import numpy as np

CLIP_DIR = Path(os.environ.get("MODELS_DIR", Path(__file__).resolve().parents[3] / "models")) / "cv" / "clip"
MEAN = np.array([0.48145466, 0.4578275, 0.40821073], np.float32)
STD = np.array([0.26862954, 0.26130258, 0.27577711], np.float32)
LOGIT_SCALE = 100.0

SURFACE_LABELS = {
    "good": "Permukaan baik",
    "cracked": "Retak",
    "potholed": "Berlubang",
    "broken": "Aspal hancur",
    "unpaved": "Tidak beraspal",
}


class SceneModel:
    _lock = threading.Lock()
    _instance: "SceneModel | None" = None
    _failed: str | None = None

    def __init__(self):
        import openvino as ov

        xml = CLIP_DIR / "clip_vision_int8.xml"
        emb = CLIP_DIR.parent / "clip-scenes.npz"
        if not xml.exists() or not emb.exists():
            raise FileNotFoundError("CLIP scene model not installed (run inference/scripts/fetch_clip.py and build_clip_scenes.py)")
        core = ov.Core()
        self.compiled = core.compile_model(str(xml), "CPU")
        outs = [o.get_any_name() for o in self.compiled.outputs]
        self.output = next((o for o in self.compiled.outputs if "image_embeds" in o.get_any_name()), self.compiled.outputs[0])
        self.output_names = outs
        data = np.load(emb, allow_pickle=False)
        self.heads = {k[:-4]: data[k] for k in data.files if k.endswith("_emb")}
        self.labels = {k[:-4]: [str(x) for x in data[k]] for k in data.files if k.endswith("_lab")}
        self.meta = json.loads((CLIP_DIR / "SOURCE.json").read_text()) if (CLIP_DIR / "SOURCE.json").exists() else {}
        self.infer_lock = threading.Lock()

    @classmethod
    def get(cls) -> "SceneModel | None":
        with cls._lock:
            if cls._instance is None and cls._failed is None:
                try:
                    cls._instance = SceneModel()
                except Exception as exc:  # optional model: the pipeline runs without it
                    cls._failed = str(exc)
            return cls._instance

    def embed(self, bgr: np.ndarray) -> np.ndarray:
        x = preprocess(bgr)
        with self.infer_lock:
            out = self.compiled(x)[self.output]
        v = np.asarray(out, np.float32).reshape(-1)
        if v.shape[0] != 512:
            raise ValueError(f"unexpected CLIP embedding size {v.shape}")
        return v / (np.linalg.norm(v) + 1e-8)


def preprocess(bgr: np.ndarray) -> np.ndarray:
    """CLIP preprocessing: RGB, shortest side 224 (bicubic), centre crop, normalise, NCHW."""
    rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
    h, w = rgb.shape[:2]
    s = 224 / min(h, w)
    rgb = cv2.resize(rgb, (max(224, round(w * s)), max(224, round(h * s))), interpolation=cv2.INTER_CUBIC)
    h, w = rgb.shape[:2]
    top, left = (h - 224) // 2, (w - 224) // 2
    crop = rgb[top:top + 224, left:left + 224].astype(np.float32) / 255.0
    crop = (crop - MEAN) / STD
    return np.ascontiguousarray(crop.transpose(2, 0, 1)[None])


def softmax(z: np.ndarray) -> np.ndarray:
    z = z - z.max()
    e = np.exp(z)
    return e / e.sum()


def head_probs(image_emb: np.ndarray, text_emb: np.ndarray) -> np.ndarray:
    """Zero-shot probabilities of one head: softmax(100 * cosine)."""
    return softmax(LOGIT_SCALE * text_emb @ image_emb)


# Distress head -> app DamageType. Zero-shot and uncalibrated (accuracy BELUM_DIUKUR): a suggestion
# the reporter sees and an officer confirms, used when the box detector has nothing to say.
DISTRESS_TYPES = {
    "pothole": ("POTHOLE", "Lubang (pothole)"),
    "alligator": ("ALLIGATOR_CRACK", "Retak buaya (alligator)"),
    "crack": ("CRACK", "Retak permukaan"),
    "rutting": ("RUTTING", "Alur roda (rutting)"),
    "corrugation": ("CORRUGATION", "Keriting / bergelombang (corrugation)"),
    "subsidence": ("SUBSIDENCE", "Amblas (subsidence)"),
    "depression": ("DEPRESSION", "Ambles lokal (depression)"),
    "raveling": ("SURFACE_DAMAGE", "Pelepasan butir (raveling)"),
    "deformation": ("ROAD_DEFORMATION", "Deformasi / sungkur (shoving)"),
    "patching": ("PATCHING", "Tambalan (patching)"),
    "flooding": ("FLOODING", "Genangan / banjir"),
}
DISTRESS_MIN_P = 0.30


def classify(bgr: np.ndarray) -> dict | None:
    """Scene result, or None when the optional model is not installed."""
    m = SceneModel.get()
    if m is None:
        return None
    emb = m.embed(bgr)
    out: dict = {"modelId": "clip-vit-b32-zeroshot", "calibrated": False}
    for head in ("road", "surface", "distress", "water"):
        if head not in m.heads:
            continue
        p = head_probs(emb, m.heads[head])
        out[head] = {lab: round(float(v), 4) for lab, v in zip(m.labels[head], p)}
    return interpret(out)


def interpret(scene: dict) -> dict:
    """Adds the decisions the app shows; thresholds are conservative because CLIP is uncalibrated."""
    road = scene.get("road", {})
    surface = scene.get("surface", {})
    water = scene.get("water", {})
    scene["isRoad"] = road.get("road", 1.0) >= 0.5
    if surface:
        top = max(surface, key=surface.get)
        scene["surfaceTop"] = {"key": top, "label": SURFACE_LABELS.get(top, top), "p": surface[top]}
    distress = scene.get("distress", {})
    if distress:
        top = max(distress, key=distress.get)
        if top in DISTRESS_TYPES and distress[top] >= DISTRESS_MIN_P:
            dt, label = DISTRESS_TYPES[top]
            scene["distressTop"] = {"key": top, "damageType": dt, "label": label, "p": distress[top]}
    scene["water"] = {"flooded": water.get("flooded", 0.0) >= 0.6, "p": water.get("flooded", 0.0)} if water else {"flooded": False, "p": 0.0}
    return scene


def surface_damage_index(boxes: np.ndarray, crack_mask: np.ndarray | None, w: int, h: int) -> float:
    """Relative visual damage index 0-100: share of the road area (bottom 60 % of the frame, where
    the carriageway is in a handheld photo) covered by detected defects or the dilated crack map.
    Image-space and uncalibrated: a visual cue for triage, not a lane-area measurement."""
    top = int(h * 0.4)
    region = np.zeros((h - top, w), np.uint8)
    for x1, y1, x2, y2 in boxes:
        a, b = int(max(0, x1)), int(max(top, y1)) - top
        c, d = int(min(w, x2)), int(min(h, y2)) - top
        if c > a and d > b:
            region[b:d, a:c] = 1
    if crack_mask is not None and crack_mask.shape[:2] == (h, w):
        dil = cv2.dilate((crack_mask[top:] > 0).astype(np.uint8), np.ones((15, 15), np.uint8))
        region |= dil
    return round(float(region.mean() * 100), 1)


def total_failure(index: float, scene: dict | None) -> bool:
    """'Rusak total' only when both the visual index and the scene model agree."""
    if scene is None or "surface" not in scene:
        return False
    return index >= 60 and scene["surface"].get("broken", 0.0) >= 0.5
