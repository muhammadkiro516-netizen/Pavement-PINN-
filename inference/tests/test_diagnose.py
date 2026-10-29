"""PINN-2 diagnosis (SPEC M5.1): deterministic, ordered percentiles, observations move the posterior."""
import numpy as np
import pytest

from app.diagnose import diagnose


def stub(h1, h2, E1, E2, E3, axle_t, q, d):
    # Monotone, physically-signed stand-in for the surrogate: thicker/stiffer -> smaller strains.
    et = 120.0 * (100.0 / h1) ** 1.2 * (3000.0 / E1) ** 0.5 * (axle_t / 8.16)
    ev = 250.0 * (450.0 / (h1 + h2)) ** 1.5 * (40.0 / E3) ** 0.7 * (axle_t / 8.16)
    return et, ev, {"surrogate": 0, "pymastic": 0, "stub": len(h1)}


BASE = {"segment_id": "SEG-T", "road_class": "KABUPATEN", "esal_year": 150_000, "growth": 0.035, "wet_months": 5}


def test_deterministic_and_ordered():
    a, b = diagnose(BASE, stub), diagnose(BASE, stub)
    assert a == b
    r = a["remaining_life_years"]
    assert r["p10"] <= r["p50"] <= r["p90"]
    assert a["prior"]["source"] == "ASUMSI"
    assert a["label"] == "AI_PERKIRAAN"
    assert a["verdict"] in ("RED", "YELLOW", "GREEN")


def test_observed_alligator_cracking_lowers_remaining_life():
    light = {**BASE, "esal_year": 40_000}
    seen = diagnose({**light, "observations": {"alligator": True, "years_since_overlay": 6}}, stub)
    clean = diagnose({**light, "observations": {"alligator": False, "years_since_overlay": 6}}, stub)
    assert seen["remaining_life_years"]["p50"] < clean["remaining_life_years"]["p50"]
    assert any("retak buaya ada" in u for u in seen["observations_used"])


def test_cracking_without_age_is_not_used_for_weighting():
    out = diagnose({**BASE, "observations": {"alligator": True}}, stub)
    assert out["effective_samples"] == pytest.approx(out["samples"])
    assert any("tidak dipakai" in u for u in out["observations_used"])


def test_measured_prior_narrows_the_range_and_is_labelled():
    measured = diagnose({**BASE, "prior": {"h1": 50, "h2": 200, "E1": 2500, "E2": 200, "cbr": 4}}, stub)
    assumed = diagnose(BASE, stub)
    w = lambda o: o["remaining_life_years"]["p90"] - o["remaining_life_years"]["p10"]
    assert measured["prior"]["source"] == "DARI_INPUT"
    assert w(measured) < w(assumed)


def test_more_wet_months_never_increase_life():
    dry = diagnose({**BASE, "wet_months": 0}, stub)["remaining_life_years"]["p50"]
    wet = diagnose({**BASE, "wet_months": 8}, stub)["remaining_life_years"]["p50"]
    assert wet <= dry


def test_heavy_traffic_on_a_thin_road_is_red():
    out = diagnose({**BASE, "esal_year": 3_000_000, "prior": {"h1": 40, "h2": 150, "E1": 2000, "E2": 150, "cbr": 3}}, stub)
    assert out["verdict"] == "RED"
    assert out["title"] == "Perlu lapis ulang"


def test_rejects_non_positive_traffic():
    with pytest.raises(ValueError):
        diagnose({**BASE, "esal_year": 0}, stub)
