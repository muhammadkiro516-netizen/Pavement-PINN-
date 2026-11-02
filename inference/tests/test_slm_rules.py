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


class _FakeSlm:
    def __init__(self, text):
        self.text = text

    def generate(self, prompt, max_new_tokens=320, system=None):
        return {"text": self.text}


BRIEF_VALUES = {"BARU": "6", "LEWAT": "2", "DIPERBAIKI": "5", "GAGAL": "1"}


def test_briefing_numbers_come_only_from_the_code():
    from app.slm import briefing
    out = briefing(BRIEF_VALUES, _FakeSlm("Dahulukan kasus yang sudah lewat tenggat sebelum kasus baru."))
    assert out["source"] == "SLM"
    assert "6 kasus baru" in out["text"] and "2 kasus lewat tenggat" in out["text"]
    assert out["text"].endswith("sebelum kasus baru.")


def test_briefing_drops_advice_with_a_number_or_an_accusation():
    from app.slm import briefing
    for bad in ("Dahulukan 9 kasus yang paling lama menunggu hari ini.", "Petugas lalai, jadi perlu ditindak hari ini juga.", "Dahulukan {LEWAT} kasus yang lewat tenggat."):
        out = briefing(BRIEF_VALUES, _FakeSlm(bad))
        assert out["source"] == "TEMPLAT" and "6 kasus baru" in out["text"] and bad not in out["text"]
    assert briefing(BRIEF_VALUES, None)["source"] == "TEMPLAT"


def test_briefing_never_claims_what_is_not_there():
    from app.slm import briefing
    zero = {"BARU": "0", "LEWAT": "0", "DIPERBAIKI": "0", "GAGAL": "0"}
    assert briefing(zero, _FakeSlm("Dahulukan pekerjaan yang paling mendesak hari ini."))["source"] == "TEMPLAT"
    some = {"BARU": "3", "LEWAT": "0", "DIPERBAIKI": "0", "GAGAL": "0"}
    assert briefing(some, _FakeSlm("Perbaikan yang rusak lagi perlu didahulukan hari ini."))["source"] == "TEMPLAT"
    assert briefing(some, _FakeSlm("Periksa dan tugaskan kasus baru pagi ini."))["source"] == "SLM"
