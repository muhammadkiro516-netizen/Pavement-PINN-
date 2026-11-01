# 01 — Claude Code Kickoff Prompt

## Note for the human (not part of the prompt)
- **Setup:** copy this whole pack into the repo as `docs/v5/` (keep `data/`, `templates/`, `scripts/`, `research/` subfolders). Work on a new branch `v5` from `v4`. Make sure `npm test`, `npm run test:py` and `npm run lint` are green before starting.
- **Model / effort:** use the most capable Claude model you have (e.g. Opus 5.5). Effort **high** for B2 (event chain + state machine + SoD), B5 (cost engine), B7 (verify/PDF), B8 (evaluation scripts); **medium** is fine for B1, B3, B4, B6, B10, B11. Run **one phase per session**; start a fresh session for the next phase and let it read `PROGRESS.md` (the handoff). Paste the prompt below once at the start of the first session; later sessions only need: "Continue with the next phase in `docs/v5/01_CLAUDE_CODE_PROMPT.md`. Read `PROGRESS.md` first."
- **Your jobs in parallel** (Claude Code cannot do them): Intel hardware, photos + labels, interviews, usability tests, IDR email, registry and cost data checks, deck — see `13_WORK_PLAN.md` §2. Review every phase on your phone via the printed HTTPS URL before saying "continue".

---

## PROMPT (paste from here)

You are implementing **PAVEMENT-PINN v5** in this repository: a citizen road-damage reporting PWA plus field inspection, physics-informed repair check, fair-cost check and tamper-evident audit trail, for the Intel AI Global Impact Festival 2026 Stage 3 interview (5-min demo + 15-min Q&A). Judges must understand every screen instantly. Every number must be real or clearly labelled.

**Core pitch:** PAVEMENT-PINN connects a citizen's verified photo to the agency legally responsible for that road, keeps the case visible until it is repaired, and checks — with physics and a fair-cost estimate — whether the repair was the right size, the right price, and actually lasted. It feeds existing channels (SP4N-LAPOR!, JAKI); it is not another inbox.

**Base:** existing v4 code (React 19 + Vite PWA + Tailwind v4, Express TypeScript API with state machine/RBAC/audit, `.data/` JSON store, Python FastAPI + OpenVINO inference on :8100). **Build on it. Do not rewrite. Do not switch stack.**

### Read first (in this order; grep before reading big files)
1. `docs/v5/DECISIONS_v5.md` — fixed decisions. Never change them.
2. `docs/v5/02_SPEC_v5.md` — state machine, features with acceptance criteria, API, DB, demo rules, migration steps V5-0…V5-11.
3. `docs/v5/13_WORK_PLAN.md` — phase order B0…B11 (below mirrors it).
4. Per phase, the topic file: `03_ROLES_RBAC.md` (+ `data/roles.json`), `04_AUTHORITY_ROUTING.md` (+ `data/authorities_*.csv`, `data/toll_operators_jakarta.csv`, `data/road_status_rules.json`, `scripts/build_road_registry.*`), `05_CAPTURE_AND_MEASUREMENT.md` (+ `data/damage_classes.json`), `06_COST_ENGINE.md` (+ `data/ahsp_items.json`, `ump_2026.csv`, `umk_2026.csv`, `ikk_2025.csv`, `material_prices.csv`), `07_AUDIT_INTEGRITY.md` (+ `templates/*.html`), `08_REPAIR_VERIFICATION.md`, `09_UI_UX_SPEC.md`, `10_AI_ML_PLAN.md`, `11_INTEL_EVIDENCE_PLAN.md`.
5. Background only (copy, facts, Q&A): `14_BACKGROUND_STORY.md`, `12_JUDGE_QA.md`, `research/`.
If two files disagree: DECISIONS > 02 > topic file > 09 (09 wins only on look, words, motion). If none answers, **ask**.

### Hard rules (never break)
1. **No fake numbers.** No `Math.random`, constants or sample data shown as results, latency, accuracy, prices, costs or counts. Missing → "Not measured yet" / "–" with `TODO_VERIFY`. Performance and accuracy numbers come **only** from `measurements/*.json` written by scripts (common header in `10_AI_ML_PLAN.md` §9).
2. **Honesty labels on every number** in UI and PDFs: `MEASURED` / `OFFICIAL` / `INPUT` / `ASSUMED` / `AI_ESTIMATE` / `TODO_VERIFY` / `DEMO` (+ `AI DRAFT` for generated text), with source and date. Values marked `TODO_VERIFY` in data files stay `TODO_VERIFY` — never fill coefficients, prices, addresses, coordinates or legal articles yourself.
3. **Humans decide.** AI never changes a case status, approves, assigns or picks a repair. All transitions go through the state machine by a person with the right role, with a reason, logged as a hash-chained event.
4. **Separation of duties, enforced on the server:** recommender ≠ approver; repair crew ≠ supervisor ≠ verifier; anyone linked to a contractor gets no official role on that package; auditors read-only; allowed legal overlaps (e.g., KPA acting as PPK) permitted but logged; transfers between authorities must cite the road-status SK.
5. **No government kop, emblem or naskah dinas.** Only (a) "Independent Repair Audit Report" on PAVEMENT-PINN letterhead marked "Bukan naskah dinas", and (b) an unbranded, watermarked "Draft for agency".
6. **Neutral wording.** Never "korupsi", "corruption", "mark-up", "fraud", "nakal", "lalai" in UI or documents. Use "Needs clarification", "indikasi", "perlu klarifikasi". Flags attach to a case/segment/package, never to a named person.
7. **Capture:** production = live in-page camera only (getUserMedia, server one-time nonce, server time, GPS + accuracy, motion sample, pHash duplicate check, EXIF strip, face/plate blur, ≤ 500 KB). **No gallery/file input in the production build.** DEMO MODE may use sample photos; every such record and document is stamped "DEMO — not a live capture". Citizens are never asked for depth.
8. **Privacy:** personal data never in the immutable log (hashes only); raw photos deleted ≤ 7 days; public pages show no reporter data; citizen name is collected only when claiming a certificate.
9. **PINN honesty:** describe PINN-2 as a physics-informed forward surrogate of layered-elastic theory (PyMastic). "Validated vs KENPAVE" stays `TODO_VERIFY` until `measurements/mlet_reference_check.json` exists. Do **not** claim or expose inverse/back-calculation in production UI (our test fails; arXiv 2606.03210). Life range = "indicative", months only when traffic is an `INPUT`.
10. **GenAI:** local Qwen2.5 via OpenVINO GenAI writes text only; numbers are placeholders filled by code; deterministic checker; template fallback; label "Drafted by AI — needs human approval". The app must work with the SLM off.
11. **Intel honesty:** never label a result as Intel unless its JSON has `hostLabel: "HOST_INTEL"` and `FULL_DEVICE_NAME`. Current files are `HOST_NON_INTEL`.
12. **Tests:** never delete, skip or weaken existing tests. Every feature gets tests. `npm test`, `npm run test:py`, `npm run lint` (and Playwright golden path where touched) green at the end of every phase.
13. **Determinism:** same input → same output (Monte Carlo seeded from case/segment id + model version).
14. **Plain-English UI copy** from `09_UI_UX_SPEC.md` (exact strings). Generated documents in Indonesian. Keep the Indonesian toggle working.
15. **Token economy:** grep before reading; small edits; don't print large files; phase report ≤ 8 lines; `PROGRESS.md` ≤ 30 lines.
16. **Commits:** small, one feature each, message `v5(<phase>): <what>`, trailer line `Assisted-by: Claude Code`. Never commit credentials, personal data, large datasets or model weights (hashes + metadata only).

### Every phase = this loop
Plan (≤ 15 lines, list files to touch + tests) → code → tests → update `PROGRESS.md` (status, decisions, blockers, next step) → commit → **host** → print the HTTPS URL and a 3-step "what to try on your phone" list → stop and wait for "continue".

**Hosting (mandatory each phase):** start the app (`npm run dev` or `npm run build && npm start` + inference service) and expose it: `cloudflared tunnel --url http://localhost:3100` (quick tunnel; print the `https://*.trycloudflare.com` URL). If a fixed host exists (`scripts/deploy.sh`, Caddy on an Intel Xeon VM), redeploy there too. Camera and GPS need HTTPS — verify they work on Android Chrome and iOS Safari at least at B4, B10, B11.

### Phases and Definition of Done (mirror `13_WORK_PLAN.md`)
| Phase | Do | Done when |
|---|---|---|
| **B0 Kickoff & rails** | Read pack; `DEMO_MODE` flag + banner; `SourceChip` component; measurement-JSON header helper (TS + Python); seed `DEMO-0001` case (all DEMO-stamped) | Tests green; URL on phone; demo banner shows only with flag; helper used by one existing eval script |
| **B1 Design system & shell** | `09` §1–3, §7: light tokens (+ old variable aliases), Barlow fonts with offline fallback, components list, AppShell/BottomNav, banners, states, Pavi 9 role variants, motion tokens + reduced motion | `scripts/check-contrast.ts` passes in CI; existing e2e green; reduced-motion e2e passes |
| **B2 Event chain + state machine + roles/SoD** | `02` §3–4, V5-0…V5-3; `03`; chain part of `07`: v5 types + legacy aliases; append-only hash-chained events; v5 transitions; 9 roles; SoD; v4 data migration (dry-run) | Tamper test fails verification at the edited seq; one test per transition; SoD + route-access matrix tests from `data/roles.json`; migration dry-run prints counts |
| **B3 Authority routing + map** | `04` + data/scripts: registry (status, SK, date), snap ≤ 25 m, office lookup, LOW-confidence fallback with "please confirm", transfer with SK, map layers + legend (`09` §8), Jakarta first | ≥ 30 Jakarta routing test points pass (national, provincial, toll, LOW); tap road → owner + SK + confidence |
| **B4 Capture & measurement** | `05`: camera-only prod, nonce, server time, GPS accuracy gate, motion sample, pHash, EXIF/blur, DEMO stamping, long-stretch trace mode (min 3 photos), inspector ruler-depth + typed value + read-back flag (> 5 mm), marker-card area or size band | Prod bundle has no file input (test); nonce reuse/expiry tests; synthetic trace tests; citizen UI has no depth field |
| **B5 Cost fairness engine** | `06`: AHSP-structured unit prices, regional inputs, OH&P (default 10 %, ≤ 15 %), PPN 11 %, range output, per-input status, \|diff\| > 20 % → "needs clarification" | Worked examples in `06` reproduce exactly; every input has a status; `TODO_VERIFY` items surfaced, never guessed |
| **B6 Repair verification & follow-ups** | `08`: crew checklist with live capture, supervisor check, follow-ups 1/3/6 months + first heavy rain + before FHO + every 6 months, warranty flag, PINN expected-life vs observed | Fake-timer schedule tests; overdue follow-up visible; early failure in maintenance period raises flag; `recurrence.json` updates |
| **B7 Checkpoints, verify, documents** | `07` + V5-9: daily Merkle root, verify page, two PDFs from `templates/*.html` with SHA-256 + QR (P1: OpenTimestamps anchor/upgrade job) | Verify page matches PDF hash; PDF reproducible from snapshot; template test finds no government emblem/kop |
| **B8 AI/ML evaluation** | `10`: dedup RDD_Indonesia, location splits, extend `cv_eval.py` (F1@0.5 fixed threshold, mAP50, mAP50-95, per class/condition, CI, FP32 vs INT8), evaluate current detector on BPID + local, `pinn2_ablation.json`, SLM 50 cases, `quant_delta.json`, model/data cards. P1: train own detector, pothole seg, area field-study script | Each script writes JSON with the common header or `BELUM_DIUKUR` + `howTo`; `/bukti/` reads them |
| **B9 Intel evidence** | `11`: `bench/env_report.py`, `bench/ov_bench.sh`, `bench/torch_vs_ov.py`, `run_all.py --device`, SLM on NPU with fallbacks, `docs/evidence/INTEL_EVIDENCE_INDEX.md`. Needs a human-provided Intel machine — prepare scripts, then ask | Scripts run on any machine and label the host correctly; on Intel host: `env_<host>.json` + benchmark summary + `slm_NPU.json` (MEASURED or NOT_SUPPORTED with error) |
| **B10 Public pages & gamification** | `/why/` (facts only from `14` §5, footnotes), `/tour/` ≤ 60 s on `DEMO-0001`, `/bukti/` with configured/tested/piloting/operational table; P1: quests, badges, certificate with name entry at claim, verifiable via `/v/:docId` (`07` §7) | Tour ≤ 60 s on phone; every Why fact has a source; certificate PDF has QR, no government emblem, name stored only on certificate |
| **B11 Hardening & deploy** | Offline queue e2e, axe (0 serious/critical on listed screens), 320 px reflow, perf budget, fixed-host deploy, `docs/GENAI_DISCLOSURE.md` (from `Assisted-by` trailers), `docs/CORE_EXPLAINED.md`, `docs/TEST_REPORT.md` (bugs fixed + known failures) | Offline report arrives exactly once; reports saved in `docs/evidence/`; fixed URL works on Android Chrome + iOS Safari |

**If time/limits run short:** follow the emergency 5-day cut in `13_WORK_PLAN.md` §4. Before stopping at any point: build passes, URL is live, `PROGRESS.md` states exactly what is done and the next step.

### Stop and ask a human when
- A spec is silent or contradictory on behavior (not just styling).
- You would change the state machine, DB schema or API beyond `02`, delete/skip a test, or change the stack.
- You need a value that is `TODO_VERIFY` (coefficient, price, SK number, address, legal article) or any number without a measurement/source.
- You would add a dependency that is copyleft (AGPL/GPL) or > 200 KB gzip on citizen routes, or any paid service.
- You need credentials, accounts, a VM, a domain, Intel hardware, real photos, or real users.
- Something would show a real person's name, face, plate or a government emblem.
- A test is flaky in a way you can't fix in 30 minutes (record it in `PROGRESS.md`).

### Final checklist (before saying "done")
- [ ] All tests green (Node, pytest, Playwright golden path per role); lint clean.
- [ ] No unlabelled number anywhere (UI, PDF, Evidence page); no `Math.random` in result paths (grep).
- [ ] Production build: no gallery input; DEMO mode clearly marked everywhere it is used.
- [ ] 9 roles + SoD enforced server-side; transfer requires SK.
- [ ] Routing + legend for Jakarta; LOW confidence shown when unsure.
- [ ] Fair-cost range with per-input status; repair checklist; follow-ups; warranty flag.
- [ ] Event chain verifies; tamper test fails as expected; verify page matches PDFs; no government kop.
- [ ] `/why/`, `/tour/` (≤ 60 s), `/bukti/` live; `/bukti/` shows device names + OpenVINO version and greys non-Intel results.
- [ ] `GENAI_DISCLOSURE.md`, `CORE_EXPLAINED.md`, `TEST_REPORT.md`, `PROGRESS.md` current.
- [ ] Public HTTPS URL printed and working on a phone.
