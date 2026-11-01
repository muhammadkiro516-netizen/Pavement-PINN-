# 06 · Cost Engine: what should this repair fairly cost?

**Goal:** for a verified defect, give a **fair-cost range** for the repair, show **every input with its status and source**, and compare it with the reported spend. If they differ by more than 20 %, say **"needs clarification"** and nothing stronger.

**What it is not:** it is not an HPS, not an audit finding and not proof of anything. Only BPK, APIP or the PPK can conclude "kelebihan pembayaran", and only after field measurement (see 08 Audit). The engine says "the estimate differs by X %; please clarify".

Input status labels (shared decisions). Every number in the UI carries one:

| Label | Meaning | Example |
|---|---|---|
| **MEASURED** | Measured on site with evidence | depth from the inspector's ruler photo |
| **OFFICIAL** | Read from a regulation, decree or official list | UMP DKI 2026; OHP 10 %; PPN 11 % |
| **INPUT** | Typed by a responsible user | reported spend from the work order |
| **ASSUMED** | Proxy from a study, another region or common practice | density 2.25–2.34 t/m³; cut margin 30 cm |
| **TODO_VERIFY** | Not yet retrieved; the engine names the source to fetch | AHSP 11.1.(9) coefficients |

Data files: `data/ahsp_items.json`, `data/material_prices.csv`, `data/ump_2026.csv`, `data/umk_2026.csv`, `data/ikk_2025.csv`.

---

## 1. Legal method

| Rule | Value | Source | Status |
|---|---|---|---|
| Method | Permen PUPR 8/2023. Technical annex: SE Dirjen Bina Konstruksi **30/SE/Dk/2025 Lampiran V** (AHSP Bina Marga; 1,723 non-JBH sheets), which replaces the SE 73/2023 annexes | [Permen 8/2023](https://peraturan.go.id/files/permen-pupr-no-8-tahun-2023.pdf); [Kaltim training SE 30/25](https://sibikon-dpuprpera.kaltimprov.go.id/download-materi-acara/PengantarPermenPUPR0823_SEDirjenBinkons3025) | OFFICIAL |
| Unit price | labour + material + equipment (direct), plus Biaya Umum + Keuntungan (OHP) | Permen 8/2023 Ps 11(1) | OFFICIAL |
| OHP | **default 10 %** for Bina Marga items (SE DJBM 01/SE/Db/2019, per training); the Permen allows **10–15 %** of direct cost. Admin may set up to 15 %. An HPS above 15 % is flagged non-compliant. | Permen 8/2023 Ps 11(3); Kaltim training | OFFICIAL (the two sources conflict; 10 % default chosen) |
| Lump-sum items | no OHP in the unit price | Permen 8/2023 Ps 4(3) | OFFICIAL |
| PPN | 12 % nominal × DPP 11/12 = **11 % effective** for non-luxury goods/services | PMK 131/2024 via [DDTCNews 2 Jan 2025](https://news.ddtc.co.id/review/konsultasi/1807964/tarif-ppn-di-2025-jadinya-11-atau-12-begini-ketentuan-terbarunya) | OFFICIAL. Construction and procurement are not explicitly named, and a 2026 PMK omnibus was not read: TODO_VERIFY |
| SMKK | paid as a separate item | Permen 8/2023 Ps 15(2); Permen PUPR 10/2021 | OFFICIAL |
| Wages | UMP **or UMK** "di luar pajak" (upah pokok + tunjangan). Hourly = monthly ÷ (25 days × 7 h) and at least the UMP | Permen 8/2023 Ps 7; Lampiran Permen PUPR 1/2022 | OFFICIAL |
| Spec reference | Spesifikasi Umum 2018 **Revisi 2, Divisi 11 (Pemeliharaan), Seksi 11.1**. Not "Divisi 8", which belongs to Spec 2010 Rev 3. | AHSP Bina Marga Bagian III item list | OFFICIAL (the division chain is inferred from two tables of contents) |

## 2. Formula

```
HSP_i  = ( Σ_k labour_coef_k × wage_k,region,date
         + Σ_k material_coef_k × price_k,region,date
         + Σ_k equipment_coef_k × rate_k,region,date ) × (1 + OHP)

Direct estimate = Σ_i HSP_i × Q_i  (+ SMKK, separate line)
Fair cost       = Direct estimate × (1 + PPN_eff)            # PPN_eff = 0.11
```

**Price selection order** for each basic price `price_k` (labour, material, equipment):
1. Local **HSPK/SSH** of the kab/kota or province for the work date (OFFICIAL). DKI e-HSPK: not yet loaded.
2. Official national list with date (e.g. the Pertamina asphalt price at the nearest supply point).
3. Reference price from another region, scaled by **BPS IKK 2025**: `price_region = price_ref × IKK_region / IKK_ref`, where the IKK reference is Surabaya = 100. This is a fallback only. IKK blends materials, equipment hire and wages across all construction types. Label: ASSUMED.
4. Study value with region and year (ASSUMED).
5. None → line marked TODO_VERIFY and **excluded**, with a warning saying it is excluded.

**Wage rule:**
- If the kab/kota has a UMK, use the UMK. Otherwise use the UMP. DKI uses the UMP (Rp 5,729,876).
- Floor for Pekerja (L.01) = UMK/UMP ÷ 175 per hour (`ump_2026.csv`, COMPUTED).
- Tukang, Kepala tukang, Mandor and Operator come from the local HSPK. The Permen gives **no** multiple of the UMP for them. Until the HSPK is loaded, the engine uses the floor for every labour code, labels it ASSUMED, and warns: "labour likely understated".
- Do not reuse old study wages. For example, Kendari 2023 Pekerja Rp 12,858/h is below every 2026 floor in the table.

**Asphalt price date check:** Pertamina bulk asphalt at RU IV Cilacap went from **Rp 9,400/kg (Mar 2026) to Rp 11,565/kg (Apr 2026)**, +23 % in one month, and Ponorogo recalculated its RABs. Every price has a date. If an estimate or an HPS uses a price dated before the latest Pertamina change, the engine warns. It may also apply an escalation line: Δprice × asphalt kg per ton of mix. This line is ASSUMED.

## 3. AHSP items used

All codes come from the 2022 Bagian III item list and need re-checking against SE 30/2025 (`code_status: TODO_VERIFY`). **No official coefficient has been retrieved yet.** Every official coefficient is `null` + TODO_VERIFY, with source "SE 30/SE/Dk/2025 Lampiran V".

| Code | Item | Unit | Engine use | Coefficients |
|---|---|---|---|---|
| **11.1.(9)** | Perbaikan Campuran Aspal Panas | m³ | **pothole patching (primary)** | TODO_VERIFY |
| 11.1.(10) | … dengan Asbuton | m³ | alternative | TODO_VERIFY |
| 11.1.(11) | CPHMA (Asbuton campuran panas hampar dingin) | m³ | cold-mix patching (semi-permanent) | TODO_VERIFY |
| 7.6.(1) | CPHMA kemasan kantong | ton | bagged cold-mix | TODO_VERIFY |
| 7.1.(2a) | Lapis Perekat (tack coat) | liter | every patch / strip | TODO_VERIFY; **application rate also TODO_VERIFY** |
| 7.1.(1) | Lapis Resap Pengikat (prime coat) | liter | over new base | TODO_VERIFY; Kendari 2023 study set available (ASSUMED) |
| 7.3.(5a) / (5b) | AC-WC / AC-WC Mod | ton | **long-damage strips; per-ton fallback** | TODO_VERIFY; Jagorawi 2021 partial and PNJ 2025 field sets (ASSUMED) |
| 7.3.(6a) | AC-BC | ton | deep patches | TODO_VERIFY; Kendari 2023 (with Asbuton) set (ASSUMED) |
| 7.3.(7a) | AC-Base | ton | reconstruction | TODO_VERIFY |
| 6.1.(1) / (2) | Lapis Fondasi Agregat Kelas A / B | m³ | base repair / reconstruction | TODO_VERIFY; PNJ 2025 field set for A (ASSUMED) |
| 11.1.(4) / (5) | Perbaikan LPA Kelas A / B | m³ | base repair under a patch | TODO_VERIFY (11.1.(4) is duplicated in the source list) |
| — | galian perkerasan / saw-cut (code not identified) | m³ | only if 11.1.(9) excludes cutting | TODO_VERIFY; PNJ 2025 "Galian" field set (ASSUMED proxy) |

**Two calculation routes:**
- **Route A (target): official item.** `Q_pay` (m³) × HSP of 11.1.(9) from the SE sheet, plus 7.1.(2a) tack coat if the sheet excludes it. Loss and berat isi are already inside the official coefficients. Not available until Lampiran V is loaded.
- **Route B (fallback, used now): per ton.** `Q_pay × ρ × loss factor` gives tons, × a per-ton AC-WC unit price, plus a cut-out proxy. Every Route B result is labelled **"INDICATIVE (fallback route; official AHSP coefficients not loaded)"**.

## 4. From measured damage to payable quantity

The pay item 11.1.(9) is per **m³**, so the defect must become a cut-out volume.

```
Inputs   L, W       damage length/width (m)       segmentation + marker card; inspector confirms → MEASURED
                                                   no marker → size BAND only → engine uses band edges as low/high
         d_meas     deepest depth (cm)            inspector ruler-at-deepest-point photo, AI cross-check → MEASURED
                                                   (never asked from citizens)
         mix        AC-WC | AC-BC | CPHMA | cold  INPUT (inspector proposal)
Params   m          cut margin each side (m)      default 0.30, ASSUMED (common practice; Spec 2018 Rev 2 Seksi 11.1 not retrieved)
         t_min      minimum layer thickness       AC-WC 4.0 cm, AC-BC 6.0 cm, AC-Base 7.5 cm → OFFICIAL
                                                   (Bina Marga SKh-1.6.27 2019; BPK Malut Buku Saku). Tolerances −3/−4/−5 mm.
         ρ          compacted density (t/m³)      Tabel A.2.d SE 30/2025 → TODO_VERIFY;
                                                   until then 2.25–2.34, ASSUMED (field cores: AC-BC 2.29–2.34, PNJ;
                                                   AC-WC 2.25 field / 2.27 lab, Unibos 2026)
         f_loss     loss factor (Route B only)    TODO_VERIFY; engine uses 1.00 and warns "material loss excluded"
         r_tack     tack rate (l/m²)              TODO_VERIFY (Spec Seksi 7.1; field "paper test" per Bekasi method)

Pothole (rectangular cut, vertical edges)
  L_cut = L + 2m          W_cut = W + 2m          A_cut = L_cut × W_cut
  d_rep = max(d_meas, t_min(mix))                  (if d_meas > asphalt layers: add 11.1.(4)/(5) base repair for the excess, TODO)
  Q_pay = A_cut × d_rep                  [m³]      → item 11.1.(9)
  T     = Q_pay × ρ × f_loss             [t]       → Route B only
  Q_tack= (A_cut + 2·(L_cut+W_cut)·d_rep) × r_tack [l]   (base + vertical walls) → 7.1.(2a)

Long damage (walked trace, ≥ 3 photos, every ~15–20 m)
  L     = trace length (GPS)              MEASURED (with GPS accuracy shown)
  W     = inspector-confirmed width; default lane 3.5 m → ASSUMED
  L_cut = L + 2m;  W_cut = W  (no side margin when W is a full lane; DESIGN)
  d_rep = max(max(d_meas at photo points), t_min)
  Q_pay = L_cut × W_cut × d_rep;  T = Q_pay × ρ × f_loss  → 7.3.(5a) per ton (or 11.1.(9) per m³ for deep patching)
```

Why "max" depth: the cut must reach sound material at the deepest point, and no layer may be thinner than its minimum thickness. Excess cutting beyond the approved lines or design depth is, by standard unit-price logic, not payable. The exact Spec wording was not retrieved.

## 5. The range

Every uncertain input has low / mid / high values. Mid is the midpoint unless a better central value is sourced. The cost is monotonic in each input, so the range is simply:

- **low** = all inputs at their low-cost end, OHP 10 %
- **mid** = midpoints, OHP 10 %
- **high** = all inputs at their high-cost end, **OHP 15 %** (the legal maximum)

Size bands from citizen photos (no marker card) go in as L/W low and high. The range then widens, and the UI says so ("size not measured on site"). If a TODO_VERIFY line is excluded, the range is labelled **"incomplete — excludes: tack coat, …"**.

## 6. Comparison rule

```
diff_pct = (reported_spend − fair_mid) / fair_mid × 100        # reported_spend is INPUT, with document source
if |diff_pct| > threshold (default 20, admin-configurable)  → "Needs clarification" / "Perlu klarifikasi"
else                                                          → "Within the expected range" / "Dalam kisaran wajar"
```

- The flag is the same in both directions. **Below** the range can mean less volume or thinner layers than paid for (see the Simeulue and Mogoy–Merdey cases in `data/corruption_cases.csv`). **Above** can mean small-job premiums, mobilisation or extra scope.
- Always show where the reported spend sits relative to [low, high], plus the three inputs that move the estimate most. A big gap that sits inside a wide range points first to *our* uncertainty.
- If the result is Route B ("INDICATIVE") or "incomplete", the label reads **"Indicative difference — needs clarification"**.
- Wording uses BPK-style neutral terms: "estimasi biaya wajar berbeda X % dari nilai yang dilaporkan (berdasarkan AHSP/asumsi model; bukan temuan audit)". Never "mark-up", "korupsi" or "merugikan negara". The flag attaches to the **case / segment / package**, never to a person.

## 7. Crew rules (plausibility checks)

| Rule | Value | Source |
|---|---|---|
| Pekerja : Mandor | 10 : 1 mechanised; up to 20 : 1 manual | Lampiran Permen PUPR 1/2022 |
| Kepala tukang | ≤ about 10 % of tukang | same |
| Mechanised work | ≤ 10 pekerja | same |
| People per machine | ≤ 2 (operator + helper) | Permen 8/2023 Ps 5(5) |
| Equipment management factor | ≤ 0.83 (typically 0.65–0.83) | Kaltim training |
| Effective hours | 7 h/day, 25 days/month | Lampiran Permen PUPR 1/2022 |

Crew-hours are derived as Σ coefficient × quantity, never from a fixed headcount. Checks:
- **Equipment hours per m² far above productivity-based values:** flag. The Banda Aceh 2025 AHSP uses 1.0 h/m² each for excavator, plate compactor and asphalt cutter, so equipment is about 98 % of direct cost. That is the pattern to catch.
- **Reported crew-days vs tonnage:** Surabaya's 9 teams lay 50–60 t of hot mix per day, i.e. 5.6–6.7 t per team-day (arithmetic on JawaPos 22 Feb 2026). Use it as a benchmark (ASSUMED), not a rule.

## 8. Worked examples (Route B, Jakarta)

Common inputs for both:
- AC-WC unit price: low Rp 1,248,991.42 (PNJ "actual"), mid 1,254,346.42 (PNJ "AHSP Bina Marga 2025"), high 1,381,217.00 (PNJ "bid"). **ASSUMED**: Jakarta 2025, a parking-lot paving study, unit implied per ton. These are treated as including OHP 10 %, which is itself an ASSUMPTION, so the high side is scaled × 1.15/1.10.
- Asphalt escalation (Apr 2026): Δ = 11,565 − 9,400 = Rp 2,165/kg × asphalt content 57 kg/t (Jagorawi 2021) for mid and 61.71 kg/t (PNJ 2025) for high. Mid +Rp 123,405/t; high +Rp 133,602.15/t; low 0. **ASSUMED**: it assumes the 2025 study prices sit at the Mar 2026 Pertamina level, and the supply point for Jakarta is TODO_VERIFY.
- Cut-out proxy: PNJ 2025 "Galian" Rp 169,737.46 per m³ × Q_pay. **ASSUMED** proxy. It is generic excavation, not saw-cutting, and it must be removed if the official 11.1.(9) already includes cutting.
- Density ρ: 2.25 / 2.295 / 2.34 t/m³, ASSUMED. Loss factor 1.00 (TODO_VERIFY; excluded).
- **Excluded:** tack coat (rate TODO_VERIFY), mobilisation, traffic management and SMKK.

### 8.1 One pothole on a Jakarta arterial (AC-WC hot-mix patch)

| Input | Value | Status |
|---|---|---|
| L × W damage | 0.80 × 0.60 m | ASSUMED for the example (production: MEASURED via marker card) |
| d_meas | 7.0 cm | ASSUMED for the example (production: MEASURED, ruler photo) |
| cut margin m | 0.30 m | ASSUMED |
| t_min AC-WC | 4.0 cm → d_rep = max(7.0, 4.0) = **7.0 cm** | OFFICIAL |
| L_cut × W_cut | 1.40 × 1.20 m → **A_cut = 1.68 m²** | COMPUTED |
| Q_pay | 1.68 × 0.07 = **0.1176 m³** | COMPUTED |
| T (low / mid / high) | 0.2646 / 0.2699 / 0.2752 t | COMPUTED |

| Line (Rp) | low | mid | high |
|---|---|---|---|
| Hot-mix: T × (unit price + escalation) [× 1.15/1.10 high] | 330,483 | 371,844 | 435,802 |
| Cut-out proxy: 0.1176 m³ × 169,737.46 [× 1.15/1.10 high] | 19,961 | 19,961 | 20,868 |
| Tack coat 7.1.(2a) | excluded (TODO_VERIFY) | excluded | excluded |
| Subtotal | 350,444 | 391,805 | 456,670 |
| PPN 11 % | 38,549 | 43,099 | 50,234 |
| **Fair cost** | **388,993** | **434,904** | **506,904** |
| per m² of cut | 231,544 | 258,871 | 301,729 |

UI: **"Fair cost Rp 389k – 507k (mid 435k). Indicative: official AHSP coefficients not loaded; excludes tack coat, mobilisation, traffic management."**

Comparison:
- Reported **Rp 480,000** → +10.4 % → **within the expected range**.
- Reported **Rp 1,200,000** → +175.9 % → **needs clarification (indicative)**. Context the UI must show next to it: the Sidoarjo benchmark of Rp 705,700/m² (2018 prices) × 1.68 m² ≈ Rp 1.19 juta. Real single-pothole jobs carry mobilisation and small-quantity costs that Route B leaves out. The flag is a question, not a finding.

### 8.2 One long-damage strip (walked trace, mill/cut and inlay AC-WC)

| Input | Value | Status |
|---|---|---|
| Trace length L | 62.0 m | ASSUMED for the example (production: MEASURED from GPS trace, accuracy shown) |
| Width W | 3.5 m (one lane) | ASSUMED (default lane width; inspector confirms) |
| Depths at photo points | 2.5 / 3.0 / 3.5 / 3.0 cm → max 3.5 | ASSUMED for the example (production: MEASURED) |
| d_rep | max(3.5, 4.0) = **4.0 cm** | OFFICIAL t_min governs |
| L_cut × W_cut | (62.0 + 0.60) × 3.5 = **219.1 m²** | COMPUTED (DESIGN: no side margin for a full lane) |
| Q_pay | 219.1 × 0.04 = **8.764 m³** | COMPUTED |
| T (low / mid / high) | 19.72 / 20.11 / 20.51 t | COMPUTED |

| Line (Rp) | low | mid | high |
|---|---|---|---|
| Hot-mix 7.3.(5a): T × (unit + escalation) | 24,628,862 | 27,711,238 | 32,477,618 |
| Cut-out / milling proxy (item TODO_VERIFY) | 1,487,579 | 1,487,579 | 1,555,196 |
| Tack coat on 219.1 m² | excluded (rate and price TODO_VERIFY) | excluded | excluded |
| Subtotal | 26,116,441 | 29,198,817 | 34,032,814 |
| PPN 11 % | 2,872,809 | 3,211,870 | 3,743,610 |
| **Fair cost** | **28,989,249** | **32,410,687** | **37,776,424** |
| per m² | 132,311 | 147,926 | 172,416 |

Crew plausibility: 20.1 t at 5.6–6.7 t per team-day ≈ **3.0–3.7 team-days** (Surabaya benchmark, ASSUMED).

Comparison:
- Reported **Rp 36,000,000** → +11.1 % → within.
- Reported **Rp 9,500,000** → −70.7 % → **needs clarification**. A spend this far below an estimate that already excludes several items may mean only spot patches were done, not the full strip. The inspector checks the after-photos along the trace.

## 9. Output format

```json
{
  "caseId": "JKT-7K3Q",
  "engineVersion": "cost-engine 1.0.0",
  "priceTableVersion": "jkt-2026-11-01",
  "route": "B_PER_TON_FALLBACK",
  "basis": "INDICATIVE",
  "completeness": { "complete": false, "excluded": ["7.1.(2a) tack coat", "mobilisation", "traffic management", "SMKK"] },
  "quantity": {
    "item": "11.1.(9)", "unit": "m3",
    "qPay": { "low": 0.1176, "mid": 0.1176, "high": 0.1176 },
    "tons": { "low": 0.2646, "mid": 0.2699, "high": 0.2752 },
    "areaCutM2": 1.68, "depthRepairCm": 7.0
  },
  "fairCostIdr": { "low": 388993, "mid": 434904, "high": 506904, "rounding": "UI rounds to Rp 1,000" },
  "lines": [
    { "id": "hotmix", "item": "7.3.(5a) per-ton proxy", "idr": { "low": 330483, "mid": 371844, "high": 435802 } },
    { "id": "cutout", "item": "galian proxy", "idr": { "low": 19961, "mid": 19961, "high": 20868 } },
    { "id": "tack", "item": "7.1.(2a)", "idr": null, "status": "TODO_VERIFY", "sourceToFetch": "SE 30/SE/Dk/2025 Lampiran V; Spec 2018 Rev 2 Seksi 7.1" },
    { "id": "ppn", "rate": 0.11, "idr": { "low": 38549, "mid": 43099, "high": 50234 } }
  ],
  "inputs": [
    { "key": "L", "value": 0.80, "unit": "m", "status": "MEASURED", "source": "segmentation + marker card, inspector confirmed", "evidenceHash": "sha256:…" },
    { "key": "W", "value": 0.60, "unit": "m", "status": "MEASURED", "source": "same", "evidenceHash": "sha256:…" },
    { "key": "d_meas", "value": 7.0, "unit": "cm", "status": "MEASURED", "source": "ruler-at-deepest-point photo; AI read 6.8 cm (|Δ| < tolerance)", "evidenceHash": "sha256:…" },
    { "key": "cut_margin", "value": 0.30, "unit": "m", "status": "ASSUMED", "source": "common practice; Spec 2018 Rev 2 Seksi 11.1 not retrieved" },
    { "key": "t_min_acwc", "value": 4.0, "unit": "cm", "status": "OFFICIAL", "source": "Bina Marga SKh-1.6.27 (2019); BPK Malut Buku Saku", "date": "2019" },
    { "key": "rho", "low": 2.25, "high": 2.34, "unit": "t/m3", "status": "ASSUMED", "source": "field cores PNJ CMJ; Unibos 2026", "todo": "SE 30/2025 Tabel A.2.d" },
    { "key": "unit_price_acwc", "low": 1248991.42, "mid": 1254346.42, "high": 1381217.00, "unit": "Rp/t", "status": "ASSUMED", "source": "Suryaman & Wacono, PNJ 2025 (Jakarta)", "date": "2025" },
    { "key": "asphalt_escalation", "mid": 123405, "high": 133602.15, "unit": "Rp/t", "status": "ASSUMED", "source": "Pertamina RU IV Cilacap Mar→Apr 2026 via TIMES Indonesia", "date": "2026-04" },
    { "key": "ohp", "mid": 0.10, "high": 0.15, "status": "OFFICIAL", "source": "SE DJBM 01/SE/Db/2019 (10%); Permen PUPR 8/2023 Ps 11(3) (≤15%)" },
    { "key": "ppn_eff", "value": 0.11, "status": "OFFICIAL", "source": "PMK 131/2024 (12% × 11/12)" }
  ],
  "warnings": [
    "Official AHSP 11.1.(9) coefficients not loaded (SE 30/SE/Dk/2025 Lampiran V).",
    "Material loss factor not applied (TODO_VERIFY).",
    "Unit prices dated 2025 predate the Apr 2026 Pertamina asphalt change; escalation applied (ASSUMED)."
  ],
  "comparison": {
    "reportedSpendIdr": 1200000, "reportedStatus": "INPUT", "reportedSource": "work order WO-… (uploaded document hash sha256:…)",
    "diffPct": 175.9, "thresholdPct": 20, "insideRange": false,
    "result": "NEEDS_CLARIFICATION", "label_en": "Indicative difference — needs clarification",
    "label_id": "Selisih indikatif — perlu klarifikasi",
    "topDrivers": ["unit_price_acwc", "excluded: mobilisation", "rho"]
  },
  "disclaimer_id": "Estimasi biaya wajar berdasarkan AHSP/asumsi model; bukan temuan audit."
}
```

The output is stored as an append-only audit event, with the hash of the price-table version it used. Re-running with a newer price table creates a new event. It never overwrites the old one.

## 10. How admins update prices

1. **Where:** Admin → Prices. Upload a CSV with the same columns as `data/material_prices.csv` (`price_id, category, item, spec, unit, price_idr, includes_ohp, region_or_supply_point, period, source, source_date, status, notes`). Single-row edits are also allowed.
2. **Required on every row:** source (document title + URL or upload), source date, period and status. A row without a source cannot be saved. Uploaded PDFs (HSPK, SK UMK, Pertamina letter) are hashed and kept as evidence.
3. **Versioning:** each save creates a new price-table version with `effective_from`. Old versions stay readable. Every estimate records the version it used.
4. **Review:** a change to an OFFICIAL row, or to any price moving more than 20 % (DESIGN), needs a second ADMIN to confirm. Both names are logged. This is the same separation-of-duties idea as the case workflow.
5. **Scheduled refresh** (the admin dashboard shows "stale" badges):

| Data | When | Source |
|---|---|---|
| UMP | each January (announcement deadline 24 Dec) | SK Gubernur / Kemnaker; `ump_2026.csv` |
| UMK | each January | Kepgub UMK; `umk_2026.csv` (Bekasi, Karawang, Bandar Lampung are TODO) |
| IKK | each October (BPS release) | BPS IKK publication; `ikk_2025.csv` |
| Asphalt | monthly | Pertamina price by supply point |
| HSPK/SSH | each budget year | Pemda e-HSPK / SSH |
| AHSP coefficients | when a new SE Dirjen Binkons is issued | SE 30/SE/Dk/2025 Lampiran V → successor |

6. **Never:** edit an old estimate, delete a price row (deactivate it instead), or enter a coefficient without the SE sheet reference.

## 11. Real benchmarks (for context, not for pricing)

| Benchmark | Value | Year / basis | Source | Caveat |
|---|---|---|---|---|
| Penambalan lubang (P5), **Sidoarjo** | **Rp 705,700/m²** (594.14 m² → Rp 419.28 juta) | 2018 price standard (paper 2022) | [Anam et al., JSpTS 2022](https://jurnal.untag-sby.ac.id/index.php/JSpTS/article/view/8555/5559) | blended rate; scope of cutting, base and mobilisation unknown |
| Laburan (P2) / retak (P3, P4) / perataan (P6) | Rp 174,400 / 154,900 / 228,600 per m² | same | same | |
| Overlay Laston 8 cm, Sidoarjo | Rp 1,238,400/m² | same | same | |
| Patch repair, **Banda Aceh** | Rp 1,429,818.53/m² incl. OHP 10 % | 2025 | [Reza et al., PRINCE 2025](https://ejournal.unida-aceh.ac.id/prince/article/download/1055/866) | equipment at 1 h/m² per machine (about 98 % of direct cost). An example of what to flag. |
| **Surabaya** routine maintenance | about Rp 40 miliar/year; 9 teams in 5 rayon; 50–60 t hot mix/day; 8–9 t per truck; 1×24 h follow-up | 2026 | [JawaPos 22 Feb 2026](https://www.jawapos.com/surabaya-raya/2602220050/pemkot-surabaya-gelontorkan-rp-40-miliar-untuk-tambal-jalan-berlubang-tahun-ini); [Suara Surabaya 20 Feb 2026](https://www.suarasurabaya.net/kelanakota/2026/pemkot-surabaya-komitmen-perbaiki-laporan-jalan-berlubang-1x24-jam-siapkan-60-ton-hotmix-tiap-hari/) | |
| **Jakarta PJLP** (Dinas Bina Marga) | about **750 PJLP** "pasukan kuning" (Feb 2026), called insufficient; about 200 more planned. About **6,000 potholes** handled in late Jan 2026, **all temporary** ("Itu semua perbaikan sementara"). | 2026 | [IDX Channel 12 Feb 2026](https://www.idxchannel.com/news/kebut-perbaikan-lubang-jalan-jakarta-gubernur-dki-akan-tambah-pjlp-bina-marga/all); [JawaPos 31 Jan 2026](https://www.jawapos.com/jabodetabek/2601310183/hampir-6000-jalan-berlubang-ditangani-akibat-cuaca-ekstrem); [GNFI 19 Feb 2026](https://www.goodnewsfromindonesia.id/2026/02/19/menjaga-jalan-jakarta-menjaga-keselamatan-bersama) | **No DKI cost per m², PJLP wage or crew composition found.** Swakelola cost ≠ contract price, so compare like with like. |
| AC-WC per AHSP BM 2025, Jakarta | Rp 1,254,346.42 (bid 1,381,217.00; actual 1,248,991.42) | 2025 | [Suryaman & Wacono, PNJ 2025](https://prosiding.pnj.ac.id/index.php/snts/article/download/4889/3221/30517) | unit implied (ton); parking-lot paving |
| AC-BC with Asbuton, Kendari | Rp 1,606,072.17/t incl. OHP 10 % | 2023 | [Sabara et al. 2024](https://medkons.uho.ac.id/index.php/journal/article/download/31/15/63) | |
| Prime coat, Kendari | Rp 19,914.67/l incl. OHP 10 % | 2023 | same | |
| AC-WC, Jagorawi toll | Rp 1,114,000/t (Permen 28/2016) vs Rp 1,022,000 actual | 2021 | [Putri et al., PNJ 2021](https://jurnal.pnj.ac.id/cmj/article/download/4152/2365/10143) | superseded method |
| Kota Bekasi small road package (RW 11 Jatimakmur) | pagu Rp 159.7 juta; HPS Rp 155,569,604 | date not captured | [indotender](https://indotender.com/tender/bekasikota/pl/10542223000) | |

Hot-mix AHSP prices cluster at **Rp 1.0–1.6 juta per ton (2021–2025)**. At a 4–7 cm depth and 2.25–2.34 t/m³ (ASSUMED), that gives about Rp 90k–262k per m² of material and placement before PPN (arithmetic). Published per-m² patching rates are several times higher. The engine therefore itemises cutting, base, tack, mobilisation and small-job premium lines rather than using one blended per-m² rate.

## 12. Gaps (block "official" status of the engine)

| Gap | Effect | Source to fetch |
|---|---|---|
| AHSP coefficients for 11.1.(9), 11.1.(11), 7.1.(2a), 7.3.(5a)/(6a), 6.1.(1)/(2), 11.1.(4)/(5) | Route A impossible; every result INDICATIVE | SE 30/SE/Dk/2025 Lampiran V (Excel) |
| Berat isi campuran beraspal (Tabel A.2.d), faktor kehilangan, kembang susut | density ASSUMED; loss excluded | SE 30/2025 Lampiran I/II |
| Spec 2018 Rev 2 Seksi 11.1 text: cut margin, tack rate, lift thickness, density, Pengukuran & Pembayaran | margin ASSUMED; tack excluded | binamarga.pu.go.id Spesifikasi Umum 2018 Revisi 2 |
| DKI e-HSPK (AC-WC/t, aspal/kg, cold-mix/sak, wages, equipment); Jabar / Karawang SSH | Jakarta prices are study proxies | DKI e-HSPK; Pemprov Jabar / Pemkab Karawang |
| UMK 2026 Kota/Kab. Bekasi, Karawang, Bandar Lampung | labour understated outside DKI | Kepgub UMK 2026 |
| IKK 2025 for DKI, Jabar, Lampung, Karawang, Bandar Lampung | no IKK scaling for the pilot | BPS IKK 2025 PDF (164 pages) |
| Pertamina official price list by supply point; which supply point serves Jakarta | escalation ASSUMED | Pertamina Trading & Service |
| PPN on construction / procurement after the 2026 PMK omnibus | 11 % assumed still applies | DDTC / PMK text |
| Item code for saw-cut / galian perkerasan; milling | cut-out is a proxy | SE 30/2025 Lampiran V |
| DKI PJLP crew composition, productivity (m²/day), cost per pothole | no Jakarta swakelola benchmark | Dinas Bina Marga DKI (PPID) |
| Minimum masa pemeliharaan article (6 months permanent / 3 semi-permanent) | warranty flag article TODO_VERIFY | Perpres 16/2018 jo 46/2025; Perlem LKPP 12/2021 |
