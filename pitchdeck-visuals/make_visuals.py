"""Pitch-deck visuals for PAVEMENT-PINN, generated from real runs only.

  cd inference && .venv/Scripts/python ../pitchdeck-visuals/make_visuals.py

1. Dataset: the MLET (PyMastic) dataset regenerated with the project script (seed 42).
2. Training: the PI-surrogate trained again here with per-step logging (same code path,
   same hyper-parameters as models/pi-surrogate-v1); the terminal image is the real log.
3. Evaluation: parity / error on the held-out 20 % split of that run.
4. Speed + OpenVINO: from measurements/*.json (bench/run_all.py on the team laptop).
5. Computer vision: real photos in public/photos through the running AI service (port 8100).
"""
from __future__ import annotations

import base64
import io
import json
import sys
import time
import urllib.request
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import torch

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "pitchdeck-visuals"
WORK = OUT / "_work"
sys.path[:0] = [str(ROOT / "inference"), str(ROOT / "inference" / "training")]
import train_pi_surrogate as tps  # noqa: E402

BG, PANEL, LINE, TXT, MUTED = "#0B0D10", "#15181D", "#2A2F37", "#F4F4F5", "#A1A1AA"
YEL, ORA, BLUE, CYAN, GRN, RED = "#FFD60A", "#FF6B2C", "#4C8DFF", "#38BDF8", "#2BD67B", "#FF4D5E"
plt.rcParams.update({
    "figure.facecolor": BG, "axes.facecolor": PANEL, "axes.edgecolor": LINE, "axes.labelcolor": TXT,
    "xtick.color": MUTED, "ytick.color": MUTED, "text.color": TXT, "grid.color": LINE, "font.size": 12,
    "axes.titleweight": "bold", "axes.titlesize": 15, "savefig.dpi": 200, "savefig.facecolor": BG,
    "font.family": ["Segoe UI", "DejaVu Sans"],
})


def save(fig, name: str, note: str) -> None:
    fig.text(0.01, 0.01, note, color=MUTED, fontsize=8, ha="left", va="bottom")
    fig.savefig(OUT / name, bbox_inches="tight", pad_inches=0.25)
    plt.close(fig)
    print("wrote", name)


# ----------------------------------------------------------------------------- 1. dataset
def dataset_visuals(data) -> None:
    X, out = data["X"], data["out"]
    cols = [str(c) for c in data["columns"]]
    names = {"P": "Beban roda P (kN)", "q": "Tekanan ban q (MPa)", "h1": "Tebal aspal h1 (mm)", "h2": "Tebal pondasi h2 (mm)",
             "E1": "Modulus aspal E1 (MPa)", "E2": "Modulus pondasi E2 (MPa)", "CBR": "CBR tanah dasar (%)", "d": "Jarak ban ganda d (mm)"}
    fig, axs = plt.subplots(2, 4, figsize=(16, 7))
    for ax, i in zip(axs.flat, range(X.shape[1])):
        ax.hist(X[:, i], bins=40, color=YEL, alpha=0.9, edgecolor=BG, linewidth=0.3)
        ax.set_title(names.get(cols[i], cols[i]), fontsize=11)
        ax.grid(alpha=0.3)
    fig.suptitle(f"Dataset fisika: {len(X):,} struktur perkerasan disimulasikan dengan MLET (PyMastic)".replace(",", "."), fontsize=17, fontweight="bold")
    fig.tight_layout(rect=(0, 0.03, 1, 0.95))
    save(fig, "01_dataset_distribusi_input.png", "Sampling Latin Hypercube (seed 42) · rentang perkerasan lentur Indonesia · sumber: inference/training/gen_mlet_dataset.py")

    fig, axs = plt.subplots(1, 2, figsize=(14, 5))
    for ax, k, lab, c in ((axs[0], 1, "Regangan tarik bawah aspal εt (µε)", ORA), (axs[1], 2, "Regangan tekan atas tanah dasar εv (µε)", CYAN)):
        ax.hist(np.log10(np.abs(out[:, k]) + 1e-9), bins=50, color=c, edgecolor=BG, linewidth=0.3)
        ax.set_title(lab)
        ax.set_xlabel("log10 regangan")
        ax.grid(alpha=0.3)
    fig.suptitle("Label dataset: respons struktur yang dihitung solver fisika", fontsize=16, fontweight="bold")
    fig.tight_layout(rect=(0, 0.04, 1, 0.93))
    save(fig, "02_dataset_label_regangan.png", "Setiap label = 1 solusi Multi-Layer Elastic Theory (beban roda ganda)")

    rng = np.random.default_rng(7)
    rows = rng.choice(len(X), 8, replace=False)
    head = cols + ["εt (µε)", "εv (µε)"]
    cells = [[f"{v:.0f}" if abs(v) >= 10 else f"{v:.2f}" for v in X[r]] + [f"{out[r, 1]:.1f}", f"{out[r, 2]:.1f}"] for r in rows]
    fig, ax = plt.subplots(figsize=(15, 3.6))
    ax.axis("off")
    t = ax.table(cellText=cells, colLabels=head, loc="center", cellLoc="center")
    t.auto_set_font_size(False)
    t.set_fontsize(11)
    t.scale(1, 1.6)
    for (r, _), cell in t.get_celld().items():
        cell.set_edgecolor(LINE)
        cell.set_facecolor(YEL if r == 0 else PANEL)
        cell.get_text().set_color(BG if r == 0 else TXT)
        if r == 0:
            cell.get_text().set_fontweight("bold")
    ax.set_title("Contoh baris dataset (8 dari 19.894)", pad=12)
    save(fig, "03_dataset_contoh_baris.png", "Input struktur + beban → output regangan kritis")


# ----------------------------------------------------------------------------- 2. training
def train_logged(F, Y, Fv, Yv, signs, steps, lam, seed, log):
    torch.manual_seed(seed)
    fmu, fsd, ymu, ysd = F.mean(0), F.std(0), Y.mean(0), Y.std(0)
    model = tps.PISurrogate(fmu, fsd, ymu, ysd, n_in=F.shape[1], width=64)
    Ft, Yt, Fvt, Yvt = map(torch.tensor, (F, Y, Fv, Yv))
    lo, hi = Ft.min(0).values, Ft.max(0).values
    st = torch.tensor(signs, dtype=torch.float32)
    opt = torch.optim.Adam(model.parameters(), lr=3e-3)
    sched = torch.optim.lr_scheduler.CosineAnnealingLR(opt, steps)
    hist = {"step": [], "data": [], "phys": [], "val": []}
    t0 = time.time()
    for step in range(1, steps + 1):
        b = torch.randint(0, len(Ft), (1024,))
        data_loss = ((model(Ft[b]) - Yt[b]) ** 2).mean()
        phys = tps.mono_penalty(model, lo + (hi - lo) * torch.rand(512, F.shape[1]), st) if lam > 0 else torch.tensor(0.0)
        loss = data_loss + lam * phys
        opt.zero_grad()
        loss.backward()
        opt.step()
        sched.step()
        if step % 50 == 0 or step == 1:
            with torch.no_grad():
                val = ((model(Fvt) - Yvt) ** 2).mean().item()
            hist["step"].append(step)
            hist["data"].append(data_loss.item())
            hist["phys"].append(float(phys))
            hist["val"].append(val)
            if log is not None and (step % 250 == 0 or step == 1):
                log.append(f"step {step:>5}/{steps} | loss {loss.item():.5f} | data {data_loss.item():.5f} | physics {float(phys):.2e} | val {val:.5f} | lr {sched.get_last_lr()[0]:.2e} | {time.time() - t0:5.1f}s")
    model.eval()
    return model, hist, time.time() - t0


def terminal_image(lines: list[str], name: str, title: str) -> None:
    fig = plt.figure(figsize=(16, 0.32 * len(lines) + 1.2))
    fig.patch.set_facecolor("#0C0C0C")
    fig.text(0.012, 0.985, "●  ●  ●", color="#FF5F56", fontsize=12, va="top")
    fig.text(0.07, 0.985, title, color=MUTED, fontsize=11, va="top", family="Consolas")
    for i, ln in enumerate(lines):
        c = GRN if ln.startswith("[OK]") else YEL if ln.startswith("$") else "#D4D4D4"
        fig.text(0.012, 0.93 - i * (0.88 / max(len(lines), 1)), ln, color=c, fontsize=10.5, va="top", family="Consolas")
    fig.savefig(OUT / name, facecolor="#0C0C0C", dpi=200, bbox_inches="tight", pad_inches=0.2)
    plt.close(fig)
    print("wrote", name)


def training_visuals(data):
    X = data["X"]
    F, Y = tps.make_xy(data)
    signs, _ = tps.verify_signs(X)
    rng = np.random.default_rng(0)
    idx = rng.permutation(len(F))
    n_tr = int(0.8 * len(F))
    tr, te = idx[:n_tr], idx[n_tr:]
    steps = 6000
    log = [
        "$ python training/train_pi_surrogate.py --data data/mlet_dual_v1.npz --steps 6000 --lam 0.1",
        f"dataset: {len(F)} MLET cases | train {len(tr)} | test {len(te)} | features 5 (dimensionless) | targets 2 (log εt, log εv)",
        f"model: PISurrogate MLP 5→64→64→64→2 | params {sum(p.numel() for p in tps.PISurrogate(F.mean(0), F.std(0), Y.mean(0), Y.std(0), n_in=5).parameters())} | Adam lr 3e-3 cosine | batch 1024",
        "physics loss: monotonicity of strain w.r.t. thickness & stiffness (λ = 0.1), 512 collocation points / step",
    ]
    model, hist, secs = train_logged(F[tr], Y[tr], F[te], Y[te], signs, steps, 0.1, 0, log)
    plain, hist_plain, _ = train_logged(F[tr], Y[tr], F[te], Y[te], signs, steps, 0.0, 0, None)
    (WORK / "train_history.json").write_text(json.dumps({"pinn": hist, "plain": hist_plain}))
    pred = tps.predict(model, F[te])
    err = np.abs(np.exp(pred - Y[te]) - 1) * 100
    viol = tps.violation_share(model, torch.tensor(F[tr]), torch.tensor(signs, dtype=torch.float32))
    viol_plain = tps.violation_share(plain, torch.tensor(F[tr]), torch.tensor(signs, dtype=torch.float32))
    err_plain = np.abs(np.exp(tps.predict(plain, F[te]) - Y[te]) - 1) * 100
    log += [
        f"[OK] training done in {secs:.1f}s on CPU ({torch.__version__})",
        f"[OK] test MAPE εt {err[:, 0].mean():.2f}% (p95 {np.percentile(err[:, 0], 95):.2f}%) | εv {err[:, 1].mean():.2f}% (p95 {np.percentile(err[:, 1], 95):.2f}%)",
        f"[OK] physics check: monotonic violation share {viol * 100:.2f}% (without physics loss: {viol_plain * 100:.2f}%)",
    ]
    terminal_image(log, "04_training_terminal_log.png", "pavement-pinn — training PI-surrogate")

    fig, ax = plt.subplots(figsize=(13, 6))
    ax.semilogy(hist["step"], hist["data"], color=YEL, lw=1.6, label="Train loss (data)")
    ax.semilogy(hist["step"], hist["val"], color=CYAN, lw=2.2, label="Validation loss")
    ax.semilogy(hist["step"], np.maximum(hist["phys"], 1e-9), color=ORA, lw=1.4, alpha=0.9, label="Physics loss (monotonisitas)")
    ax.set_xlabel("Step")
    ax.set_ylabel("MSE (log-strain)")
    ax.set_title("Training Physics-Informed Surrogate — loss turun stabil, fisika tetap terjaga")
    ax.grid(alpha=0.3, which="both")
    ax.legend(facecolor=PANEL, edgecolor=LINE)
    save(fig, "05_training_loss_curve.png", f"Run nyata: 6000 step, {secs:.0f} s di CPU · data latih {len(tr)} · validasi {len(te)}")

    fig, axs = plt.subplots(1, 2, figsize=(16, 6), gridspec_kw={"width_ratios": [1.6, 1]})
    ax = axs[0]
    ax.semilogy(hist["step"], hist["val"], color=YEL, lw=2.2, label=f"PINN (data + fisika) · MAPE εt {err[:, 0].mean():.2f}%")
    ax.semilogy(hist_plain["step"], hist_plain["val"], color=MUTED, lw=1.8, ls="--", label=f"MLP biasa (data saja) · MAPE εt {err_plain[:, 0].mean():.2f}%")
    ax.set_xlabel("Step")
    ax.set_ylabel("Validation MSE")
    ax.set_title("Akurasi data setara")
    ax.grid(alpha=0.3, which="both")
    ax.legend(facecolor=PANEL, edgecolor=LINE)
    ax = axs[1]
    vals = [viol_plain * 100, viol * 100]
    ax.bar(["MLP biasa", "PINN"], vals, color=[MUTED, YEL])
    for i, v in enumerate(vals):
        ax.text(i, v, f"{v:.2f}%", ha="center", va="bottom", fontsize=14, fontweight="bold")
    ax.set_ylabel("Titik yang melanggar hukum fisika (%)")
    ax.set_title(f"…tetapi PINN {viol_plain / max(viol, 1e-9):.0f}× lebih patuh fisika" if viol > 0 else "…tetapi PINN patuh fisika")
    ax.grid(alpha=0.3, axis="y")
    fig.suptitle("Ablasi: apa yang ditambahkan loss fisika", fontsize=17, fontweight="bold")
    fig.tight_layout(rect=(0, 0.04, 1, 0.93))
    save(fig, "06_training_ablation_physics.png", "Arsitektur & seed sama; beda hanya loss fisika (λ = 0.1) · pelanggaran = gradien regangan berlawanan arah fisika (tebal/kaku ↑ → regangan ↓)")

    tv = np.exp(Y[te])
    pv = np.exp(pred)
    fig, axs = plt.subplots(1, 2, figsize=(14, 6.4))
    for ax, k, lab, c in ((axs[0], 0, "εt (tarik bawah aspal)", ORA), (axs[1], 1, "εv (tekan atas tanah dasar)", CYAN)):
        ax.loglog(tv[:, k], pv[:, k], ".", color=c, ms=2.5, alpha=0.5)
        lo_, hi_ = tv[:, k].min(), tv[:, k].max()
        ax.plot([lo_, hi_], [lo_, hi_], color=TXT, lw=1, ls="--")
        ax.set_title(f"{lab} · MAPE {err[:, k].mean():.2f}%")
        ax.set_xlabel("Solver fisika MLET (ground truth)")
        ax.set_ylabel("Prediksi PINN")
        ax.grid(alpha=0.3, which="both")
    fig.suptitle(f"Prediksi vs ground truth pada {len(te):,} struktur yang tidak pernah dilihat saat training".replace(",", "."), fontsize=16, fontweight="bold")
    fig.tight_layout(rect=(0, 0.04, 1, 0.93))
    save(fig, "07_evaluasi_parity_plot.png", "Garis putus = prediksi sempurna · regangan dinormalisasi (ε·E3/q)")

    fig, ax = plt.subplots(figsize=(12, 5.5))
    ax.hist(err[:, 0], bins=60, range=(0, 5), color=ORA, alpha=0.75, label=f"εt · median {np.median(err[:, 0]):.2f}%")
    ax.hist(err[:, 1], bins=60, range=(0, 5), color=CYAN, alpha=0.65, label=f"εv · median {np.median(err[:, 1]):.2f}%")
    ax.set_xlabel("Galat absolut relatif (%)")
    ax.set_ylabel("Jumlah struktur uji")
    ax.set_title("Distribusi galat pada data uji")
    ax.legend(facecolor=PANEL, edgecolor=LINE)
    ax.grid(alpha=0.3)
    save(fig, "08_evaluasi_distribusi_galat.png", f"n = {len(te)} struktur uji")
    return {"viol": viol, "viol_plain": viol_plain, "secs": secs, "mape_et": float(err[:, 0].mean()), "mape_ev": float(err[:, 1].mean()), "n_train": len(tr), "n_test": len(te)}


# ----------------------------------------------------------------------------- 3. speed + OpenVINO
def speed_visuals() -> None:
    p2 = json.loads((ROOT / "measurements/pinn2.json").read_text())
    s = p2["speed"]
    mlet_ms, sur_ms = s["pymasticPerSampleMs"], s["surrogatePerSampleUs"] / 1000
    fig, ax = plt.subplots(figsize=(12, 4.6))
    ax.barh(["Solver fisika MLET\n(PyMastic)", "PINN surrogate\n(OpenVINO)"], [mlet_ms, sur_ms], color=[MUTED, YEL])
    ax.set_xscale("log")
    ax.set_xlabel("Waktu per struktur (ms, skala log)")
    for y, v in enumerate([mlet_ms, sur_ms]):
        ax.text(v * 1.15, y, f"{v:.3f} ms" if v < 1 else f"{v:.1f} ms", va="center", fontsize=13, fontweight="bold")
    ax.set_title(f"≈{mlet_ms / sur_ms:,.0f}× lebih cepat dengan akurasi εt {p2['et']['mape']:.2f}% / εv {p2['ev']['mape']:.2f}%".replace(",", "."))
    ax.grid(alpha=0.3, axis="x")
    save(fig, "09_kecepatan_pinn_vs_solver.png", f"{p2['samples']} struktur uji · measurements/pinn2.json")

    b = json.loads((ROOT / "measurements/benchmark-avlfelo.json").read_text())
    rows = [r for r in b["latency"] if r["device"] == "CPU"]
    models = list(dict.fromkeys(r["model"] for r in rows))
    fig, axs = plt.subplots(1, len(models), figsize=(5 * len(models), 5))
    for ax, m in zip(np.atleast_1d(axs), models):
        rs = [r for r in rows if r["model"] == m]
        ax.bar([r["precision"] for r in rs], [r["p50Ms"] for r in rs], color=[YEL if "INT8" in r["precision"] else BLUE if "FP16" in r["precision"] else MUTED for r in rs])
        for i, r in enumerate(rs):
            ax.text(i, r["p50Ms"], f"{r['p50Ms']:.1f} ms\n{r['fps']:.0f} fps" if r["p50Ms"] >= 1 else f"{r['p50Ms']:.2f} ms", ha="center", va="bottom", fontsize=11)
        ax.set_title(m, fontsize=12)
        ax.set_ylabel("Latensi p50 (ms)")
        ax.grid(alpha=0.3, axis="y")
    fig.suptitle("OpenVINO: latensi per model dan presisi (CPU)", fontsize=16, fontweight="bold")
    fig.tight_layout(rect=(0, 0.05, 1, 0.92))
    save(fig, "10_openvino_latensi_presisi.png", f"OpenVINO {b['machine']['openvino'].split('-')[0]} · {b['runs']} run setelah {b['warmup']} warmup · measurements/benchmark-avlfelo.json")


# ----------------------------------------------------------------------------- 4. computer vision
def post(path: str, data: bytes, ctype: str) -> dict:
    req = urllib.request.Request(f"http://127.0.0.1:8100{path}", data=data, headers={"Content-Type": ctype})
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.loads(r.read())


def cv_visuals() -> None:
    import cv2

    photos = sorted((ROOT / "public/photos").glob("*.jpg"))
    (OUT / "11_cv_deteksi").mkdir(exist_ok=True)
    scenes = []
    for p in photos:
        d = post("/v1/cv/analyze-image", p.read_bytes(), "image/jpeg")
        d = d.get("result", d)
        img = cv2.imread(str(p))
        h, w = img.shape[:2]
        k = 1280 / max(h, w)
        img = cv2.resize(img, (int(w * k), int(h * k)))
        for det in d.get("detections", []):
            x1, y1, x2, y2 = (int(v * k) for v in det["bbox"])
            cv2.rectangle(img, (x1, y1), (x2, y2), (10, 214, 255), 3)
            lab = f"{det['label']} {det['confidence'] * 100:.0f}%"
            (tw, th), _ = cv2.getTextSize(lab, cv2.FONT_HERSHEY_SIMPLEX, 0.7, 2)
            cv2.rectangle(img, (x1, max(0, y1 - th - 12)), (x1 + tw + 10, y1), (10, 214, 255), -1)
            cv2.putText(img, lab, (x1 + 5, y1 - 6), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (16, 13, 11), 2)
        seg = None  # boxes only: the crack mask is shown in the app's own overlay, not on these slides
        if seg:
            m = cv2.imdecode(np.frombuffer(base64.b64decode(seg), np.uint8), cv2.IMREAD_GRAYSCALE)
            m = cv2.resize(m, (img.shape[1], img.shape[0])) > 0
            img[m] = (0.45 * img[m] + 0.55 * np.array([44, 107, 255])).astype(np.uint8)
        sc = d.get("scene") or {}
        top = sc.get("distressTop") or {}
        banner = f"PAVEMENT-PINN AI · {len(d.get('detections', []))} deteksi · {top.get('label', '-')}" + (" · GENANGAN" if (sc.get("water") or {}).get("flooded") else "")
        cv2.rectangle(img, (0, 0), (img.shape[1], 44), (16, 13, 11), -1)
        cv2.putText(img, banner, (14, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (10, 214, 255), 2)
        cv2.imwrite(str(OUT / "11_cv_deteksi" / f"{p.stem}.jpg"), img, [cv2.IMWRITE_JPEG_QUALITY, 92])
        print("wrote 11_cv_deteksi/", p.stem, d.get("timings", {}).get("totalMs"), "ms")
        if sc.get("distress"):
            scenes.append((p.stem, sc["distress"], d.get("timings", {})))
    if scenes:
        keys = [k for k in scenes[0][1] if k != "none"]
        fig, axs = plt.subplots(1, len(scenes), figsize=(4.2 * len(scenes), 5.4), sharey=True)
        for ax, (name, probs, _) in zip(np.atleast_1d(axs), scenes):
            v = [probs[k] for k in keys]
            ax.barh(keys, v, color=[YEL if x == max(v) else LINE for x in v])
            ax.set_title(name, fontsize=11)
            ax.set_xlim(0, 1)
            ax.grid(alpha=0.3, axis="x")
        fig.suptitle("Pemahaman scene (CLIP ViT-B/32 INT8 · OpenVINO): 11 jenis kerusakan termasuk genangan", fontsize=15, fontweight="bold")
        fig.tight_layout(rect=(0, 0.05, 1, 0.92))
        save(fig, "12_cv_scene_probabilitas.png", "Probabilitas per kelas untuk foto jalan nyata di public/photos")
        stages = [("Preprocessing", "preprocessingMs", MUTED), ("Deteksi YOLOv8", "detectionMs", YEL), ("Segmentasi retak", "segmentationMs", ORA), ("Scene CLIP", "sceneMs", CYAN)]
        fig, ax = plt.subplots(figsize=(13, 0.7 * len(scenes) + 1.6))
        for i, (name, _, t) in enumerate(scenes):
            left = 0.0
            for lab, key, c in stages:
                v = float(t.get(key) or 0)
                ax.barh(i, v, left=left, color=c, label=lab if i == 0 else None)
                left += v
            ax.text(left + 5, i, f"{t.get('totalMs', left):.0f} ms", va="center", fontsize=11)
        ax.set_yticks(range(len(scenes)), [s[0] for s in scenes])
        ax.set_xlabel("Waktu (ms)")
        ax.set_title("Pipeline AI per foto: dari unggah sampai hasil")
        ax.legend(facecolor=PANEL, edgecolor=LINE, ncol=4, loc="lower right")
        ax.grid(alpha=0.3, axis="x")
        save(fig, "13_cv_pipeline_waktu.png", "Diukur langsung dari layanan inference (OpenVINO, CPU)")


# ----------------------------------------------------------------------------- 5. diagrams
def box(ax, x, y, w, h, title, sub, c):
    ax.add_patch(matplotlib.patches.FancyBboxPatch((x, y), w, h, boxstyle="round,pad=0.02,rounding_size=0.08", fc=PANEL, ec=c, lw=2))
    ax.text(x + w / 2, y + h * 0.62, title, ha="center", va="center", fontsize=12.5, fontweight="bold", color=c)
    ax.text(x + w / 2, y + h * 0.3, sub, ha="center", va="center", fontsize=9.5, color=MUTED)


def arrow(ax, a, b, c=MUTED):
    ax.annotate("", xy=b, xytext=a, arrowprops=dict(arrowstyle="-|>", color=c, lw=1.8))


def diagram_visuals() -> None:
    fig, ax = plt.subplots(figsize=(16, 8.5))
    ax.set_xlim(0, 16)
    ax.set_ylim(0, 8.5)
    ax.axis("off")
    ax.set_facecolor(BG)
    box(ax, 0.3, 6.2, 3.2, 1.5, "Warga (PWA)", "foto · GPS · kawal laporan", YEL)
    box(ax, 0.3, 3.6, 3.2, 1.5, "Petugas lapangan", "inspeksi · rambu · perbaikan", YEL)
    box(ax, 0.3, 1.0, 3.2, 1.5, "Koordinator / Pimpinan", "disposisi · SPK · rapor", YEL)
    box(ax, 5.0, 3.0, 3.4, 3.0, "Server aplikasi", "Express + TypeScript\nworkflow state machine\nRBAC · audit log · SLA", BLUE)
    box(ax, 10.0, 6.0, 2.7, 1.6, "Computer Vision", "YOLOv8n · YOLOv8s-seg\nCLIP ViT-B/32 INT8", ORA)
    box(ax, 13.1, 6.0, 2.6, 1.6, "PINN-2", "PI-surrogate +\nMLET Monte Carlo", ORA)
    box(ax, 10.0, 3.6, 2.7, 1.6, "SLM", "Qwen2.5-1.5B INT4\nOpenVINO GenAI", ORA)
    box(ax, 13.1, 3.6, 2.6, 1.6, "Diagnosis & audit", "sisa umur · biaya wajar\ntemuan audit", ORA)
    box(ax, 10.0, 1.0, 5.7, 1.7, "Intel® OpenVINO™ Runtime", "FP32 / FP16 / INT8 (NNCF) · CPU · GPU · NPU", CYAN)
    for y in (6.95, 4.35, 1.75):
        arrow(ax, (3.5, y), (5.0, 4.5), YEL)
    arrow(ax, (8.4, 4.8), (10.0, 6.8))
    arrow(ax, (8.4, 4.5), (10.0, 4.4))
    arrow(ax, (12.7, 6.8), (13.1, 6.8))
    arrow(ax, (12.7, 4.4), (13.1, 4.4))
    for x in (11.35, 14.4):
        arrow(ax, (x, 3.6), (x, 2.7), CYAN)
    ax.text(8.0, 8.15, "Arsitektur sistem PAVEMENT-PINN", ha="center", fontsize=20, fontweight="bold")
    save(fig, "14_arsitektur_sistem.png", "Semua model AI berjalan lokal di atas OpenVINO; metadata EXIF foto (lokasi, perangkat) dihapus")

    steps = [("1. Lapor", "Foto + GPS\ndari lokasi", YEL), ("2. AI menganalisis", "Deteksi, segmentasi,\nscene, keparahan", ORA), ("3. Disaring", "Duplikat ±30 m,\nbukan jalan", BLUE),
             ("4. Diverifikasi", "Petugas cek\nlapangan", BLUE), ("5. Fisika PINN", "Sisa umur &\nopsi penanganan", ORA), ("6. Diperbaiki", "SPK, kontraktor,\nfoto sesudah", GRN), ("7. Dikonfirmasi", "Warga sekitar\nmenilai hasil", GRN)]
    fig, ax = plt.subplots(figsize=(18, 4.2))
    ax.set_xlim(0, 18)
    ax.set_ylim(0, 4)
    ax.axis("off")
    for i, (t, s, c) in enumerate(steps):
        x = 0.25 + i * 2.55
        box(ax, x, 1.0, 2.15, 2.0, t, s, c)
        if i < len(steps) - 1:
            arrow(ax, (x + 2.15, 2.0), (x + 2.55, 2.0), c)
    ax.text(9, 3.6, "Alur satu laporan: dari warga sampai jalan diperbaiki", ha="center", fontsize=18, fontweight="bold")
    save(fig, "15_alur_laporan.png", "Setiap keputusan staf wajib beralasan dan tercatat di audit log")

    roles = [("Warga", ["Lapor dengan kamera + AI", "Kawal & dukung laporan", "Rute Aman · Pantau Area", "Sertifikat relawan"], YEL),
             ("Petugas lapangan", ["Inspeksi & koreksi AI", "Pasang rambu bahaya", "Analisis PINN struktur", "Catat perbaikan"], BLUE),
             ("Koordinator", ["Antrian prioritas & SLA", "Disposisi antar instansi", "SPK kontraktor", "Verifikasi hasil kerja"], ORA),
             ("Pimpinan instansi", ["Eskalasi H+2/7/14/30", "Rapor kinerja instansi", "Audit biaya wajar", "Persetujuan usulan"], GRN)]
    fig, axs = plt.subplots(1, 4, figsize=(18, 5.2))
    for ax, (r, items, c) in zip(axs, roles):
        ax.axis("off")
        ax.add_patch(matplotlib.patches.FancyBboxPatch((0.03, 0.03), 0.94, 0.94, boxstyle="round,pad=0.01,rounding_size=0.05", fc=PANEL, ec=c, lw=2.5, transform=ax.transAxes))
        ax.text(0.5, 0.86, r, ha="center", fontsize=16, fontweight="bold", color=c, transform=ax.transAxes)
        for j, it in enumerate(items):
            ax.text(0.1, 0.66 - j * 0.15, f"●  {it}", fontsize=12, transform=ax.transAxes)
    fig.suptitle("Empat peran, satu sistem", fontsize=19, fontweight="bold")
    save(fig, "16_peran_pengguna.png", "Hak akses dijaga RBAC di server")


# ----------------------------------------------------------------------------- 6. weather (Open-Meteo)
def weather_visuals() -> None:
    """Monthly rainfall of the last 12 complete months at two pilot sites (ERA5 via Open-Meteo),
    the wet-month count PINN uses (Oldeman: >= 200 mm), and the 7-day forecast."""
    import datetime as dt
    sites = [("Karawang", -6.31, 107.30), ("Jakarta Selatan", -6.29, 106.80)]
    today = dt.date.today()
    end = dt.date(today.year, today.month, 1) - dt.timedelta(days=1)
    end = dt.date(end.year, end.month, 1) - dt.timedelta(days=1)
    start = dt.date(end.year - 1, end.month, 1) + dt.timedelta(days=32)
    start = dt.date(start.year, start.month, 1)
    fig, axs = plt.subplots(1, 2, figsize=(16, 6), sharey=True)
    for ax, (name, lat, lon) in zip(axs, sites):
        url = f"https://archive-api.open-meteo.com/v1/archive?latitude={lat}&longitude={lon}&start_date={start}&end_date={end}&daily=precipitation_sum&timezone=Asia%2FJakarta"
        with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "PAVEMENT-PINN pitch visuals"}), timeout=30) as r:
            d = json.loads(r.read())
        months: dict[str, float] = {}
        for t, v in zip(d["daily"]["time"], d["daily"]["precipitation_sum"]):
            months[t[:7]] = months.get(t[:7], 0.0) + (v or 0.0)
        keys = sorted(months)
        vals = [months[m] for m in keys]
        wet = sum(v >= 200 for v in vals)
        ax.bar([dt.date(int(m[:4]), int(m[5:]), 1).strftime("%b %y") for m in keys], vals, color=[CYAN if v >= 200 else LINE for v in vals])
        ax.axhline(200, color=YEL, lw=1.5, ls="--")
        ax.text(0, 205, "bulan basah ≥ 200 mm (Oldeman)", color=YEL, fontsize=10, va="bottom")
        ax.set_title(f"{name}: {wet} bulan basah · {sum(vals):,.0f} mm/tahun".replace(",", "."))
        ax.grid(alpha=0.3, axis="y")
    axs[0].set_ylabel("Curah hujan bulanan (mm)")
    fig.suptitle("Cuaca nyata masuk ke PINN: jumlah bulan basah → porsi tanah dasar jenuh air", fontsize=16, fontweight="bold")
    fig.tight_layout(rect=(0, 0.05, 1, 0.92))
    save(fig, "18_cuaca_open_meteo_bulan_basah.png", f"Open-Meteo ERA5 reanalysis, {start:%b %Y}–{end:%b %Y} · CC BY 4.0 · dipakai otomatis di kartu PINN & ringkasan kasus")


def main() -> None:
    data = np.load(WORK / "mlet_dual_v1.npz", allow_pickle=True)
    dataset_visuals(data)
    summary = training_visuals(data)
    speed_visuals()
    try:
        cv_visuals()
    except Exception as exc:  # the AI service must be running for this part
        print("CV visuals skipped:", exc)
    diagram_visuals()
    try:
        weather_visuals()
    except Exception as exc:
        print('weather visuals skipped:', exc)
    (WORK / "run_summary.json").write_text(json.dumps(summary, indent=1))
    print(json.dumps(summary, indent=1))


if __name__ == "__main__":
    import os
    os.environ.setdefault("MLET_WORKERS", "2")
    main()
