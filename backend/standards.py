"""Standard rows (PLAN.md §7.8).

Every row carries a `citation` string pointing at the bundled `docs/` excerpt, and
the numeric limits come from `config/limits.json` / `config/aqi.json` — never from a
literal in this file. `sync()` is the single source of the row set: `seed.py` calls it,
and the app calls it at startup so a database built from `schema.sql` alone still shows
the standards it cites.
"""

import os

WATER_PARAMETER_LABELS = {
    "ph": "pH",
    "turbidity_ntu": "Turbidity (NTU)",
    "tds_mgl": "Total Dissolved Solids",
    "residual_chlorine_mgl": "Residual chlorine (minimum)",
    "coliform": "Total coliform",
}
WATER_CITATION = "IS 10500:2012, Table 1, excerpt - verify"
AIR_CITATION = "CPCB NAQI 2017, breakpoint table - demo excerpt, verify"

# Qualitative rules have no number to read from config; they cite the bundled
# SWM Rules 2016 excerpt instead.
LAND_ROWS = [
    ("land", "Segregation and no public dumping", "Source segregation mandatory",
     "No dumping on any public place, drain or water body", "-",
     "SWM Rules 2016, Rule 4 - demo excerpt, verify"),
    ("land", "Removal of unauthorised dump", "Lift within 48 h",
     "Spot action and reinstated collection route", "days",
     "SWM Rules 2016, Rules 15-16 - demo excerpt, verify"),
]

_DOCS = {
    "water": "is10500_excerpt.txt",
    "air": "cpcb_aqi_excerpt.txt",
    "land": "swm_rules_excerpt.txt",
}


def _fmt(value):
    if isinstance(value, float) and value == int(value):
        return str(int(value))
    return str(value)


def _range(spec):
    if isinstance(spec, list):
        lo, hi = spec
        if lo is None:
            return "max %s" % _fmt(hi)
        if hi is None:
            return "%s minimum" % _fmt(lo)
        return "%s - %s" % (_fmt(lo), _fmt(hi))
    if spec == 0.0:
        return "Absent in 100 mL"
    return _fmt(spec)


def water_rows(limits):
    rows = []
    for key, label in WATER_PARAMETER_LABELS.items():
        if key == "coliform":
            rows.append(("water", label, "Absent in 100 mL", "Absent in 100 mL",
                         "present/absent", WATER_CITATION))
            continue
        spec = limits["parameters"][key]
        acceptable = _range(spec["acceptable"])
        permissible = _range(spec["permissible"])
        unit = spec["unit"]
        note = spec.get("note")
        if key == "ph" and note:
            permissible = "%s (%s)" % (permissible, "no relaxation")
        if key == "turbidity_ntu" and note:
            permissible = "%s (%s)" % (permissible, note.replace("5 NTU ", ""))
        if key == "residual_chlorine_mgl":
            floor = _fmt(spec["acceptable"][0])
            acceptable = "%s mg/L minimum" % floor
            permissible = "%s mg/L minimum" % _fmt(spec["permissible"][0])
            citation = "IS 10500:2012, Cl. 6.1, excerpt - process-control minimum," \
                       " not a health standard"
            rows.append(("water", label, acceptable, permissible, unit, citation))
            continue
        rows.append(("water", label, acceptable, permissible, unit, WATER_CITATION))
    return rows


def air_rows(aqi_cfg):
    """One row per pollutant that has a breakpoint table in config/aqi.json."""
    rows = []
    for key, label, unit_key in (
            ("pm10_24h_breakpoints", "PM10 (24 h)", "PM10"),
            ("pm25_24h_breakpoints", "PM2.5 (24 h)", "PM2.5"),
            ("no2_24h_breakpoints", "NO2 (24 h)", "NO2"),
            ("so2_24h_breakpoints", "SO2 (24 h)", "SO2"),
            ("co_8h_breakpoints", "CO (8 h)", "CO"),
            ("o3_8h_breakpoints", "O3 (8 h)", "O3")):
        bps = aqi_cfg.get(key)
        if not bps:
            continue
        # NAQI category boundaries: bps[2] is the Satisfactory/Moderate limit,
        # bps[4] the Moderate/Poor one — i.e. "acceptable" and "permissible".
        rows.append(("air", label, _fmt(bps[2]), _fmt(bps[4]),
                     aqi_cfg["units"][unit_key], AIR_CITATION))
    return rows


def sync(conn, limits, aqi_cfg):
    """Insert any (domain, parameter) row that is missing. Idempotent."""
    have = {(r["domain"], r["parameter"]) for r in conn.execute(
        "SELECT domain, parameter FROM standards").fetchall()}
    inserted = 0
    for row in water_rows(limits) + air_rows(aqi_cfg) + list(LAND_ROWS):
        if (row[0], row[1]) in have:
            continue
        conn.execute("INSERT INTO standards(domain, parameter, acceptable,"
                     " permissible, unit, citation) VALUES (?,?,?,?,?,?)", row)
        inserted += 1
        have.add((row[0], row[1]))
    return inserted


def load(conn, domain=None):
    if domain:
        rows = conn.execute("SELECT * FROM standards WHERE domain = ? ORDER BY id",
                            (domain,)).fetchall()
    else:
        rows = conn.execute("SELECT * FROM standards ORDER BY id").fetchall()
    return [dict(r) for r in rows]


def for_water_breaches(conn, limits, values, coliform_present):
    """Rows for the parameters that actually breach the acceptable limit."""
    from backend import wqi as wqi_mod

    keys = wqi_mod.breaches_acceptable(values or {}, coliform_present, limits)
    labels = [WATER_PARAMETER_LABELS[k] for k in keys if k in WATER_PARAMETER_LABELS]
    if not labels:
        return load(conn, "water")
    placeholders = ",".join("?" * len(labels))
    rows = conn.execute("SELECT * FROM standards WHERE domain = 'water'"
                        " AND parameter IN (%s) ORDER BY id" % placeholders,
                        labels).fetchall()
    return [dict(r) for r in rows]


def excerpt_path(domain):
    return os.path.join("docs", _DOCS.get(domain, _DOCS["water"]))


def excerpt_text(domain):
    """The bundled excerpt the UI cites next to the finding (may be absent)."""
    path = excerpt_path(domain)
    if not os.path.exists(path):
        return ""
    with open(path, "r", encoding="utf-8") as fh:
        return fh.read().strip()
