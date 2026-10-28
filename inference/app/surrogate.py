"""PI-surrogate served with OpenVINO, and the Monte Carlo life index (v3 §4.4 D2, §4.5).

The surrogate is used only inside its training domain. Each run also cross-checks a random
1-in-50 subset against PyMastic; if any differs by more than 10 %, the Monte Carlo result is
withheld (status CROSSCHECK_FAILED) rather than shown.
"""
from __future__ import annotations

import hashlib
import threading
import json
import math
import os
from functools import lru_cache
from pathlib import Path

import numpy as np

from .mlet import allowable_reps, mlet_strains

MODELS_DIR = Path(os.environ.get("MODELS_DIR", Path(__file__).resolve().parents[2] / "models"))
VERSION = "pi-surrogate-v1"
PRECISION = os.environ.get("SURROGATE_PRECISION", "fp32")
DEVICE = os.environ.get("SURROGATE_DEVICE", "CPU")
K_CBR = 10.0
CROSSCHECK_EVERY = 50
CROSSCHECK_LIMIT_PCT = 10.0
ET_CHECK_MIN_UE = 50.0


class Surrogate:
    def __init__(self, xml: Path, metrics: dict):
        import openvino as ov
        self.core = ov.Core()
        self.compiled = self.core.compile_model(str(xml), DEVICE)
        self.metrics = metrics
        self.fmin = np.array(metrics["domain"]["fmin"], np.float32)
        self.fmax = np.array(metrics["domain"]["fmax"], np.float32)
        self.openvino_version = ov.__version__
        self.precision = PRECISION
        self.device = DEVICE
        self._lock = threading.Lock()

    def predict(self, F: np.ndarray) -> np.ndarray:
        with self._lock:  # one compiled model = one implicit infer request; serialise callers
            return self.compiled(F.astype(np.float32))[0]

    def in_domain(self, F: np.ndarray) -> np.ndarray:
        return ((F >= self.fmin) & (F <= self.fmax)).all(1)


@lru_cache(maxsize=1)
def load_surrogate() -> Surrogate | None:
    xml = MODELS_DIR / f"{VERSION}_{PRECISION}.xml"
    metrics = MODELS_DIR / f"{VERSION}_metrics.json"
    if not (xml.exists() and metrics.exists()):
        return None
    return Surrogate(xml, json.loads(metrics.read_text()))


def features(P, q, h1, h2, E1, E2, E3, d):
    a = np.sqrt(P * 9.80665e3 / 4 / (np.pi * q))
    return np.stack([np.log(h1 / a), np.log(h2 / a), np.log(E1 / E3), np.log(E2 / E3), np.log(d / a)], 1).astype(np.float32)


def seed_for(segment_id: str, seed: int | None) -> int:
    if seed is not None:
        return seed
    return int(hashlib.sha256(f"{segment_id}:v3".encode()).hexdigest()[:8], 16)


def spearman(x: np.ndarray, y: np.ndarray) -> float:
    rx, ry = np.argsort(np.argsort(x)), np.argsort(np.argsort(y))
    return float(np.corrcoef(rx, ry)[0, 1])


def life_monte_carlo(s: Surrogate, *, segment_id: str, seed: int | None, n: int, wet: bool,
                     h1: float, h2: float, E1: float, E2: float, cbr: float, soaked_factor: float,
                     axle_t: float, q: float, d: float, esal_year: tuple[float, float, float],
                     growth: float, damage_used: float, criterion: str) -> dict:
    """Default distributions (ASSUMED, editable later): h1 Normal(sd 10 mm), h2 Normal(sd 20 mm),
    E1 Lognormal(CV 25 %), E2 Lognormal(CV 30 %), CBR Lognormal(CV 35 %), ESAL Triangular(P10, P50, P90).
    The same seed is used dry and wet (common random numbers), so the difference is the condition only."""
    rng = np.random.default_rng(seed_for(segment_id, seed))
    sh1 = np.clip(rng.normal(h1, 10.0, n), 25, None)
    sh2 = np.clip(rng.normal(h2, 20.0, n), 50, None)
    sE1 = E1 * np.exp(rng.normal(0, 0.25, n))
    sE2 = E2 * np.exp(rng.normal(0, 0.30, n))
    scbr = cbr * np.exp(rng.normal(0, 0.35, n)) * (soaked_factor if wet else 1.0)
    sE3 = K_CBR * scbr
    lo, mid, hi = esal_year
    esal = rng.triangular(lo, mid, hi, n) if hi > lo else np.full(n, mid)
    P, Q, D = np.full(n, axle_t), np.full(n, q), np.full(n, d)

    F = features(P, Q, sh1, sh2, sE1, sE2, sE3, D)
    inside = s.in_domain(F)
    share_out = float(1 - inside.mean())
    if share_out > 0.05:
        return {"status": "OUT_OF_DOMAIN", "share_out_of_domain": round(share_out, 4),
                "message": "More than 5 % of samples fall outside the surrogate training domain; use the MLET result."}
    Y = s.predict(F)
    et = np.exp(Y[:, 0]) * q / sE3 * 1e6
    ev = np.exp(Y[:, 1]) * q / sE3 * 1e6

    # Samples outside the domain (<= 5 %) are solved exactly with PyMastic.
    solved_exact = 0
    for i in np.flatnonzero(~inside):
        r = mlet_strains(axle_t, [sh1[i], sh2[i]], [sE1[i], sE2[i], sE3[i]], [0.35, 0.35, 0.45], q_mpa=q, dual_spacing_mm=d)
        et[i], ev[i] = r["et_ue"], r["ev_ue"]
        solved_exact += 1

    # Cross-check a random 1-in-50 subset against PyMastic.
    check = rng.choice(np.flatnonzero(inside), size=max(1, int(inside.sum()) // CROSSCHECK_EVERY), replace=False)
    errs = []
    for i in check:
        r = mlet_strains(axle_t, [sh1[i], sh2[i]], [sE1[i], sE2[i], sE3[i]], [0.35, 0.35, 0.45], q_mpa=q, dual_spacing_mm=d)
        # Below 50 ue the tensile strain is near the neutral axis: relative error is large but
        # fatigue life is then far above the rutting life, so only ev is compared (model card).
        e_t = abs(et[i] / r["et_ue"] - 1) if r["et_ue"] >= ET_CHECK_MIN_UE else 0.0
        errs.append(max(e_t, abs(ev[i] / r["ev_ue"] - 1)) * 100)
    crosscheck = {"n": len(check), "max_err_pct": round(float(max(errs)), 3), "mean_err_pct": round(float(np.mean(errs)), 3)}
    if crosscheck["max_err_pct"] > CROSSCHECK_LIMIT_PCT:
        return {"status": "CROSSCHECK_FAILED", "crosscheck": crosscheck,
                "message": "Surrogate differs from PyMastic by more than 10 %; Monte Carlo withheld."}

    nf, nd = allowable_reps(et, ev, sE1, criterion)
    N = np.minimum(nf, nd) * (1 - damage_used)
    life = N / esal if growth == 0 else np.log1p(N * growth / esal) / math.log1p(growth)
    p10, p50, p90 = np.percentile(life, [10, 50, 90])
    sensitivity = {name: round(spearman(v, life), 3) for name, v in
                   dict(h1=sh1, h2=sh2, E1=sE1, E2=sE2, subgrade_cbr=scbr, traffic=esal).items()}
    return {
        "status": "COMPUTED",
        "condition": "wet" if wet else "dry",
        "n": n,
        "life_years": {"p10": float(p10), "p50": float(p50), "p90": float(p90)},
        "et_ue": {"p10": float(np.percentile(et, 10)), "p50": float(np.median(et)), "p90": float(np.percentile(et, 90))},
        "ev_ue": {"p10": float(np.percentile(ev, 10)), "p50": float(np.median(ev)), "p90": float(np.percentile(ev, 90))},
        "governing": "fatigue" if np.median(nf) < np.median(nd) else "rutting",
        "sensitivity_spearman": sensitivity,
        "share_out_of_domain": round(share_out, 4),
        "solved_exact": solved_exact,
        "crosscheck": crosscheck,
    }
