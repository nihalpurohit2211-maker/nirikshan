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

## 7. API contract

21 routes, all JSON, all served from the same origin. `docs/openapi.json` is the live
schema (`GET /openapi.json`); the parameter tables below are read out of it, and every
example response is a real body captured from the seeded database. `{case_id}`,
`{node_id}`, `{station_id}` in the paths below are placeholders for real IDs you can take
from the list endpoints.

Route index:

| Route | Used by |
|---|---|
| `GET /api/health` | Top bar (clock, AI badge) |
| `GET /api/overview` | Dashboard |
| `GET /api/network` | Network map |
| `GET /api/cases` | Cases list, Dashboard triage |
| `GET /api/nodes/{node_id}` | Network map side panel |
| `GET /api/nodes/{node_id}/readings` | Node detail chart |
| `GET /api/nodes/{node_id}/forecast` | Node detail forecast |
| `GET /api/air` | Air Quality |
| `GET /api/air/{station_id}/readings` | Air Quality station history |
| `GET /api/complaints` | Complaints tracker |
| `GET /api/cases/{case_id}` | Case detail |
| `GET /api/trace/{case_id}` | Network map trace, Case detail diagram |
| `GET /api/land/reports` | Land Reports |
| `GET /api/hotspots` | Dashboard hotspots |
| `POST /api/complaints` | Complaints intake |
| `POST /api/cluster/run` | Complaints / Cases button |
| `POST /api/cases/{case_id}/draft` | Case detail advisory |
| `PATCH /api/cases/{case_id}/status` | Case detail status flow |
| `POST /api/cases/{case_id}/approve` | Case detail advisory |
| `POST /api/land/reports` | Land Reports intake |
| `POST /api/reports/daily` | Reports |

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

---

## 9. Endpoint reference

### GET /api/health

Top bar. `demo_now` is the clock every timestamp in this API is measured against, the counts prove the seed loaded, and `ai` is the online/offline badge. This endpoint never touches the network — safe to poll.

_No parameters._

**Request**: none.

**Real response** from the seeded database (`/api/health`):

```json
{
  "ai": "offline",
  "counts": {
    "cases": 8,
    "complaints": 20,
    "nodes": 98,
    "pipes": 78,
    "readings": 5712,
    "sensors": 27
  },
  "data": "synthetic sample data",
  "demo_now": "2026-11-03 09:00:00",
  "disclaimer": "Automated findings support human judgment. They are not official regulatory decisions.",
  "status": "ok"
}
```

### GET /api/overview

The whole dashboard in one call: `kpis`, `triage` (open cases with `overdue`, `complaints` and `last_action`), `hotspots`, `demo_now`. Render `disclaimer` and `data` in the banner.

_No parameters._

**Request**: none.

**Real response** from the seeded database (`/api/overview`):

```json
{
  "data": "synthetic sample data",
  "demo_now": "2026-11-03 09:00:00",
  "disclaimer": "Automated findings support human judgment. They are not official regulatory decisions.",
  "hotspots": [
    {
      "band": "Unsafe",
      "cases": [
        "CASE-2026-003"
      ],
      "factors": {
        "complaints_24h": 5,
        "open_cases": 1,
        "severity": 25,
        "wqi": 94.4
      },
      "name": "Ward 3 - Khadki Old Town",
      "node_id": "zone_3",
      "score": 112.2
    },
    {
      "band": "Poor",
      "cases": [
        "CASE-2026-004"
      ],
      "factors": {
        "complaints_24h": 4,
        "open_cases": 1,
        "severity": 30,
        "wqi": 60.3
      },
      "name": "Ward 4 - Plateau",
      "node_id": "zone_4",
      "score": 94.2
    }
  ],
  "kpis": {
    "complaints_24h": 18,
    "open_cases": 6,
    "worst_aqi": {
      "category": "Very Poor",
      "colour": "#EA4335",
      "driving_pollutant": "PM10",
      "name": "Construction Belt Monitor B",
      "station_id": "air_08",
      "value": 312.5
    },
    "worst_wqi": {
      "band": "Unsafe",
      "colour": "#EA4335",
      "name": "Ward 3 - Khadki Old Town",
      "node_id": "zone_3",
      "override": "turbidity_ntu|residual_chlorine_mgl|coliform",
      "score": 94.4
    }
  },
  "triage": [
    {
      "complaints": [
        "CMP006",
        "CMP007",
        "CMP008",
        "CMP009"
      ],
      "created_at": "2026-11-03 09:00:00",
      "domain": "water",
      "evidence": {
        "anomaly": {
          "anomaly_flag": true,
          "breach": true,
          "ops_note": "Feed main burst at the Plateau tee; supply lost to four societies.",
          "parameter": "turbidity_ntu",
          "z": 66.31
        },
        "buildings": [
          "B31",
          "B33",
          "B35",
          "B37"
        ],
        "coliform": null,
        "complaints": [
          "CMP006",
          "CMP007",
          "CMP008",
          "CMP009"
        ],
        "confidence": 0.9,
        "flow_changed": "Feed main burst at the Plateau tee; supply lost to four societies.",
        "limits": {
          "coliform": {
            "acceptable": 0.0,
            "ideal": 0.0,
            "note": "must be absent in 100 mL",
            "permissible": 0.0,
            "unit": "present/absent",
            "weight": 0.2
          },
          "ph": {
            "acceptable": [
              6.5,
              8.5
            ],
            "ideal": 7.0,
            "note": "no relaxation",
            "permissible": [
              6.5,
              8.5
            ],
            "unit": "",
            "weight": 0.15
          },
          "residual_chlorine_mgl": {
            "acceptable": [
              0.2,
              null
            ],
            "ideal": 0.5,
            "note": "process-control minimum, not a health standard",
            "permissible": [
              0.2,
              null
            ],
            "unit": "mg/L",
            "weight": 0.25
          },
          "tds_mgl": {
            "acceptable": 500.0,
            "ideal": 0.0,
            "permissible": 2000.0,
            "unit": "mg/L",
            "weight": 0.15
          },
          "turbidity_ntu": {
            "acceptable": 1.0,
            "ideal": 0.0,
            "note": "5 NTU only when no alternative source",
            "permissible": 5.0,
            "unit": "NTU",
            "weight": 0.25
          }
        },
        "readings": {
          "ph": 7.348,
          "residual_chlorine_mgl": 0.3828,
          "tds_mgl": 332.21,
          "timestamp": "2026-11-03 09:00:00",
          "turbidity_ntu": 3.971
        },
        "rule": "PLACE ward zone_4 -> shared upstream node lca(buildings) -> TIME within 24h -> BEHAVIOR sensors corroborate",
        "shared_node": "zone_4",
        "sibling_status": "turbidity breach",
        "wqi": {
          "band": "Poor",
          "colour": "#F4B400",
          "override": null,
          "score": 60.3,
          "subindices": {
            "ph": {
              "qi": 23.2,
              "value": 7.348,
              "weight": 0.15
            },
            "residual_chlorine_mgl": {
              "qi": 39.1,
              "value": 0.3828,
              "weight": 0.25
            },
            "tds_mgl": {
              "qi": 66.4,
              "value": 332.21,
              "weight": 0.15
            },
            "turbidity_ntu": {
              "qi": 100.0,
              "value": 3.971,
              "weight": 0.25
            }
          },
          "weights_used": 0.8
        }
      },
      "id": "CASE-2026-004",
      "last_action": "2026-11-03 09:00:00",
      "node_id": "zone_4",
      "overdue": false,
      "scope": "MUNICIPAL",
      "severity": "Emergency",
      "status": "Open",
      "title": "Supply loss on the Ward 4 - Plateau branch",
      "updated_at": "2026-11-03 09:00:00"
    },
    {
      "complaints": [
        "CMP001",
        "CMP002",
        "CMP003",
        "CMP004",
        "CMP005"
      ],
      "created_at": "2026-11-03 09:00:00",
      "domain": "water",
      "evidence": {
        "anomaly": {
          "anomaly_flag": true,
          "breach": true,
          "ops_note": null,
          "parameter": "turbidity_ntu",
          "z": 151.58
        },
        "buildings": [
          "B21",
          "B22",
          "B23",
          "B24",
          "B25"
        ],
        "coliform": true,
        "complaints": [
          "CMP001",
          "CMP002",
          "CMP003",
          "CMP004",
          "CMP005"
        ],
        "confidence": 0.9,
        "flow_changed": null,
        "limits": {
          "coliform": {
            "acceptable": 0.0,
            "ideal": 0.0,
            "note": "must be absent in 100 mL",
            "permissible": 0.0,
            "unit": "present/absent",
            "weight": 0.2
          },
          "ph": {
            "acceptable": [
              6.5,
              8.5
            ],
            "ideal": 7.0,
            "note": "no relaxation",
            "permissible": [
              6.5,
              8.5
            ],
            "unit": "",
            "weight": 0.15
          },
          "residual_chlorine_mgl": {
            "acceptable": [
              0.2,
              null
            ],
            "ideal": 0.5,
            "note": "process-control minimum, not a health standard",
            "permissible": [
              0.2,
              null
            ],
            "unit": "mg/L",
            "weight": 0.25
          },
          "tds_mgl": {
            "acceptable": 500.0,
            "ideal": 0.0,
            "permissible": 2000.0,
            "unit": "mg/L",
            "weight": 0.15
          },
          "turbidity_ntu": {
            "acceptable": 1.0,
            "ideal": 0.0,
            "note": "5 NTU only when no alternative source",
            "permissible": 5.0,
            "unit": "NTU",
            "weight": 0.25
          }
        },
        "readings": {
          "ph": 7.063,
          "residual_chlorine_mgl": 0.0382,
          "tds_mgl": 344.26,
          "timestamp": "2026-11-03 09:00:00",
          "turbidity_ntu": 8.962
        },
        "rule": "PLACE ward zone_3 -> shared upstream node lca(buildings) -> TIME within 24h -> BEHAVIOR sensors corroborate",
        "shared_node": "zone_3",
        "sibling_status": "turbidity breach",
        "wqi": {
          "band": "Unsafe",
          "colour": "#EA4335",
          "override": "turbidity_ntu|residual_chlorine_mgl|coliform",
          "score": 94.4,
          "subindices": {
            "coliform": {
              "qi": 100.0,
              "value": true,
              "weight": 0.2
            },
            "ph": {
              "qi": 4.2,
              "value": 7.063,
              "weight": 0.15
            },
            "residual_chlorine_mgl": {
              "qi": 153.9,
              "value": 0.0382,
              "weight": 0.25
            },
            "tds_mgl": {
              "qi": 68.9,
              "value": 344.26,
              "weight": 0.15
            },
            "turbidity_ntu": {
              "qi": 100.0,
              "value": 8.962,
              "weight": 0.25
            }
          },
          "weights_used": 1.0
        }
      },
      "id": "CASE-2026-003",
      "last_action": "2026-11-03 09:00:00",
      "node_id": "zone_3",
      "overdue": false,
      "scope": "MUNICIPAL",
      "severity": "High",
      "status": "Open",
      "title": "Shared upstream cause at Ward 3 - Khadki Old Town (5 buildings)",
      "updated_at": "2026-11-03 09:00:00"
    }
  ]
}
```

_Sampled for reading — `hotspots`: the first 2 of 5 rows; `triage`: the first 2 of 6 rows. Every row has exactly this shape; the counts come from `/api/health`._

### GET /api/network

The entire map in one call — every node (with `wqi` and `latest` where a sensor exists) and every pipe. Do not loop over nodes: the server bulk-loads this, and per-node loops are the one thing the backend was written to avoid.

_No parameters._

**Request**: none.

**Real response** from the seeded database (`/api/network`):

```json
{
  "data": "synthetic sample data",
  "demo_now": "2026-11-03 09:00:00",
  "disclaimer": "Automated findings support human judgment. They are not official regulatory decisions.",
  "nodes": [
    {
      "id": "B01",
      "lat": 19.04487,
      "latest": null,
      "lon": 72.919332,
      "name": "Amruta Vatika",
      "parent_id": "zone_5",
      "type": "building",
      "wqi": null,
      "zone_id": "zone_5"
    },
    {
      "id": "B02",
      "lat": 19.048781,
      "latest": null,
      "lon": 72.88296,
      "name": "Shanti Sadan",
      "parent_id": "zone_1",
      "type": "building",
      "wqi": null,
      "zone_id": "zone_1"
    }
  ],
  "pipes": [
    {
      "diameter_mm": 65,
      "from_node": "zone_5",
      "id": "P001",
      "install_year": 2009,
      "length_m": 59.7,
      "material": "HDPE",
      "to_node": "B01"
    },
    {
      "diameter_mm": 100,
      "from_node": "zone_1",
      "id": "P002",
      "install_year": 2015,
      "length_m": 147.4,
      "material": "PVC",
      "to_node": "B02"
    }
  ]
}
```

_Sampled for reading — `n.o.d.e.s`: the first 2 of 98 rows; `p.i.p.e.s`: the first 2 of 78 rows. Every row has exactly this shape; the counts come from `/api/health`._

### GET /api/cases

Case list, worst severity first. Every row already carries the parsed `evidence` and `overdue`, so the list page never needs a detail call. Optional `?status=` / `?domain=`.

| Parameter | Where | Required | Type | Default |
|---|---|---|---|---|
| `status` | query | no | string (nullable) |  |
| `domain` | query | no | string (nullable) |  |

**Request**: none.

**Real response** from the seeded database (`/api/cases`):

```json
{
  "cases": [
    {
      "created_at": "2026-11-03 09:00:00",
      "domain": "water",
      "evidence": {
        "anomaly": {
          "anomaly_flag": true,
          "breach": true,
          "ops_note": "Feed main burst at the Plateau tee; supply lost to four societies.",
          "parameter": "turbidity_ntu",
          "z": 66.31
        },
        "buildings": [
          "B31",
          "B33",
          "B35",
          "B37"
        ],
        "coliform": null,
        "complaints": [
          "CMP006",
          "CMP007",
          "CMP008",
          "CMP009"
        ],
        "confidence": 0.9,
        "flow_changed": "Feed main burst at the Plateau tee; supply lost to four societies.",
        "limits": {
          "coliform": {
            "acceptable": 0.0,
            "ideal": 0.0,
            "note": "must be absent in 100 mL",
            "permissible": 0.0,
            "unit": "present/absent",
            "weight": 0.2
          },
          "ph": {
            "acceptable": [
              6.5,
              8.5
            ],
            "ideal": 7.0,
            "note": "no relaxation",
            "permissible": [
              6.5,
              8.5
            ],
            "unit": "",
            "weight": 0.15
          },
          "residual_chlorine_mgl": {
            "acceptable": [
              0.2,
              null
            ],
            "ideal": 0.5,
            "note": "process-control minimum, not a health standard",
            "permissible": [
              0.2,
              null
            ],
            "unit": "mg/L",
            "weight": 0.25
          },
          "tds_mgl": {
            "acceptable": 500.0,
            "ideal": 0.0,
            "permissible": 2000.0,
            "unit": "mg/L",
            "weight": 0.15
          },
          "turbidity_ntu": {
            "acceptable": 1.0,
            "ideal": 0.0,
            "note": "5 NTU only when no alternative source",
            "permissible": 5.0,
            "unit": "NTU",
            "weight": 0.25
          }
        },
        "readings": {
          "ph": 7.348,
          "residual_chlorine_mgl": 0.3828,
          "tds_mgl": 332.21,
          "timestamp": "2026-11-03 09:00:00",
          "turbidity_ntu": 3.971
        },
        "rule": "PLACE ward zone_4 -> shared upstream node lca(buildings) -> TIME within 24h -> BEHAVIOR sensors corroborate",
        "shared_node": "zone_4",
        "sibling_status": "turbidity breach",
        "wqi": {
          "band": "Poor",
          "colour": "#F4B400",
          "override": null,
          "score": 60.3,
          "subindices": {
            "ph": {
              "qi": 23.2,
              "value": 7.348,
              "weight": 0.15
            },
            "residual_chlorine_mgl": {
              "qi": 39.1,
              "value": 0.3828,
              "weight": 0.25
            },
            "tds_mgl": {
              "qi": 66.4,
              "value": 332.21,
              "weight": 0.15
            },
            "turbidity_ntu": {
              "qi": 100.0,
              "value": 3.971,
              "weight": 0.25
            }
          },
          "weights_used": 0.8
        }
      },
      "id": "CASE-2026-004",
      "node_id": "zone_4",
      "overdue": false,
      "scope": "MUNICIPAL",
      "severity": "Emergency",
      "status": "Open",
      "title": "Supply loss on the Ward 4 - Plateau branch",
      "updated_at": "2026-11-03 09:00:00"
    }
  ],
  "count": 8,
  "demo_now": "2026-11-03 09:00:00"
}
```

_Sampled for reading — `c.a.s.e.s`: the first 1 of 8 rows. Every row has exactly this shape; the counts come from `/api/health`._

### GET /api/nodes/{node_id}

Node side panel: the node row, `wqi` with sub-indices, the latest readings, its sensor, maintenance history, the complaints attached to it and any open case.

| Parameter | Where | Required | Type | Default |
|---|---|---|---|---|
| `node_id` | path | yes | string |  |

**Request**: none.

**Real response** from the seeded database (`/api/nodes/zone_3`):

```json
{
  "anomaly": {
    "baseline_mean": 1.4699,
    "baseline_std": 0.0494,
    "flag": true,
    "n_baseline": 13,
    "parameter": "turbidity_ntu",
    "z": 151.58
  },
  "coliform_present": true,
  "data": "synthetic sample data",
  "disclaimer": "Automated findings support human judgment. They are not official regulatory decisions.",
  "lab_tests": [
    {
      "date": "2026-11-03 03:00:00",
      "e_coli": "PRESENT",
      "id": "LAB001",
      "node_id": "zone_3",
      "note": "100 mL membrane test, ward 3 composite sample.",
      "total_coliform": "PRESENT"
    }
  ],
  "latest": {
    "ph": 7.063,
    "residual_chlorine_mgl": 0.0382,
    "sensor_id": "S_zone_3",
    "tds_mgl": 344.26,
    "timestamp": "2026-11-03 09:00:00",
    "turbidity_ntu": 8.962
  },
  "maintenance": [],
  "node": {
    "id": "zone_3",
    "lat": 19.051,
    "lon": 72.874,
    "name": "Ward 3 - Khadki Old Town",
    "parent_id": "J04",
    "type": "zone",
    "zone_id": "zone_3"
  },
  "open_cases": [
    {
      "created_at": "2026-11-03 09:00:00",
      "domain": "water",
      "evidence_json": "{\"anomaly\": {\"anomaly_flag\": true, \"breach\": true, \"ops_note\": null, \"parameter\": \"turbidity_ntu\", \"z\": 151.58}, \"buildings\": [\"B21\", \"B22\", \"B23\", \"B24\", \"B25\"], \"coliform\": true, \"complaints\": [\"CMP001\", \"CMP002\", \"CMP003\", \"CMP004\", \"CMP005\"], \"confidence\": 0.9, \"flow_changed\": null, \"limits\": {\"coliform\": {\"acceptable\": 0.0, \"ideal\": 0.0, \"note\": \"must be absent in 100 mL\", \"permissible\": 0.0, \"unit\": \"present/absent\", \"weight\": 0.2}, \"ph\": {\"acceptable\": [6.5, 8.5], \"ideal\": 7.0, \"note\": \"no relaxation\", \"permissible\": [6.5, 8.5], \"unit\": \"\", \"weight\": 0.15}, \"residual_chlorine_mgl\": {\"ac \u2026[trimmed]",
      "id": "CASE-2026-003",
      "node_id": "zone_3",
      "scope": "MUNICIPAL",
      "severity": "High",
      "status": "Open",
      "title": "Shared upstream cause at Ward 3 - Khadki Old Town (5 buildings)",
      "updated_at": "2026-11-03 09:00:00"
    }
  ],
  "wqi": {
    "band": "Unsafe",
    "colour": "#EA4335",
    "override": "turbidity_ntu|residual_chlorine_mgl|coliform",
    "score": 94.4,
    "subindices": {
      "coliform": {
        "qi": 100.0,
        "value": true,
        "weight": 0.2
      },
      "ph": {
        "qi": 4.2,
        "value": 7.063,
        "weight": 0.15
      },
      "residual_chlorine_mgl": {
        "qi": 153.9,
        "value": 0.0382,
        "weight": 0.25
      },
      "tds_mgl": {
        "qi": 68.9,
        "value": 344.26,
        "weight": 0.15
      },
      "turbidity_ntu": {
        "qi": 100.0,
        "value": 8.962,
        "weight": 0.25
      }
    },
    "weights_used": 1.0
  }
}
```

_Sampled for reading — strings longer than 600 chars. Every row has exactly this shape; the counts come from `/api/health`._

### GET /api/nodes/{node_id}/readings

14-day hourly series from the node's multi-parameter sensor — the turbidity/chlorine chart and the anomaly baseline bands.

| Parameter | Where | Required | Type | Default |
|---|---|---|---|---|
| `node_id` | path | yes | string |  |

**Request**: none.

**Real response** from the seeded database (`/api/nodes/zone_3/readings`):

```json
{
  "hours": 336,
  "node_id": "zone_3",
  "readings": [
    {
      "ph": 7.351,
      "residual_chlorine_mgl": 0.3391,
      "sensor_id": "S_zone_3",
      "tds_mgl": 345.69,
      "timestamp": "2026-10-20 10:00:00",
      "turbidity_ntu": 1.451
    },
    {
      "ph": 7.334,
      "residual_chlorine_mgl": 0.3299,
      "sensor_id": "S_zone_3",
      "tds_mgl": 351.43,
      "timestamp": "2026-10-20 11:00:00",
      "turbidity_ntu": 1.456
    },
    {
      "ph": 7.243,
      "residual_chlorine_mgl": 0.3378,
      "sensor_id": "S_zone_3",
      "tds_mgl": 348.96,
      "timestamp": "2026-10-20 12:00:00",
      "turbidity_ntu": 1.449
    }
  ],
  "sensor_id": "S_zone_3"
}
```

_Sampled for reading — `r.e.a.d.i.n.g.s`: the first 3 of 336 rows. Every row has exactly this shape; the counts come from `/api/health`._

### GET /api/nodes/{node_id}/forecast

24-hour chlorine projection with the 0.2 mg/L minimum and the crossing marker. `404` for a node with no chlorine series — handle it, do not assume every node has a sensor.

| Parameter | Where | Required | Type | Default |
|---|---|---|---|---|
| `node_id` | path | yes | string |  |

**Request**: none.

**Real response** from the seeded database (`/api/nodes/zone_3/forecast`):

```json
{
  "breached_now": true,
  "c_24": 0.3269,
  "c_48": 0.3537,
  "crossing_hours": 0,
  "current": 0.0382,
  "decay_k": null,
  "horizon_hours": 24,
  "limit": 0.2,
  "method": "trend",
  "node_id": "zone_3",
  "parameter": "residual_chlorine_mgl",
  "projected": [
    0.0382,
    0.0316,
    0.0251,
    0.0185,
    0.0119,
    0.0053,
    0.0,
    0.0,
    0.0,
    0.0,
    0.0,
    0.0,
    0.0,
    0.0,
    0.0,
    0.0,
    0.0,
    0.0,
    0.0,
    0.0,
    0.0,
    0.0,
    0.0,
    0.0,
    0.0
  ],
  "sensor_id": "S_zone_3",
  "slope_per_hour": -0.006573
}
```

### GET /api/air

Air page: every station with a nested `aqi` object (value, category, driving pollutant, sub-indices) and its own `pm_forecast`, plus the `worst` station. Note the key is `id`, not `station_id`.

_No parameters._

**Request**: none.

**Real response** from the seeded database (`/api/air`):

```json
{
  "categories": [
    {
      "colour": "#34A853",
      "max": 50,
      "min": 0,
      "name": "Good"
    },
    {
      "colour": "#A8D08D",
      "max": 100,
      "min": 51,
      "name": "Satisfactory"
    },
    {
      "colour": "#F4B400",
      "max": 200,
      "min": 101,
      "name": "Moderate"
    },
    {
      "colour": "#FBBC04",
      "max": 300,
      "min": 201,
      "name": "Poor"
    },
    {
      "colour": "#EA4335",
      "max": 400,
      "min": 301,
      "name": "Very Poor"
    },
    {
      "colour": "#9B1C1C",
      "max": 500,
      "min": 401,
      "name": "Severe"
    }
  ],
  "data": "synthetic sample data",
  "demo_now": "2026-11-03 09:00:00",
  "disclaimer": "Automated findings support human judgment. They are not official regulatory decisions.",
  "pm_forecast": {
    "current": 360.0,
    "horizon_hours": 24,
    "parameter": "pm10",
    "projected": [
      360.0,
      364.1,
      367.6,
      370.6,
      373.1,
      375.3,
      377.1,
      378.6,
      380.0,
      381.1,
      382.0,
      382.8,
      383.5,
      384.1,
      384.6,
      385.0,
      385.4,
      385.7,
      386.0,
      386.2,
      386.4,
      386.5,
      386.7,
      386.8,
      386.9
    ],
    "slope_per_hour": 4.84,
    "station_id": "air_08"
  },
  "stations": [
    {
      "aqi": {
        "category": "Moderate",
        "colour": "#F4B400",
        "driving_pollutant": "O3",
        "subindices": {
          "CO": {
            "concentration": 0.58,
            "subindex": 0.0
          },
          "NO2": {
            "concentration": 36.1,
            "subindex": 45.1
          },
          "O3": {
            "concentration": 62.0,
            "subindex": 173.3
          },
          "PM10": {
            "concentration": 112.2,
            "subindex": 108.1
          },
          "PM2.5": {
            "concentration": 66.4,
            "subindex": 121.3
          },
          "SO2": {
            "concentration": 15.7,
            "subindex": 19.6
          }
        },
        "value": 173.3
      },
      "id": "air_01",
      "lat": 19.046,
      "latest": {
        "co": 0.58,
        "no2": 36.1,
        "o3": 62.0,
        "pm10": 112.2,
        "pm25": 66.4,
        "so2": 15.7,
        "station_id": "air_01",
        "timestamp": "2026-11-03 09:00:00"
      },
      "lon": 72.883,
      "name": "Bungalow Road Monitor",
      "parent_id": null,
      "type": "air_station",
      "zone_id": "zone_1"
    },
    {
      "aqi": {
        "category": "Moderate",
        "colour": "#F4B400",
        "driving_pollutant": "PM2.5",
        "subindices": {
          "CO": {
            "concentration": 0.43,
            "subindex": 0.0
          },
          "NO2": {
            "concentration": 24.3,
            "subindex": 30.4
          },
          "O3": {
            "concentration": 52.5,
            "subindex": 141.7
          },
          "PM10": {
            "concentration": 94.0,
            "subindex": 94.0
          },
          "PM2.5": {
            "concentration": 72.7,
            "subindex": 142.3
          },
          "SO2": {
            "concentration": 12.1,
            "subindex": 15.1
          }
        },
        "value": 142.3
      },
      "id": "air_02",
      "lat": 19.042,
      "latest": {
        "co": 0.43,
        "no2": 24.3,
        "o3": 52.5,
        "pm10": 94.0,
        "pm25": 72.7,
        "so2": 12.1,
        "station_id": "air_02",
        "timestamp": "2026-11-03 09:00:00"
      },
      "lon": 72.895,
      "name": "Mill Compound Monitor",
      "parent_id": null,
      "type": "air_station",
      "zone_id": "zone_1"
    }
  ],
  "worst": {
    "aqi": {
      "category": "Very Poor",
      "colour": "#EA4335",
      "driving_pollutant": "PM10",
      "subindices": {
        "CO": {
          "concentration": 0.58,
          "subindex": 0.0
        },
        "NO2": {
          "concentration": 28.5,
          "subindex": 35.6
        },
        "O3": {
          "concentration": 46.6,
          "subindex": 122.0
        },
        "PM10": {
          "concentration": 360.0,
          "subindex": 312.5
        },
        "PM2.5": {
          "concentration": 116.0,
          "subindex": 286.7
        },
        "SO2": {
          "concentration": 12.5,
          "subindex": 15.6
        }
      },
      "value": 312.5
    },
    "id": "air_08",
    "lat": 19.057,
    "latest": {
      "co": 0.58,
      "no2": 28.5,
      "o3": 46.6,
      "pm10": 360.0,
      "pm25": 116.0,
      "so2": 12.5,
      "station_id": "air_08",
      "timestamp": "2026-11-03 09:00:00"
    },
    "lon": 72.896,
    "name": "Construction Belt Monitor B",
    "parent_id": null,
    "type": "air_station",
    "zone_id": "zone_4"
  }
}
```

_Sampled for reading — `s.t.a.t.i.o.n.s`: the first 2 of 10 rows. Every row has exactly this shape; the counts come from `/api/health`._

### GET /api/air/{station_id}/readings

One station's hourly series, AQI recomputed on every row — the gauge history and the PM chart.

| Parameter | Where | Required | Type | Default |
|---|---|---|---|---|
| `station_id` | path | yes | string |  |

**Request**: none.

**Real response** from the seeded database (`/api/air/air_08/readings`):

```json
{
  "hours": 336,
  "name": "Construction Belt Monitor B",
  "readings": [
    {
      "aqi": 138.3,
      "co": 0.51,
      "no2": 27.0,
      "o3": 45.5,
      "pm10": 146.8,
      "pm25": 71.5,
      "so2": 15.0,
      "station_id": "air_08",
      "timestamp": "2026-10-20 10:00:00"
    },
    {
      "aqi": 121.3,
      "co": 0.65,
      "no2": 31.4,
      "o3": 45.6,
      "pm10": 132.0,
      "pm25": 63.6,
      "so2": 10.5,
      "station_id": "air_08",
      "timestamp": "2026-10-20 11:00:00"
    },
    {
      "aqi": 120.2,
      "co": 0.47,
      "no2": 19.0,
      "o3": 45.8,
      "pm10": 130.3,
      "pm25": 62.6,
      "so2": 11.3,
      "station_id": "air_08",
      "timestamp": "2026-10-20 12:00:00"
    }
  ],
  "station_id": "air_08"
}
```

_Sampled for reading — `r.e.a.d.i.n.g.s`: the first 3 of 336 rows. Every row has exactly this shape; the counts come from `/api/health`._

### GET /api/complaints

Complaint table + the intake tracker. `extracted_fields` arrives parsed; `status` starts at `NEW`.

| Parameter | Where | Required | Type | Default |
|---|---|---|---|---|
| `status` | query | no | string (nullable) |  |
| `domain` | query | no | string (nullable) |  |

**Request**: none.

**Real response** from the seeded database (`/api/complaints?domain=water`):

```json
{
  "complaints": [
    {
      "area_m2": null,
      "category": "No/low pressure",
      "domain": "water",
      "duration_days": null,
      "extracted_fields": {},
      "id": "CMP009",
      "image_path": null,
      "node_id": "B37",
      "status": "NEW",
      "text": "Pressure dropped to zero after the pipe burst near our gate.",
      "timestamp": "2026-11-03 08:00:00"
    },
    {
      "area_m2": null,
      "category": "No/low pressure",
      "domain": "water",
      "duration_days": null,
      "extracted_fields": {},
      "id": "CMP008",
      "image_path": null,
      "node_id": "B35",
      "status": "NEW",
      "text": "No water supply. Water is gushing out of the junction on the Plateau road.",
      "timestamp": "2026-11-03 07:30:00"
    }
  ],
  "count": 13
}
```

_Sampled for reading — `c.o.m.p.l.a.i.n.t.s`: the first 2 of 13 rows. Every row has exactly this shape; the counts come from `/api/health`._

### GET /api/cases/{case_id}

CaseDetail in one call: `case`, `evidence`, `trace`, only the breached `standards` rows, `standards_excerpt` (the raw text of the bundled IS 10500 / NAQI / SwM excerpt to cite), the source `complaints`, the `actions` timeline and `allowed_transitions` — disable every status button not in that list.

| Parameter | Where | Required | Type | Default |
|---|---|---|---|---|
| `case_id` | path | yes | string |  |

**Request**: none.

**Real response** from the seeded database (`/api/cases/CASE-2026-003`):

```json
{
  "actions": [
    {
      "action": "Case opened",
      "actor": "Nirikshan engine",
      "case_id": "CASE-2026-003",
      "id": "ACT009",
      "note": "Clustering created this case from 5 complaint(s) sharing zone_3",
      "role": "Automated system",
      "timestamp": "2026-11-03 09:00:00"
    },
    {
      "action": "Draft advisory",
      "actor": "Nirikshan agent",
      "case_id": "CASE-2026-003",
      "id": "ACT015",
      "note": "DRAFT \u2014 not sent until a human approves (provider: offline)",
      "role": "AI (advisory only)",
      "timestamp": "2026-11-03 09:00:00"
    },
    {
      "action": "Draft advisory",
      "actor": "Nirikshan agent",
      "case_id": "CASE-2026-003",
      "id": "ACT016",
      "note": "DRAFT \u2014 not sent until a human approves (provider: offline)",
      "role": "AI (advisory only)",
      "timestamp": "2026-11-03 09:00:00"
    }
  ],
  "allowed_transitions": [
    "Investigating"
  ],
  "case": {
    "created_at": "2026-11-03 09:00:00",
    "domain": "water",
    "id": "CASE-2026-003",
    "node_id": "zone_3",
    "overdue": false,
    "scope": "MUNICIPAL",
    "severity": "High",
    "status": "Open",
    "title": "Shared upstream cause at Ward 3 - Khadki Old Town (5 buildings)",
    "updated_at": "2026-11-03 09:00:00"
  },
  "complaints": [
    {
      "area_m2": null,
      "category": "Muddy/turbid water",
      "domain": "water",
      "duration_days": null,
      "extracted_fields": null,
      "id": "CMP001",
      "image_path": null,
      "node_id": "B21",
      "status": "NEW",
      "text": "Muddy brown water coming from the taps since last night. The whole building is affected.",
      "timestamp": "2026-11-02 22:00:00"
    },
    {
      "area_m2": null,
      "category": "Suspected contamination",
      "domain": "water",
      "duration_days": null,
      "extracted_fields": null,
      "id": "CMP002",
      "image_path": null,
      "node_id": "B22",
      "status": "NEW",
      "text": "Turbid water with a foul smell. Three flats in our society report stomach upset.",
      "timestamp": "2026-11-02 23:00:00"
    },
    {
      "area_m2": null,
      "category": "Bad taste",
      "domain": "water",
      "duration_days": null,
      "extracted_fields": null,
      "id": "CMP003",
      "image_path": null,
      "node_id": "B23",
      "status": "NEW",
      "text": "Bad taste and muddy water since evening. We suspect contamination of the ward line.",
      "timestamp": "2026-11-02 23:30:00"
    },
    {
      "area_m2": null,
      "category": "Stomach illness reported",
      "domain": "water",
      "duration_days": null,
      "extracted_fields": null,
      "id": "CMP004",
      "image_path": null,
      "node_id": "B24",
      "status": "NEW",
      "text": "Children in our building have stomach upset and vomiting after the water changed colour.",
      "timestamp": "2026-11-03 00:00:00"
    },
    {
      "area_m2": null,
      "category": "Muddy/turbid water",
      "domain": "water",
      "duration_days": null,
      "extracted_fields": null,
      "id": "CMP005",
      "image_path": null,
      "node_id": "B25",
      "status": "NEW",
      "text": "Brown water again this morning. We have stopped drinking it. Please test the line.",
      "timestamp": "2026-11-03 01:30:00"
    }
  ],
  "data": "synthetic sample data",
  "disclaimer": "Automated findings support human judgment. They are not official regulatory decisions.",
  "evidence": {
    "anomaly": {
      "anomaly_flag": true,
      "breach": true,
      "ops_note": null,
      "parameter": "turbidity_ntu",
      "z": 151.58
    },
    "buildings": [
      "B21",
      "B22",
      "B23",
      "B24",
      "B25"
    ],
    "coliform": true,
    "complaints": [
      "CMP001",
      "CMP002",
      "CMP003",
      "CMP004",
      "CMP005"
    ],
    "confidence": 0.9,
    "flow_changed": null,
    "limits": {
      "coliform": {
        "acceptable": 0.0,
        "ideal": 0.0,
        "note": "must be absent in 100 mL",
        "permissible": 0.0,
        "unit": "present/absent",
        "weight": 0.2
      },
      "ph": {
        "acceptable": [
          6.5,
          8.5
        ],
        "ideal": 7.0,
        "note": "no relaxation",
        "permissible": [
          6.5,
          8.5
        ],
        "unit": "",
        "weight": 0.15
      },
      "residual_chlorine_mgl": {
        "acceptable": [
          0.2,
          null
        ],
        "ideal": 0.5,
        "note": "process-control minimum, not a health standard",
        "permissible": [
          0.2,
          null
        ],
        "unit": "mg/L",
        "weight": 0.25
      },
      "tds_mgl": {
        "acceptable": 500.0,
        "ideal": 0.0,
        "permissible": 2000.0,
        "unit": "mg/L",
        "weight": 0.15
      },
      "turbidity_ntu": {
        "acceptable": 1.0,
        "ideal": 0.0,
        "note": "5 NTU only when no alternative source",
        "permissible": 5.0,
        "unit": "NTU",
        "weight": 0.25
      }
    },
    "readings": {
      "ph": 7.063,
      "residual_chlorine_mgl": 0.0382,
      "tds_mgl": 344.26,
      "timestamp": "2026-11-03 09:00:00",
      "turbidity_ntu": 8.962
    },
    "rule": "PLACE ward zone_3 -> shared upstream node lca(buildings) -> TIME within 24h -> BEHAVIOR sensors corroborate",
    "shared_node": "zone_3",
    "sibling_status": "turbidity breach",
    "wqi": {
      "band": "Unsafe",
      "colour": "#EA4335",
      "override": "turbidity_ntu|residual_chlorine_mgl|coliform",
      "score": 94.4,
      "subindices": {
        "coliform": {
          "qi": 100.0,
          "value": true,
          "weight": 0.2
        },
        "ph": {
          "qi": 4.2,
          "value": 7.063,
          "weight": 0.15
        },
        "residual_chlorine_mgl": {
          "qi": 153.9,
          "value": 0.0382,
          "weight": 0.25
        },
        "tds_mgl": {
          "qi": 68.9,
          "value": 344.26,
          "weight": 0.15
        },
        "turbidity_ntu": {
          "qi": 100.0,
          "value": 8.962,
          "weight": 0.25
        }
      },
      "weights_used": 1.0
    }
  },
  "standards": [
    {
      "acceptable": "1",
      "citation": "IS 10500:2012, Table 1, excerpt - verify",
      "domain": "water",
      "id": 2,
      "parameter": "Turbidity (NTU)",
      "permissible": "5 (only when no alternative source)",
      "unit": "NTU"
    },
    {
      "acceptable": "0.2 mg/L minimum",
      "citation": "IS 10500:2012, Cl. 6.1, excerpt - process-control minimum, not a health standard",
      "domain": "water",
      "id": 4,
      "parameter": "Residual chlorine (minimum)",
      "permissible": "0.2 mg/L minimum",
      "unit": "mg/L"
    },
    {
      "acceptable": "Absent in 100 mL",
      "citation": "IS 10500:2012, Table 1, excerpt - verify",
      "domain": "water",
      "id": 5,
      "parameter": "Total coliform",
      "permissible": "Absent in 100 mL",
      "unit": "present/absent"
    }
  ],
  "standards_excerpt": "IS 10500:2012 \u2014 Drinking Water (Part 1) General Requirements for Potability\nExcerpt bundled for offline demo use. \"acceptable\" = conforming quality;\n\"permissible\" = only when no alternative source is available (confirmed by the\npublic health authority).\n\nPARAMETER                  ACCEPTABLE          PERMISSIBLE        UNIT\npH                          6.5 \u2013 8.5           6.5 \u2013 8.5          \u2014   (no relaxation)\nTurbidity                   1.0                 5.0                NTU\nTotal Dissolved Solids      500                 2000               mg/L\nResidual chlorine (min.)    0.2 \u2026[trimmed]",
  "trace": {
    "explanation": "Shared upstream cause at Ward 3 - Khadki Old Town (5 buildings) reports a shared upstream cause. Following the distribution tree upstream from there, the water passes Ward 3 - Khadki Old Town -> Datta Mandir Junction -> Khadki Old Junction -> Market Yard Junction -> Doongar Hill Booster Pump -> Doongar Hill Reservoir -> Gokhshi Water Treatment Plant (North) before it reaches the treatment plant at Gokhshi Water Treatment Plant (North). The worst section on that path is pipe P048: CI laid in 1991, 150 mm bore. Its first-order decay coefficient k = 0.257 /h is the highest of the chain \u2014 age, narrow bore and a wall-demand material all push it up \u2014 so residual chlorine is spent before the water reaches the buildings, and turbidity rises as the inner surface corrodes.",
    "hops": 6,
    "path": [
      "zone_3",
      "J04",
      "J03",
      "J02",
      "pump_1",
      "res_hill",
      "plant_n"
    ],
    "steps": [
      {
        "lat": 19.051,
        "lon": 72.874,
        "node_id": "zone_3",
        "node_name": "Ward 3 - Khadki Old Town",
        "node_type": "zone",
        "pipe": {
          "age_years": 33,
          "diameter_mm": 150,
          "from_node": "J04",
          "id": "P070",
          "install_year": 1993,
          "length_m": 500.0,
          "material": "CI",
          "to_node": "zone_3"
        }
      },
      {
        "lat": 19.047,
        "lon": 72.874,
        "node_id": "J04",
        "node_name": "Datta Mandir Junction",
        "node_type": "junction",
        "pipe": {
          "age_years": 24,
          "diameter_mm": 150,
          "from_node": "J03",
          "id": "P049",
          "install_year": 2002,
          "length_m": 400.0,
          "material": "GI",
          "to_node": "J04"
        }
      },
      {
        "lat": 19.042,
        "lon": 72.871,
        "node_id": "J03",
        "node_name": "Khadki Old Junction",
        "node_type": "junction",
        "pipe": {
          "age_years": 35,
          "diameter_mm": 150,
          "from_node": "J02",
          "id": "P048",
          "install_year": 1991,
          "length_m": 500.0,
          "material": "CI",
          "to_node": "J03"
        }
      },
      {
        "lat": 19.037,
        "lon": 72.868,
        "node_id": "J02",
        "node_name": "Market Yard Junction",
        "node_type": "junction",
        "pipe": {
          "age_years": 36,
          "diameter_mm": 250,
          "from_node": "pump_1",
          "id": "P047",
          "install_year": 1990,
          "length_m": 600.0,
          "material": "MS",
          "to_node": "J02"
        }
      },
      {
        "lat": 19.033,
        "lon": 72.866,
        "node_id": "pump_1",
        "node_name": "Doongar Hill Booster Pump",
        "node_type": "pump",
        "pipe": {
          "age_years": 37,
          "diameter_mm": 400,
          "from_node": "res_hill",
          "id": "P062",
          "install_year": 1989,
          "length_m": 700.0,
          "material": "MS",
          "to_node": "pump_1"
        }
      },
      {
        "lat": 19.026,
        "lon": 72.861,
        "node_id": "res_hill",
        "node_name": "Doongar Hill Reservoir",
        "node_type": "reservoir",
        "pipe": {
          "age_years": 38,
          "diameter_mm": 500,
          "from_node": "plant_n",
          "id": "P066",
          "install_year": 1988,
          "length_m": 1300.0,
          "material": "CI",
          "to_node": "res_hill"
        }
      },
      {
        "lat": 19.014,
        "lon": 72.864,
        "node_id": "plant_n",
        "node_name": "Gokhshi Water Treatment Plant (North)",
        "node_type": "treatment_plant",
        "pipe": {
          "age_years": 40,
          "diameter_mm": 600,
          "from_node": "src_river",
          "id": "P060",
          "install_year": 1986,
          "length_m": 1400.0,
          "material": "DI",
          "to_node": "plant_n"
        }
      }
    ],
    "worst_pipe": {
      "age_years": 35,
      "diameter_mm": 150,
      "from_node": "J02",
      "id": "P048",
      "install_year": 1991,
      "length_m": 500.0,
      "material": "CI",
      "to_node": "J03"
    },
    "worst_pipe_decay_k": 0.257
  }
}
```

_Sampled for reading — strings longer than 600 chars. Every row has exactly this shape; the counts come from `/api/health`._

### GET /api/trace/{case_id}

Trace Upstream: the path from the shared node back to the source, each pipe section with its decay coefficient, the `worst_pipe`, and a plain-language `explanation` to put beside the red pulse animation. `400` for air/land cases.

| Parameter | Where | Required | Type | Default |
|---|---|---|---|---|
| `case_id` | path | yes | string |  |

**Request**: none.

**Real response** from the seeded database (`/api/trace/CASE-2026-003`):

```json
{
  "case_id": "CASE-2026-003",
  "data": "synthetic sample data",
  "disclaimer": "Automated findings support human judgment. They are not official regulatory decisions.",
  "domain": "water",
  "explanation": "Shared upstream cause at Ward 3 - Khadki Old Town (5 buildings) reports a shared upstream cause. Following the distribution tree upstream from there, the water passes Ward 3 - Khadki Old Town -> Datta Mandir Junction -> Khadki Old Junction -> Market Yard Junction -> Doongar Hill Booster Pump -> Doongar Hill Reservoir -> Gokhshi Water Treatment Plant (North) before it reaches the treatment plant at Gokhshi Water Treatment Plant (North). The worst section on that path is pipe P048: CI laid in 1991, 150 mm bore. Its first-order decay coefficient k = 0.257 /h is the highest of the chain \u2014 age, narrow bore and a wall-demand material all push it up \u2014 so residual chlorine is spent before the water reaches the buildings, and turbidity rises as the inner surface corrodes.",
  "hops": 6,
  "path": [
    "zone_3",
    "J04",
    "J03",
    "J02",
    "pump_1",
    "res_hill",
    "plant_n"
  ],
  "steps": [
    {
      "lat": 19.051,
      "lon": 72.874,
      "node_id": "zone_3",
      "node_name": "Ward 3 - Khadki Old Town",
      "node_type": "zone",
      "pipe": {
        "age_years": 33,
        "diameter_mm": 150,
        "from_node": "J04",
        "id": "P070",
        "install_year": 1993,
        "length_m": 500.0,
        "material": "CI",
        "to_node": "zone_3"
      }
    },
    {
      "lat": 19.047,
      "lon": 72.874,
      "node_id": "J04",
      "node_name": "Datta Mandir Junction",
      "node_type": "junction",
      "pipe": {
        "age_years": 24,
        "diameter_mm": 150,
        "from_node": "J03",
        "id": "P049",
        "install_year": 2002,
        "length_m": 400.0,
        "material": "GI",
        "to_node": "J04"
      }
    },
    {
      "lat": 19.042,
      "lon": 72.871,
      "node_id": "J03",
      "node_name": "Khadki Old Junction",
      "node_type": "junction",
      "pipe": {
        "age_years": 35,
        "diameter_mm": 150,
        "from_node": "J02",
        "id": "P048",
        "install_year": 1991,
        "length_m": 500.0,
        "material": "CI",
        "to_node": "J03"
      }
    },
    {
      "lat": 19.037,
      "lon": 72.868,
      "node_id": "J02",
      "node_name": "Market Yard Junction",
      "node_type": "junction",
      "pipe": {
        "age_years": 36,
        "diameter_mm": 250,
        "from_node": "pump_1",
        "id": "P047",
        "install_year": 1990,
        "length_m": 600.0,
        "material": "MS",
        "to_node": "J02"
      }
    },
    {
      "lat": 19.033,
      "lon": 72.866,
      "node_id": "pump_1",
      "node_name": "Doongar Hill Booster Pump",
      "node_type": "pump",
      "pipe": {
        "age_years": 37,
        "diameter_mm": 400,
        "from_node": "res_hill",
        "id": "P062",
        "install_year": 1989,
        "length_m": 700.0,
        "material": "MS",
        "to_node": "pump_1"
      }
    },
    {
      "lat": 19.026,
      "lon": 72.861,
      "node_id": "res_hill",
      "node_name": "Doongar Hill Reservoir",
      "node_type": "reservoir",
      "pipe": {
        "age_years": 38,
        "diameter_mm": 500,
        "from_node": "plant_n",
        "id": "P066",
        "install_year": 1988,
        "length_m": 1300.0,
        "material": "CI",
        "to_node": "res_hill"
      }
    },
    {
      "lat": 19.014,
      "lon": 72.864,
      "node_id": "plant_n",
      "node_name": "Gokhshi Water Treatment Plant (North)",
      "node_type": "treatment_plant",
      "pipe": {
        "age_years": 40,
        "diameter_mm": 600,
        "from_node": "src_river",
        "id": "P060",
        "install_year": 1986,
        "length_m": 1400.0,
        "material": "DI",
        "to_node": "plant_n"
      }
    }
  ],
  "worst_pipe": {
    "age_years": 35,
    "diameter_mm": 150,
    "from_node": "J02",
    "id": "P048",
    "install_year": 1991,
    "length_m": 500.0,
    "material": "CI",
    "to_node": "J03"
  },
  "worst_pipe_decay_k": 0.257
}
```

### GET /api/land/reports

Land page: each report with `land_meta`, the `proximity` score and its separate factors, the erosion -> turbidity `cross_link`, and `image_url` (null when no photo). `weights` documents the scoring so the UI can explain the number.

_No parameters._

**Request**: none.

**Real response** from the seeded database (`/api/land/reports`):

```json
{
  "count": 4,
  "data": "synthetic sample data",
  "disclaimer": "Automated findings support human judgment. They are not official regulatory decisions.",
  "reports": [
    {
      "area_m2": 40.0,
      "category": "Open waste dump",
      "cross_link": null,
      "domain": "land",
      "duration_days": 12,
      "extracted_fields": null,
      "id": "CMP015",
      "image_path": "data/images/garbage_heap.svg",
      "image_url": "/data/images/garbage_heap.svg",
      "land_meta": {
        "land_type": "open_waste",
        "linked_water_node": null,
        "node_id": "land_05",
        "note": "Unsecured dump beside the municipal school and the nallah."
      },
      "node_id": "land_05",
      "proximity": {
        "factors": [
          {
            "kind": "school",
            "label": "Within 300 m of a school",
            "met": true,
            "nearest": {
              "distance_m": 166.8,
              "feature": "Municipal School, Lane 7",
              "kind": "school"
            },
            "points": 30,
            "within_m": 300
          },
          {
            "kind": "water_body",
            "label": "Within 200 m of a water body",
            "met": true,
            "nearest": {
              "distance_m": 172.2,
              "feature": "Khadki Nallah",
              "kind": "water_body"
            },
            "points": 30,
            "within_m": 200
          },
          {
            "kind": "main_road",
            "label": "Within 150 m of a main road",
            "met": false,
            "nearest": {
              "distance_m": 932.4,
              "feature": "Ring Road",
              "kind": "main_road"
            },
            "points": 0,
            "within_m": 150
          },
          {
            "days": 12,
            "kind": "duration",
            "label": "Standing for 7+ days",
            "met": true,
            "points": 20
          }
        ],
        "score": 80
      },
      "status": "NEW",
      "text": "Open garbage dump near the school since 12 days, area 40 sqm. Stench and mosquitoes.",
      "timestamp": "2026-11-03 01:00:00"
    }
  ],
  "weights": {
    "cap": 100,
    "main_road_m": 150,
    "school_m": 300,
    "w_duration": 20,
    "w_duration_days": 7,
    "w_road": 20,
    "w_school": 30,
    "w_water": 30,
    "water_body_m": 200
  }
}
```

_Sampled for reading — `r.e.p.o.r.t.s`: the first 1 of 4 rows. Every row has exactly this shape; the counts come from `/api/health`._

### GET /api/hotspots

Dashboard hotspot ranking: per-ward complaint counts with the factor breakdown behind each rank.

_No parameters._

**Request**: none.

**Real response** from the seeded database (`/api/hotspots`):

```json
{
  "data": "synthetic sample data",
  "disclaimer": "Automated findings support human judgment. They are not official regulatory decisions.",
  "hotspots": [
    {
      "band": "Unsafe",
      "cases": [
        "CASE-2026-003"
      ],
      "factors": {
        "complaints_24h": 5,
        "open_cases": 1,
        "severity": 25,
        "wqi": 94.4
      },
      "name": "Ward 3 - Khadki Old Town",
      "node_id": "zone_3",
      "score": 112.2
    },
    {
      "band": "Poor",
      "cases": [
        "CASE-2026-004"
      ],
      "factors": {
        "complaints_24h": 4,
        "open_cases": 1,
        "severity": 30,
        "wqi": 60.3
      },
      "name": "Ward 4 - Plateau",
      "node_id": "zone_4",
      "score": 94.2
    },
    {
      "band": "Acceptable",
      "cases": [
        "CASE-2026-005"
      ],
      "factors": {
        "complaints_24h": 2,
        "open_cases": 1,
        "severity": 5,
        "wqi": 40.2
      },
      "name": "Ward 2 - Ring Road",
      "node_id": "zone_2",
      "score": 47.1
    }
  ]
}
```

_Sampled for reading — `h.o.t.s.p.o.t.s`: the first 3 of 5 rows. Every row has exactly this shape; the counts come from `/api/health`._

### POST /api/complaints

Intake. The free text is run through the agent and the answer comes back as `suggestion` for the officer to confirm or edit; `cluster` names the cases this complaint just joined; `nearest_sensor` gives the area status under the pipes. Optional `image` is base64 jpg/png only.

| Parameter | Where | Required | Type | Default |
|---|---|---|---|---|
| `area_m2` | body | no | number (nullable) |  |
| `category` | body | no | string (nullable) |  |
| `domain` | body | yes | string |  |
| `duration_days` | body | no | integer (nullable) |  |
| `image` | body | no | string (nullable) |  |
| `node_id` | body | no | string (nullable) |  |
| `text` | body | yes | string |  |

**Request body** for this example:

```json
{
  "category": null,
  "domain": "water",
  "node_id": "B21",
  "text": "Brown water from the tap since 3 days, smells of sewage"
}
```

**Real response** from the seeded database (`/api/complaints`):

```json
{
  "ai": "offline",
  "cases": [
    "CASE-2026-003"
  ],
  "cluster": {
    "created": [],
    "updated": [
      "CASE-2026-003",
      "CASE-2026-004",
      "CASE-2026-005"
    ]
  },
  "complaint": {
    "area_m2": null,
    "category": "muddy/turbid water",
    "domain": "water",
    "duration_days": null,
    "extracted_fields": "{\"area_m2\": null, \"category\": \"muddy/turbid water\", \"duration_days\": 3, \"location_hint\": null, \"severity_hint\": \"medium\"}",
    "id": "CMP021",
    "image_path": null,
    "node_id": "B21",
    "status": "NEW",
    "text": "Brown water from the tap since 3 days, smells of sewage",
    "timestamp": "2026-11-03 09:00:00"
  },
  "data": "synthetic sample data",
  "disclaimer": "Automated findings support human judgment. They are not official regulatory decisions.",
  "nearest_sensor": {
    "distance_m": 231.2,
    "name": "Ward 3 - Khadki Old Town",
    "node_id": "zone_3",
    "sensor_id": "S_zone_3",
    "wqi": {
      "band": "Unsafe",
      "colour": "#EA4335",
      "score": 94.4
    }
  },
  "node": {
    "id": "B21",
    "lat": 19.053026,
    "lon": 72.874495,
    "name": "Vrindavan CHSL",
    "parent_id": "zone_3",
    "type": "building",
    "zone_id": "zone_3"
  },
  "suggestion": {
    "area_m2": null,
    "category": "muddy/turbid water",
    "duration_days": 3,
    "location_hint": null,
    "severity_hint": "medium"
  },
  "vision": null
}
```

_Sampled for reading — `cluster.updated`: the first 3 of 6 rows. Every row has exactly this shape; the counts come from `/api/health`._

### POST /api/cluster/run

`Run clustering` button. Idempotent and deterministic: the same complaints produce the same cases, so calling it twice is harmless. Returns `created`, `updated`, `skipped`.

_No parameters._

**Request**: none.

**Real response** from the seeded database (`/api/cluster/run`):

```json
{
  "created": [],
  "data": "synthetic sample data",
  "demo_now": "2026-11-03 09:00:00",
  "disclaimer": "Automated findings support human judgment. They are not official regulatory decisions.",
  "updated": [
    {
      "created_at": "2026-11-03 09:00:00",
      "domain": "water",
      "evidence_json": "{\"anomaly\": {\"anomaly_flag\": true, \"breach\": true, \"ops_note\": null, \"parameter\": \"turbidity_ntu\", \"z\": 151.58}, \"buildings\": [\"B21\", \"B22\", \"B23\", \"B24\", \"B25\"], \"coliform\": true, \"complaints\": [\"CMP001\", \"CMP002\", \"CMP003\", \"CMP004\", \"CMP005\", \"CMP021\"], \"confidence\": 0.9, \"flow_changed\": null, \"limits\": {\"coliform\": {\"acceptable\": 0.0, \"ideal\": 0.0, \"note\": \"must be absent in 100 mL\", \"permissible\": 0.0, \"unit\": \"present/absent\", \"weight\": 0.2}, \"ph\": {\"acceptable\": [6.5, 8.5], \"ideal\": 7.0, \"note\": \"no relaxation\", \"permissible\": [6.5, 8.5], \"unit\": \"\", \"weight\": 0.15}, \"residual_chlorine_ \u2026[trimmed]",
      "id": "CASE-2026-003",
      "node_id": "zone_3",
      "scope": "MUNICIPAL",
      "severity": "High",
      "status": "Open",
      "title": "Shared upstream cause at Ward 3 - Khadki Old Town (5 buildings)",
      "updated_at": "2026-11-03 09:00:00"
    }
  ]
}
```

_Sampled for reading — `u.p.d.a.t.e.d`: the first 1 of 6 rows; strings longer than 600 chars. Every row has exactly this shape; the counts come from `/api/health`._

### POST /api/cases/{case_id}/draft

Draft advisory + explanation. Both come back stamped (`status: DRAFT`) with `ai` saying which provider wrote them. Nothing is sent until a human approves — the UI must show the DRAFT stamp over the text.

| Parameter | Where | Required | Type | Default |
|---|---|---|---|---|
| `case_id` | path | yes | string |  |

**Request**: none.

**Real response** from the seeded database (`/api/cases/CASE-2026-003/draft`):

```json
{
  "ai": "offline",
  "case_id": "CASE-2026-003",
  "disclaimer": "Automated findings support human judgment. They are not official regulatory decisions.",
  "explanation": "The system grouped 6 complaints from buildings sharing the upstream node zone_3. Latest readings: ph is 7.063 against the standard's 6.5-8.5; residual chlorine mgl is 0.0382 against the standard's 0.2; tds mgl is 344.26 against the standard's 500.0; turbidity ntu is 8.962 against the standard's 1.0. Rule fired: PLACE ward zone_3 -> shared upstream node lca(buildings) -> TIME within 24h -> BEHAVIOR sensors corroborate. Standard cited: Turbidity (NTU) (IS 10500:2012, Table 1, excerpt - verify). A human officer must verify. This explanation supports human judgment and is not an official regulatory decision.",
  "status": "DRAFT",
  "text": "Water supplied to zone_3 does not meet the standard. Measured turbidity is 8.962 NTU. Disinfection residual is 0.0382 mg/L. Boil drinking water until further notice. Use it cooled for cooking, brushing teeth and for children. A municipal team is checking the source and will publish the result here. DRAFT - not sent until a human officer approves the wording. Standard cited: IS 10500:2012, Table 1, excerpt - verify."
}
```

### PATCH /api/cases/{case_id}/status

Workflow advance. The server enforces the whitelist (Open -> Investigating -> Action Taken -> Resolved); a bad move is a 400 whose `detail` names the allowed values. The complaints that made the case move to the same status.

| Parameter | Where | Required | Type | Default |
|---|---|---|---|---|
| `case_id` | path | yes | string |  |
| `actor` | body | yes | string |  |
| `note` | body | no | string | "" |
| `role` | body | no | string | "Officer" |
| `status` | body | yes | string |  |

**Request body** for this example:

```json
{
  "actor": "Officer R. Rao",
  "note": "Crew dispatched to the 1991 main.",
  "role": "Ward Officer",
  "status": "Investigating"
}
```

**Real response** from the seeded database (`/api/cases/CASE-2026-003/status`):

```json
{
  "actions": [
    {
      "action": "Case opened",
      "actor": "Nirikshan engine",
      "case_id": "CASE-2026-003",
      "id": "ACT009",
      "note": "Clustering created this case from 5 complaint(s) sharing zone_3",
      "role": "Automated system",
      "timestamp": "2026-11-03 09:00:00"
    },
    {
      "action": "Draft advisory",
      "actor": "Nirikshan agent",
      "case_id": "CASE-2026-003",
      "id": "ACT015",
      "note": "DRAFT \u2014 not sent until a human approves (provider: offline)",
      "role": "AI (advisory only)",
      "timestamp": "2026-11-03 09:00:00"
    }
  ],
  "case": {
    "created_at": "2026-11-03 09:00:00",
    "domain": "water",
    "evidence_json": "{\"anomaly\": {\"anomaly_flag\": true, \"breach\": true, \"ops_note\": null, \"parameter\": \"turbidity_ntu\", \"z\": 151.58}, \"buildings\": [\"B21\", \"B22\", \"B23\", \"B24\", \"B25\"], \"coliform\": true, \"complaints\": [\"CMP001\", \"CMP002\", \"CMP003\", \"CMP004\", \"CMP005\", \"CMP021\"], \"confidence\": 0.9, \"flow_changed\": null, \"limits\": {\"coliform\": {\"acceptable\": 0.0, \"ideal\": 0.0, \"note\": \"must be absent in 100 mL\", \"permissible\": 0.0, \"unit\": \"present/absent\", \"weight\": 0.2}, \"ph\": {\"acceptable\": [6.5, 8.5], \"ideal\": 7.0, \"note\": \"no relaxation\", \"permissible\": [6.5, 8.5], \"unit\": \"\", \"weight\": 0.15}, \"residual_chlorine_ \u2026[trimmed]",
    "id": "CASE-2026-003",
    "node_id": "zone_3",
    "scope": "MUNICIPAL",
    "severity": "High",
    "status": "Investigating",
    "title": "Shared upstream cause at Ward 3 - Khadki Old Town (5 buildings)",
    "updated_at": "2026-11-03 09:00:00"
  }
}
```

_Sampled for reading — `a.c.t.i.o.n.s`: the first 2 of 6 rows; strings longer than 600 chars. Every row has exactly this shape; the counts come from `/api/health`._

### POST /api/cases/{case_id}/approve

Human sign-off on the draft. Logs actor + role; the optional `advance_to` is checked against the same whitelist.

| Parameter | Where | Required | Type | Default |
|---|---|---|---|---|
| `case_id` | path | yes | string |  |
| `actor` | body | yes | string |  |
| `advance_to` | body | no | string (nullable) |  |
| `role` | body | no | string | "Officer" |

**Request body** for this example:

```json
{
  "actor": "Officer R. Rao",
  "advance_to": "Action Taken",
  "role": "Ward Officer"
}
```

**Real response** from the seeded database (`/api/cases/CASE-2026-003/approve`):

```json
{
  "actions": [
    {
      "action": "Case opened",
      "actor": "Nirikshan engine",
      "case_id": "CASE-2026-003",
      "id": "ACT009",
      "note": "Clustering created this case from 5 complaint(s) sharing zone_3",
      "role": "Automated system",
      "timestamp": "2026-11-03 09:00:00"
    },
    {
      "action": "Draft advisory",
      "actor": "Nirikshan agent",
      "case_id": "CASE-2026-003",
      "id": "ACT015",
      "note": "DRAFT \u2014 not sent until a human approves (provider: offline)",
      "role": "AI (advisory only)",
      "timestamp": "2026-11-03 09:00:00"
    }
  ],
  "approved_by": "Officer R. Rao",
  "case": {
    "created_at": "2026-11-03 09:00:00",
    "domain": "water",
    "evidence_json": "{\"anomaly\": {\"anomaly_flag\": true, \"breach\": true, \"ops_note\": null, \"parameter\": \"turbidity_ntu\", \"z\": 151.58}, \"buildings\": [\"B21\", \"B22\", \"B23\", \"B24\", \"B25\"], \"coliform\": true, \"complaints\": [\"CMP001\", \"CMP002\", \"CMP003\", \"CMP004\", \"CMP005\", \"CMP021\"], \"confidence\": 0.9, \"flow_changed\": null, \"limits\": {\"coliform\": {\"acceptable\": 0.0, \"ideal\": 0.0, \"note\": \"must be absent in 100 mL\", \"permissible\": 0.0, \"unit\": \"present/absent\", \"weight\": 0.2}, \"ph\": {\"acceptable\": [6.5, 8.5], \"ideal\": 7.0, \"note\": \"no relaxation\", \"permissible\": [6.5, 8.5], \"unit\": \"\", \"weight\": 0.15}, \"residual_chlorine_ \u2026[trimmed]",
    "id": "CASE-2026-003",
    "node_id": "zone_3",
    "scope": "MUNICIPAL",
    "severity": "High",
    "status": "Action Taken",
    "title": "Shared upstream cause at Ward 3 - Khadki Old Town (5 buildings)",
    "updated_at": "2026-11-03 09:00:00"
  },
  "status": "Action Taken"
}
```

_Sampled for reading — `a.c.t.i.o.n.s`: the first 2 of 7 rows; strings longer than 600 chars. Every row has exactly this shape; the counts come from `/api/health`._

### POST /api/land/reports

Land intake: the complaint comes back with its proximity score and factors, a routing suggestion and the water cross-link. `node_id` must name a `land_site`.

| Parameter | Where | Required | Type | Default |
|---|---|---|---|---|
| `area_m2` | body | no | number (nullable) |  |
| `category` | body | yes | string |  |
| `duration_days` | body | no | integer (nullable) |  |
| `image` | body | no | string (nullable) |  |
| `node_id` | body | yes | string |  |
| `text` | body | yes | string |  |

**Request body** for this example:

```json
{
  "area_m2": 40,
  "category": "Open waste dump",
  "duration_days": 12,
  "node_id": "land_05",
  "text": "Garbage pile beside the school compound since 12 days"
}
```

**Real response** from the seeded database (`/api/land/reports`):

```json
{
  "ai": "offline",
  "cases": [
    "CASE-2026-008"
  ],
  "cluster": {
    "created": [],
    "updated": [
      "CASE-2026-003",
      "CASE-2026-004",
      "CASE-2026-005",
      "CASE-2026-006",
      "CASE-2026-007",
      "CASE-2026-008"
    ]
  },
  "complaint": {
    "area_m2": 40.0,
    "category": "Open waste dump",
    "domain": "land",
    "duration_days": 12,
    "extracted_fields": "{\"area_m2\": null, \"category\": \"open waste dump\", \"duration_days\": 12, \"location_hint\": null, \"severity_hint\": \"high\"}",
    "id": "CMP022",
    "image_path": null,
    "node_id": "land_05",
    "status": "NEW",
    "text": "Garbage pile beside the school compound since 12 days",
    "timestamp": "2026-11-03 09:00:00"
  },
  "cross_link": null,
  "data": "synthetic sample data",
  "disclaimer": "Automated findings support human judgment. They are not official regulatory decisions.",
  "nearest_sensor": {
    "distance_m": 562.6,
    "name": "Ward 1 - Bungalow Road",
    "node_id": "zone_1",
    "sensor_id": "S_zone_1",
    "wqi": {
      "band": "Acceptable",
      "colour": "#A8D08D",
      "score": 32.7
    }
  },
  "node": {
    "id": "land_05",
    "lat": 19.0492,
    "lon": 72.8808,
    "name": "School Ground Dump",
    "parent_id": null,
    "type": "land_site",
    "zone_id": "zone_3"
  },
  "proximity": {
    "factors": [
      {
        "kind": "school",
        "label": "Within 300 m of a school",
        "met": true,
        "nearest": {
          "distance_m": 166.8,
          "feature": "Municipal School, Lane 7",
          "kind": "school"
        },
        "points": 30,
        "within_m": 300
      },
      {
        "kind": "water_body",
        "label": "Within 200 m of a water body",
        "met": true,
        "nearest": {
          "distance_m": 172.2,
          "feature": "Khadki Nallah",
          "kind": "water_body"
        },
        "points": 30,
        "within_m": 200
      },
      {
        "kind": "main_road",
        "label": "Within 150 m of a main road",
        "met": false,
        "nearest": {
          "distance_m": 932.4,
          "feature": "Ring Road",
          "kind": "main_road"
        },
        "points": 0,
        "within_m": 150
      },
      {
        "days": 12,
        "kind": "duration",
        "label": "Standing for 7+ days",
        "met": true,
        "points": 20
      }
    ],
    "score": 80
  },
  "routed_to": "Sanitation (SwM) officer",
  "suggestion": {
    "area_m2": null,
    "category": "open waste dump",
    "duration_days": 12,
    "location_hint": null,
    "severity_hint": "high"
  },
  "vision": null
}
```

### POST /api/reports/daily

Daily summary. `snapshot` is the object /api/overview returns, so the page can show the numbers beside the drafted text. `status: DRAFT` again.

_No parameters._

**Request**: none.

**Real response** from the seeded database (`/api/reports/daily`):

```json
{
  "ai": "offline",
  "disclaimer": "Automated findings support human judgment. They are not official regulatory decisions.",
  "snapshot": {
    "data": "synthetic sample data",
    "demo_now": "2026-11-03 09:00:00",
    "disclaimer": "Automated findings support human judgment. They are not official regulatory decisions.",
    "hotspots": [
      {
        "band": "Unsafe",
        "cases": [
          "CASE-2026-003"
        ],
        "factors": {
          "complaints_24h": 6,
          "open_cases": 1,
          "severity": 25,
          "wqi": 94.4
        },
        "name": "Ward 3 - Khadki Old Town",
        "node_id": "zone_3",
        "score": 112.2
      }
    ],
    "kpis": {
      "complaints_24h": 20,
      "open_cases": 6,
      "worst_aqi": {
        "category": "Very Poor",
        "colour": "#EA4335",
        "driving_pollutant": "PM10",
        "name": "Construction Belt Monitor B",
        "station_id": "air_08",
        "value": 312.5
      },
      "worst_wqi": {
        "band": "Unsafe",
        "colour": "#EA4335",
        "name": "Ward 3 - Khadki Old Town",
        "node_id": "zone_3",
        "override": "turbidity_ntu|residual_chlorine_mgl|coliform",
        "score": 94.4
      }
    },
    "triage": [
      {
        "complaints": [
          "CMP006",
          "CMP007",
          "CMP008",
          "CMP009"
        ],
        "created_at": "2026-11-03 09:00:00",
        "domain": "water",
        "evidence": {
          "anomaly": {
            "anomaly_flag": true,
            "breach": true,
            "ops_note": "Feed main burst at the Plateau tee; supply lost to four societies.",
            "parameter": "turbidity_ntu",
            "z": 66.31
          },
          "buildings": [
            "B31",
            "B33",
            "B35",
            "B37"
          ],
          "coliform": null,
          "complaints": [
            "CMP006",
            "CMP007",
            "CMP008",
            "CMP009"
          ],
          "confidence": 0.9,
          "flow_changed": "Feed main burst at the Plateau tee; supply lost to four societies.",
          "limits": {
            "coliform": {
              "acceptable": 0.0,
              "ideal": 0.0,
              "note": "must be absent in 100 mL",
              "permissible": 0.0,
              "unit": "present/absent",
              "weight": 0.2
            },
            "ph": {
              "acceptable": [
                6.5,
                8.5
              ],
              "ideal": 7.0,
              "note": "no relaxation",
              "permissible": [
                6.5,
                8.5
              ],
              "unit": "",
              "weight": 0.15
            },
            "residual_chlorine_mgl": {
              "acceptable": [
                0.2,
                null
              ],
              "ideal": 0.5,
              "note": "process-control minimum, not a health standard",
              "permissible": [
                0.2,
                null
              ],
              "unit": "mg/L",
              "weight": 0.25
            },
            "tds_mgl": {
              "acceptable": 500.0,
              "ideal": 0.0,
              "permissible": 2000.0,
              "unit": "mg/L",
              "weight": 0.15
            },
            "turbidity_ntu": {
              "acceptable": 1.0,
              "ideal": 0.0,
              "note": "5 NTU only when no alternative source",
              "permissible": 5.0,
              "unit": "NTU",
              "weight": 0.25
            }
          },
          "readings": {
            "ph": 7.348,
            "residual_chlorine_mgl": 0.3828,
            "tds_mgl": 332.21,
            "timestamp": "2026-11-03 09:00:00",
            "turbidity_ntu": 3.971
          },
          "rule": "PLACE ward zone_4 -> shared upstream node lca(buildings) -> TIME within 24h -> BEHAVIOR sensors corroborate",
          "shared_node": "zone_4",
          "sibling_status": "turbidity breach",
          "wqi": {
            "band": "Poor",
            "colour": "#F4B400",
            "override": null,
            "score": 60.3,
            "subindices": {
              "ph": {
                "qi": 23.2,
                "value": 7.348,
                "weight": 0.15
              },
              "residual_chlorine_mgl": {
                "qi": 39.1,
                "value": 0.3828,
                "weight": 0.25
              },
              "tds_mgl": {
                "qi": 66.4,
                "value": 332.21,
                "weight": 0.15
              },
              "turbidity_ntu": {
                "qi": 100.0,
                "value": 3.971,
                "weight": 0.25
              }
            },
            "weights_used": 0.8
          }
        },
        "id": "CASE-2026-004",
        "last_action": "2026-11-03 09:00:00",
        "node_id": "zone_4",
        "overdue": false,
        "scope": "MUNICIPAL",
        "severity": "Emergency",
        "status": "Open",
        "title": "Supply loss on the Ward 4 - Plateau branch",
        "updated_at": "2026-11-03 09:00:00"
      }
    ]
  },
  "status": "DRAFT",
  "text": "OVERVIEW\n- Demo clock 2026-11-03 09:00:00. 6 open case(s), 20 complaint(s) in the last 24 h.\n- Worst water index 94.4 Unsafe (Ward 3 - Khadki Old Town), worst air index 312.5 Very Poor (Construction Belt Monitor B).\nWATER\n- 4 open case(s).\n- Emergency at zone_4 (Open): Supply loss on the Ward 4 - Plateau branch\n- High at zone_3 (Action Taken): Shared upstream cause at Ward 3 - Khadki Old Town (5 buildings)\n- Low at zone_2 (Open): Shared upstream cause at Ward 2 - Ring Road (2 buildings)\nAIR\n- 1 open case(s).\n- High at air_08 (Open): Dust / PM episode around Construction Belt Monitor B\nLAND\n- 1 open case(s).\n- Medium at land_05 (Open): Open waste dump at School Ground Dump\nWHAT NEEDS A HUMAN TODAY\n- CASE-2026-004: Supply loss on the Ward 4 - Plateau branch -> approve or reject the draft, then route it.\n- CASE-2026-003: Shared upstream cause at Ward 3 - Khadki Old Town (5 buildings) -> approve or reject the draft, then route it.\n- CASE-2026-007: Dust / PM episode around Construction Belt Monitor B -> approve or reject the draft, then route it.\n\nDRAFT - figures come from the case list above; a human officer signs it."
}
```

_Sampled for reading — `snapshot.hotspots`: the first 1 of 5 rows; `snapshot.triage`: the first 1 of 6 rows. Every row has exactly this shape; the counts come from `/api/health`._

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

---

_Generated by `PY make_frontend_spec.py` against a live server and the seeded database. Do not hand-edit: change the code or the generator, then re-run — `docs/openapi.json` is rewritten in the same pass._
