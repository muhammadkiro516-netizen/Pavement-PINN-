"""SPEC M10: road-damage detector accuracy on the team's own local photos (eval/local_test).

Layout (filled by the team, see eval/local_test/README.md):
  eval/local_test/images/<name>.jpg
  eval/local_test/labels/<name>.txt     YOLO format: class cx cy w h (normalised), class = detector index
Writes measurements/cv_local.json with mAP@0.5 and per-class AP, or status BELUM_DIUKUR when the
folder holds fewer than MIN_IMAGES labelled photos (no number is invented).
Run: inference/.venv/Scripts/python eval/cv_eval.py
"""
from __future__ import annotations

import json
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "inference"))
DATA = ROOT / "eval" / "local_test"
OUT = ROOT / "measurements" / "cv_local.json"
MIN_IMAGES = 100


def iou(a, b) -> float:
    x1, y1, x2, y2 = max(a[0], b[0]), max(a[1], b[1]), min(a[2], b[2]), min(a[3], b[3])
    inter = max(0.0, x2 - x1) * max(0.0, y2 - y1)
    ua = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter
    return inter / ua if ua > 0 else 0.0


def average_precision(scores: list[float], hits: list[bool], n_gt: int) -> float | None:
    if n_gt == 0:
        return None
    order = np.argsort(-np.array(scores))
    tp = np.cumsum(np.array(hits)[order]) if scores else np.array([])
    fp = np.cumsum(~np.array(hits)[order]) if scores else np.array([])
    if not len(tp):
        return 0.0
    rec, prec = tp / n_gt, tp / np.maximum(tp + fp, 1)
    mrec, mpre = np.concatenate([[0], rec, [1]]), np.concatenate([[0], prec, [0]])
    for i in range(len(mpre) - 2, -1, -1):
        mpre[i] = max(mpre[i], mpre[i + 1])
    idx = np.flatnonzero(mrec[1:] != mrec[:-1])
    return float(np.sum((mrec[idx + 1] - mrec[idx]) * mpre[idx + 1]))


def main():
    meta = {"measuredAt": datetime.now(timezone.utc).isoformat()}
    try:
        meta["commit"] = subprocess.check_output(["git", "rev-parse", "--short", "HEAD"], cwd=ROOT, text=True).strip()
    except Exception:  # noqa: BLE001
        meta["commit"] = None
    images = sorted((DATA / "images").glob("*.jpg")) if (DATA / "images").exists() else []
    pairs = [(p, DATA / "labels" / f"{p.stem}.txt") for p in images if (DATA / "labels" / f"{p.stem}.txt").exists()]
    if len(pairs) < MIN_IMAGES:
        OUT.parent.mkdir(exist_ok=True)
        OUT.write_text(json.dumps({**meta, "status": "BELUM_DIUKUR", "label": "BELUM_DIUKUR", "labelledImages": len(pairs), "required": MIN_IMAGES,
                                   "howTo": "Isi eval/local_test/images + labels (format YOLO), minimal 100 foto lokal (30% basah/malam), lalu jalankan ulang."}, indent=2))
        print(f"BELUM_DIUKUR: {len(pairs)} labelled images (need {MIN_IMAGES})")
        return
    import cv2
    from app.cv import engine

    per_class: dict[int, dict] = {}
    for img, lab in pairs:
        data = img.read_bytes()
        h, w = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR).shape[:2]
        gts = []
        for line in lab.read_text().split("\n"):
            parts = line.split()
            if len(parts) == 5:
                c, cx, cy, bw, bh = int(parts[0]), *map(float, parts[1:])
                gts.append((c, [(cx - bw / 2) * w, (cy - bh / 2) * h, (cx + bw / 2) * w, (cy + bh / 2) * h]))
        dets = engine.analyze_image(data).get("detections", [])
        used = set()
        for d in sorted(dets, key=lambda x: -x["confidence"]):
            c = d["classIndex"]
            row = per_class.setdefault(c, {"scores": [], "hits": [], "gt": 0, "label": d["modelLabel"]})
            best, j = 0.0, -1
            for k, (gc, gb) in enumerate(gts):
                if gc == c and k not in used and iou(d["bbox"], gb) > best:
                    best, j = iou(d["bbox"], gb), k
            row["scores"].append(d["confidence"])
            row["hits"].append(best >= 0.5)
            if best >= 0.5:
                used.add(j)
        for gc, _ in gts:
            per_class.setdefault(gc, {"scores": [], "hits": [], "gt": 0, "label": str(gc)})["gt"] += 1
    aps = {r["label"]: average_precision(r["scores"], r["hits"], r["gt"]) for r in per_class.values()}
    valid = [v for v in aps.values() if v is not None]
    rt = engine.runtime_info()
    OUT.write_text(json.dumps({**meta, "status": "TERUKUR", "label": "TERUKUR", "images": len(pairs), "map50": round(float(np.mean(valid)), 4) if valid else None,
                               "apPerClass": {k: (round(v, 4) if v is not None else None) for k, v in aps.items()}, "runtime": rt}, indent=2))
    print(json.dumps({"map50": np.mean(valid) if valid else None, "images": len(pairs)}))


if __name__ == "__main__":
    main()
