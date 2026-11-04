"""Ward zone geometry, derived from the served node coordinates.

The five ward centres in the seed sit within a few kilometres of each other, so a
literal circle at each centre overlaps into one stain. This module turns those
centres into interlocking Voronoi cells by clipping a bounding rectangle against
the perpendicular bisector of every other pair of centres. Pure stdlib, no
dependency and no hand-authored polygon: move a ward in `seed.py` and its zone
moves with it.

The cells are geometry only. Every number attached to a cell is read from the
engine payload (the ward's own WQI, and the complaints and open cases whose node
falls inside the cell) — the browser never classifies a point.
"""

import math

EPS = 1e-12


def _clip(poly, a, b, c):
    """Keep the half-plane a*x + b*y <= c (Sutherland-Hodgman, one edge)."""
    if not poly:
        return []
    out = []
    n = len(poly)
    for i in range(n):
        cur = poly[i]
        nxt = poly[(i + 1) % n]
        dc = a * cur[0] + b * cur[1] - c
        dn = a * nxt[0] + b * nxt[1] - c
        if dc <= EPS:
            out.append(cur)
        if (dc < -EPS < dn) or (dn < -EPS < dc):
            t = dc / (dc - dn)
            out.append((cur[0] + (nxt[0] - cur[0]) * t,
                        cur[1] + (nxt[1] - cur[1]) * t))
    return out


def cells(sites, bounds):
    """Voronoi cells for `sites`, clipped to `bounds`.

    sites  [{"id", "name", "lon", "lat"}, ...]
    bounds (min_lon, max_lon, min_lat, max_lat)
    returns [{"id", "name", "centre": [lon, lat], "polygon": [[lon, lat], ...]}]
    """
    min_lon, max_lon, min_lat, max_lat = bounds
    rect = [(min_lon, min_lat), (max_lon, min_lat),
            (max_lon, max_lat), (min_lon, max_lat)]
    out = []
    for site in sites:
        poly = list(rect)
        sx, sy = float(site["lon"]), float(site["lat"])
        for other in sites:
            if other["id"] == site["id"]:
                continue
            ox, oy = float(other["lon"]), float(other["lat"])
            # points at least as close to this site as to the other one
            a = 2.0 * (ox - sx)
            b = 2.0 * (oy - sy)
            c = (ox * ox + oy * oy) - (sx * sx + sy * sy)
            if abs(a) < EPS and abs(b) < EPS:
                continue
            poly = _clip(poly, a, b, c)
            if not poly:
                break
        out.append({
            "id": site["id"], "name": site["name"],
            "centre": [sx, sy],
            "polygon": [[round(x, 6), round(y, 6)] for x, y in poly],
        })
    return out


def inside(point, polygon):
    """Ray-casting point-in-polygon; a cell edge counts as inside."""
    x, y = point
    hit = False
    n = len(polygon)
    if n < 3:
        return False
    for i in range(n):
        x1, y1 = polygon[i]
        x2, y2 = polygon[(i + 1) % n]
        if (y1 > y) != (y2 > y):
            at = x1 + (y - y1) * (x2 - x1) / (y2 - y1)
            if at >= x:
                hit = not hit
    return hit


def bounds_of(points, pad=0.04):
    """A padded bounding box for [lon, lat] pairs, with a sane minimum span."""
    lons = [p[0] for p in points]
    lats = [p[1] for p in points]
    min_lon, max_lon = min(lons), max(lons)
    min_lat, max_lat = min(lats), max(lats)
    dx = max(max_lon - min_lon, 0.01) * pad
    dy = max(max_lat - min_lat, 0.01) * pad
    return (min_lon - dx, max_lon + dx, min_lat - dy, max_lat + dy)
