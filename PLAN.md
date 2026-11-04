# Nirikshan — Complete Build Prompt (hardened, cross-platform, resumable)

> **Read this entire file before writing any code.**
> You are building this project from scratch, possibly while the human is ASLEEP, possibly taking over from another agent mid-build. Work phase by phase, in order. Run the gate commands at every gate. Commit at every checkpoint. Write `PROGRESS.md` at every gate. When this file and your own guess disagree, follow this file.
>
> **This file works on BOTH Windows (PowerShell) and Linux (bash).** Commands are written once using the `PY` shorthand defined in section 0.1 — substitute it with the right path for your OS. Never let an OS mismatch be an excuse: the correct form is always shown in section 0.1.

---

## START PROMPT — paste this block as the FIRST message of the build session

```text
You are building a complete hackathon project from scratch in this workspace.
The workspace currently contains only a `v2` folder with `PLAN.md` — the entire
specification, build order, tests, and demo contract.

Step 1: Move `v2/PLAN.md` to the workspace root (the layout is defined in its section 4).
Step 2: Read PLAN.md fully before writing any code.
Step 3: Execute it phase by phase, Phase 0 through Phase 6, exactly as written.
        Follow the operating contract (section 0). If you ever resume mid-build,
        follow the continue-from-anywhere checklist (section 0.1) first.
Step 4: This is a long continuous session (4-5+ hours, possibly more). Do not stop
        early, do not ask for approval, do not pause between phases. The workspace
        may be Windows PowerShell or Linux bash — PLAN.md handles both via the PY
        shorthand; never improvise OS commands.
Step 5: Save everything as you go: commit at every checkpoint (CP0-CP6), update
        PROGRESS.md at every gate, write BLOCKED.md only if blocked (then keep going
        via the fallback paths). If you are about to run out of context or time,
        write PROGRESS.md and TRANSFER.md snapshots FIRST so the next session
        continues seamlessly.
Step 6: When Phase 6 is complete — or when your session must end — write TRANSFER.md
        as the final act (format in PLAN.md, Phase 6). It must let any human or agent
        pick the project up in under 5 minutes: checkpoint reached, exact run
        commands, what was built, what remains, the 3-minute demo script, next action.

Goal: the project fully completes — all four definition-of-done commands pass, the
demo works fully offline, everything is committed, and TRANSFER.md is written.
```

---

## 0. Operating contract (how to run unattended without breaking anything)

1. **Never skip a phase, never re-open a gated phase.** A phase is frozen once its gate passes and its commit exists. If a later test proves a frozen phase wrong, fix the *seed* (Phase 1) only, re-run every gate, and commit again — never patch app code to force numbers.
2. **Order of the night:** network-dependent installs FIRST (Phase 0). If `pip` or `npm` cannot reach the network, STOP, write `BLOCKED.md` with the exact error, and do nothing else — every other phase depends on those packages. Do not keep retrying for more than 10 minutes.
3. **At every gate:** run the exact gate commands in order. If they pass → write the checkpoint line into `PROGRESS.md` and `git commit`. If they fail → fix only that phase for at most 30 minutes. Still failing → write `BLOCKED.md` (what failed, exact error text, what is already working), apply that phase's fallback path if one is listed, then continue with the next phase. Two consecutive BLOCKED phases → stop entirely and write a final `PROGRESS.md` summary.
4. **Never wait for human approval.** No prompts, no questions, no pauses.
5. **Time boxes:** Phase 0: 30 min · Phase 1: 2.5 h · Phase 2: 3 h · Phase 3: 2 h · Phase 4: 4 h · Phase 5: 2.5 h · Phase 6: 2 h. If a phase exceeds its box, apply its fallback path and move on. Use the cut list (section 15) if the night is running long.
6. **Never delete working code.** Everything new goes in new files or additive edits. `git commit` at every gate means nothing is ever lost.
7. **DO NOT (hard ban):** no new dependencies; no renaming/removing API fields or table columns after first commit; no `max(x, 75.1)`-style floors anywhere; no wall-clock randomness (`time.time()` banned in `seed.py`); no network call at import time or inside `/api/health`; no touching `frontend/` while the backend gates are red; no "clever" rewrites of already-passing modules.
8. **The demo numbers contract (section 6.7) is law.** If a number drifts, fix `seed.py` and re-run `verify_seed.py`. Tests pin numbers; code never forces them.
9. **Every error message you emit** must go into `PROGRESS.md` or `BLOCKED.md`, never swallowed.
10. **Definition of done lives in section 16.** The night is a success only if all four commands there pass.

---

## 0.1 CONTINUE-FROM-ANYWHERE CHECKLIST (read this FIRST, always)

This section exists so ANY agent — first, second, or tenth — can pick up the project at ANY moment and continue seamlessly. Follow it in order before doing any other work.

### Step A — Discover the current state (5 minutes, never skip)

1. Read `PROGRESS.md`. If `BLOCKED.md` exists, read it too — it names the exact failure to fix first.
2. Run `git log --oneline` — the latest `CP<n>` commit tells you which checkpoint was last completed.
3. Run `git status` — if there are uncommitted changes, the previous agent died mid-phase; finish that phase's gate, then commit.
4. Identify your OS (run `python --version` and `python3 --version`; `uname -s` on Linux, `echo $env:OS` on PowerShell). From this point ALWAYS use the `PY` shorthand:

| | Windows (PowerShell) | Linux (bash) |
|---|---|---|
| Create venv | `py -3.12 -m venv .venv` (fallback: `python -m venv .venv`) | `python3 -m venv .venv` |
| `PY` (python in venv) | `.\\.venv\\Scripts\\python.exe` | `./.venv/bin/python` |
| `PIP` | `PY -m pip` | `PY -m pip` |
| run tests | `PY -m unittest discover -s backend/tests -v` | same |
| run server | `PY -m uvicorn backend.app:app --port 8000` | same |
| seed / verify | `PY seed.py` / `PY verify_seed.py` | same |
| npm / git | identical on both | identical on both |

Note: if the venv does not exist yet (Phase 0), create it first, then `PIP install` the pinned packages, then continue.

### Step B — Confirm which checkpoint you are on (the checklist)

| CP | What must already exist | Verify with | If the verify fails | If the verify passes |
|---|---|---|---|---|
| CP0 | git repo, folder tree, `config/` (3 JSONs parse), `docs/` (3 files), venv with pinned packages, `.gitignore` | `git log --oneline` shows a CP0 commit AND `PY -c "import json; [json.load(open(f'config/{f}')) for f in ('limits.json','aqi.json','rules.json')]; print('config ok')"` prints `config ok` | Re-do Phase 0 (section 5) | Continue at Phase 1 (section 6) |
| CP1 | `schema.sql`, `seed.py`, `verify_seed.py`; `nirikshan.db` builds; contract numbers hold | `PY seed.py` then `PY verify_seed.py` both exit 0 | Fix only `seed.py` per section 6.8's fallback | Continue at Phase 2 (section 7) |
| CP2 | all `backend/*.py` modules, tests green on 8010 | `PY -m unittest discover -s backend/tests -v` all green | Fix the failing test/module (contract failures → fix seed) | Continue at Phase 3 (section 8) |
| CP3 | `backend/agent.py`, agent tests, draft endpoint with DRAFT stamp | `PY -m unittest discover -s backend/tests -v` green AND `POST /api/cases/{id}/draft` returns `"status": "DRAFT"` | Fix per section 8.6 | Continue at Phase 4 (section 9) |
| CP4 | `frontend_fallback/index.html` + React app that builds | `npm run build` inside `frontend/` exits 0; the fallback UI works with the backend on 8000 | Fix the build error; npm offline → keep fallback UI and skip to Phase 5 | Continue at Phase 5 (section 10) |
| CP5 | air + land + reports wired; all scenario tests green | `PY -m unittest discover -s backend/tests -v` green AND S6/S7/S8 + N0 walk through in the browser | Fix per section 10 | Continue at Phase 6 (section 11) |
| CP6 | README, backup video, submission | The four commands of section 16 all pass | Finish the missing item | The project is DONE — write the final PROGRESS.md summary and stop |

**Rule:** never re-do a checkpoint that already passes. Start exactly where the table tells you.

### Step C — Session handoff (mandatory, every agent, every time)

Append to `PROGRESS.md` BEFORE starting and AFTER finishing, in this exact format:

```
## SESSION — <YYYY-MM-DD HH:MM> — <agent name or "unattended agent">
- Entered at: CP<X> (verified by: <the exact verify command you ran>)
- Work done: <bullets of files created/changed>
- Left at: CP<Y> — gate PASS/FAIL (<paste the last gate command output, truncated ok>)
- Blockers: none | <exact error text>
- Next action for the next agent: <one exact command or task>
```

`BLOCKED.md` (only when blocked) uses the same fields plus: *"What is already working"* and *"What was tried"*.

The FINAL session of the build writes `TRANSFER.md` as its last act (exact format in Phase 6) — it is the master handoff for whoever picks the project up next.

### Step D — The decision register (core logic, 10 seconds to re-learn)

If you are a NEW agent, these are the non-obvious logic invariants — everything else is in the sections shown:

| # | Invariant | Where |
|---|---|---|
| 1 | Demo contract numbers are LAW; drift → fix seed, never app code | §6.7 |
| 2 | Issue identity = PLACE → TIME → BEHAVIOR checks, with the exact tie-break order | §7.7 |
| 3 | Case status whitelist: Open→Investigating→Action Taken→Resolved; else 400 | §7.7 |
| 4 | WQI is a RISK score (higher = worse) + worst-parameter override | §7.3 |
| 5 | Forecast: monotone 48 h decline → trend extrapolation, else physics decay (S4 crossing = 21 h by construction) | §7.6 |
| 6 | IDs come from the `seq` table; clustering is idempotent | §7.1, §7.7 |
| 7 | AI never computes verdicts; any failure → offline fallback; `ai` flag in responses | §8 |
| 8 | The single-file fallback UI guarantees the demo even without npm | §4.1, §9.1 |
| 9 | Ports: 8000 dev, 8010 tests with a temp DB — never mixed | §2 rule 10 |

---

## 1. Mission

Build **Nirikshan** (Sanskrit: "watchful oversight") — an **Environmental Intelligence & Compliance Management System** for the hackathon **Infomatrix HackOps 2**.

The problem statement: *"turn a reported concern into an evidence-backed assessment and a trackable response."*

Our answer: citizens file complaints (water / air / land). The system treats complaints as **sensors** — it clusters them through a real network graph, finds the **shared upstream cause**, cites the environmental standard, routes the case to the right owner, drafts a response, and tracks the case to closure.

- **Water is the hero domain** (full pipeline: graph trace, WQI, forecast, anomaly).
- **Air** gets NAQI monitoring, a 24 h PM forecast, and a dust-event case.
- **Land** gets citizen reports with image upload, a duration/area form, proximity risk scoring, and a cross-link to water turbidity.
- The demo must work **fully offline** on seeded synthetic data.
- The AI agent **advises but never decides**. Rules compute verdicts; a human signs.

**The demo goal:** in 3 minutes, 5 scattered complaints about one ward collapse into 1 case; a red pulse traces upstream to the old pipe; the standard is cited; the officer approves a drafted advisory; the case is tracked to resolution. Judges remember: *"they found the broken pipe from complaints."*

---

## 2. Non-negotiable rules

1. **No N+1 queries.** Bulk-load the network and latest readings. Never query per-row in a loop.
2. **Every SQLite connection:** `PRAGMA journal_mode=WAL`, `PRAGMA foreign_keys=ON`, `PRAGMA busy_timeout=5000`.
3. **JSON error envelope** `{"detail": "..."}` for ALL errors including 500s. Register exception handlers in FastAPI. Never HTML.
4. **IDs from a real sequence.** Complaint and case IDs never `COUNT(*)`-based. Use the `seq` table (atomic `UPDATE ... RETURNING` inside a transaction).
5. **Idempotent clustering.** `/api/cluster/run` twice → same case set, no duplicate actions.
6. **Config validated at startup.** All thresholds/limits/weights in `config/*.json`, validated on app start (fail fast with a clear message). No magic numbers in code.
7. **`/api/health` and tests from day one.**
8. **No hardcoded demo-number floors.** Seed produces; tests pin; drift → fix seed.
9. **API field names frozen** after first commit. Add only.
10. **Ports.** Dev: `8000`. Tests: `8010` with a temp database. Never mix.
11. **No new backend dependencies.** Python stdlib + fastapi + uvicorn + pydantic only. LLM via `urllib.request`. Frontend: React + Vite + Tailwind + Recharts only. No map libraries/tiles/keys.
12. **Disclaimers everywhere.** Every page: *"Automated findings support human judgment. They are not official regulatory decisions."* + *"synthetic sample data"* label.
13. **The LLM never computes a verdict.** It only extracts, explains, and drafts — stamped DRAFT until a human approves.
14. **Cross-platform.** This file must run identically on Windows PowerShell and Linux bash. Use the `PY`/`PIP` shorthand from section 0.1 for every Python command. Use forward slashes in all code paths (`os.path.join` everywhere in Python). Never assume `python` or `python3` — always use `PY`.

---

## 3. Stack (pinned versions — install exactly these)

| Layer | Choice | Pin |
|---|---|---|
| Backend | Python 3.12 | `fastapi==0.115.6`, `uvicorn==0.32.1`, `pydantic==2.10.4` — pin with `==` so a night-time release cannot break the build |
| Database | SQLite file `nirikshan.db` (generated, never committed) | stdlib `sqlite3` |
| Frontend | React + Vite + Tailwind + Recharts | `react==18.3.1`, `vite==5.4.11`, `tailwindcss==3.4.16`, `recharts==2.13.3` (in `package.json`, exact pins) |
| Node | Node ≥ 18 (check `node --version` in Phase 0) | — |
| Config | `config/limits.json`, `config/aqi.json`, `config/rules.json` | contents given below — copy verbatim |
| Docs | `docs/` bundled excerpts | given below |
| Tests | stdlib `unittest` + in-process uvicorn on 8010 | no pytest, no new deps |

---

## 4. Project structure (create exactly this)

```
nirikshan/
  PLAN.md  README.md  PROGRESS.md  TRANSFER.md(final handoff)  BLOCKED.md(only if blocked)  .gitignore
  schema.sql  seed.py  verify_seed.py
  config/ limits.json  aqi.json  rules.json
  docs/   is10500_excerpt.txt  cpcb_aqi_excerpt.txt  swm_rules_excerpt.txt
  backend/
    __init__.py  db.py  graph.py  wqi.py  aqi.py  forecast.py
    anomaly.py  rules.py  standards.py  agent.py  app.py
    tests/  __init__.py  base.py  test_health.py  test_seed.py
            test_cluster.py  test_forecast.py  test_air_land.py  test_agent.py
  frontend/
    package.json  vite.config.js  tailwind.config.js  postcss.config.js  index.html
    src/  main.jsx  App.jsx  api.js  theme.js
      components/ Banner.jsx Sidebar.jsx TopBar.jsx WqiGauge.jsx AqiGauge.jsx
                  SeverityBadge.jsx EvidencePanel.jsx TraceDiagram.jsx StatusFlow.jsx
      map/  NetworkMap.jsx projection.js flowLayer.js
      pages/ Dashboard.jsx Network.jsx Complaints.jsx CaseDetail.jsx
             NodeDetail.jsx Air.jsx Land.jsx Reports.jsx
  frontend_fallback/
    index.html                  <- single-file UI, zero build step, ALWAYS works (see 4.1)
  data/ images/                 <- synthetic demo images
```

### 4.1 The unbreakable UI rule

`frontend_fallback/index.html` is a **single HTML file with inline CSS+JS** that talks to the same API (`fetch('/api/...')`) and covers the whole demo path (dashboard, map-as-SVG, complaints, cases, trace, forecast, approve). The backend mounts it at `/` if `frontend/dist` does not exist. Build this file FIRST in Phase 4 (before `npm install`). Then the demo can never die to a frontend toolchain failure. The React app is the polish layer on top.

---

## 5. Phase 0 — Scaffold + network-dependent installs (30 min, do this FIRST)

1. `git init` in the project root; create `.gitignore`:
   ```
   nirikshan.db  __pycache__/  node_modules/  .venv/  server.log  dist/
   ```
2. Create the folder tree; empty `backend/__init__.py` and `backend/tests/__init__.py`.
3. Create the venv (per the 0.1 table) and install backend deps (pinned):
   ```powershell
   # Windows:  py -3.12 -m venv .venv
   # Linux:    python3 -m venv .venv
   PIP install --upgrade pip
   PIP install "fastapi==0.115.6" "uvicorn==0.32.1" "pydantic==2.10.4"
   ```
   Verify: `PY -c "import fastapi, uvicorn, pydantic; print('ok')"` must print `ok`.
   From now on, ALWAYS use `PY`, never bare `python`/`python3`.
4. Check Node: `node --version` ≥ 18 and `npm --version`. Do NOT install frontend deps yet (Phase 4), but if npm is missing, note it in PROGRESS.md — the fallback UI still saves the demo.
5. Write the three config JSONs EXACTLY as in sections 5.1–5.3 (copy verbatim — they are the contract).
6. Write the three `docs/` excerpts (5–15 lines each, real values, each ending with the line `VERIFY AGAINST THE OFFICIAL DOCUMENT`).
7. Write `PROGRESS.md` with the header: date, checklist of phases, notes. Write the first session block per section 0.1 Step C.

**Gate 0 commands:**
```
PY -c "import json; [json.load(open(f'config/{f}')) for f in ('limits.json','aqi.json','rules.json')]; print('config ok')"
git add -A; git commit -m "CP0: scaffold, pinned deps, config"
```

**Fallback if pip fails:** write `BLOCKED.md` with the exact error and stop (rule 2 in section 0). If config JSON fails to parse: fix the JSON (it is copied verbatim — check quotes), then re-run.

### 5.1 `config/limits.json` (copy verbatim)

```json
{
  "parameters": {
    "ph":              {"ideal": 7.0,  "acceptable": [6.5, 8.5], "permissible": [6.5, 8.5], "unit": "", "weight": 0.15, "note": "no relaxation"},
    "turbidity_ntu":   {"ideal": 0.0,  "acceptable": 1.0,        "permissible": 5.0,        "unit": "NTU", "weight": 0.25, "note": "5 NTU only when no alternative source"},
    "tds_mgl":         {"ideal": 0.0,  "acceptable": 500.0,      "permissible": 2000.0,     "unit": "mg/L", "weight": 0.15},
    "residual_chlorine_mgl": {"ideal": 0.5, "acceptable": [0.2, null], "permissible": [0.2, null], "unit": "mg/L", "weight": 0.25, "note": "process-control minimum, not a health standard"},
    "coliform":        {"ideal": 0.0,  "acceptable": 0.0,        "permissible": 0.0,        "unit": "present/absent", "weight": 0.20, "note": "must be absent in 100 mL"}
  },
  "wqi_bands": [
    {"band": "Good",        "min": 0,  "max": 25,  "colour": "#34A853"},
    {"band": "Acceptable",  "min": 25, "max": 50,  "colour": "#A8D08D"},
    {"band": "Poor",        "min": 50, "max": 75,  "colour": "#F4B400"},
    {"band": "Unsafe",      "min": 75, "max": 100, "colour": "#EA4335"}
  ],
  "_note": "WQI is a RISK score: 0 = perfect, 100 = worst. Labelled on screen."
}
```

### 5.2 `config/aqi.json` (copy verbatim)

```json
{
  "categories": [
    {"name": "Good",         "min": 0,   "max": 50,   "colour": "#34A853"},
    {"name": "Satisfactory", "min": 51,  "max": 100,  "colour": "#A8D08D"},
    {"name": "Moderate",     "min": 101, "max": 200,  "colour": "#F4B400"},
    {"name": "Poor",         "min": 201, "max": 300,  "colour": "#FBBC04"},
    {"name": "Very Poor",    "min": 301, "max": 400,  "colour": "#EA4335"},
    {"name": "Severe",       "min": 401, "max": 500,  "colour": "#9B1C1C"}
  ],
  "pm25_24h_breakpoints":   [0, 30, 60, 90, 120, 250],
  "pm10_24h_breakpoints":   [0, 50, 100, 250, 350, 430],
  "pollutants": ["PM2.5", "PM10", "NO2", "SO2", "CO", "O3"],
  "_note": "NO2/SO2/CO/O3 breakpoints: add the official CPCB rows, labelled 'demo excerpt - verify against CPCB'."
}
```

### 5.3 `config/rules.json` (copy verbatim)

```json
{
  "clustering": {
    "window_hours": 24,
    "min_buildings_for_municipal_case": 3,
    "min_complaints_for_any_case": 2,
    "land_proximity_m": 500,
    "sibling_normal_tolerance": {"turbidity_ntu_max": 1.0, "chlorine_mgl_min": 0.2}
  },
  "severity": {
    "High": "permissible-limit breach OR coliform present OR 5+ buildings affected",
    "Medium": "acceptable-limit breach OR 3-4 buildings affected",
    "Low": "single building, no sensor breach",
    "Emergency": "supply loss / pipe burst"
  },
  "forecast": {
    "horizon_hours": 24,
    "chlorine_minimum_mgl": 0.2,
    "method": "first-order decay C_out = C_in * exp(-k * t); k grows with pipe age and smaller diameter"
  },
  "anomaly": {"z_threshold": 2.5, "method": "z-score vs same hour-of-day over 14 days"},
  "escalation": {"enabled": true, "high_severity_no_action_hours": 2}
}
```

---

## 6. Phase 1 — Schema + Seed (2.5 h, most important phase)

### 6.1 `schema.sql` (exact DDL — copy it)

```sql
CREATE TABLE nodes (
  id TEXT PRIMARY KEY,            -- 'src_river', 'plant_n', 'res_hill', 'pump_1',
                                  -- 'J01', 'zone_1', 'B01', 'air_01', 'land_01'
  name TEXT NOT NULL,
  type TEXT NOT NULL,             -- source|treatment_plant|reservoir|pump|junction|
                                  -- zone|building|air_station|land_site
  lat REAL NOT NULL, lon REAL NOT NULL,
  zone_id TEXT,                   -- ward for zones/buildings/stations
  parent_id TEXT                  -- water-tree parent; NULL for sources/plants/air/land
);
CREATE TABLE pipes (
  id TEXT PRIMARY KEY,            -- 'P001'
  from_node TEXT NOT NULL REFERENCES nodes(id),
  to_node TEXT NOT NULL REFERENCES nodes(id),
  length_m REAL, diameter_mm INTEGER, material TEXT, install_year INTEGER
);
CREATE TABLE sensors (
  id TEXT PRIMARY KEY,            -- 'S_zone_3', 'S_air_07'
  node_id TEXT NOT NULL REFERENCES nodes(id),
  kind TEXT NOT NULL              -- 'multi' (water) | 'air'
);
CREATE TABLE readings (
  sensor_id TEXT REFERENCES sensors(id),
  timestamp TEXT NOT NULL,        -- 'YYYY-MM-DD HH:MM:SS'
  ph REAL, turbidity_ntu REAL, tds_mgl REAL, residual_chlorine_mgl REAL
);
CREATE TABLE air_readings (
  station_id TEXT REFERENCES nodes(id),
  timestamp TEXT NOT NULL,
  pm25 REAL, pm10 REAL, no2 REAL, so2 REAL, co REAL, o3 REAL
);
CREATE TABLE lab_tests (
  id TEXT PRIMARY KEY, node_id TEXT, date TEXT,
  total_coliform TEXT, e_coli TEXT, note TEXT
);
CREATE TABLE maintenance_checks (
  id TEXT PRIMARY KEY, node_id TEXT, date TEXT, check_type TEXT, result TEXT
);
CREATE TABLE complaints (
  id TEXT PRIMARY KEY,            -- 'CMP001' from seq table
  timestamp TEXT NOT NULL,
  domain TEXT NOT NULL,           -- 'water' | 'air' | 'land'
  node_id TEXT,                   -- building / air station / land site
  category TEXT, text TEXT, status TEXT DEFAULT 'NEW',
  image_path TEXT,                -- NULL unless uploaded
  extracted_fields TEXT,          -- JSON suggestion (agent or fallback)
  duration_days INTEGER,          -- land only
  area_m2 REAL                    -- land only
);
CREATE TABLE cases (
  id TEXT PRIMARY KEY,            -- 'CASE-2026-001' from seq table
  domain TEXT, node_id TEXT, scope TEXT,   -- MUNICIPAL|BUILDING_SIDE|UNDETERMINED
  status TEXT,                    -- Open|Investigating|Action Taken|Resolved
  severity TEXT,                  -- Low|Medium|High|Emergency
  title TEXT, created_at TEXT, updated_at TEXT,
  evidence_json TEXT
);
CREATE TABLE case_actions (
  id TEXT PRIMARY KEY, case_id TEXT REFERENCES cases(id),
  timestamp TEXT, actor TEXT, role TEXT, action TEXT, note TEXT
);
CREATE TABLE standards (
  id INTEGER PRIMARY KEY, domain TEXT, parameter TEXT,
  acceptable TEXT, permissible TEXT, unit TEXT, citation TEXT
);
CREATE TABLE seq (name TEXT PRIMARY KEY, value INTEGER NOT NULL);
CREATE INDEX idx_readings_ts ON readings(sensor_id, timestamp);
CREATE INDEX idx_air_readings_ts ON air_readings(station_id, timestamp);
CREATE INDEX idx_sensors_node ON sensors(node_id);
CREATE INDEX idx_complaints_node ON complaints(node_id, domain);
CREATE INDEX idx_cases_node ON cases(node_id);
```

ID sequences (in `seed.py`, and reused by the API): `INSERT INTO seq(name,value) VALUES('complaint',0),('case',0),('action',0),('lab',0),('maint',0);` — fetching: `UPDATE seq SET value = value + 1 WHERE name = ? RETURNING value` (SQLite ≥ 3.35).

### 6.2 The city (deterministic — `random.Random(42)` everywhere, NO wall-clock calls)

- Fictional Indian city **Nagar**, BMC-style, 5 wards: `zone_1..zone_5`. Coordinates inside a ~0.1° box around `(19.05, 72.90)`.
- **Water network is a tree.** 4 sources (river intake, lake intake, 2 borewells) → 2 treatment plants → 3 reservoirs → 3 pumps → ~14 junctions (a few dead-ends) → 5 zones → ~45 buildings (`B01..B45`, 8–10 per zone, Indian society names).
- ~79 pipes: old trunks (1984–1996, 400–600 mm, DI/MS/CI, 600–1400 m); zone feeds (1990–2004, 150–250 mm); building last-legs (1996–2016, 50–100 mm, GI/PVC/HDPE, 40–220 m).
- **Air:** 10 stations `air_01..air_10`, 2 per ward, not in the water tree.
- **Land:** 12 sites `land_01..land_12`, type `open_waste` / `soil_erosion` / other.

### 6.3 Physics (copy these formulas exactly)

Walk down from the plants:
```python
velocity_ms = 0.9 if diameter_mm >= 200 else 0.6
travel_h = (length_m / velocity_ms) / 3600.0
residence = {"reservoir": 1.2, "pump": 0.2, "junction": 0.2,
             "zone": 0.4, "building": 0.5}.get(type, 0.0)
dt = travel_h + residence
k = 0.03 + 0.0022 * (2026 - install_year)          # age effect
if material in ("GI", "CI", "MS"): k += 0.05        # wall demand
k += 0.10 * (150.0 / max(diameter_mm, 50))          # small pipe effect
k = min(k, 0.40)
child_chlorine = parent_chlorine * math.exp(-k * dt)
child_turbidity = parent_turbidity + 0.08 + (0.12 if 2026 - install_year > 25 else 0.0)
child_age_h = parent_age_h + dt
```
Plants start at chlorine 0.85, turbidity 0.25, pH 7.35, TDS 300. Small seeded drift per hop for pH/TDS. **Cap normal-day building turbidity under 0.7 NTU** so routine noise never trips the 1 NTU limit on its own.

### 6.4 Readings (14 days, hourly, per sensor)

- Sensors: 2 plants, 3 reservoirs, 2 pumps, 5 key junctions, 5 zones (`S_<node>`), 10 air stations (`S_air_07`).
- `NOW = datetime(2026, 11, 3, 9, 0, 0)`; 336 hourly steps ending at NOW. Per-sensor RNG: `random.Random(42*1000 + sensor_index)`.
- Daily pattern: `daily = sin(2π(hour−6)/24)`; chlorine `base*(1 − 0.08*daily) + gauss(0, 0.008)`; turbidity `base*(1 + 0.15*daily) + gauss(0, 0.05)`; pH drift `+ 0.06*sin(2π*hour/24) + gauss(0, 0.03)`; TDS `+ 8*daily + gauss(0, 3)`.
- Air: PM2.5 base 40–60 by station, PM10 base 60–100, daily peaks 08–10 h and 20–22 h, noise; NO2/SO2/CO/O3 from fixed bases.

### 6.5 Planted scenarios — deterministic ramps, event STILL ACTIVE at NOW

- **S1 Contamination (hero).** Window: NOW−12 h → NOW, on `J04` + `zone_3`. `frac = (ts − start)/12h`. zone_3: turbidity `+7.5*frac`, chlorine `−0.32*frac`, pH `−0.25*frac`; J04 at 0.6 strength. Lab test coliform **present**, dated NOW−6 h. 5 complaints (CMP001–005) from 5 Zone-3 buildings, NOW−11 h → NOW−7.5 h, muddy water / suspected contamination / bad taste (one mentions children with stomach upset).
- **S2 Pipe burst (act two).** Zone 4 feed pipe bursts at NOW−3 h: zone_4 + its junction turbidity `+3`, chlorine `−0.15`, sharp pressure anomaly (turbidity step `+3` exactly at the burst hour, no ramp). 4 complaints (NOW−2.5 h → NOW−1 h): "No / low pressure", "No water".
- **S3 Supply diversion.** 36 h before NOW, zone_2's feed flips to the other plant's path: water age at zone_2 jumps (store `flow_changed` note in evidence), chlorine drops ~0.1, 2 complaints "Bad taste" / "stale water".
- **S4 Chlorine decay (forecast) — exact arithmetic so the crossing is deterministic.** zone_5 chlorine at NOW−48 h = **0.315**, linear ramp down to **0.235** at NOW (same shape for `J08`, slightly higher). Slope = (0.235 − 0.315)/48 = −0.001667/h. Forecast module (section 7.6) extrapolates this slope: crossing time t where 0.235 − 0.001667·t ≤ 0.2 → **t = 21.0 h**. Test window: crossing_hours in 18–24, `breached_now == False`.
- **S5 Building-side.** B11 complains NOW−20 h "sewage smell, neighbours fine". Siblings + zone_1 sensor normal.
- **S6 Dust episode (air).** Construction near `land_03`: air_07 + air_08 PM10 ramp ×3 over 2 days to a final reading **≈ 360 µg/m³** (PM2.5 ×2). CPCB interpolation (PM10 24 h breakpoints 0,50,100,250,350,430 against AQI 0,50,100,200,300,400): 360 → AQI = 301 + (360−350)/(430−350)·99 ≈ **313, Very Poor**. Test: `aqi >= 301`. 2 complaints "dust from construction", "breathing trouble".
- **S7 Open waste dump (land).** `land_05`: complaint with synthetic image, `duration_days=12`, `area_m2=40`, site coordinates near a school.
- **S8 Soil erosion (land).** `land_09` near the reservoir intake; erosion report with image; intake turbidity mild upward trend (visible in the water graph).
- **N0 Normal day.** 3 routine complaints (water low pressure / air "traffic smell" / land "streetlight"), spread in time/space — must NOT cluster.
- Seed 2 historical RESOLVED cases with full action history.

### 6.6 Synthetic demo images (no dependencies)

`data/images/` — small SVG files (a muddy glass, a dust plume, a garbage heap, eroded soil), each labelled "SYNTHETIC SAMPLE IMAGE" inside the graphic. Referenced by seeded complaints via `image_path`. Real user uploads (jpg/png) are stored as-is and only those go to a vision model.

### 6.7 Demo numbers contract (targets — seed must hit these, tests pin them)

| Item | Target | Test assertion |
|---|---|---|
| zone_3 latest turbidity | ≈ 8.5 NTU | `> 5.0 and < 12.0` |
| zone_3 latest chlorine | ≈ 0.03 mg/L | `< 0.1` |
| zone_3 WQI | Unsafe band | `score >= 75` |
| S1 cluster | 5 complaints → 1 MUNICIPAL case at `zone_3`, High | exact |
| S5 | BUILDING_SIDE case at `B11` | exact |
| zone_5 chlorine now | 0.235 | `0.23 < x < 0.24` |
| zone_5 forecast crossing | 21 h | `18 <= crossing_hours <= 24`, `breached_now == False` |
| S2 | Emergency case on Zone 4 branch | exact |
| S6 | station AQI Very Poor | `aqi >= 301` |
| N0 | routine complaints never cluster | `cluster/run` creates no case from them |

### 6.8 `verify_seed.py`

Print-and-assert: node/pipe/sensor counts; every row of 6.7; LCA of the 5 S1 buildings == `zone_3`; trace `zone_3` ends at a plant; exit code 0 on success.

**Gate 1 commands:**
```
PY seed.py
PY verify_seed.py
git add -A; git commit -m "CP1: seed + verify, demo contract pinned"
```
**Fallback:** if a contract row fails, tune ONLY `seed.py` (ramp strengths, bases), re-run both commands, then commit. If you cannot hit the numbers after 30 min, write `BLOCKED.md` with the achieved values and continue — the tests will tell the human in the morning.

---

## 7. Phase 2 — Backend core (3 h)

Build one module at a time, in this order, each importable and tested.

### 7.1 `db.py`

```python
DB_PATH = os.environ.get("NIRIKSHAN_DB", "nirikshan.db")   # tests set a temp path
def connect():
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    conn.execute("PRAGMA busy_timeout=5000")
    return conn
def demo_now(conn):   # SELECT MAX(timestamp) FROM readings; cache per request
def next_id(conn, kind):  # UPDATE seq SET value=value+1 WHERE name=? RETURNING value
```

### 7.2 `graph.py`

```python
def load_graph(conn) -> (parent: dict[str,str], children: dict[str,list],
                         nodes: dict[str,Row], pipes_by_to: dict[str,Row])
def chain(node_id, parent) -> list[str]           # node -> root
def lca(ids: list[str], parent) -> str | None     # lowest common ancestor
def trace(node_id, parent) -> list[str]           # node -> plant, with pipe ids
```

### 7.3 `wqi.py` (exact math — this is the "logic" that must not drift)

For each parameter, sub-index `Qi ∈ [0,100]`:

```python
# pH: ideal 7.0, acceptable [6.5, 8.5]
Qi_ph = 100 * (7.0 - V) / 0.5 if V < 7.0 else 100 * (V - 7.0) / 1.5
# turbidity: Qi = 100 * V / 1.0  (acceptable limit), clamped to [0,100]
Qi_turb = min(100.0, 100.0 * V / 1.0)
# tds: Qi = 100 * V / 500.0, clamped
Qi_tds = min(100.0, 100.0 * V / 500.0)
# chlorine (minimum side): ideal 0.5, floor 0.2 -> deviation over 0.3
Qi_cl = 100.0 * max(0.0, 0.5 - V) / 0.3
# coliform: present -> 100, absent -> 0
```
`WQI = Σ(weight_i · Qi_i) / Σ(weight_i)` with the weights from `config/limits.json`. Bands from `wqi_bands`. **Worst-parameter override:** any parameter breaching its *permissible* limit, or coliform present → band cannot be better than Poor (score at least 50). Return `{"score", "band", "override": "<parameter>|None", "subindices": {...}}`.

### 7.4 `aqi.py` (exact math)

Sub-index: for concentration C between breakpoints `B[i]` and `B[i+1]` (index bounds `I[i]`,`I[i+1]` = 0,50,100,200,300,400,500):
```python
AQI_p = I[i] + (C - B[i]) * (I[i+1] - I[i]) / (B[i+1] - B[i])
```
`AQI = max over pollutants`, category from `config/aqi.json`, return driving pollutant. PM2.5/PM10 use the given 24 h breakpoints; NO2/SO2/CO/O3 breakpoints live in `config/aqi.json` (labelled excerpt).

### 7.5 `anomaly.py`

z-score of the latest reading vs mean/std of the **same hour-of-day** across the previous 13 days; flag if `|z| ≥ 2.5`. Return `{"flag", "z", "baseline_mean", "baseline_std"}`.

### 7.6 `forecast.py` (exact rules — ties into S4's arithmetic)

```python
def forecast_chlorine(conn, node_id):
    # last 48 h of that sensor's chlorine:
    c_now, c_24, c_48 = ...   # values at NOW, NOW-24h, NOW-48h
    slope = (c_now - c_48) / 48.0
    if slope < 0 and c_now < c_24 < c_48:          # monotone decline -> trend wins
        def proj(t): return c_now + slope * t
    else:                                          # otherwise physics decay
        k = pipe_k(pipes_by_to[node_id])
        def proj(t): return c_now * math.exp(-k * t)
    projected = [proj(t) for t in range(25)]
    breached_now = c_now < 0.2
    crossing_hours = first t where proj(t) <= 0.2, else None
    return {"current": c_now, "breached_now", "crossing_hours", "projected"}
```
With the S4 ramp this yields slope −0.001667 → crossing exactly at 21.0 h.

### 7.7 `rules.py` — the issue-identity engine (deterministic, with tie-breaking)

```
1. PLACE   : pin complaint to node.
             water -> lca(buildings) shared by >= min_buildings_for_municipal_case -> candidate
             air   -> same station; land -> same site or within land_proximity_m (500)
2. TIME    : within window_hours (24). Days apart -> different issues.
3. BEHAVIOR: sensors at shared node corroborate?
             breach/flag -> MUNICIPAL (severity by rules.json)
             normal      -> BUILDING_SIDE (1 building, siblings ok) else UNDETERMINED
```
**Tie-breaking (deterministic, in this exact order):** if several candidate shared nodes exist → (a) pick the one shared by the most complaints; (b) tie → the one with the more severe sensor breach (largest z or worst sub-index); (c) tie → the one closest to the plant (shortest `chain()`). **Status whitelist:** `Open→Investigating→Action Taken→Resolved` (Emergency behaves as Open); any other transition → HTTP 400, no write. **Idempotency:** `_upsert_case(conn, key=(domain, node_id, scope))` — update the existing non-Resolved case; append `case_actions` only when status/severity/evidence actually changed. Evidence JSON: `{"complaints": [...], "shared_node", "rule", "readings": {...}, "limits": {...}, "confidence"}`.

### 7.8 `standards.py` — rows loaded from `docs/` + `config` at startup; each row carries `citation` ("IS 10500:2012, Table 2, excerpt — verify").

### 7.9 API (all JSON; error envelope `{"detail": "..."}`)

| Method & path | Response (key fields) |
|---|---|
| `GET /api/health` | `{"status":"ok","demo_now","counts":{...}}` — must never touch the network or LLM |
| `GET /api/overview` | `{"kpis":{open_cases,worst_wqi,worst_aqi,complaints_24h},"triage":[...],"hotspots":[...]}` |
| `GET /api/network` | nodes (with `wqi:{score,band,override}`) + pipes — ONE bulk query, no N+1 |
| `GET /api/nodes/{id}` | node + wqi + latest + anomaly + maintenance + open cases |
| `GET /api/nodes/{id}/readings` | full 14-day series |
| `GET /api/nodes/{id}/forecast` | forecast.py shape |
| `GET /api/air` | stations with `aqi:{value,category,driving_pollutant}` |
| `GET /api/air/{station_id}/readings` | series incl. per-row AQI |
| `POST /api/complaints` | body `{domain,node_id,category,text,image?,duration_days?,area_m2?}` → `{complaint, suggestion, ai:"online"|"offline"}` |
| `GET /api/complaints` | list |
| `POST /api/cluster/run` | `{created:[...], updated:[...]}` — idempotent |
| `GET /api/cases` | list |
| `GET /api/cases/{id}` | case + evidence + trace + standards rows + complaints + actions |
| `PATCH /api/cases/{id}/status` | `{status,actor,role,note}` — whitelist enforced; writes action |
| `POST /api/cases/{id}/draft` | `{text, status:"DRAFT", ai}` |
| `POST /api/cases/{id}/approve` | `{actor}` → stamps approved, logs, may advance status |
| `GET /api/land/reports` | reports with proximity `{score, factors}` |
| `POST /api/land/reports` | create + route |
| `GET /api/trace/{case_id}` | upstream path + plain-language explanation |
| `GET /api/hotspots` | ranked with factor breakdown |
| `POST /api/reports/daily` | draft daily summary, DRAFT stamp |

**Cross-cutting:** exception handlers (HTTPException + generic → JSON envelope + request-id); request-id middleware/logging; config validation at startup (fail fast); static mount: `frontend/dist` if it exists, else `frontend_fallback`, at `/`.

### 7.10 Tests (`backend/tests/`)

`base.py` — the shared harness (stdlib only):
```python
import os, tempfile, threading, unittest, urllib.request, time
import uvicorn
from backend import app
# set NIRIKSHAN_DB to a temp COPY of the seeded db, boot uvicorn in a thread on 127.0.0.1:8010,
# poll GET /api/health until 200 (max 10 s), expose get(path, method, body) via urllib.request
```
- `test_health.py`: health ok + counts; a forced error (unknown endpoint + a bad PATCH) returns the JSON envelope, not HTML.
- `test_seed.py`: every row of the 6.7 contract.
- `test_cluster.py`: run cluster twice → identical case set, no duplicate actions; S1 → MUNICIPAL zone_3 High; S5 → BUILDING_SIDE B11; S2 → Emergency; N0 → no case from routine complaints; invalid status transition → 400.
- `test_forecast.py`: zone_5 current 0.235; crossing 18–24 h; breached_now False.
- `test_air_land.py`: S6 AQI ≥ 301 Very Poor; S7 proximity score ranks school proximity; S8 cross-link exists.

**Gate 2 commands:**
```
PY seed.py
PY -m unittest discover -s backend/tests -v
git add -A; git commit -m "CP2: backend core, all tests green"
```
**Fallback:** a failing test means a real defect — fix it. If a *contract* test fails, fix `seed.py` (section 0, rule 1). If uvicorn cannot bind 8010 (port busy), change the port in `base.py` to 8011 and note it in PROGRESS.md.

---

## 8. Phase 3 — AI agent (2 h)

### 8.1 `backend/agent.py` — provider-agnostic, stdlib only

```python
class Provider:
    def chat(self, system, user, json_mode=False) -> str: ...
    def vision(self, system, text, image_bytes, mime) -> str: ...   # may raise NotSupported

class GeminiProvider(Provider)        # native generateContent
class OpenAICompatProvider(Provider)  # /chat/completions (Groq, OpenRouter, DashScope/Qwen)
class OfflineProvider(Provider)       # always works: keywords + templates

def get_provider() -> Provider        # env-driven; OfflineProvider is the final fallback
def extract_complaint(text) -> dict   # {"category","location_hint","severity_hint","duration_days","area_m2"}
def explain_case(case, standards_rows) -> str
def draft_advisory(case, evidence) -> str
def draft_daily(overview) -> str
```

### 8.2 Environment configuration

| Env var | Meaning | Default |
|---|---|---|
| `LLM_PROVIDER` | `gemini` \| `openai` \| `offline` | `offline` (demo-safe) |
| `LLM_API_KEY` | provider key | none → offline |
| `LLM_MODEL` | model id | gemini: `gemini-2.5-flash`; openai: depends on base |
| `LLM_BASE_URL` | openai-compatible base | Groq `https://api.groq.com/openai/v1` · OpenRouter `https://openrouter.ai/api/v1` · Qwen/DashScope `https://dashscope.aliyuncs.com/compatible-mode/v1` |
| `LLM_TIMEOUT` | seconds | 15 |

**Model guidance:** any cheap model works — the id goes in `LLM_MODEL`. Gemini Flash family: `gemini-2.5-flash` (fallback `gemini-2.0-flash`). Qwen via OpenRouter: `qwen/qwen-2.5-7b-instruct`; via DashScope: `qwen-turbo` / `qwen-plus`. Groq: `llama-3.3-70b-versatile`. Vision: use a vision-capable id; offline = metadata only.

### 8.3 Wire formats (implement exactly)

**Gemini** — `POST {base}/v1beta/models/{LLM_MODEL}:generateContent?key={LLM_API_KEY}`
```json
{"contents":[{"role":"user","parts":[{"text":"<user prompt>"}]}],
 "generationConfig":{"temperature":0,"responseMimeType":"application/json"}}
```
Response text: `data["candidates"][0]["content"]["parts"][0]["text"]`. Vision part: `{"inline_data":{"mime_type":"image/jpeg","data":"<base64>"}}`.

**OpenAI-compatible** — `POST {LLM_BASE_URL}/chat/completions`, header `Authorization: Bearer {LLM_API_KEY}`
```json
{"model":"{LLM_MODEL}",
 "messages":[{"role":"system","content":"<system>"},{"role":"user","content":"<user>"}],
 "temperature":0,"response_format":{"type":"json_object"}}
```
Response text: `data["choices"][0]["message"]["content"]`. Vision: `{"type":"image_url","image_url":{"url":"data:image/jpeg;base64,<b64>"}}`.

**Error handling (unbreakable rule):** any exception, non-200, missing key, or timeout (`urlopen(req, timeout=LLM_TIMEOUT)`) → ONE retry → `OfflineProvider`. The API layer always reports `"ai": "online"|"offline"` so the UI can badge it. `/api/health` never calls the LLM.

### 8.4 Prompts (verbatim)

**Extraction (system):**
```
You extract structured fields from citizen complaints about environmental issues.
Return STRICT JSON: {"category": one of [muddy/turbid water, bad smell, bad taste,
no/low pressure, suspected contamination, stomach illness reported, air pollution,
dust, open waste dump, soil erosion, other], "location_hint": string or null,
"severity_hint": low|medium|high, "duration_days": number or null, "area_m2": number or null}.
Never invent numbers the user did not give. Use null when unsure.
```

**Explanation (system):**
```
You explain an automated water/air/land quality assessment to a municipal officer.
You may ONLY paraphrase the provided standard rows and the provided evidence.
Never state a limit, number, or verdict that is not in the provided text.
End with: "This explanation supports human judgment and is not an official regulatory decision."
```

**Advisory (system):** draft a short public advisory (boil-water / stay-indoors / waste-removal) from the provided case evidence and standard rows; 3–5 sentences; plain language; no invented numbers.

**Daily report (system):** summarize the provided KPI numbers and case list into 5 bullet sections; no invented numbers.

### 8.5 Offline fallback (deterministic)

- `extract_complaint`: keyword map (muddy/turbid/brown → muddy/turbid water; smell/sewage → bad smell; pressure/no water → no/low pressure; dust/smoke → air pollution; garbage/waste/dump → open waste dump; erosion/soil → soil erosion) + regex `since (\d+) days?` → duration_days, `(\d+(?:\.\d+)?)\s*(?:sq ?m|m2|sqm)` → area_m2.
- `explain_case`: template — `"The system grouped {n} complaints from buildings sharing the upstream node {node}. Latest readings: turbidity {x} NTU vs acceptable 1 NTU, chlorine {y} mg/L vs minimum 0.2. Rule fired: {rule}. A human officer must verify."`
- `draft_advisory` / `draft_daily`: template style, DRAFT stamp applied by the caller.

### 8.6 Tests (`test_agent.py`)

- Offline extract returns valid JSON for a muddy-water text and a "garbage since 12 days" text.
- Monkeypatched fake provider (canned response) flows through `/api/cases/{id}/draft` with the DRAFT stamp.
- Simulated failure (provider raising) falls back to offline — no exception leaks.

**Gate 3 commands:**
```
PY -m unittest discover -s backend/tests -v
PY -m uvicorn backend.app:app --port 8000   # smoke test /api/health + draft with LLM_PROVIDER=offline
git add -A; git commit -m "CP3: AI agent with offline fallback"
```

---

## 9. Phase 4 — Frontend (4 h)

### 9.1 Order matters (unbreakable UI)

1. **FIRST:** write `frontend_fallback/index.html` — single file, inline CSS+JS, all demo screens, `fetch('/api/...')`. Verify with the backend on 8000 (Phase 2 server). Commit.
2. **THEN:** scaffold the React app (`npm create vite@latest frontend -- --template react`), pin the versions from section 3 in `package.json`, `npm install`.
3. If `npm install` fails (offline): write `BLOCKED.md`, keep the fallback UI, skip to Phase 5 — the demo still works.

### 9.2 Theme tokens (`src/theme.js`)

```js
export const colors = {
  bg: '#F7FAF8', surface: '#FFFFFF', ink: '#1B2B22',
  green: { 50: '#E8F4EC', 300: '#8FD3A7', 500: '#2F855A', 700: '#1F5E3F' },
  accent: '#34A853', warn: '#F4B400', danger: '#EA4335',
  bands: { Good: '#34A853', Acceptable: '#A8D08D', Poor: '#F4B400', Unsafe: '#EA4335' },
  aqi: { Good: '#34A853', Satisfactory: '#A8D08D', Moderate: '#F4B400',
         Poor: '#FBBC04', 'Very Poor': '#EA4335', Severe: '#9B1C1C' },
};
```
Soft white canvas; green ONLY semantically (bands, primary actions). Rounded-2xl cards, soft shadows, base 15–16 px, light theme only.

### 9.3 Layout

- `Sidebar`: Dashboard · Network Map · Complaints · Cases · Air Quality · Land Reports · Reports.
- `TopBar`: demo clock (from `/api/health`), role switcher (cosmetic), AI status badge.
- `Banner` on every page: disclaimer + "synthetic sample data".

### 9.4 The SVG map (the signature)

- `projection.js`: `x = (lon − minLon)/(maxLon − minLon) · viewW · scale; y = (maxLat − lat)/(maxLat − minLat) · viewH · scale;` pad 10%, keep aspect; manual pan/zoom (~40 lines).
- Render order: faint street grid (seeded, cached) → pipes (thickness ∝ log(diameter_mm)) → nodes (circle, fill = WQI band colour, size by type) → air stations (diamond) → land pins (flags).
- **Flow animation:** `stroke-dasharray: 6 10; animation: dash 1.2s linear infinite;` (`@keyframes dash { to { stroke-dashoffset: -16; } }`) — flows along pipe direction (arrow direction = from_node → to_node).
- **Layer toggles:** water pipes / air stations / land pins.
- Click node → side panel (WQI bars, sparkline, complaints, maintenance, open case link).
- **Trace Upstream:** `GET /api/trace/{case_id}` → highlight path, animate a red pulse from the buildings upstream to the source, show the plain-language explanation.
- Legend: WQI bands + "risk score: higher = worse".

### 9.5 Pages

- **Dashboard:** 4 KPI cards (open cases, worst WQI zone, worst AQI station, complaints 24 h) · triage table (severity badge, age, OVERDUE red badge when High case has no action > 2 h) · hotspot ranking with factor breakdown · mini network preview.
- **Network:** map + side panel + toggles + trace controls.
- **Complaints:** intake form (domain tabs; dropdowns; category; free text; image drag-drop; land extras: duration slider + area input) → submit → extraction suggestion with confirm/edit → nearest sensor preview + area status. Below: my-complaints tracker.
- **CaseDetail:** header (id, title, severity, status) · EvidencePanel (complaints, shared node, rule, readings vs limits, confidence) · TraceDiagram (mini SVG) · standards rows with citations · action log timeline · StatusFlow buttons (whitelist enforced server-side; disable invalid buttons) · Draft advisory: DRAFT stamp → Approve.
- **NodeDetail:** Recharts line chart 14-day turbidity + chlorine (dual axis) with anomaly baseline bands · WQI sub-index bar chart · forecast line + dashed 0.2 limit + crossing marker.
- **Air:** station grid · AqiGauge per station · pollutant table · 24 h PM forecast chart · dust-case link.
- **Land:** report cards (image, duration/area badges, proximity score + factors) · erosion→turbidity cross-link banner → linked water case.
- **Reports:** per-domain KPI rows · case funnel · "Generate daily summary" → draft → Approve.

### 9.6 `api.js` + Vite config

`api.js`: thin fetch wrapper (same origin, JSON, throws with the envelope's `detail`, surfaces the `ai` flag).
`vite.config.js`: `server: { proxy: { '/api': 'http://127.0.0.1:8000' } }` — dev mode needs no CORS. Production = same origin (backend mounts `dist`).

**Gate 4 commands:**
```
npm run build                     # inside frontend/ — must exit 0
PY -m uvicorn backend.app:app --port 8000
# browser walkthrough: complaint -> cluster -> case -> trace -> forecast -> draft -> approve -> history
git add -A; git commit -m "CP4: frontend (React + fallback UI)"
```

---

## 10. Phase 5 — Air & land + Reports (2.5 h)

Wire air and land end-to-end using the same case workflow (no new backend concepts — `aqi.py`, `air_readings`, `land_reports`, proximity scoring, cross-link). Build the Reports dashboard + daily-report endpoint UI.

Proximity scoring (transparent, deterministic): `score = 30·(near_school) + 30·(within 200 m of water body) + 20·(near main road) + 20·(duration_days ≥ 7)`, capped at 100, factors returned individually.

**Gate 5 commands:**
```
PY -m unittest discover -s backend/tests -v
# walk through S6, S7, S8 + N0 in the browser
git add -A; git commit -m "CP5: air + land + reports"
```

---

## 11. Phase 6 — Polish, rehearsal, submission (2 h)

1. `README.md`: setup, run commands, demo script, synthetic-data + AI disclosure.
2. Rehearse the demo script (section 13) twice; fix dead ends only.
3. **Backup video** at ~60% of available time, then polish only the demo path.
4. Wi-Fi OFF, run the full demo — must work.
5. Submit: repo + video + live URL + AI disclosure + screenshots.
6. **Write `TRANSFER.md`** — the final handoff (contents below), then commit it.

**TRANSFER.md must contain, in this order:**
- Status: which checkpoint was reached, and the exact last gate output.
- Run it: the exact commands to seed, test, and start the app (PY shorthand expanded for the current OS).
- What was built: the file tree and a 1-line description per module/page.
- What remains: any cut-list items, known bugs, unfinished polish.
- Demo script: the 3-minute script, ready to rehearse.
- Handoff: what the next agent or human should do first.

**Gate 6:** submission complete; final `PROGRESS.md` summary + `TRANSFER.md` written and committed.

---

## 12. Checkpoints (commit + tests green at each)

| CP | Gate | Safe state |
|---|---|---|
| CP0 | scaffold + pinned installs + config | structure committed |
| CP1 | seed + verify | dataset usable, demo numbers pinned |
| CP2 | backend core + tests | API fully demo-able via curl |
| CP3 | agent + tests | draft/approve works offline and with a key |
| CP4 | frontend (fallback UI + React) | 3-min demo works in browser |
| CP5 | air + land + reports | all scenarios walk through |
| CP6 | polish + submission | submitted with backup video |

---

## 13. Demo script (3 minutes)

| Time | Beat |
|---|---|
| 0:00 | Officer dashboard — 3 open Zone-3 complaints, WQI red |
| 0:15 | Open a complaint — turbidity ≈ 8.5 NTU, chlorine ≈ 0.03 |
| 0:30 | Run clustering → 5 complaints collapse into 1 case |
| 0:45 | Evidence panel — shared node zone_3, rule fired, readings vs limits |
| 1:15 | Trace upstream — red pulse to the old 1991 pipe |
| 1:45 | Standards panel — IS 10500 rows with citations |
| 2:00 | Zone 5 forecast — 0.235 now, crosses 0.2 in ~21 h |
| 2:20 | Act two — pipe burst, Emergency, overdue badge |
| 2:40 | Draft advisory → Approve → Action Taken |
| 2:50 | History — who did what, when. Close. |

(Air and land: 15 s each, only if time — dust AQI gauge, waste report with image.)

---

## 14. Cut list (if behind — cut in this order)

1. Reports daily-summary generator
2. Land proximity extras (keep basic form + case)
3. Air 24 h forecast (keep gauge + dust case)
4. Escalation overdue badge
5. Role switcher

**NEVER cut:** clustering, trace upstream, case workflow, evidence panel, the disclaimer banner, the fallback UI.

---

## 15. Q&A bank (judges will ask)

- **Real data?** No — synthetic sample data for a fictional city, labelled. The graph, physics, and limits are real.
- **How do you know it's the pipe?** We don't claim certainty — lowest shared upstream node + corroborating readings + the rule; a human inspects and decides.
- **Does the LLM decide compliance?** Never. Rules compute verdicts; the agent explains with citations and drafts letters; a human signs.
- **Why not just a map?** A map shows where complaints are; the graph shows what they share. The graph is the product.
- **Does it scale?** The engine is data-agnostic — ward → city is more rows, not more code.
- **0.2 mg/L chlorine — a legal limit?** It's a process-control minimum, not a health-based standard. Saying that signals domain literacy.

---

## 16. Definition of done (the run succeeded only if ALL FOUR pass)

```
PY seed.py && PY verify_seed.py
PY -m unittest discover -s backend/tests -v      # all green on 8010
PY -m uvicorn backend.app:app --port 8000        # API + UI serve
# 3-minute demo script runs without dead ends, fully offline
```
Plus: every page shows the disclaimer + synthetic label; all AI outputs stamped DRAFT until approved; `PROGRESS.md` tells the human exactly what happened; `TRANSFER.md` lets anyone continue in under 5 minutes.
