# 12 — Judge Q&A (20 questions) + Rubric Gap Table

> Interview format: 5 min demo + 15 min Q&A, all members must speak. Each answer below is ~30 seconds spoken (70–85 words), followed by the file/screen to show and an honest caveat.
> **Placeholders in `[brackets]` must be filled from real files before the interview.** If the file still says `BELUM_DIUKUR`/empty, use the *"If not done"* line — never guess a number.
> Status words (use exactly): **configured** (code exists, not run there) · **tested** (ran, result file committed) · **piloting** (real users, time-boxed, logged) · **operational** (agency uses daily — we are not there).
> Speaker suggestion: A = Salman (problem, impact, plan), B = Farrel (AI, Intel, tests), C = Ibnu (users, ethics, field).

---

## Part 1 — The 20 questions

### Q1. What real problem are you solving, and what evidence shows it is not handled well? (A)
**Answer:** "Road damage that kills, and repairs that don't last. Jakarta police counted 27 pothole crashes in 28 days this January; four riders died in 13 days on one road in Tangerang. People do report, but Central Java's own app found only about 5 % of road reports were on roads it could fix. The Ombudsman calls it 'no viral, no justice'. And auditors keep finding paid work not delivered — Rp 141 billion in 83 local governments in one BPK report."
**Show:** `/why/` page (Problem 1–3 blocks with sources). File: `14_BACKGROUND_STORY.md` §5.
**Caveat:** Indonesia has no national count of pothole deaths; we say so rather than invent one.

### Q2. Why build PAVEMENT-PINN if reporting channels already exist? (A)
**Answer:** "Channels exist — Jakarta alone joins 14. What's missing is the layer after the complaint: knowing whose road it is, proving the damage and the repair with evidence that can't be swapped, merging duplicates, a public clock, and checking whether the patch lasted and cost a fair price. We don't replace SP4N-LAPOR! or JAKI; we feed them a verified, routed case and keep tracking it until it's really fixed."
**Show:** map legend (road owner colors) → case timeline → "Send to SP4N-LAPOR!" export (if built; else say "planned API/export").
**Caveat:** Integration with SP4N-LAPOR!/JAKI is **[configured as export / planned]** — no official API agreement yet.

### Q3. Do field officers really need the report–verify–repair–audit cycle? Who did you talk to? (C)
**Answer (if interviews done):** "We interviewed [N] people: [role, office, date]. They told us [quote on repeated patching / unclear road ownership / maintenance period]. That's why the inspector flow is short — measure depth with a ruler, one tap to accept or change the AI suggestion — and why follow-ups are timed to the maintenance period, when the contractor must still fix defects."
**If not done:** "Not yet with officials — that's our first field step. We based the flow on published procedures: SP4N-LAPOR! service times, the maintenance-period rules in procurement regulations, and the US SHRP repair study. We have an interview guide ready."
**Show:** `docs/evidence/interviews/*.md` (transcripts, consent), `docs/evidence/interview_guide.md`.
**Caveat:** Do not name officials without consent; quote role and office type only.

### Q4. What is the main difference from existing reporting systems? (A)
**Answer:** "One sentence: we connect a citizen's verified live photo to the agency legally responsible for that road, keep the case public until it's repaired, and check — with physics and a fair-cost estimate — whether the repair was the right size, the right price, and actually lasted. FixMyStreet-style routing exists abroad; independent repair verification with physics, cost ranges and a tamper-evident record is what we haven't seen in Indonesian channels."
**Show:** 60-second `/tour/`.
**Caveat:** "Haven't seen" is based on public descriptions of SP4N-LAPOR!, JAKI, Jalan Cantik, Teman Jabar, Wargaku — not a full feature audit of every app.

### Q5. Who is the main user, and who benefits most? (C)
**Answer:** "Three users, one case. Citizens — mostly motorcycle riders, 84 % of vehicles — report in under a minute without an account. Field inspectors get measured, routed cases instead of scattered complaints. Decision makers and auditors get a fair-cost range and repair history. The biggest beneficiaries are riders on local roads, where condition is worst: only 58 % of regency and city roads were in good or fair condition, versus 92 % of national roads."
**Show:** role switcher in demo; Why page chart.
**Caveat:** Role names follow Indonesian structures (PPK, Konsultan Pengawas, APIP) but no agency has adopted them yet.

### Q6. How do you make sure reports reach the right agency and don't just become data? (A)
**Answer:** "Routing uses a road-status registry based on official decrees — for national roads, Kepmen PUPR 1688/2022. A report snaps to the nearest road segment, we look up its status and office, and show our confidence. If we're unsure, a coordinator confirms, and a transfer must cite the decree. Then a public clock runs: escalation to the agency head at day 2, 7, 14 and 30, and delays must be explained publicly."
**Show:** tap a road on the map → owner + SK + confidence; escalation tab; public delay reason on `/lacak/:code/`.
**Caveat:** Registry coverage is **[Jakarta: N segments verified / TODO]**; outside the pilot area routing falls back to administrative boundaries with LOW confidence.

### Q7. Why AI? What can't rules do? (B)
**Answer:** "Rules can't look at a random phone photo in the rain and say 'this is a pothole, not a shadow'. That's computer vision. Rules also can't run two thousand layered-elastic simulations per case on a laptop in milliseconds — the physics-informed surrogate does that, so we get an uncertainty range. And a local language model turns case data into readable text. Everything else — routing, deadlines, cost formulas, the audit chain — is deliberately rule-based."
**Show:** Evidence page "Where AI is used — and where it is not" table (`10_AI_ML_PLAN.md` §1).
**Caveat:** The reference physics (PyMastic) needs no AI; we say that openly.

### Q8. How does AI judge road condition from photos, and how do you know it's right? (B)
**Answer:** "A detector finds damage and its class — longitudinal, transverse, alligator crack or pothole — and a segmentation model outlines it. With a printed marker card in the photo we convert the outline to square metres; without it, we only give a size band. We measure F1 at IoU 0.5 — the same metric as the 2022 global road-damage challenge — plus mAP, on test sets split by location, including 50 Bandung photos never used in training."
**Show:** `measurements/cv_eval_bpid_ood_<model>.json`, `cv_eval_rdd_test_<model>.json` on `/bukti/`.
**Numbers to say:** "F1 [x] on our RDD2022 split vs 0.770 for the 2022 winner's large ensemble; on Bandung photos F1 [y] (95 % CI [a–b])."
**If not done:** "Our current detector is a public model; we have not yet validated it on Indonesian photos. Our evaluation script and test split are ready; results will be on the Evidence page."
**Caveat:** Severity from a photo is an estimate; depth is never taken from AI.

### Q9. What do your MAPE and inference-time numbers mean? Are they reproducible? (B)
**Answer:** "MAPE is the average percentage error of our physics-informed surrogate against the layered-elastic solver it learned from: [0.67 %] for asphalt strain and [0.49 %] for subgrade strain on 300 test cases — but up to about 28 % at the 95th percentile outside the training range, so we refuse those cases. Inference time is median and 95th-percentile latency from benchmark scripts. Every number comes from a JSON file with the commit, device name and versions; one command regenerates it."
**Show:** `measurements/pinn2.json`, `measurements/bench_<host>.json`, `eval/README.md`.
**Caveat:** Current timings are from a non-Intel dev laptop until the Intel re-run (`hostLabel`). MAPE is against a solver, **not field data**.

### Q10. What data trains and tests the models? Is it representative of Indonesian roads? (B)
**Answer:** "Training uses RDD2022 — 47,420 images from six countries, none from Indonesia — plus an Indonesian Roboflow set of 8,397 images, but only after a duplicate check because its source isn't documented. For testing we hold out the Bandung Pothole set — 50 images with rain, night and shadow cases — and our own photos split by road segment. So: partly representative. We report results per condition so weaknesses are visible."
**Show:** `docs/DATA_CARD.md`, `measurements/dedup_rdd_indonesia.json`, `splits_manifest.json`.
**Caveat:** 50 Bandung images give wide confidence intervals; we show them. If the dedup check finds heavy overlap with RDD2022, we stop calling that set "Indonesian data".

### Q11. What if the photo is blurry, the road is under water, or the model is wrong? (C)
**Answer:** "Blurry or dark photos are caught on the phone and the user is asked to retake. If water may hide the hole, the case is marked 'severity unknown' and an inspector must measure it. Low-confidence detections go to a person, not the bin — nothing is silently deleted. If the model is wrong, the inspector corrects the class on site; that correction is logged and becomes training data. Citizens can also tap 'I disagree'."
**Show:** demo: blurry photo → retake message; water flag; inspector correction.
**Caveat:** No dedicated water-covered pothole dataset exists; our wet-road numbers rely on the Bandung wet/after-rain subset.

### Q12. Are repair recommendations given directly, or reviewed and approved by humans? (C)
**Answer:** "Always reviewed. The model only suggests. The inspector accepts or changes the repair type — a change needs a written reason. Then an approving officer, who by rule cannot be the person who recommended it, approves the plan and budget. The repair crew can't check its own work; a separate supervisor does. Every decision is a signed entry in the audit log."
**Show:** Approver screen with the separation-of-duties block ("You recommended this plan, so someone else must approve it").
**Caveat:** Legal overlaps that Indonesian rules allow (e.g., KPA acting as PPK) are permitted but logged.

### Q13. Why PINN? What does it add over a normal prediction model or existing guidelines? (B)
**Answer:** "We use physics where it's reliable. Our surrogate is trained on layered-elastic theory with the physics built in: dimensionless inputs, so elastic similarity holds exactly, and a monotonicity penalty. A plain network of the same size matches in-distribution accuracy but breaks similarity by up to a thousand percent. The benefit is speed: about two thousand times faster than the solver, so we can show a life range, not one number. We also tested a PINN for back-calculating layer stiffness — it failed, which matches a 2026 KAIST study, so we don't use it."
**Show:** `measurements/pinn2_ablation.json`, `pinn1_inverse.json`; arXiv 2606.03210.
**Caveat:** Life range is indicative, for comparing options and spotting early failure — not a failure date. Guidelines (Bina Marga manuals) still set the design; we don't replace them.

### Q14. What does GenAI do, and how do you stop it giving wrong technical information? (B)
**Answer:** "A small Qwen model runs locally and only writes text — status updates, delay explanations, cover notes. It never sees or writes numbers: it writes placeholders and our code fills them from the database. A checker rejects any draft with its own digits, banned words or missing sections; then a template is used instead. Every draft is labelled 'AI draft — needs human approval'. It can't change a case, approve, or choose a repair."
**Show:** an `AiDraftBlock` with highlighted placeholders + checker log; `measurements/slm.json`.
**Numbers:** "[On 50 test cases, checker pass rate x %, template fallback y %]." Current (10 cases, non-Intel CPU): 20 % accepted first try, 60 % fell back to template.
**Caveat:** Pass rate is low today; that's why the template fallback exists and the product works with the model switched off.

### Q15. What proves the prototype was tested? How many cases, which metrics, what results? (B)
**Answer:** "We have [N] automated tests passing on every commit, plus evaluation scripts that write results with commit and device: detection F1 and mAP on [n] test images, the physics surrogate's MAPE on 300 solver cases, the text model's checker pass rate on [50] cases, and latency on [devices]. We also ran usability tests: [n] users, SUS [x], task success [y] %. Failures are listed on the Evidence page too."
**Show:** `/bukti/`, CI log, `docs/TEST_REPORT.md` (bugs fixed, failure cases).
**If SUS not done:** "Usability testing with riders is scheduled [date]; the in-app SUS form is ready."
**Caveat:** Say "tested" only for items with a committed result file.

### Q16. Is it used by citizens or agencies? What's running vs still a plan? (A)
**Answer:** "Honestly: it's a working prototype on a public HTTPS link, not yet used by an agency. What runs today: live-camera reporting, AI detection, routing for [Jakarta pilot area], case tracking with escalation, the physics analysis, fair-cost estimate, audit log and PDF. Our pilot so far: [N] real reports from [M] people. Agency adoption, SP4N-LAPOR! integration and a full road registry outside Jakarta are plans."
**Show:** status table on Evidence page with configured / tested / piloting / operational per feature; `measurements/pilot.json`.
**Caveat:** `pilot.json` on 29 Oct 2026 = 2 reports, 1 account — update before the interview and say the live number.

### Q17. Why audits at months 1, 3 and 6? Validated by road managers? (C)
**Answer:** "It's the schedule used by the largest published pothole-repair field study, SHRP in the US and Canada: 1, 3 and 6 months, then every six months. A UK study saw hot-mix repairs failing at the edges around three months. We add one check after the first heavy rain and one before the end of the contract's maintenance period, while the contractor must still fix defects. It is not yet validated by an Indonesian road manager — that's part of our field step."
**Show:** follow-up calendar; `08_REPAIR_VERIFICATION.md`.
**Caveat:** The minimum maintenance-period length in regulations is `TODO_VERIFY`; we don't quote months until confirmed.

### Q18. How do you measure impact beyond report counts? (A)
**Answer:** "Four outcome measures, all computed from logs: median days from report to verified repair; share of reports routed to the right authority first time; share of repairs still intact at 1, 3 and 6 months — the recurrence rate; and the share of packages with complete repair evidence. Baseline comes from the same area before rollout, or from published figures like SP4N-LAPOR!'s 60-working-day limit."
**Show:** Agency Head dashboard charts; `measurements/recurrence.json`, `pilot.json`.
**Caveat:** We have targets, not achieved results. We don't present targets as results.

### Q19. Which Intel technology do you really use, on which device, and for which part? (B)
**Answer (after Intel run):** "On an [Intel Core Ultra model]: OpenVINO runs the damage detector on [CPU/GPU] at [x] ms, the physics surrogate's 2,000-sample Monte Carlo in [y] ms, and the Qwen text model on the NPU through OpenVINO GenAI at [z] tokens per second. NNCF made the detector INT8 — [a] % smaller, [b] mAP change. Training ran on [Arc iGPU via PyTorch XPU / Tiber AI Cloud]. The server runs on an Intel Xeon VM."
**If not done:** "Our pipeline is built on OpenVINO 2026.4, NNCF and OpenVINO GenAI, but today's benchmarks are from a non-Intel dev laptop, and they're labelled that way. We're re-running on [device] on [date]; NPU is configured, not yet tested."
**Show:** `measurements/env_<host>.json` (FULL_DEVICE_NAME), `benchmark_app/summary_<host>.json`, `slm_NPU.json`, screenshots in `docs/evidence/screens/`.
**Caveat:** Never imply every Intel device was used. Show the device name in the slide title.

### Q20. If you continue, what's the biggest risk and the first field test? (A)
**Answer:** "The biggest risk is adoption: an agency has to accept an outside system checking its repairs. So step one is small and useful to them: a three-month pilot on [one Jakarta corridor] with one Sudin or Satpel, where we route reports, measure, and run 1-month and 3-month checks on their patches, and compare recurrence with their records. Second risk is model bias on rainy, night and rural photos — we'll collect labelled local photos during that pilot."
**Show:** `13_WORK_PLAN.md` risk register; pilot one-pager.
**Caveat:** No agency commitment yet (state the real status of any email/letter).

---

## Part 2 — Rubric gap table (team estimate, not judge score)

Columns: **Now** = if the interview were today; **P0** = after P0 items in `13_WORK_PLAN.md`; **P0+P1** = after P1 too. "Status" uses configured/tested/piloting/operational.

### Metric 1 — Enriching Lives: Impact & Inclusion (30)

| Parameter (max) | Current status | What to build / show | Now | P0 | P0+P1 |
|---|---|---|---|---|---|
| Depth of impact (3) | Flow works end to end (tested); no before/after from real officers | Outcome KPIs on Head dashboard; pilot numbers; 1 officer quote | 1.5 | 2 | 2.5 |
| Scale of impact (3) | Region-agnostic registry design; Jakarta only configured | Second area configured with zero code change (e.g., a Jabar kabupaten) + cost per user/km with assumptions | 1.5 | 2 | 2.5 |
| Duration of impact (3) | 1/3/6-month follow-ups + maintenance period logic (tested) | Owner of each process, maintenance plan, model update plan | 2 | 2.5 | 3 |
| SDG alignment (3) | SDG 3.6, 9.1, 11.2, 16.6 mapped | One KPI per SDG on Why page | 2.5 | 3 | 3 |
| Problem clarity (3) | Was weak; now 3-problem story | `/why/` + one-sentence pitch | 2 | 3 | 3 |
| Evidence the problem exists (3) | Sourced facts in `14_BACKGROUND_STORY.md` | Sources clickable on `/why/` | 2.5 | 3 | 3 |
| Urgency (3) | Rainy-season surge Jan–Feb 2026, deaths, IJD ended 2025 | Timeline card on Why page | 2.5 | 3 | 3 |
| Target audience (3) | Roles defined (9) | Interview quotes from riders + 1 officer | 1.5 | 2 | 3 |
| Accessibility & inclusion (3) | No login, offline queue, ≤ 500 KB, ID/EN (configured/tested) | SUS + task tests with 5–8 users incl. elderly/low-end phone; axe report | 1.5 | 2 | 2.5 |
| Scalability (3) | Docker + Xeon deploy scripts (configured) | Second region + cost sheet + public URL stable | 1.5 | 2 | 2.5 |
| **Subtotal (30)** | | | **19** | **24.5** | **28** |

### Metric 2 — AI Innovation (30)

| Parameter (max) | Current status | What to build / show | Now | P0 | P0+P1 |
|---|---|---|---|---|---|
| Is AI needed? (2) | Clear AI vs rules split | Slide/table "where AI is not used" | 2 | 2 | 2 |
| Clear, effective use (3) | CV + surrogate + SLM in one flow (tested on non-Intel) | Stable 60-s tour, no failures | 2 | 2.5 | 3 |
| Idea classification / originality (3) | Combination is new to our knowledge | Comparison table vs SP4N-LAPOR!/JAKI/FixMyStreet | 2 | 2.5 | 2.5 |
| Model appropriateness (3) | Third-party detector, no pothole seg | Own fine-tuned detector + pothole seg; RT-DETR path noted | 1.5 | 2.5 | 3 |
| Sub-field understanding (2) | Strong on PINN limits (inverse fails, cited) | Every member can explain `CORE_EXPLAINED.md` | 1.5 | 2 | 2 |
| Data acquisition & analysis (2) | No dedup, no split files | Dedup check, location splits, data card | 0.5 | 1.5 | 2 |
| Ethics awareness (3) | Privacy, HITL, neutral flags, risk register | Appeal path live; model cards | 2.5 | 3 | 3 |
| GenAI transparency (4) | Disclosure doc auto-generated from `Assisted-by` trailers | Honest disclosure page + example output + checker log | 1.5 | 2 | 2.5 |
| Prototype (3) | Real inference in each module | Public HTTPS on phone | 2.5 | 3 | 3 |
| Testing (3) | Unit/e2e tests; PINN metrics; CV/SUS **not measured** | cv_eval on BPID + local, SLM 50 cases, SUS, area field study | 1 | 2.5 | 3 |
| Full-scale deployment (2) | Prototype only | Live pilot with real reports (piloting) | 0.5 | 1 | 1 |
| **Subtotal (30)** | | | **17.5** | **24.5** | **27** |

### Metric 3 — Use of Intel Technologies (30)

| Parameter (max) | Current status | What to build / show | Now | P0 | P0+P1 |
|---|---|---|---|---|---|
| Intel resources across lifecycle (3) | Map exists; proof non-Intel | Intel-host file per stage | 1 | 2.5 | 3 |
| Rationale (4) | Written rationale | Same-device PyTorch vs OpenVINO on Intel | 1.5 | 3.5 | 4 |
| HW benefit / vital (3) | Non-Intel numbers | Monte Carlo ms + NPU tokens/s on Core Ultra | 0.5 | 2.5 | 3 |
| HW types (3) | Configured only | CPU + iGPU + NPU + Xeon logged | 0.5 | 2.5 | 3 |
| HW coverage (4) | None on Intel | Data gen + XPU training + eval + deploy on Intel | 0.5 | 2.5 | 3.5 |
| SW benefit / vital (3) | OpenVINO/NNCF used (non-Intel) | `quant_delta.json` on Intel | 1.5 | 3 | 3 |
| SW types (3) | OpenVINO, NNCF, GenAI, Optimum Intel configured | env report with versions + usage | 2 | 3 | 3 |
| SW coverage (4) | Used in 4 stages (non-Intel) | 5 stages on Intel; RAG P2 | 2 | 3 | 3.5 |
| IDR participation (3) | Not documented | Organizer confirmation + course certificates | 0 | 3 | 3 |
| **Subtotal (30)** | | | **9.5** | **25.5** | **28** |

**Totals (estimate):** Now ≈ 46/90 · after P0 ≈ 74.5/90 · after P0+P1 ≈ 83/90.
The single biggest lever is **Intel hardware access** (Metric 3 moves ~16 points). The second is **measured CV results on Indonesian photos + user tests** (Metric 1 and 2 testing/data/audience).

---

## Part 3 — Rapid-fire backup answers (≤ 10 s each)

| Likely follow-up | Answer |
|---|---|
| "Can't people fake photos?" | "Production allows only live in-page camera with a one-time server code, GPS and motion data; duplicates are caught by image hashing. Demo mode is labelled DEMO everywhere." |
| "How do you get depth?" | "An inspector lays a straightedge, photographs a ruler at the deepest point and types the value; AI reads the ruler to cross-check. Citizens are never asked for depth." |
| "Is the cost estimate official?" | "No. It's a fair-cost range using the official AHSP structure and regional prices, each input labelled. A gap over 20 % says 'needs clarification', not 'fraud'." |
| "Why blockchain?" | "No blockchain token. An append-only hash chain with a daily public timestamp (OpenTimestamps) — enough to prove nothing was changed. Personal data is never in it." |
| "Do you generate government letters?" | "Never a government letterhead. We export our own audit report marked 'not an official document', and an unbranded draft the agency can put on its own letterhead and sign." |
| "AGPL?" | "Prototype uses YOLO under AGPL, fully open-sourced; production path is RT-DETR (Apache-2.0)." |
| "What if the agency ignores it?" | "The case stays public with its clock and escalation; delay reasons are published; it can be exported to SP4N-LAPOR! and the Ombudsman channel." |
