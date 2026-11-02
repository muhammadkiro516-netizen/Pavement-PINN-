"""Turns the raw recordings into capture-kit/: H.264 clips at 30 fps, scenes.json, SHOTLIST.md, assets, and the zip.
Run with the inference venv's python (it has imageio_ffmpeg)."""
import json
import os
import re
import shutil
import subprocess
import zipfile

import imageio_ffmpeg

FF = imageio_ffmpeg.get_ffmpeg_exe()
RAW = ".data/capture/raw"
KIT = "capture-kit"
CLIPS = f"{KIT}/clips"
FRAMES = ".data/capture/frames"
os.makedirs(CLIPS, exist_ok=True)
os.makedirs(FRAMES, exist_ok=True)
raw = json.load(open(".data/capture/scenes.raw.json", encoding="utf8"))
TRIM = 0.4  # the blank frames before the first page


def run(*args):
    subprocess.run([FF, "-y", "-loglevel", "error", *args], check=True)


FINISHED = ".data/capture/finished"


def encode(name, dst):
    # The disk may be tight: a finished clip replaces its raw frames, and a finished clip is not done twice.
    done = f"{FINISHED}/{name}.mp4"
    if os.path.exists(done):
        shutil.copyfile(done, dst)
        return
    raise SystemExit(f"clip {name} was not recorded")
    first = sorted(f for f in os.listdir(f"{RAW}/{name}") if f.endswith(".jpg"))[0]
    probe = subprocess.run([FF, "-i", f"{RAW}/{name}/{first}"], capture_output=True, text=True).stderr
    w, h = map(int, re.search(chr(40) + chr(92) + "d{3,5})x(" + chr(92) + "d{3,5})", probe).groups())
    target = "1170:2532" if h > w else "1920:1080"
    os.makedirs(FINISHED, exist_ok=True)
    run("-f", "concat", "-safe", "0", "-i", f"{RAW}/{name}/list.txt", "-ss", str(TRIM), "-vf", f"scale={target}:flags=lanczos,fps=30,format=yuv420p", "-c:v", "libx264", "-preset", "fast", "-crf", "20", "-an", done)
    if duration(done) <= 0:
        raise SystemExit(f"bad clip {name}")
    shutil.rmtree(f"{RAW}/{name}")
    shutil.copyfile(done, dst)


def duration(path):
    out = subprocess.run([FF, "-i", path], capture_output=True, text=True).stderr
    h, m, s = re.search(r"Duration: (\d+):(\d+):([\d.]+)", out).groups()
    return round(int(h) * 3600 + int(m) * 60 + float(s), 1)


SINGLE = ["01_citizen_report", "01b_long_damage", "01c_low_confidence", "01d_not_onboarded", "02_agency_login", "02b_team_codes", "03_om_today_inbox", "03c_owner_map", "04_fe_field_pinn_cost", "04b_offline_queue", "04c_quality_tests", "07_auditor_verify", "07b_price_import", "07d_neutral_copilot", "08_citizen_confirm"]
JOIN = {"03b_transfer": ["03b_transfer", "03b_transfer_confirm"], "05_approval_sod": ["05a_self_approval_refused", "05b_second_om_approves"], "06_contractor_verify": ["06a_contractor", "06b_fe_verify", "06c_guest_code_ended_followups"]}

for name in SINGLE:
    encode(name, f"{CLIPS}/{name}.mp4")

offsets = {}
for name, parts in JOIN.items():
    tmp = []
    at = 0.0
    for part in parts:
        out = f".data/capture/{part}.tmp.mp4"
        encode(part, out)
        tmp.append(out)
        offsets[part] = (name, at)
        at += duration(out)
    with open(".data/capture/list.txt", "w") as f:
        for t in tmp:
            f.write(f"file '{os.path.basename(t)}'\n")
    run("-f", "concat", "-safe", "0", "-i", ".data/capture/list.txt", "-c", "copy", f"{CLIPS}/{name}.mp4")

# Original next to the modified copy, on one 1920x1080 frame.
encode("07c_verify_original", ".data/capture/orig.tmp.mp4")
encode("07c_verify_modified", ".data/capture/mod.tmp.mp4")
run("-i", ".data/capture/orig.tmp.mp4", "-i", ".data/capture/mod.tmp.mp4", "-filter_complex",
    "[0:v]scale=-2:1040,pad=960:1080:(ow-iw)/2:(oh-ih)/2:color=0B0D10[a];[1:v]scale=-2:1040,pad=960:1080:(ow-iw)/2:(oh-ih)/2:color=0B0D10[b];[a][b]hstack=inputs=2,fps=30,format=yuv420p",
    "-c:v", "libx264", "-crf", "20", "-preset", "medium", "-an", "-shortest", f"{CLIPS}/07c_verify_tampered.mp4")

# Frames to check by eye before zipping.
sizes = {}
for f in sorted(os.listdir(CLIPS)):
    p = f"{CLIPS}/{f}"
    base = f[:-4]
    d = duration(p)
    sizes[base] = d
    run("-i", p, "-frames:v", "1", "-vf", "scale=-2:540", f"{FRAMES}/{base}_first.png")
    run("-ss", str(max(d - 0.3, 0)), "-i", p, "-frames:v", "1", "-vf", "scale=-2:540", f"{FRAMES}/{base}_last.png")

# scenes.json: marks are seconds into the delivered clip.
out = {"engine": raw["data"].get("engine"), "detection": raw["data"].get("detection"), "cases": {k: raw["data"].get(k) for k in ["caseA", "caseB", "caseC", "caseD", "caseDuplicate"]}, "onScreenIssues": raw["issues"], "clips": {}}
for name, scene in raw["scenes"].items():
    if "marks" not in scene and name not in sizes:
        continue
    target, base = offsets.get(name, (name, 0.0))
    entry = out["clips"].setdefault(target, {"seconds": sizes.get(target), "keyMoments": {}})
    for k, ms in scene.get("marks", {}).items():
        entry["keyMoments"][k] = round(ms / 1000 - TRIM + base, 2)
    for k, v in scene.items():
        if k not in ("marks", "kind", "recordedAt"):
            entry[k] = v
    entry["recordedAt"] = scene.get("recordedAt", entry.get("recordedAt"))
for name in ["05_approval_sod", "06_contractor_verify", "07c_verify_tampered"]:
    if name in raw["scenes"]:
        entry = out["clips"].setdefault(name, {"seconds": sizes.get(name), "keyMoments": {}})
        entry.update({k: v for k, v in raw["scenes"][name].items() if k not in ("marks", "kind", "recordedAt")})
json.dump(out, open(f"{KIT}/scenes.json", "w", encoding="utf8"), ensure_ascii=False, indent=1)

# Assets
assets = f"{KIT}/ui-assets"
os.makedirs(f"{assets}/icons", exist_ok=True)
src = open("src/features/roles/Modules.tsx", encoding="utf8").read()
for name, d in re.findall(r"^\s*(\w+): '(M[^']+)',?$", src, re.M):
    open(f"{assets}/icons/{name}.svg", "w").write(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="{d}"/></svg>\n')
json.dump({
    "background": "#0B0D10", "card": "#15181D", "border": "#2A2F37", "textMuted": "#A1A1AA",
    "accentYellow": "#FFD60A", "accentYellowBrand": "#FFC72C", "accentOrange": "#FF6B2C", "good": "#2BD67B", "warnRed": "#FF6B6B",
    "roles": {"OM": "#FFC72C", "FE": "#22D3EE", "Auditor": "#A78BFA", "Kontraktor": "#FF6B2C"},
    "pavi": {"citizenHelmet": "#FF6B2C", "agencyHelmet": "#FFC72C"}
}, open(f"{assets}/colors.json", "w"), indent=1)

print(json.dumps(sizes, indent=0))
print("mb", round(sum(os.path.getsize(f"{CLIPS}/{f}") for f in os.listdir(CLIPS)) / 1e6, 1))
print("issues", raw["issues"])
