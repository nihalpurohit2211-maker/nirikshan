"""Nirikshan deterministic seed — PLAN.md §6.2-§6.6.

The fictional city of Nagar: 5 wards, a tree-shaped water network, 10 air
stations, 12 land sites, 14 days of hourly readings, and the planted scenarios
S1-S8 plus N0 (the normal day that must never cluster).

Determinism (§2 rule 7, §6.2):
  * every draw comes from random.Random(42) or random.Random(42000 + sensor_index);
  * NOW is the fixed datetime 2026-11-03 09:00:00 — no time.time(), no wall clock;
  * the trunk/feed pipe table is hand-authored, because §6.7 pins the demo
    numbers and §6.8 allows only this file to move them.

Run:  PY seed.py   then   PY verify_seed.py
"""

import datetime as dt
import json
import math
import os
import random
import sqlite3

from backend.db import connect, next_id
from backend.forecast import decay_k, travel_h, residence_h

ROOT = os.path.dirname(os.path.abspath(__file__))
SCHEMA_PATH = os.path.join(ROOT, "schema.sql")

NOW = dt.datetime(2026, 11, 3, 9, 0, 0)                     # §6.4 demo clock
HOURS = 336                                                 # 14 days, hourly
STEP = dt.timedelta(hours=1)
SERIES = [NOW - STEP * (HOURS - 1 - i) for i in range(HOURS)]   # ends exactly at NOW

TS_FMT = "%Y-%m-%d %H:%M:%S"
rng = random.Random(42)                                     # §6.2: the city


def ts(moment):
    return moment.strftime(TS_FMT)


def back(hours):
    return NOW - dt.timedelta(hours=hours)


def frac(moment, start, span_h):
    """0..1 position of `moment` inside a scenario window."""
    v = (moment - start).total_seconds() / 3600.0 / span_h
    return max(0.0, min(1.0, v))


# ===========================================================================
# 1. Nodes (§6.2). Water network is a tree: source -> plant -> reservoir ->
#    pump -> junction -> (junction) -> ward -> building.
# ===========================================================================

SOURCES = [
    ("src_river", "Pravara River Intake", 19.008, 72.858),
    ("src_lake", "Nisang Lake Intake", 19.002, 72.912),
    ("src_bore_a", "Sector 4 Borewell Cluster", 19.011, 72.872),
    ("src_bore_b", "Madhapur Borewell Cluster", 19.004, 72.925),
]
PLANTS = [
    ("plant_n", "Gokhshi Water Treatment Plant (North)", 19.014, 72.864, "src_river"),
    ("plant_s", "Jubilee Water Treatment Plant (South)", 19.007, 72.918, "src_lake"),
]
RESERVOIRS = [
    ("res_hill", "Doongar Hill Reservoir", 19.026, 72.861, "plant_n"),
    ("res_tower", "Fountain Tower Reservoir", 19.031, 72.878, "plant_n"),
    ("res_east", "Khawani East Reservoir", 19.024, 72.931, "plant_s"),
]
PUMPS = [
    ("pump_1", "Doongar Hill Booster Pump", 19.033, 72.866, "res_hill"),
    ("pump_2", "Fountain Booster Pump", 19.038, 72.881, "res_tower"),
    ("pump_3", "Khawani Booster Pump", 19.030, 72.926, "res_east"),
]
JUNCTIONS = [
    ("J01", "Bungalow Junction", 19.043, 72.884, "pump_2"),
    ("J02", "Market Yard Junction", 19.037, 72.868, "pump_1"),
    ("J03", "Khadki Old Junction", 19.042, 72.871, "J02"),
    ("J04", "Datta Mandir Junction", 19.047, 72.874, "J03"),
    ("J05", "Ring Road Junction", 19.044, 72.889, "pump_2"),
    ("J06", "Mill Compound Junction", 19.041, 72.893, "pump_2"),
    ("J07", "Plateau Tee", 19.049, 72.892, "J05"),
    ("J08", "Nandi Tee", 19.046, 72.922, "pump_3"),
    ("J09", "Gulmohar Tee", 19.041, 72.918, "pump_3"),
    ("J10", "Printers Road Junction", 19.045, 72.897, "J06"),
    ("J11", "Old Town Dead-end", 19.051, 72.876, "J04"),
    ("J12", "Quarry Road Dead-end", 19.038, 72.914, "J09"),
    ("J13", "Tannery Dead-end", 19.039, 72.864, "J02"),
    ("J14", "Nullah Dead-end", 19.052, 72.895, "J07"),
]
ZONES = [
    ("zone_1", "Ward 1 - Bungalow Road", 19.048, 72.886, "J01"),
    ("zone_2", "Ward 2 - Ring Road", 19.048, 72.890, "J05"),
    ("zone_3", "Ward 3 - Khadki Old Town", 19.051, 72.874, "J04"),
    ("zone_4", "Ward 4 - Plateau", 19.053, 72.893, "J07"),
    ("zone_5", "Ward 5 - Gulmohar", 19.044, 72.920, "J08"),
]
AIR_STATIONS = [
    ("air_01", "Bungalow Road Monitor", 19.046, 72.883, "zone_1"),
    ("air_02", "Mill Compound Monitor", 19.042, 72.895, "zone_1"),
    ("air_03", "Flyover Traffic Monitor", 19.049, 72.888, "zone_2"),
    ("air_04", "Market Yard Monitor", 19.036, 72.869, "zone_2"),
    ("air_05", "Old Town Monitor", 19.052, 72.872, "zone_3"),
    ("air_06", "School Ground Monitor", 19.050, 72.879, "zone_3"),
    ("air_07", "Construction Belt Monitor A", 19.055, 72.891, "zone_4"),
    ("air_08", "Construction Belt Monitor B", 19.057, 72.896, "zone_4"),
    ("air_09", "Gulmohar Park Monitor", 19.043, 72.916, "zone_5"),
    ("air_10", "Quarry Road Monitor", 19.039, 72.913, "zone_5"),
]
LAND_SITES = [
    # id, name, lat, lon, ward, land_type, linked_water_node, note
    ("land_01", "Nullah Corner Backlog", 19.054, 72.897, "zone_4", "open_waste", None,
     "Construction debris piled along the nullah wall."),
    ("land_02", "Mill Compound Fill", 19.041, 72.894, "zone_1", "other", None,
     "Idle plot used for nightly household refuse."),
    ("land_03", "Plateau Construction Plot", 19.0560, 72.8935, "zone_4", "other", None,
     "Deep excavation; the dust source behind air_07 and air_08."),
    ("land_04", "Old Town Lane Backlog", 19.0515, 72.8735, "zone_3", "open_waste", None,
     "Refuse not lifted for three weeks."),
    ("land_05", "School Ground Dump", 19.0492, 72.8808, "zone_3", "open_waste", None,
     "Unsecured dump beside the municipal school and the nallah."),
    ("land_06", "Tannery Perimeter Spill", 19.0385, 72.8645, "zone_2", "other", None,
     "Spent sludge left along the compound wall."),
    ("land_07", "Hill Cut Face", 19.0275, 72.8615, "zone_1", "soil_erosion", None,
     "Unstabilised slope above the intake road."),
    ("land_08", "Ring Road Verge Dump", 19.0475, 72.8905, "zone_2", "open_waste", None,
     "Verge dumping under the flyover."),
    ("land_09", "Reservoir Intake Erosion", 19.0268, 72.8622, "zone_1", "soil_erosion",
     "res_hill", "Monsoon gully washing silt toward the reservoir intake channel."),
    ("land_10", "Gulmohar Backlog", 19.0435, 72.9175, "zone_5", "other", None,
     "Plot-edge accumulation."),
    ("land_11", "Quarry Road Spoil", 19.0388, 72.9145, "zone_5", "soil_erosion", None,
     "Spoil heap sliding toward the drain."),
    ("land_12", "Empty Plot, Lane 7", 19.0455, 72.8885, "zone_1", "other", None,
     "Open plot with a failed streetlight; maintenance, not environmental."),
]

# B11 is a Ward 1 building (S5 needs "siblings + zone_1 sensor normal") and
# B21..B25 are the five Ward 3 societies that raise the hero complaints.
ZONE_BUILDINGS = {
    "zone_1": ["B%02d" % i for i in range(2, 12)],           # 10, includes B11
    "zone_2": ["B%02d" % i for i in range(12, 21)],          # 9
    "zone_3": ["B%02d" % i for i in range(21, 30)],          # 9 (S1 uses B21..B25)
    "zone_4": ["B%02d" % i for i in range(30, 39)],          # 9
    "zone_5": ["B01"] + ["B%02d" % i for i in range(39, 46)],  # 8
}

SOCIETY_NAMES = [
    "Shanti Sadan", "Gokhshi Residency", "Sneh Sagar CHSL", "Marigold Towers",
    "Tulip Heights", "Om Sai Nagar", "Vijay Tenements", "Kaveri Apartments",
    "Sunbeam CHS", "Green Acres Residency", "Indralok Society", "Shivshakti CHSL",
    "Bharat Vilas", "Nandanvan CHS", "Lakeview Terrace", "Panchsheel Nagar",
    "Zurian Tenements", "Pratham Society", "Asha Dham", "Vrindavan CHSL",
    "Madhukor Apartments", "Rajlaxmi Residency", "Shivalik Towers", "West Walk CHS",
    "Anmol Nagar", "Suryodaya Apartments", "Garden Square CHSL", "Konark Residency",
    "Neelkamal Society", "Sagar Darshan", "Palm Grove CHS", "Adarsh Nagar",
    "Krishna Heights", "Samarth CHSL", "Bela View Residency", "Shivneri Towers",
    "Dhanlaxmi Apartments", "Amruta Vatika", "Sunrise Enclave CHS", "Riverside Residency",
    "Mogra Society", "Chandanama CHSL", "Yashwant Nagar", "Kiran Apartments",
    "Ganga Jyoti CHS", "Suvidha Residency", "Narmada Towers", "Shubhkabh CHSL",
    "Vasant Kunj Apartments",
]


def water_tree():
    """Return (node_rows, children, parent) for the water network."""
    parent, rows = {}, []

    for nid, name, lat, lon in SOURCES:
        rows.append((nid, name, "source", lat, lon, None, None))
    for nid, name, lat, lon, par in PLANTS:
        rows.append((nid, name, "treatment_plant", lat, lon, None, par))
        parent[nid] = par
    for nid, name, lat, lon, par in RESERVOIRS:
        rows.append((nid, name, "reservoir", lat, lon, None, par))
        parent[nid] = par
    for nid, name, lat, lon, par in PUMPS:
        rows.append((nid, name, "pump", lat, lon, None, par))
        parent[nid] = par
    for nid, name, lat, lon, par in JUNCTIONS:
        rows.append((nid, name, "junction", lat, lon, None, par))
        parent[nid] = par
    for nid, name, lat, lon, par in ZONES:
        rows.append((nid, name, "zone", lat, lon, nid, par))
        parent[nid] = par

    children = {}
    for nid, par in parent.items():
        children.setdefault(par, []).append(nid)
    for kids in children.values():
        kids.sort()

    # a junction belongs to the ward(s) it eventually feeds
    def feeds(node_id):
        out, stack = [], [node_id]
        while stack:
            cur = stack.pop(0)
            if cur.startswith("zone_"):
                out.append(cur)
            stack.extend(children.get(cur, []))
        return sorted(set(out))

    for row in rows:
        if row[2] == "junction":
            wards = feeds(row[0])
            idx = rows.index(row)
            rows[idx] = row[:5] + (",".join(wards) if wards else None, row[6])

    # buildings: jittered ~<=350 m around the ward, named societies
    i = 0
    for zone_id, _zn, zlat, zlon, _zp in ZONES:
        for bid in ZONE_BUILDINGS[zone_id]:
            lat = round(zlat + rng.uniform(-0.0028, 0.0028), 6)
            lon = round(zlon + rng.uniform(-0.0032, 0.0032), 6)
            rows.append((bid, SOCIETY_NAMES[i], "building", lat, lon, zone_id, zone_id))
            parent[bid] = zone_id
            children.setdefault(zone_id, []).append(bid)
            i += 1
    rows.sort(key=lambda r: r[0])
    return rows, children, parent


# ===========================================================================
# 2. Pipes (§6.2)
# ===========================================================================

# Hand-authored trunks and feeds. §6.2 ranges: old trunks 1984-1996 (400-600 mm,
# DI/MS/CI, 600-1400 m); zone feeds 1990-2004 (150-250 mm); last legs are drawn.
#
# Why authored rather than drawn: §6.7 pins zone_3's latest chlorine at ~0.03 and
# turbidity at ~8.5. Those fall out of the §6.3 walk, and the walk only reaches
# them if the chain plant_n -> res_hill -> pump_1 -> J02 -> J03 -> J04 -> zone_3
# sums to k*dt ~= 0.83 across 6 hops. Ward 1 takes the opposite (newer) branch so
# S5 has genuinely normal siblings to compare against.
PIPE_SPECS = {
    ("src_river", "plant_n"): (1400, 600, "DI", 1986),
    ("src_lake", "plant_s"): (1100, 600, "DI", 1990),
    ("src_bore_a", "plant_n"): (900, 300, "MS", 1994),
    ("src_bore_b", "plant_s"): (700, 300, "MS", 1996),
    ("plant_n", "res_hill"): (1300, 500, "CI", 1988),
    ("plant_n", "res_tower"): (800, 500, "DI", 1996),
    ("plant_s", "res_east"): (1000, 500, "DI", 1998),
    ("res_hill", "pump_1"): (700, 400, "MS", 1989),
    ("res_tower", "pump_2"): (500, 300, "DI", 2006),
    ("res_east", "pump_3"): (600, 300, "DI", 2004),
    ("pump_1", "J02"): (600, 250, "MS", 1990),
    ("pump_2", "J01"): (400, 250, "PVC", 2010),
    ("pump_2", "J05"): (450, 250, "PVC", 2008),
    ("pump_2", "J06"): (500, 250, "DI", 2000),
    ("pump_3", "J08"): (400, 250, "PVC", 2009),
    ("pump_3", "J09"): (500, 250, "HDPE", 2007),
    ("J02", "J03"): (500, 150, "CI", 1991),        # the old 1991 main the trace finds
    ("J03", "J04"): (400, 150, "GI", 2002),
    ("J04", "zone_3"): (500, 150, "CI", 1993),
    ("J05", "J07"): (500, 200, "DI", 1999),
    ("J07", "zone_4"): (400, 200, "PVC", 2005),
    ("J05", "zone_2"): (400, 200, "HDPE", 2007),
    ("J01", "zone_1"): (300, 200, "HDPE", 2012),
    ("J08", "zone_5"): (450, 200, "PVC", 2011),
    ("J06", "J10"): (400, 200, "DI", 2001),
    ("J04", "J11"): (300, 150, "GI", 1995),
    ("J09", "J12"): (350, 150, "CI", 1998),
    ("J02", "J13"): (250, 150, "GI", 1997),
    ("J07", "J14"): (300, 150, "MS", 2000),
}
# Inter-ward cross-connections: real loops an engineer can open. The demo's S3
# diversion uses J08 -> J05, which is Ward 2's other feed.
LOOP_PIPES = [
    ("J08", "J05", 600, 200, "DI", 2016),
    ("J02", "J06", 550, 250, "DI", 2003),
    ("res_tower", "res_east", 1200, 500, "DI", 2014),
    ("J10", "zone_5", 400, 150, "HDPE", 2013),
]
LAST_LEG_MATERIALS = ("GI", "PVC", "HDPE")


def build_pipes(water_rows, parent):
    """Pipe tuples (id, from, to, length_m, diameter_mm, material, install_year)."""
    pipes, seq_no = [], [0]

    def add(frm, to, length, dia, material, year):
        seq_no[0] += 1
        pipes.append(("P%03d" % seq_no[0], frm, to, float(length), int(dia),
                      material, int(year)))

    for nid, _name, ntype, _lat, _lon, _zone, par in water_rows:
        if par is None:
            continue
        spec = PIPE_SPECS.get((par, nid))
        if spec:
            add(par, nid, *spec)
        elif ntype == "building":
            # §6.2 last legs: 1996-2016, 50-100 mm, GI/PVC/HDPE, 40-220 m
            add(par, nid, round(rng.uniform(40, 220), 1), rng.choice([50, 65, 80, 100]),
                rng.choice(LAST_LEG_MATERIALS), rng.randint(1996, 2016))
        else:
            # remaining junction feeds: 150-250 mm, 1990-2004
            add(par, nid, round(rng.uniform(220, 480), 1), rng.choice([150, 200, 250]),
                rng.choice(["DI", "CI", "PVC"]), rng.randint(1990, 2004))
    for frm, to, length, dia, material, year in LOOP_PIPES:
        add(frm, to, length, dia, material, year)
    # the two borewell clusters are alternative inflows to the plants: real pipes,
    # but each plant's tree parent is its surface intake, so they join as loops.
    add("src_bore_a", "plant_n", *PIPE_SPECS[("src_bore_a", "plant_n")])
    add("src_bore_b", "plant_s", *PIPE_SPECS[("src_bore_b", "plant_s")])
    return pipes


# ===========================================================================
# 3. Physics walk (§6.3)
# ===========================================================================

PLANT_BASE = {"chlorine": 0.85, "turbidity": 0.25, "ph": 7.35, "tds": 300.0}
BUILDING_TURBIDITY_CAP = 0.68   # §6.3: normal-day building turbidity stays under 0.7 NTU


def physics(water_rows, pipes, children, parent):
    """node_id -> {chlorine, turbidity, ph, tds, age_h, hops}, walked from plants."""
    types = {r[0]: r[2] for r in water_rows}
    pipe_to = {}
    for pid, frm, to, length, dia, material, year in pipes:
        if parent.get(to) == frm:
            pipe_to[to] = {"length_m": length, "diameter_mm": dia,
                           "material": material, "install_year": year}
    state = {p: dict(PLANT_BASE, age_h=0.0, hops=0) for p in ("plant_n", "plant_s")}

    order, stack = [], ["plant_n", "plant_s"]
    while stack:
        cur = stack.pop(0)
        for kid in children.get(cur, []):
            order.append(kid)
            stack.append(kid)

    for nid in order:
        ntype = types[nid]
        pipe = pipe_to[nid]
        par = state[parent[nid]]
        dt_h = travel_h(pipe["length_m"], pipe["diameter_mm"]) + residence_h(ntype)
        k = decay_k(pipe["diameter_mm"], pipe["install_year"], pipe["material"])
        turbidity = par["turbidity"] + 0.08 + (
            0.12 if 2026 - pipe["install_year"] > 25 else 0.0)
        if ntype == "building":
            turbidity = min(turbidity, BUILDING_TURBIDITY_CAP)
        state[nid] = {
            "chlorine": par["chlorine"] * math.exp(-k * dt_h),
            "turbidity": turbidity,
            "ph": par["ph"] - 0.01 + rng.uniform(-0.004, 0.004),
            "tds": par["tds"] + 6.0 + rng.uniform(-2.0, 2.0),
            "age_h": par["age_h"] + dt_h,
            "hops": par["hops"] + 1,
        }
    return state


# ===========================================================================
# 4. Readings (§6.4) and the planted scenarios (§6.5)
# ===========================================================================

WATER_SENSOR_NODES = [
    "plant_n", "plant_s", "res_hill", "res_tower", "res_east", "pump_1", "pump_2",
    "J02", "J04", "J05", "J07", "J08", "zone_1", "zone_2", "zone_3", "zone_4", "zone_5",
]
S1_START, S1_SPAN = back(12), 12.0
S2_START = back(3)
S3_START = back(36)
S4_START, S4_SPAN = back(48), 48.0
S4_HANDOFF = back(72)
S8_START, S8_SPAN = back(72), 72.0


def scenario(node_id, moment, base):
    """(d_turbidity, d_chlorine, d_ph, absolute_chlorine_override)."""
    d_turb = d_cl = d_ph = 0.0
    override = None

    if node_id == "zone_3":                       # S1 hero event
        f = frac(moment, S1_START, S1_SPAN)
        d_turb, d_cl, d_ph = 7.5 * f, -0.32 * f, -0.25 * f
    elif node_id == "J04":                        # S1 upstream, 0.6 strength
        f = 0.6 * frac(moment, S1_START, S1_SPAN)
        d_turb, d_cl, d_ph = 7.5 * f, -0.32 * f, -0.25 * f

    if node_id in ("zone_4", "J07") and moment >= S2_START:
        d_turb += 3.0        # step, not ramp: the burst signature
        d_cl -= 0.15

    if node_id == "zone_2" and moment >= S3_START:
        d_cl -= 0.10         # diverted onto the south plant's path

    if node_id == "res_hill":                     # S8 silt: mild upward trend
        d_turb += 0.15 * frac(moment, S8_START, S8_SPAN)

    if node_id in ("zone_5", "J08"):              # S4, exact arithmetic (§6.5)
        start_cl, end_cl = (0.315, 0.235) if node_id == "zone_5" else (0.345, 0.265)
        if moment >= S4_START:
            # Pure straight line: no daily cycle and no noise, or the 21 h
            # crossing that §6.7 pins would drift.
            override = start_cl + (end_cl - start_cl) * frac(moment, S4_START, S4_SPAN)
        elif moment >= S4_HANDOFF:
            blend = frac(moment, S4_HANDOFF, 24.0)
            override = base["chlorine"] + (start_cl - base["chlorine"]) * blend
    return d_turb, d_cl, d_ph, override


def build_readings(conn, phys, sensor_index):
    rows = []
    for node_id in WATER_SENSOR_NODES:
        srng = random.Random(42 * 1000 + sensor_index[node_id])   # §6.4
        base = phys[node_id]
        for moment in SERIES:
            hour = moment.hour
            d = math.sin(2 * math.pi * (hour - 6) / 24.0)
            d_turb, d_cl, d_ph, override = scenario(node_id, moment, base)
            if override is not None:
                chlorine = override
                turbidity = base["turbidity"] * (1 + 0.15 * d) + srng.gauss(0, 0.05) + d_turb
                ph = (base["ph"] + 0.06 * math.sin(2 * math.pi * hour / 24.0)
                      + srng.gauss(0, 0.03) + d_ph)
            else:
                chlorine = base["chlorine"] * (1 - 0.08 * d) + srng.gauss(0, 0.008) + d_cl
                turbidity = base["turbidity"] * (1 + 0.15 * d) + srng.gauss(0, 0.05) + d_turb
                ph = (base["ph"] + 0.06 * math.sin(2 * math.pi * hour / 24.0)
                      + srng.gauss(0, 0.03) + d_ph)
            tds = base["tds"] + 8 * d + srng.gauss(0, 3)
            rows.append(("S_%s" % node_id, ts(moment), round(ph, 3),
                         round(max(0.0, turbidity), 3), round(tds, 2),
                         round(max(0.0, chlorine), 4)))
    conn.executemany(
        "INSERT INTO readings(sensor_id, timestamp, ph, turbidity_ntu, tds_mgl,"
        " residual_chlorine_mgl) VALUES (?,?,?,?,?,?)", rows)
    return len(rows)


def pm_peak(hour):
    """Two commute-hour peaks, 08-10 and 20-22 (§6.4)."""
    return (1.0 + 0.30 * math.exp(-((hour - 9) ** 2) / 4.0)
            + 0.35 * math.exp(-((hour - 21) ** 2) / 4.0))


# S6: the two stations downwind of land_03 carry a higher baseline dust load, so
# the x3 ramp lands on the §6.7 contract (final PM10 ~= 360 -> AQI ~= 313).
DUST_STATIONS = {"air_07": (118.0, 56.0), "air_08": (120.0, 58.0)}   # (pm10, pm25)
S6_START, S6_SPAN = back(48), 48.0


def build_air(conn, sensor_index):
    rows = []
    for nid, _name, lat, lon, ward in AIR_STATIONS:
        srng = random.Random(42 * 1000 + sensor_index[nid])
        if nid in DUST_STATIONS:
            pm10_base, pm25_base = DUST_STATIONS[nid]
        else:
            pm10_base, pm25_base = rng.uniform(60, 100), rng.uniform(40, 60)
        for moment in SERIES:
            hour = moment.hour
            peak = pm_peak(hour)
            dust = 1.0
            if nid in DUST_STATIONS and moment >= S6_START:
                dust = 1.0 + 2.0 * frac(moment, S6_START, S6_SPAN)     # x3 in 2 days
            if moment == NOW and nid in DUST_STATIONS:
                pm10 = pm10_base * 3.0        # §6.5: final reading ~= 360 exactly
                pm25 = pm25_base * 2.0
            else:
                pm10 = pm10_base * peak * dust + srng.gauss(0, 4)
                pm25 = pm25_base * peak * (1.0 + (dust - 1.0) / 2.0) + srng.gauss(0, 2.5)
            rows.append((nid, ts(moment), round(max(0.0, pm25), 1), round(max(0.0, pm10), 1),
                         round(max(0.0, 28 + srng.gauss(0, 3)), 1),
                         round(max(0.0, 12 + srng.gauss(0, 2)), 1),
                         round(max(0.05, 0.6 + srng.gauss(0, 0.08)), 2),
                         round(max(0.0, 45 + srng.gauss(0, 6)), 1)))
    conn.executemany(
        "INSERT INTO air_readings(station_id, timestamp, pm25, pm10, no2, so2, co, o3)"
        " VALUES (?,?,?,?,?,?,?,?)", rows)
    return len(rows)


# ===========================================================================
# 5. Complaints, labs, maintenance, history (§6.5)
# ===========================================================================

COMPLAINTS = [
    # (hours_back, domain, node, category, text, image, duration_days, area_m2)
    (11.0, "water", "B21", "Muddy/turbid water",
     "Muddy brown water coming from the taps since last night. The whole building is affected.",
     None, None, None),
    (10.0, "water", "B22", "Suspected contamination",
     "Turbid water with a foul smell. Three flats in our society report stomach upset.",
     None, None, None),
    (9.5, "water", "B23", "Bad taste",
     "Bad taste and muddy water since evening. We suspect contamination of the ward line.",
     None, None, None),
    (9.0, "water", "B24", "Stomach illness reported",
     "Children in our building have stomach upset and vomiting after the water changed colour.",
     None, None, None),
    (7.5, "water", "B25", "Muddy/turbid water",
     "Brown water again this morning. We have stopped drinking it. Please test the line.",
     None, None, None),
    (2.5, "water", "B31", "No/low pressure",
     "No water since this morning. Tanker needed for the society overhead tank.",
     None, None, None),
    (2.0, "water", "B33", "No/low pressure",
     "Very low pressure, nothing reaches the upper floors.", None, None, None),
    (1.5, "water", "B35", "No/low pressure",
     "No water supply. Water is gushing out of the junction on the Plateau road.",
     None, None, None),
    (1.0, "water", "B37", "No/low pressure",
     "Pressure dropped to zero after the pipe burst near our gate.", None, None, None),
    (9.0, "water", "B14", "Bad taste",
     "Bad taste, the water has been stale since morning.", None, None, None),
    (6.0, "water", "B17", "Bad taste",
     "Stale water with a flat chemical aftertaste, different from the usual supply.",
     None, None, None),
    (20.0, "water", "B11", "Bad smell",
     "Sewage smell from our building's water. Neighbours in the other societies say theirs is fine.",
     None, None, None),
    (5.0, "air", "air_07", "Dust",
     "Dust from the construction site is unbearable, breathing trouble in the evening.",
     None, None, None),
    (3.0, "air", "air_08", "Dust",
     "Heavy dust from the construction plot. Children are coughing at school.",
     None, None, None),
    (8.0, "land", "land_05", "Open waste dump",
     "Open garbage dump near the school since 12 days, area 40 sqm. Stench and mosquitoes.",
     "data/images/garbage_heap.svg", 12, 40.0),
    (30.0, "land", "land_09", "Soil erosion",
     "Soil erosion near the reservoir intake after the rains. Silt is washing into the channel.",
     "data/images/eroded_soil.svg", 9, 120.0),
    (22.0, "water", "B42", "No/low pressure",
     "Water pressure is low only in the morning, normal by noon.", None, None, None),
    (16.0, "air", "air_03", "Air pollution",
     "Traffic smell near the flyover in the evening, occasional haze.", None, None, None),
    (19.0, "land", "land_12", "Other",
     "Streetlight not working near the empty plot. Someone dumps a little household waste.",
     None, None, None),
    (60.0, "land", "land_01", "Other",
     "Litter accumulates at the nullah corner after weekends.", None, None, None),
]

def build_complaints(conn):
    for hours_back, domain, node, category, text, image, duration, area in COMPLAINTS:
        cid = next_id(conn, "complaint")
        conn.execute(
            "INSERT INTO complaints(id, timestamp, domain, node_id, category, text,"
            " status, image_path, extracted_fields, duration_days, area_m2)"
            " VALUES (?,?,?,?,?,?, 'NEW', ?, NULL, ?, ?)",
            (cid, ts(back(hours_back)), domain, node, category, text, image, duration, area))
    return len(COMPLAINTS)


def build_labs(conn):
    """S1 lab result: coliform PRESENT at zone_3, dated NOW-6h (§6.5)."""
    rows = [
        (next_id(conn, "lab"), "zone_3", ts(back(6)), "PRESENT", "PRESENT",
         "100 mL membrane test, ward 3 composite sample."),
        (next_id(conn, "lab"), "zone_1", ts(back(30)), "ABSENT", "ABSENT",
         "100 mL membrane test, ward 1 reference sample."),
        (next_id(conn, "lab"), "zone_5", ts(back(54)), "ABSENT", "ABSENT",
         "100 mL membrane test, ward 5 reference sample."),
    ]
    conn.executemany("INSERT INTO lab_tests(id, node_id, date, total_coliform, e_coli, note)"
                     " VALUES (?,?,?,?,?,?)", rows)
    return rows


def build_maintenance(conn):
    rows = [
        (next_id(conn, "maint"), "zone_4", ts(back(3)), "burst_reported",
         "Feed main burst at the Plateau tee; supply lost to four societies."),
        (next_id(conn, "maint"), "zone_2", ts(back(36)), "flow_changed",
         "Feed switched from plant_n/res_tower to the plant_s/res_east path via the"
         " J08-J05 cross-connection; water age at ward 2 jumped about 4.5 h."),
        (next_id(conn, "maint"), "J03", "2026-10-12 10:00:00", "inspection",
         "Corrosion and tuberculation recorded in the 1991 CI main; lining failure at"
         " three joints."),
        (next_id(conn, "maint"), "res_hill", ts(back(28)), "turbidity_trend",
         "Silt ingress at the reservoir intake channel after monsoon run-off."),
    ]
    conn.executemany("INSERT INTO maintenance_checks(id, node_id, date, check_type, result)"
                     " VALUES (?,?,?,?,?)", rows)
    return rows


def build_history(conn):
    """Two RESOLVED cases with full action history (§6.5)."""
    cases = [
        ("CASE-2026-001", "water", "zone_2", "MUNICIPAL", "Resolved", "Medium",
         "Turbidity spike after main-line flushing", 120.0, 96.0, [
             (95.0, "A. Deshpande", "Executive Engineer", "Case opened",
              "Three complaints after flushing work on the Ring Road feed."),
             (72.0, "A. Deshpande", "Executive Engineer", "Investigation started",
              "Site visit scheduled with the ward division."),
             (48.0, "S. Kulkarni", "Lab Chemist", "Action taken",
              "Line flushed and re-sampled; readings back inside IS 10500 limits."),
             (24.0, "A. Deshpande", "Executive Engineer", "Case resolved",
              "Lab clearance received. Closed with citizen notification."),
         ]),
        ("CASE-2026-002", "land", "land_04", "MUNICIPAL", "Resolved", "Low",
         "Lane backlog not lifted for three weeks", 200.0, 150.0, [
             (148.0, "R. Joshi", "Sanitation In-charge", "Case opened",
              "Citizen report of an unsecured refuse pile."),
             (120.0, "R. Joshi", "Sanitation In-charge", "Investigation started",
              "Collection route reviewed with the contractor."),
             (96.0, "R. Joshi", "Sanitation In-charge", "Action taken",
              "Spot cleanup done; daily pickup reinstated."),
             (60.0, "M. Kadam", "Ward Officer", "Case resolved",
              "Verified clear for seven consecutive days."),
         ]),
    ]
    for cid, domain, node, scope, status, severity, title, created_h, updated_h, actions in cases:
        evidence = {"complaints": [], "shared_node": node,
                    "rule": "historical case, closed before the demo clock",
                    "readings": {}, "limits": {}, "confidence": 0.9}
        conn.execute(
            "INSERT INTO cases(id, domain, node_id, scope, status, severity, title,"
            " created_at, updated_at, evidence_json) VALUES (?,?,?,?,?,?,?,?,?,?)",
            (cid, domain, node, scope, status, severity, title, ts(back(created_h)),
             ts(back(updated_h)), json.dumps(evidence)))
        for hours_back, actor, role, action, note in actions:
            aid = next_id(conn, "action")
            conn.execute(
                "INSERT INTO case_actions(id, case_id, timestamp, actor, role, action, note)"
                " VALUES (?,?,?,?,?,?,?)",
                (aid, cid, ts(back(hours_back)), actor, role, action, note))
    conn.execute("UPDATE seq SET value = ? WHERE name = 'case'", (2,))
    return len(cases)


# ===========================================================================
# 6. Standards, features, land metadata
# ===========================================================================

def build_standards(conn):
    with open(os.path.join(ROOT, "config", "limits.json"), encoding="utf-8") as fh:
        limits = json.load(fh)
    p = limits["parameters"]
    rows, sid = [], 0

    def add(domain, parameter, acceptable, permissible, unit, citation):
        nonlocal sid
        sid += 1
        rows.append((sid, domain, parameter, acceptable, permissible, unit, citation))

    add("water", "pH", "6.5 - 8.5", "6.5 - 8.5 (no relaxation)", "",
        "IS 10500:2012, Table 1, excerpt - verify")
    add("water", "Turbidity (NTU)", str(p["turbidity_ntu"]["acceptable"]),
        "%s (only when no alternative source)" % p["turbidity_ntu"]["permissible"], "NTU",
        "IS 10500:2012, Table 1, excerpt - verify")
    add("water", "Total Dissolved Solids", str(p["tds_mgl"]["acceptable"]),
        str(p["tds_mgl"]["permissible"]), "mg/L",
        "IS 10500:2012, Table 1, excerpt - verify")
    add("water", "Residual chlorine (minimum)",
        "%.1f mg/L minimum" % p["residual_chlorine_mgl"]["acceptable"][0],
        "%.1f mg/L minimum" % p["residual_chlorine_mgl"]["permissible"][0], "mg/L",
        "IS 10500:2012, Cl. 6.1, excerpt - process-control minimum, not a health standard")
    add("water", "Total coliform", "Absent in 100 mL", "Absent in 100 mL", "present/absent",
        "IS 10500:2012, Table 1, excerpt - verify")
    with open(os.path.join(ROOT, "config", "aqi.json"), encoding="utf-8") as fh:
        aqi = json.load(fh)
    add("air", "PM10 (24 h)", "100", "350", "ug/m3",
        "CPCB NAQI 2017, breakpoint table - demo excerpt, verify")
    add("air", "PM2.5 (24 h)", "60", "120", "ug/m3",
        "CPCB NAQI 2017, breakpoint table - demo excerpt, verify")
    add("air", "NO2 (24 h)", "80", "280", "ug/m3",
        "CPCB NAQI 2017, breakpoint table - demo excerpt, verify")
    add("air", "SO2 (24 h)", "80", "380", "ug/m3",
        "CPCB NAQI 2017, breakpoint table - demo excerpt, verify")
    add("air", "CO (8 h)", "1.7", "9.0", "mg/m3",
        "CPCB NAQI 2017, breakpoint table - demo excerpt, verify")
    add("air", "O3 (8 h)", "100", "180", "ug/m3",
        "CPCB NAQI 2017, breakpoint table - demo excerpt, verify")
    add("land", "Segregation and no public dumping", "Source segregation mandatory",
        "No dumping on any public place, drain or water body", "-",
        "SWM Rules 2016, Rule 4 - demo excerpt, verify")
    add("land", "Removal of unauthorised dump", "Lift within 48 h",
        "Spot action and reinstated collection route", "days",
        "SWM Rules 2016, Rules 15-16 - demo excerpt, verify")
    conn.executemany("INSERT INTO standards(id, domain, parameter, acceptable,"
                     " permissible, unit, citation) VALUES (?,?,?,?,?,?,?)", rows)
    return len(rows)


def build_features(conn):
    """Anchor points for the transparent proximity score (§10)."""
    feats = [
        ("feat_school_01", "school", "Municipal School, Lane 7", 19.0507, 72.8808),
        ("feat_school_02", "school", "St. Xavier's High School", 19.0442, 72.9168),
        ("feat_water_01", "water_body", "Khadki Nallah", 19.0506, 72.8815),
        ("feat_water_02", "water_body", "Reservoir Intake Channel", 19.0270, 72.8617),
        ("feat_water_03", "water_body", "Nullah Head", 19.0538, 72.8962),
        ("feat_road_01", "main_road", "Ring Road", 19.0468, 72.8893),
        ("feat_road_02", "main_road", "Quarry Road", 19.0382, 72.9139),
        ("feat_road_03", "main_road", "Plateau Access Road", 19.0552, 72.8928),
    ]
    conn.executemany("INSERT INTO features(id, kind, name, lat, lon) VALUES (?,?,?,?,?)", feats)
    return len(feats)


def build_land_meta(conn):
    rows = [(row[0], row[5], row[6], row[7]) for row in LAND_SITES]
    conn.executemany("INSERT INTO land_meta(node_id, land_type, linked_water_node, note)"
                     " VALUES (?,?,?,?)", rows)
    return len(rows)


def build_sensors(conn):
    rows = [("S_%s" % nid, nid, "multi") for nid in WATER_SENSOR_NODES]
    rows += [("S_%s" % a[0], a[0], "air") for a in AIR_STATIONS]
    conn.executemany("INSERT INTO sensors(id, node_id, kind) VALUES (?,?,?)", rows)
    return len(rows)


# ===========================================================================
# main
# ===========================================================================

def main():
    db_path = os.environ.get("NIRIKSHAN_DB", os.path.join(ROOT, "nirikshan.db"))
    for suffix in ("", "-wal", "-shm"):
        p = db_path + suffix
        if os.path.exists(p):
            os.remove(p)

    conn = connect(db_path)
    with open(SCHEMA_PATH, encoding="utf-8") as fh:
        conn.executescript(fh.read())
    conn.executemany("INSERT INTO seq(name, value) VALUES (?, 0)",
                     [("complaint",), ("case",), ("action",), ("lab",), ("maint",)])

    water_rows, children, parent = water_tree()
    node_rows = list(water_rows)
    node_rows += [(a[0], a[1], "air_station", a[2], a[3], a[4], None) for a in AIR_STATIONS]
    node_rows += [(l[0], l[1], "land_site", l[2], l[3], l[4], None) for l in LAND_SITES]
    conn.executemany("INSERT INTO nodes(id, name, type, lat, lon, zone_id, parent_id)"
                     " VALUES (?,?,?,?,?,?,?)", node_rows)

    pipes = build_pipes(water_rows, parent)
    conn.executemany("INSERT INTO pipes(id, from_node, to_node, length_m, diameter_mm,"
                     " material, install_year) VALUES (?,?,?,?,?,?,?)", pipes)

    n_sensors = build_sensors(conn)
    order = [row["node_id"] for row in conn.execute(
        "SELECT node_id FROM sensors ORDER BY id").fetchall()]
    sensor_index = {nid: i for i, nid in enumerate(order)}

    phys = physics(water_rows, pipes, children, parent)
    n_readings = build_readings(conn, phys, sensor_index)
    n_air = build_air(conn, sensor_index)

    n_complaints = build_complaints(conn)
    build_labs(conn)
    build_maintenance(conn)
    build_history(conn)
    n_std = build_standards(conn)
    n_feat = build_features(conn)
    build_land_meta(conn)

    conn.commit()

    zone3 = phys["zone_3"]
    print("seeded %d nodes, %d pipes, %d sensors, %d readings, %d air readings,"
          " %d complaints, %d standards, %d features"
          % (len(node_rows), len(pipes), n_sensors, n_readings, n_air, n_complaints,
             n_std, n_feat))
    print("baseline zone_3: chlorine %.4f  turbidity %.3f  ph %.2f  tds %.1f"
          " age %.2f h  hops %d"
          % (zone3["chlorine"], zone3["turbidity"], zone3["ph"], zone3["tds"],
             zone3["age_h"], zone3["hops"]))
    for z in ("zone_1", "zone_2", "zone_4", "zone_5"):
        print("baseline %s: chlorine %.4f turbidity %.3f" % (z, phys[z]["chlorine"],
                                                             phys[z]["turbidity"]))
    conn.close()


if __name__ == "__main__":
    main()
