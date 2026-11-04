"""Generate the frontend handoff documents from the running app (revised Phase 4).

    ./.venv/Scripts/python.exe make_frontend_spec.py

Boots the real app under uvicorn on the test port against a TEMP COPY of the
seeded database (the same harness `unittest` uses, so the dev database is never
written), saves the live OpenAPI schema to `docs/openapi.json`, calls every
endpoint once, and writes `docs/FRONTEND_SPEC.md` with one real response per
endpoint. Re-run it after any API change: the handoff cannot drift from the code
because both files are generated from it.

Big payloads are sampled (the first few list items) and long strings are cut, each
noted under its example — the shapes are exact, the row counts are not.
"""

import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, ROOT)

from backend.tests import base  # noqa: E402  (boots the app on 8010 against a temp DB copy)

DOCS = os.path.join(ROOT, "docs")
SPEC_PATH = os.path.join(DOCS, "FRONTEND_SPEC.md")
OPENAPI_PATH = os.path.join(DOCS, "openapi.json")

# The prose an officer reads (advisory, explanation) is the deliverable, so it is
# never cut mid-sentence; every other long string is the standards excerpt, and a
# few hundred characters of it is enough to show the shape.
LONG_KEYS = ("text", "explanation", "note")
MAX_STRING = 600
MAX_LONG = 3000

CTX = {}
SECTIONS = []

# ---------------------------------------------------------------------------
# capturing
# ---------------------------------------------------------------------------


def _shorten(value, notes, key=None):
    if isinstance(value, str):
        limit = MAX_LONG if key in LONG_KEYS else MAX_STRING
        if len(value) > limit:
            notes.add("strings longer than %d chars" % limit)
            return value[:limit].rstrip() + " …[trimmed]"
        return value
    if isinstance(value, dict):
        return {k: _shorten(v, notes, k) for k, v in value.items()}
    if isinstance(value, list):
        return [_shorten(v, notes, key) for v in value]
    return value


def _fill(body):
    """Resolve {node_id}-style placeholders in an example request body."""
    if isinstance(body, dict):
        return {k: _fill(v) for k, v in body.items()}
    if isinstance(body, str) and body.startswith("{") and body.endswith("}"):
        return CTX.get(body[1:-1], body)
    return body


def _cut(payload, keys, n):
    """Keep the first `n` items of the list at `keys`; returns the original length."""
    if isinstance(keys, str):
        keys = (keys,)
    node = payload
    for key in keys[:-1]:
        node = node.get(key) if isinstance(node, dict) else None
        if node is None:
            return 0
    items = node.get(keys[-1]) if isinstance(node, dict) else None
    if isinstance(items, list) and len(items) > n:
        node[keys[-1]] = items[:n]
        return len(items)
    return 0


def capture(method, path, note, body=None, cuts=(), params=None):
    """Call one endpoint on the running app and queue it for the document."""
    real = _resolve(path)
    query = "?" + "&".join("%s=%s" % kv for kv in params) if params else ""
    status, payload = base.api(real + query, method=method, body=_fill(body))
    if status != 200:
        raise SystemExit("%s %s -> HTTP %s: %s" % (method, real, status, payload))

    display = json.loads(json.dumps(payload))
    notes = set()
    for keys, n in cuts:
        total = _cut(display, keys, n)
        if total:
            notes.add("`%s`: the first %d of %d rows" % (".".join(keys), n, total))
    pretty = json.dumps(_shorten(display, notes), indent=2, sort_keys=True)
    SECTIONS.append({"method": method, "label": real + query, "note": note,
                     "body": body, "pretty": pretty,
                     "trimmed": sorted(notes)})
    return payload


def _resolve(path):
    for name, value in CTX.items():
        path = path.replace("{%s}" % name, str(value))
    return path


# ---------------------------------------------------------------------------
# the calls, in the order the demo makes them
# ---------------------------------------------------------------------------


def _pick_water_node(preferred, nodes):
    """A node the charts can use: sensor readings *and* a chlorine forecast.

    The hero case's shared node normally qualifies; if it does not, fall back to any
    sensor node so the spec still shows a real, copy-pasteable example.
    """
    for node_id in [preferred] + [n["id"] for n in nodes if n.get("wqi")]:
        if not node_id:
            continue
        if (base.api("/api/nodes/%s/readings" % node_id)[0] == 200
                and base.api("/api/nodes/%s/forecast" % node_id)[0] == 200):
            return node_id
    raise SystemExit("no water node serves both readings and forecast")


def read_endpoints():
    capture("GET", "/api/health",
            "Top bar. `demo_now` is the clock every timestamp in this API is measured "
            "against, the counts prove the seed loaded, and `ai` is the online/offline "
            "badge. This endpoint never touches the network — safe to poll.")
    capture("GET", "/api/overview",
            "The whole dashboard in one call: `kpis`, `triage` (open cases with "
            "`overdue`, `complaints` and `last_action`), `hotspots`, `demo_now`. "
            "Render `disclaimer` and `data` in the banner.",
            cuts=((("triage",), 2), (("hotspots",), 2)))
    net = capture("GET", "/api/network",
                  "The entire map in one call — every node (with `wqi` and `latest` "
                  "where a sensor exists) and every pipe. Do not loop over nodes: the "
                  "server bulk-loads this, and per-node loops are the one thing the "
                  "backend was written to avoid.",
                  cuts=(("nodes", 2), ("pipes", 2)))
    buildings = [n["id"] for n in net["nodes"] if n["type"] == "building"]

    cases = capture("GET", "/api/cases",
                    "Case list, worst severity first. Every row already carries the "
                    "parsed `evidence` and `overdue`, so the list page never needs a "
                    "detail call. Optional `?status=` / `?domain=`.",
                    cuts=(("cases", 1),))
    hero = next((c for c in cases["cases"] if c["id"] == "CASE-2026-003"),
                cases["cases"][0])
    CTX["case_id"] = hero["id"]
    CTX["node_id"] = _pick_water_node(hero.get("node_id"), net["nodes"])
    # A building that already shares the hero case's upstream node, so the example
    # complaint is the demo's "one more complaint from ward 3", not a random ward.
    shared = [b for b in hero["evidence"].get("buildings", [])
              if any(n["id"] == b and n["type"] == "building" for n in net["nodes"])]
    CTX["building_id"] = (shared or buildings)[0]

    capture("GET", "/api/nodes/{node_id}",
            "Node side panel: the node row, `wqi` with sub-indices, the latest "
            "readings, its sensor, maintenance history, the complaints attached to it "
            "and any open case.")
    capture("GET", "/api/nodes/{node_id}/readings",
            "14-day hourly series from the node's multi-parameter sensor — the "
            "turbidity/chlorine chart and the anomaly baseline bands.",
            cuts=(("readings", 3),))
    capture("GET", "/api/nodes/{node_id}/forecast",
            "24-hour chlorine projection with the 0.2 mg/L minimum and the crossing "
            "marker. `404` for a node with no chlorine series — handle it, do not "
            "assume every node has a sensor.")

    air = capture("GET", "/api/air",
                  "Air page: every station with a nested `aqi` object (value, category, "
                  "driving pollutant, sub-indices) and its own `pm_forecast`, plus the "
                  "`worst` station. Note the key is `id`, not `station_id`.",
                  cuts=(("stations", 2),))
    CTX["station_id"] = (air["worst"] or air["stations"][0])["id"]
    capture("GET", "/api/air/{station_id}/readings",
            "One station's hourly series, AQI recomputed on every row — the gauge "
            "history and the PM chart.",
            cuts=(("readings", 3),))

    capture("GET", "/api/complaints",
            "Complaint table + the intake tracker. `extracted_fields` arrives parsed; "
            "`status` starts at `NEW`.",
            cuts=(("complaints", 2),), params=[("domain", "water")])
    capture("GET", "/api/cases/{case_id}",
            "CaseDetail in one call: `case`, `evidence`, `trace`, only the breached "
            "`standards` rows, `standards_excerpt` (the raw text of the bundled IS "
            "10500 / NAQI / SwM excerpt to cite), the source `complaints`, the "
            "`actions` timeline and `allowed_transitions` — disable every status "
            "button not in that list.")
    capture("GET", "/api/trace/{case_id}",
            "Trace Upstream: the path from the shared node back to the source, each "
            "pipe section with its decay coefficient, the `worst_pipe`, and a "
            "plain-language `explanation` to put beside the red pulse animation. "
            "`400` for air/land cases.")
    land = capture("GET", "/api/land/reports",
                   "Land page: each report with `land_meta`, the `proximity` score and "
                   "its separate factors, the erosion -> turbidity `cross_link`, and "
                   "`image_url` (null when no photo). `weights` documents the scoring "
                   "so the UI can explain the number.",
                   cuts=(("reports", 1),))
    CTX["land_node_id"] = (land["reports"][0]["node_id"] if land["reports"]
                           else "land_01")
    capture("GET", "/api/hotspots",
            "Dashboard hotspot ranking: per-ward complaint counts with the factor "
            "breakdown behind each rank.",
            cuts=(("hotspots", 3),))


def write_endpoints():
    """The demo path itself. These write to the temp copy, so the dev DB stays clean."""
    capture("POST", "/api/complaints",
            "Intake. The free text is run through the agent and the answer comes back "
            "as `suggestion` for the officer to confirm or edit; `cluster` names the "
            "cases this complaint just joined; `nearest_sensor` gives the area status "
            "under the pipes. Optional `image` is base64 jpg/png only.",
            body={"domain": "water", "node_id": "{building_id}", "category": None,
                  "text": "Brown water from the tap since 3 days, smells of sewage"},
            cuts=((("cluster", "created"), 3), (("cluster", "updated"), 3)))
    capture("POST", "/api/cluster/run",
            "`Run clustering` button. Idempotent and deterministic: the same "
            "complaints produce the same cases, so calling it twice is harmless. "
            "Returns `created`, `updated`, `skipped`.",
            cuts=(("created", 1), ("updated", 1)))
    capture("POST", "/api/cases/{case_id}/draft",
            "Draft advisory + explanation. Both come back stamped (`status: DRAFT`) "
            "with `ai` saying which provider wrote them. Nothing is sent until a human "
            "approves — the UI must show the DRAFT stamp over the text.")
    capture("PATCH", "/api/cases/{case_id}/status",
            "Workflow advance. The server enforces the whitelist "
            "(Open -> Investigating -> Action Taken -> Resolved); a bad move is a 400 "
            "whose `detail` names the allowed values. The complaints that made the "
            "case move to the same status.",
            body={"status": "Investigating", "actor": "Officer R. Rao",
                  "role": "Ward Officer",
                  "note": "Crew dispatched to the 1991 main."},
            cuts=(("actions", 2),))
    capture("POST", "/api/cases/{case_id}/approve",
            "Human sign-off on the draft. Logs actor + role; the optional `advance_to` "
            "is checked against the same whitelist.",
            body={"actor": "Officer R. Rao", "role": "Ward Officer",
                  "advance_to": "Action Taken"},
            cuts=(("actions", 2),))
    capture("POST", "/api/land/reports",
            "Land intake: the complaint comes back with its proximity score and "
            "factors, a routing suggestion and the water cross-link. `node_id` must "
            "name a `land_site`.",
            body={"node_id": "{land_node_id}", "category": "Open waste dump",
                  "text": "Garbage pile beside the school compound since 12 days",
                  "duration_days": 12, "area_m2": 40})
    capture("POST", "/api/reports/daily",
            "Daily summary. `snapshot` is the object /api/overview returns, so the "
            "page can show the numbers beside the drafted text. `status: DRAFT` again.",
            cuts=((("snapshot", "triage"), 1), (("snapshot", "hotspots"), 1)))


# ---------------------------------------------------------------------------
# OpenAPI-derived parameter tables
# ---------------------------------------------------------------------------


def _deref(spec, node):
    while isinstance(node, dict) and "$ref" in node:
        target = spec
        for part in node["$ref"].lstrip("#/").split("/"):
            target = target[part]
        node = target
    return node


def _type_of(schema):
    """A readable type for the markdown table — no pipes, they break the row."""
    schema = schema or {}
    if "anyOf" in schema:
        kinds = sorted({s.get("type") for s in schema["anyOf"]
                        if s.get("type") and s["type"] != "null"})
        return "%s (nullable)" % (" / ".join(kinds) if kinds else "any")
    if "enum" in schema:
        return "one of " + ", ".join(json.dumps(e) for e in schema["enum"])
    return {"integer": "int", "number": "float"}.get(schema.get("type"),
                                                     schema.get("type", "any"))


def param_rows(spec, path, method):
    op = spec["paths"].get(path, {}).get(method.lower(), {})
    rows = []
    for p in op.get("parameters", []):
        sch = _deref(spec, p.get("schema", {}))
        default = "" if sch.get("default") is None else json.dumps(sch["default"])
        rows.append("| `%s` | %s | %s | %s | %s |"
                    % (p["name"], p["in"], "yes" if p.get("required") else "no",
                       _type_of(sch), default))
    rb = op.get("requestBody")
    if rb:
        schema = _deref(spec, rb["content"]["application/json"]["schema"])
        required = set(schema.get("required", []))
        for name, sub in sorted(schema.get("properties", {}).items()):
            sub = _deref(spec, sub)
            default = "" if sub.get("default") is None else json.dumps(sub["default"])
            rows.append("| `%s` | body | %s | %s | %s |"
                        % (name, "yes" if name in required else "no",
                           _type_of(sub), default))
    return rows


ROUTE_NOTES = {
    "GET /api/health": "Top bar (clock, AI badge)",
    "GET /api/overview": "Dashboard",
    "GET /api/network": "Network map",
    "GET /api/nodes/{node_id}": "Network map side panel",
    "GET /api/nodes/{node_id}/readings": "Node detail chart",
    "GET /api/nodes/{node_id}/forecast": "Node detail forecast",
    "GET /api/air": "Air Quality",
    "GET /api/air/{station_id}/readings": "Air Quality station history",
    "POST /api/complaints": "Complaints intake",
    "GET /api/complaints": "Complaints tracker",
    "POST /api/cluster/run": "Complaints / Cases button",
    "GET /api/cases": "Cases list, Dashboard triage",
    "GET /api/cases/{case_id}": "Case detail",
    "PATCH /api/cases/{case_id}/status": "Case detail status flow",
    "POST /api/cases/{case_id}/draft": "Case detail advisory",
    "POST /api/cases/{case_id}/approve": "Case detail advisory",
    "GET /api/trace/{case_id}": "Network map trace, Case detail diagram",
    "GET /api/land/reports": "Land Reports",
    "POST /api/land/reports": "Land Reports intake",
    "GET /api/hotspots": "Dashboard hotspots",
    "POST /api/reports/daily": "Reports",
}


# ---------------------------------------------------------------------------
# prose
# ---------------------------------------------------------------------------

PROSE = [
    """
# Nirikshan — frontend handoff

**Audience:** the agent building the UI. **Author:** the backend build, from the running
code. Everything below is generated — `PY make_frontend_spec.py` rewrites this file and
`docs/openapi.json` from a live server, so no endpoint shape here is stale.

Nirikshan turns citizen complaints into investigated cases. A complaint is not a pin on a
map: it is a sensor reading on a ward. The backend groups complaints that share upstream
plumbing, traces them to the lowest common ancestor node, checks the area's own water /
air / land readings against the Indian standards it ships with, and hands an officer the
evidence, a trace, a cited standard and a *draft* advisory that a human signs. The UI's
job is to make that chain legible — and to never imply that the AI decided anything.

## 1. The five rules the UI must not break

1. **Every page shows the disclaimer banner** and the "synthetic sample data" label. Both
   strings are in the responses (`disclaimer`, `data`) — use them, don't retype them.
2. **AI output is a draft until a human approves.** `/draft` and `/reports/daily` return
   `status: "DRAFT"`; render a visible DRAFT stamp over the text until `/approve` succeeds.
3. **Badge the AI mode.** Responses that ran a provider carry `"ai": "online"|"offline"`.
   Show it in the top bar (from `/api/health`) and on every drafted block.
4. **The LLM never decides.** Severity, status, routing and the verdict come from the
   rules; the UI renders `evidence`, `standards` and `rule` — it must not compute its own.
5. **Never invent a number.** If a limit is not in the response, do not display it; if a
   field is null (no sensor, no image, no forecast), render the empty state, not a guess.

## 2. Run the backend

```
PY -m uvicorn backend.app:app --port 8000
```

`PY` is `./.venv/Scripts/python.exe` (Windows Git Bash). The database is `nirikshan.db`
at the repo root; `PY seed.py && PY verify_seed.py` rebuilds and checks it. Optional LLM
env vars (all default to the offline provider, which always works):
`LLM_PROVIDER` (`offline` | `gemini` | `openai`), `LLM_API_KEY`, `LLM_MODEL`,
`LLM_BASE_URL`, `LLM_TIMEOUT`. **The demo must run with none of them set.**

## 3. How serving works

`backend/app.py` mounts, in order:

| Mount | Serves |
|---|---|
| `/api/…` | the JSON API (21 routes, below) |
| `/openapi.json`, `/docs` | the live schema and Swagger UI — use `/docs` while building |
| `/data/images` | seeded demo photos and complaint uploads |
| `/` | `frontend/dist` **if that directory exists**, otherwise `frontend_fallback/` |

So the build is drop-in: put the app at `frontend/dist/index.html` and it takes over `/`
with no backend change. Same origin — there is no CORS and no API base URL to configure;
plain `fetch('/api/overview')`. In Vite dev mode proxy `/api` to `127.0.0.1:8000`.

**Plain HTML/CSS/JS is acceptable and preferred.** `frontend_fallback/index.html` is a
single-file placeholder that fetches live data today; it is a working example of the
fetch pattern, not the design target. React + Vite + Recharts is allowed but `npm install`
may be offline, and the demo must not depend on it: whatever you build, keep a static
page that works with no build step, because that is what ships if the install fails.

## 4. Design tokens

Verbatim from PLAN.md §9.2 — soft white canvas, green only where it means something:

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

As CSS custom properties:

```css
:root {
  --bg: #F7FAF8; --surface: #FFFFFF; --ink: #1B2B22;
  --green-50: #E8F4EC; --green-300: #8FD3A7; --green-500: #2F855A; --green-700: #1F5E3F;
  --accent: #34A853; --warn: #F4B400; --danger: #EA4335;
  --good: #34A853; --acceptable: #A8D08D; --poor: #F4B400; --unsafe: #EA4335;
}
```

Colour comes **from the data**: `wqi.colour` / `wqi.band` and `aqi.category` are already
computed server-side. Look the value up in `bands` / `aqi`; never re-derive a threshold.
Rounded-2xl cards, soft shadows, 15–16 px base, light theme only.

Layout (PLAN §9.3): sidebar `Dashboard · Network Map · Complaints · Cases · Air Quality ·
Land Reports · Reports`; top bar with the demo clock from `/api/health` and the AI badge;
the banner on every page.

## 5. Required pages

| Page | Shows | Endpoints |
|---|---|---|
| **Dashboard** | 4 KPI cards (open cases, worst WQI zone, worst AQI station, complaints in 24 h), triage table with severity badge + age + red OVERDUE flag, hotspot ranking with factor breakdown, mini network preview | `/api/overview`, `/api/hotspots` |
| **Network Map** | the SVG map (§6), layer toggles, node side panel, Trace Upstream | `/api/network`, `/api/nodes/{id}`, `/api/nodes/{id}/readings`, `/api/trace/{case_id}` |
| **Complaints** | intake form (domain tabs, node picker, category, free text, image drag-drop, land extras: duration + area) → submit → confirm/edit the extraction → nearest-sensor preview; below it, the tracker | `POST /api/complaints`, `GET /api/complaints` |
| **Cases** | case list, worst first, with ward, scope, severity, status, OVERDUE | `GET /api/cases` |
| **Case detail** | header (id, title, severity, status) · evidence panel (complaints, shared node, the rule string, readings vs limits, confidence) · trace diagram · standards rows with citations · action timeline · status buttons limited to `allowed_transitions` · draft advisory with DRAFT stamp → Approve | `/api/cases/{id}`, `POST …/draft`, `PATCH …/status`, `POST …/approve`, `/api/trace/{id}` |
| **Node detail** | 14-day turbidity + chlorine dual-axis chart with anomaly bands, WQI sub-index bars, forecast line with the dashed 0.2 mg/L minimum and the crossing marker | `/api/nodes/{id}`, `/api/nodes/{id}/readings`, `/api/nodes/{id}/forecast` |
| **Air Quality** | station grid, one gauge per station, pollutant table, 24 h PM forecast, link to the dust case | `/api/air`, `/api/air/{station_id}/readings` |
| **Land Reports** | report cards (photo, duration/area badges, proximity score with its factors explained), erosion → turbidity cross-link banner that jumps to the linked water case | `/api/land/reports`, `POST /api/land/reports` |
| **Reports** | per-domain KPI rows, case funnel, "Generate daily summary" → draft → approve | `/api/overview`, `POST /api/reports/daily` |

**Never cut** (PLAN §14): the clustering action, Trace Upstream, the case workflow, the
evidence panel, the disclaimer banner and the fallback page.

## 6. The SVG map (the signature screen)

- Projection (PLAN §9.4), padding 10 % and keeping aspect:
  `x = (lon − minLon) / (maxLon − minLon) · viewW · scale` and
  `y = (maxLat − lat) / (maxLat − minLat) · viewH · scale`.
  `minLon/maxLon/minLat/maxLat` come from the nodes in `/api/network`. Manual pan/zoom.
- Render order: faint seeded street grid → pipes (stroke width ∝ `log(diameter_mm)`) →
  water nodes (circle, fill = WQI band colour, size by `type`) → air stations (diamond) →
  land sites (flag). `type` values: `source`, `treatment_plant`, `reservoir`, `pump`,
  `junction`, `zone`, `building`, `air_station`, `land_site`.
- Flow animation along `from_node → to_node`:
  `stroke-dasharray: 6 10; animation: dash 1.2s linear infinite;`
  `@keyframes dash { to { stroke-dashoffset: -16; } }`
- Layer toggles for pipes / air / land. Legend: the four WQI bands, and a note that a
  higher decay `k` means worse.
- Click a node → side panel (`/api/nodes/{id}`): WQI bars, sparkline
  (`…/readings`), maintenance rows, attached complaints, link to its open case.
- **Trace Upstream** (`/api/trace/{case_id}`): highlight `path`, run a red pulse from the
  buildings to the source, and show `explanation` next to `worst_pipe` — that sentence
  names the 1991 CI main and its `k`, and it is the moment of the demo.
""",
    """
## 7. API contract

21 routes, all JSON, all served from the same origin. `docs/openapi.json` is the live
schema (`GET /openapi.json`); the parameter tables below are read out of it, and every
example response is a real body captured from the seeded database. `{case_id}`,
`{node_id}`, `{station_id}` in the paths below are placeholders for real IDs you can take
from the list endpoints.

Route index:

| Route | Used by |
|---|---|
""",
    """
## 8. Conventions that apply to every route

- **IDs are strings** minted server-side: cases `CASE-2026-0NN`, complaints `CMP-NNN`,
  nodes `src_river`, `plant_n`, `res_hill`, `pump_1`, `J01`, `zone_1`, `B01`, `air_01`,
  `land_01`. There is no numeric ID anywhere — don't parse one.
- **Errors are always `{"detail": "…"}` with a plain-language message**, for 400/404/422
  and 500 alike. `showToast(err.detail)` is enough; there is no error code table.
- Every response has an **`X-Request-Id`** header (echoed back if you send one) for
  correlating with the server log.
- **Time is the demo clock**, not wall time: NOW = `2026-11-03 09:00:00`, returned as
  `demo_now` (and `now` on a few older rows). All timestamps are `YYYY-MM-DD HH:MM:SS`
  in that frame. Age and the OVERDUE flag are computed server-side — render `overdue`,
  don't recompute it.
- **Vocabularies** (exact strings): `domain` = `water|air|land`; `status` =
  `Open|Investigating|Action Taken|Resolved` with legacy aliases `NEW` and `Emergency`
  accepted as inputs; `severity` = `Emergency|High|Medium|Low`; `scope` =
  `MUNICIPAL|BUILDING_SIDE`. WQI bands = `Good|Acceptable|Poor|Unsafe`; AQI categories =
  `Good|Satisfactory|Moderate|Poor|Very Poor|Severe`.
- **Status moves are one step forward only.** Use `allowed_transitions` from the case
  payload to enable/disable buttons; a wrong `PATCH` returns 400 naming the legal value.
- **`evidence` is a parsed object, and its keys differ per domain.** Water: `buildings`,
  `complaints`, `readings`, `limits` (the full parameter table), `rule`, `wqi`,
  `coliform`, `anomaly`, `sibling_status`, `confidence`. Air adds the AQI rows; land adds
  `proximity` (score + factors) and `cross_link`. The `rule` string is the literal rule
  that fired — show it verbatim in a monospace block, it is the "how did you know" answer.
- **`disclaimer` and `data` appear on the payload** of most endpoints. Use them in the
  banner; retyping them in the UI is how the two get out of sync.
- **Bulk first.** `/api/network` and `/api/overview` each return everything a page needs.
  The backend deliberately avoids N+1 queries; the UI must not undo that by looping
  `/api/nodes/{id}` over 98 nodes.
- **API fields are frozen** — additive only. If a field is missing, it does not exist;
  ask for it rather than guessing a key.
""",
    """
## 10. Demo script the UI must support

The 3-minute rehearsal (PLAN §13). Each beat is one page plus one call, so a dead end here
is a bug in the UI, not in the data.

| Time | Beat | Page | Call |
|---|---|---|---|
| 0:00 | Officer dashboard: open Zone-3 case, WQI red | Dashboard | `GET /api/overview` |
| 0:15 | Open a complaint: turbidity ≈ 8.5 NTU, chlorine ≈ 0.03 | Case detail / Node detail | `GET /api/cases/{id}`, `GET /api/nodes/{id}/readings` |
| 0:30 | Run clustering → complaints collapse into one case | Complaints | `POST /api/complaints`, `POST /api/cluster/run` |
| 0:45 | Evidence panel: shared node, rule fired, readings vs limits | Case detail | `GET /api/cases/{id}` |
| 1:15 | Trace upstream: red pulse to the 1991 pipe | Network Map | `GET /api/trace/{id}` |
| 1:45 | Standards panel: IS 10500 rows with citations | Case detail | `standards`, `standards_excerpt` on `GET /api/cases/{id}` |
| 2:00 | Forecast: 0.235 now, crosses 0.2 in about 21 h | Node detail | `GET /api/nodes/{id}/forecast` |
| 2:20 | Act two — a burst, high severity, OVERDUE badge | Cases | `GET /api/cases` |
| 2:40 | Draft advisory → Approve → Action Taken | Case detail | `POST …/draft`, `POST …/approve`, `PATCH …/status` |
| 2:50 | History: who did what, when — close | Case detail | `actions` on `GET /api/cases/{id}` |

Air and land get 15 seconds each: the dust station's gauge (`GET /api/air`) and a waste
report with its photo and proximity score (`GET /api/land/reports`).

## 11. Acceptance checklist

Everything here must pass with the Wi-Fi off, running only `PY -m uvicorn
backend.app:app --port 8000` from a fresh clone plus `PY seed.py`.

- [ ] `http://127.0.0.1:8000/` serves the app (never a 404) with no build step.
- [ ] Each page in §5 loads: Dashboard, Network Map, Complaints, Cases, Case detail, Node
      detail, Air Quality, Land Reports, Reports.
- [ ] Every one of the ten demo beats in §10 completes with no manual SQL or API tinkering.
- [ ] Network Map draws all 98 nodes and 78 pipes, animates flow, and the three layer
      toggles work.
- [ ] Trace Upstream highlights the path and names the worst pipe in words.
- [ ] Clustering is a button, and pressing it twice changes nothing (it is idempotent).
- [ ] Draft advisory shows a DRAFT stamp, and the stamp disappears only after Approve.
- [ ] Status buttons off the `allowed_transitions` list are disabled, and a forced bad
      `PATCH` shows the server's `detail` message rather than crashing.
- [ ] The AI badge reads `offline` with no keys set, and every drafted block is labelled.
- [ ] Disclaimer + "synthetic sample data" visible on every page.
- [ ] Error envelope surfaced in the UI for 400/404 (e.g. `GET /api/nodes/nope`), never a
      blank screen or an uncaught promise.
- [ ] Null-safe empty states: a node with no sensor, a report with no image, a non-water
      case with no trace.
- [ ] `npm` is not required for any of the above.
- [ ] `PY -m unittest discover -s backend/tests` is still green after you finish — the
      suite covers the API, so a failure means the UI asked the backend to change.

## 12. Where the truth lives

| Question | Look at |
|---|---|
| Exact schema of any route | `docs/openapi.json` or `/docs` on a running server |
| A real response body | §9 of this file, or `curl` the route on a running server |
| Why a number is what it is | `evidence.rule`, `standards[].citation`, `config/limits.json`, `config/rules.json` |
| Product intent, demo, Q&A | `PLAN.md` §1, §13, §15 |
| What the backend already guarantees | `PROGRESS.md`, `TRANSFER.md`, `backend/tests/` |

If you need a new field, ask for it — do not derive compliance verdicts in the browser.
The rules engine is deterministic and tested; a second implementation in the UI is how the
demo starts lying.
""",
]


# ---------------------------------------------------------------------------
# writing
# ---------------------------------------------------------------------------


def build(spec):
    out = [block.strip("\n") for block in PROSE[:2]]
    for section in SECTIONS:
        template = template_of(section)
        out.append("| `%s %s` | %s |" % (section["method"], template,
                                         ROUTE_NOTES.get(
                                             "%s %s" % (section["method"], template),
                                             "—")))
    out.append(PROSE[2].strip("\n"))

    out.append("\n---\n\n## 9. Endpoint reference\n")
    for section in SECTIONS:
        template = template_of(section)
        out.append("### %s %s\n" % (section["method"], template))
        out.append(section["note"] + "\n")
        rows = param_rows(spec, template, section["method"])
        if rows:
            out.append("| Parameter | Where | Required | Type | Default |")
            out.append("|---|---|---|---|---|")
            out.extend(rows)
            out.append("")
        else:
            out.append("_No parameters._\n")
        if section["body"] is not None:
            out.append("**Request body** for this example:\n")
            out.append("```json\n%s\n```"
                       % json.dumps(_fill(section["body"]), indent=2, sort_keys=True))
        else:
            out.append("**Request**: none.\n")
        out.append("\n**Real response** from the seeded database (`%s`):\n"
                   % section["label"])
        out.append("```json\n%s\n```" % section["pretty"])
        if section["trimmed"]:
            out.append("\n_Sampled for reading — %s. Every row has exactly this shape; "
                       "the counts come from `/api/health`._" % "; ".join(
                           section["trimmed"]))
        out.append("")
    out.append(PROSE[3].strip("\n"))
    out.append("\n---\n\n_Generated by `PY make_frontend_spec.py` against a live server "
               "and the seeded database. Do not hand-edit: change the code or the "
               "generator, then re-run — `docs/openapi.json` is rewritten in the same "
               "pass._")

    text = _tidy("\n".join(out))
    with open(SPEC_PATH, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(text)
    return text


def _tidy(text):
    """One blank line above every heading, never more than one blank line anywhere.

    Inside a fenced example the bytes belong to the captured response, so headings in
    a quoted standards excerpt are left exactly as the server sent them.
    """
    lines = []
    fenced = False
    for line in text.split("\n"):
        if line.startswith("```"):
            fenced = not fenced
        if not fenced and line.startswith("#") and lines and lines[-1].strip():
            lines.append("")
        lines.append(line)
    return re.sub(r"\n{3,}", "\n\n", "\n".join(lines)).rstrip() + "\n"


def template_of(section):
    """The OpenAPI path template a section was called with ({node_id} etc. restored)."""
    label = section["label"].split("?")[0]
    for name, value in CTX.items():
        label = label.replace("/%s" % value, "/{%s}" % name)
    return label


def main():
    base.start_server()
    try:
        status, spec = base.api("/openapi.json")
        if status != 200:
            raise SystemExit("no OpenAPI schema: %s" % spec)
        os.makedirs(DOCS, exist_ok=True)
        with open(OPENAPI_PATH, "w", encoding="utf-8", newline="\n") as fh:
            fh.write(json.dumps(spec, indent=2, sort_keys=True) + "\n")

        read_endpoints()
        write_endpoints()
        text = build(spec)

        routes = sum(len(ops) for ops in spec["paths"].values())
        print("wrote %s (%d routes, %d lines)"
              % (os.path.relpath(SPEC_PATH, ROOT), routes, len(text.splitlines())))
        print("wrote %s" % os.path.relpath(OPENAPI_PATH, ROOT))
    finally:
        base._shutdown()


if __name__ == "__main__":
    main()
