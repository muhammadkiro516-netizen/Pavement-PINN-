"""Module D1/D3 of Dokumen Induk v3: layered-elastic strains (MLET via PyMastic),
transfer functions and the indicative structural life index.

Ported from docs/v3/_build/reference_code/pavement_core.py. Units: lengths mm,
moduli MPa, pressure MPa, axle loads tonnes, strains microstrain.
"""
from __future__ import annotations

import math

import numpy as np

from vendor.pymastic import PYMASTIC_COMMIT, PyMastic

STANDARD_AXLE_TON = 8.16  # 80 kN standard axle; same constant as src/domain/intelligence/esal.ts
PYMASTIC_ITERATION = 20  # 40 returns NaN for thick structures (v3 Lampiran B)
METHOD = f"PyMastic@{PYMASTIC_COMMIT[:7]}"


FALLBACK_ITERATIONS = (15, 12, 10, 8, 6, 5, 4, 3)


def _pymastic(q_kpa, xs, zs, hs, E, nu):
    """PyMastic with the project's iteration count; when that overflows (small contact radius
    against thick layers, e.g. a motorcycle tyre), retry with fewer series terms and accept the
    result only if two consecutive iteration counts agree within 0.5 % (converged)."""
    def run(it):
        with np.errstate(all="ignore"):
            return PyMastic(q_kpa, 1.0, xs, zs, hs, E, nu, 7e-7, isBounded=[1] * len(hs), iteration=it, inverser="solve")

    def finite(r):
        return all(np.all(np.isfinite(r[k])) for k in ("Strain_R", "Strain_Z", "Stress_Z"))

    rs = run(PYMASTIC_ITERATION)
    if finite(rs):
        return rs
    prev = None
    for it in FALLBACK_ITERATIONS:
        cur = run(it)
        if not finite(cur):
            prev = None
            continue
        if prev is not None:
            a, b = prev["Strain_Z"], cur["Strain_Z"]
            if np.all(np.abs(a - b) <= 5e-3 * np.maximum(np.abs(a), 1e-12)):
                return prev
        prev = cur
    return rs  # still non-finite: the caller raises


def mlet_strains(axle_t: float, h_mm: list[float], E_mpa: list[float], nu: list[float],
                 q_mpa: float = 0.55, tyres_per_axle: int = 4,
                 dual_spacing_mm: float | None = None, et_layer: int = 0,
                 allow_compressive_et: bool = False) -> dict:
    """Critical strains for one axle: et = horizontal tensile strain at the bottom of bound layer
    `et_layer` (0 = the asphalt; 1 = the old asphalt under an overlay), ev = vertical compressive
    strain at the top of the subgrade (both positive).
    With dual_spacing_mm, strains are superposed at x = 0, d/2, d and the maximum is taken."""
    if not (len(E_mpa) == len(nu) == len(h_mm) + 1):
        raise ValueError("E and nu need one entry per layer including the subgrade")
    if axle_t <= 0 or min(h_mm) <= 0 or min(E_mpa) <= 0:
        raise ValueError("load, thickness and moduli must be positive")
    wheel_n = axle_t * 9.80665e3 / tyres_per_axle
    a = math.sqrt(wheel_n / (math.pi * q_mpa))  # contact radius, mm
    s = a  # lengths are normalised by a for numerical stability
    if not 0 <= et_layer < len(h_mm):
        raise ValueError("et_layer must point at one of the layers above the subgrade")
    z_t = (sum(h_mm[: et_layer + 1]) - 0.01) / s
    z_v = (sum(h_mm) + 0.01) / s
    xs = [0.0] if dual_spacing_mm is None else [0.0, dual_spacing_mm / (2 * s), dual_spacing_mm / s]
    # PyMastic multiplies E by 1000 internally, so q goes in kPa when E is in MPa.
    rs = _pymastic(q_mpa * 1000.0, xs, [z_t, z_v], [h / s for h in h_mm], list(E_mpa), list(nu))
    er, ez = rs["Strain_R"], rs["Strain_Z"]  # compression positive
    if dual_spacing_mm is None:
        et, ev = -er[0, 0], ez[1, 0]
    else:
        et = max(-(er[0, 0] + er[0, 2]), -2 * er[0, 1])
        ev = max(ez[1, 0] + ez[1, 2], 2 * ez[1, 1])
    if not (np.isfinite(et) and np.isfinite(ev)) or ev <= 0:
        raise ArithmeticError("MLET returned a non-finite or non-positive strain")
    if et <= 0:
        # The bottom of this layer is in compression (e.g. a soft old layer under a stiff overlay):
        # fatigue there is not critical. Only accepted when the caller says so.
        if not allow_compressive_et:
            raise ArithmeticError("MLET returned a non-finite or non-positive strain")
        et = 1e-9  # 0.001 microstrain: fatigue life effectively unlimited, rutting governs
    return {"et_ue": float(et * 1e6), "ev_ue": float(ev * 1e6), "a_mm": float(a)}


def allowable_reps(et_ue, ev_ue, e1_mpa, criterion: str = "AI",
                   binder_volume_pct: float = 11.0):
    """Allowable standard-axle repetitions to fatigue (Nf) and subgrade rutting (Nd).
    AI = Asphalt Institute (1982) as given in Huang, Pavement Analysis and Design.
    AUS = Austroads (2004) form; constants must be checked against the edition cited."""
    if criterion == "AI":
        e_psi = e1_mpa * 145.0377
        nf = 0.0796 * (et_ue * 1e-6) ** -3.291 * e_psi ** -0.854
        nd = 1.365e-9 * (ev_ue * 1e-6) ** -4.477
    elif criterion == "AUS":
        nf = (6918 * (0.856 * binder_volume_pct + 1.08) / (e1_mpa ** 0.36 * et_ue)) ** 5
        nd = (9300.0 / ev_ue) ** 7
    else:
        raise ValueError(criterion)
    return nf, nd  # scalars or numpy arrays (Monte Carlo)


def life_index_years(n_allow: float, esal_per_year: float, growth: float, damage_used: float) -> float:
    """Years until cumulative ESAL consumes the remaining allowable repetitions (Miner's rule)
    with geometric traffic growth. Indicative; for comparing segments, not predicting dates."""
    n = n_allow * max(0.0, 1.0 - damage_used)
    if growth == 0:
        return n / esal_per_year
    return math.log(1 + n * growth / esal_per_year) / math.log(1 + growth)


def mlet_field_grid(axle_t: float, h_mm: list[float], E_mpa: list[float], nu: list[float],
                    q_mpa: float = 0.55, tyres_per_axle: int = 4, dual_spacing_mm: float | None = None,
                    x_mm: list[float] | None = None, z_mm: list[float] | None = None) -> dict:
    """Strain/stress field on the vertical plane through the wheel centres (y = 0), from the
    same PyMastic solver as mlet_strains. Wheels sit at x = ±d/2 (dual) or x = 0 (single).
    On that line the radial direction of every wheel is ±x, so εxx = Σ εr(|x − xi|) and
    εzz, σzz superpose directly. Tension positive for εxx; compression positive for εzz, σzz."""
    if not (len(E_mpa) == len(nu) == len(h_mm) + 1):
        raise ValueError("E and nu need one entry per layer including the subgrade")
    x_mm = x_mm if x_mm is not None else [float(v) for v in np.arange(-800, 801, 50)]
    z_mm = z_mm if z_mm is not None else [float(v) for v in np.arange(10, 801, 25)]
    wheel_n = axle_t * 9.80665e3 / tyres_per_axle
    a = math.sqrt(wheel_n / (math.pi * q_mpa))
    wheels = [0.0] if dual_spacing_mm is None else [-dual_spacing_mm / 2, dual_spacing_mm / 2]
    # Keep evaluation depths off the layer interfaces, where the solution is two-valued.
    interfaces = np.cumsum(h_mm)
    zs = [z + 0.01 if np.any(np.isclose(z, interfaces)) else z for z in z_mm]
    radii = sorted({round(abs(x - w), 6) for x in x_mm for w in wheels})
    # One solver call per radius: PyMastic sizes its Hankel integration from the largest radius
    # in a call, so batching far points with near ones degrades the near-wheel values.
    cols = []
    for r in radii:
        rs = _pymastic(q_mpa * 1000.0, [r / a], [z / a for z in zs], [h / a for h in h_mm], list(E_mpa), list(nu))
        cols.append((rs["Strain_R"][:, 0], rs["Strain_Z"][:, 0], rs["Stress_Z"][:, 0]))
    idx = {r: i for i, r in enumerate(radii)}
    er = np.stack([c[0] for c in cols], axis=1)
    ez = np.stack([c[1] for c in cols], axis=1)
    sz = np.stack([c[2] for c in cols], axis=1)

    def field(arr, sign, scale):
        out = []
        for zi in range(len(zs)):
            row = []
            for x in x_mm:
                v = sum(arr[zi, idx[round(abs(x - w), 6)]] for w in wheels) * sign * scale
                row.append(float(v) if np.isfinite(v) else None)
            out.append(row)
        return out

    return {
        "x_mm": x_mm, "z_mm": list(zs), "wheels_x_mm": wheels, "interfaces_mm": [float(v) for v in interfaces],
        "eps_xx": {"unit": "µε", "values": field(er, -1.0, 1e6)},
        "eps_zz": {"unit": "µε", "values": field(ez, 1.0, 1e6)},
        # PyMastic returns stress in the input pressure unit (kPa here); report MPa.
        "sigma_zz": {"unit": "MPa", "values": field(sz, 1.0, 1e-3)},
        "method": METHOD,
    }
