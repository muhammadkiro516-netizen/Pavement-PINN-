"""One structural decision for a road section (POST /v1/decide): what the damage means, what the
traffic really does to it, how long it lasts, and which treatment is not wasted money.

Pure functions, injectable strain solver (tests use a stub; the API uses PyMastic MLET):

  damage_from_distress  observed distress -> effective asphalt modulus (AASHTO 1993 Part III,
                        Table 5.2 layer coefficients; E ratio = (a / 0.375)^3, ASSUMED)
  vdf / esal_day        vehicle counts per Bina Marga class -> ESAL/day, normal vs overloaded
                        (fourth-power law per axle-group standard load, MDPJ 2017 practice)
  seasonal_N            Miner's rule over a year with f wet months (subgrade soaked)
  life_years            remaining life from allowable repetitions (Miner, with growth)
  overlay_scan          smallest overlay meeting the target life (3-layer MLET, discrete mm)
  decide                orchestration + plain-language verdict

Everything here is an indicative engineering estimate, not a design: official overlay design in
Indonesia uses deflection testing. Every assumption is listed in the response.
"""
from __future__ import annotations

import json
import math
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

from .mlet import allowable_reps, life_index_years

DATA = Path(__file__).resolve().parent / "data"
VEHICLES = json.loads((DATA / "vehicle_classes_bm.json").read_text(encoding="utf-8"))
POLICY = json.loads((DATA / "decide_policy.json").read_text(encoding="utf-8"))

# AASHTO 1993 Part III Table 5.2: structural layer coefficient of an existing AC surface by
# condition (midpoints of the published ranges).
AASHTO_CONDITION = [
    ("baik sekali", 0.375),
    ("baik", 0.30),
    ("sedang", 0.25),
    ("buruk", 0.17),
    ("sangat buruk", 0.115),
]

StrainFn = Callable[..., dict]  # signature of mlet.mlet_strains


@dataclass
class Structure:
    h_mm: list[float]   # bound/base layers, top first
    E_mpa: list[float]  # one per layer + subgrade
    nu: list[float]     # one per layer + subgrade
    et_layer: int = 0


# ------------------------------------------------------------------ distress -> modulus

def condition_from_distress(alligator_pct: float, severity: str, transverse_pct: float) -> int:
    """Index into AASHTO_CONDITION from observed distress (lane-area %, severity LOW/MEDIUM/HIGH)."""
    sev = severity.upper()
    if (alligator_pct > 10 and sev == "HIGH") or (transverse_pct > 10 and sev == "HIGH"):
        return 4
    if (alligator_pct > 10 and sev == "MEDIUM") or (alligator_pct > 0 and sev == "HIGH") or transverse_pct > 10:
        return 3
    if alligator_pct > 10 or (alligator_pct > 0 and sev == "MEDIUM") or transverse_pct > 5:
        return 2
    if alligator_pct > 0 or transverse_pct > 0:
        return 1
    return 0


def damage_from_distress(alligator_pct: float, severity: str = "LOW", transverse_pct: float = 0.0) -> dict:
    i = condition_from_distress(alligator_pct, severity, transverse_pct)
    label, a = AASHTO_CONDITION[i]
    ratio = (a / AASHTO_CONDITION[0][1]) ** 3
    d = min(0.85, max(0.0, 1.0 - ratio))
    return {"condition": label, "layer_coefficient": a, "modulus_ratio": round(1.0 - d, 4), "damage": round(d, 4)}


# ------------------------------------------------------------------ traffic

def vdf(groups: list[str], loads_t: list[float]) -> float:
    std = VEHICLES["standard_loads_t"]
    return sum((p / std[g]) ** 4 for g, p in zip(groups, loads_t))


def esal_day(counts: dict[str, float], odol_share: float, direction_factor: float = 0.5, lane_factor: float = 1.0) -> dict:
    rows, total, total_normal = [], 0.0, 0.0
    for code, n in counts.items():
        cls = VEHICLES["classes"].get(code)
        if cls is None or n <= 0:
            continue
        v_n = vdf(cls["groups"], cls["normal"])
        v_a = vdf(cls["groups"], cls["actual"])
        v_mix = (1 - odol_share) * v_n + odol_share * v_a
        e = n * v_mix * direction_factor * lane_factor
        rows.append({"code": code, "name": cls["name"], "per_day": n, "vdf_normal": round(v_n, 3), "vdf_actual": round(v_a, 3), "esal_day": round(e, 2)})
        total += e
        total_normal += n * v_n * direction_factor * lane_factor
    return {"rows": rows, "esal_day": round(total, 2), "esal_day_if_legal": round(total_normal, 2),
            "odol_extra_pct": round((total / total_normal - 1) * 100, 1) if total_normal > 0 else 0.0}


# ------------------------------------------------------------------ life

def seasonal_N(n_dry: float, n_wet: float, wet_fraction: float) -> float:
    """Miner over a year: a fraction f of the load passes falls on a soaked subgrade."""
    f = min(1.0, max(0.0, wet_fraction))
    return 1.0 / ((1 - f) / n_dry + f / n_wet)


def life_years(n_allow: float, esal_per_year: float, growth: float) -> float:
    return life_index_years(n_allow, esal_per_year, growth, 0.0)


def allowable(strains: dict, e1: float, criterion: str) -> tuple[float, float, str]:
    nf, nd = allowable_reps(strains["et_ue"], strains["ev_ue"], e1, criterion)
    return float(nf), float(nd), ("fatigue" if nf <= nd else "rutting")


# ------------------------------------------------------------------ orchestration

def decide(req: dict, strain_fn: StrainFn) -> dict:
    """req keys: layers [{h_mm, E_mpa, nu}] (asphalt first, 1-2 layers), subgrade {cbr, soaked_factor},
    distress {source, alligator_pct, severity, transverse_pct} | None, counts {class: veh/day} | None,
    esal_day | None, odol_share, growth, wet_months, target_years, criterion, axle_t, odol_axle_t."""
    assumptions: list[str] = []
    warnings: list[str] = []
    crit = req.get("criterion", "AI")
    layers = req["layers"]
    E0 = layers[0]["E_mpa"]
    cbr = req["subgrade"]["cbr"]
    soak = req["subgrade"].get("soaked_factor", 0.5)
    E_sub_dry, E_sub_wet = 10.0 * cbr, 10.0 * cbr * soak
    assumptions.append("Modulus tanah dasar = 10 x CBR (MPa); musim hujan: CBR x faktor rendaman.")

    # 1. damage -> effective modulus
    dist = req.get("distress")
    if dist:
        dmg = damage_from_distress(dist.get("alligator_pct", 0), dist.get("severity", "LOW"), dist.get("transverse_pct", 0))
        if dist.get("source") != "INSPECTION":
            warnings.append("Kerusakan diambil dari foto (perkiraan visual); ukur di lokasi untuk hasil yang menentukan.")
    else:
        dmg = {"condition": "tidak diketahui", "layer_coefficient": None, "modulus_ratio": 1.0, "damage": 0.0}
    E_eff = E0 * dmg["modulus_ratio"]
    assumptions.append("Modulus aspal rusak dari koefisien lapis AASHTO 1993 (Tabel 5.2); rasio modulus = (a/0,375)^3.")

    # 2. traffic
    growth = req.get("growth", 0.04)
    odol_share = req.get("odol_share", 0.0)
    if req.get("counts"):
        traffic = esal_day(req["counts"], odol_share, req.get("direction_factor", 0.5), req.get("lane_factor", 1.0))
        assumptions.append("Beban sumbu per golongan: nilai tipikal (ASUMSI) di vehicle_classes_bm.json; VDF dengan hukum pangkat empat per kelompok sumbu.")
    elif req.get("esal_day"):
        traffic = {"rows": [], "esal_day": float(req["esal_day"]), "esal_day_if_legal": None, "odol_extra_pct": None}
    else:
        traffic = None
        warnings.append("Tanpa data lalu lintas: umur sisa tidak dihitung, hanya perbandingan kekuatan.")
    esal_year = traffic["esal_day"] * 365 if traffic else None

    def structure(h, E_layers, E_sub, et_layer=0):
        nus = [lay.get("nu", 0.35) for lay in layers]
        nus = (nus + [0.35] * len(h))[: len(h)]
        return Structure(h, E_layers + [E_sub], nus + [0.45], et_layer)

    def solve(st: Structure, axle, q=0.55):
        return strain_fn(axle, st.h_mm, st.E_mpa, st.nu, q_mpa=q, tyres_per_axle=4, dual_spacing_mm=330, et_layer=st.et_layer,
                         allow_compressive_et=True)

    h = [lay["h_mm"] for lay in layers]
    E_layers = [E_eff] + [lay["E_mpa"] for lay in layers[1:]]
    axle = req.get("axle_t", 8.16)

    # 3. base, wet, seasonal
    s_dry = solve(structure(h, E_layers, E_sub_dry), axle)
    s_wet = solve(structure(h, E_layers, E_sub_wet), axle)
    nf_d, nd_d, gov = allowable(s_dry, E_eff, crit)
    nf_w, nd_w, gov_w = allowable(s_wet, E_eff, crit)
    n_dry, n_wet = min(nf_d, nd_d), min(nf_w, nd_w)
    f = req.get("wet_months", 6) / 12
    n_season = seasonal_N(n_dry, n_wet, f)
    life = None
    if esal_year:
        life = {
            "dry_years": round(life_years(n_dry, esal_year, growth), 2),
            "seasonal_years": round(life_years(n_season, esal_year, growth), 2),
            "wet_season_loss_pct": round((1 - n_season / n_dry) * 100, 1),
        }

    # 4. overloading from strains (not only the fourth-power rule)
    odol_axle = req.get("odol_axle_t", 13.0)
    odol_q = req.get("odol_tyre_mpa", 0.70)
    s_odol = solve(structure(h, E_layers, E_sub_dry), odol_axle, odol_q)
    assumptions.append(f"Truk ODOL: gandar {odol_axle:g} t dengan tekanan ban {odol_q:g} MPa (ban dipompa lebih keras untuk muatan berlebih); truk sesuai aturan 0,55 MPa.")
    nf_o, nd_o, _ = allowable(s_odol, E_eff, crit)
    tension = s_dry["et_ue"] > 1 and s_odol["et_ue"] > 1  # fatigue only matters when the asphalt bottom is in tension
    odol = {"axle_t": odol_axle, "legal_axle_t": axle, "tyre_mpa": odol_q, "fatigue_factor": round(nf_d / nf_o, 2) if tension else None, "rutting_factor": round(nd_d / nd_o, 2),
            "fourth_power": round((odol_axle / axle) ** 4, 2)}

    # 5. overlay scan (3 layers: overlay, damaged asphalt, base) and reconstruction
    target = req.get("target_years", 10)
    E_ov = POLICY["overlay_E_mpa"]
    candidates = []
    chosen = None
    for h_ov in POLICY["overlay_candidates_mm"]:
        if h_ov == 0:
            hh, EE, et_layer = h, E_layers, 0
        else:
            hh, EE, et_layer = [h_ov] + h, [E_ov] + E_layers, 1
        sd = solve(structure(hh, EE, E_sub_dry, et_layer), axle)
        sw = solve(structure(hh, EE, E_sub_wet, et_layer), axle)
        e_crit = EE[et_layer]
        n_c = seasonal_N(min(allowable(sd, e_crit, crit)[:2]), min(allowable(sw, e_crit, crit)[:2]), f)
        yrs = round(life_years(n_c, esal_year, growth), 2) if esal_year else None
        row = {"h_mm": h_ov, "N": round(n_c), "life_years": yrs, "strength_gain": round(n_c / n_season, 2)}
        candidates.append(row)
        if chosen is None and yrs is not None and yrs >= target:
            chosen = row
    rec = POLICY["reconstruction"]
    E_base_rec = max([e for e in E_layers[1:]] + [rec["base_min_E_mpa"]])
    rec_rows = []
    n_rec, rec_choice = None, None
    for h_ac, h_base in rec["candidates_mm"]:
        h_rec, E_rec = [h_ac, h_base], [rec["asphalt_E_mpa"], E_base_rec]
        rd = solve(structure(h_rec, E_rec, E_sub_dry), axle)
        rw = solve(structure(h_rec, E_rec, E_sub_wet), axle)
        n_r = seasonal_N(min(allowable(rd, E_rec[0], crit)[:2]), min(allowable(rw, E_rec[0], crit)[:2]), f)
        yrs = round(life_years(n_r, esal_year, growth), 2) if esal_year else None
        rec_rows.append({"asphalt_mm": h_ac, "base_mm": h_base, "N": round(n_r), "life_years": yrs})
        n_rec, rec_choice = n_r, (h_ac, h_base)
        if yrs is not None and yrs >= target:
            break
    assumptions.append(f"Overlay AC modulus {E_ov} MPa, terikat penuh; rekonstruksi: aspal baru {rec['asphalt_E_mpa']} MPa di atas pondasi {E_base_rec:g} MPa, tebal terkecil yang memenuhi target dari daftar kandidat.")

    def opt(code, title, n, h_mm=None):
        yrs = round(life_years(n, esal_year, growth), 2) if esal_year else None
        return {"code": code, "title": title, "h_mm": h_mm, "N": round(n), "strength_gain": round(n / n_season, 2),
                "life_years": yrs, "meets_target": (yrs is not None and yrs >= target)}

    options = [opt("RUTIN", "Tambal / pemeliharaan rutin", n_season)]
    best_overlay = chosen or max(candidates[1:], key=lambda r: r["N"])
    options.append(opt("BERKALA", f"Overlay {best_overlay['h_mm'] / 10:g} cm", best_overlay["N"], best_overlay["h_mm"]))
    options.append(opt("REKONSTRUKSI", f"Rekonstruksi (aspal {rec_choice[0] / 10:g} cm + pondasi {rec_choice[1] / 10:g} cm)", n_rec))

    # 6. verdict
    structural = gov == "rutting" or dmg["damage"] >= POLICY["structural_damage_threshold"] or (life is not None and life["seasonal_years"] < 0.3 * target)
    if not structural:
        advice = "RUTIN"
    elif chosen is not None and chosen["h_mm"] <= POLICY["max_overlay_for_periodic_mm"]:
        advice = "BERKALA"
    else:
        advice = "REKONSTRUKSI"

    return {
        "modulus": {"E0_mpa": E0, "E_eff_mpa": round(E_eff, 1), **dmg, "source": (dist or {}).get("source", "NONE")},
        "traffic": traffic,
        "structure": {"et_ue": round(s_dry["et_ue"], 1), "ev_ue": round(s_dry["ev_ue"], 1), "nf": nf_d, "nd": nd_d, "governing": gov,
                      "N_dry": round(n_dry), "N_wet": round(n_wet), "N_seasonal": round(n_season)},
        "remaining_life": life,
        "odol": odol,
        "overlay": {"target_years": target, "h_mm": chosen["h_mm"] if chosen else None, "candidates": candidates},
        "reconstruction": {"candidates": rec_rows},
        "options": options,
        "verdict": {"structural": structural, "governing": gov, "advice": advice},
        "assumptions": assumptions,
        "warnings": warnings,
        "label": "Perkiraan indikatif berbasis fisika (MLET), bukan desain resmi; desain overlay resmi memakai uji lendutan.",
    }
