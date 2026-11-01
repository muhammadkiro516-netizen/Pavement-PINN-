# 10 — AI / ML Plan (v5)

> Every AI component: why it needs AI (vs rules), model, data, splits, baselines, metrics, failure handling, human decision point, license. Then PINN framing, GenAI rules, and the reproducible eval scripts that write `measurements/*.json`.
> Honesty rule: a number appears in the deck, UI or Q&A only if a script in §9 wrote it to `measurements/`. Until then the UI shows "Not measured yet" with `TODO_VERIFY`.
> Sources for datasets, protocols and papers: research note 09 (datasets/eval/PINN/Intel), note 07 (measurement and durability). Links are repeated here so Claude Code does not need the notes.

---

## 0. Current state (what is actually in the repo today, 2026-11-01)

| Component | What runs now | What is measured | Honest status |
|---|---|---|---|
| Damage detector | `rdd-yolov8n-v1` = third-party HF weights (nsr51324/Road_Damage_Object_Detection), 7 classes, OpenVINO FP32 + NNCF INT8 | Latency only (non-Intel AMD laptop: FP32 p50 34.4 ms, INT8 p50 19.6 ms, CPU). Author-reported mAP50 0.394 **not re-validated**. INT8 vs FP32 object agreement 10/13 on 18 photos | **No accuracy measured on our data** (`measurements/cv_local.json` = BELUM_DIUKUR, 0 of 100 labelled photos) |
| Segmenter | `crackseg-yolov8s-v1` (crack-only, single class, AGPL) | Latency only | **No pothole segmentation model yet** |
| Scene check | CLIP INT8 zero-shot scenes | Latency only | Accuracy BELUM_DIUKUR (`clip_scene.json`, needs 20 photos/class) |
| PINN-2 / PI surrogate (`pi-surrogate-v1`) | MLP 5→64→64→64→2 on dimensionless inputs, OpenVINO FP32 | vs PyMastic, 300 samples: εt MAPE 0.673 % (p95 1.94 %), εv MAPE 0.488 % (p95 1.71 %); 15.6 µs/sample vs 33 ms PyMastic (`pinn2.json`). Model card: hold-out 1.16 % / 0.59 %, OOD p95 ≈ 28 % | Works in-domain; OOD guard in place |
| PINN-1 (PDE-residual PINN) | Research module | Forward rel. L2 vs PyMastic: w 27.6 %, εzz 91.5 %; same net without physics loss: w 40.7 %, εzz 181 % (`pinn1_forward.json`, `pinn1_ablation.json`) | Physics loss helps, but **not accurate enough for decisions** |
| PINN-1 inverse (back-calculation) | Synthetic test | Moduli errors 34 %, 41 %, 33 %, 4 % (`pinn1_inverse.json`, label CONTOH) | **Fails** — consistent with arXiv 2606.03210. Do not claim |
| SLM (Qwen2.5-1.5B INT4, OpenVINO GenAI) | CPU | 10 cases: accepted first try 20 %, SLM text used 40 %, template fallback 60 %, 10.2 tok/s, TTFT median 2.1 s (`slm.json`) | Works with checker; pass rate low; NPU not tested |
| All benchmarks | `hostLabel: HOST_NON_INTEL` (AMD Ryzen 7 5800HS) | — | **Must be re-run on Intel** (see `11_INTEL_EVIDENCE_PLAN.md`) |

The plan below closes these gaps in priority order (P0 = needed for the interview).

---

## 1. AI components — why AI, and where a person decides

| ID | Component | Why AI (what rules cannot do) | What stays rule-based | Human decides |
|---|---|---|---|---|
| AI-1 | **Photo quality + scene gate** | Citizen photos are uncontrolled: angle, light, rain, motion. "Is this a road surface? Is it a photo of a screen?" cannot be written as rules. | Blur (Laplacian variance), exposure histogram, GPS accuracy, nonce/timestamp, speed lock | Any rejected or doubtful photo goes to the coordinator queue ("Needs a person"), never silently deleted |
| AI-2 | **Privacy blur** (faces, plates) | Locating faces/plates in arbitrary scenes needs a detector | Blur strength, EXIF strip, raw deletion ≤ 7 days | Citizen can flag "something private is visible" → coordinator re-blurs |
| AI-3 | **Damage detection** (class + box) | Recognising potholes vs cracks vs shadows/patches across lighting and surfaces | Mapping class → severity band; SDI roll-up per 100 m | Inspector confirms or corrects class on site (correction stored as label) |
| AI-4 | **Damage segmentation + area** | Pixel outline of irregular damage | Homography from ArUco/printed card corners → m²; no card → size band only | Inspector accepts area or enters tape values |
| AI-5 | **Ruler read-back for depth** | Reading tick marks on a ruler photo in a hole (angle, mud, glare) | Depth is the **typed** value; mismatch rule \|typed − read\| > 5 mm → flag | Inspector re-measures or explains; AI value is never the official depth |
| AI-6 | **Duplicate / same-spot matching** | Same pothole photographed from different angles and days | pHash Hamming distance, distance ≤ 10–25 m, same road segment | Coordinator merges (one click), can un-merge |
| AI-7 | **PINN-2 physics surrogate + Monte Carlo** | 2,000 layered-elastic solves per case for uncertainty take ~66 s with PyMastic (33 ms each) vs ~30 ms with the surrogate; enables life ranges on a laptop/edge, offline | Layered-elastic theory itself (PyMastic) is the reference; transfer functions; repair-option table | Inspector accepts/overrides suggested repair (reason required); Approver approves plan |
| AI-8 | **GenAI drafting (local SLM)** | Turning structured case data into readable, polite text for the public and for agency drafts | All numbers inserted by code; checker; template fallback | Staff approve/edit every draft; nothing is sent without approval |
| AI-9 (P2) | **Follow-up photo hints** | Spotting edge gaps, raveling, dishing, ponding in follow-up photos | Follow-up schedule (1/3/6 months, rain, before FHO) | Supervisor/inspector confirms "still OK" or "failed" |

**Not AI (say this proudly in Q&A):** routing to the authority (geometry + road registry + SK), SLA clocks and escalation, fair-cost calculation (AHSP formulas), audit hash chain, separation-of-duties checks. These must be deterministic and explainable.

---

## 2. Data

### 2.1 Datasets (sizes, licenses, links)

| Dataset | Use | Size | License | Link | Notes |
|---|---|---|---|---|---|
| **RDD2022** (CRDDC2022) | Detector train/val/test | 47,420 images, 6 countries (Japan 13,133; India 9,665; Czech 3,538; Norway 10,201; USA 6,005; China motorbike 2,477; China drone 2,401), >55,000 instances, 4 classes D00/D10/D20/D40 | CC BY-SA 4.0 | arXiv [2209.08538](https://arxiv.org/abs/2209.08538); challenge paper [2211.11362](https://www.arxiv.org/pdf/2211.11362); FigShare article 21431547 | No Indonesian images. Exclude China drone subset (different viewpoint). Confirm D-code mapping in the data article (TODO_VERIFY) |
| **RDD_Indonesia** (Roboflow `rdd-n1dvu`) | Extra train data **after dedup**; never test until provenance cleared | 8,397 images (v2), classes Lubang / Retakan_Buaya / Retakan_Melintang / Retakan_Memanjang | CC BY 4.0 | [universe.roboflow.com/rdd-n1dvu/rdd_indonesia](https://universe.roboflow.com/rdd-n1dvu/rdd_indonesia) | Provenance undocumented → dedup check vs RDD2022 required (§2.3). Maps 1:1 to D40/D20/D10/D00 |
| **Bandung Pothole Image Dataset (BPID)** | **Held-out Indonesian OOD test only** (never train/tune) | 50 images, sunny/cloudy/wet/night, tree-shadow hard negatives | CC BY 4.0, DOI 10.17632/rgymy6dwdd.1 | [Mendeley Data](https://data.mendeley.com/datasets/rgymy6dwdd/1) | Small → report 95 % CIs (bootstrap). Annotation type not stated: re-label boxes in YOLO format if needed and publish our labels |
| **IROSCD** (BRIN) | Scene/wet-road classifier check (AI-1) | Count not stated | CC BY 4.0, DOI 10.17632/ftcrvjz92c.1 | [Mendeley Data](https://data.mendeley.com/datasets/ftcrvjz92c/1) | Classes Normal/Damaged/Bumpy/Wet Road |
| **UDTIRI** | Pothole segmentation train/test | 1,000 images, pixel + instance masks (VOC/COCO) | **Not stated** → research use only until confirmed (TODO_VERIFY) | arXiv [2304.08842](https://arxiv.org/html/2304.08842v3); udtiri.com | Baselines: 14 det / 30 sem-seg / 10 inst-seg nets; quote their numbers only after reading the tables |
| **Rui Fan stereo pothole datasets** | Segmentation test + depth/area reference | 3 folders: RGB, disparity, masks, point clouds | MIT | [github.com/ruirangerfan/stereo_pothole_datasets](https://www.github.com/ruirangerfan/stereo_pothole_datasets) | Dataset 2 frames 6–8, 13–15, 21–23, 37–39 excluded from evaluation (as documented) |
| Roboflow pothole instance-seg sets (e.g. farzad/pothole_segmentation_yolov8) | Extra seg training | Not checked | Not checked (TODO_VERIFY) | see note 09 | Use only if license allows |
| **Crack seg sets** (CRACK500, DeepCrack 537, CFD 118, GAPs384, CrackTree200/260, AEL, CrackSeg9k 9,255) | Crack mask model (optional) | as listed | Licenses not stated in review; GAPs needs registration (UNVERIFIED) | review [arXiv 2508.10256](https://arxiv.org/pdf/2508.10256); [CrackSeg9k](https://arxiv.org/pdf/2208.13054) | Check each repo before use |
| **Team local photos** (`eval/local_test/`) | Local test + fine-tune pool | Target ≥ 100 labelled, ≥ 30 % wet/night, ≥ 20 per scene class | Own photos; consent + blur | — | Split by road segment (§2.2). Faces/plates blurred before storage |
| **Tape field study** (`eval/field_area/`) | Area and depth ground truth | Target 30–50 potholes | Own | — | §4.4 |
| PyMastic solutions | PINN-2 training | 19,894 Latin-hypercube samples (seed 42) | PyMastic Apache-2.0 | [github.com/Mostafa-Nakhaei/PyMastic](https://www.github.com/Mostafa-Nakhaei/PyMastic) | Already generated (`inference/training/gen_mlet_dataset.py`) |

### 2.2 Splits — by location, never random by image
- **RDD2022:** keep the official train split; carve validation by *country-stratified, sequence/location-grouped* sampling (images from the same drive/route stay together; if no route ID, group by filename prefix and timestamp). Report: (a) in-distribution test (grouped hold-out, 10 %), (b) **leave-one-country-out** for India (train without India, test on India), (c) Indonesian OOD on BPID.
- **RDD_Indonesia:** no location metadata → after dedup, group near-duplicate clusters (pHash ≤ 10) so a cluster never spans train/val. Train/val only.
- **BPID:** 100 % test, stratified report by condition (sunny/cloudy/wet/night) + shadow false-positive rate.
- **Team photos:** cluster GPS to road segments (≤ 200 m); whole segments go to train *or* test; test segments ≥ 30 % of photos; wet/night present in both.
- Committed split files: `eval/splits/{dataset}_{train,val,test}.txt` (image IDs) + SHA-256 of each list in `measurements/splits_manifest.json`. Seeds fixed; 3 seeds for final runs (mean ± sd).

### 2.3 RDD_Indonesia dedup check (P0 before any "Indonesian data" claim)
1. Compute pHash + dHash (64-bit) for all RDD2022 and RDD_Indonesia images (`imagehash`).
2. Candidate duplicate if Hamming ≤ 6 on either hash, or CLIP image-embedding cosine ≥ 0.95.
3. Manually review a random 200 candidates + all with Hamming ≤ 2; record precision of the rule.
4. Output `measurements/dedup_rdd_indonesia.json`: counts {total, exact, near, reviewed, confirmed}, % overlap with each RDD2022 country, and the list of kept IDs.
5. Decision rule: if > 20 % overlap with RDD2022 → describe it as "a Roboflow re-mix that includes RDD2022 images", not Indonesian data, and rely on BPID + team photos for Indonesian claims.

---

## 3. Models

| Component | P0 model | Alternative / production path | Export |
|---|---|---|---|
| AI-3 detection | **YOLOv8n or YOLO11n fine-tuned by us** on RDD2022 (4 classes) + deduped RDD_Indonesia, 640 px | **RT-DETR-R18** (HF `PekingU/rtdetr_r18vd`, Apache-2.0) fine-tuned with HF Transformers → OpenVINO; RF-DETR is "early-release" on CPU/GPU in OpenVINO 2026.4 (P2 check) | OpenVINO IR FP32/FP16 + NNCF INT8 (PTQ, ~300 calibration images from train) |
| AI-4 segmentation | **YOLOv8n-seg / YOLO11n-seg** trained on UDTIRI (+ licensed Roboflow pothole seg) for class `pothole`; keep crack-seg model for cracks | RT-DETR has no seg head → for Apache path use a DeepLabV3/SegFormer-small (check licenses) | IR + INT8 |
| AI-1 scene | CLIP (current INT8) zero-shot prompts: road surface / not road / screen photo / wet road | Linear probe on CLIP embeddings trained on IROSCD + team photos | IR INT8 |
| AI-2 privacy | Existing face/plate blur pipeline (keep) | — | — |
| AI-5 ruler | Classical CV first: ruler line detection + tick spacing (Hough + FFT) → mm per px → depth at deepest point; OCR (PaddleOCR-small or Tesseract) for printed numbers as a second vote | — | IR if NN used |
| AI-6 duplicates | pHash + CLIP cosine + geo/segment rule | — | — |
| AI-7 | `pi-surrogate-v1` (keep), PyMastic reference | — | IR FP32 served (INT8 not served: 10.9 % deviation amplified by fatigue exponents) |
| AI-8 | Qwen2.5-1.5B-Instruct INT4 (current) | NPU candidates from OpenVINO 2026.0 notes: "Qwen2.5-1B-Instruct" (as written by Phoronix; Qwen2.5 sizes are 0.5B/1.5B/3B, so confirm on the OpenVINO supported-models page) and Qwen-2.5-coder-0.5B; **fallback Qwen2.5-0.5B-Instruct** if 1.5B fails on NPU | `optimum-cli export openvino --weight-format int4 --sym --group-size -1 --ratio 1.0` (NPU recipe UNVERIFIED — check "OpenVINO GenAI on NPU" docs) |

Training hardware: Intel Arc / Core Ultra iGPU via PyTorch XPU (`--index-url https://download.pytorch.org/whl/xpu`, `torch.xpu.is_available()`), or Intel Tiber AI Cloud. Log device name in every training JSON (`torch.xpu.get_device_name()`). If training happens on non-Intel hardware, the JSON says so (`hostLabel`) — never hide it.

---

## 4. Evaluation protocol and metrics

### 4.1 Detection (AI-3)
- **mAP@0.5** and **mAP@0.5:0.95** (COCO convention), per class D00/D10/D20/D40, on each test set.
- **F1 at IoU > 0.5 with matching label** (CRDDC2022 definition) at **one fixed confidence threshold chosen on validation**, per class and overall — this is the only number comparable to CRDDC.
- Per-condition (BPID): F1 and false-positive rate on shadow hard negatives; per-condition n shown.
- 95 % CI by image-level bootstrap (1,000 resamples) for BPID and team photos.
- FP32 vs INT8 on the same test set: ΔmAP and ΔF1 reported side by side.
- Latency (median, p95) per device → `11_INTEL_EVIDENCE_PLAN.md`.

**Baselines to show (never mix metrics):**
| Baseline | Number | Comparable to |
|---|---|---|
| CRDDC2022 winner ShiYu SeaView (ensemble YOLOv5+YOLOv7+Swin Cascade) | F1 0.770 overall 6-country; India 0.583, Japan 0.789, Norway 0.595, US 0.844 | Our F1@0.5 on RDD2022 split (note: official CRDDC test labels are hidden, so our split is *not* the leaderboard — say "approximately comparable") |
| CRDDC2022 runners-up | DongjunJeong 0.743, MDPT 0.741 (YOLOv7, no ensemble) | same |
| Current HF detector (`rdd-yolov8n-v1`) | Author-reported mAP50 0.394 (not re-validated) | Re-evaluate it on our test sets with the same script → our "before" row |
| Our fine-tuned YOLO-n | measured | "after" row |
Honest line for the deck: "Our on-device nano model reaches F1 X at IoU 0.5 on our RDD2022 split, vs 0.770 for the 2022 winner's large ensemble. We trade some accuracy for running on a laptop/edge device."

### 4.2 Segmentation (AI-4)
- Pixel IoU and F1 (per image mean and dataset-level) on UDTIRI test and Rui Fan masks (documented excluded frames).
- Mask mAP@0.5 / mAP@0.5:0.95 for instance seg.

### 4.3 Scene gate and privacy (AI-1, AI-2)
- **FAR** (bad photo accepted) and **FRR** (good photo rejected) per class on a separate test set (blurred, dark, non-road, screen photos from ≥ 5 devices, wet road). Targets from the v3 doc: FAR ≤ 5 %, FRR ≤ 5 % for blur/dark; FAR for screen photos ≤ 10 %. Report as-is if missed.
- Privacy blur recall on 50 test photos with faces/plates (manual count). Target ≥ 95 %. Misses become regression tests.

### 4.4 Area and depth vs tape (AI-4, AI-5) — field study, P0 for any m² claim
- 30–50 potholes in the pilot area (safe roadside only, two people, vests).
- Ground truth: tape length (longest axis) and width (perpendicular) + a chalk outline photographed with a 1 m folding rule for polygon area; depth = straightedge + ruler at deepest point (read by two people).
- App measurement: (a) photo **with** printed marker card (ArUco/AprilTag 200×200 mm) → homography → mask area; (b) photo **without** card → size band.
- Metrics: area MAPE and median absolute error (cm²) for (a); band accuracy for (b); depth read-back agreement (% within 5 mm) and mean absolute difference.
- Literature context (do not present as ours): single photo + reference + homography ≈ 11.3 % mean width/height error, up to 23.5 % (ISPRS Annals 2025); depth camera ±0.24 cm on 5 images (arXiv 2505.04207). No study tests a card in every handheld frame — our study fills that, so report whatever we get.

### 4.5 Duplicates (AI-6)
- Precision/recall of "same spot" on 100 hand-labelled report pairs from the pilot (or demo set clearly labelled DEMO).

### 4.6 PINN (AI-7) — see §5.

### 4.7 GenAI (AI-8)
- 50-case test set (`eval/slm_cases/*.json`): checker pass rate, % first-try accepted, % template fallback, hallucinated-number count (must be 0 by construction), banned-word hits, clarity 1–5 by 3 raters, tokens/s and TTFT per device (CPU/GPU/NPU), peak memory.

---

## 5. PINN framing (what to say and what not to say)

### 5.1 PINN-2 — physics-informed forward surrogate (used in the product)
- **What it is:** a small network trained on layered-elastic theory solutions (PyMastic, multilayer elastic, Apache-2.0) with physics built in: dimensionless inputs (ln h1/a, ln h2/a, ln E1/E3, ln E2/E3, ln d/a) so **elastic similarity holds exactly**, linearity in tyre pressure q by construction, positive strains, and a **monotonicity penalty** on directions PyMastic obeys in 100 % of 300 perturbation checks.
- **What it does:** returns critical strains (εt bottom of asphalt, εv top of subgrade) ~2,100× faster than PyMastic (15.6 µs vs 33 ms per sample, non-Intel CPU), so a **Monte Carlo of 2,000 samples** over uncertain inputs (layer moduli, thickness, subgrade CBR, axle load) runs in milliseconds → **P10/P50/P90 life index** per repair option.
- **Guards (keep):** > 5 % of samples outside the training box → Monte Carlo refused; fewer → those solved by PyMastic; random 1-in-50 re-solved by PyMastic and result withheld if any differs > 10 %.
- **Validation numbers (MEASURED, non-Intel CPU):** vs PyMastic on 300 samples εt MAPE 0.673 % (p95 1.94 %), εv MAPE 0.488 % (p95 1.71 %); random 20 % hold-out 1.16 % / 0.59 %; OOD p95 ≈ 28 %. Published comparison point for scale: Wang & Zhao 2025/26 SEM–Transformer (different task: backcalculation) R² > 0.94, MAPE < 8 % — mention only as context.
- **Ablation vs plain MLP (MEASURED, model card):** plain MLP on raw inputs gets similar in-distribution MAPE (εt 1.28 %, εv 0.73 %) **but breaks elastic similarity by up to 1,081 %**; PI-surrogate error there is 0 by construction. Monotonicity violations at 20,000 collocation points: 2.8 % with the loss vs 10.3 % without. Random-forest baseline: εt 12.2 %, εv 9.5 % MAPE.
  - P0 task: move these model-card numbers into a script output `measurements/pinn2_ablation.json` (regenerate, don't copy).
- **Reference check (P1):** PyMastic's README compares to WESLEA/KENPAVE visually only. Run 3–5 textbook cases (Huang, *Pavement Analysis and Design*, KENPAVE examples) and record PyMastic vs published values → `measurements/mlet_reference_check.json`. Until done: "PyMastic validated vs KENPAVE" is `TODO_VERIFY`.
- **Life index:** strains → fatigue and rutting transfer functions (Asphalt Institute form; cite the textbook/Austroads guide after checking — TODO_VERIFY) → allowable load repetitions. **Months are shown only when traffic (ESAL/month) is entered by a person (`INPUT`)**; otherwise show a relative life index. The UI calls it "expected life range of a proper repair (indicative)". It is for comparing options and spotting early failure, **not for predicting a failure date**.
- **Calibration loop (P2):** follow-up outcomes (survived/failed + failure mode using SHRP labels: bleeding, cracking, dishing, edge disintegration, missing, raveling, shoving) feed a survival model; report calibration only after ≥ 30 observed repairs.

### 5.2 PINN-1 — PDE-residual PINN (research module, not used for decisions)
- Shows the effect of the physics loss honestly: rel. L2 vs PyMastic w 27.6 % / εzz 91.5 % with physics vs 40.7 % / 181 % without (same network and data).
- Not accurate enough to drive decisions; shown on the Evidence page as "research result".

### 5.3 What NOT to claim
- **No PINN back-calculation / inverse moduli.** Our synthetic test errors are 33–41 %. Choi, Moon & Ryu (arXiv [2606.03210](https://arxiv.org/html/2606.03210), 2026) found vanilla PINNs failed to recover moduli even without noise, XPINN errors up to ~70 % on subgrade at 1 µm noise, ~10 h vs ~60 s for differentiable FEM. Say: "We tested inverse PINN; it failed, which matches a 2026 study. We use physics where it is reliable: a forward surrogate."
- Not "PINN solves Burmister", not "equivalent to FEM", not "FWD validated", not "predicts failure date", not "safe/unsafe".
- Novelty, carefully: "To our knowledge, combining citizen-photo damage detection with a layered-elastic surrogate and repair follow-ups on one edge device is new." (The 2026 paper cites no PINN-for-pavement studies; that suggests sparsity, not proof.)

---

## 6. Failure handling (AI must hand over to a person)

| Situation | Detection | What the system does | User sees |
|---|---|---|---|
| Blurry photo | Laplacian variance < threshold (calibrate on team photos; store in config) | Client asks retake; if user insists → "Needs a person" queue | "This photo looks blurry. Hold still and try again." |
| Too dark / overexposed | histogram rule | same | "Too dark. Turn on the flash or move to light." |
| Not a road / screen photo | CLIP scene score | Held for coordinator; no XP | "We can't see a road here." |
| Water-covered | CLIP "wet/puddle" score or citizen tick | Severity band = "unknown"; **inspector measurement required** | "Water may hide the hole. An inspector will measure it." |
| Low detection confidence | score between `conf_candidate` (0.15) and `conf_accept` (0.25) | "Candidate" status, coordinator decides | "Possible damage — a person will check." |
| No detection, user says damage | — | Accept as report with class "unspecified" | normal flow |
| Out-of-distribution input to PINN | > 5 % samples outside box | Monte Carlo refused; deterministic PyMastic result only | "Outside the model's tested range. Showing the physics solver result only." |
| Surrogate disagrees with spot check | > 10 % diff | Result withheld, logged | "Physics check failed. A person must review." |
| Ruler read-back mismatch | \|typed − read\| > 5 mm or unreadable | Flag on case; supervisor sees it | "Your number and the ruler photo differ by {d} mm." |
| SLM output fails checker | checker | Template text used (`TEMPLATE` chip) | "AI writer is off. Using the standard template." |
| Wrong class after inspection | inspector correction | Correction stored as new label (active learning pool), case continues with human class | — |

Appeals: citizens can tap "I disagree" on any AI result (goes to coordinator with photo); staff overrides always need a reason (≥ 10 chars), logged in the audit chain.

---

## 7. GenAI rules (AI-8)

1. **Local only:** Qwen2.5 INT4 via OpenVINO GenAI on the Intel device (NPU preferred when supported, else GPU, else CPU). No cloud LLM in production. Device + model ID recorded in each draft's metadata.
2. **Input is a typed JSON schema** (case facts, statuses, dates, office names) — no free text from citizens is passed unescaped (prompt-injection guard: strip/escape, max length).
3. **Numbers are never generated by the model.** The model writes text with placeholders (`{{AREA_M2}}`, `{{FAIR_COST_RANGE}}`, `{{DAYS_OPEN}}`); code fills them from the database. The checker rejects any digit the model wrote itself (existing rule "contains digits").
4. **Checker (deterministic):** required sections present; all placeholders valid; no digits outside placeholders; banned words (EN/ID): corruption/korupsi, mark-up, fraud, nakal, lalai, maling, fiktif, "merugikan negara", names of people; length limits; no recommendations beyond allowed list ("perlu klarifikasi", "uji lapangan", "verifikasi"); no technical decision verbs ("must use overlay", "is safe").
5. **Label:** every draft shows `AI DRAFT — needs human approval`; exported PDFs carry "Drafted with AI, reviewed by {role} on {date}".
6. **Never decides:** cannot change case status, approve, assign, or choose a repair type. It only writes: public status updates, delay explanations, cover text for the agency draft, share captions.
7. **Fallback:** checker fail ×2 → template text. The product works fully with the SLM switched off (test this).
8. **Show an example in the UI and deck**: one real draft with placeholders highlighted and the checker log.
9. Measure per §4.7 and publish in `measurements/slm.json`.

---

## 8. Ethics and risk register (AI-specific)

| Risk | Example | Mitigation | Owner |
|---|---|---|---|
| Misdiagnosis | Shadow detected as pothole; deep hole under water judged small | Human verification before any repair decision; water → mandatory measurement; per-condition metrics published | Inspector |
| Location / quality bias | Model trained mostly on Japan/India/Norway highways, fewer Indonesian kampung roads, night/rain | BPID + team photos as test; report per-condition; active-learning from inspector corrections; "quiet area" equity flag so few-report areas are not ignored | ML lead |
| Personal data | Faces, plates, home exteriors; reporter identity | Blur before storage, EXIF strip, pseudonymous device ID, name only on certificates, raw photos deleted ≤ 7 days, hashes only in immutable log (UU 27/2022 PDP — see `02_SPEC_v5.md` §8.1) | Admin |
| Abuse | Fake reports, spam for XP, revenge reports | Live camera + nonce, rate limits, trust score, XP only after verification, duplicate merge | Coordinator |
| Over-trust in AI numbers | Officials treat PINN life as a guarantee | "Indicative" labels, P10–P90 always shown, source chips, no failure dates | All |
| GenAI errors | Wrong facts in a public message | Placeholders, checker, approval required, template fallback | Approver/Head |
| Defamation | Flags read as accusations | Neutral BPK-style words, flags on packages not people, right-of-reply channel | Auditor/Admin |

---

## 9. Reproducible evaluation — scripts and outputs

All scripts: `python -I` safe, fixed seeds, read pinned versions from `inference/requirements.lock`, write one JSON to `measurements/` with the **common header**:
```json
{"measuredAt":"ISO-8601","commit":"<git sha>","host":"<hostname>","hostLabel":"HOST_INTEL|HOST_NON_INTEL",
 "device":{"cpu":"...","FULL_DEVICE_NAME":{"CPU":"...","GPU":"...","NPU":"..."}},
 "versions":{"openvino":"2026.4.x","nncf":"...","torch":"...","ultralytics":"...","optimum-intel":"..."},
 "dataset":{"id":"...","splitFile":"eval/splits/...","sha256":"..."},"seeds":[0,1,2],
 "label":"MEASURED|BELUM_DIUKUR|DEMO", "...results...": {}}
```
If inputs are missing, write `label: "BELUM_DIUKUR"` with `howTo` — never a number.

| Script | Status | Output |
|---|---|---|
| `eval/data/dedup_rdd_indonesia.py` | NEW P0 | `measurements/dedup_rdd_indonesia.json` |
| `eval/data/make_splits.py` | NEW P0 | `eval/splits/*.txt`, `measurements/splits_manifest.json` |
| `inference/training/train_detector.py` (YOLO; `--arch rtdetr` P2) | NEW P0 | `models/cv/<id>/` + `measurements/train_detector_<id>.json` (epochs, device, time, val mAP) |
| `eval/cv_eval.py` (extend: test-set arg, F1@0.5 fixed thr, mAP50-95, per class, per condition, bootstrap CI, FP32 vs INT8) | EXTEND P0 | `measurements/cv_eval_<testset>_<model>.json` for `rdd_test`, `rdd_loco_india`, `bpid_ood`, `local` |
| `eval/seg_eval.py` | NEW P1 | `measurements/seg_eval_<testset>.json` (UDTIRI, stereo) |
| `eval/area_eval.py` (+ `eval/field_area/` CSV template) | NEW P0 (needs field study) | `measurements/area_field.json` |
| `eval/depth_readback_eval.py` | NEW P1 | `measurements/depth_readback.json` |
| `eval/trust_gate_eval.py` | NEW P1 | `measurements/trust_gate.json` (FAR/FRR) |
| `eval/clip_eval.py` | EXISTS | `measurements/clip_scene.json` |
| `eval/privacy_eval.py` | NEW P1 | `measurements/privacy_blur.json` |
| `eval/dup_eval.py` | NEW P2 | `measurements/duplicates.json` |
| `eval/pinn2_eval.py` (add ablation + OOD + RF baseline) | EXTEND P0 | `measurements/pinn2.json`, `measurements/pinn2_ablation.json` |
| `eval/pinn1_eval.py` | EXISTS | `measurements/pinn1_{forward,ablation,inverse,field}.json` |
| `eval/mlet_reference_check.py` | NEW P1 | `measurements/mlet_reference_check.json` |
| `eval/slm_eval.py` (50 cases, per device) | EXTEND P0 | `measurements/slm.json`, `measurements/slm_<device>.json` |
| `eval/quant_delta.py` | NEW P0 | `measurements/quant_delta.json` (FP32 vs INT8 accuracy + size + latency per model) |
| `bench/run_all.py` | EXISTS | `measurements/bench_<host>.json` (see doc 11) |
| `scripts/export-measurements.ts` | EXISTS | feeds `/api/public/measurements` → `/bukti/` |
| `eval/README.md` | NEW P0 | one command per table: `make eval-all` or `bash eval/run_all.sh` |

Also add `docs/MODEL_CARDS/{detector,segmenter,scene,pi-surrogate,slm}.md` and `docs/DATA_CARD.md` (sources, licenses, splits, dedup result, known gaps) generated/updated from the JSONs.

---

## 10. License notes

| Item | License | Consequence |
|---|---|---|
| Ultralytics YOLO (code + trained models by default) | AGPL-3.0 | OK for a fully open-source student/research repo: publish full source incl. backend, configs and weights. Commercial/SaaS/government deployment needs an Enterprise license **or** the Apache path |
| RT-DETR weights (`PekingU/rtdetr_r18vd`) | Apache-2.0 | Production path; one-liner: "Prototype uses YOLO under AGPL, fully open-sourced; production path is RT-DETR (Apache-2.0) to avoid licensing lock-in." |
| Current HF detector (`nsr51324/...`) | Card says MIT; architecture/export Ultralytics AGPL | Treat as AGPL |
| `crackseg-yolov8s` (OpenSistemas) | AGPL-3.0 | same |
| RDD2022 | CC BY-SA 4.0 | Any re-released relabelled dataset derived from it must be CC BY-SA 4.0 with attribution. Weights: say "released openly with attribution" (legal status unsettled) |
| RDD_Indonesia, BPID, IROSCD | CC BY 4.0 | Attribution in DATA_CARD and Evidence page |
| Rui Fan stereo sets | MIT | cite Fan et al. 2019 IEEE TIP + Fan, Ai, Dahnoun 2018 |
| UDTIRI, crack sets, Roboflow seg sets | Not stated / not checked | `TODO_VERIFY`; research use only until confirmed |
| PyMastic | Apache-2.0 | keep NOTICE |
| Qwen2.5 model weights | **TODO_VERIFY** on the HF model card (license differs by size) | record license in `slm.json` |
| CLIP weights in use | **TODO_VERIFY** source + license | record in model card |
| OpenVINO, NNCF, OpenVINO GenAI, Optimum Intel | Apache-2.0 (verify in each repo LICENSE) | — |

---

## 11. Definition of Done (AI/ML)
- [ ] `dedup_rdd_indonesia.json`, `splits_manifest.json` committed.
- [ ] Own detector trained (Intel device logged if available); `cv_eval_*` for rdd_test, rdd_loco_india, bpid_ood, local with F1@0.5 + mAP50 + mAP50-95 per class, CIs, FP32 vs INT8.
- [ ] Old HF detector evaluated with the same script (before/after table).
- [ ] Pothole seg model + `seg_eval` (P1); area field study ≥ 30 potholes (`area_field.json`) before any m² claim.
- [ ] `pinn2_ablation.json` regenerated by script; inverse PINN hidden from production UI; Evidence page shows PINN-1 as research.
- [ ] SLM 50-case eval on CPU and NPU (or NPU "not supported: reason" recorded).
- [ ] Model cards + data card exist; every UI number from these JSONs carries a chip.
