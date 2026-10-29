"""Precompute the text side of the CLIP scene heads -> models/cv/clip-scenes.npz.

    inference/.venv/Scripts/python -I inference/scripts/build_clip_scenes.py

Prompts are English (CLIP's text encoder is English-trained); the app shows Indonesian labels.
Each class embedding is the normalised mean of its prompt embeddings (prompt ensembling).
At runtime only the vision model runs; this script is the only user of `tokenizers`.
"""
from __future__ import annotations

from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
CLIP = ROOT / "models" / "cv" / "clip"

HEADS: dict[str, dict[str, list[str]]] = {
    "road": {
        "road": ["a photo of a road", "a photo of an asphalt street", "a street seen from a pedestrian", "a photo of a road surface", "a highway lane"],
        "not_road": ["a photo of a room indoors", "a selfie of a person", "a photo of food", "a screenshot of a phone", "a photo of a document", "a photo of a building interior"],
    },
    "surface": {
        "good": ["a smooth asphalt road in good condition", "a newly paved road", "a well maintained street with clean asphalt", "an asphalt road without damage"],
        "cracked": ["an asphalt road with cracks", "a road surface with long cracks", "alligator cracking on asphalt pavement", "a cracked street surface"],
        "potholed": ["a road with a pothole", "a pothole in the asphalt", "a street with potholes", "a damaged road with holes"],
        "broken": ["a severely damaged road where the asphalt is destroyed", "a road surface that has completely broken apart into gravel", "a ruined road with no intact asphalt left", "a road destroyed with large broken areas"],
        "unpaved": ["an unpaved dirt road", "a gravel road", "a muddy unpaved village track", "a dirt path without asphalt"],
    },
    "distress": {
        "pothole": ["a pothole in an asphalt road", "a deep hole in the road surface", "a road with several potholes filled with water"],
        "alligator": ["alligator cracking on asphalt", "an asphalt road with a network of interconnected cracks like crocodile skin", "fatigue cracking pattern on a road"],
        "crack": ["a long crack along an asphalt road", "a transverse crack across a road", "thin cracks on a road surface"],
        "rutting": ["rutting on an asphalt road with depressed wheel paths", "ruts along the wheel tracks of a road", "a road with grooves worn into the lanes by heavy trucks"],
        "corrugation": ["corrugated asphalt with wavy ripples across the road", "a washboard road surface with regular ridges", "a road surface with transverse waves"],
        "subsidence": ["a road that has sunk and collapsed", "a road subsidence where the ground has caved in", "a sinkhole in a road"],
        "depression": ["a shallow depression in the road where water collects", "a sunken area in the asphalt", "a dip in the road surface"],
        "raveling": ["raveling asphalt with loose gravel on the surface", "a road surface where the asphalt is wearing away into loose stones", "a worn rough weathered asphalt surface"],
        "deformation": ["a deformed road surface with bumps and shoving", "asphalt pushed up into a bulge", "a road with an uneven heaved surface"],
        "patching": ["a patched road with repaired asphalt patches", "a road with a rectangular asphalt patch repair", "a road with several darker repaired areas"],
        "flooding": ["a flooded road", "a street submerged by flood water", "a road covered with standing water after heavy rain"],
        "none": ["a smooth asphalt road in good condition", "a newly paved road without damage", "a clean well maintained street"],
    },
    "water": {
        "flooded": ["a flooded road", "a road covered with standing water", "a street submerged by flood water", "a road with a large puddle of water", "a waterlogged street after heavy rain"],
        "dry": ["a dry road", "a road with no water on it", "a dry asphalt street on a sunny day", "a dry dusty road"],
    },
}


def main() -> None:
    import openvino as ov
    from tokenizers import Tokenizer

    tok = Tokenizer.from_file(str(CLIP / "tokenizer.json"))
    core = ov.Core()
    model = core.compile_model(str(CLIP / "text_model.onnx"), "CPU")
    in_names = [i.get_any_name() for i in model.inputs]
    out = next((o for o in model.outputs if "text_embeds" in o.get_any_name()), model.outputs[0])

    def embed(text: str) -> np.ndarray:
        ids = np.array([tok.encode(text).ids], dtype=np.int64)
        feeds = {"input_ids": ids}
        if "attention_mask" in in_names:
            feeds["attention_mask"] = np.ones_like(ids)
        v = np.asarray(model(feeds)[out], np.float32).reshape(-1)
        return v / np.linalg.norm(v)

    arrays: dict[str, np.ndarray] = {}
    for head, classes in HEADS.items():
        rows, labels = [], []
        for label, prompts in classes.items():
            m = np.mean([embed(p) for p in prompts], axis=0)
            rows.append(m / np.linalg.norm(m))
            labels.append(label)
        arrays[f"{head}_emb"] = np.stack(rows).astype(np.float32)
        arrays[f"{head}_lab"] = np.array(labels)
    np.savez(CLIP.parent / "clip-scenes.npz", **arrays)
    print("wrote", CLIP.parent / "clip-scenes.npz", {h: list(c) for h, c in HEADS.items()})


if __name__ == "__main__":
    main()
