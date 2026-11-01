# Measuring road damage from a phone, mapping long damage, and checking whether repairs last (PAVEMENT-PINN, note 07: pengukuran & ketahanan)

Scope: low-cost, tamper-resistant ways to measure area, length, width and depth of damage; to map damage longer than one photo; and to check that a repair will last. Covers (A) citizen capture, (B) field-officer measurement and (C) post-repair verification. The target is phones plus Intel laptops running OpenVINO.

Research date: 2026-11-01. Every number below includes its test conditions. Anything that has no source is listed under Gaps.

---

## Q1. Area, width and length from one phone photo (segmentation plus metric scale)

### Takeaway
Segmentation is good enough. YOLOv8-seg reaches mAP@50 of 0.71 to 0.94 for potholes, depending on dataset and setup. The weak point is metric scale. If one photo is scaled with a reference in the scene and a homography (IPM), width and length errors average about 11%, and some single images exceed 20%. Errors fall to a few percent or a few centimetres only with a depth sensor (RealSense, LiDAR) or with multi-view photogrammetry that has coded targets or GCPs. Browser AR hit-testing (WebXR) works only in Chrome-based browsers on Android. Safari on iOS still lacks `immersive-ar`. The practical choices are therefore (a) a printed fiducial card (ArUco or AprilTag) in the frame, or (b) a native app with ARCore/ARKit or LiDAR.

### Cited Findings
- **Single image + reference object + 4-point homography (IPM) + YOLOv8n-seg.** A scaled object in a reference image gives the 4 calibration points and the px→mm ratio. Calibration has to be redone for each camera setup. Mean width and height error was about **11.30%**. Per-image errors ran from 0.20% to **23.54%**, and errors grew in the last three images, which the authors attribute to camera vibration while driving. Mask metrics: precision 0.745, recall 0.610, mAP@0.5 0.708, mAP@0.5–0.95 0.396. — [ISPRS Annals X-4-W7-2025, p.75](https://isprs-annals.copernicus.org/articles/X-4-W7-2025/75/2025/isprs-annals-X-4-W7-2025-75-2025.pdf)
- **Depth camera (Intel RealSense D415) + enhanced YOLOv8-seg.** The depth reference is the median depth of pothole-free road pixels. Boundary pixels are converted to metric units with the camera intrinsics. Perimeter error ranged from −3.2 to +1.7 cm (mean about **±2.3 cm**) and depth error from −0.2 to +0.3 cm (mean about **±0.24 cm**), but **only 5 test images** were checked, and area and volume were not reported. Segmentation mAP@50 was 93.8 ± 0.4% against 91.9% for the YOLOv8n-seg baseline. The 1,000-image dataset is 640×480 and was captured on foot with a portable rig. — [arXiv 2505.04207](https://arxiv.org/pdf/2505.04207)
- **Monocular metric depth (Depth Anything V2, distilled to 86.2 MB) + pinhole back-projection for area, from a vehicle camera.** The authors state there is **no ground truth for area**. They report only frame-to-frame consistency (MAE, CV, AFD), not absolute accuracy. Lens distortion is ignored and potholes are assumed elliptical (×π/4). — [arXiv 2505.21049](https://arxiv.org/html/2505.21049v1)
- **Citizen smartphone photos + Structure-from-Motion, scaled by smartphone GNSS** (sidewalk potholes, Univ. Calgary). Scale error was about **12%**, perimeter differed by about **35 cm**, and maximum depth differed by **<1 cm**. — [UCalgary PRISM thesis](https://prism.ucalgary.ca/items/9c92a43a-1d56-458f-9e8d-acc0794110df/full)
- **Multi-view photogrammetry with GCPs against a terrestrial laser scanner** (GoPro at about 2 m on a monopod, 32 potholes of 0.21–1.70 m², 45 m road). Volume RMSE was **0.16–0.18 dm³** and R² **0.985–0.991** for oblique capture. Surface deviation (M3C2) had mean −0.007 m and SD 0.02 m. Nadir-only capture left gaps. Six GCPs surveyed by total station and RTK were required, and the process involves a lot of manual work. — [ISPRS Archives XLVIII-2-W8-2024, p.77](https://isprs-archives.copernicus.org/articles/XLVIII-2-W8-2024/77/2024/isprs-archives-XLVIII-2-W8-2024-77-2024.pdf)
- **Smartphone close-range photogrammetry with 4 coded targets** (Huawei Mate 10 lite, small objects, not pavement). Volume error was **0.67–3.19%** and surface-area error **0.50–1.89%**. The authors say the results are limited to small objects. — [MDPI Appl. Sci. 12(3):1053](https://mdpi.com/2076-3417/12/3/1053/htm)
- **ARCore-based pixel scaling** (Pixel 8 Pro app measuring concrete cracks). The smallest width measured reliably was **0.33 mm at 15 cm** and 0.50 mm at 20 cm, with about 0.0825 mm per pixel at 15 cm. — [Jeng, Chao & Chen, Eng 6(6):122, 2025](https://www.mdpi.com/2673-4117/6/6/122)
- **ArUco-based crack marker (PMC) glued across a crack.** Claimed accuracy is ≤0.05 mm at 0.3–50 m. Tests showed RMS 0.012–0.048 mm, with a 0.13 mm spread at 50 m. A digital camera was used, not a phone. — [ISPRS Archives XLVI-5-W1-2022, p.245](https://isprs-archives.copernicus.org/articles/XLVI-5-W1-2022/245/2022/isprs-archives-XLVI-5-W1-2022-245-2022.pdf)
- **WebXR Hit Test Module** casts a ray into the real world and returns the intersection with a physical surface (plane, point or mesh). It is still an Editor's Draft (11 Dec 2025). The MDN compatibility tables bundled with the spec show support **only in Chrome 81+**, and other engines show none. — [W3C Immersive Web, Hit Test Module](https://immersive-web.github.io/hit-test); [W3C TR](https://www.w3.org/TR/webxr-hit-test/)
- Apple engineer, June 2024: *"WebXR 'immersive-ar' sessions are not supported on visionOS or iOS … even though the flag is there it is non-functional."* Developers were still waiting in March 2026. — [Apple Developer Forums thread 756850](https://developer.apple.com/forums/thread/756850)
- **Phone LiDAR (iPhone/iPad Pro).** Absolute accuracy is about **1–3 cm** "in the absence of scanning problems", with cloud-to-cloud mean deviations of 0.013–0.038 m. Drift during walking scans can more than double the deviation. Best results come at close range, under about 3 m. Roads were not tested. — [Poliba 2022, Smartphone LiDAR Technologies for Surveying](https://iris.poliba.it/retrieve/7da9a53f-82ec-4471-9402-88aec7532fe7/2022_Smartphone_LiDAR_Technologies_for_Surveying_pdfeditoriale.pdf)
- A UiTM thesis used iPhone LiDAR on a 300 m road and found that cracks, potholes and rutting can be captured "under controlled conditions". The abstract gives **no accuracy numbers**. — [UiTM IR 124779](https://ir.uitm.edu.my/id/eprint/124779)

### Inferences
- One uncalibrated photo can give a **class** (L/M/H) and a rough area band with confidence. It cannot give a defensible m² figure. A fiducial card of known size (for example a 20×20 cm ArUco or AprilTag) on the road surface fixes both scale and tilt locally, because the homography comes from the card's 4 corners. The ~11% error in the ISPRS 2025 study used a single pre-calibration with vibration. A card placed in every frame should do better, but **no study found tests this exact setup on potholes**.
- Scale from IMU plus intrinsics alone (phone height and tilt) is weak. Phone height is unknown, and a few degrees of tilt error causes large range errors at a shallow viewing angle. Use it only to sanity-check the card-based scale.
- WebXR AR measurement is not a cross-platform option for a citizen web app in 2026, because iOS Safari has none. It can be an optional extra on Android Chrome. Field officers on Android can use it, or a native ARCore app.
- For OpenVINO on Intel laptops, YOLOv8n/11n-seg is light enough to run on-device. The Depth Anything V2 distilled model (86 MB) is also feasible, but only as a relative-depth plausibility cue.

### Gaps
- No peer-reviewed study was found that measures pothole area error with a printed ArUco or AprilTag card **in every frame** from handheld phones. This needs an in-house validation of about 30–50 potholes against tape measurements.
- No published accuracy was found for IMU-tilt plus intrinsics ground-plane scaling of potholes.
- YOLO11-seg pothole metrics and Mask R-CNN against YOLO on the same pothole set were not retrieved.

---

## Q2. Pothole depth: methods, accuracy and which ones hold up

### Takeaway
Depth is the dimension most exposed to manipulation, and monocular AI does not measure it in physical units. The defensible methods, from strongest to weakest, are: a manual straightedge plus ruler photographed in the frame (the standards practice); a depth sensor (RealSense, Kinect, LiDAR) with errors of millimetres to a few percent; and multi-view photogrammetry with scale (depth error under 1 cm). Monocular depth models (Depth Anything V2, MiDaS, 3DPredicNet) give relative depth only or have no pothole ground truth. They are useful as an AI plausibility check, not as the recorded value.

### Cited Findings
- RealSense D415: depth error of about **±0.24 cm** on 5 images (−0.2 to +0.3 cm). — [arXiv 2505.04207](https://arxiv.org/pdf/2505.04207)
- Kinect: mean percentage error of **2.58% for depth** and **5.47% for volume**, tested on artificial potholes through clear, muddy and oily water. Stones caused negative-depth errors, which the authors corrected. — [Aston Research Explorer, Performance assessment of Kinect as a sensor for pothole imaging](https://research.aston.ac.uk/en/publications/performance-assessment-of-kinect-as-a-sensor-for-pothole-imaging-/)
- SfM from smartphone photos: maximum depth within **<1 cm** of reference. — [UCalgary PRISM](https://prism.ucalgary.ca/items/9c92a43a-1d56-458f-9e8d-acc0794110df/full)
- 3DPredicNet monocular depth with segmentation, trained on DSLR photos paired with 3D-scanner depth maps: AbsRel **0.062**, SqRel 0.011, RMSE 0.118, mIoU 81.05 on its own dataset, and AbsRel 0.093 on a public dataset. — [SHM 2023, DPI Proceedings](https://dpi-proceedings.com/index.php/shm2023/article/view/37016)
- Monocular depth with Kinect V2 ground truth (KFUPM, Saudi Arabia): results are **relative / normalized only**, with RMSE 1.25 and 1.74 in unstated units. There are **no cm errors**, the relative-depth formula is inconsistent, and the authors' own limitations say outputs cannot be used for severity thresholds without calibration. — [arXiv 2504.13648](https://arxiv.org/pdf/2504.13648v1.pdf)
- Monocular depth (DINOv2 ViT-g) as a pothole **detector**, using plane-fit residuals and SAM. It reports only detection F1 (0.004–0.161 for the depth detector alone), not depth accuracy, and may struggle in shade. — [BMVC 2025 DIFA workshop paper](https://bmva-archive.org.uk/bmvc/2025/assets/workshops/DIFA/Paper_2/paper.pdf)
- Depth Anything V2 for area: no ground-truth validation. — [arXiv 2505.21049](https://arxiv.org/html/2505.21049v1)
- The standards practice defines pothole severity by **maximum depth** in bands of 13–25 mm, 25–50 mm and >50 mm (see Q3), which in practice means a straightedge plus ruler or depth gauge. — [FAA PAVEAIR, Levels of severity for potholes](https://faapaveair.faa.gov/Help/Documents/levelsofseverityforpotholes.htm)
- Phone LiDAR gives about 1–3 cm absolute accuracy. That is coarser than the 13 mm and 25 mm severity boundaries, so a LiDAR depth near a boundary is ambiguous. — [Poliba 2022](https://iris.poliba.it/retrieve/7da9a53f-82ec-4471-9402-88aec7532fe7/2022_Smartphone_LiDAR_Technologies_for_Surveying_pdfeditoriale.pdf)

### Inferences
- **Recommended depth protocol, defensible and hard to fake:**
  1. **Required "ruler-in-pothole" photo.** A straightedge (≥1 m aluminium bar, or a 1.2 m rule for the officer) laid across the pothole, a ruler or depth gauge standing vertically at the deepest point, and the scale readable in the photo, taken from the side at about 30–45°.
  2. **The officer types in the depth value** (mm), and the server stores the photo hash with it.
  3. **AI plausibility check.** OCR or tick detection reads the ruler, and the read value is compared with the typed value (flag if the difference exceeds 5 mm). A monocular depth map, Depth Anything V2 run on OpenVINO, checks that the region really is a depression and that the relative depth ranking agrees. The AI value is never stored as the official depth.
  4. Optionally, where a device has LiDAR or a ToF sensor, a native app records a depth profile as supporting evidence. Treat it as ±1–3 cm.
- **Citizens should not be asked for depth.** A citizen can optionally put a common object in the hole (a bottle or a shoe) as a rough cue. Depth class is set by the officer.
- Water-filled potholes defeat a monocular model, and LiDAR/ToF does poorly through standing water. Kinect worked through water only in lab tests. The protocol should therefore require an officer measurement whenever water is present.

### Gaps
- No published pothole depth accuracy in **cm** for Depth Anything V2 or MiDaS against measured ground truth was found.
- No study validating OCR of a ruler reading inside a pothole photo was found. This needs an in-house test.
- No numeric iPhone LiDAR pothole depth accuracy was found. The UiTM abstract has none.

---

## Q3. Damage classes, severity standards, and mapping to repair type

### Takeaway
Use RDD2022 codes (D00/D10/D20/D40) for the AI detector. Use ASTM D6433-style L/M/H severity for potholes (maximum depth × average diameter). Use Bina Marga SDI for Indonesian network reporting, where SDI counts potholes per 100 m, crack area and width, and rut depth. SDI does **not** score pothole depth or size, so PAVEMENT-PINN needs both systems.

### Cited Findings
- **RDD2022**: 47,420 images from 6 countries (Japan 13,133, India 9,665, Czech Rep. 3,538, Norway 10,201, USA 6,005, China motorbike 2,477, China drone 2,401). Classes: **D00 longitudinal crack, D10 transverse crack, D20 alligator crack, D40 pothole**. D43 and D44 (marking blur) were dropped after RDD2018. Most images come from vehicle-mounted smartphones. — [arXiv 2209.08538, RDD2022](https://arxiv.org/pdf/2209.08538)
- **Pothole severity table** (maximum depth against average diameter; this matches ASTM D6433 PCI):
  | Maximum depth | 100–200 mm | 200–450 mm | 450–750 mm |
  |---|---|---|---|
  | 13–≤25 mm | L | L | M |
  | >25–≤50 mm | L | M | H |
  | >50 mm | M | M | H |
  — [FAA PAVEAIR help, Levels of severity for potholes](https://faapaveair.faa.gov/Help/Documents/levelsofseverityforpotholes.htm) (FAA help page; the original ASTM D6433 text is paywalled and was not read)
- **Bina Marga SDI** (Manual Konstruksi dan Bangunan No. 001-01/BM/2011, *Survei Kondisi Jalan untuk Pemeliharaan Rutin*), in 100 m segments:
  - SDI1 crack area: none → –; <10% → 5; 10–30% → 20; >30% → 40.
  - SDI2 crack width: >3 mm → SDI1×2.
  - SDI3 potholes per 100 m: <10 → +15; 10–30 → +75; >30 → +225.
  - SDI4 rut depth: <1 cm → +5×0.5; 1–3 cm → +5×2; >3 cm → +5×4.
  - Condition: Baik <50; Sedang 50–100; Rusak Ringan 100–150; Rusak Berat >150.
  - The source paper's tables are internally inconsistent: it uses ">3 mm" in the table but ">5 mm" in a worked example.
  — [Jurnal Vokasi Sains & Teknologi UNG](https://jurnalvokasi.ung.ac.id/jvst/index.php/jvst/article/download/46/36)

### Inferences
- Data model: store each distress as {RDD class, polygon or polyline, area m², length m, width mm, max depth mm, ASTM-style severity}. Compute SDI per 100 m segment from these, using crack-area %, potholes/100 m and rut depth. One dataset then serves both PCI-style and SDI reporting.
- Typical repair mapping (engineering convention, **not sourced here**): L/M pothole → patching (hot-mix full-depth preferred, cold mix as temporary); widespread D20 alligator cracking or many potholes per segment → overlay or mill-and-inlay; a "Rusak Berat" segment with structural failure → reconstruction. Treat these as rules to calibrate with Bina Marga guidance.

### Gaps
- The original ASTM D6433-23 text was not accessed (paywalled). Counting rules (each pothole counted individually, diameter >750 mm treated as alligator cracking or patching per the area rule) need confirming from the standard.
- No official Bina Marga pothole depth class ("kategori lubang") was found. SDI uses count only. The Pd/SE that maps SDI or IRI to treatment (pemeliharaan rutin / berkala / rehabilitasi / rekonstruksi) was not retrieved.
- No source was found for the repair-type matrix (patch / overlay / reconstruction).

---

## Q4. Damage longer or larger than one photo: GPS traces, video and dashcam surveys

### Takeaway
Phone GPS is good to about 5 m under open sky and worse among buildings and trees. Android's reported accuracy is a 68% radius. Length should therefore come from a **continuous walked or driven trace**, recorded as a polyline with at least 1 Hz fixes and an accuracy filter, not from two endpoints. Area is length times measured width: a lane width typed in, or several measured cross-widths. Smartphone accelerometer roughness tracks reference IRI moderately well (R² ≈ 0.76 in one calibrated study). It can rank segments, but it does not replace profiler IRI.

### Cited Findings
- "GPS-enabled smartphones are typically accurate to within a **4.9 m (16 ft.) radius under open sky** … accuracy worsens near buildings, bridges, and trees." — [GPS.gov (archived Dec 2020)](https://webarchive.library.unt.edu/web/20201218011422/https://www.gps.gov/systems/gps/performance/accuracy)
- Android `Location.getAccuracy()` is the "estimated horizontal accuracy radius in meters … at the **68th percentile** confidence level". It does not apply to vertical position. — [Android Location.Accuracy (Microsoft .NET-Android mirror of Android docs)](https://learn.microsoft.com/en-us/dotnet/api/android.locations.location.accuracy?view=net-android-37.0)
- Smartphone roughness study: dashboard phone, accelerometer sampled every 500 ms, 20–50 km/h, about 1 km urban arterial in Tehran. RMS vertical acceleration against Road Surface Profiler IRI gave **R² = 0.757 (r = 0.870)**, with calibration IRI = 4.19·RMS + 1.73. Run-to-run CV was 3.5–12.8%. Only 5 sections were used, and the authors did not test other phones or speeds. — [arXiv 1902.10699](https://arxiv.org/pdf/1902.10699)
- RDD2022 shows large-scale surveys from vehicle-mounted smartphones and motorbike cameras (about 30 km/h) are workable sources for damage detection. — [arXiv 2209.08538](https://arxiv.org/pdf/2209.08538)
- Single-image IPM measurement errors rise with camera vibration while driving (up to about 23.5%). — [ISPRS Annals 2025](https://isprs-annals.copernicus.org/articles/X-4-W7-2025/75/2025/isprs-annals-X-4-W7-2025-75-2025.pdf)

### Inferences
- **Protocol for long damage (officer):** tap Start at one end and walk the damaged edge at 1 Hz GPS. Drop fixes with accuracy over 10 m. Take a geotagged photo with a fiducial card **every 10–20 m** and at the start and end. Measure at least 3 cross-widths with a tape (photographed). Area = Σ(segment length × local width). Report length as trace length ± accuracy, and flag the result as low-confidence when the median reported accuracy is over 10 m.
- **Anti-faking a trace:** require a continuous trace with no gaps over about 15 s. Check walking speed is plausible (0.5–2 m/s on foot, under 60 km/h in a vehicle), photo timestamps are monotonic and fall inside the trace window, each photo position is within its reported accuracy radius of the trace, and accelerometer step or vibration energy is consistent with movement. A single-photo report is capped at the area visible in that photo.
- **Dashcam / video:** sample frames by distance (for example every 2–5 m from GPS speed) rather than by time. Deduplicate detections across frames by GPS clustering. Treat video-derived areas as screening estimates.
- RoadLab Pro-style IRI apps suit coarse segment ranking (good / fair / poor). They do not meet contract acceptance standards.

### Gaps
- No primary validation of **World Bank RoadLab Pro** or **Roadroid** accuracy was retrieved. The arXiv study used a generic accelerometer app.
- No RoadBotics accuracy data was retrieved. RoadBotics was acquired by Michelin in 2022, but that was not verified here.
- No quantitative study of Android fused-location accuracy in Indonesian urban canyons was found.

---

## Q5. Tamper-resistant photo capture (web versus native)

### Takeaway
On the web, the `capture` attribute is a hint. The OS may still offer a choice of existing files, so it cannot guarantee a fresh photo. Live `getUserMedia` capture inside the page, with server-issued nonces, server timestamps, GPS plus its accuracy value, and motion data, is the strongest option available to a web app. Hardware-backed provenance exists only natively. Play Integrity is an **Android-app-only** API with no browser support. C2PA Content Credentials with hardware-backed keys (Pixel 10, Assurance Level 2) are useful when present, but cannot be assumed across the device base.

### Cited Findings
- MDN on `capture`: "operating systems with microphones and cameras will display a user interface allowing the **selection from an existing file or the creating of a new one**." The feature is "not Baseline because it does not work in some of the most widely-used browsers." — [MDN, HTML attribute: capture](https://developer.mozilla.org/docs/Web/HTML/Attributes/capture)
- **Play Integrity API** verifies a genuine unmodified app installed from Google Play (`appIntegrity`), a genuine certified Android device (`deviceIntegrity`: MEETS_BASIC / DEVICE / STRONG_INTEGRITY) and licensing. Verdicts are bound to a request through `requestHash` (standard) or a server `nonce` (classic). It runs on Android form factors, and the page **does not mention web browser support**. Google says it should be one layer of anti-abuse among several. — [Android Developers, Play Integrity overview](https://developer.android.com/google/play/integrity/overview?authuser=1)
- **C2PA on Pixel 10**: Pixel Camera signs JPEG captures with C2PA Content Credentials at **Assurance Level 2**, "the highest security rating currently defined by the C2PA Conformance Program". Keys are generated and stored in Android StrongBox on the Titan M2. Android Key Attestation confirms a genuine device, secure boot and a genuine app before certificates are issued. Each key and certificate signs exactly one image, and time-stamps come from an on-device secure clock. Google says C2PA is "not the sole solution". — [Google Blog, Pixel & Android C2PA](https://blog.google/security/pixel-android-trusted-images-c2pa-content-credentials/)

### Inferences
- **Citizen web capture:** use an in-page `getUserMedia` camera view and disable file upload entirely. Take a burst of 3–5 frames over about 1 s. Small natural differences between frames, together with DeviceMotion data, act as a cheap liveness check against photographing a screen or printout. Sign each upload with a **server-issued one-time nonce** shown or embedded at capture time. Record a **server receive timestamp**, ignoring EXIF because it is user-editable. Record GPS with `coords.accuracy` and reject reports where accuracy is over about 50 m or the position is outside the jurisdiction.
- **Field-officer app (native Android):** use Play Integrity with `requestHash` = hash(photo bytes ‖ GPS ‖ time ‖ nonce) so a server verdict binds each submission to a genuine device and app. Where available, use Android Key Attestation to sign photos inside the app, and accept C2PA manifests from Pixel 10 or other signing cameras as extra evidence.
- **Server checks:** use perceptual hashing (pHash/dHash) to catch reused or near-duplicate photos across reports, and reverse-image search for internet photos. Check that the reported GPS location is consistent with the road network. Rate-limit per device and account. These are standard techniques, but no primary benchmark on pHash in citizen reporting was retrieved.
- iOS has no Play Integrity. Apple's App Attest (DeviceCheck) is the native counterpart for iOS apps, but this was not retrieved or verified here.

### Gaps
- Live MDN browser-compatibility data for `capture` and `getUserMedia` was not accessible (MDN was not on the fetch allowlist). Exact Android Chrome and Samsung Internet behaviour for `capture="environment"` could not be confirmed.
- C2PA support on Samsung Galaxy, Apple and other phones as of late 2026 was not verified.
- No peer-reviewed false-positive rates for perceptual-hash duplicate detection in civic reporting were found.

---

## Q6. Checking that a repair will last: QC tests (Spesifikasi Umum 2018 rev. 2) and photo-provable evidence

### Takeaway
What makes a patch last is compaction density (≥98% of the standard or JMF density under Spesifikasi Umum 2018 rev. 2), mix temperature at laying and compaction, tack coat, sound vertical edges, a dry hole, and adequate thickness. Density and asphalt content need a core and a lab test. Temperature, tack coat, edge cutting, layer thickness, water and roller passes can all be shown with time-stamped photos and logs. The main early-failure signs are edge disintegration, settlement or dishing, and raveling, which appeared within about 3 months in a UK field study.

### Cited Findings
- A core-drill evaluation of AC-BC under Spesifikasi Umum 2018 Revisi 2 found: required density **≥98%**, measured **97.19–99.47%** (several points below 98%), field density 2.29–2.34 g/cm³, and a minimum thickness of **6.0 cm** for that layer, with several points under 6.0 cm. The authors attribute density variation to **mix temperature at spreading, the delay between production and spreading, and how the work was done**. — [PNJ Construction & Materials Journal](https://jurnal.pnj.ac.id/index.php/cmj/article/view/7938)
- Production temperatures cited from Spesifikasi Umum Bina Marga 2010: mixing **145–155 °C**, loading into the truck **135–150 °C**. — [BKSTM 2018 KE-03](https://xp.bkstm.org/prosiding/2018/KE-03.pdf)
- SNI-based field values cited in an Indonesian study: mixing 140–150 °C, **compaction 120–135 °C**. Asphalt viscosity at 135 °C ≤300 cSt per Spesifikasi Umum 2010 rev. 2012. — [core.ac.uk 295327999](https://core.ac.uk/download/295327999.pdf)
- **UK field study of HMA pothole repairs** (10 sites, 3 contractors):
  - Thermal segregation after compaction ranged from 34.9 to 92.8 °C across one mat.
  - Transport losses reached up to 116.6 °C. One contractor lost 60 °C over 7 h 25 min from 150 °C.
  - Edges cooled about 50% against about 29% in the middle, giving **low density at repair edges, prone to water ingress and early failure**.
  - No tack coat was used at 6 of 10 sites.
  - Water flowed through one patch during compaction.
  - Patches smaller than the roller and shallow depths of 0.04–0.06 m hindered compaction.
  - At about **3 months**, failures were concentrated along repair edges, with settlement and material falling away.
  — [Byzyka, Rahman & Chamberlain, Aston repository](https://publications.aston.ac.uk/id/eprint/41779/1/Juliana_et_al.pdf)
- **SHRP H-106 / FHWA LTPP pothole study**: more than 1,250 cold-mix patches at 8 US and Canadian sites, placed March 1991 to February 1992. At the final evaluation in November 1995, **56% had survived, 31% had failed and 13% had been lost to overlays**. Failure modes tracked were bleeding, cracking, dishing, edge disintegration, missing patch, raveling and shoving. Throw-and-roll matched semipermanent patching when quality materials were used and was more cost-effective. Cheap cold mixes often cost more overall because of repatching. — [FHWA InfoPave report 99202](https://infopave.fhwa.dot.gov/InfoPave_Repository/Reports/C40/C40_80/99202.pdf); [FHWA Focus, Jan 2000](https://www.fhwa.dot.gov/publications/focus/00jan/potholes.cfm)
- The FHWA manual of practice says high-quality materials give high-quality results but need not be expensive; PennDOT's Penn-485 spec costs less than half of many proprietary products. Repairs at 22 test sites "held up well" over 5 years. — [FHWA Focus, Jul 2000](https://www.fhwa.dot.gov/publications/focus/00jul/mops.cfm)

### Inferences
- **Evidence that photos and logs can show** (require all at stage gates):
  1. **Before:** pothole with fiducial card and ruler.
  2. **Cut:** square vertical edges, showing the cut extends about 30 cm into sound pavement (common practice, not sourced here).
  3. **Prepared hole:** dry and clean. Standing water is a hard fail.
  4. **Tack coat sprayed** on the base and edges.
  5. **Thermometer reading** (infrared or probe) of mix in the truck and on the spread layer, in the same frame as the patch. The flag threshold below about 120–125 °C at the start of compaction follows the cited compaction range.
  6. **Layer thickness**: ruler at the edge before compaction.
  7. **Roller or plate pass count**: short video or tally.
  8. **After**: flush finish, edges sealed.
  9. **AMP delivery ticket**: batch time, mix type and weight. Ticket time minus laying time gives haul delay.
- **Needs lab or field tests** (photos can only document that the test happened): core density ≥98% and thickness (photo of the core next to a ruler plus the lab sheet), asphalt content by extraction, Marshall/JMF properties, and deflection by Benkelman beam or FWD and IRI profiling for overlays and reconstruction.
- **AI-detectable early-warning signs** in follow-up photos: open or raveling edges, dishing or settlement (the fiducial card plus straightedge shows the step), bleeding (dark shiny surface), segregation (coarse open texture), ponding water on or next to the patch, and missing tack evidence in the construction photos.
- Patch life literature: in SHRP H-106, 56% of cold-mix patches were still in place after about 4 years when quality materials were used. Poorly executed hot-mix repairs in the UK study began failing at the edges within about 3 months. **Execution quality matters more than mix type.**

### Gaps
- The **full Spesifikasi Umum 2018 rev. 2 Division 6 temperature/viscosity table** (penghamparan, pemadatan awal / antara / akhir), the thickness tolerance and the core frequency were **not retrieved from the primary document**. The figures above come from secondary papers citing the 2010 edition or SNI manuals.
- **Per-method and per-material survival percentages** from SHRP H-106 (FHWA-RD-98-073) were not legible in the retrieved summary. Hot-mix full-depth patch life expectancy in years was not found in a primary source.
- No source was retrieved for Benkelman or FWD acceptance thresholds, or for IRI acceptance for new overlays in Indonesia.

---

## Q7. Follow-up inspection schedule

### Takeaway
The best-documented field protocol (SHRP H-106/LTPP) inspected patches at **1, 3 and 6 months, then every 6 months**. A UK hot-mix study found edge failures already showing at about **3 months**. A schedule of 1, 3 and 6 months, plus an inspection after the first heavy rainy-season month and one before the masa pemeliharaan ends (before FHO), is therefore defensible.

### Cited Findings
- SHRP H-106 / LTPP: evaluations at **1, 3 and 6 months, then semiannually** until November 1995. — [FHWA InfoPave 99202](https://infopave.fhwa.dot.gov/InfoPave_Repository/Reports/C40/C40_80/99202.pdf)
- UK HMA repairs: edge failures, settlement and material loss at about **3 months** after repair. — [Aston repository](https://publications.aston.ac.uk/id/eprint/41779/1/Juliana_et_al.pdf)
- Indonesian procurement practice: contracts specify a "jangka waktu pelaksanaan **dan pemeliharaan**". A jaminan pemeliharaan guarantees quality after hand-over. The provider must request FHO **15 days before the masa pemeliharaan ends**, and inspection happens **within 6 days before it ends**. PPK may sanction a provider who fails maintenance obligations. The legal basis cited is Perpres 16/2018 as amended by Perpres 46/2025, and Perlem LKPP 12/2021. — [UKPBJ Kab. Temanggung guidance](https://ukpbj.temanggungkab.go.id/assets/informasi/ukpbj_tmg_1749709400.pdf)

### Inferences
- **Recommended schedule for PAVEMENT-PINN:**
  - **T+1 month:** catches workmanship defects (edge gaps, settlement, raveling). Citizens can do it with a photo prompt.
  - **T+3 months:** the window in which the UK study saw edge failures. Done by an officer, with fiducial card and straightedge.
  - **T+6 months:** matches the SHRP schedule, and is near the end of a typical masa pemeliharaan.
  - **Event-triggered:** within 2 weeks after the first sustained heavy-rain period (musim hujan, roughly Nov–Mar in much of Indonesia; not sourced here), since water ingress at low-density edges drives failure.
  - **Before FHO:** inspection timed to the masa pemeliharaan deadline (at least 15 days before it ends), so defects can still be claimed under the jaminan pemeliharaan.
  - Then **every 6 months** while the PINN model's life estimate is checked against reality.
- Feed every follow-up observation (survived or failed, and failure mode) into the PINN as survival or censoring data. The SHRP failure-mode list (bleeding, cracking, dishing, edge disintegration, missing, raveling, shoving) is a ready-made label set.

### Gaps
- The statutory **minimum masa pemeliharaan in months** for permanent and semi-permanent works (commonly cited as 6 and 3 months respectively) was **not confirmed** from the Perpres or Perlem LKPP text.
- No Indonesian study was found on when patch failures occur relative to the rainy season.

---

## Q8. Recommended practical protocol: (A) citizen, (B) field officer, (C) post-repair (synthesis)

### Takeaway
Split responsibilities. Citizens provide **detection, location and a rough area band** through a camera-only, nonce-bound web capture. Officers provide **measurements that hold up in a dispute**: fiducial-card scale, straightedge and ruler depth photos, and a GPS trace for long damage, using a native Android app with Play Integrity. Repairs are verified with a **stage-gated photo and log sequence plus lab cores**, then re-inspected at 1, 3 and 6 months, after heavy rain, and before FHO.

### Cited Findings
- Single-image scaling error of about 11% (up to 23%) supports limiting citizen output to severity bands. — [ISPRS Annals 2025](https://isprs-annals.copernicus.org/articles/X-4-W7-2025/75/2025/isprs-annals-X-4-W7-2025-75-2025.pdf)
- Depth bands at 13, 25 and 50 mm need roughly millimetre-level measurement, which a ruler or depth sensor gives (RealSense ±0.24 cm) and monocular AI does not. — [FAA PAVEAIR](https://faapaveair.faa.gov/Help/Documents/levelsofseverityforpotholes.htm); [arXiv 2505.04207](https://arxiv.org/pdf/2505.04207); [arXiv 2504.13648](https://arxiv.org/pdf/2504.13648v1.pdf)
- The `capture` attribute can still allow choosing existing files, while Play Integrity and C2PA require a native or hardware path. — [MDN capture](https://developer.mozilla.org/docs/Web/HTML/Attributes/capture); [Play Integrity](https://developer.android.com/google/play/integrity/overview?authuser=1); [Google C2PA](https://blog.google/security/pixel-android-trusted-images-c2pa-content-credentials/)
- QC density ≥98%; temperature and delay drive density; edges, tack coat and water drive early failure. — [PNJ](https://jurnal.pnj.ac.id/index.php/cmj/article/view/7938); [Aston](https://publications.aston.ac.uk/id/eprint/41779/1/Juliana_et_al.pdf)

### Inferences
**(A) Citizen capture (PWA, works on Android and iOS)**
1. In-page `getUserMedia` camera only, with no file upload. The server issues a nonce when the camera view opens.
2. Prompt for 2 photos: an overview from about 1.5 m showing context and lane, and a close-up. A "place your shoe or a bottle next to it" prompt gives an optional rough scale.
3. Automatic burst of 3 frames, DeviceMotion sample, GPS with accuracy value, server timestamp.
4. On-device or server YOLO11n/v8n-seg gives class (D00–D40), mask, and a rough area band (<0.1 / 0.1–0.5 / >0.5 m²). Depth is never asked.
5. Server: pHash deduplication, a road-network GPS check, a rate limit, and clustering of nearby reports into one "site".

**(B) Field-officer measurement (native Android app with Play Integrity; OpenVINO on laptop for batch QA)**
1. Place an **ArUco or AprilTag fiducial card** (for example 200×200 mm, rigid, matte) flat next to the damage. Take a near-nadir photo. The app computes a homography and the area in m² from the mask, and rejects photos where the card is too small, too oblique or out of focus.
2. **Depth:** a straightedge across the hole and a ruler at the deepest point, photographed from the side, plus the typed value. OCR or tick reading checks the typed value (flag over 5 mm). A Depth Anything V2 relative map confirms the region is a depression. LiDAR or ToF profiles are optional supporting evidence.
3. **Long damage:** a GPS trace polyline (1 Hz, accuracy filter), a photo with the card every 10–20 m, and at least 3 taped cross-widths. Area is computed segment by segment.
4. Severity from the ASTM-style table, SDI segment roll-up, and a suggested treatment.
5. Play Integrity verdict bound by `requestHash` to the photo hash, GPS, time and nonce. Native signing, plus C2PA where the device supports it.

**(C) Post-repair verification**
1. Stage-gated photo sequence: before → cut → dry clean hole → tack coat → thermometer reading of the mix (truck and mat) → loose thickness with ruler → compaction (pass count or video) → finished patch with card and straightedge (flush check). Attach the AMP delivery ticket photo (batch time and weight).
2. Lab and field evidence: core photo with a ruler, a lab density sheet showing ≥98%, and asphalt content where specified.
3. Automated flags: mix temperature below about 120–125 °C at compaction, a delivery-to-laying delay above a set threshold (to be set from local data), no tack-coat photo, standing water, or an edge gap visible in the after-photo.
4. Re-inspection at T+1, T+3 and T+6 months, after the first heavy rains, and before FHO, then every 6 months. Each observation feeds the PINN life model as survival or censoring data, using SHRP failure-mode labels.

### Gaps
- The exact detection thresholds proposed here (OCR tolerance 5 mm, GPS accuracy cutoffs, temperature flag) are design choices and **need local calibration**. They are not standards.
- The accuracy of the full protocol needs an in-house validation study against tape, straightedge and core measurements.
