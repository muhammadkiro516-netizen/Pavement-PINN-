"""SPEC M7: fetch the pre-converted OpenVINO INT4 SLM (Qwen2.5-1.5B-Instruct) at a pinned revision.
Equivalent to `optimum-cli export openvino --weight-format int4`, published by the OpenVINO org."""
from pathlib import Path

from huggingface_hub import snapshot_download

REPO = "OpenVINO/Qwen2.5-1.5B-Instruct-int4-ov"
REVISION = "4d14c299"
OUT = Path(__file__).resolve().parents[2] / "models" / "slm" / "qwen2.5-1.5b-instruct-int4-ov"

if __name__ == "__main__":
    path = snapshot_download(REPO, revision=REVISION, local_dir=OUT)
    print(path)
