# 02 — PAVEMENT-PINN v5 Master Functional Spec

> Audience: Claude Code (implementer) and the team. Status: v5 draft, 2026-11-01.
> Fixed product decisions: `_shared_decisions.md` (must be followed exactly). Companion files: `03_ROLES_RBAC.md` + `data/roles.json`, `05_CAPTURE_AND_MEASUREMENT.md` + `data/damage_classes.json`, `07_AUDIT_INTEGRITY.md`, `08_REPAIR_VERIFICATION.md`, `templates/*.html`.
> Rule for every writer and implementer: **never invent regulation content, coefficients, prices or SLAs.** Anything not confirmed in the research notes is marked `TODO_VERIFY(<source to check>)`. Internal targets are labelled "internal target, configurable, not law".

---

## 0. How to read this file

| Section | Content |
|---|---|
| 1 | Goals, non-goals, one-sentence pitch |
| 2 | Glossary (EN + ID) |
| 3 | Case lifecycle state machine (states, transitions, roles, evidence, SLA, escalation, delay reasons) |
| 4 | Mapping old v4 states/actions/roles to v5 |
| 5 | Features per role with numbered Given/When/Then acceptance criteria |
| 6 | API endpoints |
| 7 | Database schema |
| 8 | Non-functional requirements (privacy, performance, offline, accessibility) |
| 9 | DEMO MODE rules |
| 10 | Migration plan from the current repo |
| 11 | Open questions / TODO_VERIFY register |

Conventions:
- IDs: `C-` Citizen, `FI-` Field Inspector, `CO-` Coordinator, `AP-` Approver, `RC-` Repair Crew, `SV-` Supervisor, `AU-` Auditor, `AH-` Agency Head, `AD-` Admin, `SYS-` system, `PUB-` public pages.
- Every number shown in UI carries a status label: `MEASURED` | `OFFICIAL` | `INPUT` | `ASSUMED` | `AI_ESTIMATE` | `TODO_VERIFY` | `DEMO`. (v4 Indonesian labels `TERUKUR`/`DARI_INPUT`/`ASUMSI`/`AI_PERKIRAAN`/`CONTOH` map 1:1 to `MEASURED`/`INPUT`/`ASSUMED`/`AI_ESTIMATE`/`DEMO`; `OFFICIAL` and `TODO_VERIFY` are new.)
- UI copy is plain English, short sentences (judges). Generated documents are Indonesian.

---

## 1. Goals and non-goals

### 1.1 Pitch
PAVEMENT-PINN connects a citizen's verified photo to the agency legally responsible for that road, keeps the case visible until it is repaired, and checks — with physics and a fair-cost estimate — whether the repair was the right size, the right price, and actually lasted.

Tagline: **Report · Escort · Audit** (ID: *Lapor · Kawal · Audit*).

Positioning: a **layer that feeds existing channels** (SP4N-LAPOR!, JAKI/CRM), not another inbox. Evidence for the gap (research note 02 §7): no Indonesian channel routes by road status; "Selesai" is self-declared by the agency; completion photos were AI-faked in JAKI (Metro TV, 15 Apr 2026); no deduplication; no durability check.

### 1.2 Goals (v5)
| # | Goal | Measured by |
|---|---|---|
| G1 | Every report reaches the legally responsible authority, with the legal basis shown | % cases routed with `confidence=HIGH` from SK registry; % transfers; median time to `ACCEPTED` |
| G2 | No case sinks silently | escalation ladder H+2/7/14/30; public delay reasons; % cases > 14 days |
| G3 | Evidence cannot be faked cheaply | live capture + nonce + pHash; % evidence rejected by checks; DEMO isolation |
| G4 | Repair size and cost are checkable | inspector measurements with uncertainty; fair-cost RANGE (low/mid/high, `06_COST_ENGINE.md`) with labelled inputs; % packages with |diff| > 20% flagged "needs clarification" |
| G5 | Durability is tracked, not assumed | follow-ups 1/3/6 months + heavy rain + pre-FHO; actual life vs PINN P10–P90; warranty flags inside maintenance period |
| G6 | The record cannot be silently changed | hash chain + daily Merkle root + OpenTimestamps; public verify page; documents carry SHA-256 + QR |
| G7 | Legal safety | no government kop/emblem; neutral wording; no personal data in immutable log; DEMO records stamped |

### 1.3 Non-goals (v5)
- Not an official government system; never issues *naskah dinas*; never generates a government kop or lambang (Permendagri 1/2023 Pasal 22–25, 45; UU ITE Pasal 35/51 risk — see `07_AUDIT_INTEGRITY.md` §6).
- Does not decide procurement, payment, "kerugian negara", "kelebihan pembayaran" or "kegagalan bangunan" — those are conclusions reserved to BPK/APIP/PPK/experts/courts (note 08 §3, §2).
- Does not claim to measure compaction density, asphalt content or layer thickness under the surface (needs core/lab; note 07 §6).
- Does not ask citizens for depth or precise cm.
- No PINN back-calculation claims (inverse fails; arXiv 2606.03210 per shared decisions).
- No gallery upload in production.
- Not replacing SP4N-LAPOR!/JAKI: exports/referrals to them; no automatic submission on behalf of a citizen.
- Out of scope (roadmap only): SfM/3D, bridge detection, OCR of project boards, native Android app with Play Integrity (documented as v6 path in `05_CAPTURE_AND_MEASUREMENT.md` §9), DPRD/Ombudsman integrations.

---

## 2. Glossary (EN + ID)

| English (UI/code) | Indonesian | Meaning in PAVEMENT-PINN |
|---|---|---|
| Case | Kasus | One physical defect site. One case can hold many citizen reports (after merge). |
| Report | Laporan | One citizen submission (photos + location). |
| Segment | Ruas / segmen jalan | A road segment geometry with a legal status and authority. |
| Road status | Status jalan | nasional / provinsi / kabupaten / kota / desa / tol / khusus (UU 2/2022 Pasal 9; jalan khusus Pasal 57A–57D). |
| Status decree | SK penetapan status ruas | Kepmen PUPR 1688/KPTS/M/2022 (national), Keputusan Gubernur (provincial), Keputusan Bupati (kabupaten, desa), Keputusan Walikota (kota) — PP 34/2006 Pasal 62. |
| Authority | Penyelenggara jalan / instansi berwenang | The body responsible for the segment's status. |
| Office | Unit kerja | BBPJN/BPJN + Satker (national), Dinas/UPTD (provincial), Dinas PU/Bina Marga (kab/kota), Sudin + Satpel (DKI), BUJT (toll), Pemerintah Desa. |
| Routing confidence | Keyakinan penentuan kewenangan | HIGH (SK-matched), MEDIUM (official list/heuristic), LOW (admin-boundary default). |
| Transfer | Pengalihan / disposisi antar-instansi | Moving a case to another authority; requires SK citation. |
| Referral | Rujukan ke kanal resmi | Forwarding to SP4N-LAPOR!/JAKI when the authority is not onboarded. |
| Triage | Triase | Coordinator's first review: valid? duplicate? whose road? |
| Merge | Gabung duplikat | Linking duplicate reports into one case. |
| Inspection | Inspeksi / pemeriksaan lapangan | Field Inspector visit with measurements. |
| Marker card | Kartu penanda skala (ArUco/AprilTag) | Printed card of known size for metric scale. |
| Straightedge | Mistar perata | ≥1 m bar laid across the defect; ruler measures depth at deepest point. |
| Size band | Kelas ukuran | Citizen-level size: `<0.1 m²`, `0.1–0.5 m²`, `>0.5 m²`. |
| Repair plan | Usulan penanganan | Repair type + quantities + fair-cost range + PINN life range. |
| Approver | Pejabat penyetuju (PPK / pejabat berwenang) | Approves plan and accepts verified work. |
| Work order | Perintah kerja internal | Internal record; **not** an SPK/SPMK document. |
| Package / contract | Paket pekerjaan / kontrak | Procurement package (kode RUP/tender, penyedia entity, value, PHO, maintenance period, FHO). |
| Swakelola | Swakelola | Self-managed works (Tim Persiapan/Pelaksana/Pengawas, Perpres 16/2018 jo. 12/2021 Pasal 16(1)). |
| Provider | Penyedia | Contractor entity (never a named person in public output). |
| PHO | Serah terima pertama (Provisional Hand Over) | Start of maintenance period (Perpres 16/2018 Pasal 57). |
| Maintenance period | Masa pemeliharaan | Provider must repair defects at own cost; ≥ 6 months permanent / 3 months semi-permanent per Modul 04 DPU Kutai Barat — article `TODO_VERIFY(Perpres 16/2018 jo. 46/2025 Pasal 50; Perlem LKPP 12/2021)`. |
| FHO | Serah terima akhir (Final Hand Over) | End of maintenance period. |
| Maintenance guarantee | Jaminan pemeliharaan / retensi | 5% of contract value or 5% retention (Modul 04; `TODO_VERIFY` binding article). |
| Fair-cost range | Rentang biaya wajar | AHSP-structured estimate low/mid/high with labelled inputs (`06_COST_ENGINE.md`). |
| Needs clarification | Perlu klarifikasi | Neutral flag when reported spend differs from fair cost by > 20% (configurable). |
| Flag | Catatan temuan / indikasi | Neutral observation attached to case/segment/package, never to a person. |
| Follow-up | Pemantauan lanjutan | Scheduled check after repair (1/3/6 months, heavy rain, pre-FHO, then every 6 months). |
| Warranty flag | Tanda masa pemeliharaan | Early failure inside maintenance period → provider's obligation, neutral wording. |
| Event | Peristiwa | Immutable, hash-chained log entry. |
| Checkpoint | Titik periksa harian | Daily Merkle root over events, signed, anchored with OpenTimestamps. |
| Independent Repair Audit Report | Laporan Audit Perbaikan Independen | PAVEMENT-PINN letterhead, "Bukan naskah dinas". |
| Draft for agency | Draf untuk instansi | Unbranded, watermarked; agency adds kop, number, BSrE TTE. |
| TTE | Tanda Tangan Elektronik | Certified e-signature (BSrE for agencies; licensed PSrE for the operator). |
| APIP | Aparat Pengawasan Intern Pemerintah | Inspektorat Jenderal / Inspektorat daerah (Perpres 46/2025 Pasal 1 angka 22). |
| SDI | Surface Distress Index | Bina Marga network index per 100 m (Manual 001-01/BM/2011). |
| DEMO | DEMO — bukan tangkapan langsung | Records created in DEMO MODE; isolated (§9). |

---

## 3. Case lifecycle state machine (v5)

### 3.1 Design principles
1. **One legal path.** All changes go through `applyCommand` (keep `src/domain/workflow/stateMachine.ts` pattern: pure, versioned, returns next case + event). No direct DB updates of `cases.state`.
2. **AI never changes state** except the SYSTEM screening step (SUBMITTED → SCREENING → TRIAGE). AI never moves a case to ACCEPTED in v5 by default (`auto_accept_enabled=false`; see SYS-3).
3. **Every human decision carries a reason** (min 10 chars) and becomes a hash-chained event.
4. **Separation of duties** is checked inside `applyCommand` against the case's actor history (`03_ROLES_RBAC.md` §5). Violations return `FORBIDDEN` with rule ID (e.g. `SOD-1`).
5. **Overlays, not states:** `pending` (public delay reason), `hazard` (temporary signage), `transfer_pending_confirmation`, `under_technical_review` (audit flag open), `demo`.
6. **Temporary vs permanent repair are different states** (`REPAIRED_TEMPORARY` stays open) so re-failure of temporary patches is visible (note 04 §7).

### 3.2 States

| # | State | ID label (public) | Open? | Meaning |
|---|---|---|---|---|
| 1 | `SUBMITTED` | Laporan diterima | yes | Server accepted capture (nonce valid, checks run). |
| 2 | `SCREENING` | Disaring otomatis | yes | AI detection + duplicate search + routing running. |
| 3 | `TRIAGE` | Menunggu pemeriksaan petugas | yes | In coordinator queue of the routed authority. |
| 4 | `ACCEPTED` | Diterima instansi | yes | Coordinator confirmed: valid, not duplicate, our road. **Acknowledgement time is immutable** (UU 22/2009 Pasal 24 evidentiary value; note 04 §1). |
| 5 | `INSPECTION_ASSIGNED` | Inspeksi dijadwalkan | yes | Inspector + due date assigned. |
| 6 | `INSPECTED` | Inspeksi selesai | yes | Inspector submitted measurements (and optional draft plan). |
| 7 | `INSPECTION_VERIFIED` | Hasil inspeksi diperiksa | yes | Coordinator checked inspection completeness. |
| 8 | `PLAN_PROPOSED` | Usulan penanganan disusun | yes | Repair plan + fair-cost range + PINN range proposed. |
| 9 | `PLAN_APPROVED` | Penanganan disetujui | yes | Approver approved (recommender ≠ approver). |
| 10 | `WORK_ORDERED` | Pekerjaan dijadwalkan | yes | Internal work order with crew, supervisor, package link. |
| 11 | `IN_PROGRESS` | Sedang diperbaiki | yes | Crew started (before + cut photos submitted). |
| 12 | `WORK_SUBMITTED` | Menunggu pemeriksaan hasil | yes | Crew uploaded full evidence checklist. |
| 13 | `WORK_VERIFIED` | Hasil diperiksa pengawas | yes | Supervisor checked evidence (supervisor ≠ crew). |
| 14 | `REPAIRED_TEMPORARY` | Ditambal sementara | **yes** | Temporary patch accepted; permanent repair still owed. |
| 15 | `MONITORING` | Diperbaiki — dipantau | no (repair done) | Permanent repair accepted; follow-up schedule running. |
| 16 | `REOPENED` | Rusak lagi | yes | Follow-up or new report found failure; linked to previous repair. |
| 17 | `REFERRED_EXTERNAL` | Diteruskan ke kanal resmi | monitored | Authority not onboarded; referral exported (SP4N-LAPOR!/JAKI/other) with ticket ref. |
| 18 | `MERGED` | Digabung ke laporan lain | no | Duplicate; points to `merged_into_case_id`. Terminal. |
| 19 | `CLOSED` | Selesai | no | Terminal with `closure_reason`. |

`closure_reason` enum: `INVALID` (not road damage / abuse), `NO_ACTION_NEEDED` (inspected, below action threshold), `OUT_OF_SCOPE` (jalan khusus / private; citizen notified), `MONITORING_COMPLETE`, `SUPERSEDED_BY_WORKS` (segment rehabilitated/reconstructed under a package that covers the site), `LEGACY_RESOLVED` (migration only).

### 3.3 Transitions

`roles` = who may trigger. `Evidence` = required payload; server rejects with `VALIDATION` if missing. All human actions require `reason` unless marked "—".

| Action | From | To | Roles | Required evidence / payload | Event type |
|---|---|---|---|---|---|
| `SUBMIT` | – | `SUBMITTED` | CITIZEN, FIELD_INSPECTOR, COORDINATOR | valid capture nonce (or DEMO sample), ≥1 evidence (≥3 in large-damage mode), location + accuracy, capture checks result | `case.submitted` |
| `BEGIN_SCREENING` | SUBMITTED | SCREENING | SYSTEM | — | `case.screening_started` |
| `SCREENING_DONE` | SCREENING | TRIAGE | SYSTEM | detection result (model id+version or `MODEL_UNAVAILABLE`), duplicate candidates, routing result (authority, segment, confidence, basis) | `case.screened` |
| `AUTO_MERGE_SUGGEST` | SCREENING | TRIAGE | SYSTEM | duplicate candidate list (never auto-merges; suggestion only) | `case.duplicate_suggested` |
| `ACCEPT` | TRIAGE | ACCEPTED | COORDINATOR | reason; confirmed segment + authority; damage class confirmed or corrected | `case.accepted` |
| `MERGE` | TRIAGE, ACCEPTED | MERGED | COORDINATOR | `into_case_id` (open case within configurable radius, default 25 m, same segment), reason | `case.merged` |
| `TRANSFER_AUTHORITY` | TRIAGE, ACCEPTED | SAME (TRIAGE in target) | COORDINATOR | target authority id; **SK citation** (`decree_id` from registry or free-text SK number + date + page) ; reason; if crossing government level → `transfer_pending_confirmation` until second COORDINATOR or ADMIN of target confirms (SOD-7) | `case.transfer_requested` / `case.transfer_confirmed` |
| `REFER_EXTERNAL` | TRIAGE, ACCEPTED | REFERRED_EXTERNAL | COORDINATOR, SYSTEM (only if authority has `onboarded=false` and H+2 passed) | channel (`SP4N_LAPOR`,`JAKI`,`OTHER`), export bundle hash; external ticket id optional (added later) | `case.referred` |
| `CLOSE_INVALID` | TRIAGE, ACCEPTED | CLOSED(INVALID/OUT_OF_SCOPE) | COORDINATOR | reason code + text; citizen-visible note | `case.closed` |
| `ASSIGN_INSPECTION` | ACCEPTED, REOPENED | INSPECTION_ASSIGNED | COORDINATOR | inspector account id (must hold FIELD_INSPECTOR in the authority), due date, instructions | `inspection.assigned` |
| `SUBMIT_INSPECTION` | INSPECTION_ASSIGNED | INSPECTED | FIELD_INSPECTOR (assigned) | live-capture evidence: overview + marker-card photo + straightedge/ruler depth photo (for potholes/rutting/depressions) + typed depth mm; measurements with uncertainty; verdict (`CONFIRMED`,`NOT_FOUND`,`DIFFERENT_CLASS`); AI cross-check result attached by server | `inspection.submitted` |
| `REQUEST_REINSPECTION` | INSPECTED | INSPECTION_ASSIGNED | COORDINATOR | reason, (optional) different inspector | `inspection.reinspection_requested` |
| `VERIFY_INSPECTION` | INSPECTED | INSPECTION_VERIFIED | COORDINATOR | reason; all ruler-mismatch flags acknowledged | `inspection.verified` |
| `CLOSE_NO_ACTION` | INSPECTION_VERIFIED | CLOSED(NO_ACTION_NEEDED) | COORDINATOR | reason | `case.closed` |
| `PROPOSE_PLAN` | INSPECTION_VERIFIED | PLAN_PROPOSED | FIELD_INSPECTOR | repair type, quantities (from measurements), fair-cost run id, PINN run id (or `PINN_UNAVAILABLE`), urgency, rationale; GenAI text optional and labelled | `plan.proposed` |
| `RETURN_PLAN` | PLAN_PROPOSED | INSPECTION_VERIFIED | APPROVER, COORDINATOR | reason | `plan.returned` |
| `APPROVE_PLAN` | PLAN_PROPOSED | PLAN_APPROVED | APPROVER | reason; budget source (`APBN`,`APBD`,`DANA_DESA`,`BUJT`,`OTHER`); approver ≠ proposer (SOD-2); approver not linked to the provider (SOD-3) | `plan.approved` |
| `ISSUE_WORK_ORDER` | PLAN_APPROVED | WORK_ORDERED | COORDINATOR | type `SWAKELOLA`/`CONTRACT`; crew account or provider entity; supervisor account; package id (CONTRACT) ; target date; repair category `TEMPORARY`/`PERMANENT` | `work_order.issued` |
| `START_WORK` | WORK_ORDERED | IN_PROGRESS | REPAIR_CREW (assigned) | stage evidence `BEFORE` + `CUT_EDGES` (live capture) | `work.started` |
| `SUBMIT_WORK_EVIDENCE` | IN_PROGRESS | WORK_SUBMITTED | REPAIR_CREW (assigned) | full checklist (`08_REPAIR_VERIFICATION.md` §2): clean/dry, tack coat, mix temperature photo, delivery ticket, loose thickness with ruler, compaction, after photo with straightedge; declared quantities | `work.submitted` |
| `REJECT_WORK` | WORK_SUBMITTED | IN_PROGRESS | SUPERVISOR (assigned) | reason; failed checklist items | `work.rejected` |
| `VERIFY_WORK` | WORK_SUBMITTED | WORK_VERIFIED | SUPERVISOR (assigned) | supervisor's own live-capture after-photo on site + checklist decisions; supervisor ≠ crew (SOD-1) | `work.verified` |
| `ACCEPT_WORK` | WORK_VERIFIED | MONITORING (PERMANENT) or REPAIRED_TEMPORARY (TEMPORARY) | APPROVER (CONTRACT); APPROVER or COORDINATOR (SWAKELOLA, per region config `swakelola_accept_role`) | reason; PHO date (CONTRACT, from BA PHO — INPUT); maintenance months (INPUT, default from package); acceptor ≠ crew ≠ supervisor | `work.accepted` (creates follow-up schedule) |
| `PROMOTE_TO_PERMANENT` | REPAIRED_TEMPORARY | PLAN_PROPOSED | FIELD_INSPECTOR, COORDINATOR | new plan for permanent repair | `plan.proposed` |
| `RECORD_FOLLOW_UP` | MONITORING, REPAIRED_TEMPORARY | SAME | FIELD_INSPECTOR, CITIZEN (confirmation), SUPERVISOR | follow-up result per `08_REPAIR_VERIFICATION.md` §4 | `follow_up.recorded` |
| `REOPEN` | MONITORING, REPAIRED_TEMPORARY, CLOSED(MONITORING_COMPLETE) | REOPENED | SYSTEM (on inspector-confirmed failure or ≥2 independent citizen "damaged again" + 1 photo), COORDINATOR | link to failed repair record; warranty flag computed | `case.reopened` |
| `CLOSE_MONITORING` | MONITORING | CLOSED(MONITORING_COMPLETE) | COORDINATOR, SYSTEM | pre-FHO follow-up done and passed, and ≥ 1 follow-up after FHO (or 6 months if no package) | `case.closed` |
| `SUPERSEDE` | any open | CLOSED(SUPERSEDED_BY_WORKS) | COORDINATOR | package id covering the site | `case.closed` |
| `SET_PENDING` | ACCEPTED … WORK_ORDERED, REPAIRED_TEMPORARY | SAME (overlay) | COORDINATOR, AGENCY_HEAD | delay code, `until` date, public note | `case.pending_set` |
| `MARK_HAZARD` | ACCEPTED … IN_PROGRESS, REOPENED | SAME (overlay) | FIELD_INSPECTOR, COORDINATOR, REPAIR_CREW | live-capture photo of signage | `case.hazard_marked` |
| `ADD_RESPONSE` | any | SAME | COORDINATOR, AGENCY_HEAD, APPROVER, provider rep via REPAIR_CREW | right-of-reply text, attachments hash | `response.added` |
| `CORRECT` | any | SAME | role that created the corrected event, or COORDINATOR/ADMIN | `corrects_event_hash`, corrected fields, reason (never edits; see 07 §8) | `correction.recorded` |
| `SEED_IMPORT` | – | SAME | none (script only, DEMO chain) | demo seed | `demo.seeded` |

Server rules:
- `expected_version` must match (`VERSION_CONFLICT` otherwise) — keep existing optimistic concurrency.
- An action not in the table for the current state → `INVALID_TRANSITION`.
- Assignment checks: `SUBMIT_INSPECTION`, `PROPOSE_PLAN` only by assigned inspector (or a reassigned one); `START_WORK`/`SUBMIT_WORK_EVIDENCE` only by assigned crew; `VERIFY_WORK`/`REJECT_WORK` only by assigned supervisor.
- Scope check: actor's `role_assignment.authority_id` must equal (or be ancestor of) `case.authority_id`, except AUDITOR (read) and ADMIN (no case actions).

### 3.4 SLA timers (internal targets, configurable, not law)

Defaults live in `config/sla/<region>.json`; each value carries `basis` text. Context references (not binding on the app): SP4N-LAPOR! — verify 3 working days, follow-up 14 working days without field check, 60 working days with field check (KemenPANRB Monev SP4N-LAPOR 2023); JAKI — 6-day response flag (INP Polri, 29 May 2025); UU 22/2009 Pasal 24(1)–(2): repair "segera dan patut", signage if repair not yet possible.

| Stage clock | Starts at | Default target | On breach |
|---|---|---|---|
| Screening | SUBMITTED | 2 min (system) | SYSTEM alert; case still enters TRIAGE with `MODEL_UNAVAILABLE` |
| Triage | TRIAGE entered | 2 days | reminder to COORDINATOR; counts toward ladder |
| Inspection assignment | ACCEPTED | 2 days | reminder COORDINATOR |
| Inspection | INSPECTION_ASSIGNED | due date set by COORDINATOR; default 3 days for severity H or `hazard=true`, 7 days otherwise | reminder inspector + COORDINATOR |
| Inspection verification | INSPECTED | 2 days | reminder COORDINATOR |
| Plan approval | PLAN_PROPOSED | 5 days | reminder APPROVER; H+7 ladder to AGENCY_HEAD |
| Work order | PLAN_APPROVED | 3 days | reminder COORDINATOR |
| Work | WORK_ORDERED | target date in work order | reminder crew + COORDINATOR |
| Work verification | WORK_SUBMITTED | 3 days | reminder SUPERVISOR |
| Acceptance | WORK_VERIFIED | 3 days | reminder acceptor |
| Temporary → permanent | REPAIRED_TEMPORARY | 90 days or pending `until` | ladder restarts as "permanent repair owed" |
| Hazard signage prompt | severity H and no `IN_PROGRESS` | 1 day | prompt `MARK_HAZARD` (UU 22/2009 Pasal 24(2) context) |

Working days vs calendar days: v5 uses **calendar days** for the public ladder (simple for citizens) and shows working-day equivalents only on the SP4N-LAPOR! referral page. Holiday calendar `TODO_VERIFY(SKB libur nasional & cuti bersama 2026/2027)` if working days are added later.

### 3.5 Escalation ladder (public, keep v4 logic in `escalation.ts`)

Measured from `case.created_at` (citizen perspective); paused while a valid `pending.until` is in the future; after `until` the ladder restarts from `until` (existing behaviour, keep).

| Day | Level | Who is notified | Public effect |
|---|---|---|---|
| H+2 | `COORDINATOR` | COORDINATOR of routed authority | none |
| H+7 | `AGENCY_HEAD` | AGENCY_HEAD (dashboard + notification) | none |
| H+14 | `PUBLIC` | — | Public label "Not handled for more than 14 days" / "Belum ditangani > 14 hari"; share prompt for citizen |
| H+30 | `COMPLAINT` | — | Citizen may download complaint draft (text + PDF) for SP4N-LAPOR! or Ombudsman (UU 25/2009; Ombudsman as escalation after no agency response — note 04 §4). **Never sent automatically.** |

Rules:
- Ladder applies to open states only (see §3.2 "Open?"). `REPAIRED_TEMPORARY` uses its own clock (§3.4).
- Merged reports inherit the **oldest** `created_at` in the case (prevents resetting the clock by merging).
- Transfer does **not** reset the ladder; the event log shows time spent per authority (report-card fairness: time is attributed to the authority holding the case).

### 3.6 Public delay reasons (`SET_PENDING`)

| Code | Public label (EN) | Public label (ID) | Extra required | Max `until` |
|---|---|---|---|---|
| `AWAITING_BUDGET` | Waiting for budget | Menunggu anggaran | budget year expected | 180 days |
| `AWAITING_SCHEDULE` | Scheduled for later | Menunggu jadwal pekerjaan | planned date | 60 days |
| `AWAITING_CONTRACT` | Waiting for a contract | Menunggu proses pengadaan | package/RUP code if known | 120 days |
| `RAINY_SEASON` | Permanent repair after the rainy season | Perbaikan permanen setelah musim hujan | temporary patch or hazard sign required | 150 days |
| `PROVIDER_OBLIGATION` | The contractor must repair (maintenance period) | Masih dalam masa pemeliharaan penyedia | package id with PHO date | 30 days |
| `TECHNICAL_REVIEW` | Needs technical review | Perlu kajian teknis | — | 60 days |
| `OTHER_AUTHORITY` | Another agency is responsible | Kewenangan instansi lain | SK citation (as transfer) | 14 days |
| `OTHER` | Other reason | Alasan lain | free text ≥ 20 chars | 30 days |

Anti-abuse: a case may be set pending at most **3** consecutive times by COORDINATOR; the 4th requires AGENCY_HEAD (event shows who). Each extension is a new event; history is public (code + dates, no names). Max days are internal design defaults (configurable). (v4 codes map: `MENUNGGU_ANGGARAN`→`AWAITING_BUDGET`, `MENUNGGU_JADWAL`→`AWAITING_SCHEDULE`, `CUACA_MUSIM_HUJAN`→`RAINY_SEASON`, `KEWENANGAN_LAIN`→`OTHER_AUTHORITY`, `LAINNYA`→`OTHER`.)

---

## 4. Mapping old (v4 repo) → new (v5)

Source of old names: `src/domain/workflow/model.ts` (`WORKFLOW_STATES`, `WORKFLOW_ACTIONS`), `src/domain/workflow/stateMachine.ts` (`TRANSITIONS`), `src/types/rbac.ts` (`UserRole`), `server/repositories/accountStore.ts`, `supabase/migrations/20261014000000_workflow_core.sql`.

### 4.1 States
| v4 state | v5 state | Note |
|---|---|---|
| `SUBMITTED` | `SUBMITTED` | same |
| `AI_SCREENING` | `SCREENING` | rename |
| `NEEDS_REVIEW` | `TRIAGE` | rename |
| `VERIFIED` | `ACCEPTED` (if a human accepted) / `TRIAGE` (if SYSTEM `SCREENING_PASSED` was the last action) | v5 drops AI auto-verify; migrate system-verified cases back to TRIAGE with a `migration.note` event |
| `FIELD_INSPECTION_REQUESTED` | `INSPECTION_ASSIGNED` | rename |
| `INSPECTED` | `INSPECTED` | same |
| `INSPECTION_VERIFIED` | `INSPECTION_VERIFIED` | same |
| `ACTION_RECOMMENDED` | `PLAN_PROPOSED` | rename |
| `ACTION_APPROVED` | `PLAN_APPROVED` | rename; v4 approver was OPERATIONS_MANAGER — keep the historical event, new approvals require APPROVER |
| `IN_PROGRESS` | `IN_PROGRESS`, or `WORK_SUBMITTED` if last action was `COMPLETE_WORK_ORDER` | v4 had no work-order state; create a synthetic `work_order` row |
| `RESOLVED` | `MONITORING` (repair category PERMANEN) / `REPAIRED_TEMPORARY` (SEMENTARA) | follow-up schedule generated from resolve time |
| `CLOSED` | `CLOSED` with `closure_reason` from last action: `CLOSE_INVALID`→`INVALID`, `CLOSE_NO_ACTION`→`NO_ACTION_NEEDED`, `CLOSE_RESOLVED`→`LEGACY_RESOLVED` | |
| – | `WORK_ORDERED`, `WORK_VERIFIED`, `REOPENED`, `REFERRED_EXTERNAL`, `MERGED` | new |

### 4.2 Actions
| v4 action | v5 action |
|---|---|
| `SUBMIT` | `SUBMIT` |
| `BEGIN_SCREENING` | `BEGIN_SCREENING` |
| `SCREENING_PASSED`, `SCREENING_NEEDS_REVIEW` | `SCREENING_DONE` (both → TRIAGE) |
| `REVIEW_ACCEPT` | `ACCEPT` |
| `CLOSE_INVALID` | `CLOSE_INVALID` |
| `REQUEST_INSPECTION` | `ASSIGN_INSPECTION` |
| `SUBMIT_INSPECTION` | `SUBMIT_INSPECTION` (payload extended) |
| `VERIFY_INSPECTION` / `REQUEST_REINSPECTION` | same |
| `RECOMMEND_ACTION` | `PROPOSE_PLAN` |
| `CLOSE_NO_ACTION` | same |
| `APPROVE_ACTION` / `REJECT_ACTION` | `APPROVE_PLAN` / `RETURN_PLAN` |
| `START_WORK` (coordinator) | `ISSUE_WORK_ORDER` (coordinator) + `START_WORK` (crew) |
| `COMPLETE_WORK_ORDER` (field engineer) | `SUBMIT_WORK_EVIDENCE` (crew) |
| `REQUEST_REWORK` | `REJECT_WORK` (supervisor) |
| `RESOLVE` | `VERIFY_WORK` (supervisor) + `ACCEPT_WORK` (approver/coordinator) |
| `CLOSE_RESOLVED` | `CLOSE_MONITORING` |
| `TRANSFER_AUTHORITY` | same + SK citation + cross-level confirmation |
| `SET_PENDING` / `MARK_HAZARD` / `SEED_IMPORT` | same |
| – | `MERGE`, `REFER_EXTERNAL`, `PROMOTE_TO_PERMANENT`, `RECORD_FOLLOW_UP`, `REOPEN`, `SUPERSEDE`, `ADD_RESPONSE`, `CORRECT` |

### 4.3 Roles
| v4 `UserRole` | v4 UI label | v5 role |
|---|---|---|
| `PUBLIC_REPORTER` | Warga | `CITIZEN` |
| `PUBLIC_VIEWER` | Publik | no role (anonymous public read) |
| `FIELD_ENGINEER` | Petugas Lapangan | `FIELD_INSPECTOR` |
| `OPERATIONS_MANAGER` | Koordinator | `COORDINATOR` |
| `POLICY_MAKER` | Pimpinan Instansi | `AGENCY_HEAD` |
| – | – | `APPROVER`, `REPAIR_CREW`, `SUPERVISOR`, `AUDITOR`, `ADMIN` (new) |

`src/types/rbac.ts` says "do not rename" — v5 renames deliberately; keep a `LEGACY_ROLE_ALIASES` map for **reading** old store data and old session tokens for one release; never write legacy names.

---

## 5. Features per role with acceptance criteria

Role details and permission matrix: `03_ROLES_RBAC.md`. Capture rules: `05_CAPTURE_AND_MEASUREMENT.md`. Repair evidence: `08_REPAIR_VERIFICATION.md`. Documents/log: `07_AUDIT_INTEGRITY.md`.

### 5.1 CITIZEN (Warga) — no login
Navigation: **Map · Report (FAB) · Escort · Me** (v4 tabs "Peta · Lapor · Kawal · Profil").

| ID | Feature |
|---|---|
| C-1 | Pseudonymous device identity (Ed25519 keypair in IndexedDB; pseudonym "Warga-XXXX") |
| C-2 | Report with live camera (single site) |
| C-3 | Report large/long damage (GPS trace mode) |
| C-4 | See whose road it is (authority + basis + confidence) before submitting |
| C-5 | Duplicate prompt: "Someone already reported this — add your photo?" |
| C-6 | Escort tab: my cases, hourglass, ladder, delay reasons |
| C-7 | "I see this too" (witness) |
| C-8 | Repair confirmations at 1/3/6 months + after heavy rain |
| C-9 | Complaint draft at H+30 |
| C-10 | Optional phone OTP (trust tier 1) |
| C-11 | Quests, badges, streaks; certificate with name entered at claim time |
| C-12 | Offline queue |
| C-13 | Story card share (v4 M4, keep) |
| C-14 | Data rights: export / delete my data |

Acceptance criteria:
1. **C-1.1** Given a first visit, when the app loads, then a device keypair is generated, `POST /api/auth/anonymous` registers the public key, and the UI shows a pseudonym; no name, email or phone is requested.
2. **C-2.1** Given production mode, when the user taps Report, then only the in-page `getUserMedia` camera opens; there is no file picker and no `<input type=file>` in the DOM.
3. **C-2.2** Given the camera opens, when the view is shown, then the client requests a nonce and the server returns `{nonce, expires_at}` (TTL default 10 min); a capture after expiry is rejected with `NONCE_EXPIRED`.
4. **C-2.3** Given GPS accuracy > 50 m (configurable), when the user tries to submit, then submission is blocked with "Move to open sky, waiting for better GPS" and the accuracy value is shown.
5. **C-2.4** Given GPS speed > 10 km/h, when the camera is open, then capture is locked (v4 M1.4 rule kept).
6. **C-2.5** Given a submitted photo, when the server stores it, then EXIF is stripped, faces/plates are blurred in the public derivative, the original is stored encrypted, and both SHA-256 values are recorded (`05` §3).
7. **C-2.6** Given a submission, when shown to the citizen, then severity is shown as class + size band only (e.g. "Pothole · medium (0.1–0.5 m²)"), never cm.
8. **C-3.1** Given the user chose "Large or long damage" **before** capture, when they tap Start, then a trace starts and photos are prompted every 15–20 m; End is disabled until ≥3 photos and ≥ the minimum trace length (default 10 m).
9. **C-3.2** Given a trace with a gap > 15 s or implausible speed (> 2.5 m/s on foot, default), when End is tapped, then the trace is marked `quality=LOW` with the reason and the citizen is asked to continue or submit as low confidence.
10. **C-4.1** Given a location, when the routing result returns, then the UI shows authority name, road status, basis (SK number or "estimated from map data"), and confidence badge; LOW shows "Agency will confirm".
11. **C-5.1** Given an open case within 25 m on the same segment with matching class (or pHash distance ≤ threshold), when the citizen reaches the review step, then the app offers "Add to existing report" (default) or "This is different"; choosing add creates a report linked to the case and a witness count +1.
12. **C-6.1** Given any of my open cases, when I open Escort, then I see state label, days waiting, ladder level, current delay reason with `until` date, and authority holding it.
13. **C-7.1** Given a public case, when I tap "I see this too", then one witness per device per case is stored; a second tap is idempotent.
14. **C-8.1** Given a case in `MONITORING` or `REPAIRED_TEMPORARY`, when a follow-up milestone is due, then the reporter and devices that witnessed within 300 m get a prompt "Still good / Damaged again (+photo)"; the answer becomes a `follow_up.recorded` event with `source=CITIZEN`.
15. **C-9.1** Given ladder level `COMPLAINT`, when the citizen opens the case, then a complaint draft is downloadable (text + PDF) built only from logged facts, using neutral wording (07 §7); nothing is sent automatically.
16. **C-10.1** Given OTP verification, when it succeeds, then only `HMAC-SHA256(server_pepper, E.164 phone)` is stored; the phone number itself is not stored after the OTP is consumed.
17. **C-11.1** Given unverified reports, when XP is computed, then they give 0 XP; XP accrues only from server-verified events, max 100 XP/day (v4 rule).
18. **C-11.2** Given a certificate claim, when the citizen types a display name and ticks separate explicit consent (show publicly yes/no), then the certificate PDF shows the name marked "dinyatakan sendiri" (self-declared), the pseudonym, and report hashes; the name is stored only in `certificates`, never in the event log (only its salted hash).
19. **C-12.1** Given no network, when the citizen captures, then the capture is queued in IndexedDB with a pre-issued nonce from the nonce pool (if available) and device signature; on reconnect it uploads; records without a pool nonce are marked `capture_trust=OFFLINE_UNVERIFIED_TIME`.
20. **C-14.1** Given a deletion request, when confirmed, then personal data rows (certificate name, phone hash, device link) are deleted or crypto-shredded; event-log hashes remain valid (07 §9).

### 5.2 FIELD_INSPECTOR (Petugas Inspeksi)
| ID | Feature |
|---|---|
| FI-1 | Assigned inspection list with map + due dates |
| FI-2 | Guided measurement: overview, marker-card nadir photo, straightedge + ruler depth photo, typed depth |
| FI-3 | AI cross-check of ruler reading and marker-based area; mismatch flag |
| FI-4 | Long-damage trace with taped cross-widths |
| FI-5 | Classification correction (feeds learning loop) |
| FI-6 | PINN run (life range) and fair-cost run |
| FI-7 | Plan proposal (repair type, quantities, cost range, urgency) |
| FI-8 | Hazard marking |
| FI-9 | Follow-up inspections (3 months, pre-FHO, after heavy rain) |

Acceptance criteria:
1. **FI-2.1** Given a pothole, depression or rut, when the inspector submits, then the server rejects the submission unless a `DEPTH_RULER` evidence item exists and `depth_mm_typed` is provided.
2. **FI-2.2** Given a marker card is detected in the nadir photo, when area is computed, then area is reported as value ± uncertainty with status `MEASURED`; without a card it is reported as a size band with status `AI_ESTIMATE` (05 §6).
3. **FI-3.1** Given the AI ruler reading differs from the typed depth by more than the tolerance (default 5 mm, configurable), when submitted, then a `RULER_MISMATCH` flag is attached and the coordinator must acknowledge it before `VERIFY_INSPECTION`.
4. **FI-3.2** Given the AI cannot read the ruler, when submitted, then status is `AI_UNREADABLE` (not a mismatch) and the coordinator sees "Check the photo by eye".
5. **FI-4.1** Given a long-damage inspection, when submitted, then ≥3 taped cross-width photos are required, and area = Σ(segment length × local width) with each width labelled `MEASURED`; default lane width 3.5 m is allowed only labelled `ASSUMED`.
6. **FI-6.1** Given the PINN service is down or inputs are out of domain, when a run is requested, then the result is `PINN_UNAVAILABLE` or falls back to PyMastic, and the plan can still be proposed with life range "not computed".
7. **FI-7.1** Given a proposal, when the inspector submits, then quantities must be derived from recorded measurements (server recomputes volume = area × thickness and rejects > 1% difference) and every fair-cost input shows its status label.
8. **FI-7.2** Given a GenAI-drafted rationale, when shown, then it carries "Drafted by AI — needs human approval" and every number inside is code-inserted and checked; the inspector must edit or accept explicitly.

### 5.3 COORDINATOR (Koordinator Pemeliharaan)
| ID | Feature |
|---|---|
| CO-1 | Triage queue sorted by priority (hazard, severity, witnesses, age) |
| CO-2 | Accept / close invalid / merge duplicates |
| CO-3 | Transfer with SK citation; cross-level confirmation |
| CO-4 | Refer to SP4N-LAPOR!/JAKI when authority not onboarded |
| CO-5 | Assign inspector; verify inspection; request reinspection |
| CO-6 | Issue work order (swakelola/contract), assign crew + supervisor, link package |
| CO-7 | Set public delay reason |
| CO-8 | Respond to audit flags (right of reply) |
| CO-9 | Schedule and track follow-ups |
| CO-10 | Segment page: repair history, actual life per method, recurrence |

Acceptance criteria:
1. **CO-2.1** Given a merge, when executed, then the target case must be open, on the same segment (or within 25 m), and the merged case's earliest `created_at` becomes the target's ladder start if earlier.
2. **CO-3.1** Given a transfer without `decree_id` or SK free-text (number + date), when submitted, then it is rejected with `VALIDATION: SK citation required`.
3. **CO-3.2** Given a transfer across government level (e.g. provinsi → nasional), when submitted, then the case gets overlay `transfer_pending_confirmation` and moves only after a COORDINATOR or ADMIN of the target authority (different person) confirms; if the target authority is not onboarded, the case goes to `REFERRED_EXTERNAL`.
4. **CO-3.3** Given a transfer, when it completes, then a `status_correction` proposal is created for the segment if the SK cited differs from the registry (feeds registry correction workflow).
5. **CO-6.1** Given a work order, when crew and supervisor are assigned, then the server rejects if crew account = supervisor account, if either equals the plan proposer or approver, or if supervisor's organisation = crew's organisation for `CONTRACT` type (SOD-1, SOD-4).
6. **CO-6.2** Given type `CONTRACT`, when issued, then `package_id` is required and the package's `pho_date`/`maintenance_months` are shown as INPUT with source link.
7. **CO-7.1** Given a 4th consecutive pending extension, when a coordinator submits it, then it is rejected with "Agency Head must approve this extension".
8. **CO-8.1** Given an open audit flag on the case, when the coordinator responds, then response type (`EXPLAIN`, `SCHEDULE_TEST`, `DISAGREE_WITH_REASON`) and text are logged as `response.added`; public view shows only "Under technical review".

### 5.4 APPROVER (PPK / pejabat berwenang)
| ID | Feature |
|---|---|
| AP-1 | Approval queue: plans with cost range, PINN range, measurements, evidence |
| AP-2 | Approve / return plan with reason and budget source |
| AP-3 | Accept verified work (PHO date, maintenance months) |
| AP-4 | Declare conflicts of interest (provider links) |

Acceptance criteria:
1. **AP-2.1** Given the approver is the plan proposer (same `person_id`, any account), when approving, then `FORBIDDEN SOD-2`.
2. **AP-2.2** Given the approver has a declared or detected link to the package's provider, when approving or accepting, then `FORBIDDEN SOD-3`.
3. **AP-2.3** Given a permitted overlap (KPA acting as PPK in APBD; PPTK assigned PPK duties), when the approver acts, then the action succeeds and the event carries `overlap_basis` (e.g. "Perpres 12/2021 Pasal 10(5)"), visible to AUDITOR (SOD-6).
4. **AP-3.1** Given `ACCEPT_WORK` before `VERIFY_WORK` by a supervisor, when attempted, then `INVALID_TRANSITION` (SOD-5).

### 5.5 REPAIR_CREW (Penyedia / Tim Pelaksana Swakelola / PJLP)
| ID | Feature |
|---|---|
| RC-1 | My work orders (only assigned) |
| RC-2 | Stage-gated evidence capture (live camera, nonce per stage) |
| RC-3 | Declared quantities (area, thickness, tonnage from tickets) |
| RC-4 | Right of reply on flags about their work (as provider representative) |

Acceptance criteria:
1. **RC-2.1** Given stage `MIX_TEMPERATURE`, when submitted, then a photo with a thermometer reading in frame and a typed °C value are required; values below the configured threshold (default 120 °C, `TODO_VERIFY(Spesifikasi Umum 2018 rev.2 Divisi 6 temperature table)`) create a neutral `LOW_MIX_TEMPERATURE` indication, not a rejection.
2. **RC-2.2** Given a stage photo whose pHash matches a previous evidence item (any case) within threshold, when uploaded, then it is rejected with `DUPLICATE_EVIDENCE`.
3. **RC-2.3** Given a crew member, when they try to call `VERIFY_WORK`, `ACCEPT_WORK`, or `CLOSE_*`, then `FORBIDDEN`.
4. **RC-3.1** Given declared tonnage from delivery tickets, when compared with measured volume × density (ASSUMED 2.3 t/m³ unless JMF given), then a difference > 15% (configurable) creates a neutral `QUANTITY_DIFFERENCE` indication for the supervisor.

### 5.6 SUPERVISOR (Konsultan Pengawas / Direksi Teknis / Tim Pengawas Swakelola)
Acceptance criteria:
1. **SV-1.1** Given `VERIFY_WORK`, when submitted, then the supervisor's own live-capture after-photo with straightedge (flush check) taken within 200 m of the site and after `work.submitted` is required.
2. **SV-1.2** Given the supervisor is the crew member, belongs to the same provider organisation (CONTRACT), or was the inspector who proposed the plan, when verifying, then `FORBIDDEN SOD-1/SOD-4`.
3. **SV-1.3** Given any checklist item marked FAIL, when verifying, then the only allowed action is `REJECT_WORK` unless the supervisor records an override reason (logged, visible to AUDITOR).

### 5.7 AUDITOR (APIP / BPK / BPKP / independent; BPJT and Ombudsman as scoped sub-types)
Acceptance criteria:
1. **AU-1.1** Given an auditor account, when calling any state-changing endpoint other than flags/exports, then `FORBIDDEN` (read-only).
2. **AU-1.2** Given an auditor opens a case, then they see the full event chain with hash verification status per event, all evidence (blurred by default; original only via `request_original` which is itself logged).
3. **AU-2.1** Given an auditor creates a flag, when saved, then its target must be `case`, `segment` or `package` (never a person), wording is chosen from the neutral library (07 §7), and the free-text passes the banned-word checker.
4. **AU-3.1** Given an export request, when generated, then the bundle includes events, evidence hashes, checkpoints, OTS proofs and a manifest SHA-256, logged as `export.created`.
5. **AU-4.1** Given sub-type `TOLL_REGULATOR` (BPJT), when acting on BUJT cases, then it may read and flag but never close or approve (note 04 SoD-6).

### 5.8 AGENCY_HEAD (Kepala Dinas / Kepala Balai / Kepala Sudin)
Acceptance criteria:
1. **AH-1.1** Given H+7 escalations, when the dashboard opens, then escalated cases are listed with days waiting, stage, holder, delay reason.
2. **AH-1.2** Given the report card, when shown publicly, then only metrics with n ≥ 10 cases are shown and labelled "operational metrics, not an official assessment" (v4 M3.5 rule kept).
3. **AH-2.1** Given a 4th pending extension, when the agency head approves, then the event records the agency head role (no name in public).

### 5.9 ADMIN (Region Admin)
Acceptance criteria:
1. **AD-1.1** Given a road registry import (SK lampiran parsed to CSV/GeoJSON), when imported, then each row creates a new `segment_status_version` with `valid_from`, `decree_id`, `source`, `confidence`; previous versions are closed (`valid_to`), never overwritten.
2. **AD-2.1** Given a unit price, wage or IKK entry, when saved, then `source_url`, `source_title`, `effective_date`, `status` (`OFFICIAL`/`INPUT`/`ASSUMED`/`TODO_VERIFY`) are required.
3. **AD-3.1** Given an admin account, when trying any case transition, then `FORBIDDEN` (admins configure, they do not act on cases — SOD-8).
4. **AD-4.1** Given a role assignment, when created, then it requires authority scope, `valid_from`, and an appointment reference (e.g. SK penunjukan PPK number) stored as INPUT; the event is visible to AUDITOR.

### 5.10 SYSTEM and PUBLIC
1. **SYS-1** Given a submitted case, when screening runs, then routing uses snap ≤ 25 m (configurable; use max(25 m, GPS accuracy) up to 50 m) to a registry segment; else admin-boundary fallback with `confidence=LOW`.
2. **SYS-2** Given the daily job at 00:05 WIB, when it runs, then a checkpoint over all events of the previous day is created, signed, submitted to OpenTimestamps, and an upgrade job retries hourly until a Bitcoin attestation exists (07 §4).
3. **SYS-3** Given `auto_accept_enabled=false` (default), when screening finishes, then every case goes to TRIAGE.
4. **SYS-4** Given a follow-up milestone, when due, then tasks are created for inspector (3 months, pre-FHO, heavy rain) and prompts for citizens (1/3/6 months).
5. **PUB-1** Given the public map, when loaded, then segments are coloured by authority level with line style by confidence (solid HIGH, dashed MEDIUM, dotted LOW) and a "Report wrong status" button.
6. **PUB-2** Given `/verify/:docId`, when a PDF is dropped, then its SHA-256 is computed in the browser and compared with the logged document hash, and inclusion proof + checkpoint + OTS status are shown.

---

## 6. API endpoints

Conventions: JSON, `{success:true,data}` / `{success:false,error:{code,message}}` (keep `ApiErrorBody`). Auth types: `public` (none), `device` (citizen device token from `/api/auth/anonymous`, request signed with device key for writes: header `X-Device-Sig` over `SHA-256(body)`), `staff` (session token; role checked), `system` (internal job token). All writes are rate-limited (keep `server/middleware/rateLimit.ts`). Existing v4 paths are kept where they exist.

### 6.1 Identity
| Method | Path | Auth | Request | Response |
|---|---|---|---|---|
| POST | `/api/auth/anonymous` (exists) | public | `{device_pubkey_jwk}` | `{device_id, pseudonym, token, trust_tier:0}` |
| POST | `/api/auth/otp/request` | device | `{phone_e164}` | `{otp_id, expires_at}` |
| POST | `/api/auth/otp/verify` | device | `{otp_id, code}` | `{trust_tier:1}` |
| POST | `/api/auth/login` (exists) | public | `{username, password}` (+ TOTP for staff, roadmap) | `{token, roles:[{role, authority_id}]}` |
| GET | `/api/auth/me` (exists) | device/staff | – | identity + roles + scopes |
| POST | `/api/auth/logout` (exists) | staff | – | `{ok}` |
| DELETE | `/api/me` | device | `{confirm:true}` | `{deleted:[...]}` (C-14) |

### 6.2 Capture, evidence, traces
| Method | Path | Auth | Request | Response |
|---|---|---|---|---|
| POST | `/api/capture/nonce` | device/staff | `{purpose:"REPORT"|"INSPECTION"|"WORK_STAGE"|"FOLLOW_UP", case_id?, stage?}` | `{nonce, expires_at, server_time}` |
| POST | `/api/capture/nonce-pool` | device | `{count≤5}` | `{nonces:[{nonce, expires_at}]}` (TTL 24 h, offline use) |
| POST | `/api/evidence` | device/staff | multipart: `image` (JPEG ≤ 500 KB after client resize), `meta` JSON `{nonce, kind, stage?, burst:[{sha256, t_ms}], gps:{lat,lon,accuracy_m,speed_mps?,heading?,t}, motion:{samples:[...]}, client_time, demo:false}` | `{evidence_id, sha256_public, sha256_original_enc, phash, checks:{nonce, gps, motion, burst_liveness, duplicate, screen_moire}, duplicates:[{evidence_id, case_code, distance}]}` |
| POST | `/api/traces` | device/staff | `{nonce, start:{lat,lon,accuracy_m,t}}` | `{trace_id}` |
| POST | `/api/traces/:id/points` | device/staff | `{points:[{lat,lon,accuracy_m,speed_mps,t}]}` (batched, ≤ 300) | `{received}` |
| POST | `/api/traces/:id/end` | device/staff | `{end:{...}, evidence_ids:[...]}` | `{length_m, length_uncertainty_m, quality:"HIGH"|"MEDIUM"|"LOW", checks:{gaps, speed, photo_spacing, photos_on_trace}}` |
| POST | `/api/measure/ruler-check` | staff | `{evidence_id, depth_mm_typed}` | `{ai_depth_mm|null, status:"MATCH"|"MISMATCH"|"AI_UNREADABLE", tolerance_mm, model_version}` |
| POST | `/api/measure/marker-area` | staff | `{evidence_id, mask_id?}` | `{area_m2, uncertainty_m2, width_m, length_m, marker:{id, px_size, tilt_deg}, status}` |

### 6.3 Cases (keep `/api/workflow/reports*` paths)
| Method | Path | Auth | Request | Response |
|---|---|---|---|---|
| POST | `/api/workflow/reports` (exists) | device/staff | `{nonce, evidence_ids:[...], location:{lat,lon,accuracy_m}, mode:"SINGLE"|"TRACE", trace_id?, class_guess?, note?, attach_to_case_id?}` | `{case_id, public_code, state, routing:{authority, segment, confidence, basis}, duplicates:[...]}` |
| GET | `/api/workflow/reports` (exists) | staff | `?queue=triage|mine|approval|work|verify|follow_up&authority_id&state&bbox&page` | paged list |
| GET | `/api/workflow/reports/:id` (exists) | staff/device(owner) | – | full case (staff) / own view (citizen) |
| POST | `/api/workflow/reports/:id/transitions` (exists) | staff/device | `{action, expected_version, reason?, ...payload}` (see §3.3) | `{case, event:{event_id, event_hash, seq}}` |
| POST | `/api/workflow/reports/:id/witness` (exists) | device | `{evidence_id?}` | `{witness_count}` |
| POST | `/api/workflow/reports/:id/repair-confirmations` (exists) | device | `{milestone, result:"OK"|"DAMAGED", evidence_id?}` | `{follow_up_id}` |
| GET | `/api/workflow/reports/:id/events` | staff/auditor | – | events with hashes + verify status |
| GET | `/api/workflow/reports/:id/complaint-draft` | device(owner) | `?format=txt|pdf` | draft (only when ladder ≥ COMPLAINT) |
| GET | `/api/me/confirmations` (exists) | device | – | due prompts |
| GET | `/api/me/impact` (exists) | device | – | XP, quests, badges |
| POST | `/api/me/certificate/claim` | device | `{display_name, consent_public:boolean, consent_text_version}` | `{certificate_code, pdf_url}` |
| GET | `/api/public/certificate/:code` (exists) | public | – | certificate verify view |

### 6.4 Routing and road registry
| Method | Path | Auth | Request | Response |
|---|---|---|---|---|
| GET | `/api/routing/resolve` | public | `?lat&lon&accuracy_m` | `{segment:{id,name,status}, authority_chain:[{id,name,level,office,contact}], confidence, basis:{decree_id?, source}, candidates:[...]}` |
| GET | `/api/public/segments` | public | `?bbox&zoom` | GeoJSON (status, authority level, confidence, legal_basis) |
| GET | `/api/public/segments/:id` | public | – | segment + status history + repair history (public fields) |
| POST | `/api/segments/:id/status-corrections` | device/staff | `{proposed_status, proposed_authority_id, evidence:{decree_ref?, evidence_id?, url?}, note}` | `{correction_id, state:"PENDING"}` |
| GET | `/api/public/agencies` (exists `/api/agencies`) | public | `?region` | directory (name, address, phone, email, website, complaint channel; coordinates only if published) |
| GET | `/api/public/agencies/report-card` (exists `/api/agencies/report-card`) | public | `?authority_id` | metrics n ≥ 10 |

### 6.5 Engineering and cost
| Method | Path | Auth | Request | Response |
|---|---|---|---|---|
| POST | `/api/engine/diagnose` (exists) | staff | `{segment_id, structure?, traffic?, observations, repair?}` | `{life_months:{p10,p50,p90}, verdict, confidence, dominant_factors, model_version, fallback_used}` |
| POST | `/api/audit/fair-cost` (exists; extend) | staff | `{case_id, region_code, measurements_ref, mix, overhead_pct?, reported_spend_idr?}` | **Output format is defined in `06_COST_ENGINE.md` §9** (`fairCostIdr:{low,mid,high}`, `quantity`, `lines`, `completeness`, `priceTableVersion`, every input with status/source); plus `flag:"NONE"|"NEEDS_CLARIFICATION"` per 06 §6 |
| GET | `/api/prices` (exists) | staff | `?region_code` | price sources with status |
| GET/POST | `/api/packages` (exists as `/api/projects`, rename with alias) | staff | package fields (§7.6) | package |
| POST | `/api/packages/:id/verify` (exists as `/api/projects/:id/verify`) | COORDINATOR/AUDITOR | `{source_check_note}` | package with `verified_by_role` |

### 6.6 Work orders, follow-ups, flags
| Method | Path | Auth | Request | Response |
|---|---|---|---|---|
| GET | `/api/work-orders` | staff | `?mine&state` | list |
| POST | `/api/work-orders/:id/evidence` | REPAIR_CREW/SUPERVISOR | `{stage, evidence_id, values:{temperature_c?, thickness_mm?, ticket:{batch_time, mix_type, weight_t}?, roller_passes?}}` | `{checklist_status}` |
| GET | `/api/follow-ups` | staff | `?due_before&assignee` | list |
| POST | `/api/follow-ups/:id/result` | FIELD_INSPECTOR/SUPERVISOR | `{result:"OK"|"DEFECT", failure_modes:[...], evidence_ids, measurements?}` | `{follow_up, reopened_case_id?}` |
| GET | `/api/audit/flags` (exists) | staff/auditor | `?target_type&target_id&state` | flags |
| POST | `/api/audit/flags` | AUDITOR, COORDINATOR, SYSTEM | `{target_type:"case"|"segment"|"package", target_id, code, wording_id, note}` | flag |
| POST | `/api/audit/flags/:id/response` (exists) | COORDINATOR/AGENCY_HEAD/APPROVER/REPAIR_CREW | `{type, text, evidence_ids?}` | response |
| GET | `/api/public/under-review` (exists) | public | – | cases with "Under technical review" |

### 6.7 Documents, integrity, verify
| Method | Path | Auth | Request | Response |
|---|---|---|---|---|
| POST | `/api/documents/audit-report` | COORDINATOR/AUDITOR/AGENCY_HEAD | `{case_id or package_id}` | `{doc_id, version, supersedes?, pdf_sha256, snapshot:{tree_size, root, checkpoint_date}}` |
| POST | `/api/documents/agency-draft` | COORDINATOR/AGENCY_HEAD/AUDITOR | `{case_id, format:"pdf"|"docx"|"json"}` | `{doc_id, sha256, watermark:"DRAF"}` |
| GET | `/api/documents/:id` | staff | – | file + metadata |
| POST | `/api/documents/:id/agency-signed` | COORDINATOR/AGENCY_HEAD | `{signed_sha256, agency_doc_number?, signed_at}` | `{event_hash}` (records agency's own signed doc hash only) |
| GET | `/api/public/verify/:docId` | public | – | `{doc_hash, issued_at, version, superseded_by?, inclusion_proof, checkpoint, ots:{status, bitcoin_block?}, tsa?}` |
| GET | `/api/public/checkpoints` | public | `?date` | signed checkpoints |
| GET | `/api/public/events/:hash/proof` | public | – | inclusion proof (no payload; payload hash only) |
| GET | `/api/audit/export` | AUDITOR | `?scope=case:<id>|authority:<id>|range` | ZIP bundle + manifest |

### 6.8 Admin
| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET/POST/PATCH | `/api/admin/authorities` | ADMIN | authority + office tree, contacts, `onboarded` flag |
| POST | `/api/admin/road-registry/import` | ADMIN | SK lampiran import (CSV/GeoJSON) → new versions |
| POST | `/api/admin/segments/:id/status` | ADMIN | new status version with decree |
| POST | `/api/admin/status-corrections/:id/decide` | ADMIN, COORDINATOR (target authority) | accept/reject |
| GET/POST | `/api/admin/prices` | ADMIN | unit prices, wages, IKK, asphalt by supply point |
| GET/POST | `/api/admin/users`, `/api/admin/role-assignments` | ADMIN | staff accounts, assignments |
| GET/POST | `/api/admin/conflict-declarations` | ADMIN, self (any staff) | provider links |
| GET/PUT | `/api/admin/config/:name` | ADMIN | `sla`, `capture`, `routing`, `follow_up`, `cost` configs (each change logged) |
| GET | `/api/dashboard/agency` | AGENCY_HEAD, COORDINATOR | escalations, report card, recurrence |

---

## 7. Database schema (PostgreSQL + PostGIS; demo keeps `.data/` JSON store behind the same repository interfaces)

Notation: `pk`, `fk→table`, `[]` array, `geom(...)` PostGIS. All tables have `created_at timestamptz`. Personal data columns are marked **PD**.

### 7.1 Regions, authorities, registry
**Authoritative definition: `04_AUTHORITY_ROUTING.md` §3 (SQL).** Use its table names exactly: `sk_reference`, `authority`, `office`, `road_segment` (versioned, PK `(id, version)`), `ruas_official`, `segment_ruas_match`, `status_correction` (with `NEEDS_SECOND_CONFIRM` state = SOD-7), `routing_decision` (one per report, hashed into the event log). Wherever this spec says "decree", "authorities", "segment status version" or "status corrections", it means those tables:

| Name used in this spec | Table in 04 |
|---|---|
| `decree_id`, road decree | `sk_reference.id` |
| authority (legal penyelenggara) | `authority` |
| office / unit kerja (routable: Balai, Satker, Dinas, Sudin, Satpel, UPTD, BUJT, desa) | `office` |
| segment + status version | `road_segment (id, version)` with `status`, `authority_id`, `office_id`, `sk_reference_id`, `source`, `confidence`, `valid_from/valid_to` |
| status correction | `status_correction` |
| routing result stored on a case | `routing_decision` (FK from `reports.id`) |

Additions owned by this spec (not in 04):
| Table / column | Key columns |
|---|---|
| `regions` | `code` pk (Kemendagri kode wilayah), `name`, `level` (`PROVINSI`,`KABUPATEN`,`KOTA`,`KOTA_ADM`,`KECAMATAN`,`DESA`), `parent_code`, `geom(MultiPolygon,4326)`, `source` |
| `office.onboarded bool` (new column) | `true` only for agencies with a signed pilot agreement; `false` → cases go to `REFERRED_EXTERNAL` |
| `segment_overlays` | `id`, `segment_id`, `kind` (`ASSISTED_PROJECT`,`TAKEOVER`,`DEFECT_TYPE_OVERRIDE`), `authority_id`, `office_id`, `basis`, `valid_from/to` (UU 2/2022 takeover as overlay, note 04 §1) |

### 7.2 People and roles
| Table | Key columns |
|---|---|
| `persons` | `id` pk, `display_name` **PD**, `org_id`, `nip_hash` **PD** (optional, salted), `active` |
| `organisations` | `id` pk, `kind` (`GOVERNMENT`,`PROVIDER`,`CONSULTANT`,`AUDIT_BODY`,`INDEPENDENT`), `name`, `npwp_hash` (optional), `source_url` |
| `accounts` | `id` pk, `person_id` fk, `username`, `password_hash`, `mfa`, `active` |
| `role_assignments` | `id` pk, `account_id`, `role` (9 roles), `sub_type` (e.g. `PPK`,`KPA_AS_PPK`,`PPTK_AS_PPK`,`TOLL_REGULATOR`,`OMBUDSMAN`), `authority_id`, `package_id` nullable, `appointment_ref` (SK penunjukan, INPUT), `overlap_basis` nullable, `valid_from`, `valid_to`, `created_by` |
| `conflict_declarations` | `id`, `person_id`, `organisation_id` (provider), `relation` (`OWNER`,`EMPLOYEE`,`COMMISSIONER`,`FAMILY`,`OTHER`), `declared_at`, `source` (`SELF`,`ADMIN`,`AUDITOR`) |
| `devices` | `id` pk, `pubkey_jwk`, `pseudonym`, `trust_tier` (0/1), `trust_score` (hidden), `phone_hmac` **PD**, `created_at`, `last_seen_at`, `deleted_at` |

### 7.3 Cases, reports, evidence
| Table | Key columns |
|---|---|
| `cases` | `id` pk (`CASE-<16hex>`), `public_code`, `version`, `state`, `closure_reason`, `segment_id` + `segment_version` (→ `road_segment`), `authority_id`, `office_id`, `routing_confidence`, `routing_basis` JSON, `location geom(Point)`, `extent geom(Geometry)` (trace buffer/polygon), `damage_class` (RDD code), `severity` (L/M/H or size band), `hazard bool`, `pending` JSON, `merged_into_case_id`, `ladder_start_at`, `accepted_at` (immutable), `is_demo bool`, `chain_id` (`prod`/`demo`) |
| `reports` | `id` pk, `case_id` fk, `device_id` fk nullable, `staff_account_id` nullable, `mode` (`SINGLE`,`TRACE`), `trace_id`, `class_guess`, `size_band`, `note` (moderated), `capture_trust` (`LIVE_NONCE`,`POOL_NONCE`,`OFFLINE_UNVERIFIED_TIME`,`DEMO`), `submitted_at` |
| `capture_nonces` | `nonce` pk (128-bit random), `issued_to` (device/account), `purpose`, `case_id`, `stage`, `issued_at`, `expires_at`, `used_at`, `pool bool` |
| `evidence` | `id` pk, `case_id`, `report_id`/`work_order_id`/`follow_up_id`/`inspection_id`, `kind` (`OVERVIEW`,`CLOSEUP`,`TRACE_POINT`,`MARKER_NADIR`,`DEPTH_RULER`,`CROSS_WIDTH`,`WORK_STAGE`,`FOLLOW_UP`,`HAZARD_SIGN`), `stage`, `nonce`, `sha256_original_enc`, `sha256_public`, `phash` (64-bit), `storage_key_public`, `storage_key_original_enc` **PD**, `enc_key_id` (for crypto-shredding), `gps geom(Point)`, `gps_accuracy_m`, `server_received_at`, `client_time`, `checks` JSON, `blur_applied bool`, `is_demo`, `demo_source` |
| `traces` | `id` pk, `case_id`, `report_id`/`inspection_id`, `geom(LineString)`, `points_count`, `length_m`, `length_uncertainty_m`, `median_accuracy_m`, `max_gap_s`, `quality`, `checks` JSON, `started_at`, `ended_at` |
| `detections` | `id`, `evidence_id`, `model_id`, `model_version`, `runtime` (`OPENVINO_CPU`/`GPU`/`NPU`), `class`, `score`, `bbox`, `mask_rle`, `status` (`REAL`,`MODEL_UNAVAILABLE`,`DEMO`) |
| `witnesses` | `case_id`, `device_id`, `evidence_id`, unique(`case_id`,`device_id`) |

### 7.4 Inspections and measurements
| Table | Key columns |
|---|---|
| `inspections` | `id`, `case_id`, `inspector_account_id`, `assigned_by`, `due_at`, `submitted_at`, `verdict`, `class_confirmed`, `notes` |
| `measurements` | `id`, `inspection_id`/`work_order_id`/`follow_up_id`, `quantity` (`AREA_M2`,`LENGTH_M`,`WIDTH_M`,`DEPTH_MM`,`THICKNESS_MM`,`TEMPERATURE_C`,`ROLLER_PASSES`,`TONNAGE_T`), `value`, `uncertainty`, `unit`, `method` (`MARKER_HOMOGRAPHY`,`STRAIGHTEDGE_RULER`,`TAPE`,`GPS_TRACE`,`AI_SEGMENTATION_BAND`,`TICKET`,`THERMOMETER`), `status` (`MEASURED`,`INPUT`,`ASSUMED`,`AI_ESTIMATE`), `evidence_ids[]`, `ai_crosscheck` JSON (`ai_value`, `status`, `tolerance`, `model_version`) |
| `pinn_runs` | `id`, `case_id`/`segment_id`, `inputs` JSON (each with status), `life_months_p10/p50/p90`, `verdict`, `model_version`, `fallback_used`, `runtime` |
| `ahsp_items` | `code` pk (e.g. `11.1.(9)`), `name`, `unit`, `source` (`SE 30/SE/Dk/2025 Lampiran V`), `status` |
| `ahsp_coefficients` | `ahsp_code`, `resource_code`, `resource_kind` (`LABOR`,`MATERIAL`,`EQUIPMENT`), `coefficient`, `unit`, `status` (`OFFICIAL`/`TODO_VERIFY`), `source_page` |
| `price_sources` | `id`, `region_code`, `resource_code`, `price_idr`, `unit`, `kind` (`WAGE_UMP`,`WAGE_UMK`,`HSPK`,`SSH`,`ASPHALT_PERTAMINA`,`IKK_MULTIPLIER`,`VENDOR`), `effective_date`, `source_url`, `source_title`, `status` |
| `cost_estimates` | `id`, `case_id`/`package_id`, `region_code`, `engine_version`, `price_table_version`, `output` JSON (06 §9 format), `fair_cost_low/mid/high_idr`, `reported_spend_idr`, `diff_pct`, `flag`, `inputs_snapshot_sha256` |
| `plans` | `id`, `case_id`, `proposed_by`, `repair_type`, `category` (`TEMPORARY`,`PERMANENT`), `quantities` JSON, `cost_estimate_id`, `pinn_run_id`, `urgency`, `rationale`, `genai` JSON (`model`, `drafted`, `accepted_by`), `state` |
| `approvals` | `id`, `plan_id`, `approver_account_id`, `decision`, `reason`, `budget_source`, `overlap_basis` |

### 7.5 Work, verification, follow-ups
| Table | Key columns |
|---|---|
| `packages` | `id`, `kode_rup`, `kode_tender`, `name`, `provider_org_id`, `contract_value_idr`, `pho_date`, `maintenance_months`, `fho_date`, `design_life_years`, `guarantee_kind` (`JAMINAN`,`RETENSI`,`UNKNOWN`), `source_url`, `source` (`LPSE`,`SIRUP`,`PROJECT_BOARD`,`AGENCY`), `verified_by`, `stage` (`PRE_PHO`,`MAINTENANCE`,`POST_FHO_DESIGN_LIFE`,`BEYOND`,`UNKNOWN`) computed |
| `package_segments` | `package_id`, `segment_id`, `sta_from`, `sta_to` |
| `work_orders` | `id`, `case_id`, `plan_id`, `type` (`SWAKELOLA`,`CONTRACT`), `package_id`, `crew_account_id`/`crew_org_id`, `supervisor_account_id`, `target_date`, `category`, `issued_by`, `state` |
| `work_checklist_items` | `work_order_id`, `stage` (see 08 §2), `required bool`, `evidence_ids[]`, `values` JSON, `crew_status`, `supervisor_status` (`PASS`,`FAIL`,`NA`), `supervisor_note` |
| `repair_records` | `id`, `case_id`, `work_order_id`, `segment_id`, `method` (v4 `REPAIR_METHODS`), `category`, `material`, `thickness_mm`, `area_m2`, `compactor`, `accepted_at`, `pho_date`, `maintenance_end_date`, `pinn_life_p10/p50/p90`, `actual_life_days` (null until failure), `failed_at`, `failure_modes[]`, `censored bool` |
| `follow_ups` | `id`, `repair_record_id`, `milestone` (`M1`,`M3`,`M6`,`HEAVY_RAIN`,`PRE_FHO`,`EVERY_6M`), `due_at`, `window_days`, `assignee_role`, `assignee_account_id`, `result`, `failure_modes[]`, `evidence_ids[]`, `source` (`INSPECTOR`,`SUPERVISOR`,`CITIZEN`), `recorded_at` |
| `flags` | `id`, `target_type` (`case`,`segment`,`package`), `target_id`, `code` (e.g. `NEEDS_CLARIFICATION_COST`,`EARLY_FAILURE_IN_MAINTENANCE`,`RULER_MISMATCH`,`LOW_MIX_TEMPERATURE`,`QUANTITY_DIFFERENCE`,`RECURRENCE`), `wording_id`, `note`, `created_by_role`, `state` (`OPEN`,`RESPONDED`,`TEST_SCHEDULED`,`RESOLVED`,`WITHDRAWN`) |
| `responses` | `id`, `flag_id`/`case_id`, `responder_role`, `responder_org_id`, `type`, `text`, `evidence_ids[]` |
| `external_referrals` | `id`, `case_id`, `channel`, `bundle_sha256`, `external_ticket_id`, `referred_at`, `last_status` |

### 7.6 Integrity, documents, gamification
| Table | Key columns |
|---|---|
| `events` | `seq` bigserial pk, `chain_id`, `event_id` uuid, `type`, `entity_type`, `entity_id`, `actor_ref` (pseudonym or `role:account_hash`), `actor_role`, `payload` JSONB (no PD), `payload_sha256`, `prev_hash`, `event_hash` unique, `server_received_at`, `sig` (Ed25519, server key), `key_id`. **No UPDATE/DELETE grants** (07 §2). |
| `checkpoints` | `id`, `chain_id`, `period_date`, `tree_size`, `first_seq`, `last_seq`, `merkle_root`, `prev_checkpoint_hash`, `sig`, `key_id`, `ots_proof` bytea, `ots_status` (`PENDING`,`UPGRADED`,`FAILED`), `bitcoin_block_height`, `tsa_token` bytea nullable, `published_at` |
| `documents` | `id` pk (`DOC-...`), `kind` (`AUDIT_REPORT`,`AGENCY_DRAFT`,`COMPLAINT_DRAFT`,`CERTIFICATE`,`EXPORT`), `case_id`/`package_id`, `version`, `supersedes_doc_id`, `snapshot_tree_size`, `snapshot_root`, `template_id`, `template_sha256`, `sha256`, `pades_signed bool`, `issued_at`, `is_demo` |
| `agency_signed_docs` | `id`, `document_id`, `signed_sha256`, `agency_doc_number`, `signed_at`, `recorded_by` |
| `certificates` | `code` pk, `device_id`, `display_name` **PD**, `consent_public`, `consent_text_version`, `name_salted_hash`, `issued_at`, `revoked_at` |
| `quests`, `quest_progress`, `badges` | v4 `config/quests.json` model; XP only from verified events |
| `config_versions` | `name`, `version`, `json`, `sha256`, `changed_by`, `changed_at` (every change also an event) |

---

## 8. Non-functional requirements

### 8.1 Privacy — UU 27/2022 (PDP), fully in force since ~17 Oct 2024 (Pasal 74)
| # | Requirement | Basis |
|---|---|---|
| P-1 | Collect nothing identifying by default; pseudonymous device ID | Pasal 16(2)(a) collection "terbatas dan spesifik" |
| P-2 | Name only at certificate claim; phone only for OTP (HMAC stored); separate explicit consent screens with versioned text | Pasal 20(2)(a) explicit consent |
| P-3 | Bystander faces and plates blurred before public display/export; originals encrypted, access logged | Pasal 4 (biometric = specific data); legitimate-interest basis Pasal 20(2)(f) with documented balancing test — **legal review required** |
| P-4 | EXIF stripped; capture time/GPS kept as structured fields; damage location snapped to road; no continuous reporter location kept except the trace polyline of the damage | Pasal 16(2)(a)/(b) |
| P-5 | No personal data in events, checkpoints, OTS, or any public layer — hashes of salted/encrypted blobs only; crypto-shredding for deletion | Pasal 16(2)(g) deletion |
| P-6 | Published retention schedule (07 §9) | Pasal 16(2)(g) |
| P-7 | DPIA before production launch | Pasal 34(1) |
| P-8 | Breach playbook: written notice within 3×24 hours | Pasal 46 |
| P-9 | Plan for a DPO (public-facing, large-scale monitoring) | Pasal 53(1); note MK 151/PUU-XXII/2024 on Pasal 53(1)(b) |
| P-10 | Data-subject rights endpoints: access/export/delete (C-14) | Pasal 16(2), rights chapter `TODO_VERIFY(UU 27/2022 Pasal 5–13 text)` |
| P-11 | Public pages never show provider names or official names; flags target case/segment/package | note 08 §7; v4 SPEC §0.5 |

### 8.2 Performance
| # | Requirement |
|---|---|
| N-1 | LCP < 2.5 s on a mid-range Android over 4G; route bundle < 250 KB gzip (v4 M9) |
| N-2 | Photos resized on device to ≤ 500 KB JPEG (long edge 1600 px default; configurable) |
| N-3 | API p95 < 300 ms for reads, < 800 ms for case submit (excluding inference); inference async |
| N-4 | Screening (detect + seg) result ≤ 10 s p95 on server CPU; numbers must be re-benchmarked on Intel Core Ultra (CPU/GPU/NPU) with OpenVINO 2026.4.x — current benchmarks are `HOST_NON_INTEL` |
| N-5 | Public map tiles/GeoJSON by bbox, ≤ 2,000 features per response, simplified by zoom |
| N-6 | Daily checkpoint job completes < 5 min for 1 M events |

### 8.3 Offline and low-end devices
| # | Requirement |
|---|---|
| O-1 | PWA service worker caches shell + last map area; works on Android Chrome ≥ last 2 years and iOS Safari ≥ 16 (`TODO_VERIFY` minimums with device lab) |
| O-2 | Capture queue in IndexedDB; uploads resume with backoff; per-item status visible |
| O-3 | Nonce pool (≤ 5, 24 h) enables trusted offline captures; else `OFFLINE_UNVERIFIED_TIME` (needs corroboration or inspector) |
| O-4 | Traces buffered locally; upload in batches; trace survives app backgrounding where the browser allows (document limitation: browsers may suspend GPS in background — UI asks to keep screen on) |
| O-5 | Text-only fallback when camera permission denied: user can submit a **location-only hint** (no photo) that goes to TRIAGE as `UNVERIFIED_HINT`, gets no XP, and is never shown publicly until a photo-backed report or inspector confirms |

### 8.4 Accessibility and UX
WCAG 2.2 AA; target size ≥ 24×24 px (WCAG 2.5.8) with 44 px preferred for primary actions; light theme default; deck palette tokens (Asphalt ink `#0D1015`, Signal yellow `#FFC72C`/`#E0A100`, Cone orange `#FF7A1A`, Hazard red `#E5391A`, Physics cyan `#0A9CC2`, Intel blue `#0068B5`, Green `#12A06A`); Barlow Condensed headings + Barlow body; `prefers-reduced-motion` respected; mascot Pavi per role; colour never the only signal (map uses line style too).

### 8.5 Security
Staff MFA (roadmap, required before production); server signing keys in KMS/HSM or at least separate file with 0400 perms; key rotation logged as event with `key_id`; rate limits per device/IP/area; moderation of free text (banned words + personal names heuristic); CSP strict; no third-party trackers.

---

## 9. DEMO MODE rules (judges)

| # | Rule |
|---|---|
| D-1 | Enabled by env `DEMO_MODE=1` **and** per-session toggle "Demo mode" shown on the onboarding screen; the UI shows a persistent yellow banner "DEMO — not a live capture". |
| D-2 | In DEMO MODE, the camera screen shows a small text link "Use a sample photo (demo)" opening bundled sample photos (`public/demo/samples/*`, each with source + license in `public/demo/samples/LICENSES.md`). Optional: in DEMO only, a file picker for the judge's own photo (same stamp). Production builds never include the link. |
| D-3 | Every DEMO record has `is_demo=true`, `capture_trust=DEMO`, `demo_source` (`SAMPLE:<id>` or `UPLOAD`), and evidence images get a visible corner watermark "DEMO". |
| D-4 | DEMO events are written to `chain_id='demo'`; they never enter the production chain, checkpoints or OTS anchoring (demo chain may be checkpointed separately, labelled DEMO). |
| D-5 | DEMO cases are excluded from: report cards, recurrence metrics, `measurements/*.json`, XP/quests/certificates, public production map (visible only on the demo layer), external referrals. |
| D-6 | Documents generated from DEMO cases carry a diagonal watermark "DEMO — BUKAN DATA NYATA" on every page, and the verify page answers "This is a demo document". |
| D-7 | Demo staff logins (`server/auth/demoLogin.ts`) stay, one per role (9), with names "Demo Inspector" etc.; SoD still enforced (demo shows the rules working: e.g. trying to approve own plan shows `SOD-2`). |
| D-8 | Seed data via `SEED_IMPORT` only; seeded numbers labelled `DEMO`; no `Math.random` presented as a result (v4 §0.1). |
| D-9 | Nonce, GPS and motion checks still run; failures are shown as "would be rejected in production" instead of blocking. |

---

## 10. Migration plan from the current repo

Base: `/home/claude/deck/repo/r` branch `v4` (React 19 + Vite PWA, Express TS, `.data/` JSON store, FastAPI + OpenVINO). Do not rewrite; extend. Each phase: plan ≤ 15 lines → code → tests → `PROGRESS.md` → commit.

| Phase | Work | Files (existing → change) | Tests (must pass) |
|---|---|---|---|
| V5-0 | Add v5 types side by side; legacy alias maps | `src/types/rbac.ts` (9 roles + `LEGACY_ROLE_ALIASES`), `src/domain/workflow/model.ts` (v5 states/actions + `LEGACY_STATE_MAP`) | type tests; old fixtures load via aliases |
| V5-1 | Event log + hash chain (replace plain `audit` array) | new `server/integrity/{canonical.ts,chain.ts,merkle.ts,checkpoint.ts}`; `server/repositories/fileCaseStore.ts` writes events in same atomic write; migration script `scripts/migrate-v4-audit-to-events.ts` (re-chains old audit records in order, marks them `migrated:true`) | chain verify test; tamper test (edit 1 byte → verify fails at that seq); JCS vectors from RFC 8785 |
| V5-2 | State machine v5 + SoD checks | `src/domain/workflow/stateMachine.ts` (new `TRANSITIONS`), new `src/domain/workflow/sod.ts`; `server/routes/workflow.routes.ts` | one test per transition row (§3.3) and per SoD rule (03 §5) |
| V5-3 | Roles + accounts + assignments | `server/repositories/accountStore.ts` (9 roles, assignments, conflicts), `server/auth/demoLogin.ts` (9 demo users), `src/app/routeConfig.ts`, `src/features/rbac/accessPolicy.ts` | route access matrix test generated from `data/roles.json` |
| V5-4 | Capture: nonce, evidence endpoint, pHash, blur pipeline, traces | `server/services/photoValidation.ts` (keep magic-byte + EXIF strip), new `server/routes/capture.routes.ts`, `inference/` blur + pHash endpoints; client camera module; remove gallery input in prod build | nonce expiry/reuse; duplicate detection; trace checks with synthetic traces |
| V5-5 | Road registry + routing | `server/services/authorityResolver.ts` → registry-first, OSM heuristic as fallback (keep 25 m snap); `config/authorities/pilot.json` → DB/JSON `authorities` with offices; registry import script | routing tests for Jakarta kota adm., toll, LOW fallback |
| V5-6 | Inspector measurement + ruler cross-check + marker area | `src/domain/workflow/inspectionViews.ts` (extend `REQUIRED_ANGLES` with `MARKER_NADIR`, `DEPTH_RULER`), new inference endpoints | FI-2/FI-3 criteria |
| V5-7 | Work orders, crew/supervisor flows, follow-ups | `server/services/repairCheck.ts`, `src/domain/roads/recurrence.ts` (`CONFIRM_MILESTONES_MONTHS` → follow-up schedule incl. HEAVY_RAIN, PRE_FHO, EVERY_6M) | RC/SV criteria; fake-timer schedule tests |
| V5-8 | Cost engine v5 output | `server/routes/audit.routes.ts` `/api/audit/fair-cost`, `config/prices/*` → `price_sources` with status | every input has status; TODO_VERIFY surfaced |
| V5-9 | Checkpoints + OTS + verify page + PDFs | new `server/jobs/checkpointJob.ts`, `server/jobs/otsUpgradeJob.ts`, `server/routes/verify.routes.ts`, PDF renderer from `templates/*.html` (headless Chromium, deterministic) | PDF hash reproducible from same snapshot; verify page e2e |
| V5-10 | DEMO isolation, UI copy (plain English), light theme | `src/app/layouts/LeanShell.tsx`, banners, demo samples | D-1…D-9 tests; Playwright e2e per role |
| V5-11 | Supabase migration update | new `supabase/migrations/2026110x_v5.sql` implementing §7 (enums updated; `events` with no UPDATE/DELETE grants; RLS) | SQL lint; `supabase db reset` locally when credentials exist |

Data migration (file store): `scripts/migrate-v4-to-v5.ts` — reads `.data/workflow.json`, maps states/actions/roles per §4, creates synthetic `work_orders` for v4 `IN_PROGRESS` cases, generates follow-up rows for `RESOLVED` cases, writes events to the new chain with a first `migration.started` event that records the SHA-256 of the old store file. Dry-run flag prints a diff count per state.

Backward compatibility: keep old API paths; accept legacy role/state names on read for one release; reject them on write.

---

## 11. Open questions and TODO_VERIFY register (spec level)

| # | Item | Source to check |
|---|---|---|
| Q-1 | Binding article for maintenance period minimum (6 / 3 months) and 5% guarantee | Perpres 16/2018 jo. 12/2021 jo. 46/2025 (Pasal 50 or nearby); Perlem LKPP 12/2021; Permen PUPR 14/2020 |
| Q-2 | Non-toll national roads inside DKI | Kepmen PUPR 1688/KPTS/M/2022 lampiran |
| Q-3 | Whether Pergub DKI 153/2019 was replaced (LKIP 2023 cites Pergub 57/2022 organisation, Pergub 57/2023 Unit Pelaksana) | JDIH DKI |
| Q-4 | PPTK duties | Permendagri 77/2020 |
| Q-5 | SP4N-LAPOR! SLA regulation number (likely PermenPANRB 62/2018) and any API for referrals | KemenPANRB; lapor.go.id |
| Q-6 | Spesifikasi Umum 2018 rev.2 Divisi 6 temperatures, thickness tolerances, core frequency | Bina Marga primary document |
| Q-7 | AHSP coefficients for 11.1.(9), 7.1.(1), 7.1.(2a), 7.3.(5a), 7.3.(6a), 6.1.(1)/(2), CPHMA | SE Dirjen Bina Konstruksi 30/SE/Dk/2025 Lampiran V |
| Q-8 | Licensed non-state PSrE for operator TTE, RFC 3161 TSA availability in Indonesia | Komdigi PSrE list |
| Q-9 | Lawful basis for bystander images (legitimate interest) and DPO need | Indonesian counsel; DPIA |
| Q-10 | Toll SPM 2026 (new Permen) pothole handling times | Kementerian PU JDIH |
| Q-11 | Whether jalan desa reports should route to Pemerintah Desa directly or via Dinas PU Kab | pilot interviews; Permendagri 20/2018 |
