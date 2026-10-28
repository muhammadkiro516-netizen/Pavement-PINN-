"""Download the CLIP ViT-B/32 scene model and convert it for OpenVINO (one time, ~350 MB).

    inference/.venv/Scripts/python -I inference/scripts/fetch_clip.py

- Files come from Hugging Face `Xenova/clip-vit-base-patch32` at a pinned revision; their
  sha256 is written to models/cv/clip/SOURCE.json.
- The fp32 vision ONNX is converted to OpenVINO IR and its weights compressed to INT8 with
  NNCF (no calibration data needed). The `*_quantized.onnx` variants are not used: they use
  ONNX Runtime-specific quantisation operators.
- models/cv/clip/ is gitignored (the IR is ~90 MB, the ONNX files larger).
"""
from __future__ import annotations

import hashlib
import json
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "models" / "cv" / "clip"
REPO = "Xenova/clip-vit-base-patch32"
REVISION = "d15189d7028b43f1d3e65039190477f6af591c2a"
FILES = ["onnx/vision_model.onnx", "onnx/text_model.onnx", "tokenizer.json", "preprocessor_config.json"]


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    source = {"repo": REPO, "revision": REVISION, "license": "MIT (OpenAI CLIP)", "files": {}}
    for name in FILES:
        target = OUT / Path(name).name
        if not target.exists():
            url = f"https://huggingface.co/{REPO}/resolve/{REVISION}/{name}"
            print(f"downloading {name} ...")
            req = urllib.request.Request(url, headers={"User-Agent": "PAVEMENT-PINN/1.0"})
            with urllib.request.urlopen(req) as r, target.open("wb") as f:
                while chunk := r.read(1 << 20):
                    f.write(chunk)
        source["files"][name] = sha256(target)

    import nncf
    import openvino as ov

    xml = OUT / "clip_vision_int8.xml"
    if not xml.exists():
        model = ov.convert_model(str(OUT / "vision_model.onnx"))
        model.reshape({model.inputs[0].get_any_name(): [1, 3, 224, 224]})
        model = nncf.compress_weights(model)
        ov.save_model(model, str(xml))
    core = ov.Core()
    vm = core.read_model(str(xml))
    source["vision_ir"] = {"xml": xml.name, "inputs": [(i.get_any_name(), list(i.get_partial_shape().to_shape())) for i in vm.inputs],
                           "outputs": [(o.get_any_name(), str(o.get_partial_shape())) for o in vm.outputs]}
    tm = core.read_model(str(OUT / "text_model.onnx"))
    source["text_onnx"] = {"inputs": [i.get_any_name() for i in tm.inputs], "outputs": [o.get_any_name() for o in tm.outputs]}
    (OUT / "SOURCE.json").write_text(json.dumps(source, indent=2))
    print(json.dumps({k: source[k] for k in ("vision_ir", "text_onnx")}, indent=1))


if __name__ == "__main__":
    main()
