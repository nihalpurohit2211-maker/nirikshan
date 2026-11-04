# Nirikshan — complaints as sensors

A ward officer's desk for a fictional Indian city. Citizens report brown water, dust and
dumped waste; Nirikshan treats those reports as instrument readings, collapses the ones
that share an upstream cause into a single case, walks the pipe graph back to the section
most likely at fault, cites the standard it breaches, and drafts an advisory that a human
must sign before anything is called a notice.

The product is not the map. The map shows where complaints are; the **graph** shows what
they share, and that shared upstream node is the case.

## The rule that shapes everything

Verdicts come from the server, never the browser. Compliance flags, WQI/AQI bands,
severity, `overdue`, clustering and transitions are computed in Python from `config/*.json`
and served in the payload. The UI only renders what `/api/...` returns — it contains no
rule, no threshold, and no clock of its own. `PLAN.md` §12 calls this "where the truth
lives"; the acceptance checklist enforces it.

The AI never decides. `agent.py` explains a rules-engine finding in prose and drafts
letters. Every drafted block carries a `DRAFT` stamp and the provider name, and the stamp
clears only when a named officer clicks Approve.

## Run it

Windows (Git Bash), from the repo root — `PY` below means `./.venv/Scripts/python.exe`:

```bash
py -3.12 -m venv .venv                                       # or python3 -m venv .venv on Linux
./.venv/Scripts/python.exe -m pip install "fastapi==0.115.6" "uvicorn==0.32.1" "pydantic==2.10.4"
./.venv/Scripts/python.exe seed.py                            # build the synthetic city
./.venv/Scripts/python.exe verify_seed.py                     # 31 checks, 0 failures
./.venv/Scripts/python.exe -m uvicorn backend.app:app --host 127.0.0.1 --port 8000
```

Then open **http://127.0.0.1:8000/** — the API and the UI are the same process, so there is
no second server, no `npm install`, and no build step. A cold visit lands on `#/welcome`,
the demo role picker; pick **Officer** for the full desk, or open
`http://127.0.0.1:8000/#/?role=officer` to skip the picker. On Linux use `./.venv/bin/python`.

Nothing else is required. The three pinned packages are the only dependencies; the rest is
the standard library. They are also pinned in `requirements.txt` for hosting.

### Optional: run it hosted

The same process can be deployed to a container host or Render; `render.yaml` and
`Dockerfile` are in the repo. This does not change the code or the data — the synthetic
seed and the offline agent are identical. See `docs/DEPLOY.md` for the hosted path, the
free-plan sleep/disk behaviour, and the post-deploy checks. Local `uvicorn` remains the
primary, fully offline demo.

## Definition of done (all four pass)

```bash
PY seed.py && PY verify_seed.py                     # 31 checks, 0 failures
PY -m unittest discover -s backend/tests            # Ran 97 tests ... OK
PY -m uvicorn backend.app:app --port 8000           # API + UI serve from one process
PY rehearse_demo.py                                 # 17/17 beats, exit 0, on the running server
```

`rehearse_demo.py` walks the whole demo over HTTP — it files a complaint, runs clustering,
traces, forecasts, drafts, approves, advances status and reads the history — so a dead end
in the demo shows up as a failed beat rather than a surprise on stage. It writes, so
restore the pristine demo afterwards (with the server stopped):
`PY seed.py && PY verify_seed.py`.

## The 3-minute demo

Beat, page, and the call behind it. The numbers are the served ones — the seed is
deterministic, so they do not drift between rehearsals.

| Time | What you do | What the screen says |
|---|---|---|
| 0:00 | City overview | 6 open cases, worst water quality **94.4 (Unsafe)** at Ward 3 - Khadki Old Town, 18 complaints in 24 h; the ward map can be filtered by water, air or complaint volume |
| 0:15 | Click the Zone-3 case | turbidity **8.962 NTU**, residual chlorine **0.0382 mg/L**, coliform present, z = 151.6 against a baseline of 1.47 ± 0.05 |
| 0:30 | Complaints: file from B21, "Brown water from the tap since 3 days…", then Run clustering | the assistant's reading of the text is shown for confirmation; nearest sensor is Ward 3, 231 m; the report joins **CASE-2026-003**. Press clustering again — nothing changes |
| 0:45 | Evidence panel | shared cause `zone_3`, the rule verbatim (`PLACE → TIME → BEHAVIOR`), confidence 0.9 on a 0–1 scale, readings beside limits |
| 1:15 | Trace Upstream | **6 hops**, red pulse on the worst section: **P048, CI laid in 1991**, k = 0.257/h, explained in words |
| 1:45 | Standards panel | breached IS 10500 rows only, each with its citation, plus the raw excerpt |
| 2:00 | Map → click Ward 5 → full page | chlorine **0.235 mg/L now**, dashed 0.2 mg/L line, **crosses in 21 h**, `breached_now: false` so it warns rather than alarms |
| 2:20 | Cases → act two | CASE-2026-004, Emergency, **OVERDUE** badge (the server's 2-hour rule; the seed backdates its last action so the badge is on screen without waiting) |
| 2:40 | Draft advisory → Approve → Investigating → Action Taken | the DRAFT stamp survives the draft, the Approve button unlocks only after a draft exists, and only the next status in the server's whitelist is clickable |
| 2:50 | History | who did what, when, with role and note — engine, agent and officer are distinguishable |
| 2:55 | Ask Nirikshan | an offline answer that names Ward 3, WQI **94.4 Unsafe**, the three breach lines, and cites the standard excerpt, the case and the node — same numbers as the screens |

The city overview replaces the old dashboard as the opening beat: the same served KPIs, plus
a ward map whose layers are coloured from the server's WQI and NAQI values, never re-derived
in the browser.

Air and land, 15 seconds each: the dust station's gauge (air_08 = NAQI **312.5 Very Poor**,
PM10 360 → **386.9** projected in 24 h) and a waste report with its photo and a proximity
score of **80** from four published weights, with the erosion→reservoir turbidity cross-link
as a deep link.

## What is in the repo

```
PLAN.md                  the build spec this repo implements, incl. the §6.7 numbers contract
PROGRESS.md              session log: every gate, its command, and its real output
TRANSFER.md              handoff — status, run commands, file tree, what remains
schema.sql              tables for the network, readings, complaints, cases, actions
seed.py                 deterministic synthetic city: 98 nodes, 78 pipes, 5,712 readings,
                        3,360 air readings, 20 complaints, 8 cases, plus the planted scenarios
verify_seed.py          31 assertions that the seed still produces the contracted numbers
rehearse_demo.py        the demo path walked over HTTP against a live server (17 beats)
make_frontend_spec.py   generates docs/FRONTEND_SPEC.md + docs/openapi.json from the running
                        server, and asserts 21 data-coverage rows before it writes
requirements.txt        the three pinned dependencies (used by the hosted build)
Dockerfile              container path: install, seed at boot, bind 0.0.0.0:$PORT
render.yaml             Render Blueprint: free Python web service + health check

config/limits.json      IS 10500 ideal / acceptable / permissible values + WQI weights
config/aqi.json         NAQI sub-index breakpoints and category bounds
config/rules.json       clustering window, severity ladder, overdue threshold, forecast params

backend/wqi.py          weighted water quality index from a reading row
backend/aqi.py          NAQI from PM2.5 / PM10 / O3 and the driving pollutant
backend/graph.py         the distribution tree: LCA of buildings, upstream walk, pipe decay
backend/anomaly.py       z-score against the same hour-of-day baseline over 14 days
backend/forecast.py      first-order chlorine decay + 24 h PM projection, with crossing hours
backend/rules.py         the issue-identity engine: clustering, severity, overdue, transitions
backend/standards.py     standards rows loaded from docs/ + config, each carrying a citation
backend/agent.py         provider-agnostic drafting; deterministic offline template as fallback
backend/ask.py           offline evidence answer: readings + standards + open cases, with citations
backend/db.py            sqlite access, one bulk read per screen (no N+1)
backend/app.py           FastAPI app: 21 paths, static UI mount, error envelope, X-Request-Id
backend/tests/           97 tests against a temp copy of the seeded DB on a free test port

frontend_fallback/index.html      the app shell: nav, banner, footer, panel overlay, role chip, ask FAB
frontend_fallback/app.css         design tokens, tables, split rail — no CSS framework
frontend_fallback/landing.css     landing page, shell collapse, role chip
frontend_fallback/city.css        city overview + basemap ink + network-map overrides
frontend_fallback/ask.css         ask page, hero, suggestion chips, FAB
frontend_fallback/api.js          fetch wrapper with a per-screen cache and request ids
frontend_fallback/components.js   el()/table/badge/timeline/errorBox primitives
frontend_fallback/basemap.js      shared hand-authored schematic Mumbai basemap (no tiles)
frontend_fallback/map.js          the SVG network: layers, pan/zoom, flow animation, trace pulse
frontend_fallback/pages_core.js   map, complaints, cases, case detail, node detail
frontend_fallback/pages_city.js   city overview (replaces the old dashboard)
frontend_fallback/pages_domains.js air, land, reports
frontend_fallback/pages_landing.js the demo role picker at #/welcome
frontend_fallback/pages_ask.js    Ask Nirikshan transcript and #/ask?case= prefill
frontend_fallback/app.js          hash router, role gate, deep links (#/map?t=, #/map?n=)

docs/is10500_excerpt.txt        the water standard, transcribed, ending VERIFY…
docs/cpcb_aqi_excerpt.txt       the NAQI bands, transcribed
docs/swm_rules_excerpt.txt      the solid-waste rules, transcribed
docs/FRONTEND_SPEC.md           the UI specification, generated from the live server
docs/openapi.json               the API contract, generated from the live server
docs/PHASE2_VISUAL_PASS.md      the visual-first pass: scope, routes, gates, fixes, limitations
docs/DEPLOY.md                  optional hosted path, free-plan behaviour, post-deploy checks
```

`frontend/` was the React polish layer in `PLAN.md` §9. It was deliberately not built — and
since git does not store empty directories, a fresh clone will not contain it at all. That is
the supported state: `backend/app.py` mounts `frontend/dist` if it exists and otherwise serves
`frontend_fallback/`, so the fallback is the product, not a safety net that happens to be in
use. Building a Vite app over it would only add a way to break the demo.

## Offline, and how to prove it

The UI loads only relative files — ten scripts, four stylesheets, and same-origin `fetch`
calls. There is no npm, no CDN, no font or icon service and no remote script:

- a walk of all eleven routes (including the brand-new city overview, landing and ask pages)
  put 33 requests in the browser's network log — every one of them addressed to
  `127.0.0.1:8000`, none to any other host;
- `grep -rno "https\?://" frontend_fallback/` returns exactly one line: the
  `http://www.w3.org/2000/svg` namespace declaration in `components.js`, which is an
  identifier the SVG DOM requires, not a request;
- with no LLM key the agent reports `"ai": "offline"` in `/api/health` and writes the
  advisory from its deterministic template.

To simulate a dead network while developing, point every proxy at a closed port and let
only loopback through:

```bash
HTTP_PROXY=http://127.0.0.1:9 HTTPS_PROXY=http://127.0.0.1:9 ALL_PROXY=http://127.0.0.1:9 \
no_proxy=127.0.0.1,localhost LLM_PROVIDER=offline \
  ./.venv/Scripts/python.exe -m uvicorn backend.app:app --host 127.0.0.1 --port 8000
```

Port 9 is discard; anything that tries to leave will fail loudly rather than silently
working because your laptop has Wi-Fi.

## Disclosure: synthetic data and AI use

**Data.** Everything here is a synthetic sample city on a frozen demo clock of
`2026-11-03 09:00:00`, generated by `seed.py`. No real citizen, sensor or utility data is
used or implied. The topology, the pipe-age/decay physics and the regulatory limits are
modelled on real practice, and every payload carries `"data": "synthetic sample data"`.

**AI.** An LLM is optional and never authoritative. `agent.py` explains findings computed by
`rules.py` and drafts advisory text; with no API key present it uses a deterministic
template and labels itself offline. Every drafted artifact is stamped `DRAFT` and shows its
provider; nothing becomes an advisory until a named officer approves it, and that approval
is written to the action log with actor, role and timestamp. Compliance verdicts, bands,
severities and overdue flags are arithmetic on served values — reproducible without a model
and asserted by the test suite.

**Standards.** `docs/*_excerpt.txt` are short transcriptions, each ending `VERIFY AGAINST
THE OFFICIAL DOCUMENT`, and every citation in the UI is labelled `excerpt - verify`. They
support explanation; they are not offered as legal text. The 0.2 mg/L residual chlorine
figure is a process-control minimum, not a health-based standard.

## Errors, and why the UI never goes blank

Every failure answers in the server's own words: `{"detail": "..."}` plus an
`X-Request-Id` that the UI prints so a screenshot is traceable to a log line. Unknown node
or case → 404 rendered in the error box; an illegal status transition → 400 with the
allowed list; a missing field → 422 naming the field. Empty states are messages, not
crashes: a node with no sensor says so instead of inventing a WQI, a report with no photo
says so, and an air or land case explains that the trace endpoint answers 400 for it rather
than drawing an empty path.
