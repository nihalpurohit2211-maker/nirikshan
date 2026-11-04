"""Nirikshan API (PLAN.md §7.9).

Everything the UI and the demo need, from the local SQLite file only: no network
call happens at import time and none happens inside `/api/health` (§2 rule 7).
Errors are always the JSON envelope `{"detail": "..."}` with a `request_id`,
including 500s (§2 rule 3). Config is validated at startup and the app refuses to
boot if it is wrong (§2 rule 6).

The AI agent is imported lazily inside the endpoints that use it, so the backend
core gates green without a key and without the provider module being reachable.
"""

import json
import logging
import os
import sqlite3
import uuid
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from backend import graph as graph_mod
from backend import rules as rules_mod
from backend import standards as standards_mod
from backend.db import connect, demo_now, next_id
from backend.forecast import REFERENCE_YEAR

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONFIG_DIR = os.path.join(ROOT, "config")

log = logging.getLogger("nirikshan")
logging.basicConfig(level=logging.INFO)


# ---------------------------------------------------------------------------
# config: validated at startup, fail fast (§2 rule 6)
# ---------------------------------------------------------------------------

_REQUIRED = {
    "limits.json": {"parameters": ["ph", "turbidity_ntu", "tds_mgl",
                                   "residual_chlorine_mgl", "coliform"],
                    "wqi_bands": None},
    "aqi.json": {"categories": None, "pm25_24h_breakpoints": None,
                 "pm10_24h_breakpoints": None, "pollutants": None,
                 "index_bounds": None},
    "rules.json": {"clustering": ["window_hours", "min_buildings_for_municipal_case",
                                  "min_complaints_for_any_case", "land_proximity_m",
                                  "sibling_normal_tolerance"],
                   "severity": None, "forecast": ["horizon_hours",
                                                  "chlorine_minimum_mgl"],
                   "anomaly": ["z_threshold"], "escalation": ["enabled"],
                   "land_proximity": ["school_m", "water_body_m", "main_road_m",
                                      "w_school", "w_water", "w_road",
                                      "w_duration_days", "w_duration", "cap"]},
}


def _load_json(path):
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def validate_config():
    """Return (limits, aqi_cfg, rules_cfg) or raise with the exact problem."""
    out = {}
    for name, spec in _REQUIRED.items():
        path = os.path.join(CONFIG_DIR, name)
        if not os.path.exists(path):
            raise RuntimeError("config/%s is missing — re-run Phase 0 (§5)" % name)
        try:
            data = _load_json(path)
        except json.JSONDecodeError as exc:
            raise RuntimeError("config/%s is not valid JSON: %s" % (name, exc)) from exc
        for key, sub in spec.items():
            if key not in data:
                raise RuntimeError("config/%s has no %r key" % (name, key))
            if sub:
                missing = [s for s in sub if s not in data[key]]
                if missing:
                    raise RuntimeError("config/%s %r is missing %s"
                                       % (name, key, ", ".join(missing)))
        out[name] = data
    limits, aqi_cfg, rules_cfg = (out["limits.json"], out["aqi.json"], out["rules.json"])

    weights = sum(p["weight"] for p in limits["parameters"].values())
    if not 0.99 <= weights <= 1.01:
        raise RuntimeError("config/limits.json parameter weights sum to %.3f, not 1"
                           % weights)
    top = max(b["max"] for b in limits["wqi_bands"])
    if top != 100:
        raise RuntimeError("config/limits.json wqi_bands must cover the 0-100 range")
    lengths = {len(v) for k, v in aqi_cfg.items() if k.endswith("_breakpoints")}
    if len(lengths) != 1:
        raise RuntimeError("config/aqi.json breakpoint tables differ in length: %s"
                           % sorted(lengths))
    if len(aqi_cfg["index_bounds"]) < lengths.pop():
        raise RuntimeError("config/aqi.json index_bounds must cover every breakpoint")
    if rules_cfg["clustering"]["min_buildings_for_municipal_case"] < \
            rules_cfg["clustering"]["min_complaints_for_any_case"]:
        raise RuntimeError("config/rules.json: a municipal case cannot need fewer"
                           " buildings than any case needs complaints")
    return limits, aqi_cfg, rules_cfg


LIMITS, AQI_CFG, RULES_CFG = validate_config()

DISCLAIMER = ("Automated findings support human judgment. They are not official"
              " regulatory decisions.")
DATA_LABEL = "synthetic sample data"


# ---------------------------------------------------------------------------
# app
# ---------------------------------------------------------------------------

@asynccontextmanager
async def _lifespan(_app: FastAPI):
    conn = db()
    try:
        standards_mod.sync(conn, LIMITS, AQI_CFG)
        conn.commit()
        log.info("Nirikshan up: demo_now=%s, reference year %d, static=%s",
                 demo_now(conn), REFERENCE_YEAR, os.path.basename(_static))
    finally:
        conn.close()
    yield


app = FastAPI(title="Nirikshan", version="1.0.0", lifespan=_lifespan,
              description="Environmental Intelligence & Compliance Management"
                          " System — Infomatrix HackOps 2. " + DISCLAIMER)


@app.middleware("http")
async def request_id_middleware(request: Request, call_next):
    rid = request.headers.get("x-request-id") or uuid.uuid4().hex[:8]
    request.state.request_id = rid
    response = await call_next(request)
    response.headers["X-Request-Id"] = rid
    log.info("%s %s -> %s (%s)", request.method, request.url.path,
             response.status_code, rid)
    return response


@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    return JSONResponse(status_code=exc.status_code,
                        content={"detail": str(exc.detail),
                                 "request_id": getattr(request.state, "request_id", None)})


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    return JSONResponse(status_code=422,
                        content={"detail": "; ".join(
                            "%s: %s" % (".".join(str(p) for p in e["loc"][1:]), e["msg"])
                            for e in exc.errors()),
                            "request_id": getattr(request.state, "request_id", None)})


@app.exception_handler(sqlite3.Error)
async def sqlite_exception_handler(request: Request, exc: sqlite3.Error):
    return JSONResponse(status_code=500,
                        content={"detail": "database error: %s" % exc,
                                 "request_id": getattr(request.state, "request_id", None)})


@app.exception_handler(Exception)
async def generic_exception_handler(request: Request, exc: Exception):
    log.exception("unhandled error on %s", request.url.path)
    return JSONResponse(status_code=500,
                        content={"detail": "internal error: %s" % exc,
                                 "request_id": getattr(request.state, "request_id", None)})


def db():
    return connect()


def _rows(conn, sql, params=()):
    return [dict(r) for r in conn.execute(sql, params).fetchall()]


def _agent():
    """Lazy import: the demo works before Phase 3 and without an API key."""
    from backend import agent
    return agent


def _store_upload(image, complaint_id):
    """A real upload is written to data/images/ and stored as its path (§4.1).

    Returns (image_path, (bytes, mime)) for an upload, (image, None) for a path.
    """
    if not image or not image.startswith("data:image/"):
        return image, None
    mime, _, payload = image.partition("base64,")
    mime = mime[len("data:"):].rstrip(";")
    if mime not in ("image/jpeg", "image/png"):
        raise HTTPException(400, "only jpg/png uploads are accepted")
    try:
        import base64
        raw = base64.b64decode(payload, validate=True)
    except Exception:                                   # noqa: BLE001 - bad payload
        raise HTTPException(400, "the image payload is not valid base64")
    ext = "jpg" if mime == "image/jpeg" else "png"
    directory = os.path.join(ROOT, "data", "images")
    path = os.path.join(directory, "upload_%s.%s" % (complaint_id, ext))
    with open(path, "wb") as fh:
        fh.write(raw)
    return "data/images/upload_%s.%s" % (complaint_id, ext), (raw, mime)


def _vision(agent, raw_bytes, mime):
    """Only a decoded upload reaches a vision model; offline says metadata only."""
    text, mode = agent.call_vision(
        "You are looking at one photo attached to a citizen environmental complaint."
        " Describe only what is visible and say what you cannot tell from the image."
        " Never invent a measurement.",
        "Complaint photo (%s)." % mime, raw_bytes, mime)
    return {"analysed": text is not None, "ai": mode,
            "note": text or "metadata only: %s, %d bytes" % (mime, len(raw_bytes)),
            "bytes": len(raw_bytes)}


# ---------------------------------------------------------------------------
# request bodies
# ---------------------------------------------------------------------------

class ComplaintIn(BaseModel):
    domain: str
    node_id: str | None = None
    category: str | None = None
    text: str
    image: str | None = None
    duration_days: int | None = None
    area_m2: float | None = None


class StatusIn(BaseModel):
    status: str
    actor: str
    role: str = "Officer"
    note: str = ""


class ApproveIn(BaseModel):
    actor: str
    role: str = "Officer"
    advance_to: str | None = None


class LandReportIn(BaseModel):
    node_id: str
    category: str
    text: str
    image: str | None = None
    duration_days: int | None = None
    area_m2: float | None = None


# ---------------------------------------------------------------------------
# health + overview
# ---------------------------------------------------------------------------

@app.get("/api/health")
def health():
    conn = db()
    try:
        counts = {
            "nodes": conn.execute("SELECT COUNT(*) n FROM nodes").fetchone()["n"],
            "pipes": conn.execute("SELECT COUNT(*) n FROM pipes").fetchone()["n"],
            "sensors": conn.execute("SELECT COUNT(*) n FROM sensors").fetchone()["n"],
            "readings": conn.execute("SELECT COUNT(*) n FROM readings").fetchone()["n"],
            "complaints": conn.execute(
                "SELECT COUNT(*) n FROM complaints").fetchone()["n"],
            "cases": conn.execute("SELECT COUNT(*) n FROM cases").fetchone()["n"],
        }
        payload = {"status": "ok", "demo_now": demo_now(conn), "counts": counts,
                   "ai": _agent().provider_mode(),
                   "maps": "google" if _maps_key() else "schematic",
                   "disclaimer": DISCLAIMER, "data": DATA_LABEL}
        detail = _agent().provider_detail()
        if detail:
            payload["ai_detail"] = detail
        return payload
    finally:
        conn.close()


def _worst_wqi(conn):
    from backend import wqi as wqi_mod

    latest = rules_mod.bulk_latest(conn)
    coliform = rules_mod.bulk_coliform(conn)
    names = {r["id"]: r["name"] for r in conn.execute(
        "SELECT id, name FROM nodes WHERE type = 'zone'")}
    worst = None
    for node_id, values in latest.items():
        if node_id not in names:
            continue
        idx = wqi_mod.compute(values, coliform.get(node_id), LIMITS)
        if worst is None or idx["score"] > worst["score"]:
            worst = {"node_id": node_id, "name": names[node_id],
                     "score": idx["score"], "band": idx["band"],
                     "colour": idx["colour"], "override": idx["override"]}
    return worst


def _worst_aqi(conn):
    from backend import aqi as aqi_mod

    latest = rules_mod.bulk_latest_air(conn)
    names = {r["id"]: r["name"] for r in conn.execute(
        "SELECT id, name FROM nodes WHERE type = 'air_station'")}
    worst = None
    for station, reading in latest.items():
        idx = aqi_mod.compute(reading, AQI_CFG)
        if worst is None or idx["value"] > worst["value"]:
            worst = {"station_id": station, "name": names.get(station, station),
                     "value": idx["value"], "category": idx["category"],
                     "colour": idx["colour"],
                     "driving_pollutant": idx["driving_pollutant"]}
    return worst


@app.get("/api/overview")
def overview():
    conn = db()
    try:
        return _overview(conn)
    finally:
        conn.close()


def _overview(conn):
    """The dashboard payload, shared by /api/overview and POST /api/reports/daily."""
    now = demo_now(conn)
    window = RULES_CFG["clustering"]["window_hours"]
    cases = _rows(conn, "SELECT id, domain, node_id, scope, status, severity, title,"
                        " created_at, updated_at, evidence_json FROM cases"
                        " WHERE status != 'Resolved'"
                        " ORDER BY CASE severity WHEN 'Emergency' THEN 0"
                        " WHEN 'High' THEN 1 WHEN 'Medium' THEN 2 ELSE 3 END, id")
    by_case = {}
    for a in _rows(conn, "SELECT * FROM case_actions"):
        by_case.setdefault(a["case_id"], []).append(a)
    triage = []
    for c in cases:
        evidence = json.loads(c.pop("evidence_json") or "{}")
        acts = by_case.get(c["id"], [])
        c["evidence"] = evidence
        triage.append({**c,
                       "complaints": evidence.get("complaints", []),
                       "overdue": rules_mod.is_overdue(c, acts, now, RULES_CFG),
                       "last_action": max((a["timestamp"] for a in acts),
                                          default=c["created_at"])})
    complaints_24h = conn.execute(
        "SELECT COUNT(*) n FROM complaints WHERE timestamp >= datetime(?, ?)",
        (now, "-%d hours" % window)).fetchone()["n"]
    return {
        "kpis": {"open_cases": len(cases), "worst_wqi": _worst_wqi(conn),
                 "worst_aqi": _worst_aqi(conn), "complaints_24h": complaints_24h},
        "triage": triage,
        "hotspots": rules_mod.hotspots(conn, RULES_CFG, LIMITS),
        "demo_now": now, "disclaimer": DISCLAIMER, "data": DATA_LABEL,
    }


# ---------------------------------------------------------------------------
# network + nodes
# ---------------------------------------------------------------------------

@app.get("/api/network")
def network():
    """Nodes with WQI, plus pipes — bulk-loaded, no per-row queries (§2 rule 1)."""
    from backend import wqi as wqi_mod

    conn = db()
    try:
        latest = rules_mod.bulk_latest(conn)
        coliform = rules_mod.bulk_coliform(conn)
        nodes = []
        for n in _rows(conn, "SELECT * FROM nodes ORDER BY id"):
            values = latest.get(n["id"])
            entry = {**n, "wqi": None, "latest": None}
            if values:
                idx = wqi_mod.compute(values, coliform.get(n["id"]), LIMITS)
                entry["wqi"] = {"score": idx["score"], "band": idx["band"],
                                "colour": idx["colour"], "override": idx["override"]}
                entry["latest"] = values
            nodes.append(entry)
        return {"nodes": nodes,
                "pipes": _rows(conn, "SELECT * FROM pipes ORDER BY id"),
                "demo_now": demo_now(conn), "disclaimer": DISCLAIMER,
                "data": DATA_LABEL}
    finally:
        conn.close()


_MAPS_KEY_NAMES = ("GOOGLE_MAPS_API_KEY", "GMAPS_API_KEY", "MAPS_API_KEY")


def _maps_key():
    for name in _MAPS_KEY_NAMES:
        value = (os.environ.get(name) or "").strip()
        if value:
            return value
    return ""


@app.get("/api/map-config")
def map_config():
    """Which basemap the browser should draw, and the public Maps key when set.

    The key is a Maps JavaScript key by design (it is visible in any page that
    uses Maps); restrict it by HTTP referrer in the Google console. No other
    credential is ever exposed here.
    """
    key = _maps_key()
    return {"provider": "google" if key else "schematic", "key": key or None,
            "libraries": ["visualization"],
            "note": "public browser key; restrict it by HTTP referrer",
            "data": DATA_LABEL}


@app.get("/api/wards")
def wards():
    """Ward zones as real lon/lat polygons, derived from the served centres.

    Geometry comes from `backend/wards.py` (Voronoi cells clipped to the city
    bounds). The counts attached to a cell are read from the same tables the
    rest of the API serves, so a zone label can never disagree with the page.
    """
    from backend import wards as wards_mod
    from backend import wqi as wqi_mod

    conn = db()
    try:
        nodes = _rows(conn, "SELECT id, name, type, lat, lon, parent_id FROM nodes")
        zones = [n for n in nodes if n["type"] == "zone" and n["lat"] and n["lon"]]
        sites = [{"id": z["id"], "name": z["name"], "lon": z["lon"], "lat": z["lat"]}
                 for z in zones]
        bounds = wards_mod.bounds_of([[n["lon"], n["lat"]] for n in nodes
                                      if n["lat"] and n["lon"]])
        cells = wards_mod.cells(sites, bounds)
        latest = rules_mod.bulk_latest(conn)
        coliform = rules_mod.bulk_coliform(conn)
        complaints = _rows(conn, "SELECT id, node_id, status FROM complaints")
        cases = _rows(conn, "SELECT id, node_id, status FROM cases"
                            " WHERE status != 'Resolved'")
        for cell in cells:
            poly = cell["polygon"]
            inside = {n["id"] for n in nodes
                      if n["lat"] and n["lon"]
                      and wards_mod.inside((n["lon"], n["lat"]), poly)}
            cell["node_count"] = len(inside)
            cell["complaints"] = len([c for c in complaints if c["node_id"] in inside])
            cell["open_cases"] = len([c for c in cases if c["node_id"] in inside])
            values = latest.get(cell["id"])
            if values:
                idx = wqi_mod.compute(values, coliform.get(cell["id"]), LIMITS)
                cell["wqi"] = {"score": idx["score"], "band": idx["band"],
                               "colour": idx["colour"]}
            else:
                cell["wqi"] = None
        return {"wards": cells, "bounds": bounds, "demo_now": demo_now(conn),
                "disclaimer": DISCLAIMER, "data": DATA_LABEL}
    finally:
        conn.close()


@app.get("/api/nodes/{node_id}")
def node_detail(node_id: str):
    from backend import anomaly as anomaly_mod
    from backend import wqi as wqi_mod

    conn = db()
    try:
        node = conn.execute("SELECT * FROM nodes WHERE id = ?", (node_id,)).fetchone()
        if node is None:
            raise HTTPException(404, "no such node: %s" % node_id)
        latest = rules_mod.bulk_latest(conn).get(node_id)
        coliform = rules_mod.bulk_coliform(conn).get(node_id)
        sensor = conn.execute("SELECT id FROM sensors WHERE node_id = ? AND kind = 'multi'",
                              (node_id,)).fetchone()
        anomaly = None
        if sensor:
            series = rules_mod.bulk_series(conn).get(sensor["id"], [])
            anomaly = anomaly_mod.detect(series, RULES_CFG["anomaly"]["z_threshold"])
        return {
            "node": dict(node),
            "wqi": wqi_mod.compute(latest, coliform, LIMITS) if latest else None,
            "latest": latest,
            "coliform_present": coliform,
            "anomaly": anomaly,
            "lab_tests": _rows(conn, "SELECT * FROM lab_tests WHERE node_id = ?"
                                     " ORDER BY date DESC LIMIT 5", (node_id,)),
            "maintenance": _rows(conn, "SELECT * FROM maintenance_checks WHERE node_id = ?"
                                       " ORDER BY date DESC LIMIT 5", (node_id,)),
            "open_cases": _rows(conn, "SELECT * FROM cases WHERE node_id = ?"
                                      " AND status != 'Resolved' ORDER BY id", (node_id,)),
            "disclaimer": DISCLAIMER, "data": DATA_LABEL,
        }
    finally:
        conn.close()


@app.get("/api/nodes/{node_id}/readings")
def node_readings(node_id: str):
    conn = db()
    try:
        sensor = conn.execute("SELECT id FROM sensors WHERE node_id = ?"
                              " AND kind = 'multi'", (node_id,)).fetchone()
        if sensor is None:
            raise HTTPException(404, "node %s has no water sensor" % node_id)
        series = rules_mod.bulk_series(conn).get(sensor["id"], [])
        return {"node_id": node_id, "sensor_id": sensor["id"], "readings": series,
                "hours": len(series)}
    finally:
        conn.close()


@app.get("/api/nodes/{node_id}/forecast")
def node_forecast(node_id: str):
    from backend import forecast as forecast_mod

    conn = db()
    try:
        try:
            payload = forecast_mod.forecast_chlorine(conn, node_id, RULES_CFG)
        except ValueError as exc:
            raise HTTPException(404, str(exc)) from exc
        if payload is None:
            raise HTTPException(404, "node %s has no chlorine series to forecast"
                                % node_id)
        return payload
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# air
# ---------------------------------------------------------------------------

@app.get("/api/air")
def air():
    from backend import aqi as aqi_mod
    from backend import forecast as forecast_mod

    conn = db()
    try:
        latest = rules_mod.bulk_latest_air(conn)
        stations = []
        for s in _rows(conn, "SELECT * FROM nodes WHERE type = 'air_station' ORDER BY id"):
            reading = latest.get(s["id"])
            entry = {**s, "latest": reading, "aqi": None}
            if reading:
                idx = aqi_mod.compute(reading, AQI_CFG)
                entry["aqi"] = {"value": idx["value"], "category": idx["category"],
                               "colour": idx["colour"],
                               "driving_pollutant": idx["driving_pollutant"],
                               "subindices": idx["subindices"]}
            stations.append(entry)
        worst = max((s for s in stations if s["aqi"]),
                    key=lambda s: s["aqi"]["value"], default=None)
        pm_forecast = None
        if worst:
            # Forecast the pollutant actually driving the index, so the dust
            # episode shows a PM10 curve rather than PM2.5.
            column = "pm10" if worst["aqi"]["driving_pollutant"] == "PM10" else "pm25"
            pm_forecast = forecast_mod.forecast_pm(conn, worst["id"], RULES_CFG,
                                                   column=column)
        return {"stations": stations, "worst": worst, "pm_forecast": pm_forecast,
                "categories": AQI_CFG["categories"], "demo_now": demo_now(conn),
                "disclaimer": DISCLAIMER, "data": DATA_LABEL}
    finally:
        conn.close()


@app.get("/api/air/{station_id}/readings")
def air_readings(station_id: str):
    from backend import aqi as aqi_mod

    conn = db()
    try:
        node = conn.execute("SELECT * FROM nodes WHERE id = ? AND type = 'air_station'",
                           (station_id,)).fetchone()
        if node is None:
            raise HTTPException(404, "no such air station: %s" % station_id)
        rows = _rows(conn, "SELECT * FROM air_readings WHERE station_id = ?"
                           " ORDER BY timestamp", (station_id,))
        for r in rows:
            r["aqi"] = aqi_mod.compute(r, AQI_CFG)["value"]
        return {"station_id": station_id, "name": node["name"], "readings": rows,
                "hours": len(rows)}
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# complaints
# ---------------------------------------------------------------------------

def _insert_complaint(conn, body: ComplaintIn):
    """Validate, insert, re-cluster. Shared by /api/complaints and /api/land/reports."""
    if body.domain not in ("water", "air", "land"):
        raise HTTPException(400, "domain must be water, air or land")
    node = conn.execute("SELECT * FROM nodes WHERE id = ?",
                        (body.node_id,)).fetchone() if body.node_id else None
    if body.node_id and node is None:
        raise HTTPException(404, "no such node: %s" % body.node_id)
    now = demo_now(conn)
    agent = _agent()
    suggestion = agent.extract_complaint(body.text or "")
    category = body.category or suggestion.get("category") or "Unspecified"
    cid = next_id(conn, "complaint")
    image_path, upload = _store_upload(body.image, cid)
    conn.execute(
        "INSERT INTO complaints(id, timestamp, domain, node_id, category, text,"
        " status, image_path, extracted_fields, duration_days, area_m2)"
        " VALUES (?,?,?,?,?,?,?,?,?,?,?)",
        (cid, now, body.domain, body.node_id, category, body.text, "NEW",
         image_path, json.dumps(suggestion, sort_keys=True), body.duration_days,
         body.area_m2))
    conn.commit()
    complaint = dict(conn.execute("SELECT * FROM complaints WHERE id = ?",
                                  (cid,)).fetchone())
    cluster_result = rules_mod.cluster(conn, RULES_CFG, LIMITS, AQI_CFG)
    affected = [c["id"] for c in cluster_result["created"] + cluster_result["updated"]
                if cid in json.loads(c["evidence_json"]).get("complaints", [])]
    nearest = _nearest_sensor(conn, node) if node is not None else None
    vision = _vision(agent, *upload) if upload else None
    return {
        "complaint": complaint, "suggestion": suggestion,
        "ai": agent.provider_mode(), "cases": affected,
        "vision": vision,
        "cluster": {"created": [c["id"] for c in cluster_result["created"]],
                    "updated": [c["id"] for c in cluster_result["updated"]]},
        "nearest_sensor": nearest, "node": dict(node) if node else None,
        "disclaimer": DISCLAIMER, "data": DATA_LABEL,
    }


@app.post("/api/complaints")
def create_complaint(body: ComplaintIn):
    conn = db()
    try:
        return _insert_complaint(conn, body)
    finally:
        conn.close()


@app.get("/api/complaints")
def list_complaints(status: str | None = None, domain: str | None = None):
    conn = db()
    try:
        sql, params = "SELECT * FROM complaints", []
        clauses = []
        if status:
            clauses.append("status = ?")
            params.append(status)
        if domain:
            clauses.append("domain = ?")
            params.append(domain)
        if clauses:
            sql += " WHERE " + " AND ".join(clauses)
        sql += " ORDER BY timestamp DESC, id DESC"
        rows = _rows(conn, sql, tuple(params))
        for r in rows:
            r["extracted_fields"] = json.loads(r["extracted_fields"] or "{}")
        return {"complaints": rows, "count": len(rows)}
    finally:
        conn.close()


def _nearest_sensor(conn, node):
    """Nearest multi-parameter sensor to a reporting node, with its area status."""
    from backend import wqi as wqi_mod

    sensors = _rows(conn, "SELECT s.id AS sensor_id, n.id AS node_id, n.name,"
                          " n.lat, n.lon FROM sensors s JOIN nodes n ON n.id = s.node_id"
                          " WHERE s.kind = 'multi' ORDER BY s.id")
    latest = rules_mod.bulk_latest(conn)
    coliform = rules_mod.bulk_coliform(conn)
    best = None
    for s in sensors:
        d = rules_mod.haversine_m(node["lat"], node["lon"], s["lat"], s["lon"])
        if best is None or d < best["distance_m"]:
            best = {"sensor_id": s["sensor_id"], "node_id": s["node_id"],
                    "name": s["name"], "distance_m": round(d, 1)}
    if best and latest.get(best["node_id"]):
        idx = wqi_mod.compute(latest[best["node_id"]], coliform.get(best["node_id"]),
                              LIMITS)
        best["wqi"] = {"score": idx["score"], "band": idx["band"],
                       "colour": idx["colour"]}
    return best


# ---------------------------------------------------------------------------
# clustering + cases
# ---------------------------------------------------------------------------

@app.post("/api/cluster/run")
def run_cluster():
    conn = db()
    try:
        result = rules_mod.cluster(conn, RULES_CFG, LIMITS, AQI_CFG)
        return {**result, "disclaimer": DISCLAIMER, "data": DATA_LABEL}
    finally:
        conn.close()


@app.get("/api/cases")
def list_cases(status: str | None = None, domain: str | None = None):
    conn = db()
    try:
        sql, params = "SELECT * FROM cases", []
        clauses = []
        if status:
            clauses.append("status = ?")
            params.append(status)
        if domain:
            clauses.append("domain = ?")
            params.append(domain)
        if clauses:
            sql += " WHERE " + " AND ".join(clauses)
        sql += " ORDER BY CASE severity WHEN 'Emergency' THEN 0 WHEN 'High' THEN 1" \
               " WHEN 'Medium' THEN 2 ELSE 3 END, id"
        rows = _rows(conn, sql, tuple(params))
        now = demo_now(conn)
        actions = _rows(conn, "SELECT * FROM case_actions")
        by_case = {}
        for a in actions:
            by_case.setdefault(a["case_id"], []).append(a)
        for r in rows:
            r["evidence"] = json.loads(r["evidence_json"] or "{}")
            del r["evidence_json"]
            acts = by_case.get(r["id"], [])
            r["overdue"] = rules_mod.is_overdue(r, acts, now, RULES_CFG)
            r["last_action"] = max((a["timestamp"] for a in acts),
                                   default=r["created_at"])
        return {"cases": rows, "count": len(rows), "demo_now": now}
    finally:
        conn.close()


def _case_or_404(conn, case_id):
    row = conn.execute("SELECT * FROM cases WHERE id = ?", (case_id,)).fetchone()
    if row is None:
        raise HTTPException(404, "no such case: %s" % case_id)
    return dict(row)


def _standards_for_case(conn, case):
    """The rows this case actually violates (water), else the domain's rows."""
    domain = case["domain"]
    if domain != "water":
        return standards_mod.load(conn, domain)
    latest = rules_mod.bulk_latest(conn)
    coliform = rules_mod.bulk_coliform(conn)
    values = latest.get(case["node_id"])
    if not values:
        return standards_mod.load(conn, "water")
    return standards_mod.for_water_breaches(conn, LIMITS, values,
                                            coliform.get(case["node_id"]))


@app.get("/api/cases/{case_id}")
def case_detail(case_id: str):
    conn = db()
    try:
        case = _case_or_404(conn, case_id)
        evidence = json.loads(case["evidence_json"] or "{}")
        del case["evidence_json"]
        complaints = []
        if evidence.get("complaints"):
            placeholders = ",".join("?" * len(evidence["complaints"]))
            complaints = _rows(conn, "SELECT * FROM complaints WHERE id IN (%s)"
                               " ORDER BY timestamp" % placeholders,
                               tuple(evidence["complaints"]))
        trace = _trace_payload(conn, case)
        domain = case["domain"]
        breached = _standards_for_case(conn, case)
        actions = _rows(conn, "SELECT * FROM case_actions WHERE case_id = ?"
                              " ORDER BY timestamp, id", (case_id,))
        now = demo_now(conn)
        return {
            "case": {**case, "overdue": rules_mod.is_overdue(case, actions, now,
                                                             RULES_CFG)},
            "evidence": evidence,
            "trace": trace,
            "standards": breached,
            "standards_excerpt": standards_mod.excerpt_text(domain),
            "complaints": complaints,
            "actions": actions,
            "allowed_transitions": _allowed_transitions(case["status"]),
            "disclaimer": DISCLAIMER, "data": DATA_LABEL,
        }
    finally:
        conn.close()


def _allowed_transitions(status):
    order = rules_mod.STATUS_ORDER
    cur = rules_mod.STATUS_ALIASES.get(status, status)
    if cur in order and order.index(cur) + 1 < len(order):
        return [order[order.index(cur) + 1]]
    return []


@app.patch("/api/cases/{case_id}/status")
def patch_status(case_id: str, body: StatusIn):
    conn = db()
    try:
        case = _case_or_404(conn, case_id)
        current = case["status"]
        if not rules_mod.transition_ok(current, body.status):
            raise HTTPException(400, "status transition %s -> %s is not allowed"
                                        " (allowed: %s)"
                                % (current, body.status,
                                   ", ".join(_allowed_transitions(current)) or "none"))
        now = demo_now(conn)
        conn.execute("UPDATE cases SET status = ?, updated_at = ? WHERE id = ?",
                     (body.status, now, case_id))
        rules_mod._log(conn, case_id, now, body.actor, body.role,
                       "Status -> %s" % body.status,
                       body.note or "Advanced by %s (%s)" % (body.actor, body.role))
        # The complaints that made this case follow it, so the tracker stays honest.
        complaint_ids = evidence_list(conn, case_id)
        if complaint_ids:
            placeholders = ",".join("?" * len(complaint_ids))
            conn.execute("UPDATE complaints SET status = ? WHERE id IN (%s)"
                         % placeholders, tuple([body.status] + complaint_ids))
        conn.commit()
        return {"case": dict(conn.execute("SELECT * FROM cases WHERE id = ?",
                                         (case_id,)).fetchone()),
                "actions": _rows(conn, "SELECT * FROM case_actions WHERE case_id = ?"
                                       " ORDER BY timestamp, id", (case_id,))}
    finally:
        conn.close()


def evidence_list(conn, case_id):
    row = conn.execute("SELECT evidence_json FROM cases WHERE id = ?",
                       (case_id,)).fetchone()
    return json.loads(row["evidence_json"] or "{}").get("complaints", [])


@app.post("/api/cases/{case_id}/draft")
def draft_case(case_id: str):
    agent = _agent()
    conn = db()
    try:
        case = _case_or_404(conn, case_id)
        evidence = json.loads(case["evidence_json"] or "{}")
        standards_rows = _standards_for_case(conn, case)
        text = agent.draft_advisory(case, evidence, standards_rows)
        mode = agent.provider_mode()
        now = demo_now(conn)
        rules_mod._log(conn, case_id, now, "Nirikshan agent", "AI (advisory only)",
                       "Draft advisory", "DRAFT — not sent until a human approves"
                                         " (provider: %s)" % mode)
        conn.execute("UPDATE cases SET updated_at = ? WHERE id = ?", (now, case_id))
        conn.commit()
        return {"case_id": case_id, "text": text, "status": "DRAFT", "ai": mode,
                "explanation": agent.explain_case(case, standards_rows, evidence),
                "disclaimer": DISCLAIMER}
    finally:
        conn.close()


@app.post("/api/cases/{case_id}/approve")
def approve_case(case_id: str, body: ApproveIn):
    conn = db()
    try:
        case = _case_or_404(conn, case_id)
        now = demo_now(conn)
        note = "Advisory approved by %s (%s)" % (body.actor, body.role)
        new_status = case["status"]
        if body.advance_to:
            if not rules_mod.transition_ok(case["status"], body.advance_to):
                raise HTTPException(400, "cannot advance %s -> %s during approval"
                                    % (case["status"], body.advance_to))
            new_status = body.advance_to
            conn.execute("UPDATE cases SET status = ? WHERE id = ?", (new_status, case_id))
        conn.execute("UPDATE cases SET updated_at = ? WHERE id = ?", (now, case_id))
        rules_mod._log(conn, case_id, now, body.actor, body.role,
                       "Advisory approved", note)
        conn.commit()
        return {"case": dict(conn.execute("SELECT * FROM cases WHERE id = ?",
                                         (case_id,)).fetchone()),
                "approved_by": body.actor, "status": new_status,
                "actions": _rows(conn, "SELECT * FROM case_actions WHERE case_id = ?"
                                       " ORDER BY timestamp, id", (case_id,))}
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# trace
# ---------------------------------------------------------------------------

def _trace_payload(conn, case):
    """Upstream path from the case's shared node, with the pipes it runs through."""
    from backend import forecast as forecast_mod

    if case["domain"] != "water" or not case["node_id"]:
        return None
    parent, children, nodes, pipes_by_to = graph_mod.load_graph(conn)
    steps = graph_mod.trace_with_pipes(case["node_id"], parent, nodes, pipes_by_to)
    worst = None
    for s in steps:
        p = s["pipe"]
        if not p or not p["install_year"] or not p["diameter_mm"]:
            continue
        k = forecast_mod.decay_k(p["diameter_mm"], p["install_year"], p["material"])
        if worst is None or k > worst[0]:
            worst = (k, p)
    explanation = _explain_trace(case, steps, worst)
    return {"path": [s["node_id"] for s in steps], "steps": steps,
            "worst_pipe": worst[1] if worst else None,
            "worst_pipe_decay_k": round(worst[0], 4) if worst else None,
            "explanation": explanation,
            "hops": len(steps) - 1 if steps else 0}


def _explain_trace(case, steps, worst):
    if not steps:
        return "No upstream path recorded for this case."
    names = [s["node_name"] for s in steps]
    source = steps[-1]
    kind = str(source.get("node_type") or "source").replace("_", " ")
    text = ("“%s” groups the reports below. Walking back up the distribution tree from"
            " them, the path climbs %s and ends at its source: the %s at %s."
            " Every node on this path is fed from there, so one failing section upstream can"
            " explain all of them. Water flows the other way: %s to %s."
            % (case["title"], " -> ".join(names), kind, source["node_name"],
               source["node_name"], names[0]))
    if not worst:
        return text + " No dated pipe section was recorded on this path."
    k, pipe = worst
    text += (" The worst section on that path is pipe %s: %s laid in %s, %s mm bore."
             " Its first-order decay coefficient k = %.3f /h is the highest of the"
             " chain — age, narrow bore and a wall-demand material all push it up —"
             " so residual chlorine is spent before the water reaches the buildings,"
             " and turbidity rises as the inner surface corrodes."
             % (pipe["id"], pipe["material"], pipe["install_year"],
                pipe["diameter_mm"], k))
    return text


@app.get("/api/trace/{case_id}")
def trace_case(case_id: str):
    conn = db()
    try:
        case = _case_or_404(conn, case_id)
        trace = _trace_payload(conn, case)
        if trace is None:
            raise HTTPException(400, "case %s is a %s case; the network trace"
                                        " covers the water tree" % (case_id,
                                                                    case["domain"]))
        return {"case_id": case_id, "domain": case["domain"], **trace,
                "disclaimer": DISCLAIMER, "data": DATA_LABEL}
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# land
# ---------------------------------------------------------------------------

@app.get("/api/land/reports")
def land_reports():
    conn = db()
    try:
        rows = _rows(conn, "SELECT * FROM complaints WHERE domain = 'land'"
                            " ORDER BY timestamp DESC, id DESC")
        meta_by_node = {m["node_id"]: m for m in
                        _rows(conn, "SELECT * FROM land_meta")}
        out = []
        for r in rows:
            meta = meta_by_node.get(r["node_id"])
            prox = rules_mod.proximity(conn, RULES_CFG, r["node_id"],
                                       r["duration_days"] or 0)
            out.append({**r, "land_meta": dict(meta) if meta else None,
                        "proximity": prox,
                        "cross_link": rules_mod._cross_link(conn, r["node_id"]),
                        "image_url": ("/" + r["image_path"].replace(os.sep, "/"))
                        if r["image_path"] else None})
        return {"reports": out, "count": len(out), "weights": RULES_CFG["land_proximity"],
                "disclaimer": DISCLAIMER, "data": DATA_LABEL}
    finally:
        conn.close()


@app.post("/api/land/reports")
def create_land_report(body: LandReportIn):
    conn = db()
    try:
        node = conn.execute("SELECT * FROM nodes WHERE id = ? AND type = 'land_site'",
                            (body.node_id,)).fetchone()
        if node is None:
            raise HTTPException(404, "no such land site: %s" % body.node_id)
        payload = _insert_complaint(conn, ComplaintIn(
            domain="land", node_id=body.node_id, category=body.category,
            text=body.text, image=body.image, duration_days=body.duration_days,
            area_m2=body.area_m2))
        prox = rules_mod.proximity(conn, RULES_CFG, body.node_id,
                                   body.duration_days or 0)
        route = "Sanitation (SwM) officer" if prox["score"] >= 50 else "Ward officer"
        return {**payload, "proximity": prox, "routed_to": route,
                "cross_link": rules_mod._cross_link(conn, body.node_id)}
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# hotspots + daily report
# ---------------------------------------------------------------------------

@app.get("/api/hotspots")
def hotspots():
    conn = db()
    try:
        return {"hotspots": rules_mod.hotspots(conn, RULES_CFG, LIMITS),
                "disclaimer": DISCLAIMER, "data": DATA_LABEL}
    finally:
        conn.close()


@app.post("/api/reports/daily")
def daily_report():
    agent = _agent()
    conn = db()
    try:
        snapshot = _overview(conn)
        return {"text": agent.draft_daily(snapshot), "status": "DRAFT",
                "ai": agent.provider_mode(), "snapshot": snapshot,
                "disclaimer": DISCLAIMER}
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# ask
# ---------------------------------------------------------------------------

class AskIn(BaseModel):
    question: str
    case_id: str | None = None
    history: list[dict] | None = None


@app.post("/api/ask")
def ask_endpoint(body: AskIn):
    from backend.ask import answer
    return answer(body.question, body.case_id, body.history)


# ---------------------------------------------------------------------------
# data + static UI
# ---------------------------------------------------------------------------

IMAGES_DIR = os.path.join(ROOT, "data", "images")
if os.path.isdir(IMAGES_DIR):
    app.mount("/data/images", StaticFiles(directory=IMAGES_DIR), name="images")

_dist = os.path.join(ROOT, "frontend", "dist")
_fallback = os.path.join(ROOT, "frontend_fallback")
_static = _dist if os.path.isdir(_dist) else _fallback
if os.path.isdir(_static):
    app.mount("/", StaticFiles(directory=_static, html=True), name="ui")
