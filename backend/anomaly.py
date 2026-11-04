"""Anomaly detection (PLAN.md §7.5).

z-score of the latest reading against the mean/std of the SAME HOUR-OF-DAY over
the previous 13 days; flag when |z| >= z_threshold (config/rules.json).
Deterministic and offline — no ML, no network.
"""

PARAMETERS = ("turbidity_ntu", "residual_chlorine_mgl", "ph", "tds_mgl")


def _mean_std(xs):
    n = len(xs)
    if n == 0:
        return None, None
    m = sum(xs) / n
    if n < 2:
        return m, 0.0
    var = sum((x - m) ** 2 for x in xs) / (n - 1)
    return m, var ** 0.5


def zscore_latest(series, parameter, threshold=2.5):
    """series: [{'timestamp': 'YYYY-MM-DD HH:MM:SS', <parameter>: float}, ...]
    ordered oldest -> newest. Returns §7.5's dict.
    """
    rows = [r for r in series if r.get(parameter) is not None]
    if len(rows) < 2:
        return {"flag": False, "z": None, "baseline_mean": None,
                "baseline_std": None, "parameter": parameter, "n_baseline": 0}
    latest = rows[-1]
    hour = latest["timestamp"][11:13]
    baseline = [r[parameter] for r in rows[:-1] if r["timestamp"][11:13] == hour]
    mean, std = _mean_std(baseline)
    if mean is None:
        return {"flag": False, "z": None, "baseline_mean": None,
                "baseline_std": None, "parameter": parameter, "n_baseline": 0}
    # A zero/near-zero spread cannot be a division by zero: use a floor tied to
    # the magnitude of the baseline, not to the value being tested.
    spread = std if std and std > 1e-6 else max(abs(mean) * 0.02, 1e-6)
    z = (latest[parameter] - mean) / spread
    return {
        "flag": abs(z) >= threshold,
        "z": round(z, 2),
        "baseline_mean": round(mean, 4),
        "baseline_std": round(std, 4) if std is not None else None,
        "parameter": parameter,
        "n_baseline": len(baseline),
    }


def detect(series, threshold=2.5, parameters=PARAMETERS):
    """Worst (largest |z|) parameter across the water channels."""
    best = None
    for p in parameters:
        res = zscore_latest(series, p, threshold)
        if res["z"] is None:
            continue
        if best is None or abs(res["z"]) > abs(best["z"]):
            best = res
    return best or {"flag": False, "z": None, "baseline_mean": None,
                    "baseline_std": None, "parameter": None, "n_baseline": 0}
