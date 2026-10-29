"""Deploy PAVEMENT-PINN to a Hugging Face Space (Docker, free CPU) with a permanent HTTPS URL.

One-time, by the owner:  inference/.venv/Scripts/huggingface-cli login   (token with WRITE access)
Then:                    inference/.venv/Scripts/python scripts/deploy_hf.py [--space pavement-pinn]

What it does:
  1. creates the Space <user>/<space> (Docker SDK) and a PRIVATE dataset <user>/<space>-data,
  2. seeds the dataset once with the current app data (.data: reports, accounts, CV analyses),
     never with plaintext passwords (pilot-accounts.txt) or the local session key,
  3. sets the Space secrets HF_TOKEN, DATA_REPO and a random SESSION_SECRET,
  4. uploads the code + models (the SLM is fetched during the Space build),
  5. prints the permanent URL https://<user>-<space>.hf.space
"""
from __future__ import annotations

import argparse
import secrets
import tempfile
from pathlib import Path

from huggingface_hub import HfApi, get_token

ROOT = Path(__file__).resolve().parents[1]
DATA_FILES = ["accounts.json", "workflow.json", "share-visits.json", "geocode-cache.json", "revoked-sessions.json"]
DATA_DIRS = ["cv-analyses", "workspaces", "share-og"]
IGNORE = [
    ".git/**", "node_modules/**", "dist/**", ".data/**", "data/**", "backups/**", ".vscode/**", "e2e/**",
    "inference/.venv/**", "**/__pycache__/**", "*.log", "models/slm/**", "models/cv/src/**",
    "models/cv/clip/*.onnx", "eval/local_test/images/**", "eval/local_test/labels/**", "eval/local_test/scenes/**",
    "Dockerfile", "README.md", "docs/CLAUDE_PROJECT_STATUS_HANDOFF.md", "docs/POST_STRUCTURE_AUDIT.md", "test-results/**",
]

README = """---
title: PavementPINN
emoji: 🚧
colorFrom: yellow
colorTo: gray
sdk: docker
app_port: 7860
pinned: false
license: other
short_description: Lapor, kawal dan audit jalan rusak dengan AI di OpenVINO
---

PavementPINN — aplikasi lapor jalan rusak (Lapor · Kawal · Audit). Kode sumber dan dokumentasi: lihat repositori proyek.
"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--space", default="pavement-pinn")
    ap.add_argument("--reseed", action="store_true", help="overwrite the data backup with the local .data")
    args = ap.parse_args()
    token = get_token()
    if not token:
        raise SystemExit("Belum login. Jalankan dulu: inference/.venv/Scripts/huggingface-cli login")
    api = HfApi(token=token)
    user = api.whoami()["name"]
    space_id, data_id = f"{user}/{args.space}", f"{user}/{args.space}-data"

    first = not api.repo_exists(space_id, repo_type="space")
    api.create_repo(space_id, repo_type="space", space_sdk="docker", exist_ok=True)
    api.create_repo(data_id, repo_type="dataset", private=True, exist_ok=True)
    print(f"Space {space_id}, data {data_id} (private)")

    existing = [f for f in api.list_repo_files(data_id, repo_type="dataset") if f != ".gitattributes"]
    if not existing or args.reseed:
        with tempfile.TemporaryDirectory() as tmp:
            src, dst = ROOT / ".data", Path(tmp)
            n = 0
            for f in DATA_FILES:
                if (src / f).exists():
                    (dst / f).write_bytes((src / f).read_bytes()); n += 1
            for d in DATA_DIRS:
                for p in (src / d).rglob("*") if (src / d).exists() else []:
                    if p.is_file():
                        out = dst / p.relative_to(src); out.parent.mkdir(parents=True, exist_ok=True); out.write_bytes(p.read_bytes()); n += 1
            if n:
                api.upload_folder(folder_path=tmp, repo_id=data_id, repo_type="dataset", commit_message="seed from local .data")
            print(f"Data seeded: {n} files")
    else:
        print("Data backup already exists; kept (use --reseed to overwrite)")

    api.add_space_secret(space_id, "HF_TOKEN", token)
    api.add_space_secret(space_id, "DATA_REPO", data_id)
    if first:  # once: a new key on every deploy would sign everyone out
        api.add_space_secret(space_id, "SESSION_SECRET", secrets.token_hex(32))

    api.upload_folder(folder_path=str(ROOT), repo_id=space_id, repo_type="space", ignore_patterns=IGNORE, commit_message="deploy")
    api.upload_file(path_or_fileobj=str(ROOT / "hf" / "Dockerfile"), path_in_repo="Dockerfile", repo_id=space_id, repo_type="space")
    api.upload_file(path_or_fileobj=README.encode(), path_in_repo="README.md", repo_id=space_id, repo_type="space")
    host = f"{user}-{args.space}".lower().replace("_", "-").replace(".", "-")
    print(f"\nURL permanen: https://{host}.hf.space\nStatus build: https://huggingface.co/spaces/{space_id}")


if __name__ == "__main__":
    main()
