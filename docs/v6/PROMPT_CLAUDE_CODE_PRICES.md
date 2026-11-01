# Prompt Claude Code: memasang data harga v6

Tempel prompt ini setelah folder `docs/v6/data/prices/` (berisi semua CSV + README_PRICE_DATA.md) dan `docs/v6/V6_UPDATE_TWO_PORTALS.md` sudah ada di repo.

```
Read docs/v6/data/prices/README_PRICE_DATA.md and docs/v6/V6_UPDATE_TWO_PORTALS.md (section 4) first. The CSVs in docs/v6/data/prices/ are real values copied from official 2026 regional price regulations (Perbup Karawang 28/2025, Perbup Kab. Tangerang 32/2025, Pergub Sultra 41/2025) plus sourced market signals. Treat them as data, not code.

Implement the v6 regional price book (on branch v6-portals):

1. Schema + import
   - Tables: MaterialCatalog, PriceBook (region_code, item_group, item_name_as_written, item_name_en, unit_as_written, unit_normalized, price_idr, price_idr_normalized, valid_year, source_doc, source_url, source_page, status, notes, imported_by, imported_at), WageRate, EquipmentRate, QaTestPrice, MarketSignal.
   - A seed/import script that loads every CSV exactly as written (no rounding, no unit "fixing"). Rows with status TODO_VERIFY stay TODO_VERIFY and are excluded from automatic calculations unless an Operations Manager confirms them (logged).
   - A CSV import screen for OM (Biaya & Material → Buku Harga → Impor CSV) with validation: required columns, known units, price > 0, source present, outlier warning (>3× or <0.3× the median of the same item across regions). Every import is an event in the hash-chained audit log.

2. Price lookup order (case region from routing): agency-uploaded book → price_book_regional_2026 same region → other region × BPS IKK 2025 multiplier (status ASSUMED) → "price not available" (no calculation). Wages: wages_daily_2026 → UMP/UMK ÷ 25 days (COMPUTED). Equipment: equipment_rental_2026 → TODO_VERIFY.

3. Cost engine v6 UI (Field Engineer, OM, Auditor) in the ORIGINAL UI style:
   - Side-by-side options: hot-mix patch (AC-WC), cold mix/emulsion patch, rapid-setting concrete (fast track), AC-WC overlay. Each shows quantity from measurement, unit price built AHSP-style (materials + labour + equipment + 10% overhead + 11% effective VAT), cost range, PINN life range, and cost per service-year. Highlight "lowest cost per year that lasts".
   - Every number shows its source + page + status; a "View document" link opens source_url.
   - Handle the known anomalies listed in README section 3 visibly (two AC-WC lines → let OM pick; Tangerang cement unit → TODO_VERIFY badge; operator wage → admin warning; non-monotonic K-series → shown as is and fed to the anomaly detector as a note, never as an accusation).
   - Auditor view: compare submitted/contract values against the computed range; >20% difference → "needs clarification".
   - QA tests panel: recommend core drill / Marshall / extraction / sand cone with their reference prices (qa_test_prices_2026, labelled as Sultra reference × IKK = ASSUMED for other regions).

4. Tests (never delete existing ones): import keeps values byte-exact; TODO_VERIFY rows excluded from auto calc; lookup order; IKK fallback labelled ASSUMED; anomaly flags; audit event per import; a worked example for a Karawang pothole (state inputs in the test) reproduces the same numbers on every run.

5. Finish: tests green, commit "v6: regional price book + multi-material cost engine" with "Assisted-by: Claude Code", HTTPS URL, screenshots of the cost comparison and the price book screen, and a list of regions still marked TODO (from price_book_todo_regions.csv).
Do not invent prices for any region or item. If a needed price is missing, show "price not available" and tell me which document to load.
```
