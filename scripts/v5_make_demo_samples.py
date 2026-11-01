"""Builds public/demo/samples: DEMO photos for the sample-photo link (02 §9 D-2).

Run with the inference venv:  inference/.venv/Scripts/python.exe scripts/v5_make_demo_samples.py
Base photos are RDD2022 images already in the repo; composites are labelled as drawn overlays.
"""
from __future__ import annotations

import json
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "public" / "demo" / "samples"
REG = json.loads((ROOT / "src" / "data" / "reference" / "datasetImageRegistry.json").read_text(encoding="utf8"))


def entry(path: str) -> dict:
    def walk(node):
        if isinstance(node, dict):
            if node.get("storagePath") == path:
                return node
            for value in node.values():
                found = walk(value)
                if found:
                    return found
        elif isinstance(node, list):
            for value in node:
                found = walk(value)
                if found:
                    return found
        return None
    return walk(REG) or {}


def load(path: str) -> np.ndarray:
    image = cv2.imread(str(ROOT / "public" / path))
    if image is None:
        raise SystemExit(f"missing {path}")
    return image


def label(image: np.ndarray, text: str) -> None:
    h, w = image.shape[:2]
    scale = w / 1100
    cv2.rectangle(image, (0, h - int(46 * scale)), (w, h), (21, 16, 13), -1)
    cv2.putText(image, text, (int(12 * scale), h - int(14 * scale)), cv2.FONT_HERSHEY_SIMPLEX, 0.8 * scale, (255, 255, 255), max(1, int(2 * scale)), cv2.LINE_AA)


def with_marker(image: np.ndarray) -> np.ndarray:
    out = image.copy()
    h, w = out.shape[:2]
    side = int(min(h, w) * 0.28)
    marker = cv2.aruco.generateImageMarker(cv2.aruco.getPredefinedDictionary(cv2.aruco.DICT_4X4_50), 7, side)
    x, y = int(w * 0.06), int(h * 0.1)
    pad = side // 8
    out[y - pad : y + side + pad, x - pad : x + side + pad] = 255
    out[y : y + side, x : x + side] = cv2.cvtColor(marker, cv2.COLOR_GRAY2BGR)
    label(out, "DEMO composite: printed marker card drawn on the photo")
    return out


def with_ruler(image: np.ndarray) -> np.ndarray:
    out = image.copy()
    h, w = out.shape[:2]
    y = int(h * 0.45)
    cv2.rectangle(out, (int(w * 0.08), y - 8), (int(w * 0.92), y + 8), (60, 60, 60), -1)
    x = int(w * 0.5)
    cv2.rectangle(out, (x - 18, y), (x + 18, y + int(h * 0.3)), (44, 199, 255), -1)
    for i in range(0, int(h * 0.3), 14):
        cv2.line(out, (x - 18, y + i), (x + (0 if i % 70 else 12), y + i), (21, 16, 13), 2)
    label(out, "DEMO composite: straightedge and ruler drawn on the photo")
    return out


def stage(image: np.ndarray, text: str, seed: int) -> np.ndarray:
    # Each repair stage gets its own framing so stage photos are not one image repeated.
    h, w = image.shape[:2]
    shift = 30 + seed * 34
    out = image[shift % (h // 4) :, shift % (w // 4) :].copy()
    out = cv2.resize(out, (w, h))
    label(out, f"DEMO sample: {text}")
    return out


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    pothole = "dataset-reference/rdd2022/D40/Czech_000108.jpg"
    pothole2 = "dataset-reference/rdd2022/D40/Czech_000293.jpg"
    crack = next((str(p.relative_to(ROOT / "public")).replace("\\", "/") for p in (ROOT / "public/dataset-reference/rdd2022/D20").glob("*.jpg")), None)
    base = load(pothole)
    meta = entry(pothole)
    credit = {"source": meta.get("sourceDataset") or meta.get("dataset") or "RDD2022", "license": meta.get("license") or "CC BY 4.0 (RDD2022 dataset)", "note": "Road Damage Dataset 2022, see docs/CITATIONS.md"}
    samples = [("pothole", "Pothole on a road", pothole, None), ("pothole-2", "Second pothole", pothole2, None), ("alligator", "Alligator cracking", crack, None)]
    manifest = []
    for sid, title, path, _ in samples:
        if not path:
            continue
        cv2.imwrite(str(OUT / f"{sid}.jpg"), load(path), [cv2.IMWRITE_JPEG_QUALITY, 82])
        manifest.append({"id": sid, "file": f"{sid}.jpg", "title": title, "composite": False, **credit, "basePhoto": path})
    cv2.imwrite(str(OUT / "marker-card.jpg"), with_marker(base), [cv2.IMWRITE_JPEG_QUALITY, 90])
    manifest.append({"id": "marker-card", "file": "marker-card.jpg", "title": "Marker card photo", "composite": True, **credit, "basePhoto": pothole})
    cv2.imwrite(str(OUT / "ruler.jpg"), with_ruler(base), [cv2.IMWRITE_JPEG_QUALITY, 82])
    manifest.append({"id": "ruler", "file": "ruler.jpg", "title": "Ruler at the deepest point", "composite": True, **credit, "basePhoto": pothole})
    stages = ["BEFORE", "CUT_EDGES", "CLEAN_DRY", "TACK_COAT", "DELIVERY_TICKET", "MIX_TEMP_TRUCK", "MIX_TEMP_MAT", "LOOSE_THICKNESS", "COMPACTION", "AFTER", "SUPERVISOR_AFTER"]
    for i, name in enumerate(stages):
        sid = f"stage-{name.lower().replace('_', '-')}"
        cv2.imwrite(str(OUT / f"{sid}.jpg"), stage(base, name, i), [cv2.IMWRITE_JPEG_QUALITY, 80])
        manifest.append({"id": sid, "file": f"{sid}.jpg", "title": f"Repair stage {name}", "composite": True, "stage": name, **credit, "basePhoto": pothole})
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=1), encoding="utf8")
    lines = ["# Demo sample photos", "", "Every sample is stamped DEMO when used. Composites have drawn overlays and are not field photos.", ""]
    lines += [f"- `{m['file']}`: {m['title']}. Base {m['basePhoto']}. {m['license']}. {m['note']}." for m in manifest]
    (OUT / "LICENSES.md").write_text("\n".join(lines) + "\n", encoding="utf8")
    print(len(manifest), "samples", credit)


if __name__ == "__main__":
    main()
