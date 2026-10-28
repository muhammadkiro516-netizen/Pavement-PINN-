"""Pinned behaviour of the structural decision engine (pure functions + stubbed solver)."""
import math

import pytest

from app import decide as d


def test_vdf_standard_loads_equal_one_and_double_load_is_sixteen():
    assert d.vdf(["STRG"], [8.16]) == pytest.approx(1.0)
    assert d.vdf(["SDRG"], [13.76]) == pytest.approx(1.0)
    assert d.vdf(["STRG"], [16.32]) == pytest.approx(16.0)


def test_overloading_raises_esal_and_reports_the_extra():
    legal = d.esal_day({"6B": 100}, odol_share=0.0)
    odol = d.esal_day({"6B": 100}, odol_share=1.0)
    assert odol["esal_day"] > legal["esal_day"]
    assert odol["odol_extra_pct"] > 0
    assert legal["odol_extra_pct"] == 0


def test_damage_is_monotone_and_clamped():
    vals = [d.damage_from_distress(a, s)["damage"] for a, s in [(0, "LOW"), (5, "LOW"), (20, "LOW"), (20, "MEDIUM"), (40, "HIGH")]]
    assert vals == sorted(vals)
    assert vals[0] == 0 and max(vals) <= 0.85


def test_seasonal_N_limits():
    assert d.seasonal_N(1e6, 2e5, 0) == pytest.approx(1e6)
    assert d.seasonal_N(1e6, 2e5, 1) == pytest.approx(2e5)
    assert 2e5 < d.seasonal_N(1e6, 2e5, 0.5) < 1e6


def _stub(axle_t, h_mm, E_mpa, nu, q_mpa=0.55, tyres_per_axle=4, dual_spacing_mm=330, et_layer=0, allow_compressive_et=False):
    """Strains fall with total stiffness-thickness and rise with load (enough for ordering tests)."""
    stiff = sum(h * (e ** (1 / 3)) for h, e in zip(h_mm, E_mpa)) / 100
    return {"et_ue": 300 * axle_t / 8.16 / stiff * 10, "ev_ue": 500 * axle_t / 8.16 / stiff * 10 / (E_mpa[-1] / 50) ** 0.3, "a_mm": 100}


BASE = {"layers": [{"h_mm": 50, "E_mpa": 2500}, {"h_mm": 200, "E_mpa": 300}], "subgrade": {"cbr": 5}, "counts": {"6B": 300, "7A": 120},
        "odol_share": 0.4, "wet_months": 6, "target_years": 10, "criterion": "AI"}


def test_decide_shape_and_physics_directions():
    out = d.decide(dict(BASE), _stub)
    assert out["remaining_life"]["seasonal_years"] <= out["remaining_life"]["dry_years"]
    assert out["odol"]["fatigue_factor"] > 1 and out["odol"]["fourth_power"] > 1
    gains = [c["strength_gain"] for c in out["overlay"]["candidates"]]
    assert gains == sorted(gains), "thicker overlay never weakens the road"
    codes = [o["code"] for o in out["options"]]
    assert codes == ["RUTIN", "BERKALA", "REKONSTRUKSI"]
    assert out["verdict"]["advice"] in codes


def test_observed_cracking_lowers_the_modulus_and_the_life():
    sound = d.decide(dict(BASE), _stub)
    cracked = d.decide({**BASE, "distress": {"source": "INSPECTION", "alligator_pct": 30, "severity": "HIGH", "transverse_pct": 0}}, _stub)
    assert cracked["modulus"]["E_eff_mpa"] < sound["modulus"]["E_eff_mpa"]
    assert cracked["remaining_life"]["seasonal_years"] < sound["remaining_life"]["seasonal_years"]


def test_no_traffic_means_no_life_but_still_a_comparison():
    out = d.decide({k: v for k, v in BASE.items() if k != "counts"}, _stub)
    assert out["remaining_life"] is None
    assert out["options"][0]["life_years"] is None
    assert out["warnings"]
