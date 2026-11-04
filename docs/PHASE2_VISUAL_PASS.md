# Phase 2 — visual-first pass

Status: **complete and committed**. This document records what the pass changed, the
contracts it had to keep, the gates that prove it, and the two robustness fixes made after
the first verification round.

Scope: presentation only. No API field, route id, deep link or verdict rule was changed.
The pass was deliberately offline: no CDN, no build step, no external font/image/tile, and
no new runtime dependency.

## What shipped

### 1. Design system (`app.css`, `components.js`)

- Warm-paper canvas, deep forest as the single brand colour; water/amber/danger reserved
  for meaning. Tokens are CSS variables, system font stack only.
- `NIRI.table` emits a real `<table>` with `<thead>/<tbody>` (the empty-state path too),
  sticky headers, zebra rows and row-click navigation. It now returns a
  `.table-scroll` wrapper so wide tables scroll inside their card instead of widening the
  page.
- `.split-rail` is the shared main-column + evidence-rail layout; it collapses to one
  column below 1180 px. This fixed the 1024 px case-page overflow (a 730 px table inside a
  400 px rail).

### 2. Landing / demo role picker (`pages_landing.js`, `landing.css`)

- `#/welcome` is a split-screen page: product story on the left, three keyboard-accessible
  role cards on the right (`officer`, `citizen`, `building`).
- The role is a demo flag in `localStorage['niri.role']` only — no backend call, no auth,
  no security claim. The sidebar shows a role chip and a **Switch role** button.
- Cold first visit redirects to `#/welcome`; a deep link is remembered in
  `NIRI.state.nextHash` and restored after a role is picked.
- `?role=officer|citizen|building` opens straight into that role (same localStorage flag).
- Because the shell banner is hidden on the landing page, the landing carries its own
  footer: *Synthetic sample data · demo build* and the automated-findings disclaimer,
  including *WQI: higher = worse*.
- The brand in the sidebar is a link back to `#/welcome`.

### 3. City overview (`pages_city.js`, `city.css`)

- `#/` is now the city overview (it overrides the old dashboard export).
- Dark-green hero with four served KPIs, demo clock and node/pipe/ward counts.
- **Ward signal map** on the shared basemap with four layers: Water (served WQI colour),
  Air (served NAQI category), Complaints (count bubble), All.
- Hover tooltip, click a ward to filter the triage table, click again or use the chip to
  clear. The side rail keeps hotspots, a served WQI bar chart, and links into the network
  map.
- Lower row: triage table (server severity/status/overdue), complaint mix by domain, the
  four worst air stations, and a network preview drawn from the same `/api/network` call.

### 4. Network map on the shared basemap (`basemap.js`, `map.js`)

- One hand-authored schematic Mumbai basemap (`NIRI.basemap`) is shared by the city page
  and the network graph. No tiles, keys, downloads or images: coastline, creek, Mithi
  river, Powai lake, parks, roads, rail and labels are lon/lat paths projected into a
  1000x720 SVG.
- Two projections: `city` (wider eastern suburbs) and `local` (the five wards). The network
  map squeezes the local base by `H/720` so pipes and roads cannot drift apart.
- The fake seeded street grid was removed; pipes, air diamonds and land sites sit on real
  geography from `/api/network`.
- Ward labels get per-ward offsets; the legend is a collapsed `<details>` pill so it no
  longer covers Ward 5.
- Trace Upstream dims non-path pipes and labels, marks the path, and clears cleanly.
- Caption on both maps: *schematic base map — not to scale; synthetic city data*.

### 5. Ask Nirikshan (`backend/ask.py`, `pages_ask.js`, `ask.css`)

- New `POST /api/ask` (added in `backend/app.py`) answers offline from the served readings,
  the standards excerpt and the cases the rules engine already opened.
- Every answer carries citations of exactly three documented kinds: `doc` (with line and
  quote), `case`, `node`.
- The page shows a hero only while the transcript is empty, four suggestion chips, a
  composer (Enter sends, Shift+Enter adds a line), provider stamp, expandable doc quotes,
  and case/node chips that navigate.
- `#/ask?case=<id>` shows a case banner and pre-fills “Explain this case”; it never
  auto-sends. Case pages link here with **✦ Explain this case**.
- A floating **Ask Nirikshan** button is visible on app pages, hidden on the landing and on
  `#/ask` itself.

## Routes and demo links

| Route | Page |
|---|---|
| `#/welcome` | Landing / demo role picker (hidden from nav) |
| `#/` | City overview |
| `#/map` | Network map |
| `#/map?t=<case>` | Network map with Trace Upstream open for that case |
| `#/map?n=<node>` | Network map with the node panel open |
| `#/complaints` | Complaints + intake |
| `#/cases`, `#/cases?domain=air` | Cases list / filtered |
| `#/cases/<id>` | Case detail, including **Explain this case** |
| `#/nodes/<id>` | Node detail |
| `#/air`, `#/land`, `#/reports` | Domain pages and notes |
| `#/ask`, `#/ask?case=<id>` | Ask Nirikshan |

Demo shortcuts:

- `http://127.0.0.1:8000/#/welcome` — normal entry.
- `http://127.0.0.1:8000/#/?role=officer` — straight into the officer view.
- `http://127.0.0.1:8000/#/map?t=CASE-2026-004&role=officer` — trace demo link.

## Contracts kept

- **No verdicts in the browser.** WQI bands, AQI categories, severity, status, overdue,
  clustering and transitions are read from the payload. The UI counts rows and scales bars
  to the on-screen maximum; it never re-derives a band.
- **No renamed API fields, route ids or deep links.** `#/map?t=`, `#/map?n=` and
  `#/cases?domain=` still work.
- **Disclosure everywhere.** Every app page keeps the disclaimer banner, the
  “synthetic sample data” pill and the WQI “higher = worse” note; the landing carries both
  in its own footer.
- **Offline only.** The only `http` string in the frontend is the SVG namespace identifier.
- **No build step.** The fallback UI is served directly by FastAPI.

## Files added or rewritten

```
frontend_fallback/app.css          design system + table/split-rail fixes
frontend_fallback/components.js    real table wrapper (scroll container)
frontend_fallback/landing.css      landing styles + shell collapse + role chip
frontend_fallback/pages_landing.js NIRI.role + NIRI.pages.welcome
frontend_fallback/basemap.js       shared schematic Mumbai basemap
frontend_fallback/city.css         basemap ink, city page, network-map overrides
frontend_fallback/pages_city.js    city overview (overrides pages.dashboard)
frontend_fallback/ask.css          ask page, hero, FAB
frontend_fallback/pages_ask.js     ask page + #/ask?case= handling
frontend_fallback/index.html       styles/scripts, brand link, role chip, FAB
frontend_fallback/app.js           welcome/ask routes, role gate, deep-link memory
frontend_fallback/map.js           shared basemap, ward labels, trace dimming
frontend_fallback/pages_core.js    map caption, responsive rail, case → ask link
backend/ask.py                     offline evidence answer + citations
backend/tests/test_ask.py          12 ask tests
backend/app.py                     POST /api/ask
backend/tests/base.py              free-port, parallel-safe test harness
```

## Robustness fixes after the first verification round

### A. Test suites are parallel-safe

The harness used to bind `127.0.0.1:8010` in every process. Running `test_ask.py` and the
full suite at the same time produced port collisions and a wall of errors. `base.py` now:

- binds a socket to `127.0.0.1:0` **before** starting uvicorn, so the OS assigns a free
  port and the port is held for the lifetime of the process;
- passes that pre-bound socket to `server.run(sockets=[...])`;
- still copies the seeded DB into a per-process temp directory;
- supports `NIRIKSHAN_TEST_PORT` to pin a port when debugging.

Verified by starting `test_ask.py` and the full `unittest discover` in two processes at the
same time: **12 OK** and **93 OK**.

### B. The role gate covers hash-only navigation

The first-visit redirect lived only in `boot()`. Editing the hash by hand from `#/welcome`
could enter a page without a role. `render()` now applies the same guard: without a stored
role, any non-welcome route redirects to `#/welcome` and remembers the attempted link.
Verified with headless Chrome:

- cold `#/map?t=CASE-2026-004` → `#/welcome`; the attempt is remembered;
- manual `location.hash = '#/map?n=zone_3'` → back to `#/welcome`, no map rendered;
- picking a role → the attempted route is restored;
- `?role=officer` still opens directly;
- Switch role → picker → pick → the page under the picker returns.

## Verification

All commands are run from the repo root; `PY` means `./.venv/Scripts/python.exe`.

```bash
PY seed.py && PY verify_seed.py                     # 31 checks, 0 failures
PY -m unittest discover -s backend/tests            # 93 tests, OK
PY -m unittest discover -s backend/tests -p test_ask.py   # 12 tests, OK
```

Browser gate (headless Chrome over the live server):

- 11 routes (`#/`, complaints, cases, case detail, node detail, map, air, land, reports,
  ask, welcome) at **1366 and 1024**: content rendered, no JS exceptions, no horizontal
  overflow (max `scrollWidth - innerWidth` = 0).
- interaction gate: role picker, ward click/filter/clear, Air segment, Trace/clear,
  case → ask prefill, ask answer/citations/provider.
- role-gate gate: the five cases listed above.
- network audit: every request is same-origin; no CDN/font/tile/external URL.

## Known limitations / deliberately cut

- Phone width (<760 px) was not visually walked; 1024 and 1366 were.
- The schematic basemap is a diagram, not a survey; the caption says so.
- Ask is offline-only (the provider path exists but is not required); the transcript is
  memory-only and dies with the tab.
- Phase 1 logic bugs, image regeneration, the full `docs/TRANSFER.md` rewrite, a separate
  standards page and exhaustive retrieval were cut from this pass.
- Docs/`FRONTEND_SPEC.md` still describe the old dashboard, not the city overview or ask
  page; this document is the up-to-date map of the presentation layer.

## Commits

```
e3370de feat: wire the landing, city overview, basemap and assistant into the shell
2239d79 feat: rebuild the visual system and add the new view sources
2d509fa feat: add the Ask Nirikshan evidence assistant API
```

The two robustness fixes and this document are committed separately after those three.
