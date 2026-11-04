# TRANSFER — Nirikshan, handoff after the visual pass

Written 2026-11-04 by the unattended build agent, updated after the visual-first pass.
Read this first if you are picking the project up — human or agent. `PROGRESS.md` is the
session log; `PLAN.md` is the spec; `README.md` is the user-facing doc;
`docs/PHASE2_VISUAL_PASS.md` records the presentation pass in full.

## 1. Status

**CP6 reached, then a presentation pass on top. All seven phases of `PLAN.md` are complete,
the §16 definition of done passes, and the visual pass is closed with all gates green.** No
item on the §14 cut list was cut. No `BLOCKED.md` exists — nothing had to be worked around.

Checkpoint trail (each one committed with tests green at the time):

| CP | commit | what it locked in |
|---|---|---|
| CP0 | `d5b5f60` | scaffold, pinned deps, three config JSONs, three docs excerpts |
| CP1 | `36da67e` | schema + deterministic seed + the demo-numbers contract |
| CP2 | `dd91a6b` | backend core modules, 20 API paths, tests |
| CP3 | `030444c` | agent with offline fallback, DRAFT stamp, approve |
| CP4 | `9e50396` | generated spec + OpenAPI + a minimal fallback UI |
| CP5 | `ca035c1` | 21/21 data-coverage rows verified through the live API |
| — | `894a3db` | `rehearse_demo.py` — the demo path as an executable check |
| CP5b | `dab6caf` | the full nine-page offline UI, verified twice in a browser |
| CP6 | `4b11ba2` | README, final PROGRESS.md, this file, regenerated spec |
| CP6a | `ff80a63` + `e61bafa` | Gate 6c: the audit's two residual derived claims removed from the UI |
| CP6b | `e61bafa` | Gate 6d: the band→colour tables measured against the live payload and left as legend-only fallbacks |
| VP | `2d509fa`…`e3370de` | visual pass: design system, landing, city overview, shared basemap, Ask Nirikshan |

After CP5b the UI was audited against the served payloads rather than the rendered page, which
found twelve defects the walkthroughs could not see (a pollutant-key mismatch that silently
dropped three of six sub-index bars, three places where the browser re-ran a computation the
server had already done, a table that printed `station_id` as a pollutant, four places where a
served number was re-rounded on screen, and a duplicate `/api/trace` call). All twelve are fixed,
`node --check` clean, and §10 was walked again. Full list with evidence in `PROGRESS.md`,
Gate 6b.

A read-only audit agent was then run against the live server and asked for its residuals; two
unserved conclusions survived into the committed build — a hotspot card that coloured the `wqi`
factor red and the rest green (the browser picking "which factor is the alarm", across factors on
different units), and Reports domain cards that printed `worst severity X` (a browser-side ranking
of served labels). Both are now presentation of served data only: one neutral bar colour, and
`severities here: …` in payload order. Re-verified live; see `PROGRESS.md`, Gate 6c. Its third
item — the local band→colour tables — was measured rather than argued: every served WQI row
carries its own `colour` and the hexes match those tables exactly, so they survive only as the
legend and a colourless-row fallback (`PROGRESS.md`, Gate 6d).

**Exact last gate output** (fresh seed, live server on 8000, no LLM key):

```
$ PY verify_seed.py | tail -1
31 checks, 0 failures

$ PY -m unittest discover -s backend/tests | tail -2
Ran 97 tests in ~5s
OK

$ PY -m unittest discover -s backend/tests -p test_ask.py | tail -2
Ran 12 tests in ~1s
OK

$ PY rehearse_demo.py | tail -3
17/17 beats clean
Demo path runs end to end. Restore the pristine seed with:
    PY seed.py && PY verify_seed.py

$ PY make_frontend_spec.py | tail -3
wrote docs\FRONTEND_SPEC.md (21 routes, 2840 lines)
wrote docs\openapi.json
coverage: 21/21 scenarios verified through the API

$ curl -s http://127.0.0.1:8000/api/health
{"status":"ok","demo_now":"2026-11-03 09:00:00","counts":{"nodes":98,"pipes":78,"sensors":27,
"readings":5712,"complaints":20,"cases":8},"ai":"offline", ...}
```

Two suites can now run **at the same time**: `backend/tests/base.py` binds a socket to
`127.0.0.1:0` before uvicorn and passes it to `server.run(sockets=[...])`, so each process gets
its own free port and its own temp DB. Verified with `test_ask.py` and the full suite running
concurrently: 12 OK and 93 OK.

The database in the working tree is **pristine** (20 complaints, 8 cases, nothing filed or
approved by the walkthroughs) — restore it that way after any rehearsal, because the demo
numbers in §13 of the spec are asserted against exactly that state.

Those four commands were re-run at CP6a, which is the last code change, with the same results.
`make_frontend_spec.py` was also used as a reproducibility check: after a rehearsal had mutated
the database it regenerated a 2871-line spec containing the rehearsal's state (`complaints: 21`,
`CASE-2026-003` at `Action Taken`, `overdue: false`) — which is the honest behaviour of a
generator that reads a live server — and after `seed.py` restored the pristine database it
regenerated a file byte-identical to the committed 2840-line one (`git diff --quiet` on
`docs/FRONTEND_SPEC.md` and `docs/openapi.json`: clean). So the spec and OpenAPI in this repo are
reproducible from a fresh clone, and the only inputs that move them are the seed and the code.

## 2. Run it

Windows, Git Bash, repo root. `PY` is `./.venv/Scripts/python.exe` here; on Linux use
`./.venv/bin/python`. The venv is never activated — every command names the interpreter.

```bash
# 1. interpreter + three pinned packages (the only dependencies in the project)
py -3.12 -m venv .venv
./.venv/Scripts/python.exe -m pip install --upgrade pip
./.venv/Scripts/python.exe -m pip install "fastapi==0.115.6" "uvicorn==0.32.1" "pydantic==2.10.4"
./.venv/Scripts/python.exe -c "import fastapi, uvicorn, pydantic; print('ok')"   # -> ok

# 2. build the city, then prove the numbers before you trust the UI
./.venv/Scripts/python.exe seed.py
./.venv/Scripts/python.exe verify_seed.py          # 31 checks, 0 failures

# 3. one process serves the API and the UI
./.venv/Scripts/python.exe -m uvicorn backend.app:app --host 127.0.0.1 --port 8000
# open http://127.0.0.1:8000/  ->  lands on #/welcome; pick Officer, or use #/?role=officer

# 4. tests (their own free port + temp DB — never run them against the 8000 demo DB)
./.venv/Scripts/python.exe -m unittest discover -s backend/tests

# 5. the whole demo as a script, against the running server
./.venv/Scripts/python.exe rehearse_demo.py        # 17/17 beats, exit 0
```

There is **no build step**. `npm` is not installed, not required, and not used. The React
polish layer in `PLAN.md` §9 was deliberately never built, so `frontend/dist` does not exist
and `backend/app.py:980-984` mounts `frontend_fallback/` at `/` — the fallback is the product,
not a safety net. (Git does not store empty directories, so a fresh clone has no `frontend/`
at all; the mount logic handles that.)

To rehearse a dead network, start the server with every proxy pointed at a closed port:

```bash
HTTP_PROXY=http://127.0.0.1:9 HTTPS_PROXY=http://127.0.0.1:9 ALL_PROXY=http://127.0.0.1:9 \
no_proxy=127.0.0.1,localhost LLM_PROVIDER=offline \
  ./.venv/Scripts/python.exe -m uvicorn backend.app:app --host 127.0.0.1 --port 8000
```

Port 9 is discard, so a hidden network call fails instead of passing because the laptop has
Wi-Fi. This is how every gate above was run.

**Windows gotchas that cost time on this build** (they are in `PROGRESS.md` too):

- `set -o pipefail` before piping a gate command to `tail`, or a failing suite reports exit 0
  behind `tail`'s success.
- Stop the server **before** `seed.py`. A running process holds `nirikshan.db` and Windows
  will not let it be swapped.
- Kill by PID — this shell has no `pkill`:
  `netstat -ano | grep -E ":8000 .*LISTENING" | awk '{print $5}'` then `taskkill //PID <n> //F`.
  A stale server from an earlier session answers the next smoke test with yesterday's code.
- In a browser, changing only the hash does **not** re-fetch the JS. After editing any
  `frontend_fallback/*.js`, hard-reload with cache bypass, or you will debug code that is not
  running.

## 3. What was built

### Backend (Python 3.12, stdlib apart from FastAPI/uvicorn/pydantic)

```
schema.sql              nodes, pipes, sensors, readings, complaints, cases, actions, features,
                        land_meta — the shape the whole demo depends on
seed.py                 deterministic city + the eight planted scenarios (S1–S8) + N0 routine
                        complaints; clusters once at seed time and backdates the ward-4 burst
                        action to demo_now − 3 h so the OVERDUE badge is demonstrable
verify_seed.py          31 assertions pinning the contracted numbers (README §6.7 of PLAN)
rehearse_demo.py        the demo walked over HTTP — 17 beats, writes, exit 0 only if all pass
make_frontend_spec.py   boots the app on 8010 against a TEMP copy of the DB, asserts 21
                        coverage rows, then writes docs/FRONTEND_SPEC.md + openapi.json

config/limits.json      IS 10500 ideal/acceptable/permissible + WQI weights (PLAN §5.1 verbatim)
config/aqi.json         NAQI sub-index breakpoints + category bounds (§5.2 verbatim)
config/rules.json       clustering window, severity ladder, overdue 2 h, forecast + anomaly
                        thresholds (§5.3 verbatim, plus an additive land_proximity block)

backend/wqi.py          reading row → weighted WQI + band + which parameters overrode it
backend/aqi.py          PM2.5/PM10/O3 → NAQI, category, driving pollutant
backend/graph.py        distribution tree: LCA of the complaining buildings, upstream walk,
                        per-pipe first-order decay coefficient k from material/age/diameter
backend/anomaly.py      z-score against the same hour-of-day over 14 days (threshold 2.5)
backend/forecast.py     chlorine decay to the 0.2 mg/L minimum with crossing hours; 24 h PM slope
backend/rules.py        the issue-identity engine: clustering, severity, scope, overdue,
                        and the Open → Investigating → Action Taken → Resolved whitelist
backend/standards.py    standards rows from docs/ + config, each carrying its citation
backend/agent.py        provider-agnostic drafting; deterministic offline template when no key,
                        and it never returns a verdict — only prose about a rules finding
backend/ask.py          offline evidence answer: readings + standards + open cases, with citations
backend/db.py           sqlite access, one bulk read per screen (no N+1 anywhere)
backend/app.py          FastAPI app: 21 paths, the {"detail": …} envelope, X-Request-Id on every
                        response, static mount of the UI, demo clock = MAX(readings.timestamp)
backend/tests/          97 tests on a free port against a temp copy of the seeded DB
```

### Frontend — `frontend_fallback/`, the whole UI, plain ES5 + SVG

```
index.html              shell: nav with live counters, banner, footer, slide-over panel host,
                        role chip, Ask FAB; loads ten scripts + four stylesheets, relative only
app.css                 design tokens, real tables with sticky headers, split rail (collapses
                        below 1180 px), the [hidden] rule, flow/trace/pulse animations
landing.css             landing page, shell collapse, role chip
city.css                city overview, basemap ink, network-map overrides
ask.css                 ask page, hero, chips, FAB
api.js                  fetch wrapper, per-screen cache, X-Request-Id capture, node-name cache
components.js           el()/clear/table(.table-scroll)/badge/stat-card/timeline/errorBox
basemap.js              one hand-authored schematic Mumbai basemap, no tiles or images
map.js                  SVG tree on the shared basemap: drag-pan, wheel/±zoom, layers,
                        animated flow, trace highlighting, decay-k width, red pulse marker
pages_city.js           city overview (#/) — served KPIs, ward map with Water/Air/
                        Complaints/All layers, triage table, hotspots, air and network preview
pages_core.js           network map (#/map), complaints (#/complaints), cases list,
                        case detail (#/cases/<id>), node detail (#/nodes/<id>) — evidence,
                        standards, trace, draft/approve, and the "Explain this case" link
pages_domains.js        air (#/air), land (#/land), reports (#/reports) — gauges, 24 h PM
                        projection, photo + proximity weights, cross-domain banner, funnel
pages_landing.js        demo role picker (#/welcome), localStorage['niri.role'] only
pages_ask.js            Ask Nirikshan (#/ask, #/ask?case=<id>) transcript and prefill
app.js                  hash router + role gate: #/welcome, #/ (city), #/map?t=<case>,
                        #/map?n=<node>, #/ask?case=<id>; unknown hash renders the 404 envelope
```

Every number on every screen comes from the server. The UI holds no threshold, no rule, and
no clock — that is PLAN §12, and it is what makes the demo answerable under questioning.

### Docs

```
docs/is10500_excerpt.txt     water standard lines, ends VERIFY AGAINST THE OFFICIAL DOCUMENT
docs/cpcb_aqi_excerpt.txt    NAQI bands, same
docs/swm_rules_excerpt.txt   solid-waste rules, same
docs/FRONTEND_SPEC.md        pages §5, SVG map §6, §10 demo script, §11 fifteen acceptance
                             items (all ticked, all browser-verified), §12 truth
                             rules, §13 coverage table generated from the live server
docs/openapi.json            the API contract, generated from the same live server
docs/PHASE2_VISUAL_PASS.md   the presentation pass: scope, routes, contracts, fixes, gates,
                             limitations, commits — the up-to-date map of the UI layer
```

## 4. What remains

Nothing in the build. Four things are outside what an agent at a keyboard can do:

1. **Backup video** (PLAN Phase 6 step 3). Needs a screen recording of the demo run — record
   `rehearse_demo.py` output plus the browser walk below. Nothing in the repo can produce it
   honestly, and generating a synthetic "demo video" would misrepresent the product.
2. **Live URL.** The app is deliberately loopback-only and offline; publishing it anywhere
   means deploying it, which contradicts the no-external-services constraint. If the judges
   want a URL, the answer is the video plus the two-clone-in-and-run README.
3. **Submission + AI disclosure + screenshots** on the contest portal — a human account action.
4. **Polish that has no gate:** the map's node labels default off (one toggle away), and the
   land page's proximity table is the only place a judge can see the four weights at once.
   Both are deliberate, not unfinished.

Known bugs: none open. Two behaviours that look like bugs and are not:

- The **OVERDUE badge disappears** as soon as you touch the case, because any write stamps
  `demo_now`. That is the rule working, not a flicker — re-seed to get it back for a rehearsal.
- **`Action Taken` is disabled from `Open`.** The whitelist is one step forward only, and the
  button row says `not in allowed_transitions` next to each disabled step. The demo therefore
  needs two clicks after Approve, which is a good thing to say out loud while clicking.

## 5. Demo script (3 minutes, ready to rehearse)

Server on 8000, fresh seed, browser at `http://127.0.0.1:8000/#/welcome` (pick Officer, or
open `#/?role=officer`). Say the numbers; they are served, so they will not change.

| Time | Do this | Say this |
|---|---|---|
| 0:00 | City overview. Point at the worst-water card and the ward map. | "Six open cases. Ward 3 scores 94.4 — the server calls that Unsafe, not the browser. The map colours are the served bands too." |
| 0:15 | Click the Zone-3 row → case detail. | "Five separate complaints, turbidity 8.962 NTU, chlorine 0.0382, coliform present. A z-score of 151 against its own 14-day baseline — this is not noise." |
| 0:30 | Complaints → pick B21 → paste "Brown water from the tap since 3 days, smells of sewage" → File. | "A report is a sensor reading. The assistant reads the text, the engine finds the nearest sensor — Ward 3, 231 m — and it joins CASE-2026-003." Press **Run clustering** twice: "Idempotent. Nothing new appeared." |
| 0:45 | Case detail → Evidence panel. | "Shared cause, the rule verbatim — place, time, behaviour — confidence 0.9 on the server's own 0–1 scale, and the readings sit beside the limits with the server's own breach flags." |
| 1:15 | Trace Upstream. | "Six hops back up the tree, and it names the section: P048, cast iron laid in 1991, k = 0.257 per hour. The pulse is the claim." |
| 1:45 | Standards panel. | "Only the breached IS 10500 rows, each with its citation, and the excerpt it came from — labelled 'verify', because we transcribed it." |
| 2:00 | Map → click Ward 5 → full page. | "0.235 mg/L now, and the dashed line is the 0.2 process minimum it crosses in 21 hours. Not breached yet — that is a warning, not an alarm." |
| 2:20 | Cases → CASE-2026-004. | "Act two: a burst. Emergency, and the OVERDUE badge is the server's two-hour rule — nobody waited for a timer." |
| 2:40 | Draft advisory → Approve → Investigating → Action Taken. | "The model writes this wording, stamped DRAFT. It becomes real only when a named officer signs, and the status can move one step — the whitelist is the server's." |
| 2:50 | History. | "Engine, agent, officer — who did what, when, with the note. That is the audit trail a municipality actually needs." |
| 2:55 | Ask Nirikshan (FAB or `#/ask`). Ask "Why is Ward 3 unsafe?" | "Offline, from the served readings and the standard we transcribed — Ward 3, WQI 94.4 Unsafe, three breaches, with doc, case and node citations. Same numbers as the screens." |
| +15 s | Air: worst gauge + projection. | "air_08 at NAQI 312.5, PM10 360 heading to 386.9 in 24 hours." |
| +15 s | Land: photo, score, cross-link. | "Proximity 80 from four published weights — school, water body, road, how long it has stood — and this erosion report is why a reservoir's turbidity is rising." |

Then `PY rehearse_demo.py` if you want the same path proved without a browser.

## 6. Handoff — do this first

1. `git log --oneline -1` should show the visual-pass fixes/doc commit; `git status --short`
   should be clean apart from generated files that are gitignored (`nirikshan.db`, `*.log`,
   `data/images/upload_*`).
2. Run the four definition-of-done commands in §2 above, in that order. If step 2's
   `verify_seed.py` is not **31 checks, 0 failures**, do not touch the UI — the seed moved and
   every number in §13, the README and the demo script above is now wrong.
3. Walk §5 in a browser once before presenting. The failure mode this project has is not a
   crash — it is a screen that silently reads a field the server renamed. `make_frontend_spec.py`
   catches that on 21 coverage rows; the browser walk catches the rest.
4. If you are the next **agent**: `PLAN.md` §0.1 is the recovery contract — snapshot
   `PROGRESS.md` and this file first, then continue from wherever the checklist says you are.
   Do not re-architect: the pins, the clock, the `{"detail": …}` envelope and the
   server-owns-truth rule are load-bearing. `docs/FRONTEND_SPEC.md` §11 is the only list worth
   re-verifying after a UI change, and the two UI files that hold most of the surface are
   `pages_core.js` (six pages) and `map.js` (the trace).
5. If you are the next **human**: the three sentences that win questions are in `PLAN.md` §15
   and the README disclosure — synthetic data, labelled; the graph is the product; the LLM
   never decides.
