"""Back up the app data (reports, accounts, CV analyses) to a PRIVATE Hugging Face dataset repo.

  python hf/data_sync.py restore   # download the latest snapshot into DATA_DIR (on start)
  python hf/data_sync.py loop      # upload DATA_DIR whenever it changed, every SYNC_SECONDS
Needs secrets HF_TOKEN (write) and DATA_REPO (e.g. "user/pavement-pinn-data"); otherwise does nothing.
"""
from __future__ import annotations

import hashlib
import os
import sys
import time
from pathlib import Path

DATA = Path(os.environ.get("DATA_DIR", ".data"))
REPO = os.environ.get("DATA_REPO")
TOKEN = os.environ.get("HF_TOKEN")
EVERY = int(os.environ.get("SYNC_SECONDS", "180"))
SKIP = ("*.log",)


def fingerprint() -> str:
    h = hashlib.sha256()
    for p in sorted(DATA.rglob("*")):
        if p.is_file() and not p.name.endswith(".log"):
            st = p.stat()
            h.update(f"{p.relative_to(DATA)}:{st.st_size}:{st.st_mtime_ns}".encode())
    return h.hexdigest()


def main(cmd: str) -> None:
    if not (REPO and TOKEN):
        print("data_sync: HF_TOKEN/DATA_REPO not set; running without backup")
        return
    from huggingface_hub import HfApi, snapshot_download

    api = HfApi(token=TOKEN)
    if cmd == "restore":
        try:
            snapshot_download(REPO, repo_type="dataset", local_dir=str(DATA), token=TOKEN)
            print(f"data_sync: restored {REPO}")
        except Exception as exc:  # noqa: BLE001 - first start: repository empty
            print(f"data_sync: nothing restored ({type(exc).__name__})")
        return
    last = fingerprint()
    while True:
        time.sleep(EVERY)
        now = fingerprint()
        if now == last:
            continue
        try:
            api.upload_folder(folder_path=str(DATA), repo_id=REPO, repo_type="dataset", ignore_patterns=list(SKIP), commit_message="backup")
            last = now
            print("data_sync: backed up", flush=True)
        except Exception as exc:  # noqa: BLE001 - retry on the next round
            print(f"data_sync: backup failed ({exc})", flush=True)


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "loop")
