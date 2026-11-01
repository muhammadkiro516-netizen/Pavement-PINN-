# 07 — Audit Integrity, Documents and Legal Wording (v5)

> Research basis: note 08 (audit, integritas, dokumen), note 03 §8 (legal language), note 04 (roles). Templates: `templates/audit_report_independent.html`, `templates/draft_for_agency.html`.
> Rule: the event log is the **single source of truth**. Documents are rendered only from a checkpointed snapshot of that log, never from editable fields.
> Legal disclaimer for the team: the legal analysis below summarises research notes; it is **not legal advice**. Before production, Indonesian counsel must review kop/lambang use, lawful basis (UU PDP Pasal 20) and defamation exposure (note 08 §9 step 9).

---

## 1. Threat model (what this design must catch)

| # | Threat | Control |
|---|---|---|
| TH-1 | An insider edits or deletes a past event (e.g. moves "accepted" date, removes a rejected-work event) | hash chain + DB grants (no UPDATE/DELETE) + signed checkpoints |
| TH-2 | The operator rewrites the whole chain consistently | daily Merkle root anchored in Bitcoin via OpenTimestamps; checkpoints mirrored to third parties and co-signed by independent witnesses |
| TH-3 | A PDF is altered after issue, or a fake PDF is circulated | SHA-256 of every issued PDF logged as an event; QR → public verify page; PAdES signature |
| TH-4 | A document is mistaken for an official government document | no kop/lambang; "Bukan naskah dinas" banner/footer; agency draft is unbranded and watermarked "DRAF" |
| TH-5 | Personal data becomes undeletable | no personal data in events/checkpoints/anchors; hashes of encrypted/salted blobs only; crypto-shredding |
| TH-6 | Defamation / "fitnah" exposure from wording | neutral wording library; flags attach to case/segment/package; banned-word checker; right of reply |
| TH-7 | Signing key compromise | key rotation event, revocation checkpoint, OTS anchors prove pre-compromise timestamps |

A timestamp proves **existence at a time**, not authorship or truth (OpenTimestamps announcement, Peter Todd 2016). The integrity chain supports the "keutuhan" (integrity) argument, likely through expert testimony; it does not make content true (note 08 §5).

---

## 2. Event log design

### 2.1 Event schema (stored row = `events` table, `02_SPEC_v5.md` §7.6)
```json
{
  "v": 1,
  "chain_id": "prod",
  "seq": 18452,
  "event_id": "0f8e8b4e-6f4a-4a58-9a8e-2d3c1d0b7c11",
  "type": "work.verified",
  "entity": { "type": "case", "id": "CASE-3f9a1c0d2b7e4a61" },
  "actor": { "ref": "staff:9c1e…(HMAC)", "role": "SUPERVISOR", "kind": "ACCOUNT", "overlap_basis": null },
  "server_received_at": "2026-11-01T03:15:22.481Z",
  "payload": { "...": "type-specific, no personal data" },
  "payload_sha256": "…",
  "refs": { "evidence_sha256": ["…"], "corrects_event_hash": null, "prev_state": "WORK_SUBMITTED", "next_state": "WORK_VERIFIED" },
  "prev_hash": "…64 hex…",
  "event_hash": "…64 hex…",
  "sig": { "alg": "Ed25519", "key_id": "srv-2026-01", "value": "base64…" }
}
```

Field rules:
- `actor.ref`: staff → `staff:` + HMAC-SHA256(`log_pepper`, account_id) hex; citizen → `dev:` + HMAC(`log_pepper`, device_id); system → `system:<job>`. The mapping table (`actor_refs`) is off-chain, access-controlled, and deletable (crypto-shredding the pepper-derived link for a deleted citizen keeps the chain valid).
- `payload`: only IDs, codes, numbers, hashes, enums and **moderated** free text that passed the personal-name/banned-word checker. Never: names, phone numbers, NIK, raw GPS of the reporter's trace (the case's snapped damage location is allowed — it is a road location, not a person's).
- Coordinates in payloads are integers in micro-degrees (`lat_e6`, `lon_e6`) to avoid cross-language float serialisation differences.
- Money is integer rupiah; percentages are integer basis points; measurements are integers in the smallest unit (mm, cm², g) with explicit unit.

### 2.2 Event types (minimum set)
`case.submitted`, `case.screening_started`, `case.screened`, `case.duplicate_suggested`, `case.accepted`, `case.merged`, `case.transfer_requested`, `case.transfer_confirmed`, `case.referred`, `case.closed`, `case.reopened`, `case.pending_set`, `case.hazard_marked`, `inspection.assigned`, `inspection.submitted`, `inspection.reinspection_requested`, `inspection.verified`, `measurement.recorded`, `plan.proposed`, `plan.returned`, `plan.approved`, `work_order.issued`, `work.started`, `work.stage_evidence`, `work.submitted`, `work.rejected`, `work.verified`, `work.accepted`, `follow_up.scheduled`, `follow_up.recorded`, `flag.created`, `flag.state_changed`, `response.added`, `cost.estimated`, `pinn.run`, `document.issued`, `document.superseded`, `document.agency_signed`, `export.created`, `evidence.original_accessed`, `registry.status_versioned`, `registry.correction_decided`, `config.changed`, `role.assigned`, `role.revoked`, `conflict.declared`, `correction.recorded`, `key.rotated`, `key.revoked`, `migration.started`, `migration.note`, `demo.seeded`.

### 2.3 Append-only enforcement
- PostgreSQL: application role has `INSERT, SELECT` on `events` only; `REVOKE UPDATE, DELETE, TRUNCATE`; trigger `BEFORE UPDATE OR DELETE ON events → RAISE EXCEPTION`. Superuser access is itself a risk → covered by external anchoring (TH-2).
- File store (demo/pilot): `.data/events/<chain_id>.jsonl` append-only, one canonical JSON per line, `fsync` after each append; the chain head (`seq`, `event_hash`) also stored in the existing workflow store write so a crash between writes is detected on startup (`startup integrity check`: recompute last 1,000 hashes; full check nightly).
- Single writer per chain: Postgres advisory lock `pg_advisory_xact_lock(hashtext(chain_id))` in the same transaction as the state change, so `seq` and `prev_hash` are gap-free.

---

## 3. Canonical JSON and the hash chain

### 3.1 Canonicalisation
- **RFC 8785 JSON Canonicalization Scheme (JCS)**: sorted keys by UTF-16 code units, no insignificant whitespace, ECMAScript number serialisation, UTF-8. (Note 08 §9 marks JCS as background; implement against the RFC test vectors.)
- Node: use a maintained JCS implementation (e.g. the `canonicalize` npm package) **pinned to an exact version** that is at least two weeks old at implementation time; Python verifier: equivalent JCS implementation pinned likewise. CI test: both produce byte-identical output on a shared fixture set (`tests/fixtures/jcs/*.json`).
- Reject payloads containing floats where an integer unit is specified (§2.1).

### 3.2 Hash computation
```
body        = event without fields {event_hash, sig}
event_hash  = SHA-256( UTF8("PPINN-EVT-v1\n") || JCS(body) )          -- hex lowercase
prev_hash   = event_hash of seq-1 in the same chain_id; genesis = "0"*64
sig.value   = Ed25519_sign(server_key[key_id], bytes(event_hash))
payload_sha256 = SHA-256( JCS(payload) )
```
The domain-separation prefix prevents a document hash or leaf hash being confused with an event hash.

### 3.3 Verification algorithm (used by API, verify page, auditor script)
1. For seq = 1..N: recompute `event_hash` from `body`; compare; check `prev_hash == previous.event_hash`; verify `sig` with the public key for `key_id` valid at `server_received_at`.
2. For each checkpoint: recompute Merkle root over `[first_seq, last_seq]` (§4); check checkpoint signature; check `prev_checkpoint_hash`.
3. For each anchored checkpoint: verify OTS proof (§5).
Output per event: `OK | HASH_MISMATCH | LINK_BROKEN | BAD_SIGNATURE | NOT_YET_CHECKPOINTED`. The first failing `seq` is reported.

Deliverables: `server/integrity/{canonical.ts, chain.ts, merkle.ts, checkpoint.ts, ots.ts}`, `scripts/verify-chain.ts` (Node), `tools/verify_chain.py` (standalone, stdlib + pinned JCS + `cryptography` for Ed25519) for auditors who do not trust our code path.

---

## 4. Checkpoints (daily Merkle root)

### 4.1 Merkle tree (RFC 6962 style)
```
leaf(e)      = SHA-256( 0x00 || bytes(e.event_hash) )
node(l, r)   = SHA-256( 0x01 || l || r )
MTH(D[n])    = for n > 1: k = largest power of 2 < n; node(MTH(D[0:k]), MTH(D[k:n]))
```
Inclusion proof = audit path per RFC 6962 §2.1.1 (RFC 6962/9162 not fetched in research — implement from the RFC text and test against its examples).

### 4.2 Checkpoint record
| Field | Meaning |
|---|---|
| `chain_id` | `prod` or `demo` |
| `period` | `daily:2026-11-01` (WIB, UTC+7) or `adhoc:<iso time>` |
| `first_seq`, `last_seq`, `tree_size` | contiguous seq range covered |
| `merkle_root` | MTH over leaves of that range |
| `prev_checkpoint_hash` | SHA-256 of previous checkpoint's signed text (checkpoint chain) |
| `created_at` | server time |
| `sig` | Ed25519 by operator key over the signed text |
| `witness_sigs[]` | optional co-signatures by `INDEPENDENT` auditors (university/NGO/journalist) |
| `ots_proof`, `ots_status`, `bitcoin_block_height` | §5 |
| `tsa_token` | optional RFC 3161 (§6) |

Signed text (stable, line-based):
```
pavement-pinn checkpoint v1
chain: prod
period: daily:2026-11-01
range: 18001-18452
root: <hex>
prev: <hex>
time: 2026-11-01T17:05:00Z
```
`checkpoint_hash = SHA-256(signed text)`.

### 4.3 Schedule
- **Daily job** `server/jobs/checkpointJob.ts` at **00:05 WIB** covers all events since the last checkpoint.
- **Ad hoc checkpoint** before any document is issued whose relied-upon events are not yet checkpointed (note 08 §9). The next daily checkpoint starts after it.
- DEMO chain gets its own checkpoints, never anchored to Bitcoin (labelled DEMO), so demo cannot be mistaken for production.

### 4.4 Publication
- Public verify page lists checkpoints by date.
- Mirror: public Git repository `pavement-pinn-checkpoints` with `checkpoints/YYYY/MM/DD.json` + `.ots` files (a third-party copy, e.g. GitHub, makes silent rewriting visible).
- Invite 1–2 independent witnesses to co-sign daily (script `tools/witness_cosign.py` verifies chain then signs).

---

## 5. OpenTimestamps anchoring job

| Item | Spec |
|---|---|
| What is stamped | `checkpoint_hash` (32 bytes) — nothing else |
| Tool | OpenTimestamps client (Python `opentimestamps-client` or JS `javascript-opentimestamps`), **exact version pinned**, ≥ 2 weeks old at implementation |
| Stamp | `ots stamp` equivalent: submit digest to ≥ 2 public calendars (client default); store returned incomplete `.ots` proof in `checkpoints.ots_proof`; `ots_status=PENDING` |
| Upgrade job | `server/jobs/otsUpgradeJob.ts` hourly: `upgrade` each PENDING proof; when a Bitcoin attestation appears, store upgraded proof, `ots_status=UPGRADED`, `bitcoin_block_height` |
| Expected latency | stamp ~1 s; confirmation "a few hours" (OpenTimestamps announcement) |
| Alert | PENDING > 24 h → ADMIN alert; retry with other calendars |
| Cost | free (one Bitcoin tx shared by many stamps) |
| Verification | full: local Bitcoin node (`ots verify`); verify page: check proof path to the block's Merkle root using a block header from ≥ 2 independent public sources, and say so ("verified with block headers from X and Y; for full verification run your own Bitcoin node") |
| Known limits | public calendars are a central point of failure until the proof is upgraded; self-hosting a calendar is possible later |

Why not a smart-contract chain or permissioned ledger: little gain over OTS for anchoring, adds key management, fees and a "crypto" perception risk; the WEF/Colombia pilot judged blockchain procurement "equivocal" and flagged spam, anonymity and integration problems (note 08 §4). In pitch language: "we use Bitcoin only as a public clock for one hash per day".

---

## 6. Optional RFC 3161 timestamp

- Off by default (`config/integrity.json: tsa.enabled=false`).
- When enabled: request a TimeStampToken over `checkpoint_hash` from a configured TSA; store DER token in `checkpoints.tsa_token`; verify page shows TSA name and time.
- Provider: **`TODO_VERIFY(Komdigi PSrE list — whether BSrE or a licensed non-state PSrE offers RFC 3161 TSA, and cost)`**. Free public TSAs were not verified in research.
- Value: familiar to lawyers and PKI auditors; complements OTS (different trust model).

---

## 7. Verify endpoint and public verify page

### 7.1 Endpoints (see `02_SPEC_v5.md` §6.7)
- `GET /api/public/verify/:docId` → `{doc_id, kind, version, issued_at, sha256_unsigned, sha256_signed, superseded_by, snapshot:{chain_id, last_seq, root, checkpoint_period}, inclusion_proofs:[{event_hash, seq, audit_path}], checkpoint:{signed_text, sig, key_id, witness_sigs}, ots:{status, block_height}, tsa?, is_demo}`.
- `GET /api/public/events/:hash/proof` → inclusion proof only (payload never public; only `event_hash`, `seq`, `type`, `server_received_at`).
- `GET /api/public/checkpoints?date=` → list.
- `GET /api/public/keys` → operator public keys with validity windows and revocations.

### 7.2 Page `/verify` and `/v/:docId` (QR target)
| Step | Behaviour |
|---|---|
| 1 | Opened from QR (`https://<verify-domain>/v/<doc_id>#<first 16 hex of sha256>`) or by typing a document ID |
| 2 | User may drop the PDF: SHA-256 computed **in the browser** (Web Crypto); file never uploaded |
| 3 | Page compares with `sha256_unsigned`/`sha256_signed`; shows ✓ "This file matches the issued document" or ✗ "This file is different from the issued document" |
| 4 | Shows version; if superseded: "A newer version exists: DOC-…-v3" |
| 5 | Verifies checkpoint signature client-side with published key; verifies inclusion proofs; shows OTS status (Pending / Anchored in Bitcoin block N) |
| 6 | DEMO documents: banner "This is a demo document. Not real data." |
| 7 | Plain language: "What this proves: the document has not changed since <time>, and the records it uses were in our log at that time. What it does not prove: that the observations are correct — agencies verify on site." |

QR label on documents: **"Verifikasi integritas laporan PAVEMENT-PINN"**. Never styled like a government TTE QR (Permendagri 1/2023 Pasal 45 TTE QR shows signer name and position; ours must not imitate it).

---

## 8. Corrections, retractions and right of reply

- **Never edit, never delete.** A wrong value is fixed by a `correction.recorded` event: `{corrects_event_hash, field_path, old_value_hash, new_value, reason, by_role}`. The current-state projection applies corrections in order; the history view shows both.
- Allowed correctors: the role that created the original event, or COORDINATOR/ADMIN within scope; AUDITOR may only propose (`flag.created` with code `DATA_CORRECTION_REQUESTED`).
- Withdrawn flag: `flag.state_changed → WITHDRAWN` with reason; stays visible to AUDITOR.
- **Documents:** any correction affecting an issued document triggers re-issue as a new version; the new PDF prints "Menggantikan versi DOC-…-v1 tanggal …" and the old document's verify page shows "superseded". `document.superseded` event links both.
- **Right of reply:** agency, approver or provider representative responses are `response.added` events and are printed in the next document version under "Tanggapan pihak terkait" (good-faith evidence; note 08 §7).
- **Key compromise:** `key.revoked` event + immediate ad hoc checkpoint + OTS stamp; events signed after the revocation time with the old key are invalid; earlier ones remain trustworthy because their checkpoints were anchored before revocation.

---

## 9. What goes where (on-chain vs off-chain)

| Data | Bitcoin (via OTS) | Public checkpoint mirror | `events` (append-only) | Evidence store | Personal-data stores (deletable) |
|---|---|---|---|---|---|
| Checkpoint digest (32 B) | ✓ (aggregated by calendar) | ✓ | – | – | – |
| Merkle roots, signatures, seq ranges | – | ✓ | – | – | – |
| Event hashes, types, times | – | inclusion proofs on request | ✓ | – | – |
| Event payload (codes, IDs, numbers, hashes, moderated text) | – | – | ✓ (staff/auditor read) | – | – |
| Photo blobs (blurred public) | – | – | SHA-256 only | ✓ | – |
| Photo originals (encrypted) | – | – | SHA-256 of ciphertext only | ✓ (encrypted; key deletable) | key in KMS |
| Damage location (snapped to road) | – | – | ✓ (micro-degrees) | – | – |
| Citizen trace polyline | – | – | hash only | ✓ | – |
| Device ID ↔ pseudonym, phone HMAC | – | – | – | – | ✓ |
| Certificate display name | – | – | salted hash only | – | ✓ |
| Staff names, NIP hash, account ↔ actor_ref | – | – | – | – | ✓ (access-controlled) |
| Provider entity names (from public LPSE/SiRUP data) | – | – | package id only | – | package table (internal; not public pages) |

Rule: deleting personal data never breaks the chain, because the chain only commits to hashes of salted/encrypted blobs (crypto-shredding; note 08 §6).

---

## 10. Retention (proposal — confirm in the DPIA, UU 27/2022 Pasal 16(2)(g), 34)

| Data | Proposed retention | Deletion method |
|---|---|---|
| Events, checkpoints, OTS proofs | permanent (integrity record; no personal data) | none |
| Public blurred photos | while the case or its repair record is monitored + 5 years | delete blob (hash stays) |
| Encrypted originals | 12 months after case `CLOSED` (or earlier on request unless an open audit flag/legal hold exists) | delete data key (crypto-shred) |
| Citizen trace polylines | 12 months after case `CLOSED` | delete |
| Device ↔ pseudonym link, phone HMAC | 24 months after last activity, or on request | delete |
| Certificate names | until the citizen deletes, or 5 years | delete; certificate verify page shows "revoked" |
| Staff account data | duration of assignment + period required by the agency's own archive rules `TODO_VERIFY(JRA / agency retention schedule)` | delete/anonymise |
| Issued documents (PDF) | permanent for audit reports (no personal data by design); agency drafts 24 months | delete file (hash stays) |
| Server logs with IP | 30 days | rotate |

All values are proposals, not legal requirements. Publish the final table in the privacy notice.

---

## 11. PDF generation (two outputs)

### 11.1 Common pipeline (deterministic)
1. `POST /api/documents/{audit-report|agency-draft}` → server ensures an ad hoc checkpoint covers all relied-upon events → snapshot `(chain_id, last_seq, root)`.
2. Build a **view model** only from events up to `last_seq` (projection code, not editable fields). Numbers are inserted by code; optional GenAI text (Qwen2.5 local) only for narrative sentences, labelled "Disusun dengan bantuan AI — telah ditinjau oleh <role>" and checked by the number/word checker (fails twice → template text).
3. Render `templates/*.html` with a logic-less renderer: scalar placeholders `{{name}}` are HTML-escaped; block placeholders ending in `_rows`, `_table`, `_list`, `_block` (e.g. `{{timeline}}`, `{{cost_table}}`) are HTML fragments **built by code from escaped values** — never raw user text.
4. Print with headless Chromium (pinned version) using CSS `@page` A4; embed fonts (Barlow / Barlow Condensed, SIL OFL — include licence); set PDF metadata `CreationDate`/`ModDate` = snapshot time, fixed `Producer`, document ID = `doc_id`; no random elements → same snapshot + same template version = same bytes (CI test).
5. Compute `sha256_unsigned`; log `document.issued` with `{doc_id, kind, version, template_id, template_sha256, snapshot, sha256_unsigned, case/package id}`.
6. **Independent report only:** apply PAdES signature with the operator's certificate from a licensed Indonesian non-state PSrE (`TODO_VERIFY(provider, cost, PAdES profile support)`); compute `sha256_signed`; log `document.signed`. If no PSrE certificate yet, the PDF is issued unsigned and says "Belum ditandatangani secara elektronik; keaslian dapat diperiksa melalui kode QR."
7. QR encodes the verify URL (§7.2).

### 11.2 Output A — Independent Repair Audit Report (`templates/audit_report_independent.html`)
- PAVEMENT-PINN letterhead: product name, operating entity name (`{{operator_entity}}` — legal entity `TODO_VERIFY` with the team), address, website, report ID. **No lambang negara/daerah, no government kop.**
- Banner and footer: **"Dokumen ini bukan naskah dinas dan tidak diterbitkan oleh instansi pemerintah."**
- Addressed to the responsible agency using the per-location directory (name, address, contacts) — directory data is used to **address**, never as the document's own kop (note 08 §1).
- Sections: identity of report; road segment & authority (status, SK basis, routing confidence); chronology (timeline); field findings (measurements with status labels and uncertainty); fair-cost range with all inputs and statuses; contract stage (pre-PHO / maintenance period / post-FHO / unknown) with sources; durability: actual vs PINN P10–P90; indications ("catatan indikasi"); recommended verification by the authority (core drill, density ≥ 98%, thickness); responses (right of reply); integrity evidence (hashes, root, OTS); disclaimer; method notes; AI-assist label.

### 11.3 Output B — Draft for agency (`templates/draft_for_agency.html`)
- **Unbranded**: no PAVEMENT-PINN logo/letterhead. Blank kop area "[KOP INSTANSI]" for the agency to place its own kop.
- Watermark on every page: **"DRAF — tidak sah tanpa penomoran dan penandatanganan pejabat berwenang"**.
- Layout follows Permendagri 1/2023 element order for a *berita acara* (naskah dinas khusus, Pasal 14 huruf d): Nomor / Sifat / Lampiran / Hal left blank; place, date, parties, observations per segment/STA, conclusion as indications, signature block with placeholder "[Tanda Tangan Elektronik — BSrE]".
- Export formats: PDF (watermarked), DOCX (same content, editable by the agency), JSON (structured data + evidence bundle hash) for import into the agency's own TNDE system (SRIKANDI is the likely target — background, unverified).
- After the agency signs in its own system, the agency (COORDINATOR/AGENCY_HEAD) may register the signed file's hash: `document.agency_signed` event (`agency_doc_number` optional). We store only the hash.

### 11.4 Placeholders (both templates)
| Placeholder | Source (projection) | Escaped? |
|---|---|---|
| `{{doc_id}}`, `{{doc_version}}`, `{{supersedes_line}}` | documents | scalar |
| `{{case_id}}`, `{{public_code}}` | cases | scalar |
| `{{issued_at_wib}}` | snapshot time, WIB, Indonesian date format | scalar |
| `{{road_name}}`, `{{segment_id}}`, `{{road_status}}`, `{{status_basis}}`, `{{routing_confidence}}`, `{{sta_or_coordinates}}` | registry + case | scalar |
| `{{authority_name}}`, `{{authority_address}}`, `{{authority_contact}}`, `{{authority_level}}` | authorities directory | scalar |
| `{{timeline}}` | events → `<tr>` rows (time, step, role, evidence count) | fragment |
| `{{measurement_table}}` | measurements → rows with status + uncertainty | fragment |
| `{{cost_table}}` | cost_estimates → rows (AHSP item, quantity, unit price range, status, source) | fragment |
| `{{cost_summary}}`, `{{reported_spend}}`, `{{cost_diff_line}}` | cost_estimates | scalar |
| `{{contract_stage_block}}` | packages (stage, PHO, maintenance end, sources) | fragment |
| `{{durability_block}}` | repair_records + pinn_runs | fragment |
| `{{indication_list}}` | flags → neutral wording library lines | fragment |
| `{{recommendation_list}}` | rule-based (08 §6) | fragment |
| `{{response_list}}` | responses | fragment |
| `{{evidence_hashes}}` | evidence SHA-256 (public + enc) rows | fragment |
| `{{snapshot_root}}`, `{{snapshot_range}}`, `{{checkpoint_period}}`, `{{ots_status}}` | checkpoints | scalar |
| `{{verify_qr}}` | `<img>` data URI of QR (generated server-side) | fragment |
| `{{verify_url}}` | verify page URL | scalar |
| `{{ai_assist_line}}` | GenAI label or empty | scalar |
| `{{demo_watermark}}` | empty or DEMO watermark element | fragment |
| `{{operator_entity}}`, `{{operator_address}}`, `{{operator_website}}` | config (Output A only) | scalar |
| `{{place_date_line}}`, `{{parties_block}}`, `{{signatory_block}}` | Output B only (blank placeholders by default) | fragment |

---

## 12. Legal constraints

| Instrument | What it says (as found in notes) | Design consequence |
|---|---|---|
| **Permendagri 1/2023** Tata Naskah Dinas Pemda | Two kop types (Pasal 22); Kepala Daerah kop only for naskah signed by the Kepala Daerah (Pasal 23); Perangkat Daerah kop for other authorised officials (Pasal 24); form in lampiran (Pasal 25); numbering per regulation, given by unit tata usaha (Pasal 26, 68(1)(a)); berita acara and laporan are naskah dinas khusus (Pasal 14); electronic naskah: TTE shown as QR with signer name and position, certificate from Indonesian PSrE, no stamp (Pasal 43(2), 45, 46(2)); signing authority follows position, delegation allowed (Pasal 64–65) | Never render a government kop, lambang or number. Agency draft leaves kop/nomor/TTE blank for the agency. Our QR is labelled as integrity check, not a TTE. Lampiran layout `TODO_VERIFY` (not retrieved). Regional Perbup variations exist. |
| **UU ITE Pasal 35 jo. 51(1)** | Manipulating/creating electronic documents so they are treated "seolah-olah data yang otentik"; penalty stated as up to 12 years and/or Rp12 miliar (Hukumonline) | Biggest risk is a document that looks like a signed agency document. "Bukan naskah dinas" banner; DRAF watermark; no imitated TTE QR. |
| **UU ITE Pasal 5** | Electronic information and printouts are valid evidence, an extension of recognised evidence; commentators: valid but rebuttable | Integrity chain = supporting technical evidence, likely via expert; do not claim "legally certified". |
| **PP 71/2019 Pasal 42(1)**; BSrE (Perka LSN 10/2017) | Electronic transactions use certificates from Indonesian PSrE; BSrE serves government agencies | Agency signs its own version with BSrE; operator signs its report with a licensed non-state PSrE (`TODO_VERIFY` provider). |
| **UU 27/2022 PDP** | Principles (Pasal 16(2)), lawful bases (Pasal 20(2)), biometric = specific data (Pasal 4), DPIA (Pasal 34), breach notice 3×24 h (Pasal 46), DPO (Pasal 53; MK 151/PUU-XXII/2024 on Pasal 53(1)(b)), criminal Pasal 65–68 | §9 data placement; §10 retention; blur; consent at certificate claim; DPIA before launch. |
| **UU 1/2024 (UU ITE amendment) Pasal 27A + MK 105/PUU-XXII/2024** (read 29 Apr 2025) | Defamation protects **individuals only**; government agencies, institutions, corporations, professions or positions excluded; delik aduan by the individual; Pasal 45(7) excludes statements in the public interest | Flags target case/segment/package; no individual names; criticism framed as public-interest oversight; right of reply. Named individuals can still complain → never name them. |
| **UU 1/2023 (KUHP 2023, in force 2026) Pasal 240–241** | Publicly insulting the Pemerintah or Lembaga Negara remains an offence (delik aduan by the institution; max 3 years or category IV fine for spreading via IT) | Even institutions must not be insulted: descriptive, evidence-based, neutral language only; no adjectives about intent. |
| **UU 2/2017 Pasal 65** | Provider liable for "kegagalan bangunan" within planned life, max 10 years after final handover | App never labels damage "kegagalan bangunan"; says "kerusakan dini yang perlu dinilai oleh pihak berwenang". |
| UU 24/2009 (Lambang Negara), PP 77/2007 (Lambang Daerah), KUHP forgery articles | **Not verified** in research | `TODO_VERIFY` with counsel before anything shows any emblem. Default: show none. |
| Presumption of innocence | Commonly cited UU 48/2009 Pasal 8(1) and KUHAP — **not verified** | Use the phrase "dengan menghormati asas praduga tak bersalah" without citing an article until verified. |

---

## 13. Neutral wording library

Stored as `config/wording/neutral_v1.json` (IDs referenced by `flags.wording_id`). Placeholders in `«»` are filled by code. Every phrase is descriptive, attaches to a case/segment/package, and asks the authority to verify.

### 13.1 Indication phrases
| ID | Bahasa Indonesia | English | Use when |
|---|---|---|---|
| W-01 | Terdapat indikasi ketidaksesuaian antara kondisi lapangan dan data pekerjaan pada «segmen/paket»; perlu klarifikasi dan pemeriksaan oleh instansi berwenang. | There is an indication of a mismatch between field conditions and works data on «segment/package»; clarification and checking by the competent authority is needed. | generic mismatch |
| W-02 | Estimasi biaya wajar berbeda «x»% dari nilai yang dilaporkan (berdasarkan struktur AHSP dan asumsi yang tercantum; bukan temuan audit). | The fair-cost estimate differs by «x»% from the reported value (based on the AHSP structure and listed assumptions; not an audit finding). | |diff| > 20% |
| W-03 | Kerusakan dini teramati «n» bulan setelah serah terima pertama; berdasarkan data yang tersedia, ruas ini diduga masih dalam masa pemeliharaan. Mohon verifikasi oleh PPK. | Early damage observed «n» months after provisional handover; based on available data this segment may still be in its maintenance period. Verification by the PPK is requested. | warranty flag |
| W-04 | Kerusakan teramati lebih cepat dari rentang umur perkiraan model fisika (P10 «a» bulan); penyebab perlu dinilai melalui pemeriksaan teknis. | Damage appeared earlier than the physics model's expected range (P10 «a» months); the cause needs technical assessment. | actual < P10 |
| W-05 | Bukti foto tahap «tahap» tidak tersedia dalam catatan; mohon konfirmasi pelaksanaan tahap tersebut. | Photo evidence for stage «stage» is not in the record; please confirm this stage was carried out. | missing stage evidence |
| W-06 | Suhu campuran yang tercatat («t» °C) berada di bawah ambang yang dikonfigurasi («th» °C); mohon konfirmasi kesesuaian dengan spesifikasi. | The recorded mix temperature («t» °C) is below the configured threshold («th» °C); please confirm compliance with the specification. | low temperature |
| W-07 | Volume yang dideklarasikan berbeda «x»% dari volume hasil pengukuran; perlu pemeriksaan bersama. | Declared quantity differs by «x»% from the measured quantity; a joint check is needed. | quantity difference |
| W-08 | Pembacaan mistar oleh AI berbeda «d» mm dari nilai yang dicatat petugas; foto perlu diperiksa ulang. | The AI ruler reading differs by «d» mm from the value recorded by the officer; the photo needs a second look. | ruler mismatch |
| W-09 | Ruas ini telah diperbaiki «n» kali dalam «m» bulan terakhir; pola berulang ini direkomendasikan untuk dikaji. | This segment has been repaired «n» times in the last «m» months; this repeating pattern is recommended for review. | recurrence |
| W-10 | Direkomendasikan uji inti (core drill) untuk memeriksa tebal lapisan dan kepadatan (persyaratan ≥ 98% sesuai spesifikasi yang berlaku). | A core-drill test is recommended to check layer thickness and density (requirement ≥ 98% under the applicable specification). | recommendation |
| W-11 | Laporan ini disusun dari data yang dicatat warga dan petugas melalui PAVEMENT-PINN serta data publik yang dirujuk. Laporan ini memuat indikasi kondisi lapangan yang memerlukan verifikasi oleh instansi berwenang, dan bukan merupakan kesimpulan audit, penilaian kerugian negara, maupun tuduhan terhadap pihak mana pun. Seluruh pihak dihormati haknya berdasarkan asas praduga tak bersalah. | This report is compiled from data recorded by citizens and officers through PAVEMENT-PINN and the public data cited. It contains indications of field conditions that require verification by the competent authority, and is not an audit conclusion, an assessment of state losses, or an accusation against any party. Everyone's rights are respected under the presumption of innocence. | standard disclaimer (note 08 §7, adapted) |
| W-12 | Sedang dalam pemeriksaan teknis. | Under technical review. | public view of any open flag |
| W-13 | Instansi menyampaikan tanggapan sebagai berikut: «teks». | The agency responded as follows: «text». | right of reply |
| W-14 | Pengukuran warga bersifat indikatif dan tidak setara dengan hasil uji lapangan. | Citizen measurements are indicative and not equivalent to field test results. | any citizen-derived number |

### 13.2 Banned words and rules (checker: `src/domain/wording/checker.ts`)
- Banned (ID): `korupsi`, `koruptor`, `mark-up`, `markup`, `fiktif`, `maling`, `nakal`, `lalai`, `curang`, `menggelapkan`, `merugikan negara`, `kerugian negara` (as a conclusion), `kelebihan pembayaran` (as a conclusion), `kegagalan bangunan` (as a label), `pasti`, `terbukti` (unless quoting an inkracht court decision with source).
- Banned (EN UI): `corruption`, `corrupt`, `fraud`, `fake work`, `stole`, `negligent`, `proven`.
- No personal names of officials, contractor directors or citizens in any public text or document; refer to roles and entities from public data ("PPK paket «kode»", "penyedia sesuai data LPSE").
- A person may be named only when quoting an official charging/court document, with status (tersangka/terdakwa/terpidana), date, source link, and the presumption-of-innocence line (note 03 §8) — not used in v5 documents.
- Allowed hedges: "indikasi", "diduga" (only with "berdasarkan data yang tersedia"), "perlu klarifikasi", "perlu verifikasi", "direkomendasikan untuk dikaji".
- Distinguish administrative from criminal: a refunded BPK finding is not a crime finding; the app makes neither judgment (note 03 §8).

---

## 14. Acceptance criteria (integrity)
1. **IN-1** Given 1,000 events, when one byte of any stored payload is changed, then `verify-chain` reports `HASH_MISMATCH` at exactly that `seq`.
2. **IN-2** Given a deleted event, then verification reports `LINK_BROKEN` at the next `seq`.
3. **IN-3** Given the same snapshot and template version, when a document is rendered twice, then `sha256_unsigned` is identical.
4. **IN-4** Given a checkpoint, when OTS is upgraded, then the verify page shows the Bitcoin block height and the proof verifies against block headers from two sources.
5. **IN-5** Given a citizen deletion request, when processed, then all chain verifications still pass and no query can return the citizen's name or phone.
6. **IN-6** Given any generated document or flag text, when checked, then zero banned words and zero personal names are present (unit test with fixtures).
7. **IN-7** Given a DEMO case, then its events are in `chain_id=demo`, its documents carry the DEMO watermark, and its checkpoint is never sent to OpenTimestamps.
8. **IN-8** Given a correction, then the original event remains, the projection shows the new value, and the next document version prints "Menggantikan versi …".
