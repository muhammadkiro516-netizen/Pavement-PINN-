# UI fixtures (UI_RESTORE_PLAN)

Screens that still use fixtures: **0**.

Every reachable screen reads the v5 API (`/api/v5/*`). A browser test (`e2e-v5/golden.spec.ts`) checks that the
old sample photo addresses no longer return images and that the landing page requests none.

## Removed in Prompt 3

| What | Replaced with |
|---|---|
| Sample photos, "Pakai foto contoh", gallery upload | Live camera only: one-time capture code, server time, GPS accuracy |
| Fast-forward tool, tamper simulation button | Real time; the tamper check runs against the real log |
| Bundled test accounts and role picker | Real accounts (`scripts/v5-create-accounts.ts`), passwords kept out of git |
| Sample cases | None. The case list starts empty |
| Citizen reports through the old workflow store | `POST /api/v5/capture/nonce`, `/api/v5/evidence`, `/api/v5/cases` |
| Landing photos and the recorded AI score | A drawing labelled "Gambar penjelas", and photos from real reports once there are any |
| Bundled road segments on the map | Real cases and the OpenStreetMap road snapshot |

## Older code still in the repository, not served to users

These v4 modules still contain the word "demo", because existing tests exercise them and tests are not deleted:
`src/domain/workspace/demo*.ts`, `src/data/fixtures/workspace-demo.json`, `src/data/mock/communityReports.ts`,
`src/data/reference/demoCredentials.ts`, `server/auth/demoLogin.ts`, and the old pages under `src/pages/operations`,
`src/pages/engineering`, `src/pages/track`, `src/pages/roads`.

No route opens those pages. `DEMO_AUTH` is off on the live server, and the bundled workspaces load only when it is on.

## Reference data, not fixtures

`config/v5/roads_snapshot.json` (OpenStreetMap), agencies, road-status rules and prices with their status labels.
Office icons on the map are not built, because office coordinates are not published in any source (04 §8).
