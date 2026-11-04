"""Water Quality Index — the arithmetic that must not drift (PLAN.md §7.3).

WQI here is a RISK score: 0 = perfect, 100 = worst. The formulas below are
transcribed from §7.3 and are the only definition of the score in the project.
`limits` is the parsed `config/limits.json` (validated at app startup, §2 rule 6)
so this module holds no magic numbers of its own.
"""


def _subindex_ph(v):
    # ideal 7.0, acceptable [6.5, 8.5]
    if v is None:
        return None
    return 100.0 * (7.0 - v) / 0.5 if v < 7.0 else 100.0 * (v - 7.0) / 1.5


def _subindex_turbidity(v):
    # acceptable limit 1.0 NTU, clamped to [0, 100]
    if v is None:
        return None
    return min(100.0, 100.0 * v / 1.0)


def _subindex_tds(v):
    # acceptable limit 500 mg/L, clamped to [0, 100]
    if v is None:
        return None
    return min(100.0, 100.0 * v / 500.0)


def _subindex_chlorine(v):
    # minimum-side parameter: ideal 0.5, floor 0.2 -> deviation over 0.3
    if v is None:
        return None
    return 100.0 * max(0.0, 0.5 - v) / 0.3


def _subindex_coliform(present):
    if present is None:
        return None
    return 100.0 if present else 0.0


_SUBINDICES = {
    "ph": _subindex_ph,
    "turbidity_ntu": _subindex_turbidity,
    "tds_mgl": _subindex_tds,
    "residual_chlorine_mgl": _subindex_chlorine,
    "coliform": _subindex_coliform,
}


def breaches_permissible(values, coliform_present, limits):
    """Return the list of parameters over their PERMISSIBLE limit (§5.1)."""
    p = limits["parameters"]
    out = []
    v = values.get("ph")
    if v is not None:
        lo, hi = p["ph"]["permissible"]
        if v < lo or v > hi:
            out.append("ph")
    v = values.get("turbidity_ntu")
    if v is not None and v > p["turbidity_ntu"]["permissible"]:
        out.append("turbidity_ntu")
    v = values.get("tds_mgl")
    if v is not None and v > p["tds_mgl"]["permissible"]:
        out.append("tds_mgl")
    v = values.get("residual_chlorine_mgl")
    if v is not None:
        floor = p["residual_chlorine_mgl"]["permissible"][0]
        if v < floor:
            out.append("residual_chlorine_mgl")
    if coliform_present:
        out.append("coliform")
    return out


def breaches_acceptable(values, coliform_present, limits):
    """Return the list of parameters over their ACCEPTABLE limit (§5.1)."""
    p = limits["parameters"]
    out = []
    v = values.get("ph")
    if v is not None:
        lo, hi = p["ph"]["acceptable"]
        if v < lo or v > hi:
            out.append("ph")
    v = values.get("turbidity_ntu")
    if v is not None and v > p["turbidity_ntu"]["acceptable"]:
        out.append("turbidity_ntu")
    v = values.get("tds_mgl")
    if v is not None and v > p["tds_mgl"]["acceptable"]:
        out.append("tds_mgl")
    v = values.get("residual_chlorine_mgl")
    if v is not None:
        floor = p["residual_chlorine_mgl"]["acceptable"][0]
        if v < floor:
            out.append("residual_chlorine_mgl")
    if coliform_present:
        out.append("coliform")
    return out


def band_for(score, limits):
    for band in limits["wqi_bands"]:
        if score < band["max"]:
            return band
    return limits["wqi_bands"][-1]


def compute(values, coliform_present, limits):
    """WQI = Σ(weight·Qi)/Σ(weight) + worst-parameter override (§7.3).

    `values`: {"ph","turbidity_ntu","tds_mgl","residual_chlorine_mgl"} (None = not
    measured). `coliform_present`: True/False/None (no lab result yet).
    Returns {"score","band","colour","override","subindices","weights_used"}.
    """
    params = limits["parameters"]
    subindices = {}
    num = 0.0
    den = 0.0
    for key, fn in _SUBINDICES.items():
        raw = values.get(key) if key != "coliform" else coliform_present
        qi = fn(raw)
        if qi is None:
            continue
        w = params[key]["weight"]
        subindices[key] = {"value": raw, "qi": round(qi, 1), "weight": w}
        num += w * qi
        den += w
    score = (num / den) if den > 0 else 0.0
    score = max(0.0, min(100.0, score))

    # Worst-parameter override: a permissible breach (or coliform at all) means
    # the band can never read better than Poor, i.e. score >= 50.
    override = None
    hard = breaches_permissible(values, coliform_present, limits)
    if hard:
        override = "|".join(hard)
        if score < 50.0:
            score = 50.0
    band = band_for(score, limits)
    return {
        "score": round(score, 1),
        "band": band["band"],
        "colour": band["colour"],
        "override": override,
        "subindices": subindices,
        "weights_used": round(den, 4),
    }
