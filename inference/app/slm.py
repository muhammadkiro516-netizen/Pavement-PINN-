"""SPEC M7: draft "Usulan Penanganan Ruas" with a small language model on OpenVINO GenAI.

Rules that keep the draft honest:
  * the SLM receives qualitative facts only and writes prose; it must not write any digit;
  * every number is inserted by code through whitelisted placeholders ({SISA_UMUR}, ...);
  * the output must pass check(): no digits, no banned words, only known placeholders, length;
  * two failed attempts -> a fixed template is used and the draft says so.
Device order NPU -> GPU -> CPU; the device actually used is reported with the timings.
"""
from __future__ import annotations

import os
import re
import threading
import time
from functools import lru_cache
from pathlib import Path

MODEL_DIR = Path(os.environ.get("SLM_DIR", Path(__file__).resolve().parents[2] / "models" / "slm" / "qwen2.5-1.5b-instruct-int4-ov"))
DEVICE_ORDER = [d.strip() for d in os.environ.get("SLM_DEVICES", "NPU,GPU,CPU").split(",") if d.strip()]
PLACEHOLDERS = ("{RUAS}", "{INSTANSI}", "{SISA_UMUR}", "{BERULANG}", "{LAPORAN_TERBUKA}", "{BIAYA_WAJAR}")
BANNED = [r"korup", r"mark-?up", r"nakal", r"lalai", r"maling", r"penipu", r"pungli", r"bohong", r"bodoh"]

SYSTEM = (
    "Anda membantu insinyur dinas menulis draf usulan penanganan jalan. Tulis dalam bahasa Indonesia formal dan netral. "
    "ATURAN: jangan menulis angka atau digit apa pun; untuk nilai gunakan placeholder persis seperti diberikan "
    "({RUAS}, {INSTANSI}, {SISA_UMUR}, {BERULANG}, {LAPORAN_TERBUKA}, {BIAYA_WAJAR}). Jangan menyebut nama orang, "
    "jangan menuduh siapa pun, jangan mengarang fakta yang tidak diberikan. Jangan menilai nilai dengan kata-kata "
    "(misalnya 'masih cukup' atau 'tinggi'); tulis placeholder-nya saja dan biarkan pembaca menilai. Tulis dua paragraf singkat "
    "tanpa judul dan tanpa daftar butir, jangan mengulang daftar fakta, total paling banyak delapan kalimat: "
    "(1) kondisi dan diagnosis, (2) alasan rekomendasi dan uji teknis yang disarankan."
)


def required(f: dict) -> list[str]:
    """Placeholders the text must use, so every number shown comes from code."""
    req = ["{RUAS}"]
    if f.get("diagnosis"):
        req.append("{SISA_UMUR}")
    if f.get("recurrence_known"):
        req.append("{BERULANG}")
    return req


def trim(text: str) -> str:
    """Drop a sentence cut off by the token limit."""
    text = text.strip()
    if text and text[-1] not in ".!?":
        cut = max(text.rfind(". "), text.rfind(".\n"))
        text = text[: cut + 1] if cut > 0 else text
    return text


def check(text: str, must: list[str] | None = None) -> list[str]:
    """Reasons the SLM text is not acceptable (empty list = accepted)."""
    problems = [f"missing {m}" for m in (must or []) if m not in text]
    if re.search(r"\d", text):
        problems.append("contains digits")
    for b in BANNED:
        if re.search(b, text, re.I):
            problems.append(f"banned word {b}")
    for ph in re.findall(r"\{[A-Z_]+\}", text):
        if ph not in PLACEHOLDERS:
            problems.append(f"unknown placeholder {ph}")
    if not 80 <= len(text) <= 1600:
        problems.append("length")
    if not re.search(r"\buji\b|rekomendasi", text, re.I):
        problems.append("no recommendation")
    if len(re.findall(r"^\s*[-*•]", text, re.M)) >= 3:
        problems.append("list instead of prose")
    return problems


def qualitative(f: dict) -> str:
    """Facts for the prompt without numbers: words and placeholders only."""
    d = f.get("diagnosis") or {}
    lines = [
        "Ruas: {RUAS}. Instansi berwenang: {INSTANSI}.",
        f"Jenis kerusakan yang dilaporkan: {', '.join(f.get('damage_types') or ['belum ada'])}.",
        "Jumlah laporan terbuka: {LAPORAN_TERBUKA}.",
    ]
    if d:
        lines.append(f"Diagnosis PINN: {d.get('title', '-')}, keyakinan {d.get('confidence', '-')}, faktor dominan {d.get('dominant_factor', '-')}. Sisa umur struktur: {{SISA_UMUR}}.")
        if d.get("decision"):
            lines.append(f"Keputusan Koordinator atas diagnosis: {d['decision']}.")
    if f.get("recurrence_known"):
        lines.append("Perbaikan yang rusak lagi dalam tiga bulan: {BERULANG}.")
    if f.get("flags"):
        lines.append("Catatan audit yang perlu klarifikasi: " + "; ".join(f["flags"]) + ".")
    if f.get("fair_cost_known"):
        lines.append("Perkiraan biaya wajar penanganan: {BIAYA_WAJAR}.")
    if f.get("hazard_missing"):
        lines.append("Ada kerusakan berat yang belum diberi rambu peringatan.")
    return "\n".join(lines)


def template(f: dict) -> str:
    d = f.get("diagnosis") or {}
    p1 = ("Ruas {RUAS} yang menjadi kewenangan {INSTANSI} saat ini memiliki {LAPORAN_TERBUKA} laporan kerusakan terbuka. "
          + (f"Diagnosis PINN menyimpulkan \"{d.get('title')}\" dengan faktor dominan {d.get('dominant_factor')}; sisa umur struktur diperkirakan {{SISA_UMUR}}." if d else "Diagnosis struktur belum dijalankan untuk ruas ini."))
    p2 = ("Rekomendasi disusun dari data laporan, inspeksi dan riwayat perbaikan yang tercatat. "
          "Sebelum keputusan akhir, disarankan uji core untuk tebal lapisan, uji DCP tanah dasar, dan pemeriksaan drainase.")
    return f"{p1}\n\n{p2}"


def fill(text: str, values: dict[str, str]) -> str:
    for k, v in values.items():
        text = text.replace("{" + k + "}", v)
    return text


class Slm:
    def __init__(self):
        import openvino as ov
        import openvino_genai as g

        self.g = g
        core = ov.Core()
        available = core.available_devices
        self.pipe, self.device, errors = None, None, {}
        for dev in DEVICE_ORDER:
            if not any(a.startswith(dev) for a in available):
                errors[dev] = "not available"
                continue
            # The GPU/NPU plugins target Intel hardware; on other vendors' iGPUs (e.g. AMD gfx90c via
            # OpenCL) LLM compilation can hang, so only Intel accelerators are tried.
            name = str(core.get_property(dev, "FULL_DEVICE_NAME")) if dev != "CPU" else "CPU"
            if dev != "CPU" and "intel" not in name.lower():
                errors[dev] = f"skipped: non-Intel device ({name})"
                continue
            try:
                self.pipe = g.LLMPipeline(str(MODEL_DIR), dev)
                self.device = dev
                break
            except Exception as exc:  # noqa: BLE001 - try the next device
                errors[dev] = str(exc)[:160]
        if self.pipe is None:
            raise RuntimeError(f"SLM could not start: {errors}")
        self.device_errors = errors
        self.available = available
        self.lock = threading.Lock()

    def generate(self, prompt: str, max_new_tokens: int = 320) -> dict:
        tok = self.pipe.get_tokenizer()
        chat = tok.apply_chat_template([{"role": "system", "content": SYSTEM}, {"role": "user", "content": prompt}], add_generation_prompt=True)
        cfg = self.g.GenerationConfig()
        cfg.max_new_tokens = max_new_tokens
        cfg.do_sample = False
        cfg.apply_chat_template = False
        with self.lock:
            t = time.perf_counter()
            res = self.pipe.generate([chat], cfg)
            elapsed = time.perf_counter() - t
        pm = res.perf_metrics
        return {"text": trim(res.texts[0]), "ttft_ms": round(pm.get_ttft().mean, 1), "tokens_per_s": round(pm.get_throughput().mean, 2), "new_tokens": int(pm.get_num_generated_tokens()), "seconds": round(elapsed, 2)}


@lru_cache(maxsize=1)
def load_slm() -> Slm | None:
    if not (MODEL_DIR / "openvino_model.xml").exists():
        return None
    return Slm()


def draft(facts: dict, values: dict[str, str], slm: Slm | None) -> dict:
    """Two SLM attempts that must pass check(); otherwise the template. Numbers come from `values`."""
    attempts = []
    text, source = None, "TEMPLAT"
    if slm is not None:
        prompt = qualitative(facts)
        for _ in range(2):
            out = slm.generate(prompt)
            problems = check(out["text"], required(facts))
            attempts.append({**{k: out[k] for k in ("ttft_ms", "tokens_per_s", "new_tokens", "seconds")}, "problems": problems})
            if not problems:
                text, source = out["text"], "SLM"
                break
    if text is None:
        text = template(facts)
    return {
        "text": fill(text, values),
        "source": source,
        "attempts": attempts,
        "device": slm.device if slm else None,
        "available_devices": slm.available if slm else None,
        "model": MODEL_DIR.name if slm else None,
        "label": "DRAF — disusun otomatis, wajib ditinjau dan disetujui pejabat berwenang",
    }
