# Shared product decisions for DevPack v5 (fixed — all writers must follow)

Product: PAVEMENT-PINN — "Report · Escort · Audit". Citizen road-damage reporting PWA + field inspection + physics-informed repair decision + cost fairness check + tamper-evident audit trail. Intel AI Global Impact Festival 2026 Stage 3 finalist (Indonesia). Team: Muhammad Salman Al Farisi (lead), Farrel Chandra Berwyn (developer), Muhammad Ibnu Riyansyah.
Existing stack (keep): React 19 + Vite PWA, Express (TypeScript) API with state machine/RBAC/audit log, Python FastAPI inference service with OpenVINO (YOLOv8n detect, YOLOv8s-seg, CLIP INT8, PINN-2 surrogate, Qwen2.5-1.5B INT4 via OpenVINO GenAI). Repo snapshot: /home/claude/deck/repo/r (read PROGRESS.md, SPEC.md). Earlier specs: /home/claude/doc/out/SPEC.md, V4_SPEC.md, AGENTS.md.

## Core pitch (one sentence)
PAVEMENT-PINN connects a citizen's verified photo to the agency legally responsible for that road, keeps the case visible until it is repaired, and checks — with physics and a fair-cost estimate — whether the repair was the right size, the right price, and actually lasted.
Position it as a layer that FEEDS existing channels (SP4N-LAPOR!, JAKI/CRM), not "yet another inbox".

## Roles (final, 9) — English name (Indonesian equivalent)
1. CITIZEN — Citizen (Warga). No login. Pseudonymous device ID; optional phone OTP for higher trust; name asked only when claiming a certificate.
2. FIELD_INSPECTOR — Field Inspector (Petugas Inspeksi: staf Satpel/UPTD/Satker PJN). Verifies on site, measures (ruler-in-photo for depth), runs PINN analysis, proposes repair type + fair-cost estimate.
3. COORDINATOR — Maintenance Coordinator (Koordinator Pemeliharaan: Kasi Pemeliharaan Sudin/UPTD/Satker). Triage queue, merge duplicates, transfer to correct authority (must cite road SK), assign inspector/crew, schedule follow-ups.
4. APPROVER — Approving Officer (PPK / pejabat berwenang). Approves repair plan & budget. Must not be the person who recommended it.
5. REPAIR_CREW — Repair Crew (Penyedia/kontraktor or swakelola crew e.g. Pasukan Kuning/UPR). Uploads before/during/after evidence: asphalt temperature photo, delivery/weighbridge tickets, layer thickness with ruler, compaction.
6. SUPERVISOR — Works Supervisor (Konsultan Pengawas / Direksi Teknis / Tim Pengawas Swakelola). Checks repair evidence; cannot be the crew.
7. AUDITOR — Auditor (APIP/Inspektorat, BPK, or independent). Read-only + audit report export + neutral flags.
8. AGENCY_HEAD — Agency Head (Kepala Dinas / Kepala Balai / Kepala Sudin). Dashboard, receives escalations, publishes delay reasons.
9. ADMIN — Region Admin. Configures authorities, road-status registry (SK-based), unit prices/wages, users.
Separation-of-duties rules: recommender ≠ approver; crew ≠ supervisor ≠ verifier; anyone linked to a contractor has no official role on that package; auditors read-only; allowed legal overlaps (e.g., KPA acting as PPK) permitted but logged; transfer requires SK citation.
Demo mapping from the current app: Warga→CITIZEN, Petugas Lapangan→FIELD_INSPECTOR, Koordinator→COORDINATOR, Pimpinan→AGENCY_HEAD; new: APPROVER, REPAIR_CREW, SUPERVISOR, AUDITOR, ADMIN.

## Routing
Road status registry (national/provincial/kabupaten/kota/desa/toll/special) with SK reference and date. Report → snap to nearest road segment (≤ 25 m, configurable) → authority by status → office (BBPJN/BPJN Satker for national; Dinas/UPTD for provincial; Dinas PU/Bina Marga for kab/kota; Sudin Bina Marga by kota administrasi + Satpel by kecamatan in Jakarta; BUJT operator for toll; desa). Fallback: admin boundary + road class heuristic, shown with LOW confidence and "please confirm" to coordinator. Map colors by authority level; confidence shown; correction workflow. Jakarta first (most non-toll roads provincial per Satu Data Jakarta; national list must be verified from Kepmen PUPR 1688/KPTS/M/2022). National road decree = Kepmen PUPR 1688/KPTS/M/2022 (NOT 430/2022).

## Capture & anti-fake
Production: live in-page camera only (getUserMedia), server-issued one-time capture nonce, server timestamp, GPS + accuracy, device motion sample, perceptual-hash duplicate check, EXIF stripped, faces/plates blurred. No gallery upload in production. DEMO MODE (judges): sample photos selectable but every record is stamped "DEMO — not a live capture".
Large/long damage mode: chosen BEFORE capture → "Start" at one end → continuous walked GPS trace → photos every ~15–20 m (no upper limit, minimum 3) → "End". Length from trace; area = length × width (inspector confirms width; default lane width 3.5 m labelled ASSUMED).
Depth: never asked from citizens. Field inspector must take a straightedge + ruler-at-deepest-point photo and type the value; AI reads/cross-checks the ruler; mismatch → flag. Area/width from segmentation + marker card (ArUco/printed card) when available; otherwise reported as a size BAND with uncertainty. Citizen severity = class + size band, never precise cm.

## Cost fairness engine
AHSP-structured (Permen PUPR 8/2023 + SE Dirjen Bina Konstruksi 30/SE/Dk/2025 Lampiran V). Unit price = labor + material + equipment + overhead/profit (default 10%, configurable up to 15%) + PPN 11% effective. Items: 11.1.(9) hot-mix patching (m³), 7.1.(2a) tack coat (L), 7.1.(1) prime coat (L), 7.3.(5a) AC-WC (ton), 7.3.(6a) AC-BC, 6.1.(1)/(2) base A/B (m³), cold-mix/CPHMA items. Coefficients not yet found must be marked TODO_VERIFY with the source to fetch (SE 30/2025 Lampiran V) — never invented. Regional: UMP/UMK 2026 wages, BPS IKK 2025 multiplier, Pertamina asphalt price by supply point, HSPK/SSH where available. Output = fair-cost RANGE + every input with status (MEASURED / OFFICIAL / INPUT / ASSUMED / TODO_VERIFY) + comparison to reported spend: |diff| > 20% → "needs clarification" (neutral).

## Audit integrity
Append-only event log, each event hashed and chained (prev_hash); daily Merkle root anchored with OpenTimestamps (optional RFC 3161 TSA); public verify page; PDF with SHA-256 + QR. Corrections are new events, never edits. Personal data never on-chain/immutable log — hashes only. Two document outputs: (a) "Independent Repair Audit Report" on PAVEMENT-PINN letterhead, marked "Bukan naskah dinas"; (b) unbranded watermarked "Draft for agency" that the agency puts on its own kop, numbers and signs with BSrE TTE. Never generate a government kop/emblem. Neutral BPK-style wording ("temuan", "indikasi", "perlu klarifikasi"), flags attach to the case/segment/package, never to a named person.

## Repair verification (durability)
Photos alone cannot prove durability. Evidence checklist during repair (cut square edges, clean/dry, tack coat, mix temperature photo, thickness ruler, compaction, delivery tickets). Follow-up schedule: 1, 3, 6 months + after first heavy rain + before end of maintenance period (FHO), then every 6 months; citizen + inspector confirmations; PINN gives expected life range (P10–P90) to compare. Early failure inside maintenance period → warranty flag (min. 6 months permanent / 3 months semi-permanent per research notes; mark article TODO_VERIFY). Lab tests (core drill density ≥ 98%, thickness) are recommended to agency, not claimed by the app.

## AI claims (honesty)
CV: detection + segmentation, report mAP/F1 on held-out location-split test incl. Indonesian images (Bandung Pothole set, RDD_Indonesia after dedup check); Ultralytics is AGPL — note license, offer RT-DETR (Apache) path. PINN: present as physics-informed forward surrogate of layered-elastic theory (PyMastic, validated vs KENPAVE) for fast Monte-Carlo life ranges; do NOT claim PINN back-calculation works (2026 paper arXiv 2606.03210 shows PINN inverse fails). GenAI: Qwen2.5 local drafts text only; numbers inserted by code and checked; labelled "Drafted by AI — needs human approval"; never makes technical decisions. Every number in UI labelled MEASURED/INPUT/ASSUMED. Benchmarks so far are on a non-Intel dev laptop → must re-run on Intel Core Ultra (CPU/GPU/NPU) via Intel cloud/borrowed laptop; OpenVINO 2026.4.x.

## UI/UX
Plain English, short sentences (judges must understand instantly). Light theme default (white) with deck palette accents: Asphalt ink 0D1015, Signal yellow FFC72C/E0A100, Cone orange FF7A1A, Hazard red E5391A, Physics cyan 0A9CC2, Intel blue 0068B5, Green 12A06A. Fonts: Barlow Condensed (headings) + Barlow (body). Mascot "Pavi" (traffic-cone robot) with a variant per role. Micro-animations purposeful, respects prefers-reduced-motion. WCAG 2.2 AA, 24×24 px min targets, works on low-end Android, offline queue, ≤ 500 KB photos.

## Gamification (citizen)
Quests (report, confirm a repair at 1/3/6 months, verify duplicates), badges, streaks; certificate (PDF) with name entered at claim time; anti-abuse (rate limit, trust score, no rewards for unverified reports).
