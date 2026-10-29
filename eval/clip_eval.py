"""SPEC M10: zero-shot CLIP scene heads on the team's own photos.

Layout: eval/local_test/scenes/<class>/*.jpg with <class> one of
  bukan_jalan, genangan, good, cracked, potholed, broken, unpaved
(bukan_jalan -> road head; genangan -> water head; the others -> surface head top-1).
Writes measurements/clip_scene.json (accuracy + confusion per head), or BELUM_DIUKUR when a class
has fewer than MIN_PER_CLASS photos. Run: inference/.venv/Scripts/python eval/clip_eval.py
"""
from __future__ import annotations

import json
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "inference"))
DATA = ROOT / "eval" / "local_test" / "scenes"
OUT = ROOT / "measurements" / "clip_scene.json"
MIN_PER_CLASS = 20
SURFACE = ["good", "cracked", "potholed", "broken", "unpaved"]


def main():
    meta = {"measuredAt": datetime.now(timezone.utc).isoformat()}
    try:
        meta["commit"] = subprocess.check_output(["git", "rev-parse", "--short", "HEAD"], cwd=ROOT, text=True).strip()
    except Exception:  # noqa: BLE001
        meta["commit"] = None
    counts = {d.name: len(list(d.glob("*.jpg"))) for d in DATA.iterdir() if d.is_dir()} if DATA.exists() else {}
    if not counts or min(counts.values()) < MIN_PER_CLASS:
        OUT.parent.mkdir(exist_ok=True)
        OUT.write_text(json.dumps({**meta, "status": "BELUM_DIUKUR", "label": "BELUM_DIUKUR", "photosPerClass": counts, "requiredPerClass": MIN_PER_CLASS,
                                   "howTo": "Isi eval/local_test/scenes/<kelas>/*.jpg (min. 20 foto per kelas), lalu jalankan ulang."}, indent=2))
        print(f"BELUM_DIUKUR: {counts}")
        return
    import cv2
    import numpy as np

    from app.cv import scene

    heads = {"road": [0, 0], "water": [0, 0], "surface": [0, 0]}
    confusion: dict[str, dict[str, int]] = {}
    for cls, n in counts.items():
        for p in sorted((DATA / cls).glob("*.jpg")):
            s = scene.classify(cv2.imdecode(np.fromfile(str(p), np.uint8), cv2.IMREAD_COLOR))
            if s is None:
                raise SystemExit("CLIP scene model not installed")
            road_ok = (not s["isRoad"]) == (cls == "bukan_jalan")
            heads["road"][0] += road_ok; heads["road"][1] += 1
            if cls == "genangan" or cls in SURFACE:
                water_ok = s["water"]["flooded"] == (cls == "genangan")
                heads["water"][0] += water_ok; heads["water"][1] += 1
            if cls in SURFACE:
                top = s["surfaceTop"]["key"]
                heads["surface"][0] += top == cls; heads["surface"][1] += 1
                confusion.setdefault(cls, {}).setdefault(top, 0)
                confusion[cls][top] += 1
    acc = {k: (round(a / n, 4) if n else None) for k, (a, n) in heads.items()}
    OUT.write_text(json.dumps({**meta, "status": "TERUKUR", "label": "TERUKUR", "photosPerClass": counts, "accuracy": acc, "surfaceConfusion": confusion,
                               "note": "CLIP zero-shot, tidak dikalibrasi; hanya untuk triase (PERLU_VERIFIKASI)."}, indent=2))
    print(json.dumps(acc))


if __name__ == "__main__":
    main()
