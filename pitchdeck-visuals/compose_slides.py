"""Compose pitch-deck slides (1920x1080) from the real screenshots and charts.

  inference/.venv/Scripts/python pitchdeck-visuals/compose_slides.py <journey_dir>

<journey_dir> holds sim-A/ and sim-B/ from the end-to-end simulation (.e2e-tmp/journey.mjs).
Charts come from make_visuals.py in this folder. Output: pitchdeck-visuals/slides/.
"""
from __future__ import annotations

import shutil
import sys
import textwrap
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = Path(__file__).resolve().parent
OUT = HERE / "slides"
W, H = 1920, 1080
BG, PANEL, LINE, TXT, MUTED = (11, 13, 16), (21, 24, 29), (42, 47, 55), (244, 244, 245), (161, 161, 170)
YEL, ORA, BLUE, CYAN, GRN = (255, 214, 10), (255, 107, 44), (76, 141, 255), (56, 189, 248), (43, 214, 123)
ROLE = {"warga": ("WARGA", YEL), "petugas": ("PETUGAS LAPANGAN", BLUE), "koordinator": ("KOORDINATOR", ORA), "sistem": ("AI · OPENVINO", CYAN)}
FONT_DIR = Path("C:/Windows/Fonts")


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    for name in (["segoeuib.ttf", "arialbd.ttf"] if bold else ["segoeui.ttf", "arial.ttf"]):
        if (FONT_DIR / name).exists():
            return ImageFont.truetype(str(FONT_DIR / name), size)
    return ImageFont.load_default()


# Journey steps: file-name key -> (role, title, caption).
STEPS = {
    "warga-peta-sekitar-anda": ("warga", "Peta 'Sekitar Anda'", "Warga membuka aplikasi tanpa daftar. Pavi menandai posisinya; laporan terdekat tampil sebagai gelembung foto."),
    "warga-kamera-ai-langsung": ("warga", "Mulai melapor", "Ambil foto dengan kamera (AI mengenali kerusakan sebelum dipotret) atau pilih dari galeri. Kamera terkunci bila melaju > 10 km/jam."),
    "warga-foto-dipilih": ("warga", "Foto dari lokasi", "Lokasi diambil dari GPS saat itu juga; foto dari galeri format apa pun (HEIC, PNG, JPEG) diterima."),
    "warga-hasil-ai": ("sistem", "Hasil AI dalam hitungan detik", "Jenis, keparahan, dan temuan per kotak deteksi; warga tetap bisa mengoreksi sebelum mengirim."),
    "warga-foto-3-sisi": ("warga", "Foto dari 3 sisi", "Foto dekat + jauh + samping. Tiap foto dianalisis AI sehingga petugas bisa menilai luas & kedalaman sebelum turun ke lokasi."),
    "warga-laporan-terkirim": ("warga", "Laporan terkirim", "Laporan masuk ke instansi yang berwenang atas ruas itu. Warga mendapat kode lacak dan bisa mengawal progresnya."),
    "koordinator-pusat-kendali": ("koordinator", "Pusat Kendali koordinator", "Alur kerja 8 langkah dengan jumlah kasus per langkah, peta kasus berwarna, dan skor respons instansi."),
    "petugas-tugas-saya": ("petugas", "Tugas petugas lapangan", "Penugasan dari koordinator lengkap dengan tenggat. Satu tombol jelas: mulai inspeksi terpandu."),
    "petugas-inspeksi-3-sisi-ai": ("petugas", "Inspeksi terpandu 3 sisi", "Foto jauh, atas + skala, dan samping 45°. Setiap foto langsung dianalisis AI; hasilnya digabung jadi konsensus."),
    "petugas-ukur-di-foto-atas": ("petugas", "Ukur panjang & lebar di foto", "Ketuk dua ujung meteran/A4/KTP sebagai skala, lalu ujung kerusakan. Garis ukur tersimpan sebagai bukti."),
    "petugas-ukur-kedalaman-foto-samping": ("petugas", "Ukur kedalaman di foto samping", "Meteran berdiri di titik terdalam; kedalaman dari beberapa foto dirata-rata dan selisihnya dicek."),
    "petugas-ukuran-dan-catatan": ("petugas", "Ukuran, volume, catatan", "Luas dan volume bahan tambal dihitung otomatis dari ukuran; kasus dikirim ke koordinator dalam satu klik."),
    "koordinator-ringkasan-kasus": ("koordinator", "Ringkasan kasus dari lapangan", "Semua sisi foto, temuan AI per foto, konsensus jenis & keparahan, dan ukuran dalam satu layar."),
    "koordinator-ringkasan-cuaca": ("koordinator", "Cuaca masuk ke keputusan", "Prakiraan hujan 7 hari dan bulan basah setahun dari Open-Meteo: kapan harus tambal darurat dan pasang rambu."),
    "petugas-analisis-overview": ("petugas", "Workspace analisis", "Satu layar per laporan: status, riwayat, dan langkah berikutnya untuk petugas teknik."),
    "petugas-analisis-structure": ("petugas", "Struktur perkerasan", "Lapisan aspal, pondasi, dan tanah dasar beserta sumber datanya; bisa dikoreksi dari pengukuran lapangan."),
    "petugas-analisis-pinn": ("sistem", "Analisis PINN struktural", "Physics-Informed surrogate di OpenVINO: regangan kritis, sisa umur, dan pengaruh truk ODOL dalam milidetik."),
    "petugas-analisis-pinn-hasil": ("sistem", "Hasil PINN di lokasi ini", "Regangan kritis, sisa umur, dan dampak ODOL dari lapisan terukur; bulan basah diisi dari curah hujan Open-Meteo."),
    "petugas-analisis-pinn-keputusan": ("sistem", "Keputusan dari fisika + cuaca", "Bulan musim hujan diisi dari curah hujan terukur di lokasi; opsi penanganan dibandingkan umur yang didapat."),
    "koordinator-spk-terbit": ("koordinator", "Rekomendasi disetujui, SPK terbit", "Kontraktor, nilai, target, dan masa pemeliharaan tercatat. Yang mengusulkan tidak bisa menyetujui sendiri."),
    "koordinator-verifikasi-perbaikan": ("koordinator", "Verifikasi hasil perbaikan", "Foto sebelum-sesudah berdampingan; AI memeriksa foto sesudah apakah kerusakan masih terlihat."),
    "warga-kawal-selesai": ("warga", "Warga melihat hasilnya", "Status 'Selesai' sampai ke pelapor; warga sekitar diminta mengonfirmasi hasil perbaikan."),
    "warga-notifikasi": ("warga", "Notifikasi setiap langkah", "Setiap keputusan instansi beralasan dan tercatat, dan kabarnya sampai ke warga."),
}
SIMS = {"A": "Simulasi 1 · Lubang di Karawang", "B": "Simulasi 2 · Retak & tambalan di Jakarta Timur"}

CHARTS = [
    ("01_dataset_distribusi_input.png", "Dataset fisika dari nol", "19.894 struktur perkerasan disimulasikan solver MLET (PyMastic) dengan sampling Latin Hypercube."),
    ("02_dataset_label_regangan.png", "Label: respons struktur", "Regangan tarik bawah aspal dan tekan tanah dasar, dua penentu umur jalan."),
    ("03_dataset_contoh_baris.png", "Contoh data latih", "Input struktur + beban → output regangan kritis."),
    ("04_training_terminal_log.png", "Training PINN", "6.000 langkah dengan loss data + loss fisika (monotonisitas), log asli dari run di laptop tim."),
    ("05_training_loss_curve.png", "Kurva loss", "Loss validasi turun stabil; loss fisika tetap kecil sepanjang training."),
    ("06_training_ablation_physics.png", "Kenapa physics-informed", "Akurasi setara MLP biasa, tetapi jauh lebih patuh hukum fisika."),
    ("07_evaluasi_parity_plot.png", "Akurat pada data yang belum pernah dilihat", "Prediksi vs solver fisika pada 3.979 struktur uji."),
    ("08_evaluasi_distribusi_galat.png", "Distribusi galat", "Sebagian besar prediksi di bawah 2% dari solver."),
    ("09_kecepatan_pinn_vs_solver.png", "Ribuan kali lebih cepat", "Cukup cepat untuk Monte Carlo sisa umur langsung di aplikasi."),
    ("10_openvino_latensi_presisi.png", "Intel OpenVINO: FP32 → INT8", "Kuantisasi NNCF mempercepat deteksi kerusakan hampir 2× di CPU."),
    ("12_cv_scene_probabilitas.png", "Pemahaman scene 11 jenis kerusakan", "CLIP INT8 mengenali genangan, amblas, alur roda, tambalan, dan lainnya."),
    ("13_cv_pipeline_waktu.png", "Waktu pipeline AI per foto", "Dari unggah sampai hasil dalam waktu kurang dari satu detik di CPU."),
    ("18_cuaca_open_meteo_bulan_basah.png", "Cuaca nyata untuk PINN", "Curah hujan 12 bulan terakhir (Open-Meteo ERA5) menentukan bulan basah di lokasi."),
    ("14_arsitektur_sistem.png", "Arsitektur sistem", "Semua model berjalan lokal di atas OpenVINO; tiga peran dalam satu alur."),
    ("15_alur_laporan.png", "Alur satu laporan", "Dari warga sampai jalan diperbaiki dan dikonfirmasi."),
    ("16_peran_pengguna.png", "Empat peran, satu sistem", "Hak akses dijaga di server."),
]


def background() -> Image.Image:
    img = Image.new("RGB", (W, H), BG)
    glow = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(glow)
    d.ellipse((-400, -500, 900, 500), fill=(40, 36, 10))
    d.ellipse((1300, 600, 2400, 1500), fill=(10, 24, 40))
    return Image.blend(img, glow.filter(ImageFilter.GaussianBlur(180)), 0.9)


def rounded(im: Image.Image, r: int) -> Image.Image:
    mask = Image.new("L", im.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, *im.size), r, fill=255)
    out = Image.new("RGBA", im.size)
    out.paste(im, (0, 0), mask)
    return out


def phone(shot: Image.Image, height: int) -> Image.Image:
    scr = shot.convert("RGB")
    sw = int(scr.width * (height - 40) / scr.height)
    scr = scr.resize((sw, height - 40), Image.LANCZOS)
    frame = Image.new("RGBA", (sw + 40, height), (0, 0, 0, 0))
    ImageDraw.Draw(frame).rounded_rectangle((0, 0, sw + 39, height - 1), 56, fill=(30, 34, 41), outline=(70, 76, 86), width=3)
    frame.alpha_composite(rounded(scr, 40), (20, 20))
    return frame


def laptop(shot: Image.Image, width: int) -> Image.Image:
    scr = shot.convert("RGB")
    sh = int(scr.height * (width - 40) / scr.width)
    scr = scr.resize((width - 40, sh), Image.LANCZOS)
    out = Image.new("RGBA", (width + 80, sh + 70), (0, 0, 0, 0))
    d = ImageDraw.Draw(out)
    d.rounded_rectangle((40, 0, width + 39, sh + 39), 22, fill=(30, 34, 41), outline=(70, 76, 86), width=3)
    out.alpha_composite(rounded(scr, 10), (60, 20))
    d.rounded_rectangle((0, sh + 40, width + 79, sh + 62), 10, fill=(52, 57, 66))
    return out


def text_block(d: ImageDraw.ImageDraw, x: int, y: int, text: str, f, fill, width_chars: int, gap: int = 10) -> int:
    for line in textwrap.wrap(text, width_chars):
        d.text((x, y), line, font=f, fill=fill)
        y += f.size + gap
    return y


def chrome(img: Image.Image, section: str, page: str, tag: str | None) -> ImageDraw.ImageDraw:
    d = ImageDraw.Draw(img)
    d.rounded_rectangle((80, 60, 116, 96), 9, fill=YEL)
    d.text((88, 61), "P", font=font(28, True), fill=BG)
    d.text((132, 62), "PAVEMENT-PINN", font=font(26, True), fill=TXT)
    d.text((W - 80, 66), section, font=font(22), fill=MUTED, anchor="ra")
    d.text((80, H - 64), page, font=font(20), fill=MUTED)
    if tag:
        tw = d.textlength(tag, font=font(20, True))
        d.rounded_rectangle((W - 120 - tw, H - 74, W - 80, H - 38), 18, fill=(40, 34, 8), outline=YEL, width=2)
        d.text((W - 100 - tw, H - 70), tag, font=font(20, True), fill=YEL)
    return d


def journey_slide(sim: str, idx: int, total: int, shot_path: Path) -> Image.Image | None:
    key = shot_path.stem.split("-", 1)[1]
    if key not in STEPS:
        return None
    role, title, cap = STEPS[key]
    img = background()
    d = chrome(img, SIMS[sim], f"Langkah {idx} dari {total}", "SIMULASI · foto contoh")
    shot = Image.open(shot_path)
    rl, rc = ROLE[role]
    x = 110
    d.rounded_rectangle((x, 250, x + 96, 346), 26, fill=rc)
    d.text((x + 48, 298), str(idx), font=font(54, True), fill=BG, anchor="mm")
    tw = d.textlength(rl, font=font(22, True))
    d.rounded_rectangle((x + 120, 276, x + 150 + tw, 320), 22, outline=rc, width=2)
    d.text((x + 135, 284), rl, font=font(22, True), fill=rc)
    y = text_block(d, x, 390, title, font(60, True), TXT, 22, 14)
    text_block(d, x, y + 24, cap, font(30), MUTED, 42, 12)
    for i in range(total):  # progress
        cx = x + i * 26
        d.ellipse((cx, 900, cx + 14, 914), fill=rc if i < idx else LINE)
    if shot.width < 1000:
        dev = phone(shot, 900)
        img.paste(dev, (W - dev.width - 200, (H - dev.height) // 2 + 10), dev)
    else:
        dev = laptop(shot, 1060)
        img.paste(dev, (W - dev.width - 70, (H - dev.height) // 2 + 30), dev)
    return img


def chart_slide(i: int, total: int, path: Path, title: str, cap: str) -> Image.Image:
    img = background()
    d = chrome(img, "Model AI & data", f"{i}/{total}", None)
    d.text((110, 140), title, font=font(54, True), fill=TXT)
    d.text((110, 214), cap, font=font(28), fill=MUTED)
    ch = Image.open(path).convert("RGB")
    k = min(1700 / ch.width, 740 / ch.height)
    ch = ch.resize((int(ch.width * k), int(ch.height * k)), Image.LANCZOS)
    card = Image.new("RGBA", (ch.width + 40, ch.height + 40), (0, 0, 0, 0))
    ImageDraw.Draw(card).rounded_rectangle((0, 0, card.width - 1, card.height - 1), 24, fill=PANEL, outline=LINE, width=2)
    card.alpha_composite(rounded(ch, 14), (20, 20))
    img.paste(card, ((W - card.width) // 2, 290 + (760 - card.height) // 2), card)
    return img


def cover(title: str, sub: str) -> Image.Image:
    img = background()
    d = chrome(img, "Intel AI Global Impact Festival 2026", "", None)
    d.text((110, 380), title, font=font(96, True), fill=TXT)
    d.text((110, 520), sub, font=font(36), fill=MUTED)
    d.rounded_rectangle((110, 620, 330, 628), 4, fill=YEL)
    return img


def main() -> None:
    journey = Path(sys.argv[1]) if len(sys.argv) > 1 else None
    if OUT.exists():
        shutil.rmtree(OUT)
    (OUT / "1_model_dan_data").mkdir(parents=True)
    cover("Model AI & data", "Dari dataset fisika sampai OpenVINO INT8: semua dari run asli").save(OUT / "1_model_dan_data" / "00-cover.png")
    charts = [(c, t, s) for c, t, s in CHARTS if (HERE / c).exists()]
    for i, (c, t, s) in enumerate(charts, 1):
        chart_slide(i, len(charts), HERE / c, t, s).save(OUT / "1_model_dan_data" / f"{i:02d}-{Path(c).stem}.png")
    cv = sorted((HERE / "11_cv_deteksi").glob("*.jpg"))
    for j, p in enumerate(cv, 1):
        chart_slide(j, len(cv), p, "Deteksi kerusakan pada foto jalan nyata", "YOLOv8 + CLIP di OpenVINO: kotak deteksi, jenis kerusakan, genangan.").save(OUT / "1_model_dan_data" / f"cv-{j:02d}-{p.stem}.png")
    if journey:
        for sim, name in SIMS.items():
            src = journey / f"sim-{sim}"
            if not src.exists():
                continue
            dst = OUT / f"{2 if sim == 'A' else 3}_simulasi_{sim}"
            dst.mkdir()
            cover(name, "Perjalanan lengkap: warga → koordinator → petugas → AI & PINN → perbaikan → selesai").save(dst / "00-cover.png")
            shots = [p for p in sorted(src.glob("*.png")) if p.stem.split("-", 1)[1] in STEPS]
            for idx, p in enumerate(shots, 1):
                s = journey_slide(sim, idx, len(shots), p)
                if s:
                    s.save(dst / f"{idx:02d}-{p.stem.split('-', 1)[1]}.png")
            raw = HERE / "screenshots_mentah" / f"simulasi_{sim}"
            raw.mkdir(parents=True, exist_ok=True)
            for p in shots:
                shutil.copy(p, raw / p.name)
    print("slides in", OUT)


if __name__ == "__main__":
    main()
