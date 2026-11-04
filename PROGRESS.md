# PROGRESS — Nirikshan (Infomatrix HackOps 2)

**Spec:** `PLAN.md` (this repo root). Build order Phase 0 → Phase 6, gates + checkpoints CP0–CP6.
**Started:** 2026-11-04 06:11 · **OS:** Windows 10 (Git Bash / MINGW64 shell) · **Python:** 3.12.10 · **Node:** v24.18.0, npm 11.16.0

## Phase checklist

- [x] Phase 0 — scaffold, venv, pinned deps, `config/*.json`, `docs/` → **CP0** (committed `d5b5f60`)
- [x] Phase 1 — `schema.sql`, `seed.py`, `verify_seed.py`, demo numbers contract → **CP1** (31 checks, 0 failures)
- [x] Phase 2 — backend core modules + API + tests green on 8010 → **CP2** (50 tests, OK)
- [x] Phase 3 — `agent.py` + offline fallback, DRAFT stamp → **CP3** (81 tests, OK; draft = DRAFT)
- [x] Phase 4 — **scope changed by the user:** frontend is handed to another agent. No React
      app, no npm. Deliverables = minimal `frontend_fallback/index.html` + generated
      `docs/FRONTEND_SPEC.md` / `docs/openapi.json` → **CP4** (committed `9e50396`)
- [x] Phase 5 — **scope changed:** verify by API that air, land, alerts and reports data are
      exposed, and that the spec lists everything the UI needs → **CP5** (21/21 coverage rows
      green, §13 of the spec)
- [ ] Phase 6 — README, rehearsal, offline check, submission, `TRANSFER.md` → **CP6**

## Environment notes (read before running any command)

- This session's shell is **Git Bash on Windows**, not PowerShell. The PLAN `PY` shorthand
  (Windows row) resolves here to `./.venv/Scripts/python.exe` — forward slashes, same venv
  interpreter as `.\\.venv\\Scripts\\python.exe`. Linux agents use `./.venv/bin/python`.
- Venv is NOT activated; every Python command uses `PY` explicitly. Never bare `python`/`python3`.
- `nirikshan.db` is generated, never committed (see `.gitignore`).
- Dev server port **8000**; tests boot uvicorn on **8010** against a temp DB copy. Never mix.

## Notes / decisions

- `config/rules.json` contains the verbatim §5.3 contract **plus** an additive
  `land_proximity` block (§10 weights: school 30 / water 30 / road 20 / duration 20).
  No contract key was renamed or removed — this keeps §2 rule 6 (no magic numbers in code)
  true without breaking the frozen schema.
- `config/aqi.json` contains the verbatim §5.2 contract **plus** `index_bounds`, the
  NO2/SO2/O3/CO breakpoint rows the `_note` asks for, and `units`. Non-PM rows are labelled
  "demo excerpt — verify against CPCB" in both the config and `docs/cpcb_aqi_excerpt.txt`.
  The S6 AQI contract number uses PM10 only, which is a confirmed NAQI row.
- **Phase 1 ran before Phase 2 modules on purpose.** Four of the §6.7 contract rows are
  clustering outcomes, so `graph.py`, `wqi.py`, `aqi.py`, `anomaly.py`, `forecast.py`,
  `db.py` and the clustering part of `rules.py` were written during Phase 1 to make
  `verify_seed.py` able to assert them. Phase 2 adds `standards.py`, `agent.py`, `app.py`
  and the tests, not a rewrite of these.
- §6.7 pins zone_3 at chlorine ~0.03 *and* turbidity ~8.5 at the same node. A generic
  pipe generator cannot satisfy both (low chlorine needs a long/high-k chain, high
  turbidity needs a short one), so `seed.py` hand-authors `PIPE_SPECS`: Ward 3 hangs off
  `plant_n -> res_hill -> pump_1 -> J02 -> J03 -> J04 -> zone_3` with Σk·dt ≈ 0.83 across
  6 hops, one hop dated 2002 to hold turbidity down. Measured: turbidity 8.962,
  chlorine 0.0382, WQI 94.4 (Unsafe). Ward 1 sits on a new 1996/2006/2010/2012 branch so
  its sibling sensors stay inside limits, which is what makes S5 a building-side case.
- S4 (zone_5 forecast) is a **pure straight line** 0.315 -> 0.235 with no daily cycle and
  no noise, and `forecast.py` uses `eps = 1e-9` in the trend test: any noise moves the
  crossing off the pinned 21 h.
- **Clustering refinement (documented in `backend/rules.py`).** §7.7 chooses the shared
  node among candidates by (a) most complaints. Unscoped, the treatment plant wins every
  time — its subtree contains all 12 complaining buildings — and the whole night's demo
  collapses into one plant case with zone_3, zone_4 and B11 left with none. §7.7 step 1
  itself says `water -> lca(buildings)`, and §1 says "5 scattered complaints about **one
  ward** collapse into 1 case", so PLACE is ward-scoped (the building's parent zone) first;
  within a ward the candidate is `lca(buildings)`. The three tie-breaks then order the
  ward candidates. Nothing else about §7.7 changed and no seed number was touched.
- Windows console renders the `§` in test labels as `` (e.g. "pipes ~79 (6.2)").
  Cosmetic only, on `cp1252` stdout; the files and assertions are UTF-8 and correct.
- **`standards.py` is the only place a standards row is written.** The UI, the case payload
  and `seed.py` all read the same 13 rows generated from `config/limits.json` +
  `config/aqi.json`, so a citation can never disagree with the limit the classifier used.
  NAQI rows pair the 6 concentration breakpoints with `index_bounds[0..5]`; `index_bounds[6]`
  (500) is the above-range clamp, which is why the startup validator checks
  `len(index_bounds) >= len(*_breakpoints)` and not equality.
- **The trace reveal is physics, not a string.** `/api/cases/{id}/trace` narrates the pipe
  with the **highest `decay_k`** on the path (§6.3), which lands on `P048` (J02 -> J03, CI,
  1991, 150 mm, k = 0.257) — the same pipe the demo script promises the judge will see in
  red. Hardcoding "the oldest pipe" narrated the 1986 DI trunk instead (k = 0.143).
- `backend/app.py` validates all three config files at import (`validate_config()`) and
  fails fast, including the weights-sum, wqi-band-coverage and breakpoint-length checks —
  it caught the `index_bounds` assumption on the first import. Separately, three magic
  literals were removed while writing Phase 2: the case-id year (`db.next_id` now derives
  it from `demo_now()`), the pipe-age reference year (`graph.py` imports `REFERENCE_YEAR`),
  and the hotspot window timestamp. Keep it that way.
- **Bug found by writing the Phase 3 test text, not by a test assertion.** `rules.cluster()`
  built its evidence `rule` string from the `ward` variable left over from the candidate
  loop instead of the candidate's own ward, so the zone_3 case publicly claimed
  `"PLACE ward zone_5"`. Fixed, and `test_cluster.test_every_water_case_names_its_own_ward`
  now checks that every water case's cited ward is one of its buildings' parents.
- **The offline agent is a floor, not a fallback.** `extract_complaint` always computes the
  keyword/regex answer first and only then merges the model's JSON over it; a number the
  model returns that does not appear in the citizen's text is thrown away (§8.4 "never
  invent numbers"), so the demo cannot be broken by a hallucinating provider.
- §8.5 maps **dust/smoke to "air pollution"**, so the keyword table follows that order and
  the bare `"dust"` category is only ever produced by a model. Matching is word-aware
  (`\bstem\w{0,3}\b` / prefix `*` / phrases), which is why "hair" is not "air" and
  "wastewater" is not a "waste" dump — both are asserted in `test_agent.py`.
- `_limit_text()` reads `acceptable` (the bound the classifier actually used) rather than
  `ideal` — for turbidity/TDS `ideal` is 0.0, and quoting that as "the standard" would have
  put a wrong number on screen. Ranges print `6.5-8.5`, one-sided rows print the bound.
- Real uploads (`data:image/jpeg|png;base64`) are written to `data/images/upload_<id>.<ext>`,
  served through the existing static mount and only then offered to a vision model; the
  seeded SVGs never reach a model. Those files are gitignored like `nirikshan.db` (they are
  user data, and Windows will not unlink a file a running StaticFiles handle holds).

## Gate results

- **Gate 0:** `PY -c "import json; ..."` -> `config ok` · committed `d5b5f60 CP0: scaffold, pinned deps, config`
- **Gate 1:** `PY seed.py` then `PY verify_seed.py` -> **31 checks, 0 failures**, exit 0
  (`set -o pipefail` — a plain pipe to `tail` hides the real exit code behind `tail`'s 0).
- **Gate 2:** `PY seed.py` then `PY -m unittest discover -s backend/tests -v` -> **Ran 50
  tests, OK**, exit 0. Gate 1 re-run after the Phase 2 edits: still 31 / 0. Tests boot on
  **8010** against a temp copy of `nirikshan.db`; port 8010 was free, no `base.py` change
  needed.
- **Gate 3:** `PY -m unittest discover -s backend/tests` -> **Ran 81 tests, OK**, exit 0;
  smoke on **8000** with `LLM_PROVIDER=offline`: `/api/health` answers with no network,
  `POST /api/cases/CASE-2026-003/draft` returns `"status": "DRAFT"` + `"ai": "offline"`,
  `POST /api/reports/daily` returns a 5-section DRAFT. Gate 1 re-run: still 31 / 0.
  **Watch stale servers:** a smoke server left listening on 8000 answers the next smoke
  run with yesterday's code. `netstat -ano | grep :8000 | grep LISTENING` before and after,
  and kill by PID (`taskkill //PID n //F`; Git Bash here has no `pkill`).
- **Gate 4 (revised scope):** `PY make_frontend_spec.py` -> `docs/openapi.json` (live
  schema) + `docs/FRONTEND_SPEC.md` (21 routes, one real captured response each) — the
  generator boots the app on 8010 against a **temp copy** of the DB, so the examples
  include the write endpoints without touching `nirikshan.db`. `PY -m unittest discover
  -s backend/tests` -> **Ran 81 tests, OK**. Smoke on **8000**: `GET /` serves
  `frontend_fallback/index.html` (200, text/html) and the browser screenshot shows the
  KPI cards filled from the live API (`2026-11-03 09:00:00`, 6 open cases, AI `offline`).
  A stale smoke server from the previous session was found holding 8000 and killed.
- **Gate 5 (revised scope):** `PY make_frontend_spec.py` now also runs `verify_coverage()` —
  21 scenarios/signals probed against the live server (S1–S8, N0, the five alert signals,
  map, hotspots, dashboard KPIs, daily report) — and prints `coverage: 21/21 scenarios
  verified through the API`. Any row whose assertion fails raises SystemExit and lists the
  rows, so the handoff cannot claim a story the API does not expose; the table is embedded
  as §13 of `docs/FRONTEND_SPEC.md` (2,852 lines, 21 routes). `PY -m unittest discover -s
  backend/tests` -> **Ran 81 tests, OK**. Nothing added to the API: air, land, alerts and
  reports were already fully exposed, which is what §13 proves.

---

## SESSION — 2026-11-04 06:11 — unattended agent (build session 1)
- Entered at: nothing (CP0 not reached). Verified by: `git log --oneline` → `fatal: your current branch 'master' does not have any commits yet`; `git status --short` → untracked `.gitignore`, `PLAN.md`, `backend/`; only `backend/__init__.py` + `backend/tests/__init__.py` existed. A prior agent had run `git init`, written `.gitignore`, moved `v2/PLAN.md` to root, and created the two `__init__.py` files, then died before Gate 0.
- Work done:
  - Confirmed PLAN.md already at workspace root (Step 1 of the start prompt was already done).
  - Read PLAN.md in full, ran §0.1 checklist A–D.
  - Created folder tree (§4), created `.venv` and installing pinned deps
    (`fastapi==0.115.6`, `uvicorn==0.32.1`, `pydantic==2.10.4`).
  - Wrote `config/limits.json`, `config/aqi.json`, `config/rules.json` (§5.1–5.3 verbatim + additive blocks).
  - Wrote `docs/is10500_excerpt.txt`, `docs/cpcb_aqi_excerpt.txt`, `docs/swm_rules_excerpt.txt`.
  - Wrote this `PROGRESS.md`.
- Left at: CP0 — gate PENDING (waiting on pip verify below).
- Blockers: none.
- Next action for the next agent: `PY -c "import fastapi, uvicorn, pydantic; print('ok')"` then `PY seed.py` / `PY verify_seed.py` (Phase 1, §6).

## SESSION — 2026-11-04 07:55 — unattended agent (build session 2)
- Entered at: CP0 (verified by: `git log --oneline` -> `d5b5f60 CP0: scaffold, pinned deps, config`; `PY -c "import json; [...]"` -> `config ok`). Work continued from session 1, which died mid-Phase 1 with an uncommitted tree.
- Work done (Phase 1 complete):
  - `schema.sql` (§6.1 DDL verbatim + two additive tables `land_meta`, `features` — no frozen table gained a column).
  - `seed.py` rewritten twice: removed dead scaffolding from the first pass, then hand-authored
    `PIPE_SPECS` to satisfy the §6.7 chlorine/turbidity pair. Deterministic (single
    `random.Random(42)` per sensor, no `time.time()`, `NOW = 2026-11-03 09:00`).
    Seeded: 98 nodes, 78 pipes, 27 sensors, 5712 water + 3360 air readings, 20 complaints,
    13 standards rows, 8 features, 4 `data/images/*.svg`, 2 historical RESOLVED cases.
  - Phase 2 modules needed by the contract rows: `backend/db.py` (PRAGMAs, `next_id` off the
    `seq` table, `demo_now`), `graph.py` (bulk load, `chain`/`depth`/`lca`/`trace`),
    `wqi.py`, `aqi.py`, `anomaly.py`, `forecast.py`, `rules.py` (clustering, severity,
    status whitelist, proximity, cross-link, hotspots).
  - `verify_seed.py` — 31 print-and-assert checks over every §6.7 row plus counts, LCA,
    trace, idempotency, S7/S8.
  - Fixed Gate 1's three failures (S1 zone_3, S2 zone_4, S5 B11) by ward-scoping PLACE in
    `rules.cluster()` — see Notes above. No seed value was changed to chase a case.
- Left at: CP1 — gate **PASS** (`PY seed.py && PY verify_seed.py` -> `31 checks, 0 failures`, exit 0).
  Case set after clustering: `CASE-2026-003` zone_3 MUNICIPAL High · `004` zone_4 MUNICIPAL Emergency
  (supply loss) · `005` zone_2 MUNICIPAL Low · `006` B11 BUILDING_SIDE Low · `007` air_08 High ·
  `008` land_05 Medium · plus the 2 seeded RESOLVED. Idempotent: second run leaves 6 open cases,
  14 -> 14 actions.
- Blockers: none.
- Next action for the next agent: Phase 2 (§7) — `backend/standards.py`, then `backend/app.py`
  with the §7.9 endpoints, then `backend/tests/` (port 8010, temp DB): `PY -m unittest discover -s backend/tests -v`.

## SESSION — 2026-11-04 09:40 — unattended agent (build session 3)
- Entered at: CP1 (verified by `git log --oneline` -> `36da67e CP1: ...`, and by re-running
  `PY seed.py && PY verify_seed.py` -> 31 / 0). Session 2 had died after writing `app.py` and
  five test files but **before ever running the suite**.
- Work done (Phase 2 complete):
  - `backend/standards.py` (§7.8) — the single generator for the 13 standards rows; `seed.py`
    now delegates to it (`build_standards`) and `app.py` syncs it in the lifespan handler.
  - `backend/app.py` (§7.9) — 21 endpoints, config validation at import, JSON error envelope
    + request-id middleware for every failure path, bulk loads only, `_agent()` lazy import so
    the Phase 2 gate passes before Phase 3 exists, static mount for `/data/images` then the UI.
  - `backend/tests/` (§7.10) — `base.py` harness (temp DB copy, in-process uvicorn on 8010,
    server shared across modules, `{"detail": ...}` envelope asserted by `expect_error`) plus
    `test_health.py`, `test_seed.py` (one test per §6.7 row), `test_cluster.py` (idempotency,
    status whitelist, the 1991-main trace reveal), `test_forecast.py` (S4 pinned 21 h, both
    forecast branches, 404 path), `test_air_land.py` (S6/S7/S8, N0, network, hotspots, images).
  - Fixes found by writing the tests: `worst` station payload key (`id`, not `station_id`);
    the binary-image request crashed the harness decoder; per-row `land_meta` query replaced
    by one bulk load; `api_headers` added so the middleware test stops hand-building URLs.
- Left at: CP2 — gate **PASS** (50 tests, OK, exit 0; Gate 1 still 31 / 0), committed as
  `CP2: backend core, all tests green`.
- Blockers: none. `BLOCKED.md` does not exist and is not needed.
- Next action for the next agent: Phase 3 (§8) — `backend/agent.py` (Provider /
  GeminiProvider / OpenAICompatProvider / OfflineProvider, `get_provider`,
  `extract_complaint`, `explain_case`, `draft_advisory`, `draft_daily`, `provider_mode` —
  `app.py` already calls `provider_mode()`), the verbatim prompts, the one-retry-then-offline
  rule, `backend/tests/test_agent.py`, then Gate 3: tests green **and**
  `POST /api/cases/{id}/draft` returns `"status": "DRAFT"`.

## SESSION — 2026-11-04 09:55 — unattended agent (build session 4)
- Entered at: CP2 (verified by `git log --oneline` -> `dd91a6b CP2: backend core, all tests green`,
  and by re-running the suite: 50 tests OK). Session 3 had committed CP2 in the same act.
- Work done (Phase 3 complete):
  - `backend/agent.py` (§8.1-§8.5): `Provider`/`GeminiProvider`/`OpenAICompatProvider`/
    `OfflineProvider`, env-driven `get_provider()` (cached per env signature),
    `provider_mode()`, `call()` + `call_vision()` implementing the one-retry-then-offline
    contract, the four verbatim §8.4 prompts, and the deterministic offline layer
    (keyword table + duration/area regex + templates for explain/advisory/daily).
  - `backend/tests/test_agent.py` — 31 tests: offline extraction (§8.5 order, word-boundary
    guards, regex numbers), provider selection from the env table, the §8.3 retry contract
    (exactly one retry, empty completion falls back, fenced JSON parsed), and the endpoint
    flows through a stub provider (canned draft, invented-number rejection, failure ->
    offline, upload stored + served, `/api/health` never calls the provider).
  - `backend/app.py`: health now reports the real configured mode; `explain_case` argument
    order matches §8.1; new `_store_upload`/`_vision` + `_standards_for_case` (the draft
    endpoint now cites the rows the case actually breaches).
  - `backend/rules.py`: fixed the leaked-`ward` bug in the evidence rule string + regression test.
  - `.gitignore`: `data/images/upload_*`.
- Left at: CP3 — gate **PASS** (81 tests OK; Gate 1 31/0; 8000 smoke: draft returns
  `"status": "DRAFT"`, `"ai": "offline"`), committed as `CP3: AI agent with offline fallback`.
- Blockers: none.
- Next action for the next agent: Phase 4 (§9.1) — **write `frontend_fallback/index.html`
  FIRST** (single file, inline CSS+JS, whole demo path, `fetch('/api/...')`), verify against
  the backend on 8000, commit; then `npm create vite@latest frontend -- --template react`,
  pin §3 versions, `npm install`, React app (theme tokens §9.2, pages §9.3-§9.6). Gate 4:
  `npm run build` exit 0 + the fallback UI walks the demo on 8000. If `npm install` fails
  offline -> BLOCKED.md + keep the fallback UI + skip to Phase 5.

## SESSION — 2026-11-04 10:20 — unattended agent (build session 5)
- Entered at: CP3 (verified by `git log --oneline` -> `030444c CP3: AI agent with offline
  fallback`) and by re-running the suite: 81 tests OK.
- **Scope change from the user:** the frontend is handed to another agent. Phases 4-6 were
  re-scoped — no React app, no `npm`, no full UI. Phase 4 = minimal fallback page +
  `docs/FRONTEND_SPEC.md`; Phase 5 = verify by API that air/land/alerts/reports are exposed
  and that the spec lists everything the UI needs; Phase 6 unchanged.
- Work done (Phase 4, revised):
  - `frontend_fallback/index.html` — a single-file "backend live, UI handoff in progress"
    page so `/` never 404s. It uses the §9.2 tokens, fills four KPI cards from
    `/api/overview` + `/api/health`, links the live endpoints and lists the demo path.
  - `make_frontend_spec.py` — the handoff generator. Boots the app on **8010 against a temp
    copy** of `nirikshan.db` (reuses `backend/tests/base.py`), writes `docs/openapi.json`
    from the live `/openapi.json`, then calls all 21 routes in demo order — including the
    write ones, which is why the temp copy matters — and emits `docs/FRONTEND_SPEC.md`:
    the five UI rules, run/serving/token/page/map prose, a route index, per-endpoint
    parameter tables read out of the OpenAPI schema, and one real captured response each.
    List payloads are sampled and long strings cut, with the exact row counts noted under
    every example, so the doc is readable without lying about shapes.
- Left at: CP4 — gate **PASS** (81 tests OK; `GET /` on 8000 serves the fallback page and
  the browser screenshot shows the KPI cards filled with live values).
- Note for the next agent: the spec is **generated**. Editing `docs/FRONTEND_SPEC.md` by
  hand is lost on the next run; change `make_frontend_spec.py` (prose in `PROSE`, calls in
  `read_endpoints`/`write_endpoints`) and re-run.
- Next action: Phase 5 as re-scoped — verify by API that air, land, alerts and reports data
  are all exposed, add the coverage table to the spec, commit CP5. Then Phase 6: README,
  offline check, PROGRESS.md final, `TRANSFER.md`, commit CP6.

## SESSION — 2026-11-04 11:30 — unattended agent (build session 6)
- Entered at: CP4 (verified by `git log --oneline` -> `9e50396 CP4: frontend handoff spec +
  minimal fallback UI`) and by re-running the suite: 81 tests OK.
- Work done (Phase 5, revised):
  - `verify_coverage()` in `make_frontend_spec.py` — 21 rows, each fetched from the running
    server and asserted: seed counts; S1 the zone_3 hero (turbidity 9.0 NTU, chlorine 0.038,
    WQI 94.4 Unsafe, coliform present, 5 complaints in CASE-2026-003); S2 the Emergency burst
    at zone_4; S3 the `flow_changed` maintenance row on zone_2 plus `evidence.flow_changed`;
    S4 the zone_5 forecast (0.235 mg/L, crossing 0.2 in 21 h, not breached); S5 BUILDING_SIDE
    at B11; S6 the dust station air_08 (AQI 312.5 Very Poor, PM10 360, 336 h of readings) and
    its air case; S7 the land_05 dump (photo, 12 days, 40 m², proximity 80 from 4 factors)
    and its land case; S8 the erosion→`res_hill` cross-link; N0 the four routine complaints
    that must stay outside every case; and the five alert signals (overdue rule, anomaly z,
    severity/scope coverage, standards citations, trace hops + worst pipe), map, hotspots,
    dashboard KPIs, daily report.
  - `main()` runs the coverage **before** the write endpoints, so the claims describe the
    seed, not the generator's own writes; a failing row raises SystemExit listing it.
  - `docs/FRONTEND_SPEC.md` §13 now carries the table plus a signal→endpoint→how-to-render
    map, so the handoff states what the data supports rather than the UI agent guessing.
  - Field-name corrections found by probing (the reason the check is worth running): the
    reading keys are `residual_chlorine_mgl` (not `chlorine_mgl`), the forecast key is
    `current` (not `now_mgl`), and hotspots are keyed by `node_id`/`score`/`factors` with no
    `ward` field.
- Left at: CP5 — gate **PASS** (`coverage: 21/21 scenarios verified through the API`,
  81 tests OK, spec regenerated at 2,852 lines / 21 routes).
- Note: `overdue` is 0/6 at the seeded demo clock — every seeded case is created at NOW, so
  nothing is 2 h actionless yet. The badge appears as soon as the clock advances; §13 states
  this so the UI does not look broken when it renders a real zero.
- Next action: Phase 6 — README, the Wi-Fi-off rehearsal of the demo, final PROGRESS.md and
  `TRANSFER.md`, commit CP6. Final line of the build: "BACKEND COMPLETE — frontend handoff
  spec at docs/FRONTEND_SPEC.md".
