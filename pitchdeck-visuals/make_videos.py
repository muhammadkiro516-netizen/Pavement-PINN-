"""Pitch-deck videos (MP4 H.264, 1280x720, 30 fps), drawn from real outputs only.

  inference/.venv/Scripts/python pitchdeck-visuals/make_videos.py [journey_dir]

- deteksi_<foto>.mp4: the photo goes through the running AI service (port 8100); the animation
  replays that result (scan, boxes, labels, scene, timings). Nothing is invented.
- training_pinn.mp4: the loss curves of the real training run (_work/train_history.json).
- journey_dir: Playwright screen recordings (.webm) of the end-to-end simulation -> .mp4.
"""
from __future__ import annotations

import json
import subprocess
import sys
import urllib.request
from pathlib import Path

import cv2
import imageio_ffmpeg
import numpy as np

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
OUT = HERE / "videos"
FF = imageio_ffmpeg.get_ffmpeg_exe()
W, H, FPS = 1280, 720, 30
BG = (16, 13, 11)
YEL, ORA, CYAN, GRN, WHITE, MUTED = (10, 214, 255), (44, 107, 255), (248, 189, 56), (123, 214, 43), (245, 244, 244), (170, 161, 161)
FONT = cv2.FONT_HERSHEY_DUPLEX


class Writer:
    def __init__(self, path: Path):
        self.p = subprocess.Popen([FF, "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "bgr24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
                                   "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "20", "-movflags", "+faststart", str(path)], stdin=subprocess.PIPE)

    def add(self, frame: np.ndarray, times: int = 1) -> None:
        for _ in range(times):
            self.p.stdin.write(frame.tobytes())

    def close(self) -> None:
        self.p.stdin.close()
        self.p.wait()


def text(img, s, org, scale=0.8, color=WHITE, th=1, outline=True):
    if outline:
        cv2.putText(img, s, org, FONT, scale, (0, 0, 0), th + 2, cv2.LINE_AA)
    cv2.putText(img, s, org, FONT, scale, color, th, cv2.LINE_AA)


def brand(img, sub: str):
    cv2.rectangle(img, (0, 0), (W, 54), BG, -1)
    cv2.rectangle(img, (24, 14), (50, 40), YEL, -1)
    text(img, "P", (30, 36), 0.7, BG, 2)
    text(img, "PAVEMENT-PINN", (62, 36), 0.75, WHITE, 1)
    text(img, sub, (W - 24 - cv2.getTextSize(sub, FONT, 0.6, 1)[0][0], 35), 0.6, MUTED)


def ease(t: float) -> float:
    t = max(0.0, min(1.0, t))
    return 1 - (1 - t) ** 3


def analyze(photo: Path) -> dict:
    req = urllib.request.Request("http://127.0.0.1:8100/v1/cv/analyze-image", data=photo.read_bytes(), headers={"Content-Type": "image/jpeg"})
    with urllib.request.urlopen(req, timeout=180) as r:
        d = json.loads(r.read())
    return d.get("result", d)


def detection_video(photo: Path, out: Path) -> None:
    d = analyze(photo)
    src = cv2.imread(str(photo))
    k = min(W / src.shape[1], (H - 54) / src.shape[0])
    im = cv2.resize(src, (int(src.shape[1] * k), int(src.shape[0] * k)))
    ox, oy = (W - im.shape[1]) // 2, 54 + (H - 54 - im.shape[0]) // 2
    base = np.full((H, W, 3), BG, np.uint8)
    base[oy:oy + im.shape[0], ox:ox + im.shape[1]] = im
    dets = d.get("detections", [])
    scene = d.get("scene") or {}
    top = scene.get("distressTop") or {}
    t = d.get("timings", {})
    wr = Writer(out)
    # 1. photo in
    for f in range(20):
        fr = cv2.addWeighted(base, f / 20, np.full_like(base, BG), 1 - f / 20, 0)
        brand(fr, "Deteksi kerusakan · OpenVINO")
        wr.add(fr)
    # 2. scan sweep
    for f in range(45):
        fr = base.copy()
        y = oy + int(ease(f / 44) * im.shape[0])
        ov = fr.copy()
        cv2.rectangle(ov, (ox, oy), (ox + im.shape[1], y), (40, 30, 0), -1)
        fr = cv2.addWeighted(ov, 0.25, fr, 0.75, 0)
        cv2.line(fr, (ox, y), (ox + im.shape[1], y), YEL, 3, cv2.LINE_AA)
        brand(fr, "Deteksi kerusakan · OpenVINO")
        text(fr, "AI memindai foto...", (ox + 16, oy + 40), 0.9, YEL, 2)
        wr.add(fr)
    # 3. boxes draw in with confidence count-up
    for f in range(45):
        fr = base.copy()
        p = ease(f / 44)
        for det in dets:
            x1, y1, x2, y2 = (int(v * k) for v in det["bbox"])
            x1, x2, y1, y2 = x1 + ox, x2 + ox, y1 + oy, y2 + oy
            L = int(min(x2 - x1, y2 - y1) * 0.25)
            for (cx, cy, dx, dy) in ((x1, y1, 1, 1), (x2, y1, -1, 1), (x1, y2, 1, -1), (x2, y2, -1, -1)):
                cv2.line(fr, (cx, cy), (cx + dx * L, cy), YEL, 4, cv2.LINE_AA)
                cv2.line(fr, (cx, cy), (cx, cy + dy * L), YEL, 4, cv2.LINE_AA)
            if p > 0.5:
                ov = fr.copy()
                cv2.rectangle(ov, (x1, y1), (x2, y2), YEL, 2, cv2.LINE_AA)
                fr = cv2.addWeighted(ov, (p - 0.5) * 2, fr, 1 - (p - 0.5) * 2, 0)
            lab = f"{det['label']} {int(det['confidence'] * 100 * p)}%"
            (tw, th), _ = cv2.getTextSize(lab, FONT, 0.7, 1)
            cv2.rectangle(fr, (x1, max(54, y1 - th - 14)), (x1 + tw + 14, y1), YEL, -1)
            cv2.putText(fr, lab, (x1 + 7, y1 - 7), FONT, 0.7, BG, 1, cv2.LINE_AA)
        brand(fr, "Deteksi kerusakan · OpenVINO")
        if not dets:
            text(fr, "Tidak ada kotak deteksi: jenis dari pemahaman scene", (ox + 16, oy + 40), 0.8, YEL, 1)
        wr.add(fr)
    # 4. result panel
    last = fr.copy()
    lines = [
        ("Jenis", (d.get("primary") or {}).get("label") or top.get("label") or "-"),
        ("Keparahan (model)", str(d.get("overallSeverity", "-"))),
        ("Temuan", f"{len(dets)} kotak deteksi"),
        ("Scene (CLIP)", f"{top.get('label', '-')}" + (f" {top['p']:.2f}" if top.get("p") else "")),
        ("Genangan", "ya" if (scene.get("water") or {}).get("flooded") else "tidak"),
        ("Waktu", f"{t.get('totalMs', 0):.0f} ms di CPU"),
    ]
    for f in range(75):
        fr = last.copy()
        a = ease(f / 20)
        x0 = W - int(420 * a)
        ov = fr.copy()
        cv2.rectangle(ov, (x0, 54), (W, H), (29, 24, 21), -1)
        fr = cv2.addWeighted(ov, 1.0, fr, 0.0, 0)
        text(fr, "Hasil AI", (x0 + 28, 110), 1.0, YEL, 2, False)
        for i, (kk, vv) in enumerate(lines):
            if f > 8 + i * 5:
                text(fr, kk, (x0 + 28, 160 + i * 74), 0.55, MUTED, 1, False)
                text(fr, vv[:26], (x0 + 28, 190 + i * 74), 0.75, WHITE, 1, False)
        wr.add(fr)
    wr.close()
    print("wrote", out.name, len(dets), "detections")


def training_video(out: Path) -> None:
    h = json.loads((HERE / "_work" / "train_history.json").read_text())
    steps, val, data, phys = (np.array(h["pinn"][k], float) for k in ("step", "val", "data", "phys"))
    plain = np.array(h["plain"]["val"], float)
    x0, y0, x1, y1 = 110, 130, W - 60, H - 90
    lo, hi = np.log10(max(1e-6, min(val.min(), data.min(), max(phys.min(), 1e-6)))), np.log10(max(val.max(), data.max()))
    X = lambda s: int(x0 + (s - steps[0]) / (steps[-1] - steps[0]) * (x1 - x0))
    Y = lambda v: int(y1 - (np.log10(max(v, 1e-6)) - lo) / (hi - lo) * (y1 - y0))
    wr = Writer(out)
    n = len(steps)
    frames = 240
    for f in range(frames + 45):
        m = max(2, int(n * min(1.0, f / frames)))
        fr = np.full((H, W, 3), BG, np.uint8)
        brand(fr, "Training PINN · data + fisika")
        for e in range(int(np.floor(lo)), int(np.ceil(hi)) + 1):
            yy = Y(10.0 ** e)
            if y0 <= yy <= y1:
                cv2.line(fr, (x0, yy), (x1, yy), (55, 47, 42), 1)
                text(fr, f"1e{e}", (40, yy + 5), 0.45, MUTED)
        for arr, col, th in ((plain, MUTED, 1), (phys, ORA, 2), (data, YEL, 1), (val, CYAN, 3)):
            pts = np.array([[X(steps[i]), Y(arr[i])] for i in range(m)], np.int32)
            cv2.polylines(fr, [pts], False, col, th, cv2.LINE_AA)
        i = m - 1
        text(fr, f"step {int(steps[i]):>5} / {int(steps[-1])}", (x0, 100), 0.8, WHITE, 1)
        text(fr, f"val loss {val[i]:.5f}", (x0 + 330, 100), 0.8, CYAN, 1)
        text(fr, f"physics {phys[i]:.1e}", (x0 + 640, 100), 0.8, ORA, 1)
        for j, (lab, col) in enumerate((("Validasi PINN", CYAN), ("Train (data)", YEL), ("Loss fisika", ORA), ("MLP tanpa fisika", MUTED))):
            cv2.rectangle(fr, (x0 + j * 260, H - 50), (x0 + j * 260 + 22, H - 38), col, -1)
            text(fr, lab, (x0 + j * 260 + 32, H - 38), 0.55, WHITE)
        wr.add(fr)
    wr.close()
    print("wrote", out.name)


def convert(webm: Path, out: Path) -> None:
    subprocess.run([FF, "-y", "-loglevel", "error", "-i", str(webm), "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "20", "-movflags", "+faststart", str(out)], check=True)
    print("wrote", out.name)


def main() -> None:
    OUT.mkdir(exist_ok=True)
    for old in OUT.glob("*.mp4"):
        old.unlink()
    for photo in sorted((ROOT / "public" / "photos").glob("*.jpg")):
        detection_video(photo, OUT / f"deteksi_{photo.stem}.mp4")
    if (HERE / "_work" / "train_history.json").exists():
        training_video(OUT / "training_pinn.mp4")
    if len(sys.argv) > 1:
        for webm in sorted(Path(sys.argv[1]).glob("sim-*/video-*.webm")):
            convert(webm, OUT / f"simulasi_{webm.parent.name[-1]}_{webm.stem.replace('video-', '')}.mp4")


if __name__ == "__main__":
    main()
