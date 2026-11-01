# UI fixtures and temporary wiring (UI_RESTORE_PLAN, Prompt 2)

Everything here must be replaced in Prompt 3. No screen uses invented numbers.

| Role | Screen | What is temporary | Replace with |
|---|---|---|---|
| Warga | Kerusakan panjang | The walked length is real GPS, but it is saved only as a sentence in the report description, because the original report API has no trace field. | Send the trace to `POST /api/v5/cases` (`mode: TRACE`) |
| Warga | Kerusakan panjang | Photos are taken after the walk (3 in total), not prompted every 15–20 m during it. | Prompt photos during the walk |
| Warga | Kirim laporan | Reports still go to the original workflow store (`/api/workflow/reports`), so they are not yet in the hash-chained v5 log. | `POST /api/v5/capture/nonce`, `/api/v5/evidence`, `/api/v5/cases` |
| Warga | Kamera | One-time capture code and server GPS check are not enforced on this path yet. Gallery upload is still there. | v5 capture; remove the file inputs |
| Semua staf | Peran, Kerja, Pantau, Tur | These read the v5 store: the two sample cases and cases made through its API. Citizen reports from the original screen do not appear there yet. | Send citizen reports to the v5 API; retire the v4 store |
| Semua staf | Pakai foto contoh | Sample photos and "Alat uji: majukan waktu" stay for testing without going on site. | Remove in Prompt 3 |
| Semua staf | Login | Role picker with bundled test accounts. | Real accounts per role |

Road owner card and map colours are not fixtures: they read the live routing API.
Office icons on the map are not built, because office coordinates are not published in any source (04 §8).
