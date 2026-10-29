"""SPEC M10: PINN-2 surrogate accuracy against PyMastic, out-of-domain share of the priors, and
the elastic similarity check (scaling q and every modulus by k leaves strain * E / q unchanged).

Writes measurements/pinn2.json.  Run: inference/.venv/Scripts/python eval/pinn2_eval.py [--n 300]
"""
from __future__ import annotations

import argparse
import json
import platform
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "inference"))

from app.diagnose import TYPICAL, K_CBR  # noqa: E402
from app.mlet import mlet_strains  # noqa: E402
from app.surrogate import features, load_surrogate  # noqa: E402


def commit():
    try:
        return subprocess.check_output(["git", "rev-parse", "--short", "HEAD"], cwd=ROOT, text=True).strip()
    except Exception:  # noqa: BLE001
        return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=300)
    args = ap.parse_args()
    s = load_surrogate()
    if s is None:
        raise SystemExit("surrogate model missing")
    rng = np.random.default_rng(11)
    axle, q, d = 8.16, 0.55, 330.0
    h1 = rng.uniform(40, 200, args.n); h2 = rng.uniform(150, 500, args.n)
    E1 = rng.uniform(1500, 5000, args.n); E2 = rng.uniform(150, 600, args.n); E3 = rng.uniform(20, 120, args.n)
    F = features(np.full(args.n, axle), np.full(args.n, q), h1, h2, E1, E2, E3, np.full(args.n, d))
    inside = s.in_domain(F)
    t = time.perf_counter()
    Y = s.predict(F[inside])
    batch_ms = (time.perf_counter() - t) * 1000
    et_s = np.exp(Y[:, 0]) * q / E3[inside] * 1e6
    ev_s = np.exp(Y[:, 1]) * q / E3[inside] * 1e6
    et_r, ev_r = [], []
    t = time.perf_counter()
    for i in np.flatnonzero(inside):
        r = mlet_strains(axle, [h1[i], h2[i]], [E1[i], E2[i], E3[i]], [0.35, 0.35, 0.45], q_mpa=q, dual_spacing_mm=d, allow_compressive_et=True)
        et_r.append(r["et_ue"]); ev_r.append(r["ev_ue"])
    mlet_ms = (time.perf_counter() - t) * 1000 / max(1, int(inside.sum()))
    et_r, ev_r = np.array(et_r), np.array(ev_r)
    ok = et_r >= 50  # tensile strain near the neutral axis is not compared (model card)
    ape_t = np.abs(et_s[ok] / et_r[ok] - 1) * 100
    ape_v = np.abs(ev_s / ev_r - 1) * 100

    # Out-of-domain share of each typical prior (the diagnose() sampling, ASUMSI CVs).
    ood = {}
    for cls, p in TYPICAL.items():
        m = 2000
        g = np.random.default_rng(3)
        hh1 = np.clip(p["h1"] * np.exp(g.normal(0, 0.30, m)), 25, 400); hh2 = np.clip(p["h2"] * np.exp(g.normal(0, 0.30, m)), 50, 900)
        ee1 = p["E1"] * np.exp(g.normal(0, 0.35, m)); ee2 = p["E2"] * np.exp(g.normal(0, 0.40, m)); cbr = np.clip(p["cbr"] * np.exp(g.normal(0, 0.45, m)), 1, 40)
        FF = features(np.full(m, axle), np.full(m, q), hh1, hh2, ee1, ee2, K_CBR * cbr, np.full(m, d))
        ood[cls] = round(float(1 - s.in_domain(FF).mean()), 4)

    # Similarity: k * (q, E) -> same strain (linear elasticity), checked on PyMastic and the surrogate.
    base = mlet_strains(axle, [100, 300], [3000, 300, 60], [0.35, 0.35, 0.45], q_mpa=q, dual_spacing_mm=d)
    k = 1.7
    scaled = mlet_strains(axle * k, [100, 300], [3000 * k, 300 * k, 60 * k], [0.35, 0.35, 0.45], q_mpa=q * k, dual_spacing_mm=d)
    sim_err = abs(scaled["ev_ue"] / base["ev_ue"] - 1) * 100

    cpu = platform.processor() or platform.machine()
    out = {
        "measuredAt": datetime.now(timezone.utc).isoformat(), "commit": commit(), "label": "TERUKUR",
        "hostLabel": "HOST_NON_INTEL" if "AMD" in cpu.upper() else "HOST",
        "device": {"cpu": cpu, "openvino": s.openvino_version, "device": s.device, "precision": s.precision},
        "samples": int(inside.sum()), "outOfDomainInTest": int((~inside).sum()),
        "et": {"mape": round(float(ape_t.mean()), 3), "p95": round(float(np.percentile(ape_t, 95)), 3), "n": int(ok.sum())},
        "ev": {"mape": round(float(ape_v.mean()), 3), "p95": round(float(np.percentile(ape_v, 95)), 3), "n": len(ev_r)},
        "priorOutOfDomainShare": ood,
        "similarityCheckPct": round(sim_err, 4),
        "speed": {"surrogateBatchMs": round(batch_ms, 2), "surrogatePerSampleUs": round(batch_ms * 1000 / max(1, int(inside.sum())), 2), "pymasticPerSampleMs": round(mlet_ms, 2)},
    }
    (ROOT / "measurements").mkdir(exist_ok=True)
    (ROOT / "measurements" / "pinn2.json").write_text(json.dumps(out, indent=2))
    print(json.dumps({k: out[k] for k in ("et", "ev", "priorOutOfDomainShare", "similarityCheckPct", "speed")}))


if __name__ == "__main__":
    main()
