"""SPEC M7: the SLM never supplies numbers; bad drafts fall back to the template."""
from app import slm


class FakeSlm:
    device, available = "CPU", ["CPU"]

    def __init__(self, texts):
        self.texts = list(texts)

    def generate(self, prompt):
        return {"text": self.texts.pop(0), "ttft_ms": 1.0, "tokens_per_s": 10.0, "new_tokens": 5, "seconds": 0.1}


FACTS = {"damage_types": ["lubang"], "diagnosis": {"title": "Pantau", "confidence": "sedang", "dominant_factor": "lelah aspal"}, "recurrence_known": True}
VALUES = {"RUAS": "Jl. Uji", "INSTANSI": "Dinas Uji", "SISA_UMUR": "3,1 - 7,4 tahun", "BERULANG": "1 dari 4", "LAPORAN_TERBUKA": "3"}
GOOD = "Ruas {RUAS} perlu dipantau. Sisa umur struktur {SISA_UMUR} dan perbaikan yang rusak lagi {BERULANG}. Disarankan uji core dan DCP sebelum keputusan."


def test_checker_rejects_digits_banned_words_unknown_and_missing_placeholders():
    assert slm.check(GOOD, slm.required(FACTS)) == []
    assert "contains digits" in slm.check(GOOD + " Umur 5 tahun.", [])
    assert any("banned" in p for p in slm.check(GOOD + " Ada indikasi korupsi.", []))
    assert any("unknown placeholder" in p for p in slm.check(GOOD + " {NAMA_KONTRAKTOR}", []))
    assert "missing {SISA_UMUR}" in slm.check("Ruas {RUAS} masih cukup baik untuk beberapa waktu ke depan dan perlu dipantau berkala.", slm.required(FACTS))


def test_numbers_come_from_code_and_bad_drafts_fall_back_to_template():
    out = slm.draft(FACTS, VALUES, FakeSlm([GOOD]))
    assert out["source"] == "SLM" and "3,1 - 7,4 tahun" in out["text"] and "{" not in out["text"]
    bad = "Sisa umur struktur masih cukup, sekitar lima tahun lagi, dan kondisinya relatif baik untuk saat ini."
    out = slm.draft(FACTS, VALUES, FakeSlm([bad, bad]))
    assert out["source"] == "TEMPLAT"
    assert len(out["attempts"]) == 2 and all(a["problems"] for a in out["attempts"])
    assert "3,1 - 7,4 tahun" in out["text"]
    assert slm.draft(FACTS, VALUES, None)["source"] == "TEMPLAT"


def test_a_list_of_facts_without_recommendation_is_rejected():
    listing = "- Ruas: {RUAS}\n- Sisa umur: {SISA_UMUR}\n- Berulang: {BERULANG}\n- Instansi: {INSTANSI}"
    problems = slm.check(listing, slm.required(FACTS))
    assert "no recommendation" in problems and "list instead of prose" in problems


def test_trim_drops_a_cut_sentence():
    assert slm.trim("Kalimat pertama lengkap. Kalimat kedua terpot") == "Kalimat pertama lengkap."
