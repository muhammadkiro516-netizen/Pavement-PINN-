"""Camera pictures for the recording, all cut from the real photos in pitchdeck-visuals/11_cv_deteksi.
Each scene is a different framing, because the server refuses a photo it has seen before.
The marker scene has a real ArUco card pasted on, so the real marker code path runs (disclosed in SHOTLIST.md)."""
import json
import os
import urllib.request

import cv2
import numpy as np

SRC = "pitchdeck-visuals/11_cv_deteksi/"
OUT = ".data/capture/scenes"
W, H = 1280, 960
os.makedirs(OUT, exist_ok=True)


def crop(name, f, cx, cy):
    a = cv2.imread(SRC + name + ".jpg")
    h, w = a.shape[:2]
    cw, ch = int(w * f), int(h * f)
    x, y = int(min(max(cx * w - cw / 2, 0), w - cw)), int(min(max(cy * h - ch / 2, 0), h - ch))
    return cv2.resize(a[y:y + ch, x:x + cw], (W, H), interpolation=cv2.INTER_CUBIC)


def save(name, image):
    cv2.imwrite(f"{OUT}/{name}.jpg", image, [cv2.IMWRITE_JPEG_QUALITY, 88])


save("hole_main", crop("jalan-berlubang", 0.4, 0.7, 0.7))
save("hole_second", crop("jalan-berlubang", 0.5, 0.7, 0.72))
for i, (f, cx, cy) in enumerate([(0.8, 0.5, 0.6), (0.65, 0.35, 0.5), (0.5, 0.3, 0.55), (0.45, 0.5, 0.75), (0.6, 0.65, 0.45), (0.55, 0.45, 0.35)]):
    save(f"hole_{i}", crop("jalan-berlubang", f, cx, cy))
for i, (f, cx, cy) in enumerate([(0.9, 0.5, 0.5), (0.6, 0.35, 0.6), (0.6, 0.65, 0.6), (0.5, 0.5, 0.75), (0.5, 0.3, 0.4), (0.45, 0.7, 0.4), (0.7, 0.5, 0.35), (0.4, 0.5, 0.55), (0.4, 0.25, 0.7), (0.4, 0.75, 0.7), (0.35, 0.55, 0.3), (0.35, 0.35, 0.8)]):
    save(f"repair_{i}", crop("perbaikan-kebumen", f, cx, cy))
for name, tag in [("surabaya", "other_0"), ("ubud-bali", "other_1"), ("rambu-kebumen", "other_2")]:
    save(tag, crop(name, 0.9, 0.5, 0.5))

marked = crop("jalan-berlubang", 0.55, 0.62, 0.62)
marker = cv2.aruco.generateImageMarker(cv2.aruco.getPredefinedDictionary(cv2.aruco.DICT_4X4_50), 7, 220)
card = cv2.cvtColor(cv2.copyMakeBorder(marker, 30, 30, 30, 30, cv2.BORDER_CONSTANT, value=255), cv2.COLOR_GRAY2BGR)
marked[40:40 + card.shape[0], 60:60 + card.shape[1]] = card
save("marker", marked)

req = urllib.request.Request("http://127.0.0.1:8100/v1/cv/analyze-image", data=open(f"{OUT}/hole_main.jpg", "rb").read(), headers={"content-type": "image/jpeg"}, method="POST")
out = json.load(urllib.request.urlopen(req, timeout=60))
print("hole_main", [(d["label"], round(d["confidence"], 2)) for d in out["detections"]], sorted(out.keys())[:30])
print(np.array(cv2.imread(f"{OUT}/marker.jpg")).shape)
