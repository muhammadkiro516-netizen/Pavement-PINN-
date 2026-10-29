"""SPEC M10: SLM proposal drafts on generated cases — share accepted by the checker on the first
try, share falling back to the template, tokens/s and time to first token, device used.

Writes measurements/slm.json.  Run: inference/.venv/Scripts/python eval/slm_eval.py [--n 50]
"""
from __future__ import annotations

import argparse
import json
import platform
import random
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "inference"))

from app import slm  # noqa: E402

DAMAGE = ["lubang", "retak buaya", "retak memanjang", "retak melintang", "amblas", "genangan"]
TITLES = [("Perlu lapis ulang", "RED"), ("Pantau", "YELLOW"), ("Tambal cukup", "GREEN")]
FACTORS = ["lelah aspal", "tanah dasar basah", "beban berlebih", "deformasi tanah dasar"]


def case(rng: random.Random) -> tuple[dict, dict]:
    title, _ = rng.choice(TITLES)
    diag = rng.random() < 0.8
    rec = rng.random() < 0.6
    facts = {
        "damage_types": rng.sample(DAMAGE, rng.randint(1, 3)),
        "diagnosis": {"title": title, "confidence": rng.choice(["rendah", "sedang", "tinggi"]), "dominant_factor": rng.choice(FACTORS)} if diag else None,
        "recurrence_known": rec,
        "flags": rng.sample(["Perlu klarifikasi biaya", "Rusak lebih cepat dari perbaikan sejenis", "Masih dalam masa pemeliharaan"], rng.randint(0, 2)),
        "fair_cost_known": False,
        "hazard_missing": rng.random() < 0.4,
    }
    values = {"RUAS": f"Ruas Uji {rng.randint(1, 99)}", "INSTANSI": "Dinas Uji", "LAPORAN_TERBUKA": str(rng.randint(1, 30))}
    if diag:
        values["SISA_UMUR"] = "0,5–3,2 tahun (P10–P90)"
    if rec:
        values["BERULANG"] = "2 dari 5 perbaikan"
    return facts, values


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=50)
    args = ap.parse_args()
    m = slm.load_slm()
    if m is None:
        raise SystemExit("SLM not installed: inference/scripts/fetch_slm.py")
    rng = random.Random(5)
    rows = []
    for i in range(args.n):
        facts, values = case(rng)
        out = slm.draft(facts, values, m)
        rows.append({"source": out["source"], "attempts": out["attempts"]})
        print(i + 1, out["source"], [a["problems"] for a in out["attempts"]], flush=True)
    first = [r["attempts"][0] for r in rows if r["attempts"]]
    all_attempts = [a for r in rows for a in r["attempts"]]
    problems: dict[str, int] = {}
    for a in all_attempts:
        for p in a["problems"]:
            key = p.split(" ")[0] if p.startswith(("missing", "banned", "unknown")) else p
            problems[key] = problems.get(key, 0) + 1
    cpu = platform.processor() or platform.machine()
    try:
        commit = subprocess.check_output(["git", "rev-parse", "--short", "HEAD"], cwd=ROOT, text=True).strip()
    except Exception:  # noqa: BLE001
        commit = None
    res = {
        "measuredAt": datetime.now(timezone.utc).isoformat(), "commit": commit, "label": "TERUKUR",
        "hostLabel": "HOST_NON_INTEL" if "AMD" in cpu.upper() else "HOST",
        "model": slm.MODEL_DIR.name, "device": m.device, "availableDevices": m.available, "deviceNotes": m.device_errors, "cpu": cpu,
        "cases": args.n,
        "acceptedFirstTryPct": round(100 * sum(1 for a in first if not a["problems"]) / max(1, len(first)), 1),
        "slmUsedPct": round(100 * sum(1 for r in rows if r["source"] == "SLM") / args.n, 1),
        "templateFallbackPct": round(100 * sum(1 for r in rows if r["source"] == "TEMPLAT") / args.n, 1),
        "tokensPerSecMean": round(sum(a["tokens_per_s"] for a in all_attempts) / max(1, len(all_attempts)), 2),
        "ttftMsMedian": sorted(a["ttft_ms"] for a in all_attempts)[len(all_attempts) // 2] if all_attempts else None,
        "rejectReasons": problems,
    }
    (ROOT / "measurements").mkdir(exist_ok=True)
    (ROOT / "measurements" / "slm.json").write_text(json.dumps(res, indent=2))
    print(json.dumps(res))


if __name__ == "__main__":
    main()
