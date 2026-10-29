"""Build the PI-surrogate training set from PyMastic on all CPU cores (Dokumen Induk v3 §4.4 D2).

Adapted from docs/v3/_build/reference_code/gen_mlet_dataset.py. Change: the dual-tyre spacing
is sampled too, because strains depend on d/a and a varies with load and pressure.

Run from inference/:  .venv/Scripts/python -m training.gen_mlet_dataset --n 20000
"""
from __future__ import annotations

import argparse
import json
import os
import platform
import time
import warnings
from multiprocessing import Pool

import numpy as np
from scipy.stats import qmc

# P axle t, q MPa, h1/h2 mm, E1/E2 MPa, subgrade CBR %, d dual spacing mm
RANGES = {"P": (6, 25), "q": (0.5, 0.8), "h1": (50, 250), "h2": (100, 400), "E1": (1000, 5000),
          "E2": (100, 500), "CBR": (1, 15), "d": (250, 400)}
LOG_UNIFORM = ("h1", "E1", "CBR")
K_CBR = 10.0  # E3 = 10 x CBR MPa (ASSUMED, same as the service)
NU = [0.35, 0.35, 0.45]


def sample(n: int, seed: int) -> np.ndarray:
    u = qmc.LatinHypercube(d=len(RANGES), seed=seed).random(n)
    lo = np.array([v[0] for v in RANGES.values()], float)
    hi = np.array([v[1] for v in RANGES.values()], float)
    x = lo + u * (hi - lo)
    for j, name in enumerate(RANGES):
        if name in LOG_UNIFORM:
            x[:, j] = np.exp(np.log(lo[j]) + u[:, j] * (np.log(hi[j]) - np.log(lo[j])))
    return x


def solve(row):
    warnings.filterwarnings("ignore")
    from app.mlet import mlet_strains
    P, q, h1, h2, E1, E2, CBR, d = row
    try:
        r = mlet_strains(P, [h1, h2], [E1, E2, K_CBR * CBR], NU, q_mpa=q, dual_spacing_mm=d)
        return r["a_mm"], r["et_ue"], r["ev_ue"]
    except Exception:
        return np.nan, np.nan, np.nan


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=20000)
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--out", default="data/mlet_dual_v1.npz")
    a = ap.parse_args()
    X = sample(a.n, a.seed)
    t0 = time.time()
    with Pool(int(os.environ.get("MLET_WORKERS", os.cpu_count()))) as pool:
        out = np.array(pool.map(solve, list(X), chunksize=64))
    seconds = time.time() - t0
    ok = np.isfinite(out).all(1) & (out[:, 1] > 0) & (out[:, 2] > 0)
    os.makedirs(os.path.dirname(a.out) or ".", exist_ok=True)
    np.savez(a.out, X=X[ok], out=out[ok], columns=np.array(list(RANGES)), k_cbr=K_CBR)
    log = {"file": a.out, "n_requested": a.n, "n_valid": int(ok.sum()), "seed": a.seed, "ranges": RANGES,
           "k_cbr": K_CBR, "nu": NU, "seconds": round(seconds, 1), "cpu_count": os.cpu_count(),
           "cpu": platform.processor(), "ms_per_case_per_core": round(seconds * 1000 * os.cpu_count() / a.n, 2)}
    with open(a.out.replace(".npz", "_log.json"), "w") as f:
        json.dump(log, f, indent=2)
    print(json.dumps(log, indent=2))


if __name__ == "__main__":
    main()
