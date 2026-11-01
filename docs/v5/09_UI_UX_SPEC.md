# 09 — UI/UX Spec (v5 rework)

> Scope: visual system, screens per role, exact microcopy, states, motion, mascot, charts, map legend, accessibility, offline, the public "Why" page, the 60-second judge tour, and gamification.
> Builds on the existing app (`src/`: React 19, Vite PWA, Tailwind v4 `@theme` in `src/styles/index.css`, `motion` v12, `recharts` v3, `maplibre-gl` 6.14, `lucide-react`, `canvas-confetti`, `jspdf`). **Do not add a UI framework.** Do not switch stack.
> Screen IDs (`UX-xx`) are referenced by `13_WORK_PLAN.md` and `01_CLAUDE_CODE_PROMPT.md`.
> Roles and rules come from `03_ROLES_RBAC.md`; routing colors from `04_AUTHORITY_ROUTING.md`; capture flow from `05_CAPTURE_AND_MEASUREMENT.md`. If those files disagree with this one on behavior, they win; this file wins on look, words and motion.

---

## 0. Design principles (apply to every screen)

1. **One job per screen.** The top of each screen says what the user can do here in ≤ 8 words.
2. **Plain English, short words.** Max ~12 words per sentence in UI. No jargon on citizen screens ("crack" not "longitudinal distress"; "fix" not "remediation"). Technical terms appear only on staff screens, each with a one-line "What is this?" tooltip.
3. **Every number shows where it came from.** A small status chip sits next to each number: `MEASURED`, `OFFICIAL`, `INPUT`, `ASSUMED`, `TODO_VERIFY`, `AI_ESTIMATE`, plus `DEMO` and `AI DRAFT` (see §3.4; same label set as `02_SPEC_v5.md` §0). No chip → the number must not be shown.
4. **AI suggests, people decide.** Every AI output has a visible human action next to it ("Accept", "Change", "Reject") and the name of the role that must decide.
5. **Neutral words about money and people.** Flags say "Needs clarification", never "corruption", "mark-up", "fraud", "lazy". Flags attach to a case, road segment or work package, never to a named person.
6. **Light theme by default** (white surfaces). Dark accents come from the deck palette. Dark mode exists (system setting) but the demo runs light.
7. **Works on a cheap phone on a slow network.** Every primary flow must work on a 2 GB RAM Android with Chrome, 3G-class speed, and offline (queue).

---

## 1. Design tokens

Implement as CSS custom properties in `src/styles/index.css` inside Tailwind v4 `@theme` (replace the current dark-first palette; keep old variable names as aliases for one release so existing components do not break). Contrast ratios below were computed with the WCAG 2.x formula against the stated background.

### 1.1 Brand palette (from shared decisions)

| Token | Hex | Use | Contrast note |
|---|---|---|---|
| `--pp-ink` | `#0D1015` | Asphalt ink: primary text, dark surfaces, toll road lines | 19.1:1 on white |
| `--pp-signal` | `#FFC72C` | Signal yellow: primary button fill, highlights, Pavi helmet | **Never text on white (1.6:1).** Ink on yellow = 12.2:1 ✔ |
| `--pp-signal-press` | `#E0A100` | Pressed/hover yellow | Fill only |
| `--pp-signal-text` | `#7A5600` | Yellow-family text/icon on white | 6.7:1 ✔ |
| `--pp-cone` | `#FF7A1A` | Cone orange: "medium" severity fill, streak flame | Fill only on white (2.6:1). Ink on cone = 7.3:1 ✔ |
| `--pp-cone-text` | `#A84300` | Orange-family text on white | 6.1:1 ✔ |
| `--pp-hazard` | `#E5391A` | Hazard red: "high" severity fill, destructive buttons (white text) | White on hazard = 4.3:1 (OK for ≥ 18.66 px bold / large text only) |
| `--pp-hazard-text` | `#B8300F` | Red text on white, error messages | 6.1:1 ✔ |
| `--pp-physics` | `#0A9CC2` | Physics cyan: PINN charts, life-range bands | Fill/graphics only on white (3.2:1, passes 3:1 non-text) |
| `--pp-physics-text` | `#076A85` | Cyan text on white | 6.2:1 ✔ |
| `--pp-intel` | `#0068B5` | Intel blue: "Runs on Intel" badges, links | 5.8:1 ✔ (text OK) |
| `--pp-green` | `#12A06A` | Green: "fixed", "passed", success fills | Fill only on white (3.4:1) |
| `--pp-green-text` | `#0A7048` | Green text on white | 6.1:1 ✔ |

### 1.2 Neutral (light theme)

| Token | Hex | Use |
|---|---|---|
| `--pp-bg` | `#FFFFFF` | Page background (`body` must set it explicitly) |
| `--pp-bg-sunk` | `#F6F7F9` | Sunken areas, map sheet handle area, table stripes |
| `--pp-surface` | `#FFFFFF` | Cards |
| `--pp-line` | `#E5E7EB` | Hairlines (decorative only) |
| `--pp-line-strong` | `#8B95A1` | Input borders, focusable outlines (3.0:1 ✔ non-text) |
| `--pp-text` | `#0D1015` | Body |
| `--pp-text-2` | `#4A525C` | Secondary text (7.9:1) |
| `--pp-text-3` | `#5B6470` | Captions, timestamps (6.0:1; 5.6:1 on `bg-sunk`) |
| `--pp-focus` | `#0068B5` | 2 px focus ring + 2 px white offset |

### 1.3 Dark mode (system `prefers-color-scheme: dark`, and `[data-theme="dark"]`)
`--pp-bg #0D1015`, `--pp-surface #161A21`, `--pp-bg-sunk #0A0C10`, `--pp-line #2A2F37`, `--pp-text #F6F7F9`, `--pp-text-2 #9AA3AE` (7.5:1), focus `#4DA3E8` (7.0:1). Brand fills keep their hex; text variants switch to the fill hex (yellow 12.2:1, cone 7.3:1, cyan 5.9:1, green 5.7:1, hazard 4.5:1 on ink). Guard: `:root:not([data-theme="light"])` inside the media query.

### 1.4 Semantic tokens (components use these, never raw hex)

| Semantic | Light value |
|---|---|
| `--sev-low` (Small) | fill `--pp-signal`, text `--pp-ink`, icon `CircleDot` |
| `--sev-med` (Medium) | fill `--pp-cone`, text `--pp-ink`, icon `TriangleAlert` |
| `--sev-high` (Dangerous) | fill `--pp-hazard`, text white bold, icon `OctagonAlert` |
| `--state-open` | `--pp-text-2` outline chip |
| `--state-progress` | `--pp-intel` |
| `--state-fixed` | `--pp-green` fill + ink text |
| `--state-failed-again` | `--pp-hazard-text` outline + `RotateCcw` icon |
| `--flag-clarify` | `--pp-cone-text` outline chip, `MessageCircleQuestion` icon |

Severity is **always** color + icon + word. Never color alone (WCAG 1.4.1).

### 1.5 Typography
- Load Barlow Condensed 600/700 and Barlow 400/500/600 from Google Fonts with `display=swap`; self-host fallback in `public/fonts/` for offline (subset Latin, woff2, ≤ 120 KB total). Fallback stack: `"Barlow", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`.
- Numbers in tables/cards: `font-variant-numeric: tabular-nums`.

| Token | Font | Size / line-height | Use |
|---|---|---|---|
| `display` | Barlow Condensed 700 | 40/44 (mobile 32/36) | Why page hero, certificate |
| `h1` | Barlow Condensed 700 | 28/32 | Screen title |
| `h2` | Barlow Condensed 600 | 22/28 | Section title |
| `h3` | Barlow Condensed 600 | 18/24 | Card title |
| `body` | Barlow 400 | 16/24 | Default (never below 16 on citizen screens) |
| `body-strong` | Barlow 600 | 16/24 | Key facts |
| `small` | Barlow 500 | 14/20 | Captions, chips |
| `micro` | Barlow 600, +0.04em, uppercase | 12/16 | Status chips only (`MEASURED`) |
| `metric` | Barlow Condensed 700, tabular | 32/36 | KPI numbers |

### 1.6 Spacing, radius, elevation, layout
- Spacing scale (4 px base): `--sp-1 4, --sp-2 8, --sp-3 12, --sp-4 16, --sp-5 20, --sp-6 24, --sp-8 32, --sp-10 40, --sp-12 48, --sp-16 64`.
- Page gutter: 16 px mobile, 24 px tablet, 32 px desktop. Max content width 1200 px; reading width 680 px.
- Radius: `--r-xs 6` (chips), `--r-sm 10` (inputs, small buttons), `--r-md 16` (cards, sheets), `--r-lg 24` (bottom sheet top corners, hero cards), `--r-pill 999`.
- Elevation (light):
  - `--e-0`: none, 1 px `--pp-line` border.
  - `--e-1`: `0 1px 2px rgba(13,16,21,.06), 0 1px 3px rgba(13,16,21,.10)` — cards.
  - `--e-2`: `0 4px 12px rgba(13,16,21,.10)` — floating buttons, map controls.
  - `--e-3`: `0 12px 32px rgba(13,16,21,.16)` — bottom sheets, modals.
- Touch targets: **min 48×48 px** for primary actions on citizen/inspector/crew screens; **never below 24×24 px** anywhere (WCAG 2.5.8), with ≥ 8 px spacing between small targets.
- Breakpoints: `sm 480`, `md 768`, `lg 1024`, `xl 1280`. Citizen/Inspector/Crew = mobile-first single column. Staff dashboards = `lg` two-pane (list + detail), collapse to stacked on `md` and below.

### 1.7 Motion tokens

| Token | Duration | Easing | Use |
|---|---|---|---|
| `--m-instant` | 80 ms | linear | Pressed state, toggle thumb |
| `--m-fast` | 140 ms | `cubic-bezier(.2,0,0,1)` | Hover, chip appear, tooltip |
| `--m-base` | 220 ms | `cubic-bezier(.2,0,0,1)` | Cards, tab switch, list insert |
| `--m-slow` | 360 ms | `cubic-bezier(.05,.7,.1,1)` (decelerate) | Bottom sheet open, page enter |
| `--m-exit` | 160 ms | `cubic-bezier(.3,0,1,1)` (accelerate) | Sheet close, toast out |
| `--m-celebrate` | 900 ms | spring (`motion`: stiffness 260, damping 18) | Badge unlock, certificate |
| `--m-loop` | 1.6–2.4 s | ease-in-out, infinite | Pavi idle bob, scan sweep, pending pulse |

`@media (prefers-reduced-motion: reduce)`: all durations → 0.01 ms except opacity fades (keep ≤ 120 ms), loops stop, confetti off, map `flyTo` → `jumpTo`. Also expose a "Reduce motion" switch in Me/Settings that sets `[data-motion="reduced"]`.

---

## 2. Component library

Put shared components in `src/components/ui/` (new files; keep `brand.tsx`, `snap.tsx` working). Each has a story in a `/dev/ui` page (`VITE_SHOW_DEV=1` only) and at least one unit test for props → output (labels, chips, disabled states).

| Component | Purpose / rules |
|---|---|
| `AppBar` | Title (h1), optional back, right slot (bell, role switch in demo). Height 56. |
| `BottomNav` | Citizen 4 tabs + center Report FAB; staff on mobile 4 tabs. Active = ink label + yellow 3 px top bar. Labels always visible. |
| `Button` | Variants: `primary` (yellow fill, ink text), `secondary` (white, ink 1.5 px border), `quiet` (text only, intel-blue), `danger` (hazard fill, white bold ≥ 18 px). Sizes `lg` 56, `md` 48, `sm` 36 (staff desktop only). Loading state shows spinner + keeps label ("Sending…"). |
| `Fab` | 64 px yellow circle, camera icon + "Report" label below. |
| `Card`, `ListRow` | Card radius 16, `--e-1`. ListRow min-height 64, chevron, whole row tappable. |
| `SourceChip` | `MEASURED`/`OFFICIAL`/`INPUT`/`ASSUMED`/`AI_ESTIMATE`/`TODO_VERIFY`/`DEMO`/`AI DRAFT`. Tap → popover: source, date, who entered it, link. See §3.4. |
| `SeverityBadge` | Small / Medium / Dangerous with icon (never color-only). |
| `StatusPill` + `CaseTimeline` | Case states from `02_SPEC_v5.md` state machine; timeline shows each event with role, time, hash short id. |
| `SlaClock` | "Day 4 of 14" ring; turns cone at 75 %, hazard at 100 %; text always present. |
| `AuthorityTag` | Colored line swatch + pattern + text: "Provincial road · Dinas Bina Marga DKI Jakarta". Shows confidence ("High"/"Low — please confirm"). |
| `MapView` | Wraps existing `MapLibreMap.tsx`; layers: authority lines, damage pins, clusters, my location (Pavi marker), offices. Legend button always visible. |
| `MapLegendSheet` | §8. |
| `CameraCapture` | Live `getUserMedia` view, nonce badge, GPS accuracy meter, motion check, shutter 72 px. No file input in production build. |
| `LongDamageRecorder` | Start / photo counter / distance walked / End (see UX-C05). |
| `MeasureCard` | Inspector: typed depth + ruler photo + AI read-back + mismatch flag. |
| `LifeRangeChart` | PINN P10–P50–P90 band (cyan) with "expected" vs "observed" marker. |
| `FairCostRange` | Range bar (low–high) with reported spend marker and diff %. |
| `EvidenceChecklist` | Repair stage gates with photo slots; locked until previous step done. |
| `AiDraftBlock` | Grey box, "AI DRAFT — needs human approval" header, highlighted code-inserted numbers, buttons Approve / Edit / Discard. |
| `HashBadge` | Short hash (8 chars) + copy + "Verify" link. |
| `EmptyState`, `ErrorState`, `Skeleton`, `Toast`, `Banner` (offline/demo) | §5. |
| `Pavi` | Extended mascot, §7. |
| `QuestCard`, `BadgeTile`, `StreakFlame`, `CertificateCard` | §12. |
| `StatTile`, `ChartCard` | KPI number + label + source chip + "as of" date. |
| `ConfirmDialog` | Requires a typed reason for staff overrides ("Why are you changing this?" min 10 chars). |

---

## 3. Global patterns

### 3.1 App shell
- Top `AppBar`; `Banner` slot under it for **offline**, **demo mode**, **server version** (existing `ServerVersionBanner`).
- Citizen bottom nav: **Map · My reports · [Report] · Quests · Me**. Notifications = bell icon in AppBar (badge count). Safety radar = toggle on the map (existing `RadarToggle`).
- Staff (desktop): left rail with role-specific items (§4), top bar with region + role chip + bell.
- Demo role switcher (only when `DEMO_MODE=1`): chip in AppBar "Viewing as: Citizen ▾". Every switch is logged; never shown in production build.

### 3.2 Demo mode banner (always visible when on)
`DEMO MODE — sample data. Not a live capture.` (yellow fill, ink text, `FlaskConical` icon). Any record created in demo mode carries the `DEMO` chip on every screen, in PDFs and on the verify page.

### 3.3 Language
English default. Keep the existing `LanguageContext` Indonesian toggle ("Bahasa Indonesia"). Citizen strings below include the Indonesian version (ID) so field pilots work. Staff strings English only for now (ID translation P2).

### 3.4 Source chips (exact labels and popover text)

| Chip | Color | Popover title | Popover body template |
|---|---|---|---|
| `MEASURED` | green-text outline | Measured | "Measured by {role} on {date} with {method}." |
| `OFFICIAL` | intel outline | Official source | "From {document} ({issuer}, {date}). {link}" |
| `INPUT` | ink outline | Entered by a person | "Typed by {role} on {date}. Not checked by AI." |
| `ASSUMED` | cone-text outline | Assumption | "Default value: {value}. Why: {reason}. Change it in {where}." |
| `TODO_VERIFY` | hazard-text dashed outline | Not verified yet | "We have not confirmed this value. Source to check: {source}." |
| `DEMO` | yellow fill | Demo data | "Sample data for the demo. Not a real report." |
| `AI_ESTIMATE` | physics-text outline | AI estimate | "Estimated by AI from the photo ({model} {version}). A person will check it." |
| `AI DRAFT` | grey fill | Written by AI | "Drafted by a local AI model. A person must check and approve it." |

### 3.5 Writing rules for microcopy
- Buttons: verb first, ≤ 3 words ("Send report", "Start walk", "Approve plan").
- Errors: what happened + what to do ("No GPS yet. Move to open sky and wait 10 seconds.").
- Never blame the user. Never say "invalid".
- Times: relative for < 7 days ("3 days ago"), else date `12 Feb 2026`.
- Money: `Rp 12,450,000` in English UI, `Rp12.450.000` in ID UI; ranges `Rp 10.2–12.9 million`.

---

## 4. Information architecture and screens per role

Route paths: keep the existing ones (`/peta/`, `/laporanku/`, `/lacak/:code/`, `/bukti/` …) so e2e tests stay green; new screens use English paths. Renaming old paths is P2 and must use `LEGACY_REDIRECTS`.

| Role | Primary device | Nav items (order) |
|---|---|---|
| CITIZEN | Phone | Map, My reports, Report (FAB), Quests, Me |
| FIELD_INSPECTOR | Phone | Today, Map, Measure, Done |
| COORDINATOR | Desktop | Queue, Map, Assign, Follow-ups, Transfers |
| APPROVER | Desktop/tablet | To approve, Approved, Budget |
| REPAIR_CREW | Phone | My jobs, Evidence, Done |
| SUPERVISOR | Tablet/phone | To check, Checked |
| AUDITOR | Desktop | Cases, Packages, Flags, Reports, Verify |
| AGENCY_HEAD | Desktop/tablet | Overview, Escalations, Delays, Report card |
| ADMIN | Desktop | Authorities, Road registry, Prices, Users, Settings |
| Public (no login) | Any | Why this matters, Track a report, Verify a document, Evidence (Intel + model results) |

### 4.1 CITIZEN

**UX-C01 Map home** (`/peta/`)
```
┌──────────────────────────────┐
│ ☰  PAVEMENT-PINN        🔔 2 │  AppBar
├──────────────────────────────┤
│ [DEMO MODE — sample data…]   │  only in demo
│                              │
│   ═══ (blue) national        │
│   ─── (purple) provincial    │  MapView, authority lines
│     ● Dangerous  ◐ Medium    │  damage pins (icon+color)
│        (Pavi = you)          │
│                         [◎]  │  locate
│                         [≡]  │  legend
├──────────────────────────────┤
│ ▔▔▔  Near you                │  bottom sheet (peek 96 px)
│ 3 open reports · 1 fixed     │
│ this week                    │
├──────────────────────────────┤
│ Map  My reports [📷] Quests Me│
└──────────────────────────────┘
```
- Sheet peek text: "**{n} open reports near you** · {m} fixed this week".
- Empty: Pavi `idle` + "No reports near you yet. See damage? Tap Report."
- Tap a road line → `AuthorityTag` sheet: "**Who fixes this road?** {Level} road · {Office name}. Based on {SK number} ({date}). [Show office on map]". Low confidence: "We are not sure who owns this road. A coordinator will confirm."
- Tap pin → report summary sheet: photo (blurred faces/plates), severity, status, SLA clock, "**Same problem? Confirm it**" button (adds a confirmation, not a new report).
- ID: "Siapa yang memperbaiki jalan ini?" / "{n} laporan terbuka di sekitarmu".

**UX-C02 Report — choose type** (sheet after FAB)
```
┌──────────────────────────────┐
│ What do you see?             │
│ ┌──────────┐ ┌──────────┐    │
│ │ 📷        │ │ 🚶 ──── │    │
│ │ One spot │ │ Long     │    │
│ │ (fits in │ │ stretch  │    │
│ │ a photo) │ │ (walk it)│    │
│ └──────────┘ └──────────┘    │
│ ⚠ Stop your vehicle first.   │
│   Stand on the roadside.     │
└──────────────────────────────┘
```
- Strings: "What do you see?" / "One spot" — "Fits in one photo" / "Long stretch" — "Too long for one photo. You walk from start to end." / "Stop your vehicle first. Stand somewhere safe."
- ID: "Apa yang kamu lihat?" / "Satu titik" / "Kerusakan panjang" / "Berhenti dulu. Berdiri di tempat aman."
- If GPS speed > 10 km/h (existing lock): full-screen block "You are moving. Stop first, then take the photo." (ID: "Kamu sedang bergerak. Berhenti dulu, lalu foto.")

**UX-C03 Camera (one spot)**
```
┌──────────────────────────────┐
│ ✕                 GPS ●●●○ 8m│  accuracy meter
│                              │
│      live camera view        │
│   ┌ ─ ─ ─ ─ ─ ─ ─ ┐          │  framing guide
│   │  put the hole │          │
│   │  in the box   │          │
│   └ ─ ─ ─ ─ ─ ─ ─ ┘          │
│ Photo 1 of 2: wide view      │
│            ( ◉ )             │  shutter 72 px
│ Tip: add a shoe or bottle    │
│ next to it for size.         │
└──────────────────────────────┘
```
- Step strings: "Photo 1 of 2: wide view — show the road and lane." / "Photo 2 of 2: close-up — fill the box with the damage."
- GPS states: "Finding your location…" → "Location OK (±{m} m)" → if > 50 m: "Location is weak (±{m} m). Move to open sky." Shutter disabled until ≤ 50 m (configurable), with reason text visible.
- Production: no gallery button exists. Demo mode only: a text link "Use a demo photo (judges only)" → picker of sample photos; result stamped `DEMO — not a live capture`.
- Camera permission denied: "We need the camera to take a fresh photo. Old photos are not allowed, to stop fake reports. [How to allow camera]".

**UX-C04 AI check + send** (after capture)
```
┌──────────────────────────────┐
│ ← Check your report          │
│ [photo with box overlay]     │
│ Pavi(scan) "Looking…"        │
│ ─────────────────────────────│
│ We found: Pothole            │
│ Size: Medium (about the size │
│ of a car tyre) [AI ESTIMATE] │
│ Road: Provincial · Dinas Bina│
│ Marga DKI Jakarta  ✓ High    │
│ ─────────────────────────────│
│ Is this right?  [Yes] [No]   │
│ Add a note (optional)        │
│ [        Send report       ] │
└──────────────────────────────┘
```
- Strings: "Looking at your photo…" → "We found: {class}" / "Size: {band}" with band text: Small "smaller than a plate", Medium "about a car tyre", Large "bigger than a car tyre" (band from segmentation; never cm). Chip `AI_ESTIMATE` (shown as "AI ESTIMATE"; popover: "AI estimate — an inspector will measure it").
- Not a road / blurry: "This photo looks blurry. Hold still and try again." / "We can't see a road here. Please take the photo again." (never silently dropped; user can "Send anyway — a person will check").
- Water: "Water may hide the hole. Thanks — an inspector will measure it."
- Duplicate nearby: "Someone reported this {n} days ago. **Add your photo to that report** instead?" [Add to it] [It's different].
- Send button: "Send report". Sending: "Sending…". Offline: "Saved on your phone. We'll send it when you're online." ID: "Tersimpan di HP. Akan dikirim saat online."

**UX-C05 Long stretch recorder**
```
┌──────────────────────────────┐
│ Long stretch                 │
│ ● Recording   02:14          │
│ Walked: 86 m  Photos: 5      │
│ [mini map with trace line]   │
│ Next photo in ~ 9 m          │
│        ( ◉ Take photo )      │
│ [  End here  ]               │
└──────────────────────────────┘
```
- Before start: "Stand at one end of the damage. Tap Start, then walk along it. We'll ask for a photo every 15–20 m." [Start here].
- During: "Walked {m} m · Photos {n}" / "Next photo in about {d} m" / vibrate + "Take a photo now" at each interval.
- End rules: minimum 3 photos ("Take at least 3 photos before you finish."). Gap > 15 s without GPS: "Lost GPS for a moment. Keep walking slowly."
- Result: "Length: about {L} m (from your walk) · Width: set by inspector" with chips `MEASURED` (trace) and `ASSUMED` (default lane width 3.5 m for any area shown).

**UX-C06 Sent / tracking code**
- Pavi `celebrate`, short confetti burst (off under reduced motion).
- "Thank you! Your report is in." / "Tracking code: **{CODE}**" [Copy] [Share] / "Sent to: {office}" / "What happens next: 1. Coordinator checks (target {x} days) 2. Inspector measures 3. Repair 4. You confirm it lasted."
- ID: "Terima kasih! Laporanmu sudah masuk."

**UX-C07 My reports** (`/laporanku/`, tab label "My reports", formerly "Kawal")
- List rows: thumbnail, class, status pill, `SlaClock`, office.
- Follow-up prompts appear as cards: "**Is it still OK?** {road} was fixed 1 month ago. Take a quick photo." [Check now] [Not near it].
- Empty: Pavi `idle` + "No reports yet. Your first report earns the Road Spotter badge."

**UX-C08 Report detail / public track** (`/lacak/:code/`)
- Timeline: Reported → Checked → Measured → Plan approved → Repaired → Checked by supervisor → 1-month check → 3-month check → 6-month check.
- Delay reason (published by Agency Head) shown in a cone-outline box: "**Why is this late?** {reason} — posted by {office} on {date}."
- Each event has `HashBadge` and "Verify" link.

**UX-C09 Quests**, **UX-C10 Badges**, **UX-C11 Certificate** → §12.

**UX-C12 Me**: language, reduce motion, data saver (on by default under 3G), "Get more trust: add phone number (optional)" (OTP), privacy text, "Delete my data".

### 4.2 FIELD_INSPECTOR (phone)

**UX-F01 Today**
```
┌──────────────────────────────┐
│ Today · 6 cases      [map]   │
│ ┌ Dangerous · Jl. Matraman ┐ │
│ │ 1.2 km · Day 3 of 7      │ │
│ │ [Navigate] [Start check] │ │
│ └──────────────────────────┘ │
│ ┌ Medium · Jl. Pramuka … ┐   │
└──────────────────────────────┘
```
- Header: "Today · {n} cases". Sort: due date, then risk. Empty: "No cases today. Nice work." (Pavi inspector `celebrate`).

**UX-F02 Site check** — stepper (5 steps, progress bar):
1. "Are you at the site?" (GPS within 50 m of report, else "You are {d} m away. Move closer.").
2. "Is the damage there?" [Yes] [No — already fixed] [No — wrong place]. No → reason required.
3. "Measure size" — place marker card: "Put the marker card flat next to the damage. Take a photo from above." AI shows mask + area: "Area: {a} m² ± {e}" `MEASURED` (card found) or "Size band: {band}" `AI_ESTIMATE` (no card).
4. "Measure depth" (`MeasureCard`):
```
┌──────────────────────────────┐
│ Depth at the deepest point   │
│ [photo: straightedge+ruler]  │
│ Type depth: [ 45 ] mm        │
│ AI read the ruler: 47 mm ✓   │
│ (difference 2 mm — OK)       │
└──────────────────────────────┘
```
   Mismatch > 5 mm: "Your number and the ruler photo differ by {d} mm. Check again or explain." (reason box, flag recorded). Water: "Water in the hole? Remove water or measure with a stick. Note: water present." checkbox.
5. "Long damage?" — width at ≥ 3 points (tape photo each).
- Then **UX-F03 Analysis**: PINN card: "Expected life of a proper repair: {P10}–{P90} months (most likely {P50})" `LifeRangeChart` with chips; "Suggested repair: {type}" with [Accept] [Choose another] (reason required). Fair-cost card: "Fair cost: Rp {lo}–{hi}" + "Show inputs" (each input with chip). Button "Send to coordinator".
- Copy: "This is a suggestion from a physics model. You decide."

### 4.3 COORDINATOR (desktop)

**UX-K01 Queue**
```
┌────────────┬───────────────────────────────┬──────────────────────┐
│ Queue  (42)│ Filters: [All authorities ▾]  │ Case CASE-0193       │
│ Map        │ [Dangerous] [Overdue] [Low-   │ [photo]  Dangerous   │
│ Assign     │  confidence road owner]       │ Pothole · Medium size│
│ Follow-ups │───────────────────────────────│ Road: Provincial ✓   │
│ Transfers  │ ● Dangerous  Jl. Matraman  D3 │ Office: Sudin BM Jak-│
│            │ ◐ Medium     Jl. Pramuka   D9 │  Tim · Satpel Matraman│
│            │ ? Owner unsure Jl. X       D1 │ Duplicates: 2 nearby │
│            │ ...                           │ [Merge] [Assign]     │
│            │                               │ [Transfer…] [Reject…]│
└────────────┴───────────────────────────────┴──────────────────────┘
```
- Header: "Queue · {n} open". Row = severity badge, road, age "Day {d}", SLA ring, owner confidence.
- Merge: "Merge {n} reports into one case? Reporters keep their credit." [Merge].
- Transfer dialog: "Send to another authority" → select authority → **SK citation required**: "Which decree says this road is theirs? (e.g., Kepmen PUPR 1688/KPTS/M/2022)" + reason. Button disabled until filled.
- Assign: inspector picker shows workload count; crew picker hides anyone linked to the contractor on that package (SoD).
- Follow-ups tab: calendar of 1/3/6-month checks, "after first heavy rain" and "before end of maintenance period" items.
- Charts: §9.

### 4.4 APPROVER (PPK)

**UX-A01 To approve**
```
┌──────────────────────────────────────────────────────────────┐
│ To approve (5)                                              │
│ CASE-0193 · Jl. Matraman · Recommended by: Inspector (R-12) │
│ Plan: Full-depth hot-mix patch · 3.4 m² · 45 mm deep        │
│ Fair cost: Rp 2.1–2.6 million [inputs]  Budget left: Rp …   │
│ Expected life: 18–40 months (P10–P90)  [MEASURED inputs: 4] │
│ ⚠ You recommended this plan? You cannot approve it.        │
│ [Approve plan]  [Send back…]  [Reject…]                     │
└──────────────────────────────────────────────────────────────┘
```
- SoD block (if same person): button hidden; text "You recommended this plan, so someone else must approve it." Allowed legal overlap (e.g., KPA acting as PPK): "Allowed overlap: KPA acting as PPK. This will be logged."
- Approve confirm: "Approve this plan and budget? This is recorded and cannot be undone. Corrections are added as new entries."

### 4.5 REPAIR_CREW (phone)

**UX-R01 My jobs** → **UX-R02 Evidence checklist**
```
┌──────────────────────────────┐
│ Job CASE-0193 · Step 3 of 8  │
│ ✓ 1 Before photo (with card) │
│ ✓ 2 Cut square edges         │
│ ● 3 Hole clean and dry       │
│ ○ 4 Tack coat sprayed        │
│ ○ 5 Mix temperature photo    │
│ ○ 6 Layer thickness (ruler)  │
│ ○ 7 Compaction (video/passes)│
│ ○ 8 After photo + tickets    │
│ [  Take photo for step 3  ]  │
└──────────────────────────────┘
```
- Each step has one-line "Why this matters": e.g., step 5 "Asphalt that is too cool does not pack well and breaks early." Temperature input + thermometer photo; if below threshold (from `08_REPAIR_VERIFICATION.md`): "Below {t} °C. Note why, or wait for a hotter load." (flag, not a block).
- Delivery ticket: "Photo of the delivery ticket (time and weight must be readable)."
- Done: "Sent to the supervisor for checking."

### 4.6 SUPERVISOR

**UX-S01 To check**: side-by-side before/after (`BeforeAfterSlider` existing — must also have buttons "Show before"/"Show after" for WCAG 2.5.7), checklist with AI hints ("Edge gap visible?" `AI_ESTIMATE`), thickness and temperature values with chips. Actions: [Accept work] [Ask for fix…] (reason required). SoD: if the user is the crew on this job → "You did this work, so you cannot check it."

### 4.7 AUDITOR (read-only)

**UX-U01 Cases / Packages**: table with filters (authority, period, flag type). **UX-U02 Package detail**: fair-cost range vs reported spend, diff %, follow-up results, recurrence, evidence completeness %. **UX-U03 Export**: "Independent Repair Audit Report" PDF (PAVEMENT-PINN letterhead, "Bukan naskah dinas") and "Draft for agency" (unbranded, watermarked). Strings: "Export audit report (PDF)" / "Export draft for the agency's own letterhead". Flag wording only: "Needs clarification: reported spend is {d}% above the fair-cost range." No edit buttons anywhere; a lock icon + "Read-only role" in the header.

**UX-U04 Verify** (public `/verify` and QR target `/v/:docId`; behavior and exact strings owned by `07_AUDIT_INTEGRITY.md` §7.2): title "Check a document" → type a document ID or open from QR → optionally drop the PDF (hash computed in the browser, never uploaded) → "✓ This file matches the issued document" / "✗ This file is different from the issued document", version/superseded notice, timestamp status (Pending / Anchored), and the "What this proves / what it does not prove" box. Visual: big result icon (green check / hazard cross, always with text), `HashBadge`, DEMO banner for demo documents. Never styled like a government TTE QR.

### 4.8 AGENCY_HEAD

**UX-H01 Overview** (KPIs + charts §9), **UX-H02 Escalations** (cases past SLA, auto-escalated at day 2/7/14/30 — existing logic), **UX-H03 Publish delay reason**: "Tell the public why this is late" → template chips ("Waiting for budget", "Rainy season — temporary patch done", "Road belongs to another authority — transferred on {date}") + free text; preview of the public box; [Publish].

### 4.9 ADMIN

**UX-D01 Authorities & offices** (name, level, address, map pin, contact). **UX-D02 Road registry** (segment, status, SK number, SK date, source file; import CSV; conflicts list "2 segments have no SK yet" `TODO_VERIFY`). **UX-D03 Prices & wages** (UMP/UMK, IKK, asphalt price by supply point, unit prices; each row with source + date + chip). **UX-D04 Users & roles** (role assignment shows SoD conflicts: "This person is linked to contractor X on package Y. They cannot supervise it.").

---

## 5. Empty, loading, error, offline states (exact strings)

| Situation | Visual | Text |
|---|---|---|
| Map loading | Skeleton map tiles + Pavi `walk` small | "Loading the map…" |
| Map tiles fail | Fallback list view | "Map didn't load. Showing a list instead. [Try again]" |
| No reports nearby | Pavi `idle` | "No reports near you yet." |
| Queue empty | Pavi coordinator `celebrate` | "Queue is empty. Every case has an owner." |
| AI service down | Banner cone | "Photo check is offline. Your report is saved and a person will check it." |
| SLM unavailable | AiDraftBlock replaced by template | "AI writer is off. Using the standard template." (chip `TEMPLATE`) |
| Server error (5xx) | ErrorState + Pavi `worried` | "Something went wrong on our side. Your data is safe. [Try again]" |
| Permission denied (403) | ErrorState | "Your role can't open this page. Ask your admin if you need access." |
| Not found | Pavi `sleep` | "We can't find that page. [Go to map]" |
| Offline | Top banner ink fill | "You're offline. New reports are saved and sent later." + count "{n} waiting" |
| Back online | Toast green | "Back online. Sent {n} reports." |
| Upload too big | inline | "Photo is too large. We made it smaller ({kb} KB)." (auto-compress ≤ 500 KB) |
| GPS off | full card | "Turn on location so we know where the damage is." |
| Measurements missing (Evidence page) | value "–" + chip `TODO_VERIFY` | "Not measured yet." |

Loading rules: skeletons for lists/cards (no spinners > 300 ms without text). Any wait > 2 s shows what is happening ("Checking photo on the server…"). Any wait > 10 s offers "Keep waiting" / "Save and continue later".

---

## 6. Animations and micro-interactions

| # | What | When | Why | Spec | Reduced motion |
|---|---|---|---|---|---|
| A1 | Shutter press | Tap shutter | Confirms capture | Button scale .92 → 1 (80 ms) + white flash overlay 120 ms + haptic 10 ms | Flash only, no scale |
| A2 | AI scan sweep | While `/v1/screen` runs | Shows work is happening | Cyan bar sweeps over photo 1.6 s loop; Pavi `scan` | Static "Checking…" text |
| A3 | Detection boxes | Result arrives | Shows what AI saw | Boxes draw stroke 0→100 % in 300 ms, label fades in | Appear instantly |
| A4 | Route-to-office line | After routing | Makes "bridge to the right office" visible | Dashed line animates from pin to office icon 600 ms, office card slides up | Show final line |
| A5 | Send success | Report accepted | Reward | Pavi jumps (spring), 40-particle confetti 900 ms, yellow ring pulse | Pavi swaps to `celebrate` pose, no confetti |
| A6 | SLA clock tick | Each day boundary / open | Shows time pressure | Ring arc grows 400 ms; color shift at 75 %/100 % | Instant |
| A7 | Timeline step done | Status change | Progress feeling | Dot fills, connector grows 220 ms | Instant |
| A8 | Pending pulse | Offline queue item | "Still waiting" | Opacity .6↔1, 2 s | Static clock icon |
| A9 | Badge unlock | Quest complete | Motivation | Tile flips (rotateY 180°, 500 ms), shine sweep, Pavi `celebrate` | Fade in 120 ms |
| A10 | Streak flame | Daily first action | Habit | Flame scales 1→1.15→1 | None |
| A11 | Map fly | Tap list row | Keeps context | `flyTo` 800 ms | `jumpTo` |
| A12 | Bottom sheet | Open/close | Spatial model | translateY with `--m-slow`/`--m-exit`; drag handle **plus** buttons (2.5.7) | Instant |
| A13 | Number count-up | KPI tiles first view | Draw eye | 0→value 600 ms, tabular nums | Show value |
| A14 | Hash seal | Event appended | Shows tamper-evident chain | Small chain-link icon "clicks" (rotate 15°) + hash fades in | Fade only |
| A15 | Mismatch shake | Depth mismatch flag | Attention | Input shakes 3× 6 px, 300 ms + red text | Red text only |
| A16 | Life range reveal | PINN result | Explain uncertainty | Band expands from P50 outward 500 ms | Instant |

Rules: no animation blocks input; max one celebratory animation per screen; no autoplaying loops on staff dashboards except the pending pulse; everything ≤ 60 fps on low-end (animate only `transform`/`opacity`).

---

## 7. Mascot "Pavi" — variants per role

Extend `src/components/brand/Pavi.tsx` (keep existing props and `paviMarkerHtml`). New props:

```ts
type PaviRole = 'citizen'|'inspector'|'coordinator'|'approver'|'crew'|'supervisor'|'auditor'|'head'|'admin';
type PaviMood = 'idle'|'scan'|'found'|'celebrate'|'worried'|'sleep'|'walk'|'point'|'think';
<Pavi role="inspector" mood="scan" size={72} title="Inspector Pavi" />
```
`role` sets defaults for `helmet`, `vest`, `accessory`; explicit `helmet`/`vest` still override (avatar builder). Accessories are separate `<g>` groups drawn in the 72×83 viewBox; keep each variant < 3 KB SVG. All colors from tokens.

| Role | Body (cone) | Vest band | Accessory (SVG group) | Signature pose/mood | Where used |
|---|---|---|---|---|---|
| Citizen | Signal yellow `#FFC72C` | White | Phone in right hand (rounded rect 8×14, ink, cyan screen) | `point` at camera, `celebrate` on send | Citizen screens, map marker |
| Field Inspector | Cone orange `#FF7A1A` | Yellow reflective + 2 white stripes | Folding ruler (yellow with ink ticks) in hand; small marker-card on base | `scan` (visor sweep) / `think` | Site check, measure |
| Coordinator | Intel blue `#0068B5` | White | Headset arc over antenna + clipboard | `point` (arm to side) | Queue, assign |
| Approving Officer | Ink `#0D1015` | Yellow | Round stamp (red ring, ink handle) | `think` → `found` (stamp down 120 ms on approve) | Approve screens |
| Repair Crew | Signal yellow | Cone orange | Hard-hat brim + small shovel or tamper | `walk` (feet alternate) | Jobs, evidence |
| Works Supervisor | Green `#12A06A` | White | Magnifying glass (ink ring, cyan lens) | `scan` over glass | Supervisor check |
| Auditor | White cone with ink outline | Physics cyan | Shield with check + tiny chain links | `idle`, never celebrates (neutral) | Audit pages, verify page |
| Agency Head | Ink with yellow top stripe | Yellow | Small flag/pennant on antenna + megaphone for "publish delay reason" | `point` | Head dashboard |
| Admin | Slate `#475569` | White | Gear badge on chest, wrench | `think` | Admin |

Mood visuals (existing + new): `point` = right arm (6×18 rounded rect) raised 30°; `think` = visor eyes look up-left, "…" bubble; `worried` keeps current eyebrow lines. Animations stay in CSS (`pavi-*` classes): idle bob 2.4 s (translateY 0→−2 px), blink every 4 s, antenna glow on `found`, feet alternate on `walk`. Reduced motion → static pose.

Accessibility: decorative Pavi = `role="presentation"`; meaningful Pavi (empty states) gets `title`. Never put essential instructions only in Pavi's speech bubble — the same text appears as normal text.

Map marker: citizen's own location = Pavi citizen head-only 32 px with a halo (accuracy circle drawn separately as a translucent cyan disc sized to `coords.accuracy`).

---

## 8. Map legend (authority colors)

Authority lines are drawn **under** damage pins. Colors avoid yellow/orange/red (reserved for severity). Each level also has a unique **line pattern**, so the map works for color-blind users and in grayscale. Non-text contrast vs white basemap ≥ 3:1 for all.

| Level (EN / ID) | Line color | Width | Pattern | Who usually fixes it (label text) |
|---|---|---|---|---|
| National / Jalan Nasional | `#1D4ED8` blue (6.7:1) | 6 px | Solid | "National road · BBPJN/BPJN (Ministry of Public Works)" |
| Provincial / Jalan Provinsi | `#7B3FB0` purple (6.6:1) | 5 px | Solid with white center line 1 px | "Provincial road · Provincial Public Works office (Dinas/UPTD)". In Jakarta: "Dinas Bina Marga DKI Jakarta · Sudin Bina Marga {kota} · Satpel {kecamatan}" |
| Regency / Jalan Kabupaten | `#0B7A50` green (5.4:1) | 4 px | Solid | "Regency road · Dinas PU/PUPR {kabupaten}" |
| City / Jalan Kota | `#0F766E` teal (5.5:1) | 4 px | Long dash 10-4 | "City road · Dinas PU/Bina Marga {kota}" |
| Village / Jalan Desa | `#8A6100` ochre-brown (5.5:1) | 3 px | Short dash 4-3 | "Village road · Pemerintah Desa {desa}" |
| Toll / Jalan Tol | `#0D1015` ink | 5 px | Solid with 2 px white casing + "TOL" shield every 400 px | "Toll road · {operator (BUJT)}" |
| Special / Jalan Khusus | `#475569` slate (7.6:1) | 3 px | Dotted 1-3 | "Special road · owner: {institution}" |
| Unknown / not confirmed | `#8B95A1` grey (3.0:1) | 3 px | Dash 6-4 + "?" chip at midpoint | "Owner not confirmed. A coordinator will check." |

Damage pins (on top): circle 28 px (hit area 44 px), ink 2 px outline, fill = severity token, white/ink glyph. Clusters: ink circle with white count. Fixed = green check pin (shown for 30 days, then hidden by default). Failed again = hazard ring + `RotateCcw`.

Offices: building icon (ink on white rounded square 28 px) with level color stripe at the bottom; tap → name, address, hours, phone/WhatsApp, "Directions" link. Data from `data/` (written by other writers); missing addresses show `TODO_VERIFY`.

Confidence: lines whose assignment came from the fallback heuristic (`04_AUTHORITY_ROUTING.md`) are drawn at 60 % opacity plus the "?" chip, regardless of level.

Legend sheet layout: title "Who fixes which road?", one row per level (swatch with real pattern 40×8 px, name, one-line who), toggle checkboxes "Show on map", footer "Road status from: {source list} · last updated {date}". Legend button on map: `Layers` icon + text "Legend".

Dark mode: lighten each line color ~25 % (keep patterns).

---

## 9. Charts per dashboard

Use `recharts`. Every `ChartCard` has: title as a question, plain one-sentence takeaway under it (generated by code from data, not AI), source chip, "as of" date, and a "Show table" toggle (accessible data table). If data is missing: show the empty frame + "Not enough data yet ({n} of {min} needed)". **Never draw charts from mock data outside DEMO mode.**

| Dashboard | Chart | Type | Data source |
|---|---|---|---|
| Coordinator | "How old are open cases?" | Horizontal bar by age band (0–2, 3–7, 8–14, 15–30, >30 days), colored by severity | cases |
| Coordinator | "Which authority owns our queue?" | Bar by authority level (legend colors + patterns as bar textures) | cases |
| Coordinator | "Follow-ups due this month" | Calendar strip (14-day) count per day | follow-up schedule |
| Agency Head | "How fast do we fix?" | Line: median days report→repair per month, with target line | cases |
| Agency Head | "Do repairs last?" | Bar: % of repairs still OK at 1/3/6 months (with n under each bar) | `measurements/recurrence.json` + follow-ups |
| Agency Head | "Late cases and reasons" | Stacked bar by delay-reason template | escalations |
| Auditor | "Reported spend vs fair cost" | Scatter: x = fair-cost midpoint, y = reported; shaded band ±20 %; points outside = "Needs clarification" (cone outline) | audit packages |
| Auditor | "Evidence complete?" | 100 % bar per package: steps with photos vs missing | repair evidence |
| Auditor | "Early failures inside maintenance period" | Count by month, split permanent/semi-permanent | warranty flags |
| Inspector | "Expected life of this repair" | `LifeRangeChart`: P10–P90 band, P50 tick, observed marker after follow-ups | PINN-2 output |
| Public Evidence (`/bukti/`) | "Speed on each Intel device" | Grouped bar: p50 latency per model × device (CPU/GPU/NPU), FP32 vs INT8 | `measurements/bench_*.json` |
| Public Evidence | "Accuracy on Indonesian photos" | Bar per class: F1@0.5 with 95 % CI whiskers | `measurements/cv_eval_*.json` (see `10_AI_ML_PLAN.md`) |
| Public Evidence | "PINN vs plain network" | Bar: relative L2 error with/without physics loss | `measurements/pinn1_ablation.json` |
| Why page | "Who owns damaged roads?" | Bar by authority level (sourced numbers only, see §11) | static, cited |

Chart styling: 1 px grid `--pp-line`, axis text `--pp-text-3` 12 px, bars radius 4, tooltips large (16 px), no 3D, no pie charts for > 4 categories. Severity colors only for severity; authority colors only for authority; cyan only for physics; Intel blue only for Intel device data.

---

## 10. Accessibility (WCAG 2.2 AA) — checklist with tests

| Criterion | Rule in this app | Test |
|---|---|---|
| 1.1.1 Non-text content | Every photo has alt: "{class} on {road}, reported {date}"; decorative Pavi presentation | axe in Playwright |
| 1.3.1 / 1.3.2 | Semantic headings, lists, `<table>` for tables, form labels | axe |
| 1.4.1 Use of color | Severity/authority/status always icon/pattern + text | visual review + unit test that `SeverityBadge` renders text |
| 1.4.3 / 1.4.11 Contrast | Tokens in §1 only; text ≥ 4.5:1; UI ≥ 3:1 | script `scripts/check-contrast.ts` over tokens (fail CI) |
| 1.4.4 / 1.4.10 Resize/reflow | Works at 200 % zoom and 320 px width, no horizontal scroll | Playwright at 320×640 |
| 2.1.1 Keyboard | All staff flows keyboard-only; map has list alternative | Playwright keyboard test |
| 2.4.7 / 2.4.11 Focus visible, not obscured | 2 px Intel-blue ring + white offset; sticky bars never cover focused element (`scroll-margin`) | manual + test |
| 2.5.7 Dragging | Sheets, slider, map have button alternatives | test buttons exist |
| 2.5.8 Target size | ≥ 24×24 px everywhere; ≥ 48 px primary on mobile | unit test on Button sizes; axe target-size rule |
| 3.2.6 Consistent help | "Help" in the same place (Me → Help; staff top bar ?) | review |
| 3.3.1 / 3.3.3 Errors | Inline error text + how to fix | unit tests on forms |
| 3.3.7 Redundant entry | GPS and road auto-filled; never ask twice | review |
| 3.3.8 Accessible authentication | No passwords for citizens; staff login supports password managers + OTP paste; no CAPTCHA puzzles | review |
| 4.1.2 Name/role/value | Custom controls have ARIA; live regions for AI results (`aria-live="polite"`) | axe |

Add `@axe-core/playwright` as a devDependency for e2e (allowed: test tooling only). Target: 0 serious/critical violations on UX-C01..C08, UX-F02, UX-K01, UX-A01, UX-U02, `/why/`, `/bukti/`.

Other inclusion: base font 16 px; "Large text" option (+2 steps); simple-icon mode on citizen camera (icons + one word); Indonesian toggle; screen-reader text for map ("List view" toggle shows the same data).

---

## 11. Low-end devices and offline

- **Budgets:** initial JS ≤ 250 KB gzip for citizen routes (code-split staff, 3D, PDF, charts); LCP ≤ 2.5 s on Moto G-class over "Fast 3G" in Lighthouse; map style uses vector tiles with simple style (no 3D buildings, no terrain).
- **Photos:** compress on device to ≤ 500 KB (longest side 1600 px, JPEG q≈0.75; step down until under budget), strip EXIF client-side (server strips again).
- **Offline queue:** reports (photos as Blobs + metadata incl. nonce, GPS, motion sample, device time) stored in IndexedDB; Workbox Background Sync where supported, else retry on `online` event and on app open. Nonce expiry is extended for queued captures by recording capture-time server nonce; if the nonce expired, server accepts with `capturedOffline=true` and lower trust (see `05_CAPTURE_AND_MEASUREMENT.md`).
- **Cache:** app shell + fonts + last viewed map area tiles (≤ 20 MB, LRU) + own reports.
- **Data saver mode** (auto on `navigator.connection.saveData` or effectiveType ≤ 3g): no map tiles until tapped ("Show map"), list view first, thumbnails 160 px.
- **No-JS / very old browser:** `/why/` and `/lacak/:code/` server-render readable HTML (P2).
- **Battery:** long-stretch GPS uses `watchPosition` with `maximumAge 1000`; stops on End or after 30 min idle with warning.

---

## 12. "Why this matters" public page (`/why/`)

Purpose: judges and citizens understand the problem in 60 seconds. Every number on this page comes from `14_BACKGROUND_STORY.md` "safe to put on a slide" list, with a footnote link. Incident cards may also be loaded from `data/incidents.csv`, **only rows with `status = VERIFIED` and `verified = Y`** (never `PARTIAL`/`N`). Each fact block has `OFFICIAL` (government/court/BPK data) or a "Reported by {outlet}" caption (news). No facts from the "do not claim" list.

Structure:
1. **Hero** — display text: "A small hole can kill. A big one can cut off a village." Sub: "We connect your photo to the office that must fix the road — and check the fix lasts." CTA buttons: [Report damage] [Take the 60-second tour].
2. **Problem 1 — Damage, small and large** (three fact cards + one chart):
   - "27 pothole crashes in 28 days in Greater Jakarta (Jan 2026): 1 dead, 8 badly hurt." — Polda Metro Jaya via detikOto.
   - "Four riders died in 13 days on one damaged road in Pasar Kemis, Tangerang (Feb 2026)." — reported by VOI.
   - "About 6,000 potholes in Jakarta after January 2026 rains; most got temporary patches." — CNN Indonesia.
   - Chart "Who owns damaged roads?" using PUPR kemantapan 2023 (national 92 %, provincial 72 %, regency/city 58 % in good-or-fair condition) — Kontan, 14 May 2023. (Use BPS 2024 per-level figures only after the BPS table check in `14_BACKGROUND_STORY.md`.)
   - "What counts as small?" explainer: illustration of a 15–25 cm deep hole (depth reported in the Pasar Kemis crashes) next to a motorcycle wheel; text "Holes like this can throw a rider into traffic. Hidden under water, riders can't see them."
3. **Problem 2 — Reports go nowhere until they go viral**:
   - "Lampung: residents said 10 years of complaints brought no repair. One viral TikTok brought the President and Rp 800 billion (May 2023)." — Republika, Kontan.
   - "Central Java's own app: only about 5 % of road reports were for the roads it could fix (2019)." — Antara Jateng.
   - "The national complaint system's own ministry averaged 5.2 days to verify reports, against a 3-day target (2023)." — KemenPANRB.
   - Ombudsman quote card: "Public service fairness must not depend on social media algorithms." (translated; original ID quote shown on tap) — Ombudsman RI, Jul 2026.
4. **Problem 3 — Money spent, roads fail again**:
   - "BPK found Rp 141.13 billion of work paid but not delivered (volume shortfall) in 83 local governments (IHPS II 2024)." — BPK.
   - "Court case, Simeulue (Aceh): 95 % paid when work was 65 % done; asphalt thinner than the design." — MA via Dandapala.
   - "Alor (NTT): new hot-mix cracked 1–2 days after paving (2022)." — Kompas via BPK NTT clipping.
   - "Jakarta, April 2026: officers sanctioned for AI-edited 'job done' photos." — Metro TV.
5. **How PAVEMENT-PINN helps** — 3-step graphic: Report (live photo + GPS) → Escort (right office, public clock, escalation) → Audit (physics life range, fair-cost range, follow-ups, tamper-evident record). One line: "We feed existing channels like SP4N-LAPOR! and JAKI. We are not another inbox."
6. **What we do not claim** — short box: "We don't accuse anyone. We show where data and reality don't match, so the right people can check." "AI suggests; officials decide." "Numbers we haven't measured are marked."
7. **Sources** — numbered list with links and access dates.

Layout: single column, max width 680, each block = big number (metric font) + one sentence + source caption. Sticky "Report damage" button on mobile.

---

## 13. Judge-facing guided demo path (≤ 60 s)

Route: `/tour/` (also opened by QR on the deck). Runs on the seeded case `DEMO-0001` (all records stamped `DEMO`). A top progress bar with 6 dots; "Next" button (48 px) and auto-advance off by default (judges control pace). Every step has a one-line caption in large text. Works on phone (portrait) and laptop.

| Step | Time | Screen | Caption (exact) | Pavi |
|---|---|---|---|---|
| 1 | 0–8 s | Map with authority colors around Matraman, Jakarta | "Every road has an owner. Colors show who must fix it." | citizen `point` |
| 2 | 8–20 s | Camera (demo photo) → AI box → routed office (A4 animation) | "A citizen takes a live photo. AI finds the pothole and sends it to the right office." | citizen `scan` → `celebrate` |
| 3 | 20–32 s | Inspector measure: ruler photo, typed 45 mm, AI read-back ✓; PINN life range | "An inspector measures depth with a ruler. Physics gives a life range for a proper repair." | inspector `scan` |
| 4 | 32–42 s | Fair-cost range vs reported spend → "Needs clarification" | "We estimate a fair price from official unit prices. Big gaps get a neutral flag." | auditor `idle` |
| 5 | 42–52 s | Repair evidence checklist + follow-up calendar (1/3/6 months) | "Repair crews upload proof. Citizens re-check at 1, 3 and 6 months." | crew `walk` |
| 6 | 52–60 s | Audit PDF + verify page ✓ hash match | "Every step is sealed. Anyone can check the report was not changed." | auditor `found` |

End card: "Try it yourself: [Report as a citizen] [Open staff view] [See our test results]". A small line: "This tour uses demo data. Real pilot numbers are on the Evidence page." Pre-cache all tour assets on first load so it runs offline.

---

## 14. Gamification (citizen)

Rules (enforced server-side; UI only displays):
- XP and badges only for **verified** actions (report verified by inspector or merged into a verified case; follow-up photo accepted). Unverified = "Pending" grey, no XP.
- Rate limit: max 10 reports/day/device; XP cap per day (existing cap).
- Trust score (not shown as a number to the user; shown as level "New", "Trusted", "Very trusted"); phone OTP raises it.
- Duplicate confirmations earn small XP only once per case.

**UX-C09 Quests**
```
┌──────────────────────────────┐
│ Quests            🔥 3 days  │
│ ┌──────────────────────────┐ │
│ │ First report        ✓    │ │
│ │ Report one damaged spot  │ │
│ └──────────────────────────┘ │
│ ┌──────────────────────────┐ │
│ │ Repair checker   1/3     │ │
│ │ Check a fixed road at    │ │
│ │ 1, 3 and 6 months  ▓░░   │ │
│ └──────────────────────────┘ │
│ ┌──────────────────────────┐ │
│ │ Duplicate detective 2/5  │ │
│ │ Confirm reports that are │ │
│ │ the same spot            │ │
│ └──────────────────────────┘ │
│ [See badges]                 │
└──────────────────────────────┘
```
Quest list (strings): "First report — Report one damaged spot." / "Long-stretch walker — Record one long stretch with 3+ photos." / "Repair checker — Check a fixed road at 1, 3 and 6 months." / "Rain checker — Check a fixed road after the first heavy rain." / "Duplicate detective — Confirm 5 reports that show the same spot." / "Neighbourhood guard — 5 verified reports in your area." Each quest shows *why it helps*: e.g., Repair checker "Your checks show if a repair really lasted."

**UX-C10 Badges**: grid of `BadgeTile` (64 px icon, name, date earned, locked ones greyed with "How to get it"). Badge names: Road Spotter, Long Walker, Repair Checker, Rain Watch, Duplicate Detective, Neighbourhood Guard, 6-Month Keeper.

**UX-C11 Certificate claim** (unlocked after: ≥ 3 verified reports + ≥ 1 completed 1-month check, configurable)
```
┌──────────────────────────────┐
│ You earned a certificate!    │
│ Pavi(celebrate)              │
│ Name on certificate          │
│ [ Nadia Putri            ]   │
│ This name is printed only on │
│ the certificate. It is not   │
│ shown on your reports.       │
│ [ Create my certificate ]    │
└──────────────────────────────┘
```
- Name rules: 2–60 characters, letters/spaces/'.-; preview before creating; one free rename within 24 h.
- Output: PDF (A4 landscape) with PAVEMENT-PINN letterhead (no government emblem/kop), name, achievements list (counts only), date, certificate ID, QR → `/v/:docId` (document kind `certificate`, see `07` §7) showing "Valid certificate for {name}, issued {date}" (name visible only on this page because the holder chose it). Footer: "Community contribution certificate. Not an official government document."
- Privacy: name stored only in the certificate record, linked to the pseudonymous device ID; never written to the audit chain (hash only).

---

## 15. Definition of Done (UI/UX)
- [ ] Tokens in `index.css`; contrast script passes; light default, dark works.
- [ ] Barlow fonts loaded with offline fallback.
- [ ] All screens UX-C01..C12, F01..F03, K01, A01, R01..R02, S01, U01..U04, H01..H03, D01..D04 reachable for their role; others get 403 state.
- [ ] Every number rendered through `SourceChip`-aware component (lint rule or unit test: `StatTile` without `source` throws in dev).
- [ ] Demo mode banner + `DEMO` stamps everywhere demo data appears; no gallery input in production build (test).
- [ ] Map legend with 8 levels + patterns; tapping a road shows owner + SK + confidence.
- [ ] `/why/` and `/tour/` work on a phone via public HTTPS; tour ≤ 60 s.
- [ ] Reduced motion honored (Playwright with `reducedMotion: 'reduce'`).
- [ ] axe: 0 serious/critical on listed screens; 320 px reflow OK.
- [ ] Offline queue: report while offline, reconnect, report arrives once (e2e).
