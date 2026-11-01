# 05 — Capture and Measurement (v5)

> Machine-readable twin: `data/damage_classes.json`. Research basis: note 07 (pengukuran & ketahanan), note 08 §6 (privacy), note 09 §1 (datasets). Every threshold below is a **design default, configurable in `config/capture.json`**, unless a source is cited. Thresholds marked "needs local calibration" come from note 07 Q8 Gaps and must be validated before any accuracy claim.

---

## 1. Principles (who measures what)

| Who | Provides | Never provides | Why |
|---|---|---|---|
| Citizen | Detection, location, damage class, **size band**, photos, trace of long damage | Depth, precise cm/m² | One uncalibrated photo gives ~11% mean (up to 23.5%) width/length error even with a reference + homography (ISPRS Annals X-4-W7-2025 p.75). Bands are honest; cm are not. |
| Field Inspector | Measurements that hold up in a dispute: marker-card scale, straightedge + ruler depth photo with typed value, taped cross-widths, GPS trace | AI-only depth | Depth severity bands are 13/25/50 mm (FAA PAVEAIR, mirrors ASTM D6433) — needs mm-level measurement; monocular AI gives relative depth only (arXiv 2504.13648, 2505.21049). |
| AI | Class, mask, size band, ruler reading cross-check, marker-based area, duplicate search | The official depth value; any final decision | AI is a plausibility check; humans record the value. |

Every stored number has `{value, uncertainty, unit, method, status}` where status ∈ `MEASURED | INPUT | ASSUMED | AI_ESTIMATE | DEMO`.

---

## 2. Citizen capture flow (single site)

### 2.1 UX steps
| # | Screen | What happens | Plain-English copy |
|---|---|---|---|
| 1 | Report (FAB) | Mode choice **before** camera: "One spot" / "Large or long damage" | "Is the damage small enough to fit in one photo?" |
| 2 | Permission | Camera + location permission prompt (explain why) | "We need the camera and your location to send the report to the right agency." |
| 3 | Live camera | `getUserMedia({video:{facingMode:"environment"}})`; client calls `POST /api/capture/nonce`; live GPS accuracy chip; speed lock | "Point at the damage. Keep the road edge in view." |
| 4 | On-device quality | Blur (variance of Laplacian), exposure, tilt (DeviceOrientation) checks; "Help me aim" optional 1 s checks (v4 F8) | "Too dark" / "Hold still" |
| 5 | Shot 1 overview | ~1.5 m back, shows lane and context | "Step back. Show the whole lane." |
| 6 | Shot 2 close-up | Burst of 3 frames over ~1 s + DeviceMotion samples during burst | "Now closer." Optional: "Put your shoe or a bottle next to it (helps size)." |
| 7 | Review | AI class + size band (e.g. "Pothole · medium 0.1–0.5 m²"), authority + basis + confidence, blurred preview | "This road is managed by: Suku Dinas Bina Marga Jakarta Timur (estimated from map data)." |
| 8 | Duplicate prompt | If candidates exist (§4) | "Someone reported this 3 days ago. Add your photo to it?" |
| 9 | Submit | `POST /api/workflow/reports` | "Sent. We will tell you when the agency answers." |

### 2.2 Data captured (per report)
`nonce`, evidence ids, for each evidence: SHA-256 of each burst frame (client) + server SHA-256 of stored original, pHash, server receive time, client time (stored but untrusted), GPS `{lat, lon, accuracy_m, speed_mps, heading, timestamp}`, DeviceMotion summary `{n, accel_rms, rot_rms}` (no raw stream kept), DeviceOrientation pitch/roll at shutter, device pseudonym, app version, `capture_trust`.

Not captured: EXIF (stripped server-side, keep v4 `photoValidation.ts` JPEG APP1–APP15/COM stripping), reporter's continuous location, contacts, device fingerprint.

---

## 3. Anti-fake and privacy checks

### 3.1 Checks
| # | Check | Where | Default | On fail |
|---|---|---|---|---|
| A-1 | Live camera only (no `<input type=file>`, no gallery) in production | client build | build flag `PROD_NO_UPLOAD=1` | n/a (feature absent) |
| A-2 | One-time nonce, bound to device/account + purpose; single use | server | 128-bit random, TTL 10 min; pool nonces TTL 24 h | reject `NONCE_INVALID` / `NONCE_EXPIRED` / `NONCE_USED` |
| A-3 | Server timestamp is the official time; EXIF and client time ignored for logic | server | — | — |
| A-4 | GPS accuracy | client + server | ≤ 50 m citizen; ≤ 15 m inspector (note 07 Q5 suggests ~50 m reject for citizens) | block submit (citizen); flag (inspector) |
| A-5 | Location plausibility: inside a configured region and ≤ 50 m from road network | server | 50 m | route to TRIAGE with `OFF_ROAD` flag |
| A-6 | Speed lock: capture disabled when GPS speed > 10 km/h | client | 10 km/h (v4 M1.4) | camera locked |
| A-7 | Burst liveness: 3 frames must differ slightly (natural hand motion) but not be identical, and motion RMS > 0 during burst | server | identical-frame hash → suspicious; motion absent → lower trust (iOS may deny motion permission) | flag `LOW_LIVENESS`, no reject |
| A-8 | Screen/print recapture detector (moiré / screen-border classifier) | inference | model optional; off until validated | flag `POSSIBLE_RECAPTURE` |
| A-9 | Exact reuse: SHA-256 of original equals any stored evidence | server | exact | reject `DUPLICATE_EVIDENCE` |
| A-10 | Near-duplicate: pHash (64-bit DCT) Hamming distance | server | ≤ 8 → candidate duplicate (needs local calibration; no published civic false-positive rate, note 07 Q5 Gaps) | show duplicate prompt (citizen); reject for crew/supervisor stage evidence (RC-2.2) |
| A-11 | Rate limits | server | per device 10 reports/day, per IP 30/day, per 100 m cell 20/day (design defaults) | `RATE_LIMITED` |
| A-12 | Trust score (hidden) | server | inputs: share of past reports accepted, independent corroboration, OTP tier; never shown | affects queue order only, never auto-reject |
| A-13 | C2PA Content Credentials (if image carries a manifest, e.g. Pixel 10) | server | verify signature if present | extra evidence badge `C2PA_VERIFIED`; absence is normal |
| A-14 | Proof of work / CAPTCHA on submit for trust tier 0 when rate signals spike | server | off by default | challenge |

Honesty note for judges and docs: "On the web we cannot prove a photo came from a genuine device. We make faking expensive (live camera, one-time code, server time, GPS, motion, duplicate search) and we verify on site. Hardware-backed proof (Play Integrity, Key Attestation, C2PA) needs a native app — planned for inspectors (§9)." (Basis: MDN on `capture` attribute allowing existing files; Play Integrity is Android-app only — note 07 Q5.)

### 3.2 Privacy processing (UU 27/2022)
1. Strip EXIF/XMP/COM (JPEG) and textual/eXIf chunks (PNG) — keep existing `photoValidation.ts`.
2. Detect faces and licence plates (inference service); produce **public derivative** with Gaussian blur / pixelation; `blur_applied=true` required before any public display, share card or document.
3. Encrypt original with a per-evidence data key (AES-256-GCM), key wrapped by KMS key; store `enc_key_id` (crypto-shredding = delete data key).
4. Event log commits to `sha256_public` and `sha256_original_enc` only (hash of ciphertext), never to raw image bytes or personal data (07 §5).
5. Original access (`evidence.request_original`) only for FIELD_INSPECTOR/COORDINATOR/AUDITOR in scope, reason required, logged as event.

---

## 4. Duplicate detection and merge

| Step | Rule (defaults) |
|---|---|
| Candidate search | open cases (not CLOSED/MERGED) within **25 m** of the snapped point **on the same segment** (or the same toll/non-toll level), class compatible (pothole ↔ pothole/alligator area; crack ↔ crack), created ≤ 180 days ago; plus any case whose evidence pHash distance ≤ 8 |
| Citizen prompt | show up to 3 candidates with blurred thumbnail, age, state; default choice "Add my photo to this report" |
| Citizen adds | new `report` row linked to existing case; witness +1; evidence appended; no new case |
| Citizen says "different" | new case created with `duplicate_candidates` stored; coordinator sees the pair |
| Coordinator merge (`MERGE`) | final decision; merged case → `MERGED`, pointing to target; target inherits earliest `created_at` for ladder, union of evidence, witness count, reporters (for notifications) |
| Large damage overlap | if a trace buffer (trace ± 5 m) contains existing single-spot cases, they are listed for merge into the trace case (coordinator decides) |
| Never | auto-merge by AI; merge across authorities without transfer |

Metric to report later: unique defects vs tickets (note 02 §2: Jakarta counts tickets, not unique potholes).

---

## 5. DEMO MODE capture

Follows `02_SPEC_v5.md` §9. Capture-specific rules:
- The camera screen shows a small **text link** "Use a sample photo (demo)" (raw requirement: gallery upload becomes a text link for demo only). Production build does not contain it.
- Sample photos come from `public/demo/samples/` with source and licence (e.g. RDD2022 CC BY-SA 4.0, BPID CC BY 4.0 — attribution required).
- Nonce, GPS and motion checks run and show "would be rejected in production: GPS accuracy 120 m" without blocking.
- Every evidence row: `is_demo=true`, `demo_source`, visible "DEMO" watermark; separate `demo` event chain.
- A sample trace replay (`public/demo/traces/*.geojson`) can drive the large-damage mode in a browser without walking; replay is labelled DEMO.

---

## 6. Large / long damage — GPS trace mode

### 6.1 When
User chooses "Large or long damage" **before** capture (step 1). Use when the damage does not fit in one photo (long cracking, long series of potholes, wide rutting, broken road over tens of metres; e.g. the Lampung 2023 case type).

### 6.2 UX steps
| # | Step | Detail |
|---|---|---|
| 1 | Safety screen | "Walk on the road edge or sidewalk. Do not stand in traffic." Vehicle use blocked for citizens (speed lock > 10 km/h). |
| 2 | Go to one end | "Stand at the start of the damage." Map shows live accuracy circle; Start enabled when accuracy ≤ 20 m (citizen) / ≤ 10 m (inspector). |
| 3 | Start | `POST /api/traces` with nonce; first photo forced (start point). `watchPosition({enableHighAccuracy:true, maximumAge:0})`. |
| 4 | Walk | Progress bar "12 m walked · next photo in 5 m"; vibration/sound prompt every **15–20 m** (shared decision); user may add more photos any time; **no upper limit**. Screen-on (Wake Lock API where available). |
| 5 | End | "Stand at the end of the damage." End enabled when ≥ 3 photos and ≥ 10 m walked; last photo forced (end point). |
| 6 | Width | Citizen: choose "Part of one lane / One lane / Whole road" (stored as hint only; area uses default lane width 3.5 m labelled `ASSUMED` until inspector confirms). Inspector: ≥ 3 taped cross-widths with photos. |
| 7 | Review | Map of trace, length ± uncertainty, quality badge, photo strip, authority per part (if trace crosses an authority boundary → case split, §6.5). |
| 8 | Submit | `POST /api/traces/:id/end` then `POST /api/workflow/reports` with `mode:"TRACE"`. |

### 6.3 Data captured
Trace points `{lat, lon, accuracy_m, speed_mps, heading, t}` at ~1 Hz (target; browsers may deliver less), photos with nonce (one trace nonce + per-photo sub-nonce derived server-side), DeviceMotion step-energy summary per 5 s window, start/end server times, user width hint.

### 6.4 Validation rules
| # | Rule | Default | Source / status | Result |
|---|---|---|---|---|
| T-1 | Fix accuracy filter for length computation | drop fixes > 10 m (inspector) / > 20 m (citizen) | note 07 Q4 (10 m for officer) / citizen value design | dropped fixes counted |
| T-2 | Continuity: max gap between kept fixes | 15 s | note 07 Q4 | gap → trace break; > 1 break → `quality=LOW` |
| T-3 | Walking speed plausibility (between kept fixes, 5 s window) | 0.5–2.0 m/s typical; hard limits 0.2–2.5 m/s | note 07 Q4 (0.5–2 m/s on foot) | outside hard limits → `SPEED_IMPLAUSIBLE` |
| T-4 | Motion consistency: step/vibration energy present while position advances | RMS > device baseline | note 07 Q4 (design) | absent → `LOW_LIVENESS` |
| T-5 | Photo count | ≥ 3, no maximum | shared decision | block End |
| T-6 | Photo spacing | every 15–20 m prompted; a gap > 40 m between photos | shared decision / design | `PHOTO_GAP` flag |
| T-7 | Photo on trace | photo GPS within (its accuracy + 5 m) of the trace polyline | note 07 Q4 | `PHOTO_OFF_TRACE` |
| T-8 | Timestamps monotonic and inside [start, end] window | server times | note 07 Q4 | reject photo |
| T-9 | Road adherence | ≥ 80% of kept fixes within 30 m of the snapped segment chain | design | `OFF_ROAD` |
| T-10 | Median accuracy | > 10 m → `confidence=LOW` | note 07 Q4 | label |
| T-11 | Minimum length | 10 m (shorter → suggest "One spot" mode) | design | prompt |

`quality`: HIGH = no flags and median accuracy ≤ 5 m; MEDIUM = ≤ 1 non-blocking flag, median ≤ 10 m; LOW = otherwise.

### 6.5 Length, area and splitting
- **Length:** polyline length after (a) dropping filtered fixes, (b) a simple smoother (e.g. 5-point moving median on projected coordinates, UTM zone of the region) to remove jitter below accuracy. `L = Σ |p_i − p_{i−1}|`.
- **Length uncertainty (design formula, label `ASSUMED` method):** `σ_L = sqrt(σ_start² + σ_end² + (k · median_acc)²)` where `σ_start/σ_end` = accuracy radius at the start/end fix (Android accuracy is a 68% radius, note 07 Q4) and `k = 0.1 · sqrt(n_kept)` as a path-jitter term. Show "47 m ± 6 m". Must be validated against tape/measuring-wheel on ≥ 10 traces before being called accuracy.
- **Area:** `A = Σ L_i × w_i` with widths at taped stations (trapezoid between stations). Citizen trace: `A = L × 3.5 m` labelled `ASSUMED` ("default lane width"), shown as a band, until the inspector confirms widths.
- **Routing a trace (aligned with `04_AUTHORITY_ROUTING.md` §4.1):** route by the trace midpoint when ≥ 80% of the trace snaps to segments of the same status and office (DESIGN). Otherwise split the trace at the status/office boundary: one case per office, cases share a `group_id` and link to each other.

---

## 7. Damage taxonomy

### 7.1 Classes (summary; full data in `data/damage_classes.json`)
| App code | RDD2022 | English | Indonesian | AI detector trained? | Who measures what |
|---|---|---|---|---|---|
| `LONG_CRACK` | D00 | Longitudinal crack | Retak memanjang | yes (RDD2022 + RDD_Indonesia "Retakan_Memanjang") | length (trace/tape), width (crack gauge/ruler photo) |
| `TRANS_CRACK` | D10 | Transverse crack | Retak melintang | yes ("Retakan_Melintang") | length, width |
| `ALLIGATOR` | D20 | Alligator / fatigue cracking | Retak buaya / retak kulit buaya | yes ("Retakan_Buaya") | area (marker/tape), share of segment |
| `POTHOLE` | D40 | Pothole | Lubang | yes ("Lubang") | area + max depth (ruler) + count |
| `RUTTING_DEPRESSION` | – | Rutting / depression / corrugation | Alur / amblas / bergelombang | **no** (human-selected) | depth under straightedge, length |
| `EDGE_BREAK` | – | Edge break | Kerusakan tepi | no | length, width |
| `RAVELLING` | – | Ravelling / loss of aggregate | Pelepasan butir | no | area |
| `PATCH_FAILURE` | – | Failed patch | Tambalan rusak | no (later: train on follow-up photos) | area, failure mode (08 §4) |
| `STANDING_WATER` | – | Standing water on road | Genangan | no (CLIP triage only, `AI suspects`) | area; triggers drainage note |
| `SEVERE_BREAKUP` | – | Road broken up over a large area | Rusak berat / rusak total | no | trace mode area |
| `OTHER_ASSET` | – | Bridge / sidewalk / drainage / road furniture | Jembatan / trotoar / drainase / perlengkapan jalan | CLIP zero-shot triage only (v4 M1.2), always `NEEDS_HUMAN` | routed by asset rule |

Dataset/model honesty (shared decision): report detection mAP/F1 on a **held-out, location-split** test incl. Indonesian images (BPID Bandung, 50 images, CC BY 4.0; RDD_Indonesia 8,397 images, CC BY 4.0, provenance undocumented → de-duplicate against RDD2022 first). RDD2022 has no Indonesian images. Ultralytics is AGPL-3.0; Apache-2.0 alternative path: RT-DETR (PekingU/rtdetr_r18vd) exported to OpenVINO.

### 7.2 Pothole severity (inspector only; max depth × average diameter)
Source: FAA PAVEAIR "Levels of severity for potholes" (mirrors ASTM D6433 PCI; original standard paywalled, not read).

| Max depth \ Avg diameter | 100–200 mm | 200–450 mm | 450–750 mm |
|---|---|---|---|
| 13 – ≤ 25 mm | L | L | M |
| > 25 – ≤ 50 mm | L | M | H |
| > 50 mm | M | M | H |

Edge rules (`TODO_VERIFY(ASTM D6433-23 counting rules)`): depth < 13 mm or diameter < 100 mm → not rated as pothole (record as `RAVELLING`/surface defect); diameter > 750 mm → rate by area as alligator cracking/patching per the standard's area rule. Water-filled: inspector must still measure with ruler; AI depth plausibility disabled; flag `WATER_PRESENT` (note 07 Q2).

### 7.3 Citizen size bands
| Mode | Band | Range | Label |
|---|---|---|---|
| One spot | `S` small | < 0.1 m² | from note 07 Q8 |
| One spot | `M` medium | 0.1 – 0.5 m² | |
| One spot | `L` large | > 0.5 m² | |
| Trace | `T1` | 10 – 50 m | design default |
| Trace | `T2` | 50 – 200 m | design default |
| Trace | `T3` | > 200 m | design default |

Bands come from the segmentation mask with a coarse scale (optional shoe/bottle cue, camera intrinsics + tilt as sanity check only — note 07 Q1 says IMU-only scale is weak). Displayed with status `AI_ESTIMATE`. Citizen UI never shows cm.

### 7.4 SDI notes (Bina Marga, Manual Konstruksi dan Bangunan No. 001-01/BM/2011)
Per 100 m segment (as reported in a secondary paper, Jurnal Vokasi Sains & Teknologi UNG):
- SDI1 crack area: none → 0; < 10% → 5; 10–30% → 20; > 30% → 40.
- SDI2 crack width: > 3 mm → SDI1 × 2 (**inconsistency:** the same source uses > 5 mm in a worked example → `TODO_VERIFY(Manual 001-01/BM/2011 original)`).
- SDI3 potholes per 100 m: < 10 → +15; 10–30 → +75; > 30 → +225.
- SDI4 rut depth: < 1 cm → +5 × 0.5; 1–3 cm → +5 × 2; > 3 cm → +5 × 4.
- Condition: Baik < 50; Sedang 50–100; Rusak Ringan 100–150; Rusak Berat > 150.

SDI counts potholes but does **not** score their depth or size, so PAVEMENT-PINN stores both: per-distress records (class, geometry, area, length, width, max depth, ASTM-style severity) and a computed SDI per 100 m. SDI shown with label "computed from app records, not an official survey".

### 7.5 Repair-type mapping
Typical convention (note 07 Q3: **not sourced**): L/M pothole → patching (hot-mix full-depth preferred; cold mix as temporary); widespread D20 or many potholes per segment → overlay or mill-and-inlay; Rusak Berat with structural failure → reconstruction. Status `TODO_VERIFY(Bina Marga Pd/SE mapping SDI/IRI to pemeliharaan rutin/berkala/rehabilitasi/rekonstruksi)`. In the app this mapping only **pre-fills** the inspector's plan; the inspector chooses.

---

## 8. Field Inspector measurement protocol

### 8.1 Kit (issued at onboarding)
| Item | Spec (design) | Purpose |
|---|---|---|
| Marker card | ArUco (DICT_4X4_50) or AprilTag 36h11, **200 × 200 mm** black square, rigid, matte, printed ID; card ID registered to inspector | metric scale + tilt (homography from 4 corners) |
| Straightedge | aluminium bar ≥ 1.0 m (1.2 m preferred) | reference plane for depth/rut |
| Ruler / depth gauge | steel rule with mm ticks, high-contrast | depth at deepest point |
| Tape | 5–10 m | cross-widths, cut size |
| Crack gauge (optional) | printed width card 0.5–10 mm | crack width class |
| Phone | GPS + camera; Android Chrome for optional WebXR | capture |

### 8.2 Steps
| # | Step | Required evidence | Server checks |
|---|---|---|---|
| 1 | Safety / hazard | `HAZARD_SIGN` photo if signage placed | — |
| 2 | Overview | `OVERVIEW` photo showing lane, context, defect | GPS ≤ 15 m |
| 3 | Marker nadir | Card flat **beside** (not inside) the defect, phone near-nadir (≤ 30° from vertical), whole defect + card in frame | marker detected; marker side ≥ 120 px; estimated tilt ≤ 30°; sharpness ok; else reject with "Retake: card too small / too tilted / blurred" |
| 4 | Area | Server: segmentation mask → homography → area, max length, max width (§9) | if defect extent > 10 × card side → require tape rectangle or second card |
| 5 | Depth (potholes, ruts, depressions) | `DEPTH_RULER` photo: straightedge across the defect, ruler vertical at deepest point, ticks readable, taken from the side at 30–45° (note 07 Q2); **typed depth in mm** | AI ruler reading (OCR/tick detection) vs typed value; |Δ| > 5 mm → `RULER_MISMATCH`; unreadable → `AI_UNREADABLE`; monocular depth map (Depth Anything V2 on OpenVINO) checks region is a depression → `NOT_A_DEPRESSION?` flag. AI value is **never** stored as official depth. |
| 6 | Cracks | width card/ruler close-up; length by tape or trace | — |
| 7 | Long damage | trace (§6) with ≥ 3 taped cross-width photos (`CROSS_WIDTH`) | T-1…T-11 |
| 8 | Classification | confirm/correct AI class (feeds learning loop) | correction logged |
| 9 | Severity | computed from §7.2 (potholes) or crack width class; inspector may override with reason | override logged |

### 8.3 Tolerances (all configurable; "needs local calibration")
| Parameter | Default | Basis |
|---|---|---|
| Ruler OCR vs typed depth | 5 mm | note 07 Q2/Q8 (design choice) |
| Marker minimum side in image | 120 px | design |
| Marker max tilt | 30° | design |
| Marker-area vs tape-area difference | 15% → flag | design; validate vs 30–50 potholes (note 07 Q1 Gaps) |
| Declared crew tonnage vs measured volume × density | 15% → flag | design |
| GPS accuracy inspector | 15 m (single), 10 m (trace fixes) | note 07 Q4 |
| Depth near severity boundary | if |depth − boundary| ≤ 2 mm → "borderline" badge | design |

### 8.4 Optional measurement aids
- **WebXR hit-test** (Android Chrome 81+ only; not on iOS Safari) can give an extra distance reading; stored as supporting evidence, status `AI_ESTIMATE`.
- **LiDAR/ToF** (native, roadmap): ±1–3 cm (Poliba 2022) — coarser than 13/25 mm boundaries, so supporting only.

---

## 9. Area computation

1. Detect the 4 marker corners (sub-pixel). Known side `s = 0.200 m` → homography `H` from image to a metric road plane (local planarity assumed).
2. Map mask boundary pixels through `H`; compute polygon area (shoelace) `A`, max Feret length, width perpendicular to road axis (axis from segment bearing).
3. Uncertainty (design, `ASSUMED` method): corner localisation error `ε_px` (default 1.5 px) propagated by Monte Carlo (200 draws perturbing corners) → `σ_A`; plus mask boundary uncertainty (dilate/erode mask by 1 px → ΔA/2). Report `A ± σ_A`. Distance from card increases error; if the defect's far edge is > 10 × `s` from the card, require tape.
4. Without card: area from mask + coarse scale → **size band** only, status `AI_ESTIMATE`.
5. Patch quantity for cost (not the same as defect area): `cut_area = defect bounding rectangle + margin m` on each side, `m` default 0.30 m (common practice, **not sourced** → `ASSUMED`, note 07 Q6); `volume_m3 = cut_area × patch_depth`, where patch_depth = max(measured depth, design layer thickness chosen in plan). Cost engine item 11.1.(9) is priced per m³ (`TODO_VERIFY` coefficients, SE 30/SE/Dk/2025 Lampiran V).
6. Long damage: `A = Σ ½ (w_i + w_{i+1}) · L_i` between taped stations.

---

## 10. Uncertainty reporting

| Quantity | Shown as | Status | Passed to cost/PINN as |
|---|---|---|---|
| Citizen size | band S/M/L or T1–T3 | `AI_ESTIMATE` | not used for cost |
| Area (marker) | `2.4 m² ± 0.3` | `MEASURED` | normal(μ, σ) |
| Area (tape) | `2.5 m²` ± tape resolution (design 0.01 m per side) | `MEASURED` | normal |
| Depth (ruler) | `38 mm` (± 1 mm reading) + cross-check badge | `MEASURED` | uniform(±1 mm) |
| Trace length | `47 m ± 6 m` | `MEASURED` (method `GPS_TRACE`) | normal |
| Width default | `3.5 m` | `ASSUMED` | uniform(3.0, 3.75) design |
| Cut margin | `0.30 m` | `ASSUMED` | uniform(0.2, 0.4) design |

UI rules: never round away uncertainty; badges are text + colour (not colour alone); "Why this number?" link shows method, evidence thumbnails and model version.

---

## 11. Validation before claiming accuracy (to do, human)
1. 30–50 potholes: marker-area vs tape area; ruler OCR vs reading; record error distribution → `measurements/measure_validation.json` (note 07 Q1/Q2 Gaps).
2. ≥ 10 traces vs measuring wheel → length error.
3. pHash false-positive rate on ≥ 500 real reports.
4. Until done, docs/UI say "accuracy not yet validated in the field".

## 12. Native inspector app (v6 roadmap, not v5)
Android app with Play Integrity (`requestHash` = SHA-256(photo ‖ GPS ‖ time ‖ nonce)), Android Key Attestation signing, C2PA where available; iOS App Attest `TODO_VERIFY` (not researched).
