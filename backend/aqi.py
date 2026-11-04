"""CPCB National Ambient Air Quality Index (PLAN.md §7.4).

AQI_p = I_low + (C - B_low) * (I_high - I_low) / (B_high - B_low)
Overall AQI = max(sub-index over pollutants); the max contributor is reported as
the driving pollutant. Breakpoints and categories come from config/aqi.json
(§5.2) — no numbers live in this module.

Note: hourly readings are scored against the 24-hour breakpoint table. That is a
demo approximation and is labelled as such wherever the value is shown.
"""

BREAKPOINT_KEYS = {
    "PM2.5": "pm25_24h_breakpoints",
    "PM10": "pm10_24h_breakpoints",
    "NO2": "no2_24h_breakpoints",
    "SO2": "so2_24h_breakpoints",
    "O3": "o3_8h_breakpoints",
    "CO": "co_8h_breakpoints",
}

COLUMN_KEYS = {
    "PM2.5": "pm25",
    "PM10": "pm10",
    "NO2": "no2",
    "SO2": "so2",
    "CO": "co",
    "O3": "o3",
}


def subindex(conc, breakpoints, index_bounds):
    """One pollutant's sub-index; clamped to [0, 500] (§7.4, docs excerpt)."""
    if conc is None:
        return None
    if conc <= breakpoints[0]:
        return float(index_bounds[0]) if conc >= 0 else None
    for i in range(len(breakpoints) - 1):
        b_lo, b_hi = breakpoints[i], breakpoints[i + 1]
        i_lo, i_hi = index_bounds[i], index_bounds[i + 1]
        if conc <= b_hi:
            if b_hi == b_lo:
                return float(i_hi)
            return i_lo + (conc - b_lo) * (i_hi - i_lo) / (b_hi - b_lo)
    return float(index_bounds[-1])  # above the last breakpoint -> Severe clamp


def category_for(aqi, cfg):
    for cat in cfg["categories"]:
        if aqi <= cat["max"]:
            return cat
    return cfg["categories"][-1]


def compute(reading, cfg):
    """reading: dict with pm25/pm10/no2/so2/co/o3. Returns aqi dict (§7.9 shape)."""
    bounds = cfg["index_bounds"]
    subs = {}
    for pollutant in cfg["pollutants"]:
        key = BREAKPOINT_KEYS[pollutant]
        breakpoints = cfg.get(key)
        if not breakpoints:
            continue
        conc = reading.get(COLUMN_KEYS[pollutant])
        si = subindex(conc, breakpoints, bounds)
        if si is None:
            continue
        subs[pollutant] = {"concentration": conc, "subindex": round(si, 1)}
    if not subs:
        return {"value": None, "category": None, "colour": None,
                "driving_pollutant": None, "subindices": {}}
    driving = max(subs, key=lambda p: subs[p]["subindex"])
    value = subs[driving]["subindex"]
    cat = category_for(value, cfg)
    return {
        "value": round(value, 1),
        "category": cat["name"],
        "colour": cat["colour"],
        "driving_pollutant": driving,
        "subindices": subs,
    }
