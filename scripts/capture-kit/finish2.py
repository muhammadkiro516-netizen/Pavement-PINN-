"""Second pass over capture-kit/: trims leading blank frames, removes the weak GenAI sentence from clip 03,
adds the measured PINN time, writes SHOTLIST.md and the ui-assets notes, and zips the kit."""
import json
import os
import shutil
import subprocess
import urllib.request
import zipfile

import cv2
import imageio_ffmpeg

FF = imageio_ffmpeg.get_ffmpeg_exe()
KIT = "capture-kit"
CLIPS = f"{KIT}/clips"
scenes = json.load(open(f"{KIT}/scenes.json", encoding="utf8"))


def run(*args):
    subprocess.run([FF, "-y", "-loglevel", "error", *args], check=True)


def seconds(path):
    v = cv2.VideoCapture(path)
    n = v.get(cv2.CAP_PROP_FRAME_COUNT) / (v.get(cv2.CAP_PROP_FPS) or 30)
    v.release()
    return round(n, 1)


def lead_seconds(path):
    """Time until the first frame that is not a blank page, white or dark ("Memeriksa sesi...")."""
    v = cv2.VideoCapture(path)
    t = 0.0
    while True:
        v.set(cv2.CAP_PROP_POS_MSEC, t * 1000)
        ok, frame = v.read()
        if not ok or (frame.mean() < 200 and frame.std() > 6):
            break
        t += 0.2
    v.release()
    return round(t, 1)


for f in sorted(os.listdir(CLIPS)):
    name = f[:-4]
    path = f"{CLIPS}/{f}"
    lead = lead_seconds(path)
    if lead > 0:
        tmp = path + ".tmp.mp4"
        run("-ss", str(lead), "-i", path, "-c:v", "libx264", "-crf", "20", "-preset", "fast", "-pix_fmt", "yuv420p", "-an", tmp)
        os.replace(tmp, path)
    entry = scenes["clips"].setdefault(name, {"keyMoments": {}})
    entry["keyMoments"] = {k: round(max(v - lead, 0), 2) for k, v in entry.get("keyMoments", {}).items()}

# The model's sentence is too weak to show ("Kasus baru, lanjutkan."): that stretch leaves the clip.
c3 = scenes["clips"]["03_om_today_inbox"]
marks = c3["keyMoments"]
a = marks["today_actions"] + 3.6
b = marks["inbox_map"] - 4.0
if b > a:
    path = f"{CLIPS}/03_om_today_inbox.mp4"
    tmp = path + ".tmp.mp4"
    run("-i", path, "-vf", f"select='not(between(t,{a},{b}))',setpts=N/30/TB", "-c:v", "libx264", "-crf", "20", "-preset", "fast", "-pix_fmt", "yuv420p", "-an", tmp)
    os.replace(tmp, path)
    marks.pop("ai_briefing", None)
    c3["keyMoments"] = {k: (v if v <= a else round(v - (b - a), 2)) for k, v in marks.items()}
    c3["genaiBriefingNotInClip"] = c3.pop("genaiBriefing", None)

for name in os.listdir(CLIPS):
    scenes["clips"][name[:-4]]["seconds"] = seconds(f"{CLIPS}/{name}")

# Real engine time for the 2,000 scenarios of Case A's road.
body = json.dumps({"segment_id": "case-a", "road_class": "KABUPATEN", "esal_year": 250000, "n": 2000}).encode()
pinn = json.load(urllib.request.urlopen(urllib.request.Request("http://127.0.0.1:8100/v1/diagnose", data=body, headers={"content-type": "application/json"}, method="POST"), timeout=60))
scenes["clips"]["04_fe_field_pinn_cost"]["pinnEngineMs"] = pinn.get("elapsed_ms")
scenes["clips"]["04_fe_field_pinn_cost"]["pinnSamples"] = pinn.get("samples")
json.dump(scenes, open(f"{KIT}/scenes.json", "w", encoding="utf8"), ensure_ascii=False, indent=1)

# ---- Assets
assets = f"{KIT}/ui-assets"
for i, label in enumerate(["logo", "pavi-agency", "login-background", "pavi-agency-scan", "logo-large"]):
    src = f"{assets}/login-svg-{i}.svg"
    if os.path.exists(src):
        shutil.move(src, f"{assets}/{label}.svg")
# Same rig as the app's Pavi component; only the helmet colour differs per side.
agency = open(f"{assets}/pavi-agency.svg", encoding="utf8").read()
open(f"{assets}/pavi-citizen.svg", "w", encoding="utf8").write(agency.replace("#FFC72C", "#FF6B2C"))
open(f"{assets}/FONTS.md", "w", encoding="utf8").write(
    "UI fonts, loaded from Google Fonts (SIL Open Font License). Not bundled here.\n\n"
    "- Plus Jakarta Sans 400, 500, 600, 700, 800: all text. https://fonts.google.com/specimen/Plus+Jakarta+Sans\n"
    "- JetBrains Mono: codes and hashes. https://fonts.google.com/specimen/JetBrains+Mono\n")

# ---- Shot list
ROW = {
    "01_citizen_report": ("1 CITIZEN", "Live camera, AI box on the hole, road owner card, tracking code"),
    "01b_long_damage": ("1 CITIZEN, inset", "Walk, a photo at 15 m and 30 m, length grows from GPS, report sent"),
    "01c_low_confidence": ("0:24 inset", "Jakarta Timur inbox: confirm-ownership label and panel"),
    "01d_not_onboarded": ("0:24 inset", "Agency not connected: public case and SP4N-LAPOR! draft"),
    "02_agency_login": ("2 AGENCY LOGIN", "Code opened from the QR link, PIN, workspace, OM badge"),
    "02b_team_codes": ("2 inset", "New staff code and QR, PIN again, revoke, device log, Lock"),
    "03_om_today_inbox": ("3 OM", "Four numbers, three actions, map with area, priority reasons, duplicate merge, assign, AC-WC line"),
    "03b_transfer": ("3 inset", "Transfer citing the decree number, the receiving agency confirms"),
    "03c_owner_map": ("3 extra", "Road owner colours on the citizen map"),
    "04_fe_field_pinn_cost": ("4 FE", "Field list, three photos, marker card, measure, PINN, options side by side, over 20%, Accept"),
    "04b_offline_queue": ("4 inset", "No signal: photo waits on the phone, sent when signal returns"),
    "04c_quality_tests": ("4 inset", "Price book and recommended quality tests"),
    "05_approval_sod": ("5 APPROVAL", "FE tries, server refuses; second OM approves with PIN; work order and guest QR"),
    "06_contractor_verify": ("6 CONTRACTOR, FE", "Guest code, one work order, stage evidence, other FE verifies, guest code ended, follow-ups"),
    "07_auditor_verify": ("7 AUDITOR", "Chain intact, findings, PDF with PIN, /verify, report card, rankings"),
    "07b_price_import": ("7 inset", "CSV price import, logged in the chain"),
    "07c_verify_tampered": ("7 split", "Same report: original check mark, copy with 1 byte changed gets a cross"),
    "07d_neutral_copilot": ("7 inset", "Accusing note rewritten to neutral words"),
    "08_citizen_confirm": ("8 CITIZEN AGAIN", "Notifications, timeline, still good, Kontribusi, certificate, public service ranking"),
}
lines = ["# Shot list", "", "| Clip | Storyboard row | Shows | Seconds |", "|---|---|---|---|"]
for name, (row, shows) in ROW.items():
    lines.append(f"| {name} | {row} | {shows} | {scenes['clips'][name]['seconds']} |")
lines += ["", "Key moments, in seconds from the start of each clip, are in scenes.json.", "", "## Cut from recording", "",
          "- **Patch coverage from segmentation (before/after).** Measured on the real photos: the detector found no damage on the pothole photo at full frame, and the crack model does not see potholes or tell a repaired road. Before/after is matched by GPS only.",
          "- **Ruler number reading (OCR).** No OCR model is installed, and the supplied photo shows no ruler. The field accepts typed depth.",
          "- **The Qwen sentence in the daily briefing.** The model's line was too weak to show (\"Kasus baru, lanjutkan.\"). The three actions are written by code from case data. The text is kept in scenes.json as genaiBriefingNotInClip.",
          "- **Rain warning.** No heavy rain in the forecast on the recording day, so nothing appears. It is real data; it was not forced.",
          "", "## Read before editing", "",
          "- **Phone clips are 390x844 upscaled to 1170x2532.** Chrome's headless screencast does not deliver device pixels. Phone stills in stills/ are true @3x.",
          "- **Case A routing confidence is LOW, not HIGH.** The decree lists are not loaded, so a kabupaten road is an estimate. The clips show \"Petugas akan memastikan\" and \"Konfirmasi kepemilikan\".",
          "- **Camera and GPS are stand-ins.** The picture comes from pitchdeck-visuals/11_cv_deteksi crops, and GPS is fixed. The detection is real, on a closer crop of jalan-berlubang.jpg: the full photo gets no detection (highest candidate 0.22).",
          "- **Contractor stage photos are crops of perbaikan-kebumen.jpg,** not photos of those stages. Keep them brief on screen.",
          "- **The marker photo has a real ArUco card pasted on,** so the real marker code runs on a composed image.",
          "- **The duplicate is the same photo framed differently,** so its similarity score is on the high side. The 85% threshold comes from 7 photos and is not calibrated locally.",
          "- **Staff names are invented,** on real agency names. These agencies do not use this product. Say so in the video or deck, for example with the \"Example region\" label.",
          "- **The decree in 03b is cited by number only.** Its date was not found in any source, so none was typed.",
          "- **Costs:** crew size and output are ASSUMED until the official AHSP coefficients are loaded; concrete shows materials only. Life comes from assumed thickness and CBR, and has not been compared with field data.",
          "- **Fast-track concrete is the one borrowed price:** Tangerang × IKK, labelled ASSUMED and named on screen. The asphalt and K-350 prices are Karawang's own.",
          "- **Some AI rows read 'Belum diukur'** (early-failure prediction, for example). They are true labels, not errors.",
          "- **The price import reuses real Karawang paving rows** from Perbup 28/2025, so no price is invented.",
          "- **The neutral rewrite is a word list, not GenAI.** Do not caption it as AI.",
          "- **Forbidden words:** every checkpoint read the screen text. One hit: \"uji\" in a closed dropdown option in 07d, not visible. This is a text check at checkpoints plus sampled frames, not OCR of every frame.",
          "- **Escalation dates are future dates:** cases are fresh, so no step has been reached. Nothing was backdated.",
          ""]
open(f"{KIT}/SHOTLIST.md", "w", encoding="utf8").write("\n".join(lines))

# ---- Zip
with zipfile.ZipFile("capture-kit.zip", "w", zipfile.ZIP_STORED) as z:
    for root, _, files in os.walk(KIT):
        for f in files:
            if not f.endswith(".tmp.mp4"):
                z.write(os.path.join(root, f))
print("zip MB", round(os.path.getsize("capture-kit.zip") / 1e6, 1), "stills", len(os.listdir(f"{KIT}/stills")), "assets", sorted(os.listdir(assets))[:8])
print("pinn", pinn.get("elapsed_ms"), pinn.get("samples"))
print({k: scenes["clips"][k]["seconds"] for k in ROW})
