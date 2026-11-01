# 03 — Roles, RBAC and Separation of Duties (v5)

> Machine-readable twin: `data/roles.json` (route guards, permission tests and the demo login list are generated from it). If this file and the JSON disagree, the JSON wins for code and this file must be fixed.
> Sources: research notes 04 (kewenangan & peran), 03 (korupsi jalan), 08 (audit & dokumen), 02 (kanal pelaporan). Anything not confirmed there is `TODO_VERIFY(<source>)`.
> Important caveat (note 04 §9 Gaps): **Indonesian regulations have no official English role names.** The English names below are product names; the Indonesian equivalents are the legal anchors.

---

## 1. The model in one picture

Three lines, mirroring Indonesian law (note 04 §9):

```
LINE 1 — Road authority chain (does the work)
  Status holder (by SK) → Balai / Dinas / Sudin → PPK or Kasi / Satpel → crew or contractor
      COORDINATOR · FIELD_INSPECTOR · APPROVER · REPAIR_CREW · AGENCY_HEAD

LINE 2 — Independent verification (checks the work)
  Konsultan Pengawas / Tim Pengawas Swakelola  +  citizens
      SUPERVISOR · CITIZEN

LINE 3 — Oversight (reads, flags, never operates)
  APIP (Itjen / Inspektorat), BPK, BPKP, BPJT (toll), Ombudsman, independent auditors
      AUDITOR (sub-types)

System configuration (never acts on cases): ADMIN
```

Routing by road status: `UU 2/2022` Pasal 9 (classes), Pasal 14–16A (authority by level); status set by periodic decree (`PP 34/2006` Pasal 62): Keputusan Menteri (national — current: Kepmen PUPR 1688/KPTS/M/2022), Keputusan Gubernur (provincial), Keputusan Bupati (kabupaten and desa), Keputusan Walikota (kota). Toll roads are national roads operated by BUJT (UU 2/2022 Pasal 9(6), 51A; Permen PU 2/2025).

---

## 2. The 9 roles

### 2.1 Summary table

| # | Role key | English name | Indonesian equivalent(s) | Login |
|---|---|---|---|---|
| 1 | `CITIZEN` | Citizen | Warga / Masyarakat / Pelapor | none (device key); optional phone OTP |
| 2 | `FIELD_INSPECTOR` | Field Inspector | Petugas Inspeksi / Penilik Jalan: staf Satpel Bina Marga Kecamatan (DKI), Seksi Pemeliharaan / UPTD (provinsi, kab/kota), Tim Preservasi / Satker PJN (nasional) | staff account |
| 3 | `COORDINATOR` | Maintenance Coordinator | Koordinator Pemeliharaan: Kepala Seksi Pemeliharaan / Seksi Jalan, Jembatan dan Kelengkapan Jalan (Sudin), Koordinator Satpel, Kepala UPTD, Bidang Preservasi (Balai), operator Posko/Pusdatin | staff account |
| 4 | `APPROVER` | Approving Officer | PPK (Pejabat Pembuat Komitmen); KPA acting as PPK (APBD); PPTK assigned PPK duties; for swakelola: official designated by PA/KPA; for desa: Kepala Desa `TODO_VERIFY` | staff account |
| 5 | `REPAIR_CREW` | Repair Crew | Penyedia (kontraktor) and its site staff; Tim Pelaksana Swakelola; PJLP "pasukan kuning" Dinas Bina Marga DKI; BUJT maintenance unit (toll); UPR/quick-response teams (names vary by region, `TODO_VERIFY` per region) | staff/provider account |
| 6 | `SUPERVISOR` | Works Supervisor | Konsultan Pengawas (Supervisi); Tim Pengawas Swakelola; Direksi Teknis / Direksi Lapangan `TODO_VERIFY(Permen PUPR 14/2020)`; tim teknis assisting PPK | staff/consultant account |
| 7 | `AUDITOR` | Auditor | APIP (Inspektorat Jenderal Kementerian PU; Inspektorat Provinsi/Kabupaten/Kota), BPK, BPKP; sub-types: `TOLL_REGULATOR` (BPJT), `OMBUDSMAN` (scoped), `INDEPENDENT` (university/NGO/journalist witness) | staff account |
| 8 | `AGENCY_HEAD` | Agency Head | Kepala Dinas (often PA), Kepala Balai BBPJN/BPJN (KPA for national roads — inference, note 04 §6), Kepala Suku Dinas, Kepala Desa (desa) | staff account |
| 9 | `ADMIN` | Region Admin | Admin penyelenggara jalan: Bagian Umum & TU (Balai), Sekretariat Dinas, Pusdatin Bina Marga (DKI); or PAVEMENT-PINN operator staff during a pilot | staff account |

### 2.2 Role cards

Each card: legal basis → real-world duties → in-app duties → cannot do.

#### 1. CITIZEN — Warga
- **Legal basis:** UU 2/2022 Pasal 62(1) (right to give input and obtain information on road administration); PP 34/2006 Pasal 120(1) (right to report misuse of road space); UU 25/2009 Pelayanan Publik and Perpres 76/2013 (complaint management), as cited by Ombudsman RI (note 02 §1); UU 22/2009 Pasal 24 (agency duty to repair "segera dan patut", signage if not yet repaired) gives timestamped reports evidentiary weight (note 04 §1).
- **Real-world duties:** none; rights only.
- **In-app duties:** report with live camera; add witness; confirm repairs at 1/3/6 months and after heavy rain; propose road-status corrections with evidence; claim certificate.
- **Cannot:** close, reassign, merge, see other citizens' identities, see unblurred originals, see provider or official names.

#### 2. FIELD_INSPECTOR — Petugas Inspeksi
- **Legal basis / org anchors:** DKI: Satuan Pelaksana Bina Marga Kecamatan, non-structural unit assisting the Suku Dinas, coordinated by the Camat (Pergub DKI 153/2019 Pasal 37–38) — `TODO_VERIFY(whether Pergub 57/2022 replaced Pergub 153/2019; LKIP 2023 Dinas Bina Marga cites Pergub 57/2022)`. National: Bidang Preservasi of BBPJN/BPJN handles "pengendalian penilikan jalan" (BBPJN Kaltim planning document, note 04 §2); Satker PJN/PPK-per-ruas arrangement `TODO_VERIFY(primary source not retrieved)`. Inspection procedure `TODO_VERIFY(Permen PUPR 13/PRT/M/2011 Tata Cara Pemeliharaan dan Penilikan Jalan, or successor)`.
- **Real-world duties:** site checks (penilikan), condition survey, propose treatment (rutin/berkala/rehabilitasi — PP 34/2006 Pasal 97).
- **In-app duties:** verify on site; measure with marker card and straightedge + ruler (depth typed by inspector, AI cross-checks); trace long damage; run PINN; propose repair type and fair-cost range; follow-up inspections (3 months, heavy rain, pre-FHO); mark hazard.
- **Cannot:** approve own proposal; verify or accept repair work they proposed; close cases.

#### 3. COORDINATOR — Koordinator Pemeliharaan
- **Legal basis / org anchors:** DKI: Bidang Jalan dan Jembatan with Seksi Pemeliharaan (Pergub DKI 153/2019 Pasal 4); Suku Dinas Kota with Seksi Jalan, Jembatan dan Kelengkapan Jalan and Satpel Kecamatan (Pasal 31–38); Posko Dinas Bina Marga 021-3844444 and Pusdatin as intake (Berita Jakarta, 30 Jan 2026). National: Bidang Preservasi (Balai). Regional: Seksi/UPTD pemeliharaan (names vary — model generically, note 04 §4).
- **Real-world duties:** receive complaints, dispatch (disposisi), schedule maintenance, coordinate crews.
- **In-app duties:** triage queue; accept / close invalid; merge duplicates; transfer with SK citation; refer to SP4N-LAPOR!/JAKI when an authority is not onboarded; assign inspector, crew and supervisor; issue internal work orders (not SPK); set public delay reasons (max 3 consecutive); respond to flags; schedule follow-ups; accept swakelola routine work if region config allows.
- **Cannot:** approve plans (APPROVER does); verify work; be crew or supervisor on the same case; accept a case they created as staff (SOD-11).

#### 4. APPROVER — PPK / pejabat berwenang
- **Legal basis:** Perpres 16/2018 jo. Perpres 12/2021 jo. Perpres 46/2025 — PPK Pasal 11 (specifications, draft contract, HPS, contract control; Pasal 11(1)(l) hands results to PA/KPA by berita acara; Sertifikat Kompetensi PPK Pasal 11(2a)); KPA may act as PPK for APBD (Pasal 10(5)); PA/KPA may assign a PPTK to perform PPK duties (Pasal 11(3)–(4)); handover Pasal 57–58; PjPHP/PPHP abolished (Perpres 12/2021). PPTK duties `TODO_VERIFY(Permendagri 77/2020)`. Swakelola: PA designates Penyelenggara Swakelola (Pasal 9(1)(j)). Desa: `TODO_VERIFY(Permendagri 20/2018; LKPP rules on pengadaan desa)`.
- **Real-world duties:** commit budget under a contract; issue work instructions under an existing contract; accept verified work; sign BA serah terima (PHO/FHO).
- **In-app duties:** approve or return repair plans with reason and budget source; accept verified work (record PHO date and maintenance months as INPUT from BA PHO); declare conflicts of interest.
- **Cannot:** approve a plan they proposed or measured (SOD-2); act on packages where linked to the provider (SOD-3); accept work not yet verified by a supervisor (SOD-5).

#### 5. REPAIR_CREW — Penyedia / Tim Pelaksana / PJLP
- **Legal basis:** Penyedia as pelaku pengadaan (Perpres 16/2018 jo. 46/2025); Tim Pelaksana Swakelola (Pasal 16(1)); 4 swakelola types (Perpres 46/2025 Pasal 47); DKI PJLP Bina Marga ~750 workers (IDX Channel, 12 Feb 2026); toll: BUJT responsible for preservasi (Permen PU 2/2025 Lampiran C.1).
- **Real-world duties:** execute works; daily/weekly/monthly reports and 0/50/100% progress photos (Modul 04 Kutai Barat); repair defects at own cost during maintenance period (Modul 04).
- **In-app duties:** stage-gated live-capture evidence (before, cut edges, clean/dry, tack coat, mix temperature, delivery ticket, loose thickness, compaction, after); declared quantities; right of reply on flags concerning their package (as provider representative).
- **Cannot:** verify, accept or close; see other bidders' data; see citizen identities.

#### 6. SUPERVISOR — Konsultan Pengawas / Tim Pengawas Swakelola
- **Legal basis:** Tim Pengawas Swakelola oversees physical and administrative implementation (Perpres 16/2018 jo. 12/2021 Pasal 16(1)); after PPHP removal the PPK may be assisted by tim ahli, tim teknis or konsultan pengawas (Modul 04 Kutai Barat, citing Pasal 8 huruf g). Konsultan pengawas duties and Direksi Teknis `TODO_VERIFY(Permen PUPR 14/2020)`.
- **Real-world duties:** control quality, quantity and time; witness mutual checks (MC-0/MC-100).
- **In-app duties:** check crew evidence item by item; take own on-site after-photo with straightedge; verify or reject work.
- **Cannot:** be the crew or from the crew's organisation (CONTRACT); be the plan proposer; accept (approve) the work.

#### 7. AUDITOR — APIP / BPK / BPKP / independent (+ BPJT, Ombudsman sub-types)
- **Legal basis:** APIP defined in Perpres 46/2025 Pasal 1 angka 22 ("audit, reviu, pemantauan, evaluasi, dan kegiatan pengawasan lain"); Inspektorat Jenderal is an eselon I unit of Kementerian PU (Perpres 170/2024 Pasal 7); regional Inspektorat audit (incl. Dana Desa, KPK deck 2020); BPK physical-testing practice (BPK Malut Buku Saku). BPK/BPKP statutory bases `TODO_VERIFY(UU 15/2006; Perpres 192/2014)`; APIP independence `TODO_VERIFY(PP 60/2008 SPIP)`. BPJT sits under and reports to the Minister and supervises toll concessions (Permen PU 2/2025 Pasal 1 angka 7). Ombudsman as escalation body (UU 37/2008, as cited by Ombudsman RI).
- **Real-world duties:** sample-based physical tests (uji petik), findings expressed as indications until agreed; recommendations.
- **In-app duties:** read everything in scope incl. full event chain and verification status; request originals (logged); create neutral flags on case/segment/package; export audit bundles; generate audit reports.
- **Cannot:** any operational action; hold an operational role in the same authority (SOD-8); `TOLL_REGULATOR` cannot close/approve BUJT jobs (SOD-9).

#### 8. AGENCY_HEAD — Kepala Dinas / Kepala Balai / Kepala Sudin
- **Legal basis:** PA/KPA (Perpres 16/2018 jo. 46/2025 Pasal 9–10) receives handover from PPK (Pasal 58); DKI Dinas Bina Marga duties (Pergub DKI 153/2019 Pasal 3); Suku Dinas coordinated by Walikota (Pasal 31).
- **Real-world duties:** accountable head; budget owner; answers escalations.
- **In-app duties:** dashboard; receives H+7 escalations; approves 4th+ delay extensions; publishes delay reasons; reads report card; responds to flags.
- **Cannot:** approve plans or accept works in-app unless they also hold an APPROVER assignment (overlap logged, SOD-6).

#### 9. ADMIN — Region Admin
- **Legal basis:** none specific (system role). Org anchors: Bagian Umum dan TU of BBPJN handles leger jalan nasional (BBPJN Kaltim doc, note 04 §2); Pusat Data dan Informasi Bina Marga is a UPT of Dinas Bina Marga DKI (Pergub DKI 153/2019 Pasal 4).
- **In-app duties:** authorities and offices; road-status registry (SK-based, versioned); unit prices, wages, IKK, asphalt prices (each with source + status); users and role assignments (with appointment reference); config (SLA, capture, routing, follow-up).
- **Cannot:** any case transition (SOD-8); grant themselves an operational role (SOD-12).

---

## 3. Permission matrix (action × role)

Legend: **Y** allowed · **S** allowed only within own scope (authority) and/or own assignment · **O** own records only · **C** conditional (see note) · **R** read · **—** denied.

| Action | CIT | FI | CO | AP | RC | SV | AU | AH | AD |
|---|---|---|---|---|---|---|---|---|---|
| `report.create` (live capture) | Y | S | S | — | — | — | — | — | — |
| `report.witness` | Y | — | — | — | — | — | — | — | — |
| `case.read_public` | Y | Y | Y | Y | Y | Y | Y | Y | Y |
| `case.read_full` | O | S | S | S | C¹ | C¹ | S | S | — |
| `case.accept` / `case.close_invalid` | — | — | S | — | — | — | — | — | — |
| `case.merge` | — | — | S | — | — | — | — | — | — |
| `case.transfer` | — | — | S | — | — | — | — | — | — |
| `case.transfer_confirm` (cross-level) | — | — | S² | — | — | — | — | — | S² |
| `case.refer_external` | — | — | S | — | — | — | — | — | — |
| `inspection.assign` | — | — | S | — | — | — | — | — | — |
| `inspection.submit` | — | S (assigned) | — | — | — | — | — | — | — |
| `inspection.verify` / `request_reinspection` | — | — | S | — | — | — | — | — | — |
| `measure.ai_crosscheck` (call) | — | S | S | — | — | S | R | — | — |
| `plan.propose` | — | S (assigned) | — | — | — | — | — | — | — |
| `plan.return` | — | — | S | S | — | — | — | — | — |
| `plan.approve` | — | — | — | S³ | — | — | — | C⁴ | — |
| `work_order.issue` | — | — | S | — | — | — | — | — | — |
| `work.start` / `work.submit_evidence` | — | — | — | — | S (assigned) | — | — | — | — |
| `work.verify` / `work.reject` | — | — | — | — | — | S (assigned) | — | — | — |
| `work.accept` | — | — | C⁵ | S³ | — | — | — | C⁴ | — |
| `case.set_pending` (≤3 consecutive) | — | — | S | — | — | — | — | S | — |
| `case.pending_extend_4th` | — | — | — | — | — | — | — | S | — |
| `case.mark_hazard` | — | S | S | — | S (assigned) | — | — | — | — |
| `followup.citizen_confirm` | O | — | — | — | — | — | — | — | — |
| `followup.record` (inspection) | — | S | — | — | — | S⁶ | — | — | — |
| `case.reopen` (manual) | — | — | S | — | — | — | — | — | — |
| `case.close_monitoring` | — | — | S | — | — | — | — | — | — |
| `flag.create` | — | — | S | — | — | — | S | — | — |
| `flag.respond` (right of reply) | — | — | S | S | O⁷ | — | — | S | — |
| `evidence.request_original` | — | S | S | — | — | — | S | — | — |
| `pinn.run` / `cost.run` | — | S | S | S | — | — | S | R | — |
| `document.audit_report` | — | — | S | — | — | — | S | S | — |
| `document.agency_draft` | — | — | S | — | — | — | S | S | — |
| `document.record_agency_signed` | — | — | S | — | — | — | — | S | — |
| `export.audit_bundle` | — | — | — | — | — | — | S | — | — |
| `dashboard.agency` | — | — | S | S | — | — | S | S | — |
| `registry.status_correction.propose` | Y | S | S | — | — | — | S | S | — |
| `registry.status_correction.decide` | — | — | S⁸ | — | — | — | — | — | Y |
| `registry.manage` / `authorities.manage` | — | — | — | — | — | — | — | — | Y |
| `prices.manage` | — | — | — | — | — | — | — | — | Y |
| `users.manage` / `role_assignment.manage` | — | — | — | — | — | — | — | — | C⁹ |
| `config.manage` | — | — | — | — | — | — | — | — | Y |
| `conflict.declare` (self) | — | Y | Y | Y | Y | Y | Y | Y | Y |
| `certificate.claim` | O | — | — | — | — | — | — | — | — |

Notes: ¹ only cases with a work order assigned to them, and without citizen-identifying data. ² target authority, different person from requester (SOD-7). ³ not proposer, not provider-linked (SOD-2/SOD-3). ⁴ only if the person also holds an APPROVER assignment (overlap logged, SOD-6). ⁵ only `SWAKELOLA` routine work and only if region config `swakelola_accept_role=COORDINATOR`; not crew/supervisor of that order. ⁶ supervisor may record the pre-FHO joint inspection, but the post-repair verifier for M3/HEAVY_RAIN must be a different person from crew and supervisor (SOD-4). ⁷ provider representative only, for flags on their own package. ⁸ coordinator of the target authority. ⁹ cannot assign roles to themselves (SOD-12).

---

## 4. Separation-of-duties rules enforced in code

Implementation: `src/domain/workflow/sod.ts` exports `checkSod(command, case, actor, history, assignments, conflicts) → {ok} | {ok:false, rule, message}`; called inside `applyCommand` before the transition is applied. Identity for SoD is **person** (`persons.id`), not account, so a person with two accounts is still caught.

| Rule | Check (pseudo-code) | Applies to actions | Basis |
|---|---|---|---|
| **SOD-1** Executor ≠ verifier | `person(supervisor) != person(crew)` and, for `CONTRACT`, `org(supervisor) != org(crew)` | `ISSUE_WORK_ORDER`, `VERIFY_WORK`, `REJECT_WORK` | Perpres Pasal 16(1) separate Tim Pelaksana / Tim Pengawas; note 04 SoD-1 |
| **SOD-2** Recommender ≠ approver | `person(approver) ∉ {plan.proposer, inspection.inspector}` | `APPROVE_PLAN`, `ACCEPT_WORK` | shared decision; note 04 |
| **SOD-3** No provider-linked official | `∄ conflict(person(actor), package.provider_org)`; also `org(actor) != package.provider_org` for FI/CO/AP/SV/AU/AH | all case actions on cases linked to a package | Perpres 46/2025 Pasal 7(2) (control of a Penyedia) |
| **SOD-4** Crew ≠ supervisor ≠ post-repair verifier | `person(follow_up.recorder) ∉ {crew, supervisor}` for milestones `M3`,`HEAVY_RAIN`,`EVERY_6M` | `RECORD_FOLLOW_UP` (staff) | shared decision |
| **SOD-5** Acceptance needs prior independent verification | state must be `WORK_VERIFIED` and `work.verified` event by a SUPERVISOR exists | `ACCEPT_WORK` | Perpres Pasal 11(1)(l), 57–58 |
| **SOD-6** Permitted overlaps logged | if actor has `sub_type ∈ {KPA_AS_PPK, PPTK_AS_PPK}` or holds 2 roles in the same authority, event gets `overlap_basis`; AUDITOR dashboard lists all overlaps | all | Perpres 12/2021 Pasal 10(5), 11(3)–(4) |
| **SOD-7** Transfer needs SK citation; cross-level transfer needs second person | `payload.decree_ref` required; if `level(from) != level(to)` then `transfer_confirm` by different person in target authority (COORDINATOR or ADMIN) | `TRANSFER_AUTHORITY` | PP 34/2006 Pasal 62 (status by decree); Batam status-change case (Ombudsman Kepri, 13 Aug 2024) |
| **SOD-8** Auditors and admins never operate | roles `AUDITOR`, `ADMIN` rejected on every transition except flag/export/config endpoints; a person cannot hold AUDITOR and an operational role in the same authority | all transitions; `role_assignment.manage` | APIP independence (inference; `TODO_VERIFY(PP 60/2008)`) |
| **SOD-9** Toll regulator flag-only | `sub_type=TOLL_REGULATOR` may `flag.create`, never close/approve BUJT cases | all | KPK finding: five BPJT officials as BUJT commissioners (IDX Channel, 9 Mar 2023) |
| **SOD-10** Citizen dispute reopens verification | ≥2 independent devices "Damaged again" (or 1 with photo + trust tier 1) within a milestone window → SYSTEM creates inspector follow-up task; confirmation is never required for closure | `RECORD_FOLLOW_UP` (citizen) | note 04 SoD-8 |
| **SOD-11** No self-accept of staff-created reports | if `case.created_by` is staff, `ACCEPT` must be by a different person | `ACCEPT` | design: prevents fabricated cases that justify spending |
| **SOD-12** No self-granting | `role_assignment.created_by != role_assignment.account_id`; APPROVER assignments require appointment reference | `role_assignment.manage` | design |
| **SOD-13** Delay-extension cap | 4th consecutive `SET_PENDING` requires AGENCY_HEAD | `SET_PENDING` | design (anti silent sinking) |

Error format: `{success:false, error:{code:"FORBIDDEN", rule:"SOD-2", message:"You proposed this plan, so you cannot approve it."}}` — plain English, shown as-is in UI.

---

## 5. Where corruption risk sits in the real chain and which control mitigates it

Wording rule: this table describes **risks documented in cases and audits**, not accusations against any role holder. All cases cited are from research note 03 (status: tersangka/terdakwa/terpidana as reported; presumption of innocence applies).

| Stage | Documented risk (examples) | Where it sits (roles) | App control | What the app cannot see (residual) |
|---|---|---|---|---|
| Budgeting / planning | Pre-agreed fees from budget increases or DPRD pokir quotas (OKU 2025, 20% fee; Riau 2025) — note 03 §5 | AGENCY_HEAD (PA), regional political actors | Public, independent **fair-cost range** per case/package; recurrence per segment shows repeated spending | Fees, bribes, budget negotiations |
| Procurement | Rigged tender/e-katalog (Sumut, OKU), fake qualifications (Purbalingga), borrowed companies (Tobasa) | Pokja/UKPBJ, PPK, provider | Package data linked with source (LPSE/SiRUP); **SOD-3** conflict block; auditor flags on package | Tender process itself (out of scope; opentender.net covers procurement-stage risk) |
| Planning of the repair (size) | Over-sized repair or inflated quantities to justify spend; unbalanced unit prices (BPK on PUPR LK 2023) | FIELD_INSPECTOR, APPROVER | Measurements must come from marker card + straightedge/ruler photos (AI cross-check); **SOD-2** recommender ≠ approver; quantities recomputed server-side; fair-cost |diff| > 20% → "needs clarification" | Hidden design changes outside the app |
| Execution | Thinner asphalt than design, missing base layer, wrong prime-coat volumes (Simeulue); material not to spec (Pidie); manual work instead of to-spec (Tobasa); "spec 8 cm, built 5 cm" (ex-KPK investigator opinion) | REPAIR_CREW | Stage-gated live-capture evidence: loose thickness with ruler, mix temperature, tack coat, delivery tickets, roller passes; pHash blocks reused photos | Subsurface density, asphalt content (needs core/lab; recommended, not claimed) |
| Supervision | Consultants failing to control quality/quantity/time (Batu Bara: 4 konsultan pengawas named suspects; Pidie) | SUPERVISOR | **SOD-1** supervisor ≠ crew (person and org); supervisor must take own on-site photo; random inspector follow-ups (**SOD-4**) | Collusion between supervisor and crew that leaves no visual trace |
| Progress certification / PHO / payment | Paid 95–100% at 51–65% physical progress (Simeulue, Mogoy–Merdey); documents pushed to 100% before PHO (Bengkalis); PPTK approving 100% without checking materials (Pidie) | APPROVER, SUPERVISOR, PPTK | **SOD-5** acceptance only after independent verification; hash-chained timeline shows the dates evidence actually arrived; PHO date recorded as INPUT and compared with evidence timeline | Payment records (app does not receive SP2D/termin data) |
| Completion reporting | AI-altered completion photos in JAKI (3 PPSU officers, Apr 2026); "Selesai" self-declared by the same agency graded on it | REPAIR_CREW, COORDINATOR | Live capture only + nonce + server time + pHash; crew cannot close; citizen confirmation at 1/3/6 months; public verify page | Staged real scenes (a real but different patch) — mitigated by GPS/trace and follow-ups |
| Routing / responsibility | Bounced reports: ~95% of Jalan Cantik reports outside provincial authority (Antara Jateng 2019); Klaten–toll letters (detikJateng 2025) | COORDINATOR | SK-based registry routing with confidence; **SOD-7** transfer needs SK citation; transfer time attributed to each authority on report card | Unpublished SKs (LOW confidence shown) |
| Maintenance period | Road sank/cracked after maintenance period (Pidie); toll with 3-month maintenance under investigation (Lampung) | REPAIR_CREW, APPROVER | Maintenance-period tracker; **warranty flag** on early failure inside the period; pre-FHO follow-up timed ≥ 15 days before end (UKPBJ Temanggung guidance) | Whether the guarantee was actually claimed |
| Fail → re-budget loop | Same road re-worked 3 years running; bridge collapsed ~6 months after build (OCP/ICW 2025); Alor hotmix cracked 1–2 days after paving | all | Segment repair history, actual life vs PINN P10–P90, recurrence analytics to AUDITOR | Causation (needs technical audit) |
| Toll oversight | Five BPJT officials as BUJT commissioners; no mechanism for repeated BUJT non-compliance (KPK 2023) | AUDITOR (`TOLL_REGULATOR`), BUJT | **SOD-9** regulator flag-only; recurrence per BUJT segment visible to APIP | Concession finances |
| Village roads | Non-transparent / misused Dana Desa (KPK 2020) | Kepala Desa (APPROVER/AGENCY_HEAD), TPK | Same evidence chain; Inspektorat Kabupaten as AUDITOR scope | SISKEUDES data |

---

## 6. Onboarding each role in a new region

Prerequisite: a written pilot agreement or letter with the road authority (no account for an agency is created without it). Steps are run by the PAVEMENT-PINN operator first, then handed to the region's ADMIN.

| Step | Role | What happens | Done when |
|---|---|---|---|
| 1 | ADMIN | Create region (`regions` from Kemendagri codes + boundaries). Import authority tree and offices (directory from official websites; coordinates only if published). Mark `onboarded=true` only for agencies that signed. | Authority tree visible on map legend; non-onboarded authorities route to `REFERRED_EXTERNAL` |
| 2 | ADMIN | Import road-status registry: national (Kepmen PUPR 1688/KPTS/M/2022 lampiran, matched to OSM), toll (BPJT list), provincial (Kepgub lampiran), kab/kota (SK Bupati/Walikota), else heuristic with LOW confidence. QA: km totals per status vs official totals (Buku Kondisi Jalan Nasional; Satu Data/BPS). | Each segment has status + source + confidence; QA report stored |
| 3 | ADMIN | Load prices: UMP/UMK 2026, BPS IKK multiplier, Pertamina asphalt by supply point, HSPK/SSH where published; AHSP coefficients from SE 30/SE/Dk/2025 Lampiran V (status OFFICIAL only when transcribed from the document with page ref; else TODO_VERIFY). | Fair-cost run shows no unlabeled input |
| 4 | ADMIN | Configure SLA targets, delay-reason caps, follow-up schedule, capture thresholds, `swakelola_accept_role`. | Config versions logged |
| 5 | COORDINATOR | Agency nominates by letter; ADMIN creates account with `appointment_ref`; coordinator does 30-min training (triage, merge, SK-based transfer, delay reasons). | First 10 triaged cases reviewed by operator |
| 6 | FIELD_INSPECTOR | Account per Satpel/UPTD staff; issue kit: printed marker cards (ArUco 200×200 mm, matte, rigid), 1.2 m straightedge, steel ruler/depth gauge, measuring tape; training on depth photo angle (30–45°) and marker placement. | 3 supervised practice inspections pass checks |
| 7 | APPROVER | Account only with appointment reference (SK penunjukan PPK / KPA-as-PPK / PPTK-as-PPK) and `sub_type`; mandatory conflict declaration at first login. | Declaration on file |
| 8 | SUPERVISOR | Account for konsultan pengawas firm staff or Tim Pengawas Swakelola members; organisation recorded (enables SOD-1 org check); conflict declaration. | Linked to packages |
| 9 | REPAIR_CREW | Provider accounts created per package (organisation = provider entity); swakelola/PJLP crews per unit; training on stage-gated capture. | First work order evidence complete |
| 10 | AGENCY_HEAD | Account for Kepala Dinas/Balai/Sudin (or delegate per Permendagri 1/2023 Pasal 65 delegation practice — inside the app this is just a role assignment); dashboard walkthrough. | Receives first H+7 digest |
| 11 | AUDITOR | Invite Inspektorat (APIP) of the same government level; optional independent witness (university/NGO) as `INDEPENDENT` who co-signs checkpoints; BPJT for toll regions. | Auditor can verify chain end-to-end |
| 12 | CITIZEN | Public launch only after steps 1–7; onboarding 3 screens (skippable), DEMO mode off. | — |

Jakarta first: Dinas Bina Marga DKI → 6 Suku Dinas (Jakarta Pusat, Utara, Barat, Selatan, Timur, Kepulauan Seribu) → Satpel per kecamatan; national segments → BBPJN DKI Jakarta–Jawa Barat (seat Bandung); toll → BUJT per ruas with BPJT as `TOLL_REGULATOR`. Most non-toll roads in DKI appear provincial (Satu Data Jakarta 2025 status table); the national list is `TODO_VERIFY(Kepmen 1688/KPTS/M/2022 lampiran)`.

---

## 7. Mapping to the current repo

| v4 key | v4 label | v5 key |
|---|---|---|
| `PUBLIC_REPORTER` | Warga | `CITIZEN` |
| `PUBLIC_VIEWER` | Publik | (no role) |
| `FIELD_ENGINEER` | Petugas Lapangan | `FIELD_INSPECTOR` |
| `OPERATIONS_MANAGER` | Koordinator | `COORDINATOR` |
| `POLICY_MAKER` | Pimpinan Instansi | `AGENCY_HEAD` |

v4 behaviours that change: OPERATIONS_MANAGER used to approve actions and resolve work → now APPROVER approves, SUPERVISOR verifies, APPROVER/COORDINATOR accepts; FIELD_ENGINEER used to submit repair evidence → now REPAIR_CREW.

## 8. Open questions
1. Official English names: check LKPP / Kementerian PU English glossaries (note 04 §9 Gaps).
2. PPK competency certificate (Pasal 11(2a)) — can it be checked against an LKPP registry? Unknown.
3. Jakarta: role of PPSU kelurahan and Dinas SDA (drainage) relative to Bina Marga `TODO_VERIFY`.
4. Desa: TPK (Tim Pelaksana Kegiatan) role and approval chain `TODO_VERIFY(Permendagri 20/2018)`.
5. National: Satker PJN / PPK per ruas structure for BBPJN DKI–Jabar (8 satker listed, none DKI-specific) `TODO_VERIFY`.
