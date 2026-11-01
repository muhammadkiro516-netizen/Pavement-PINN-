# 13 — Work Plan (phases, priorities, schedule, risks)

> Two tracks run in parallel: **Build** (Claude Code, driven by Farrel) and **Human evidence** (things only people can do: Intel hardware, photos, interviews, user tests, IDR, deck). The build track is useless for scoring without the human track — Metric 3 alone swings ~16 points on Intel hardware access (`12_JUDGE_QA.md` Part 2).
> Priorities: **P0** = needed for the interview demo/Q&A; **P1** = clearly raises score; **P2** = nice to have, only if ahead.
> Effort = focused working days (1 day ≈ 6 h of a person, or one long Claude Code session with review). Estimates assume the existing v4 codebase (`/home/claude/deck/repo/r`) is the base — **build on it, do not rewrite**.
> Owners: **Salman** (lead — story, deck, agency/organizer contact, interviews), **Farrel** (developer — drives Claude Code, code review, Intel benchmarks), **Ibnu** (field & data — photos, labelling, field measurements, user tests, registry checks). Suggested; swap as needed.

---

## 1. Phases (build track) — order matches `01_CLAUDE_CODE_PROMPT.md`

Every phase ends with: tests green (`npm test`, `npm run test:py`, `npm run lint`), `PROGRESS.md` updated (≤ 30 lines), commit with `Assisted-by: Claude Code` trailer, and a **fresh public HTTPS URL** (cloudflared tunnel or the fixed host) tested on a phone.

| Phase | Content (spec file) | Pri | Depends on | Effort | Owner | Acceptance criteria |
|---|---|---|---|---|---|---|
| **B0 Kickoff & rails** | Copy pack to `docs/v5/`; read it; plan ≤ 15 lines; `DEMO_MODE` flag + banner; `SourceChip` + measurement JSON header helper; tunnel URL | P0 | — | 0.5 | Farrel | Tests green; URL opens on phone; demo banner visible when `DEMO_MODE=1`; no number renders without a source chip in new components |
| **B1 Design system & shell** | Tokens light theme, Barlow fonts, components, AppShell, BottomNav, Pavi role variants (`09_UI_UX_SPEC.md` §1–3, §7) | P0 | B0 | 1.5 | Farrel | `scripts/check-contrast.ts` passes; existing screens still work (e2e green); Pavi renders 9 role variants; reduced-motion honored |
| **B2 Event chain + state machine + 9 roles/SoD** | `02_SPEC_v5.md` §3–4 + §10 steps V5-0…V5-3, `03_ROLES_RBAC.md`, `07_AUDIT_INTEGRITY.md` (chain part): v5 types with legacy aliases; append-only hash-chained events (replace plain audit array, migrate v4 audit); v5 transitions; map old roles (Warga→CITIZEN, Petugas→FIELD_INSPECTOR, Koordinator→COORDINATOR, Pimpinan→AGENCY_HEAD) and add APPROVER, REPAIR_CREW, SUPERVISOR, AUDITOR, ADMIN | P0 | B0 | 2.5 | Farrel | Tamper test (edit 1 byte → verify fails at that seq); one test per transition row; SoD tests (recommender ≠ approver, crew ≠ supervisor, contractor-linked user blocked, auditor read-only, allowed overlaps logged); route access matrix test from `data/roles.json`; v4 data migrates (dry-run diff) |
| **B3 Authority routing + map** | `04_AUTHORITY_ROUTING.md`; road registry with SK + date; snap ≤ 25 m; office lookup; fallback LOW confidence; transfer requires SK; map legend (`09` §8); Jakarta first | P0 | B2, data from H6 | 2 | Farrel + Ibnu (data) | Routing test set (≥ 30 Jakarta points incl. national, provincial, toll) passes; legend shows 8 levels with patterns; tap road → owner + SK + confidence |
| **B4 Capture & measurement** | `05_CAPTURE_AND_MEASUREMENT.md`; live camera only in prod (no file input), nonce, server time, GPS accuracy, motion sample, pHash dup, EXIF strip, blur; demo photos stamped DEMO; long-stretch mode; inspector depth (ruler photo + typed + read-back flag); marker-card area / size band | P0 | B1, B2 | 2 | Farrel | Prod build has no gallery input (test); demo records stamped; long-stretch ≥ 3 photos, trace length stored; depth mismatch > 5 mm flags; citizens never asked depth |
| **B5 Cost fairness engine** | `06_COST_ENGINE.md` (AHSP structure, regional wages/IKK/asphalt price, OH&P, PPN, status per input, ±20 % neutral flag) | P0 | B3 (region), H7 (coefficients) | 1.5 | Farrel | Unit tests reproduce worked examples in `06`; every input carries MEASURED/OFFICIAL/INPUT/ASSUMED/TODO_VERIFY; missing coefficients show TODO_VERIFY, never a guess |
| **B6 Repair verification & follow-ups** | `08_REPAIR_VERIFICATION.md`; crew evidence checklist; supervisor check; follow-ups 1/3/6 months + first heavy rain + before FHO + every 6 months; warranty flag; PINN expected-life comparison | P0 | B2, B4 | 1.5 | Farrel | Checklist gating works; schedule computed at read time; early failure inside maintenance period raises warranty flag; recurrence metric updates `measurements/recurrence.json` |
| **B7 Checkpoints, verify page & documents** | `07_AUDIT_INTEGRITY.md` + `02` §10 V5-9: daily Merkle root, public verify page, PDF with SHA-256 + QR from `templates/*.html`; two outputs (independent report on PAVEMENT-PINN letterhead "Bukan naskah dinas"; unbranded watermarked agency draft); never a government kop | P0 (Merkle checkpoint, verify, PDFs) · P1 (OpenTimestamps anchor + upgrade job, optional RFC 3161) | B2 | 1.5 (+0.5 P1) | Farrel | Verify page matches PDF hash; PDF hash reproducible from the same snapshot; no government emblem in templates (test greps) |
| **B8 AI/ML evaluation** | `10_AI_ML_PLAN.md`: dedup RDD_Indonesia, location splits, train own detector, extend `cv_eval.py`, `pinn2_ablation.json`, SLM 50-case eval, `quant_delta.json`, model/data cards | P0 (dedup, splits, cv_eval on BPID + old model, pinn2 ablation, slm 50) · P1 (own detector training, pothole seg, area field study script) · P2 (RT-DETR) | B0; GPU time; H2 photos | 3 (spread; training runs in background) | Farrel (+Ibnu labels) | JSON files exist with common header; Evidence page reads them; no number without a file |
| **B9 Intel evidence** | `11_INTEL_EVIDENCE_PLAN.md`: `env_report.py`, `ov_bench.sh`, `torch_vs_ov.py`, `run_all.py --device`, SLM on NPU, screenshots index | P0 | H1 hardware | 1 (once hardware is there) | Farrel | `env_<host>.json` shows Intel CPU/GPU/NPU names; summary table renders on `/bukti/` with HOST_INTEL badge |
| **B10 Public pages & gamification** | `/why/` (from `14_BACKGROUND_STORY.md`), `/tour/` 60 s on `DEMO-0001`, `/bukti/` refresh with status table (configured/tested/piloting/operational), quests/badges/certificate with name entry + verify | P0 (why, tour, bukti) · P1 (gamification screens, certificate) | B1–B7 | 1.5 | Farrel + Salman (copy) | Tour ≤ 60 s on phone; all Why facts have footnotes; certificate PDF has QR verify, no gov emblem, name only at claim |
| **B11 Hardening & deploy** | Accessibility (axe), 320 px reflow, offline queue e2e, performance budget, Xeon VM deploy, `GENAI_DISCLOSURE.md`, `CORE_EXPLAINED.md`, `TEST_REPORT.md` (bugs fixed + failure cases) | P0 (offline e2e, deploy URL stable, disclosure) · P1 (axe 0 serious, perf budget) | all | 1.5 | Farrel | Lighthouse/axe reports saved in `docs/evidence/`; fixed URL works on Android Chrome + iOS Safari (camera, GPS, PWA install) |

**Mapping to `02_SPEC_v5.md` §10 migration steps:** B0→(flags only) · B1→V5-10 (theme/copy part) · B2→V5-0, V5-1, V5-2, V5-3 · B3→V5-5 · B4→V5-4, V5-6 · B5→V5-8 · B6→V5-7 · B7→V5-9 · B10→V5-10 (DEMO isolation, public pages) · B11→V5-11 (Supabase SQL, only when credentials exist) + deploy. B8/B9 follow `10_` and `11_`.

**Total build effort:** ≈ 20–22 working days of one developer — too much for 14 days solo. Hence: Claude Code does most implementation; Farrel reviews; P1/P2 cut as needed (§4).

---

## 2. Human evidence track (cannot be delegated to Claude Code)

| ID | Task | Pri | Owner | Effort | Due (day) | Output file |
|---|---|---|---|---|---|---|
| H1 | **Get Intel hardware**: borrow a Core Ultra laptop (best) and/or Intel Tiber AI Cloud; Xeon VM for server | P0 | Salman (ask), Farrel (setup) | 0.5–2 | D3 (request D1) | `env_<host>.json` |
| H2 | Take ≥ 100 local damage photos (≥ 30 % wet/night; stop safely, never from a moving vehicle), ≥ 20 photos per scene class; label in YOLO format; consent + blur | P0 | Ibnu | 2 | D6 | `eval/local_test/` |
| H2b | **Area/depth field study**: 30–50 potholes, tape + chalk outline + ruler depth, marker card photos | P1 | Ibnu + Salman | 1.5 | D9 | `eval/field_area/*.csv` → `area_field.json` |
| H3 | Interviews: 1–2 officers (Sudin/Satpel Bina Marga, UPTD, or Dinas PU) + 3–4 riders/ojol; consent; transcript | P0 | Salman + Ibnu | 1.5 | D8 | `docs/evidence/interviews/` |
| H3b | Usability test round 1 (5–8 users: ~4 riders, 2 elderly, 1–2 RT/RW), tasks + SUS; round 2 after fixes | P1 | Ibnu | 1 + 1 | D7, D12 | `measurements/sus.json`, `docs/evidence/usability_round{1,2}.md` |
| H4 | IDR: email organizer; complete available Intel DR/AI course(s); save certificates | P0 | Salman | 0.5 | D4 | `docs/evidence/intel_program.md`, `docs/evidence/idr/` |
| H5 | Deck (12 slides max, numbers only from files), demo script, 5 timed rehearsals, backup video of the tour | P0 | Salman (+all) | 2 | D13–D14 | deck + `docs/evidence/demo_backup.mp4` |
| H6 | Road registry data: verify Jakarta national/provincial/toll segments against Kepmen PUPR 1688/KPTS/M/2022 and Satu Data Jakarta; Sudin/Satpel office addresses | P0 | Ibnu | 1 | D4 | `data/*.csv` (format from `04`) |
| H7 | Cost inputs: fetch SE Dirjen Bina Konstruksi 30/SE/Dk/2025 Lampiran V coefficients; UMP/UMK 2026; BPS IKK 2025; Pertamina asphalt price; label each | P0 | Salman | 1 | D5 | `data/*.csv` (format from `06`) |
| H8 | Pilot: share the public URL with 10–20 real users in one area (riders, RT group); collect real reports | P1 | Ibnu + Salman | ongoing | D8–D14 | `measurements/pilot.json` |
| H9 | Agency outreach: one-page pilot proposal to one Sudin/Satpel or Dinas PU; record replies honestly | P1 | Salman | 0.5 | D10 | `docs/evidence/outreach.md` |

---

## 3. Day-by-day schedule (14 days)

Day 1 = Mon 2 Nov 2026 (shift all dates if the interview date differs; keep Day 14 = final rehearsal, ≥ 1 day before the interview).

| Day | Build (Claude Code + Farrel) | Human (Salman / Ibnu) | End-of-day check |
|---|---|---|---|
| D1 Mon 2 Nov | B0 kickoff, demo flag, source chips, tunnel | Salman: request Intel laptop/cloud + email organizer (H1, H4). Ibnu: start photo collection (H2), registry check plan (H6) | Phone opens URL |
| D2 Tue 3 Nov | B1 tokens, fonts, shell, components | Salman: start cost inputs (H7). Ibnu: photos + Jakarta segments | Light theme live |
| D3 Wed 4 Nov | B1 Pavi variants, states, motion; B2 start | Farrel: set up Intel machine if available (H1). Salman: interview requests (H3) | Contrast script passes |
| D4 Thu 5 Nov | B2 event chain + state machine + 9 roles + SoD tests | Ibnu: registry CSV delivered (H6). Salman: IDR course (H4) | SoD tests green |
| D5 Fri 6 Nov | B2 finish (v4 data migration); B3 routing + legend (Jakarta) | Salman: cost CSV delivered (H7). Ibnu: labelling | Tap road → owner + SK |
| D6 Sat 7 Nov | B3 finish; B8 dedup + splits + cv_eval on BPID & old model (background) | Ibnu: ≥ 100 photos labelled (H2) | `dedup_rdd_indonesia.json`, `cv_eval_bpid_ood_*.json` |
| D7 Sun 8 Nov | B4 capture (camera-only, nonce, demo stamps, long stretch) | Ibnu: usability round 1 (H3b) | No gallery input in prod build |
| D8 Mon 9 Nov | B4 inspector depth + marker card; B8 detector fine-tune starts (Intel XPU if available) | Salman + Ibnu: interviews (H3); start pilot sharing (H8) | Depth mismatch flag works |
| D9 Tue 10 Nov | B5 cost engine | Ibnu + Salman: area field study (H2b) | Worked examples match `06` |
| D10 Wed 11 Nov | B6 repair checklist + follow-ups + warranty flag | Salman: agency one-pager (H9) | Recurrence JSON updates |
| D11 Thu 12 Nov | B7 Merkle checkpoint, verify page, PDFs; B9 Intel benches (needs H1) | Farrel: run `11` matrix on Intel; screenshots | `env_<host>.json` HOST_INTEL |
| D12 Fri 13 Nov | B9 SLM NPU + torch_vs_ov; B8 cv_eval own model + quant_delta | Ibnu: usability round 2 (H3b) | `slm_NPU.json` exists (MEASURED or NOT_SUPPORTED) |
| D13 Sat 14 Nov | B10 `/why/`, `/tour/`, `/bukti/` status table; gamification if time | Salman: deck from files (H5) | Tour ≤ 60 s on phone |
| D14 Sun 15 Nov | B11 offline e2e, axe, deploy fixed URL, disclosure docs; freeze | All: 5 timed rehearsals, record backup video (H5) | Code freeze; everything in `PROGRESS.md` |

Daily rule: 15-minute stand-up (what's done / blocked / which numbers changed). Any new number goes into `measurements/` first, deck second.

---

## 4. Emergency 5-day cut (if time or rate limits collapse)

Keep only what the demo and the Q&A need. Everything else is described honestly as "planned".

| Day | Build (P0 minimum) | Human (P0 minimum) |
|---|---|---|
| E1 | B0 + tokens (light theme only, no new components beyond chips/banners) + demo banner + seed `DEMO-0001` | Request Intel hardware + IDR email; collect 50+ photos |
| E2 | B3 Jakarta routing + legend (seeded CSV, no admin UI); B4 camera-only prod + DEMO stamps (skip long-stretch UI polish: trace + photo count only) | Registry check for demo corridor; cost inputs for one item (hot-mix patching) |
| E3 | B5 fair-cost range for 11.1.(9) + tack coat only; B6 checklist + 1/3/6 schedule (reuse v4 F1 logic); B7 verify page from the B2 chain (skip OpenTimestamps) | Label 50 photos; 1 interview (rider or officer) |
| E4 | B8 cv_eval on BPID + local 50 photos with the **existing** detector (honest "before" numbers); B9 Intel benches + SLM NPU attempt | Farrel on Intel machine all day |
| E5 | B10 `/why/` + `/tour/` + `/bukti/`; deploy URL; freeze | Deck + 5 rehearsals + backup video |

**Cut list (say "planned" if asked):** 9-role screens beyond Citizen/Inspector/Coordinator/Approver/Auditor (Crew, Supervisor, Head, Admin shown read-only or via seeded data), gamification polish and certificate, avatar builder, pothole segmentation training (use size bands), own detector training, RT-DETR, area field study, OpenTimestamps anchoring, RAG, dark mode polish, ID translations of staff screens.

---

## 5. Risk register

| # | Risk | Likelihood | Impact | Mitigation | Owner | Trigger / fallback |
|---|---|---|---|---|---|---|
| R1 | **No Intel hardware in time** | Medium | Very high (Metric 3 ≈ −16) | Ask 3 sources on D1 (campus lab, organizer, Tiber cloud); scripts ready so a 3-hour slot is enough | Salman | No device by D8 → Tiber AI Cloud CPU/Xeon only; say "NPU configured, not tested" |
| R2 | NPU fails to run Qwen2.5-1.5B | Medium | Medium | Try NPU export recipe, then 0.5B; record error | Farrel | Run on iGPU; record `NOT_SUPPORTED` honestly |
| R3 | Local CV accuracy is poor on BPID/local photos | High | Medium | Report as-is with CIs + per-condition; show improvement plan; fine-tune | Farrel | Present as "baseline we measured" — honesty scores (testing/ethics) |
| R4 | RDD_Indonesia mostly duplicates RDD2022 | Medium | Low–Medium | Dedup script D6 | Farrel | Drop "Indonesian training data" claim; rely on BPID + own photos |
| R5 | Claude Code rate limits / long sessions stall | High | High | Phase-sized prompts, `PROGRESS.md` handoff, commit per phase, emergency cut | Farrel | Switch to E-plan at D7 if < B3 done |
| R6 | Tests break during UI rework | Medium | Medium | Keep old CSS variable aliases; e2e on each phase; never weaken tests | Farrel | Revert phase commit |
| R7 | Live demo fails (network, camera permission, tunnel down) | Medium | High | Tour assets pre-cached; offline mode; backup video; second device | Salman | Play backup video, continue talking |
| R8 | A claim in the deck is unsourced or wrong | Medium | High (credibility) | Only `14_BACKGROUND_STORY.md` §5 facts; deck numbers pulled from `measurements/` | Salman | Remove the slide item |
| R9 | Privacy incident (face/plate visible in a public photo) | Low | High | Blur before storage; manual check of demo/pilot photos; "something private" flag | Ibnu | Unpublish photo, log correction |
| R10 | Officer interviews don't happen | Medium | Medium (audience/validation) | Ask early (D3); offer 15-min call; riders as fallback | Salman | Say "not yet; first field step" (Q3 fallback) |
| R11 | Registry data wrong (road assigned to the wrong authority) | Medium | Medium | Confidence shown; coordinator confirm; SK citation on transfer; test set | Ibnu | Mark segment LOW confidence |
| R12 | Cost coefficients not found in SE 30/2025 Lampiran V | Medium | Medium | TODO_VERIFY labels; show range only for items with coefficients | Salman | Demo only verified items |
| R13 | Defamation / misreading of flags | Low | High | Neutral wording, flags on packages, right of reply | Salman | Remove wording, log correction |
| R14 | AGPL licensing question from judges | Medium | Low | One-line answer + RT-DETR path | Farrel | — |
| R15 | Team member unable to attend/speak | Low | High (points deducted) | Each member owns ≥ 4 Q&A answers; cross-train with `CORE_EXPLAINED.md` | Salman | Others cover; never add/replace members |

---

## 6. Definition of Done (whole project, before interview)
- [ ] Fixed public HTTPS URL works on Android Chrome and iOS Safari (camera, GPS, PWA install); tunnel as backup.
- [ ] `/tour/` ≤ 60 s; `/why/` fully sourced; `/bukti/` shows every number from `measurements/` with configured/tested/piloting/operational labels.
- [ ] 9 roles with SoD enforced server-side; demo role switcher only in demo mode.
- [ ] Routing + legend for the Jakarta pilot area; transfer requires SK.
- [ ] Live-camera-only in production; demo records stamped.
- [ ] Fair-cost range + repair checklist + follow-ups + warranty flag + hash chain + verify page + two PDF outputs.
- [ ] Intel: `env_<host>.json` (Intel), benchmark summary, same-device PyTorch vs OpenVINO, SLM device result; IDR file honest.
- [ ] AI: dedup + splits + cv_eval (BPID + local) + pinn2 ablation + SLM 50 cases.
- [ ] Interviews/usability results filed (or honestly "not yet").
- [ ] All tests green; `GENAI_DISCLOSURE.md`, `CORE_EXPLAINED.md`, `TEST_REPORT.md`, `PROGRESS.md` current.
- [ ] 5 timed rehearsals; backup video; every member can answer their Q&A items.
