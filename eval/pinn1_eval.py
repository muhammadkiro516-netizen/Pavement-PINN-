"""SPEC M5.2 / M10: train and evaluate PINN-1 against PyMastic on the pilot structure.

Writes:
  measurements/pinn1_forward.json   relative L2 error (w, eps_rr, eps_zz) vs PyMastic, residual stats
  measurements/pinn1_ablation.json  same network trained WITHOUT the physics loss (data only)
  measurements/pinn1_inverse.json   moduli recovered from a deflection basin (synthetic, CONTOH)
  measurements/pinn1_field.json     eps_zz grids (PINN-1 and PyMastic) for the Ruas visual

Run from the repo root:  inference/.venv/Scripts/python eval/pinn1_eval.py [--iters 4000]
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

import torch  # noqa: E402

from pinn1.core import Pinn1, Structure, predict, pymastic_field, rel_l2, train  # noqa: E402

OUT = ROOT / "measurements"
# Pilot structure (same numbers as the field test in docs/FITUR_DAN_ALUR.md), DARI_INPUT.
PILOT = Structure(h_mm=[50, 200, 250], E_mpa=[3000, 300, 150, 50], nu=[0.35, 0.35, 0.35, 0.40])


def meta() -> dict:
    try:
        commit = subprocess.check_output(["git", "rev-parse", "--short", "HEAD"], cwd=ROOT, text=True).strip()
    except Exception:  # noqa: BLE001
        commit = None
    cpu = platform.processor() or platform.machine()
    return {
        "measuredAt": datetime.now(timezone.utc).isoformat(),
        "commit": commit,
        "device": {"cpu": cpu, "torch": torch.__version__, "threads": torch.get_num_threads()},
        "hostLabel": "HOST_NON_INTEL" if "AMD" in cpu.upper() else "HOST",
        "structure": {"h_mm": PILOT.h_mm, "E_mpa": PILOT.E_mpa, "nu": PILOT.nu, "q_mpa": PILOT.q_mpa, "a_mm": round(PILOT.a_mm, 2)},
    }


def data_points(st: Structure, rng: np.random.Generator, n: int = 40) -> dict:
    """Sparse PyMastic points (training data), away from the evaluation grid."""
    r = rng.uniform(0.05, 6.0, n)
    z = rng.uniform(0.02, st.interfaces[-1] + 6.0, n)
    ref = pymastic_field(st, sorted(set(np.round(r, 3))), sorted(set(np.round(z, 3))))
    rr, zz = sorted(set(np.round(r, 3))), sorted(set(np.round(z, 3)))
    # take the diagonal-ish pairs (i-th r with i-th z) to keep n points
    pts = [(rr[i % len(rr)], zz[i % len(zz)], i % len(zz), i % len(rr)) for i in range(n)]
    return {
        "r": [p[0] for p in pts], "z": [p[1] for p in pts],
        "w": [ref["w"][p[2], p[3]] for p in pts], "eps_rr": [ref["eps_rr"][p[2], p[3]] for p in pts], "eps_zz": [ref["eps_zz"][p[2], p[3]] for p in pts],
    }


def eval_grid(st: Structure):
    r = list(np.round(np.linspace(0.02, 4.0, 21), 4))
    z = sorted(set(np.round(np.concatenate([np.linspace(0.05, st.interfaces[-1] + 4.0, 24), [x - 0.02 for x in st.interfaces], [x + 0.02 for x in st.interfaces]]), 4)))
    return r, z


def errors(model: Pinn1, st: Structure) -> dict:
    r, z = eval_grid(st)
    ref = pymastic_field(st, r, z)
    pred = predict(model, r, z)
    return {
        "relL2": {k: round(rel_l2(pred[k], ref[k]), 4) for k in ("w", "eps_rr", "eps_zz")},
        "residual": {"mean": float(np.mean(pred["residual"])), "p95": float(np.percentile(pred["residual"], 95))},
        "grid": {"r": r, "z": z, "pinn_eps_zz": pred["eps_zz"].tolist(), "pymastic_eps_zz": ref["eps_zz"].tolist(), "residual": pred["residual"].tolist()},
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--iters", type=int, default=4000)
    args = ap.parse_args()
    OUT.mkdir(exist_ok=True)
    rng = np.random.default_rng(7)
    data = data_points(PILOT, rng)
    m = meta()

    fwd = Pinn1(PILOT)
    info = train(fwd, data, iters=args.iters, physics=True, log_every=max(1, args.iters // 20))
    e = errors(fwd, PILOT)
    (OUT / "pinn1_forward.json").write_text(json.dumps({**m, "label": "TERUKUR", "what": "PINN-1 (physics + 40 PyMastic points) vs PyMastic on a 21x~30 grid", "train": info, "relL2": e["relL2"], "residual": e["residual"], "dataPoints": len(data["r"])}, indent=2))
    (OUT / "pinn1_field.json").write_text(json.dumps({**m, "label": "TERUKUR", "unit": "eps_zz x E_subgrade / q (non-dimensional)", **e["grid"]}))

    abl = Pinn1(PILOT)
    info_a = train(abl, data, iters=args.iters, physics=False, log_every=max(1, args.iters // 20))
    ea = errors(abl, PILOT)
    (OUT / "pinn1_ablation.json").write_text(json.dumps({**m, "label": "TERUKUR", "what": "same network and data, physics loss removed", "train": info_a, "relL2": ea["relL2"], "residual": ea["residual"], "withPhysics": e["relL2"]}, indent=2))

    # Inverse: start from moduli 40 % off and recover them from a surface deflection basin.
    true_e = list(PILOT.E_mpa)
    basin_r = [0.0, 0.5, 1.0, 1.5, 2.0, 3.0, 4.0, 5.0, 6.0]
    basin = pymastic_field(PILOT, basin_r, [0.001])["w"][0]
    start = Structure(h_mm=PILOT.h_mm, E_mpa=[true_e[0] * 1.4, true_e[1] * 0.6, true_e[2] * 1.4, true_e[3]], nu=PILOT.nu)
    inv = Pinn1(start, inverse=True)
    info_i = train(inv, {"r": basin_r, "z": [0.001] * len(basin_r), "w": list(basin)}, iters=args.iters, physics=True, log_every=max(1, args.iters // 20))
    rec = (inv.e_hat().detach().numpy() * true_e[-1]).tolist()
    (OUT / "pinn1_inverse.json").write_text(json.dumps({**m, "label": "CONTOH", "what": "moduli from a synthetic deflection basin (PyMastic with known moduli); real Benkelman/FWD basins replace it when available",
        "trueE": true_e, "startE": start.E_mpa, "recoveredE": [round(x, 1) for x in rec], "errorPct": [round(abs(a / b - 1) * 100, 1) for a, b in zip(rec, true_e)], "train": info_i}, indent=2))
    print(json.dumps({"forward": e["relL2"], "ablation": ea["relL2"], "inverse_errorPct": [round(abs(a / b - 1) * 100, 1) for a, b in zip(rec, true_e)], "seconds": [info["seconds"], info_a["seconds"], info_i["seconds"]]}))


if __name__ == "__main__":
    main()
