# 08 — Repair Verification and Durability (v5)

> Research basis: note 07 Q6–Q8 (QC tests, photo-provable evidence, follow-up schedule), note 08 §2–§3 (maintenance period, PHO/FHO, BPK uji petik), note 03 §4–§6 (technical modus, fail → re-budget loop). Workflow states: `02_SPEC_v5.md` §3. Roles and SoD: `03_ROLES_RBAC.md`.
> Answer to the team's question "can the inspector's photo prove the asphalt will last?" — **No.** Photos can prove that the right *process steps* happened and can show *early failure*. Durability is shown over time by follow-ups, and the things that decide it inside the layer (density, thickness, asphalt content) need a core and a lab. The app documents, compares with physics, and recommends tests; it never claims a test result it does not have.

---

## 1. What decides whether a patch lasts (and what we can see)

| Factor | Why it matters | Source | Can a photo/log show it? |
|---|---|---|---|
| Compaction density | Required ≥ 98% of standard/JMF density under Spesifikasi Umum 2018 rev. 2; core study found 97.19–99.47% with points below 98% | PNJ Construction & Materials Journal (core-drill evaluation of AC-BC) | **No** — needs core + lab. Photo shows only that a roller/plate was used. |
| Mix temperature at laying/compaction | Density variation linked to mix temperature at spreading and delay between production and spreading | PNJ; UK field study (Byzyka, Rahman & Chamberlain, Aston) | **Yes (indicator)** — thermometer reading in frame, delivery ticket time |
| Tack coat | Missing at 6 of 10 UK repair sites | Aston study | **Yes** — spraying photo |
| Sound vertical edges | Edges cooled ~50% vs ~29% in the middle → low edge density, water ingress, early failure | Aston study | **Yes** — cut photo; edge sealing in after-photo |
| Dry hole | Water flowed through one patch during compaction | Aston study | **Yes** — clean/dry photo; standing water = hard fail |
| Layer thickness | Thickness deficits are a documented modus (Simeulue: thickness not as drawn; base layer not built) | note 03 §4 | **Partly** — loose thickness with ruler at edge before compaction; final thickness needs core |
| Patch geometry vs roller | Patches smaller than the roller and shallow (0.04–0.06 m) hindered compaction | Aston study | **Yes** — dimensions + compaction photo/video |
| Material quality | Cheap cold mixes often cost more overall due to repatching; quality materials need not be expensive | SHRP H-106 / FHWA (InfoPave 99202; FHWA Focus Jan/Jul 2000) | **Partly** — ticket/mix type; quality needs lab |
| Asphalt content, Marshall/JMF | Spec compliance | note 07 Q6 | **No** — extraction/lab |

Key literature numbers (for docs and pitch, with conditions):
- SHRP H-106 / FHWA LTPP: > 1,250 cold-mix patches at 8 US/Canadian sites placed Mar 1991–Feb 1992; at the final evaluation (Nov 1995) **56% survived, 31% failed, 13% lost to overlays**; throw-and-roll matched semi-permanent patching when quality materials were used (FHWA InfoPave 99202).
- UK hot-mix pothole repairs (10 sites, 3 contractors): failures concentrated along repair edges, with settlement and material loss, at about **3 months** (Aston repository).
- Conclusion used in product copy: **execution quality matters more than mix type** (note 07 Q6 inference).

---

## 2. Evidence checklist during repair (REPAIR_CREW)

Every item is a **live-capture** photo with a work-stage nonce (`POST /api/capture/nonce {purpose:"WORK_STAGE", stage}`), GPS within 50 m of the case location, server time inside the work-order window. Reused photos (SHA-256 exact or pHash ≤ 8) are rejected (`05` A-9/A-10).

`Gate` = HARD (blocks `SUBMIT_WORK_EVIDENCE`), SOFT (allowed, creates a neutral indication for the supervisor), INFO.

### 2.1 Patching (hot mix, `PERMANENT`)
| # | Stage code | Photo must show | Values typed | Auto-checks | Gate | Basis |
|---|---|---|---|---|---|---|
| 1 | `BEFORE` | defect with marker card + straightedge/ruler (same framing as inspection) | — | GPS ≤ 50 m from case; pHash differs from inspection photos (fresh capture) | HARD | note 07 Q8 (C)1 |
| 2 | `CUT_EDGES` | square, vertical cut edges; tape showing cut extends into sound pavement | cut length × width (cm) | cut area ≥ defect area from inspection | HARD (photo) / SOFT (margin < 0.30 m, `ASSUMED` common practice, not sourced) | note 07 Q6 |
| 3 | `CLEAN_DRY` | hole cleaned, dry, no standing water | — | optional AI "standing water" classifier | HARD (water visible → fail) | Aston study |
| 4 | `TACK_COAT` | tack coat sprayed on base and edges | material (emulsion type) | — | HARD | Aston study (missing at 6/10 sites) |
| 5 | `DELIVERY_TICKET` | AMP delivery ticket readable | batch time, mix type (e.g. AC-WC), weight (t) | haul delay = laying time − batch time; > threshold → indication (threshold **to be set from local data**, note 07 Q8) | HARD (ticket) / SOFT (delay) | note 07 Q6 |
| 6 | `MIX_TEMP_TRUCK` | IR/probe thermometer reading + mix in truck in one frame | °C | — | HARD | note 07 Q6 |
| 7 | `MIX_TEMP_MAT` | thermometer reading on the spread mix in the patch at start of compaction | °C | < 120 °C (default; cited field compaction range 120–135 °C, SNI-based secondary source) → `LOW_MIX_TEMPERATURE` indication (W-06) | HARD (photo) / SOFT (value) | core.ac.uk 295327999; `TODO_VERIFY(Spesifikasi Umum 2018 rev.2 Divisi 6 temperature table)`. Context: Spesifikasi Umum 2010 mixing 145–155 °C, truck loading 135–150 °C (BKSTM 2018) |
| 8 | `LOOSE_THICKNESS` | ruler at patch edge before compaction | mm | compare with plan thickness (+ compaction allowance, `ASSUMED`) | SOFT | note 07 Q8 (C)1 |
| 9 | `COMPACTION` | roller or plate compactor in contact with patch; short video (≤ 15 s) or pass tally | passes, compactor type (`ROLLER`/`STAMPER`/`PLATE`/`NONE` — v4 `COMPACTORS`) | `NONE` → indication; patch smaller than roller drum → info | HARD (photo) / SOFT (`NONE`) | Aston study; Karawang 2025 foot-compaction case (v4 SPEC §1) |
| 10 | `AFTER` | finished patch with marker card + straightedge across (flush check), sealed edges | step height mm at straightedge (optional) | AI: open edge / ponding detection | HARD | note 07 Q6/Q8 |
| 11 | `CORE_SAMPLE` (optional; when agency tests) | core next to ruler + lab sheet | density %, thickness mm (as `INPUT` from lab sheet) | density < 98% → info line (agency's own result) | INFO | PNJ; BPK Malut |

### 2.2 Cold mix / temporary (`TEMPORARY`)
Stages 1, 3, 9 (compaction), 10 are HARD; 2 and 4 are SOFT (product instructions vary); no temperature stages. Case ends in `REPAIRED_TEMPORARY` (still owed a permanent repair; separate clock, `02` §3.4).

### 2.3 Overlay / mill-and-inlay / reconstruction (`CONTRACT`)
Add per-STA evidence: thickness at ≥ 3 stations per 100 m (design), references to the contractor's own MC-0 / MC-100 and daily/weekly/monthly reports and 0/50/100% progress photos (Modul 04 Kutai Barat) uploaded as `INPUT` documents (hash only), and core results when the agency tests.

### 2.4 Declared quantities
Crew declares area, thickness and tonnage (from tickets). Server computes measured volume × density (`ASSUMED` 2.3 t/m³ unless JMF given — v4 `config/prices` assumption) and flags `QUANTITY_DIFFERENCE` (W-07) if > 15% (design default).

---

## 3. Supervisor check (SUPERVISOR)

| Step | Rule |
|---|---|
| 1 | Supervisor opens `WORK_SUBMITTED`; each checklist item shows crew photo, values, auto-check result |
| 2 | Marks each item `PASS` / `FAIL` / `NA` with optional note |
| 3 | Takes **own** live-capture after-photo on site with straightedge (flush check) within 200 m of the case and after `work.submitted` (SV-1.1) |
| 4 | If any HARD item is FAIL → only `REJECT_WORK` (back to `IN_PROGRESS`) unless an override reason is recorded (logged, visible to AUDITOR) |
| 5 | SOFT indications must each be acknowledged (agree / explain) before `VERIFY_WORK` |
| 6 | SoD: supervisor ≠ crew (person; and organisation for `CONTRACT`), ≠ plan proposer (SOD-1, SOD-2/3) |
| 7 | SLA: 3 days (internal target) |

Then `ACCEPT_WORK` by APPROVER (or COORDINATOR for swakelola routine if configured) records PHO date (`INPUT`, from BA PHO) and maintenance months (`INPUT`, from contract) and creates the follow-up schedule.

---

## 4. Follow-up schedule

### 4.1 Milestones (from acceptance date `T0`; for contracts `T0` = PHO date)
| Milestone | When (window) | Who | Evidence | Rationale |
|---|---|---|---|---|
| `M1` | T0 + 1 month (± 7 days) | Citizens (reporter + witnesses ≤ 300 m prompt); inspector optional | "Still good / Damaged again" + optional photo | Catches workmanship defects (edge gaps, settlement, raveling). SHRP H-106/LTPP evaluated at 1 month. |
| `M3` | T0 + 3 months (± 10 days) | **Field Inspector** (not crew, not supervisor — SOD-4); citizens prompted | marker card + straightedge photo; failure modes | UK hot-mix study saw edge failures at ~3 months; SHRP evaluated at 3 months. |
| `M6` | T0 + 6 months (± 14 days) | Inspector or citizens (inspector if any M1/M3 issue) | as M3 | SHRP evaluated at 6 months; near the end of a typical maintenance period. |
| `HEAVY_RAIN` | within 14 days after the first sustained heavy-rain period after T0 | Inspector; citizens prompted | as M3 + ponding check | Water ingress at low-density edges drives failure (Aston). Musim hujan roughly Nov–Mar in much of Indonesia (not sourced). Trigger: rainfall from `server/services/weather.ts`; threshold `TODO_VERIFY(BMKG rainfall intensity categories)`. |
| `PRE_FHO` | maintenance_end − 21 days (window 7 days) | Inspector + Supervisor joint inspection; APPROVER notified | as M3 | Provider must request FHO 15 days before maintenance ends; inspection within 6 days before it ends (UKPBJ Kab. Temanggung guidance, citing Perpres 16/2018 jo. 46/2025 and Perlem LKPP 12/2021). Defects found here can still be claimed under the jaminan pemeliharaan. |
| `EVERY_6M` | every 6 months after FHO (or after M6 if no package) | Inspector or citizens | as M3 | SHRP evaluated semiannually; checks PINN life estimate against reality. Stops when: failure recorded, segment superseded by new works, or 2 × P90 reached. |

Rules:
1. Milestones within 14 days of each other are merged into one task (keep the stricter evidence requirement).
2. Citizens' "Damaged again" answers are observations. A **failure** is recorded only after an inspector confirms (or SOD-10 corroboration triggers an inspector task).
3. Missed staff follow-ups escalate like SLA breaches (reminder → COORDINATOR → AGENCY_HEAD).
4. Temporary patches: M1 and HEAVY_RAIN only, plus the permanent-repair clock.
5. These intervals are literature-based design choices; **they have not been validated with Indonesian road authorities** (note 07 Q7 Gaps: no Indonesian study on failure timing vs rainy season). Pilot interviews must confirm them.

### 4.2 Follow-up result payload
`{milestone, result: OK|DEFECT, failure_modes[], step_mm?, area_m2?, evidence_ids[], source: INSPECTOR|SUPERVISOR|CITIZEN}`. Failure modes = SHRP H-106 list (`data/damage_classes.json` → `patch_failure_modes`): bleeding, cracking, dishing, edge disintegration, missing patch, raveling, shoving; plus app modes ponding, segregation.

---

## 5. What photos can and cannot prove

| Photos/logs CAN show | Photos/logs CANNOT show |
|---|---|
| A step was done at that place and time (cut, tack coat, compaction equipment present) | Compaction density (≥ 98% needs core + lab) |
| Mix temperature at a moment (thermometer in frame) | Temperature through the whole layer or over time |
| Loose thickness at the edge before compaction | Final compacted thickness across the patch (needs core) |
| Standing water / dry hole | Moisture in the base or subgrade |
| Finished surface flush with surroundings (straightedge) | Bond quality between layers |
| Early-warning signs later: open/raveling edges, dishing/settlement (straightedge step), bleeding (dark shiny), segregation (coarse open texture), ponding | Asphalt content, gradation, Marshall/JMF properties |
| Repeated failure at the same spot over time | The cause of failure (needs technical assessment) |
| That the evidence existed unchanged since time T (hash chain + OTS) | That the evidence is a true picture of this patch (mitigated by live capture, GPS, independent supervisor and inspector photos, citizen confirmations) |

UI copy (plain English): "Photos show the steps were done. Time shows if the repair lasts. Lab tests show what is inside."

---

## 6. PINN expected-life comparison

### 6.1 What PINN is (honest framing, shared decision)
PINN-2 is a **physics-informed forward surrogate of layered-elastic theory** (trained against PyMastic, which is validated against KENPAVE) used for fast Monte-Carlo life ranges. It does **not** do back-calculation (PINN inverse fails; arXiv 2606.03210). For small patches, life is dominated by workmanship, which the physics model does not see → patch-life ranges carry `confidence=LOW` unless empirical data exists.

### 6.2 Inputs and output
Inputs (each with status): repair method/material, layer thickness (`MEASURED`/`INPUT`), structure prior (from package data or typical structure by road class, `ASSUMED`), traffic (`INPUT`/`ASSUMED`), wet months, observed distresses. Output: life in months `P10 / P50 / P90`, dominant factor, confidence. Empirical blend (v4 decision kept): when ≥ 5 recorded repairs of the same method exist in the region, the expected patch life uses their observed survival as the prior; otherwise physics only, labelled.

### 6.3 Comparison logic
| Observed | Display | Action |
|---|---|---|
| Failure confirmed before P10 | "Failed earlier than expected (expected ≥ a months, lasted b)" | indication W-04; recommendation list (§8); counts in recurrence |
| Failure between P10 and P90 | "Within expected range" | none |
| Survives past P90 | "Lasted longer than expected" | positive signal; used in calibration |
| No failure yet | "Still good after n months" | right-censored data point |

Timeline card (v4 M6.4 kept): "expected ±X" vs "actual Y".

---

## 7. Maintenance-period and warranty flag rules

### 7.1 Facts used (with status)
| Fact | Value | Status | Source |
|---|---|---|---|
| Minimum maintenance period | 6 months permanent works; 3 months semi-permanent; counted from PHO | `TODO_VERIFY` (article not confirmed) | Modul 04 Penyelesaian Kontrak, DPU Kutai Barat (no article number); likely Perpres 16/2018 Pasal 50 or nearby, amended by Perpres 46/2025 — check full text; Perlem LKPP 12/2021; Permen PUPR 14/2020 |
| Conflicting framing | "usually 3, 6 or at most 12 months", set in the contract | secondary | DJPb KPPN Jakarta VII "Retensi Bukan Pemeliharaan" |
| Maintenance guarantee | 5% of contract value, or 5% retention instead; valid until 14 working days after maintenance ends | `TODO_VERIFY` (binding article) | Modul 04 Kutai Barat |
| Provider duty | must repair defects at own cost during maintenance; damage caused by users not covered; force majeure shared | secondary | Modul 04; DJPb |
| If provider fails | PPK may withhold retention / claim guarantee; blacklisting; PPK may appoint another contractor at provider's cost | secondary | Modul 04 |
| FHO request | provider requests 15 days before maintenance ends; inspection within 6 days before end | secondary | UKPBJ Kab. Temanggung |
| Building-failure liability | within planned life, max 10 years after final handover | OFFICIAL (UU text, ayat (4) rendering garbled → check gazette) | UU 2/2017 Pasal 65 |

### 7.2 Rules (code: `src/domain/roads/maintenanceStage.ts`)
1. **Stage** from package data: `PRE_PHO` (no PHO yet) → `MAINTENANCE` (PHO ≤ date ≤ PHO + maintenance_months) → `POST_FHO_DESIGN_LIFE` (after FHO, within design life if published, max 10 years) → `BEYOND` → `UNKNOWN` (no package data).
2. Maintenance months come **only** from the package/contract (`INPUT` with source). If missing, show "Maintenance period unknown — add contract data" and, as context only, "minimum commonly cited: 6 months permanent / 3 months semi-permanent (TODO_VERIFY)". **No warranty flag is raised from an assumed period.**
3. **Warranty flag** `EARLY_FAILURE_IN_MAINTENANCE`: raised when an **inspector-confirmed** failure date falls in `MAINTENANCE` stage of a `CONTRACT` repair. Wording W-03; target = package + case; notify APPROVER (PPK) and COORDINATOR; suggest pending code `PROVIDER_OBLIGATION`. Public view: "Under technical review".
4. Failure in `PRE_FHO` window found at the `PRE_FHO` milestone → same flag, plus reminder that FHO acceptance should wait until resolved (recommendation, not a decision).
5. Failure in `POST_FHO_DESIGN_LIFE` → indication W-04 "kerusakan dini yang perlu dinilai oleh pihak berwenang"; never "kegagalan bangunan" (UU 2/2017 Pasal 65 is a legal/technical determination).
6. `SWAKELOLA` repairs: no provider warranty; early failure → recurrence + learning loop only (indication W-09 if repeated).
7. `TEMPORARY` patches: never warranty-flagged; tracked by the permanent-repair clock.
8. Retention/guarantee status is shown only if the agency enters it (`INPUT`); the app does not know whether a guarantee was claimed.

---

## 8. What to recommend to the agency (rule-based, never claimed as done)

| Trigger | Recommendation (ID, from wording library) | Basis |
|---|---|---|
| Early failure, W-03/W-04, recurrence W-09, `QUANTITY_DIFFERENCE`, missing stage evidence | **Core drill** to check layer thickness and density; density requirement **≥ 98%** under the applicable specification (W-10) | Spesifikasi Umum 2018 rev. 2 as reported in PNJ core study |
| Contract overlay/reconstruction | Coring per BPK physical-testing practice: at least **2 points per cross-section per lane**, sections ≤ 100 m apart; thickness measured on at least three sides of the core and averaged | BPK Perwakilan Maluku Utara, Buku Saku Pemeriksaan Pengujian Fisik Pekerjaan Konstruksi Jalan |
| Thickness check reference | Tolerances used by BPK booklet: AC-WC 4.0 cm nominal −3.0 mm; AC-BC 6.0 cm −4.0 mm; AC-Base 7.5 cm −5.0 mm | BPK Malut booklet |
| `LOW_MIX_TEMPERATURE`, long haul delay | Review mix delivery and laying procedure; check density by core | PNJ; Aston |
| Ponding / water at edges | Check drainage (saluran tepi jalan is part of the road, PP 34/2006 Pasal 34) | note 04 §1 |
| Rutting / structural signs | DCP on base/subgrade (v4 M5.3), deflection test (Benkelman/FWD) for overlays — no acceptance thresholds sourced (`TODO_VERIFY`) | note 07 Q6 Gaps |
| Repeated temporary patches on same spot | Plan permanent repair; record the decision as a delay reason with date | note 04 §7 |

Lab or field test results the agency shares are stored as `INPUT` evidence (photo of lab sheet + typed values), never as `MEASURED` by the app.

---

## 9. Learning loop (how outcomes feed back)

| Outcome data | Feeds | How | Guardrails |
|---|---|---|---|
| Inspector class corrections; follow-up photos with failure modes | CV models | periodic retraining set (location-split; Indonesian held-out test incl. BPID) | DEMO excluded; consent-compliant blurred images only |
| Repair survival (failure date or censored) per method, material, region, wet months | PINN priors / empirical blend | survival analysis (e.g. Kaplan–Meier per method; P10/P50/P90 of observed life) replaces physics prior when n ≥ 5 | report n and confidence; never extrapolate across regions without label |
| Actual vs PINN range | PINN calibration | coverage check: share of failures inside P10–P90 should be ~80%; if not, widen/re-train | publish in `measurements/pinn_calibration.json` |
| Declared vs measured quantities; fair-cost diffs | cost engine | refine `ASSUMED` density, waste factors; never auto-change `OFFICIAL` coefficients | each change is a config version event |
| Stage indications (temperature, haul delay) vs later failure | checklist thresholds | calibrate SOFT thresholds from local data (note 07 Q8 says they need local calibration) | change only via ADMIN config with rationale |
| % repairs lasting ≥ 3 / 6 months; % temporary made permanent | agency report card (v4 M3.5) | public when n ≥ 10, labelled "operational metrics, not an official assessment" | — |
| Segment recurrence ("X of Y repairs failed within Z months") | AUDITOR dashboard, `measurements/recurrence.json` (exists) | evidence for the fail → re-budget loop (note 03 §6) | indications only (W-09) |

---

## 10. Acceptance criteria

1. **RV-1** Given a `PERMANENT` hot-mix work order, when the crew submits without a `MIX_TEMP_MAT` photo, then `SUBMIT_WORK_EVIDENCE` is rejected listing the missing HARD stages.
2. **RV-2** Given `CLEAN_DRY` marked FAIL by the supervisor, when the supervisor tries `VERIFY_WORK` without override reason, then it is rejected.
3. **RV-3** Given acceptance at T0, then follow-ups M1, M3, M6 are created with windows; `PRE_FHO` is created only if `maintenance_months` is an `INPUT` from package data; `HEAVY_RAIN` is created on the first trigger after T0.
4. **RV-4** Given an inspector-confirmed failure 4 months after PHO with `maintenance_months=6` (INPUT), then flag `EARLY_FAILURE_IN_MAINTENANCE` with wording W-03 is created on the package and case, APPROVER and COORDINATOR are notified, and the public view shows "Under technical review".
5. **RV-5** Given no package data, when a failure is confirmed, then no warranty flag is created and the UI asks for contract data.
6. **RV-6** Given a failure before PINN P10, then indication W-04 and the recommendation list (core drill, density ≥ 98%) appear in the next audit report version.
7. **RV-7** Given the same person as crew and as M3 follow-up recorder, then `FORBIDDEN SOD-4`.
8. **RV-8** Given lab results entered by the agency, then they are stored with status `INPUT` and source photo, and documents print "hasil uji instansi (masukan)".
9. **RV-9** Given a DEMO case, then its follow-ups and outcomes never enter calibration, report cards or `measurements/*.json`.
