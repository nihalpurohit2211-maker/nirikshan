"""Forecasting + the pipe physics helpers (PLAN.md §6.3, §7.6).

`decay_k`, `travel_h`, `residence_h` and `step` are the single source of truth
for the §6.3 hydraulic model: `seed.py` imports them to build the city, and the
forecast uses the same k when it falls back to physics decay. That keeps the
seed and the API from ever disagreeing about the physics.

S4 is built so the trend branch is exact: zone_5 chlorine ramps linearly from
0.315 (NOW-48h) to 0.235 (NOW) -> slope -0.0016667/h -> crossing of the 0.2
process-control minimum at t = 21.0 h.
"""

import json
import math
import os

REFERENCE_YEAR = 2026            # §6.3: age is measured against 2026
WALL_DEMAND_MATERIALS = ("GI", "CI", "MS")
_RULES_CACHE = {}


def load_rules(path=None):
    """Read config/rules.json (used when a caller does not pass validated config)."""
    global _RULES_CACHE
    if _RULES_CACHE:
        return _RULES_CACHE
    if path is None:
        root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        path = os.path.join(root, "config", "rules.json")
    with open(path, "r", encoding="utf-8") as fh:
        _RULES_CACHE = json.load(fh)
    return _RULES_CACHE


# --------------------------------------------------------------------------
# §6.3 hydraulic model
# --------------------------------------------------------------------------

RESIDENCE_H = {"reservoir": 1.2, "pump": 0.2, "junction": 0.2,
               "zone": 0.4, "building": 0.5}


def velocity_ms(diameter_mm):
    return 0.9 if diameter_mm >= 200 else 0.6


def travel_h(length_m, diameter_mm):
    return (length_m / velocity_ms(diameter_mm)) / 3600.0


def residence_h(node_type):
    return RESIDENCE_H.get(node_type, 0.0)


def decay_k(diameter_mm, install_year, material):
    """First-order decay constant per hour (§6.3), capped at 0.40."""
    k = 0.03 + 0.0022 * (REFERENCE_YEAR - install_year)      # age effect
    if material in WALL_DEMAND_MATERIALS:
        k += 0.05                                            # wall demand
    k += 0.10 * (150.0 / max(diameter_mm, 50))               # small pipe effect
    return min(k, 0.40)


def step_dt(pipe, child_type):
    return travel_h(pipe["length_m"], pipe["diameter_mm"]) + residence_h(child_type)


def step(parent, pipe, child_type):
    """One hop downstream: returns (chlorine, turbidity, age_h).

    `parent` = {"chlorine","turbidity","age_h"}; `pipe` = dict with length_m,
    diameter_mm, install_year, material.
    """
    dt = step_dt(pipe, child_type)
    k = decay_k(pipe["diameter_mm"], pipe["install_year"], pipe["material"])
    chlorine = parent["chlorine"] * math.exp(-k * dt)
    turbidity = parent["turbidity"] + 0.08 + (0.12 if REFERENCE_YEAR - pipe["install_year"] > 25 else 0.0)
    return chlorine, turbidity, parent["age_h"] + dt


# --------------------------------------------------------------------------
# §7.6 chlorine forecast
# --------------------------------------------------------------------------

def _nearest(series, target_ts):
    """series: {timestamp: value} ordered oldest -> newest. Exact hit preferred,
    otherwise the closest timestamp (readings are contiguous hourly)."""
    if not series:
        return None
    if target_ts in series:
        return series[target_ts]
    best_ts, best_gap = None, None
    goal = _ts_minutes(target_ts)
    for ts in series:
        gap = abs(_ts_minutes(ts) - goal)
        if best_gap is None or gap < best_gap:
            best_ts, best_gap = ts, gap
    return series[best_ts] if best_ts else None


def _ts_minutes(ts):
    """Minutes since an arbitrary epoch, from 'YYYY-MM-DD HH:MM:SS' (stdlib only)."""
    y, mo, d = int(ts[0:4]), int(ts[5:7]), int(ts[8:10])
    h, mi = int(ts[11:13]), int(ts[14:16])
    days = (y * 365) + (y // 4) + mo * 31 + d
    return days * 1440 + h * 60 + mi


def forecast_chlorine(conn, node_id, rules_cfg=None):
    """§7.6 exactly. Returns {"current","breached_now","crossing_hours","projected",...}."""
    cfg = rules_cfg or load_rules()
    minimum = cfg["forecast"]["chlorine_minimum_mgl"]
    horizon = int(cfg["forecast"]["horizon_hours"])

    sensor = conn.execute(
        "SELECT id FROM sensors WHERE node_id = ? AND kind = 'multi'", (node_id,)
    ).fetchone()
    if sensor is None:
        return None
    rows = {r["timestamp"]: r["v"] for r in conn.execute(
        "SELECT timestamp, residual_chlorine_mgl AS v FROM readings "
        "WHERE sensor_id = ? ORDER BY timestamp", (sensor["id"],)
    ).fetchall() if r["v"] is not None}
    if len(rows) < 3:
        return None
    now_ts = max(rows)
    c_now = rows[now_ts]

    def at(hours_back):
        return _nearest(rows, _shift(now_ts, -hours_back))

    c_24 = at(24)
    c_48 = at(48)
    if c_48 is None or c_24 is None:
        return None
    slope = (c_now - c_48) / 48.0

    if slope < 0 and c_now < c_24 < c_48:
        method = "trend"
        def proj(t):
            return c_now + slope * t
    else:
        method = "physics"
        pipe = conn.execute(
            "SELECT * FROM pipes WHERE to_node = ? ORDER BY id LIMIT 1", (node_id,)
        ).fetchone()
        if pipe is None:
            return None
        k = decay_k(pipe["diameter_mm"], pipe["install_year"], pipe["material"])
        def proj(t):
            return c_now * math.exp(-k * t)

    projected = [round(max(0.0, proj(t)), 4) for t in range(horizon + 1)]
    eps = 1e-9
    crossing = None
    for t in range(horizon + 1):
        if proj(t) <= minimum + eps:
            crossing = t
            break
    return {
        "node_id": node_id,
        "sensor_id": sensor["id"],
        "parameter": "residual_chlorine_mgl",
        "current": round(c_now, 4),
        "c_24": round(c_24, 4),
        "c_48": round(c_48, 4),
        "slope_per_hour": round(slope, 6),
        "method": method,
        "limit": minimum,
        "horizon_hours": horizon,
        "breached_now": c_now < minimum,
        "crossing_hours": crossing,
        "projected": projected,
    }


def _shift(ts, hours):
    """'YYYY-MM-DD HH:MM:SS' shifted by whole hours (stdlib only)."""
    import datetime as _dt
    base = _dt.datetime.strptime(ts, "%Y-%m-%d %H:%M:%S") + _dt.timedelta(hours=hours)
    return base.strftime("%Y-%m-%d %H:%M:%S")


def forecast_pm(conn, station_id, rules_cfg=None, column="pm25", window_hours=6):
    """24 h PM forecast for the Air page (§9.5). Damped persistence of the
    recent trend; clamped at 0. Labelled a demo approximation in the UI."""
    cfg = rules_cfg or load_rules()
    horizon = int(cfg["forecast"]["horizon_hours"])
    rows = [dict(r) for r in conn.execute(
        "SELECT timestamp, {col} AS v FROM air_readings WHERE station_id = ? "
        "ORDER BY timestamp".format(col=column), (station_id,)
    ).fetchall() if r["v"] is not None]
    if len(rows) < window_hours + 1:
        return None
    recent = [r["v"] for r in rows[-window_hours:]]
    current = rows[-1]["v"]
    slope = (recent[-1] - recent[0]) / max(1, len(recent) - 1)
    damping = 0.85
    projected, val, cum = [round(current, 1)], current, 0.0
    for t in range(1, horizon + 1):
        cum += slope * (damping ** t)
        val = max(0.0, current + cum)
        projected.append(round(val, 1))
    return {
        "station_id": station_id,
        "parameter": column,
        "current": round(current, 1),
        "slope_per_hour": round(slope, 3),
        "horizon_hours": horizon,
        "projected": projected,
    }
