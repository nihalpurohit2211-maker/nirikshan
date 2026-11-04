"""Issue-identity engine, case workflow and proximity scoring (PLAN.md §7.7, §10).

PLACE -> TIME -> BEHAVIOR, with the deterministic tie-break order from §7.7:
(a) most complaints, (b) most severe sensor corroboration, (c) closest to the
plant. Verdicts are computed here, from rules and sensor data — the agent never
decides (§2 rule 13). Clustering is idempotent: the key is (domain, node, scope)
and an action row is appended only when severity/status/evidence changed.

Two documented refinements of §7.7, needed by the seeded scenarios:
  * a ward-level MUNICIPAL case normally needs min_buildings_for_municipal_case
    buildings, but 2 complaints plus corroborating evidence (a limit breach, an
    anomaly flag, or a logged flow change) is enough — the graph, not the count,
    is what identifies the shared cause;
  * a single complaint still opens a case when its category is an escalating
    behaviour (S5: one building, "sewage smell"). Service-only complaints
    (pressure, streetlight) never open a case alone, which is what keeps N0 from
    clustering;
  * PLACE is scoped to the ward (the building's parent zone) before the count
    tie-break is applied. §7.7 picks the shared node with the most complaints,
    and the treatment plant is upstream of every ward, so an unscoped search
    always answers "12 buildings at the plant" and destroys the per-ward
    identity the demo is built on (§1: "5 scattered complaints about one ward
    collapse into 1 case"). Within a ward the shared node is lca(buildings), so
    a junction-level split inside a ward is still found, and the trace out of
    the case still walks up to the old main.
"""

import datetime as dt
import json
import math

ESCALATING_CATEGORIES = (
    "Muddy/turbid water", "Suspected contamination", "Stomach illness reported",
    "Bad smell", "Bad taste", "Open waste dump", "Soil erosion",
)
SUPPLY_LOSS_PHRASES = ("no water", "pressure dropped to zero", "tanker")
STATUS_ORDER = ["Open", "Investigating", "Action Taken", "Resolved"]
# Emergency behaves as Open (§7.7).
STATUS_ALIASES = {"Emergency": "Open", "NEW": "Open"}

ROK = 6371000.0


def haversine_m(lat1, lon1, lat2, lon2):
    """Great-circle distance in metres (stdlib math only)."""
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = p2 - p1
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * ROK * math.asin(min(1.0, math.sqrt(a)))


# ---------------------------------------------------------------------------
# bulk loads (§2 rule 1: no N+1)
# ---------------------------------------------------------------------------

def bulk_latest(conn):
    """node_id -> latest reading dict, in two queries."""
    rows = conn.execute(
        "SELECT r.sensor_id, r.timestamp, r.ph, r.turbidity_ntu, r.tds_mgl,"
        " r.residual_chlorine_mgl FROM readings r JOIN ("
        "   SELECT sensor_id, MAX(timestamp) AS mt FROM readings GROUP BY sensor_id"
        " ) m ON m.sensor_id = r.sensor_id AND m.mt = r.timestamp"
    ).fetchall()
    sensors = {s["id"]: s["node_id"] for s in conn.execute(
        "SELECT id, node_id FROM sensors WHERE kind = 'multi'").fetchall()}
    out = {}
    for r in rows:
        node = sensors.get(r["sensor_id"])
        if node:
            out[node] = {"sensor_id": r["sensor_id"], "timestamp": r["timestamp"],
                         "ph": r["ph"], "turbidity_ntu": r["turbidity_ntu"],
                         "tds_mgl": r["tds_mgl"],
                         "residual_chlorine_mgl": r["residual_chlorine_mgl"]}
    return out


def bulk_series(conn):
    """sensor_id -> [reading dicts] ordered oldest -> newest, in one query."""
    out = {}
    for r in conn.execute(
        "SELECT sensor_id, timestamp, ph, turbidity_ntu, tds_mgl, residual_chlorine_mgl"
        " FROM readings ORDER BY sensor_id, timestamp"
    ).fetchall():
        out.setdefault(r["sensor_id"], []).append(dict(r))
    return out


def bulk_latest_air(conn):
    rows = conn.execute(
        "SELECT a.station_id, a.timestamp, a.pm25, a.pm10, a.no2, a.so2, a.co, a.o3"
        " FROM air_readings a JOIN (SELECT station_id, MAX(timestamp) AS mt"
        "   FROM air_readings GROUP BY station_id) m"
        " ON m.station_id = a.station_id AND m.mt = a.timestamp"
    ).fetchall()
    return {r["station_id"]: dict(r) for r in rows}


def bulk_coliform(conn):
    """node_id -> True/False from the most recent lab test at that node."""
    out = {}
    for r in conn.execute(
        "SELECT node_id, total_coliform, date FROM lab_tests ORDER BY date"
    ).fetchall():
        if r["node_id"]:
            out[r["node_id"]] = str(r["total_coliform"]).upper().startswith("PRESENT")
    return out


def load_descendant_index(conn):
    """node_id -> set of every node downstream of it (water tree), bulk."""
    parent = {r["id"]: r["parent_id"] for r in conn.execute(
        "SELECT id, parent_id FROM nodes WHERE parent_id IS NOT NULL").fetchall()}
    children = {}
    for nid, par in parent.items():
        children.setdefault(par, []).append(nid)
    index = {}
    for start in parent:
        stack, seen = [start], set()
        while stack:
            cur = stack.pop()
            if cur in seen:
                continue
            seen.add(cur)
            stack.extend(children.get(cur, []))
        index[start] = seen
    return index, children, parent


# ---------------------------------------------------------------------------
# severity (§5.3)
# ---------------------------------------------------------------------------

def severity_for(values, coliform, building_count, cfg, limits, supply_loss=False,
                 anomaly_flag=False):
    """Low | Medium | High | Emergency from rules.json wording, computed."""
    from backend import wqi as wqi_mod

    if supply_loss and anomaly_flag:
        return "Emergency"
    permissible = wqi_mod.breaches_permissible(values, coliform, limits)
    if permissible or building_count >= 5:
        return "High"
    acceptable = wqi_mod.breaches_acceptable(values, coliform, limits)
    if acceptable or building_count >= 3:
        return "Medium"
    return "Low"


def corroborated(node_id, latest, series_by_sensor, anomaly_threshold, ops_notes):
    """(breach, flag, detail) — sensor evidence at a candidate shared node."""
    reading = latest.get(node_id)
    flag = False
    z = None
    parameter = None
    if reading:
        sensor_id = reading["sensor_id"]
        series = series_by_sensor.get(sensor_id, [])
        if series:
            from backend import anomaly as anomaly_mod
            res = anomaly_mod.detect(series, anomaly_threshold)
            flag = bool(res["flag"])
            z = res["z"]
            parameter = res["parameter"]
    note = ops_notes.get(node_id)
    return {"breach": bool(reading), "anomaly_flag": flag, "z": z,
            "parameter": parameter, "ops_note": note}


def _rank_score(evidence, values, limits, coliform):
    """How strongly a node's sensors corroborate a breach — tie-break (b) of §7.7."""
    score = 0.0
    if evidence["z"] is not None:
        score += abs(evidence["z"])
    if values:
        from backend import wqi as wqi_mod
        idx = wqi_mod.compute(values, coliform, limits)
        score += idx["score"] / 10.0
    if evidence["ops_note"]:
        score += 1.0
    return score


# ---------------------------------------------------------------------------
# clustering (§7.7)
# ---------------------------------------------------------------------------

def cluster(conn, cfg, limits, aqi_cfg=None):
    """Run the identity engine. Idempotent: returns {"created": [...], "updated": [...]}."""
    from backend import graph as graph_mod
    from backend import wqi as wqi_mod

    cl = cfg["clustering"]
    window_h = cl["window_hours"]
    parent, children, nodes, pipes_by_to = graph_mod.load_graph(conn)
    graph_mod.set_node_types(nodes)
    latest = bulk_latest(conn)
    series_by_sensor = bulk_series(conn)
    coliform = bulk_coliform(conn)
    ops_notes = {r["node_id"]: r["result"] for r in conn.execute(
        "SELECT node_id, result FROM maintenance_checks"
        " WHERE check_type IN ('flow_changed','burst_reported','inspection')"
        " ORDER BY date").fetchall()}
    now_str = conn.execute("SELECT MAX(timestamp) AS t FROM readings").fetchone()["t"]
    now = dt.datetime.strptime(now_str, "%Y-%m-%d %H:%M:%S")
    cutoff = now - dt.timedelta(hours=window_h)
    threshold = cfg["anomaly"]["z_threshold"]

    complaints = [dict(r) for r in conn.execute(
        "SELECT * FROM complaints ORDER BY timestamp, id").fetchall()]
    active = [c for c in complaints
              if dt.datetime.strptime(c["timestamp"], "%Y-%m-%d %H:%M:%S") >= cutoff]

    created, updated = [], []

    # ---------------- water: PLACE (shared upstream node) -> TIME -> BEHAVIOR
    water = [c for c in active if c["domain"] == "water" and c["node_id"]]
    wards = {}
    for c in water:
        wards.setdefault(parent.get(c["node_id"]) or c["node_id"], []).append(c)

    remaining = []
    # tie-break (a): the ward with the most complaints is identified first.
    # §7.7 step 1: the shared node is lca(buildings) — the deepest (most
    # specific) node upstream of the complaining buildings. Each ward therefore
    # yields exactly one candidate, and the three tie-breaks order those
    # candidates: (a) most complaints, (b) most severe corroboration, (c) closest
    # to the plant.
    candidates = []
    for ward in sorted(wards):
        group = wards[ward]
        gb = sorted({c["node_id"] for c in group})
        if len(gb) < 2:
            remaining.extend(group)          # singletons: BUILDING_SIDE branch below
            continue
        cand = graph_mod.lca(gb, parent)
        node = nodes.get(cand)
        if node is None or node["type"] not in ("zone", "junction", "pump",
                                                "reservoir", "treatment_plant"):
            remaining.extend(group)
            continue
        evidence = corroborated(cand, latest, series_by_sensor, threshold, ops_notes)
        values = latest.get(cand)
        col = coliform.get(cand)
        breach = _breaching(values, col, limits)
        municipal_enough = len(gb) >= cl["min_buildings_for_municipal_case"]
        if not municipal_enough and not (breach or evidence["anomaly_flag"]
                                        or evidence["ops_note"]):
            remaining.extend(group)
            continue
        candidates.append({
            "ward": ward, "cand": cand, "group": group, "gb": gb,
            "evidence": evidence, "values": values, "col": col,
            "rank": (-len(group),
                     -_rank_score(evidence, values, limits, col),
                     len(graph_mod.chain(cand, parent))),
        })

    for cand_info in sorted(candidates, key=lambda c: c["rank"]):
        cand, group, gb = cand_info["cand"], cand_info["group"], cand_info["gb"]
        ward = cand_info["ward"]
        values, col, evidence = cand_info["values"], cand_info["col"], cand_info["evidence"]
        texts = " ".join((c["text"] or "").lower() for c in group)
        supply_loss = any(p in texts for p in SUPPLY_LOSS_PHRASES) and all(
            c["category"] == "No/low pressure" for c in group)
        severity = severity_for(values or {}, col, len(gb), cfg, limits,
                                supply_loss=supply_loss,
                                anomaly_flag=evidence["anomaly_flag"])
        scope = "MUNICIPAL"
        title = "Shared upstream cause at %s (%d buildings)" % (
            nodes[cand]["name"], len(gb))
        if supply_loss:
            title = "Supply loss on the %s branch" % nodes[cand]["name"]
        wq = wqi_mod.compute(values or {}, col, limits) if values else None
        evidence_json = build_evidence(
            conn, cfg, group, cand, gb, values, limits, wq, evidence, col,
            rule="PLACE ward %s -> shared upstream node lca(buildings) -> TIME within"
                 " %dh -> BEHAVIOR sensors %s"
                 % (ward, window_h, "corroborate" if (evidence["anomaly_flag"] or
                        _breaching(values, col, limits)) else "normal"))
        case, is_new = upsert_case(conn, domain="water", node_id=cand, scope=scope,
                                   status="Open", severity=severity, title=title,
                                   evidence=evidence_json, now=now_str)
        (created if is_new else updated).append(case)

    # single water complaints: escalating behaviour -> BUILDING_SIDE, else no case
    for c in remaining:
        if c["category"] not in ESCALATING_CATEGORIES:
            continue
        node_id = c["node_id"]
        ward = parent.get(node_id)
        values = latest.get(ward)
        if values is None:
            continue
        col = coliform.get(ward)
        if _sibling_status(values, col, cl) != "normal":
            continue          # the ward itself is breaching: handled above / elsewhere
        evidence_json = build_evidence(conn, cfg, [c], node_id, [node_id], values,
                                       limits, wqi_mod.compute(values, col, limits),
                                       corroborated(ward, latest, series_by_sensor,
                                                    threshold, ops_notes),
                                       col,
                                       rule="PLACE single building -> BEHAVIOR escalating"
                                            " category with siblings and ward sensor"
                                            " inside limits -> BUILDING_SIDE")
        case, is_new = upsert_case(
            conn, domain="water", node_id=node_id, scope="BUILDING_SIDE",
            status="Open", severity="Low",
            title="Building-side report at %s" % nodes[node_id]["name"],
            evidence=evidence_json, now=now_str)
        (created if is_new else updated).append(case)

    # ---------------- air: same station, or same ward with a corroborated AQI
    air = [c for c in active if c["domain"] == "air" and c["node_id"]]
    air_latest = bulk_latest_air(conn)
    by_station = {}
    for c in air:
        by_station.setdefault(c["node_id"], []).append(c)
    stations_seen = set()
    for station in sorted(by_station):
        if station in stations_seen:
            continue
        group = list(by_station[station])
        node = nodes[station]
        ward = node["zone_id"]
        for other in sorted(by_station):
            if other == station or other in stations_seen:
                continue
            if nodes[other]["zone_id"] == ward and _air_breaches(
                    air_latest.get(other), aqi_cfg):
                group.extend(by_station[other])
                stations_seen.add(other)
        if len(group) < 2 and not _air_breaches(air_latest.get(station), aqi_cfg):
            continue
        if len(group) < 2:
            continue      # a lone non-breaching air report is not an issue identity
        stations_seen.add(station)
        worst = max(group, key=lambda c: (_air_aqi(air_latest.get(c["node_id"]), aqi_cfg) or 0))
        target = worst["node_id"]
        aqi_val = _air_aqi(air_latest.get(target), aqi_cfg)
        severity = "High" if (aqi_val or 0) >= 301 else ("Medium" if (aqi_val or 0) >= 101 else "Low")
        evidence_json = {
            "complaints": [c["id"] for c in group],
            "shared_node": target,
            "rule": "PLACE same station or same ward receptor -> TIME within %dh"
                    " -> BEHAVIOR NAQI sub-index" % window_h,
            "readings": {k: v for k, v in (air_latest.get(target) or {}).items()},
            "limits": {"categories": aqi_cfg["categories"] if aqi_cfg else None},
            "confidence": 0.75,
            "aqi": aqi_val,
        }
        case, is_new = upsert_case(
            conn, domain="air", node_id=target, scope="MUNICIPAL", status="Open",
            severity=severity,
            title="Dust / PM episode around %s" % nodes[target]["name"],
            evidence=evidence_json, now=now_str)
        (created if is_new else updated).append(case)

    # ---------------- land: same site or within land_proximity_m
    land = [c for c in active if c["domain"] == "land" and c["node_id"]]
    used = set()
    for c in land:
        if c["id"] in used or c["category"] not in ESCALATING_CATEGORIES:
            continue
        group = [c]
        used.add(c["id"])
        a = nodes[c["node_id"]]
        for other in land:
            if other["id"] in used or other["category"] not in ESCALATING_CATEGORIES:
                continue
            b = nodes[other["node_id"]]
            if haversine_m(a["lat"], a["lon"], b["lat"], b["lon"]) <= cl["land_proximity_m"]:
                group.append(other)
                used.add(other["id"])
        prox = proximity(conn, cfg, c["node_id"],
                         max(k["duration_days"] or 0 for k in group))
        evidence_json = {
            "complaints": [k["id"] for k in group],
            "shared_node": c["node_id"],
            "rule": "PLACE same site or within %dm -> TIME within %dh -> BEHAVIOR"
                    " dump/erosion report" % (cl["land_proximity_m"], window_h),
            "readings": {"duration_days": c["duration_days"], "area_m2": c["area_m2"]},
            "limits": {"proximity": cfg.get("land_proximity")},
            "confidence": 0.7,
            "proximity": prox,
            "cross_link": _cross_link(conn, c["node_id"]),
        }
        case, is_new = upsert_case(
            conn, domain="land", node_id=c["node_id"], scope="MUNICIPAL", status="Open",
            severity="Medium" if prox["score"] >= 50 else "Low",
            title="%s at %s" % (c["category"], a["name"]),
            evidence=evidence_json, now=now_str)
        (created if is_new else updated).append(case)

    conn.commit()
    return {"created": created, "updated": updated, "demo_now": now_str}


def _breaching(values, coliform, limits):
    from backend import wqi as wqi_mod
    if not values:
        return False
    return bool(wqi_mod.breaches_permissible(values, coliform, limits)
                or wqi_mod.breaches_acceptable(values, coliform, limits))


def _air_aqi(reading, aqi_cfg):
    if reading is None or aqi_cfg is None:
        return None
    from backend import aqi as aqi_mod
    return aqi_mod.compute({k: reading.get(k) for k in
                            ("pm25", "pm10", "no2", "so2", "co", "o3")}, aqi_cfg)["value"]


def _air_breaches(reading, aqi_cfg):
    """A station counts as corroborating evidence at Moderate (101) and above."""
    val = _air_aqi(reading, aqi_cfg)
    return val is not None and val >= 101


def _sibling_status(values, coliform, cl):
    tol = cl["sibling_normal_tolerance"]
    if values.get("turbidity_ntu") is not None and \
       values["turbidity_ntu"] > tol["turbidity_ntu_max"]:
        return "turbidity breach"
    if values.get("residual_chlorine_mgl") is not None and \
       values["residual_chlorine_mgl"] < tol["chlorine_mgl_min"]:
        return "chlorine breach"
    if coliform:
        return "coliform present"
    return "normal"


def build_evidence(conn, cfg, group, shared_node, buildings, values, limits, wq,
                   evidence, coliform, rule):
    cl = cfg["clustering"]
    return {
        "complaints": [c["id"] for c in group],
        "shared_node": shared_node,
        "buildings": buildings,
        "rule": rule,
        "readings": {k: v for k, v in (values or {}).items() if k != "sensor_id"},
        "limits": limits["parameters"],
        "wqi": wq,
        "coliform": coliform,
        "anomaly": evidence,
        "sibling_status": _sibling_status(values or {}, coliform, cl),
        "confidence": _confidence(len(buildings), evidence, wq),
        "flow_changed": evidence.get("ops_note"),
    }


def _confidence(building_count, evidence, wq):
    """Transparent, deterministic: graph reach + corroboration + population."""
    score = 0.4
    score += min(0.2, 0.05 * building_count)
    if evidence.get("anomaly_flag"):
        score += 0.2
    if evidence.get("ops_note"):
        score += 0.1
    if wq and wq["override"]:
        score += 0.1
    return round(min(0.95, score), 2)


# ---------------------------------------------------------------------------
# case persistence (§7.7 idempotency, status whitelist)
# ---------------------------------------------------------------------------

def upsert_case(conn, domain, node_id, scope, status, severity, title, evidence, now):
    """Insert or update by (domain, node_id, scope). Actions only on real change."""
    from backend.db import next_id
    existing = conn.execute(
        "SELECT * FROM cases WHERE domain = ? AND node_id = ? AND scope = ?"
        " AND status != 'Resolved' ORDER BY id LIMIT 1",
        (domain, node_id, scope)).fetchone()
    payload = json.dumps(evidence, sort_keys=True)
    if existing is None:
        cid = next_id(conn, "case")
        conn.execute(
            "INSERT INTO cases(id, domain, node_id, scope, status, severity, title,"
            " created_at, updated_at, evidence_json) VALUES (?,?,?,?,?,?,?,?,?,?)",
            (cid, domain, node_id, scope, status, severity, title, now, now, payload))
        _log(conn, cid, now, "Nirikshan engine", "Automated system", "Case opened",
             "Clustering created this case from %d complaint(s) sharing %s"
             % (len(evidence.get("complaints", [])), node_id))
        row = conn.execute("SELECT * FROM cases WHERE id = ?", (cid,)).fetchone()
        return dict(row), True
    changed = (existing["severity"] != severity) or (existing["evidence_json"] != payload)
    conn.execute(
        "UPDATE cases SET severity = ?, title = ?, evidence_json = ?,"
        " updated_at = ? WHERE id = ?",
        (severity, title, payload, now, existing["id"]))
    if changed:
        _log(conn, existing["id"], now, "Nirikshan engine", "Automated system",
             "Evidence refreshed",
             "Severity %s -> %s; evidence recomputed from current readings"
             % (existing["severity"], severity))
    row = conn.execute("SELECT * FROM cases WHERE id = ?", (existing["id"],)).fetchone()
    return dict(row), False


def _log(conn, case_id, timestamp, actor, role, action, note):
    from backend.db import next_id
    aid = next_id(conn, "action")
    conn.execute(
        "INSERT INTO case_actions(id, case_id, timestamp, actor, role, action, note)"
        " VALUES (?,?,?,?,?,?,?)", (aid, case_id, timestamp, actor, role, action, note))
    return aid


def transition_ok(current, new):
    """§7.7 whitelist: Open -> Investigating -> Action Taken -> Resolved.

    Emergency behaves as Open. Any other pair is refused (HTTP 400, no write).
    """
    cur = STATUS_ALIASES.get(current, current)
    if new not in STATUS_ORDER:
        return False
    if cur not in STATUS_ORDER:
        return False
    return STATUS_ORDER.index(new) == STATUS_ORDER.index(cur) + 1


def is_overdue(case, actions, now_str, cfg):
    """Escalation (§5.3): High/Emergency with no action for 2+ hours."""
    esc = cfg.get("escalation", {})
    if not esc.get("enabled"):
        return False
    if case["severity"] not in ("High", "Emergency"):
        return False
    hours = float(esc.get("high_severity_no_action_hours", 2))
    stamps = [a["timestamp"] for a in actions if a["timestamp"]]
    last = max(stamps) if stamps else case["created_at"]
    if not last:
        return False
    fmt = "%Y-%m-%d %H:%M:%S"
    delta = (dt.datetime.strptime(now_str, fmt) - dt.datetime.strptime(last, fmt)
             ).total_seconds() / 3600.0
    return delta > hours


# ---------------------------------------------------------------------------
# land proximity (§10) and hotspots (§9.5)
# ---------------------------------------------------------------------------

def proximity(conn, cfg, node_id, duration_days=None):
    """score = 30 school + 30 water body + 20 main road + 20 duration >= 7 days."""
    lp = cfg["land_proximity"]
    node = conn.execute("SELECT * FROM nodes WHERE id = ?", (node_id,)).fetchone()
    if node is None:
        return {"score": 0, "factors": []}
    if duration_days is None:
        row = conn.execute("SELECT MAX(duration_days) AS d FROM complaints"
                           " WHERE node_id = ?", (node_id,)).fetchone()
        duration_days = row["d"] or 0
    factors = []
    nearest = {}
    for f in conn.execute("SELECT * FROM features ORDER BY id").fetchall():
        d = haversine_m(node["lat"], node["lon"], f["lat"], f["lon"])
        if f["kind"] not in nearest or d < nearest[f["kind"]]["distance_m"]:
            nearest[f["kind"]] = {"feature": f["name"], "kind": f["kind"],
                                  "distance_m": round(d, 1)}
    def push(kind, limit_m, points, label):
        info = nearest.get(kind)
        hit = bool(info) and info["distance_m"] <= limit_m
        factors.append({"label": label, "kind": kind, "within_m": limit_m,
                        "nearest": info, "points": points if hit else 0,
                        "met": hit})
        return points if hit else 0
    score = 0
    score += push("school", lp["school_m"], lp["w_school"], "Within %d m of a school"
                  % lp["school_m"])
    score += push("water_body", lp["water_body_m"], lp["w_water"],
                  "Within %d m of a water body" % lp["water_body_m"])
    score += push("main_road", lp["main_road_m"], lp["w_road"],
                  "Within %d m of a main road" % lp["main_road_m"])
    dur_hit = bool(duration_days) and duration_days >= lp["w_duration_days"]
    factors.append({"label": "Standing for %d+ days" % lp["w_duration_days"],
                    "kind": "duration", "days": duration_days,
                    "points": lp["w_duration"] if dur_hit else 0, "met": dur_hit})
    score += lp["w_duration"] if dur_hit else 0
    return {"score": min(lp["cap"], score), "factors": factors}


def _cross_link(conn, node_id):
    """S8: land -> water link, and the linked node's current turbidity trend."""
    row = conn.execute("SELECT linked_water_node FROM land_meta WHERE node_id = ?",
                       (node_id,)).fetchone()
    if not row or not row["linked_water_node"]:
        return None
    water = row["linked_water_node"]
    trend = conn.execute(
        "SELECT turbidity_ntu FROM readings WHERE sensor_id = ?"
        " ORDER BY timestamp DESC LIMIT 25", ("S_" + water,)).fetchall()
    if not trend:
        return {"water_node": water, "trend": None}
    recent = [r["turbidity_ntu"] for r in trend][::-1]
    first = sum(recent[:6]) / len(recent[:6])
    last = sum(recent[-6:]) / len(recent[-6:])
    return {"water_node": water, "trend": round(last - first, 3),
            "direction": "rising" if last > first else "falling"}


def hotspots(conn, cfg, limits):
    """Ranked wards/stations with a factor breakdown (§9.5)."""
    from backend import wqi as wqi_mod
    from backend.db import demo_now

    latest = bulk_latest(conn)
    coliform = bulk_coliform(conn)
    cases = [dict(r) for r in conn.execute(
        "SELECT * FROM cases WHERE status != 'Resolved'").fetchall()]
    window_h = cfg["clustering"]["window_hours"]
    rows = conn.execute("SELECT * FROM nodes WHERE type = 'zone' ORDER BY id").fetchall()
    desc_index, _c, _p = load_descendant_index(conn)
    now_str = demo_now(conn)
    out = []
    severity_points = {"Emergency": 30, "High": 25, "Medium": 15, "Low": 5}
    for z in rows:
        node_id = z["id"]
        values = latest.get(node_id)
        col = coliform.get(node_id)
        wq = wqi_mod.compute(values, col, limits) if values else None
        downstream = desc_index.get(node_id, set()) | {node_id}
        zone_cases = [c for c in cases if c["node_id"] in downstream]
        comps = conn.execute(
            "SELECT COUNT(*) AS n FROM complaints WHERE domain = 'water'"
            " AND node_id IN (SELECT id FROM nodes WHERE zone_id = ?)"
            " AND timestamp >= datetime(?, ?)",
            (node_id, now_str, "-%d hours" % window_h)).fetchone()["n"]
        factors = {
            "wqi": round(wq["score"], 1) if wq else 0,
            "open_cases": len(zone_cases),
            "severity": max((severity_points.get(c["severity"], 0) for c in zone_cases),
                            default=0),
            "complaints_24h": comps,
        }
        score = (factors["wqi"] * 0.5 + min(30, factors["complaints_24h"] * 6)
                 + factors["severity"] + min(20, factors["open_cases"] * 10))
        out.append({"node_id": node_id, "name": z["name"], "score": round(score, 1),
                    "band": wq["band"] if wq else None, "factors": factors,
                    "cases": [c["id"] for c in zone_cases]})
    out.sort(key=lambda r: (-r["score"], r["node_id"]))
    return out
