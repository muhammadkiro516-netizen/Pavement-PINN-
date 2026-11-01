# PAVEMENT-PINN DevPack v5 — README

> **What this is:** the complete hand-off pack to rebuild PAVEMENT-PINN v5 with Claude Code, plus the evidence, story and Q&A material the team needs for the Intel AI Global Impact Festival 2026 Stage 3 interview (5-min demo + 15-min Q&A; rubric 90 pts = Impact 30 · AI Innovation 30 · Intel Tech 30 incl. IDR 3).
> **Product in one sentence:** PAVEMENT-PINN connects a citizen's verified photo to the agency legally responsible for that road, keeps the case visible until it is repaired, and checks — with physics and a fair-cost estimate — whether the repair was the right size, the right price, and actually lasted. It feeds SP4N-LAPOR!/JAKI; it is not another inbox.
> **Team:** Muhammad Salman Al Farisi (lead) · Farrel Chandra Berwyn (developer) · Muhammad Ibnu Riyansyah. Pack date: 2026-11-01. Base code: v4 branch (React 19 + Vite PWA, Express TS, FastAPI + OpenVINO).

---

## 1. How to hand it to Claude Code (5 steps)
1. Copy this folder into the repo as **`docs/v5/`** (keep subfolders `data/`, `templates/`, `scripts/`, `research/`). Create branch `v5` from `v4`. Confirm `npm test`, `npm run test:py`, `npm run lint` are green.
2. Open Claude Code in the repo root. Paste the prompt section of **`01_CLAUDE_CODE_PROMPT.md`** (everything under "PROMPT").
3. Let it run **one phase per session** (B0 → B11). At the end of each phase it prints an HTTPS URL — open it on your phone and try the 3 listed steps before typing "continue".
4. Start a fresh session for each new phase with: *"Continue with the next phase in `docs/v5/01_CLAUDE_CODE_PROMPT.md`. Read `PROGRESS.md` first."*
5. In parallel, do the human tasks H1–H9 in `13_WORK_PLAN.md` §2 (Intel hardware, photos, interviews, usability tests, IDR, data checks, deck). Without them, many scores cannot move (see `12_JUDGE_QA.md` Part 2).

---

## 2. Read order
**For Claude Code:** `DECISIONS_v5.md` → `02_SPEC_v5.md` → `13_WORK_PLAN.md` → per phase the topic file (03–11) with its data/templates/scripts → `14`/`12`/`research/` only for copy and facts. Precedence when files disagree: **DECISIONS > 02 > topic file > 09** (09 wins only on visual design, microcopy and motion).

**For the team (humans):** `00_README.md` → `14_BACKGROUND_STORY.md` (the story you tell) → `12_JUDGE_QA.md` (answers + rubric gaps) → `13_WORK_PLAN.md` (who does what, when) → `11_INTEL_EVIDENCE_PLAN.md` (what to run on Intel hardware) → `10_AI_ML_PLAN.md` (what to measure) → `09_UI_UX_SPEC.md` (what the app will look like).

---

## 3. File index

### Core documents
| File | What it contains | Main reader |
|---|---|---|
| `00_README.md` | This file: pack contents, read order, hand-off steps, status legend | Everyone |
| `01_CLAUDE_CODE_PROMPT.md` | **Canonical** one-shot kickoff prompt: context, read order, hard rules, phases B0–B11 with Definition of Done, hosting, commit trailer, when to stop and ask, final checklist; model/effort note for the human | Claude Code + Farrel |
| `DECISIONS_v5.md` | Fixed product decisions (roles, routing, capture, cost, audit, durability, AI honesty, UI, gamification). Identical to the shared decisions all writers followed | Everyone |
| `02_SPEC_v5.md` | Master functional spec: goals, glossary, v5 state machine + SLA + escalation + delay reasons, v4→v5 mapping, features per role with acceptance criteria, API, DB schema, privacy/performance/offline/a11y NFRs, DEMO MODE rules, migration steps V5-0…V5-11, TODO_VERIFY register | Claude Code |
| `03_ROLES_RBAC.md` | 9 roles (EN + ID), duties, permission matrix, separation-of-duties rules, allowed legal overlaps | Claude Code |
| `04_AUTHORITY_ROUTING.md` | Road-status registry (SK-based), snapping, authority/office resolution, Jakarta specifics, fallback confidence, correction/transfer workflow, map coloring | Claude Code + Ibnu |
| `05_CAPTURE_AND_MEASUREMENT.md` | Live-camera capture + anti-fake, demo mode, long-damage GPS-trace mode, inspector depth (ruler) and area (marker card) protocol, size bands | Claude Code |
| `06_COST_ENGINE.md` | AHSP-structured fair-cost engine, regional inputs, statuses per input, worked examples, ±20 % neutral flag | Claude Code + Salman |
| `07_AUDIT_INTEGRITY.md` | Event log + hash chain, canonical JSON, daily Merkle checkpoint, OpenTimestamps / optional RFC 3161, verify page (`/verify`, `/v/:docId`), document outputs, legal wording | Claude Code |
| `08_REPAIR_VERIFICATION.md` | Repair evidence checklist, supervisor check, follow-up schedule (1/3/6 months, heavy rain, before FHO, every 6 months), warranty flag, PINN life comparison, lab tests recommended to agencies | Claude Code |
| `09_UI_UX_SPEC.md` | Design tokens (light + dark, contrast-checked), components, IA and screens per role with ASCII wireframes, exact microcopy, empty/error/loading/offline states, animations + reduced motion, Pavi per role, charts per dashboard, map legend, WCAG 2.2 AA checklist, low-end/offline, `/why/` page, 60-s judge tour, gamification + certificate | Claude Code + Farrel |
| `10_AI_ML_PLAN.md` | Each AI component (why AI vs rules, model, data, metrics, failure handling, human decision point), datasets with links/licenses/sizes, location splits, dedup check, baselines (CRDDC 2022 F1), PINN framing (forward surrogate; no inverse claim), GenAI rules, ethics register, eval scripts → `measurements/*.json`, licenses | Farrel + Claude Code |
| `11_INTEL_EVIDENCE_PLAN.md` | Lifecycle map, hardware access options, OpenVINO 2026.4.x install, `env_report`, `benchmark_app` matrix, NNCF INT8/INT4, OpenVINO GenAI on NPU, PyTorch vs OpenVINO same device, screenshots, IDR steps, Metric-3 checklist → evidence files | Farrel + Salman |
| `12_JUDGE_QA.md` | 20 judge questions: 30-s answers, evidence to show, caveats; rubric gap table (Now / P0 / P0+P1 estimates); rapid-fire backups; status words configured/tested/piloting/operational | Whole team |
| `13_WORK_PLAN.md` | Build phases B0–B11 (priority, dependencies, effort, owner, acceptance), human tasks H1–H9, 14-day day-by-day schedule, emergency 5-day cut, risk register, project DoD | Whole team |
| `14_BACKGROUND_STORY.md` | Problem narrative (3 problems) with citations, feature map, "safe to put on a slide" list, "do not claim" list | Salman + `/why/` page |

### Data (`data/`) — inputs for Claude Code; never edit `TODO_VERIFY` values without a source
| File | Content |
|---|---|
| `roles.json` | Machine-readable roles, permissions, SoD rules (pairs with `03`) |
| `road_status_rules.json` | Road status levels, SK references, routing rules (pairs with `04`) |
| `authorities_jakarta.csv` | Jakarta authorities/offices (Dinas Bina Marga, Sudin per kota administrasi, Satpel per kecamatan) |
| `authorities_national_balai.csv` | BBPJN/BPJN and Satker PJN offices |
| `authorities_provincial_dinas.csv` | Provincial public-works offices |
| `toll_operators_jakarta.csv` | Toll segments and operators (BUJT) in Jakarta |
| `damage_classes.json` | Damage taxonomy (RDD classes ↔ Indonesian names), severity bands, repair mapping (pairs with `05`) |
| `ahsp_items.json` | AHSP items and coefficients (missing ones `TODO_VERIFY` with source) (pairs with `06`) |
| `ump_2026.csv`, `umk_2026.csv` | Provincial/regency minimum wages 2026 |
| `ikk_2025.csv` | BPS construction cost index (IKK) 2025 multipliers |
| `material_prices.csv` | Material prices (e.g., Pertamina asphalt by supply point) with source/date |
| `incidents.csv` | Sourced incident list (date, place, outcome, outlet, URL, verification note) — use for `/why/` and the deck |
| `*.csv` / `*.json` added later by other writers | Same rule: every row has a source and a status |

### Templates (`templates/`)
| File | Content |
|---|---|
| `audit_report_independent.html` | Independent Repair Audit Report on PAVEMENT-PINN letterhead, "Bukan naskah dinas", SHA-256 + QR |
| `*.html` (others, e.g. unbranded watermarked agency draft, certificate) | As produced by the `07` writer; no government kop/emblem ever |

### Scripts (`scripts/`)
| File | Content |
|---|---|
| `build_road_registry.py` + `build_road_registry.md` | Builds the road-status registry (OSM + official lists) for routing |
| `overpass_jakarta_roads.ql` | Overpass query for Jakarta road geometry |
| `*` (others) | Helper scripts referenced by topic files |

### Research (`research/`) — source notes (Indonesian/English), cited by every fact in the pack
`01_kerusakan_dan_korban.md` (damage & victims) · `02_kanal_pelaporan.md` (reporting channels) · `03_korupsi_jalan.md` (corruption & waste) · `04_kewenangan_dan_peran.md` (authority & roles) · `05_data_peta_dan_direktori.md` (map data & directory) · `06_biaya_dan_upah.md` (costs & wages) · `07_pengukuran_dan_ketahanan.md` (measurement & durability) · `08_audit_integritas_dokumen.md` (audit integrity & documents) · `09_dataset_intel_inklusi.md` (datasets, Intel, inclusion) · `RISET_LENGKAP.md` (combined).

---

## 4. Status legend (use these words exactly — in data files, UI chips, PDFs, deck, Q&A)

### 4.1 Value provenance (every number)
| Label | Meaning | Example |
|---|---|---|
| `MEASURED` | Produced by a script/instrument/person measuring it, with date and method; for AI/latency numbers, from `measurements/*.json` | "εt MAPE 0.673 % vs PyMastic (`pinn2.json`)"; "depth 45 mm (ruler photo)" |
| `OFFICIAL` | Taken from an official document (regulation, decree, BPS/BPK/ministry data) with citation | "Kepmen PUPR 1688/KPTS/M/2022"; "PPN 11 %" |
| `INPUT` | Typed by a person in the app, not checked by AI | "traffic 120 ESAL/day" |
| `ASSUMED` | Default value with a stated reason, changeable | "lane width 3.5 m"; "overhead/profit 10 %" |
| `AI_ESTIMATE` | Estimated by an AI model; a person will check | "size band: Medium" |
| `TODO_VERIFY` | Not confirmed yet; the source to check is named. Must not be presented as fact | "AHSP coefficient, see SE 30/SE/Dk/2025 Lampiran V" |
| `DEMO` | Sample data for judges; never mixed with real data | "DEMO — not a live capture" |
| `AI DRAFT` (text) | Text drafted by the local SLM; needs human approval | public status update draft |

v4 Indonesian labels map 1:1: `TERUKUR`→`MEASURED`, `DARI_INPUT`→`INPUT`, `ASUMSI`→`ASSUMED`, `AI_PERKIRAAN`→`AI_ESTIMATE`, `CONTOH`→`DEMO`. Script outputs with no data use `BELUM_DIUKUR` (= "not measured yet") plus a `howTo`.

### 4.2 Deployment status (features and Intel claims)
| Word | Meaning |
|---|---|
| **configured** | Code path exists, never run in that setting/device |
| **tested** | Ran on the named device/data; result file committed |
| **piloting** | Used by real users in a time-boxed pilot, with logs |
| **operational** | Used by an agency in daily work (**not yet** — never claim) |

### 4.3 Host label (benchmarks)
`HOST_INTEL` only when the CPU/GPU/NPU names in `env_<host>.json` are Intel; otherwise `HOST_NON_INTEL` (all current files, AMD dev laptop, as of 2026-11-01).

---

## 5. Current reality check (as of 2026-11-01, from the v4 repo)
- Pilot: 2 real reports, 1 account (`measurements/pilot.json`, 29 Oct 2026). SUS: 0 responses.
- CV accuracy on local/Indonesian photos: **not measured** (`cv_local.json` BELUM_DIUKUR). Current detector is third-party (author-reported mAP50 0.394, not re-validated).
- PINN-2 surrogate: measured vs PyMastic (εt MAPE 0.673 %, εv 0.488 %, 300 samples); inverse PINN fails (by design not claimed).
- SLM: 10 cases on CPU, 20 % accepted first try, 60 % template fallback; NPU not tested.
- All latency numbers: non-Intel AMD laptop. Intel re-run is the top P0 human task.
These facts are the honest starting line for `12_JUDGE_QA.md` and the Evidence page.
