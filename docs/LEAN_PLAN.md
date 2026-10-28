# PAVEMENT-PINN — Lean Real Plan (2026-10-28)

Single source of the product decisions taken on 2026-10-28. Interview in ~4 days,
development window 2 days, zero budget. Branch: `lean-real`. Supersedes the status
tables in README, docs/AI.md, PROGRESS.md and docs/audit/MASTER_TRACKER.md where they differ.

## Principles

1. Show only what was computed. No demo mode, demo accounts, seed reports, sample
   workspaces or offline gateway in the product.
2. One screen, one job, plain Indonesian. Technical numbers sit behind "Detail teknis".
3. Every feature answers an Intel AI Global Impact Festival rubric line, or it goes.

## Roles (3)

| Role (code id) | UI name | Loop |
|---|---|---|
| `PUBLIC_REPORTER` | Warga | Loop 1: photo -> AI -> "is this right?"; supports existing reports; confirms repairs |
| `FIELD_ENGINEER` | Petugas Lapangan | Loop 2: confirms/corrects AI, measures on site, PINN assessment, repair evidence |
| `OPERATIONS_MANAGER` | Koordinator | Loop 3: AI-ranked queue, override with reason, decisions, staff accounts, statistics |

Removed: `PUBLIC_VIEWER` (everything needs login, except `/track/<code>`), `POLICY_MAKER`.
Citizens self-register; staff accounts are created by a Koordinator; the first Koordinator
is created once with `npm run create-coordinator`.

## Workflow (target)

SUBMITTED -> AI screening -> (confident) VERIFIED | NEEDS_REVIEW -> inspection assigned ->
inspection + recommendation (one submit) -> decision -> repair -> repair evidence (AI
before/after check) -> Koordinator verifies -> RESOLVED -> citizen "fixed?" yes / 7 days ->
CLOSED; "not fixed" reopens.

## AI engines (all real)

| Engine | Where | Output in plain language |
|---|---|---|
| CV detector + crack segmenter (OpenVINO) | `inference/app/cv` | "Lubang · sedang"; quality gate asks for a new photo |
| Screening provider | server, uses the stored CV analysis bound to the report photo | confident -> queue, else human review |
| PINN surrogate + MLET + Monte Carlo | `inference/app` `/v1/assess` | surface vs structural; overload (ODOL) impact; wet season; repair options (rutin / berkala / rehabilitasi / rekonstruksi) |
| Priority score | server | CV severity x structural risk x citizen support x hazard, with reasons |
| Segment survey (stretch) | `/v1/cv/analyze-video` + GPS | per-100 m condition (SDI-style), "12,4 km rusak berat" |

Removed: RULE_BASED engine, Gemini narrative, WIM/ODOL/weather/traffic/policy screens,
classic portal, `/engine/*`, legacy `/computer-vision/*`, synthetic 3D pothole surface,
workspace version store, confetti, external video background.

Kept and reused: MapLibre globe + MapSheet + sheet drag, camera report flow + CV progress,
frameQc, DamagePanel overlay, Pavement3D layer block + truck models (for the ODOL card,
coloured by real MLET strain), PinnTab MLET heatmap, SegmentInsight progressive disclosure,
BeforeAfterSlider, RoadStory timeline, AuditTrailModal, pdfGenerator, motion tokens, i18n ID/EN.

## UI

Snapchat-style layout (not its logo, name or exact brand yellow): camera-first for citizens,
full-screen map with bottom sheets, bottom bar with 5 tabs per role, large rounded cards,
bold type, one sentence per card.

- Warga: Peta · Laporanku · Kamera · Notifikasi · Profil
- Petugas: Peta · Tugas · Kamera · Inspeksi · Profil
- Koordinator: Peta · Antrian · Tim · Statistik · Profil

## Hosting (free)

The team's Intel laptop runs Express + the Python inference service; a free ngrok static
domain (or Cloudflare quick tunnel) gives the public HTTPS link. Data in `.data/`, copied as
backup. GitHub Pages static deploy is retired.

## Intel evidence (free)

- NNCF INT8 for the PINN surrogate (exists) and the CV detector (to do).
- `scripts/bench` one command: CPU / GPU (Iris Xe) / NPU when present -> `measurements/*.json`.
- NPU: borrow any Intel Core Ultra laptop for 30 minutes to run the benchmark.
- Intel Tiber AI Cloud free account for the optimisation stage if available.

## Order

1. Real accounts (register/login, server account store, no demo) + CV->screening + honest system health.
2. New lean shell (3 roles x 5 tabs), purge legacy screens and engines.
3. PINN cards (4 questions) on inspection and road detail; hazard sign; authority routing.
4. Repair verification (3 layers); statistics (field accuracy, time to fix).
5. NNCF INT8 detector, benchmark, Evidence page. Stretch: segment survey.
6. Tunnel, real users, interview deck. Disclose all GenAI tools used in development.

## Status (2026-10-28, branch `lean-real`)

Done and tested:
- Real accounts (register, staff by Koordinator, scrypt), no demo data in the product server.
- Verified OpenVINO CV result drives screening; low confidence goes to human review.
- Lean shell, 3 roles x 5 tabs, Snapchat-style UI kit; legacy screens, RULE_BASED engine,
  What-If, Gemini and Pages deploy removed. Segment risk from observed evidence only.
- PINN decision card (surface/structural, ODOL factor, wet season, repair options).
- Explainable queue priority (Loop 3); field accuracy from engineer reviews (Loop 2) in Statistik.
- EXIF/XMP/PNG-text stripping before storage. Live /api/system-health.
- Python runtime: pytest 44/44; real-inference workspace tests run (none skipped).
- NNCF INT8 detector + benchmark -> /bukti. Measured on an AMD Ryzen 7 5800HS laptop:
  numbers are OpenVINO evidence, NOT Intel-hardware evidence.
- scripts/go-live.ps1 (free Cloudflare quick tunnel), README, CITATIONS, GENAI_DISCLOSURE.

Not done (next, in order):
1. Run `inference/scripts/benchmark.py` on an Intel machine (any Intel Core; Core Ultra for NPU)
   and commit the measurements file; that is the Intel-hardware evidence.
2. Citizen "Sudah benar diperbaiki? Ya/Belum" after RESOLVED (reopen on "Belum").
3. Hazard sign (UU 22/2009 Pasal 24 ayat 2) on the map; authority routing per corridor.
4. Accuracy on a labelled public set (e.g. RDD2022 subset) -> summary.json `accuracy`.
5. Segment survey (video + GPS, per-100 m condition) and OpenVINO GenAI summaries: stretch.
