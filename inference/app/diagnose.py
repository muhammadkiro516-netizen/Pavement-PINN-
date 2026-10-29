"""PINN-2 road diagnosis (SPEC M5.1): probabilistic inference over the pavement structure.

The structure under a road is rarely known. We sample N candidate structures from a prior
(project data when entered, otherwise a typical structure for the road class, labelled ASUMSI),
compute their strains with the physics surrogate (PyMastic for samples outside its domain),
and weight each sample by how well it explains what was observed on the road:

  * alligator cracking present / absent, given the age since the last overlay
    P(crack | D) = logistic(ln D / 0.5): 50 % at Miner damage D = 1 (ASUMSI, documented),
  * repairs that failed within 90 days (real repair life, SPEC M2.2): fast failure is more
    likely when the structure consumes a large share of its life per year
    P(fast | a) = logistic(ln(4a) / 0.5), a = yearly damage (ASUMSI, weak evidence).

The weighted samples give the posterior remaining life P10/P50/P90. Everything is seeded per
road segment, so the same inputs always give the same diagnosis.
"""
from __future__ import annotations

import hashlib
import math
from typing import Callable

import numpy as np

from .mlet import allowable_reps

K_CBR = 10.0  # E_subgrade ~ 10 * CBR MPa (Heukelom-Klomp), ASUMSI
SOAKED_FACTOR = 0.5  # CBR when soaked / dry, ASUMSI
N_SAMPLES = 2000

# Typical structures per road class when no project data exists (ASUMSI; editable).
TYPICAL = {
    "NASIONAL": {"h1": 100.0, "h2": 350.0, "E1": 3000.0, "E2": 300.0, "cbr": 6.0},
    "TOL": {"h1": 150.0, "h2": 400.0, "E1": 3500.0, "E2": 350.0, "cbr": 8.0},
    "PROVINSI": {"h1": 70.0, "h2": 300.0, "E1": 2800.0, "E2": 250.0, "cbr": 5.0},
    "KOTA": {"h1": 50.0, "h2": 250.0, "E1": 2500.0, "E2": 200.0, "cbr": 4.0},
    "KABUPATEN": {"h1": 50.0, "h2": 200.0, "E1": 2500.0, "E2": 200.0, "cbr": 4.0},
}

# (et_ue, ev_ue) for arrays of samples; q in MPa, d = dual spacing in mm.
StrainBatch = Callable[[np.ndarray, np.ndarray, np.ndarray, np.ndarray, np.ndarray, float, float, float], tuple[np.ndarray, np.ndarray, dict]]


def _seed(key: str) -> int:
    return int(hashlib.sha256(f"{key}:diagnose-v1".encode()).hexdigest()[:8], 16)


def _logistic(x: np.ndarray) -> np.ndarray:
    return 1.0 / (1.0 + np.exp(-x))


def _wpct(x: np.ndarray, w: np.ndarray, q: list[float]) -> list[float]:
    order = np.argsort(x)
    cw = np.cumsum(w[order])
    cw /= cw[-1]
    return [float(np.interp(p / 100.0, cw, x[order])) for p in q]


def _years(n_remaining: np.ndarray, esal_year: float, growth: float) -> np.ndarray:
    n = np.maximum(n_remaining, 0.0)
    if growth <= 0:
        return n / esal_year
    return np.log1p(n * growth / esal_year) / math.log1p(growth)


def _consumed(age_years: float, esal_year: float, growth: float) -> float:
    if growth <= 0:
        return esal_year * age_years
    return esal_year * ((1 + growth) ** age_years - 1) / growth


def diagnose(req: dict, strains: StrainBatch) -> dict:
    """req: segment_id, road_class, prior {h1,h2,E1,E2,cbr,source} | None, esal_year, growth,
    wet_months, axle_t, q_mpa, dual_spacing_mm, criterion,
    observations {alligator: bool|None, years_since_overlay: float|None,
                  repairs_observed: int, repairs_failed_90d: int, odol_share: float|None}."""
    road_class = req.get("road_class") or "KABUPATEN"
    prior_in = req.get("prior")
    if prior_in:
        prior, prior_label, cv = prior_in, "DARI_INPUT", {"h": 0.10, "E1": 0.20, "E2": 0.25, "cbr": 0.30}
    else:
        prior, prior_label, cv = TYPICAL.get(road_class, TYPICAL["KABUPATEN"]), "ASUMSI", {"h": 0.30, "E1": 0.35, "E2": 0.40, "cbr": 0.45}
    esal_year = float(req["esal_year"])
    if esal_year <= 0:
        raise ValueError("esal_year must be positive")
    growth = float(req.get("growth", 0.035))
    f_wet = min(12, max(0, int(req.get("wet_months", 5)))) / 12.0
    axle_t, q, d = float(req.get("axle_t", 8.16)), float(req.get("q_mpa", 0.55)), float(req.get("dual_spacing_mm", 330.0))
    crit = req.get("criterion", "AI")
    obs = req.get("observations") or {}
    n = int(req.get("n", N_SAMPLES))

    rng = np.random.default_rng(_seed(str(req.get("segment_id", "-"))))
    h1 = np.clip(prior["h1"] * np.exp(rng.normal(0, cv["h"], n)), 25, 400)
    h2 = np.clip(prior["h2"] * np.exp(rng.normal(0, cv["h"], n)), 50, 900)
    E1 = prior["E1"] * np.exp(rng.normal(0, cv["E1"], n))
    E2 = prior["E2"] * np.exp(rng.normal(0, cv["E2"], n))
    cbr = np.clip(prior["cbr"] * np.exp(rng.normal(0, cv["cbr"], n)), 1.0, 40.0)

    et_d, ev_d, info_d = strains(h1, h2, E1, E2, K_CBR * cbr, axle_t, q, d)
    et_w, ev_w, info_w = strains(h1, h2, E1, E2, K_CBR * cbr * SOAKED_FACTOR, axle_t, q, d)
    nf_d, nd_d = allowable_reps(et_d, ev_d, E1, crit)
    nf_w, nd_w = allowable_reps(et_w, ev_w, E1, crit)
    n_dry, n_wet = np.minimum(nf_d, nd_d), np.minimum(nf_w, nd_w)
    N = 1.0 / ((1 - f_wet) / n_dry + f_wet / n_wet)
    with np.errstate(invalid="ignore"):
        fatigue_governs = np.where(f_wet < 0.5, nf_d <= nd_d, nf_w <= nd_w)

    # ---- likelihood of the observations (samples the solver could not evaluate get zero weight)
    valid = np.isfinite(N) & (N > 0)
    N = np.where(valid, N, 1.0)
    w = valid.astype(float)
    used: list[str] = []
    if not valid.all():
        used.append(f"{int((~valid).sum())} dari {n} sampel di luar domain model tidak dipakai")
    age = obs.get("years_since_overlay")
    D = np.zeros(n)
    if age is not None and age >= 0:
        D = _consumed(float(age), esal_year, growth) / N
        if obs.get("alligator") is not None:
            p = _logistic(np.log(np.maximum(D, 1e-9)) / 0.5)
            w *= p if obs["alligator"] else (1 - p)
            used.append(f"retak buaya {'ada' if obs['alligator'] else 'tidak ada'} setelah {age:g} tahun sejak lapis terakhir")
    elif obs.get("alligator") is not None:
        used.append("retak buaya tercatat, tetapi umur sejak lapis terakhir tidak diketahui: tidak dipakai untuk pembobotan")
    k, m = int(obs.get("repairs_failed_90d", 0)), int(obs.get("repairs_observed", 0))
    if m > 0:
        p = np.clip(_logistic(np.log(np.maximum(4 * esal_year / N, 1e-9)) / 0.5), 1e-6, 1 - 1e-6)
        w *= p ** k * (1 - p) ** (m - k)
        used.append(f"{k} dari {m} perbaikan di ruas ini rusak lagi < 90 hari")
    if w.sum() <= 0 or not np.isfinite(w.sum()):
        w = valid.astype(float)
        used.append("observasi tidak cocok dengan struktur mana pun: memakai prior")
    w = w / w.sum()
    ess = float(1.0 / np.sum(w ** 2))

    remaining = _years(N * (1 - np.minimum(D, 1.0)), esal_year, growth)
    p10, p50, p90 = _wpct(remaining, w, [10, 50, 90])

    # ---- plain-language outcome
    if p50 < 2 or (obs.get("alligator") and float(np.sum(w * (D >= 1))) > 0.5):
        verdict, title = "RED", "Perlu lapis ulang"
    elif p50 < 5:
        verdict, title = "YELLOW", "Pantau"
    else:
        verdict, title = "GREEN", "Tambal cukup"
    spread = (p90 + 0.1) / (p10 + 0.1)
    confidence = "tinggi" if ess > 300 and spread < 3 else "sedang" if ess > 100 and spread < 8 else "rendah"

    wet_effect = float(np.nansum(w * np.where(valid, n_wet / np.where(valid, n_dry, 1.0), 0.0)))
    scores = {
        "lelah aspal": float(np.sum(w * fatigue_governs)),
        "tanah dasar basah": (1 - wet_effect) * (f_wet * 2) if f_wet > 0 else 0.0,
        "beban berlebih": float(obs.get("odol_share") or 0) * 2.5,
    }
    if scores["lelah aspal"] < 0.5:
        scores["deformasi tanah dasar"] = 1 - scores.pop("lelah aspal")
    factor = max(scores, key=scores.get)

    reasons = [
        f"Sisa umur struktur diperkirakan {p10:.1f}–{p90:.1f} tahun (median {p50:.1f}).",
        f"Faktor dominan: {factor}.",
        f"Struktur lapisan: {'data proyek/inspeksi' if prior_label == 'DARI_INPUT' else 'struktur khas jalan ' + road_class.lower() + ' (asumsi, belum diukur)'}.",
    ]
    if f_wet > 0:
        reasons.append(f"{round(f_wet * 12)} bulan basah per tahun: saat tanah dasar jenuh, kapasitas turun ke ~{wet_effect * 100:.0f}% dari kondisi kering.")
    if not used:
        reasons.append("Belum ada observasi lapangan untuk mempersempit perkiraan; keyakinan bergantung pada asumsi.")

    return {
        "verdict": verdict,
        "title": title,
        "confidence": confidence,
        "dominant_factor": factor,
        "remaining_life_years": {"p10": round(p10, 2), "p50": round(p50, 2), "p90": round(p90, 2)},
        "reasons": reasons,
        "observations_used": used,
        "effective_samples": round(ess, 1),
        "samples": n,
        "prior": {"source": prior_label, "road_class": road_class, **{k2: float(v) for k2, v in prior.items() if k2 in ("h1", "h2", "E1", "E2", "cbr")}},
        "assumptions": [
            "E tanah dasar = 10 × CBR MPa (ASUMSI)",
            f"CBR saat basah = {SOAKED_FACTOR} × kering (ASUMSI)",
            "P(retak buaya | D) logistik, 50% pada D = 1 (ASUMSI)",
            "Bukti umur tambalan: logistik terhadap kerusakan tahunan (ASUMSI, bukti lemah)",
        ],
        "solver": {"dry": info_d, "wet": info_w},
        "label": "AI_PERKIRAAN",
    }
