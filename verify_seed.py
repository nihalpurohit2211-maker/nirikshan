"""Print-and-assert the seeded dataset against the demo numbers contract.

PLAN.md §6.7 is law: if a number here drifts, the fix belongs in seed.py, never
in application code (§0 rule 1, §6.8 fallback). This script also runs the
clustering engine once, because four of the contract rows are about the case the
engine must produce — clustering is idempotent, so re-running is safe.

Run:  PY seed.py && PY verify_seed.py     (exit 0 == Gate 1 passes)
"""

import json
import os
import sys

from backend import aqi as aqi_mod
from backend import db as dbmod
from backend import forecast as fc
from backend import graph as graph_mod
from backend import rules as rules_mod
from backend import wqi as wqi_mod

ROOT = os.path.dirname(os.path.abspath(__file__))
FAILURES = []
CHECKS = [0]


def load(name):
    with open(os.path.join(ROOT, "config", name), encoding="utf-8") as fh:
        return json.load(fh)


def check(label, ok, detail):
    CHECKS[0] += 1
    print("%-4s %-58s %s" % ("PASS" if ok else "FAIL", label, detail))
    if not ok:
        FAILURES.append("%s (%s)" % (label, detail))


def main():
    limits = load("limits.json")
    aqi_cfg = load("aqi.json")
    cfg = load("rules.json")

    conn = dbmod.connect()
    _now = dbmod.demo_now(conn)
    print("demo now: %s\n" % _now)

    # ---- structure (§6.2) -------------------------------------------------
    counts = {r["t"]: r["n"] for r in conn.execute(
        "SELECT type AS t, COUNT(*) AS n FROM nodes GROUP BY type").fetchall()}
    check("node counts: 4 sources, 2 plants, 3 reservoirs, 3 pumps, 14 junctions,"
          " 5 zones, 45 buildings, 10 air, 12 land",
          (counts.get("source"), counts.get("treatment_plant"), counts.get("reservoir"),
           counts.get("pump"), counts.get("junction"), counts.get("zone"),
           counts.get("building"), counts.get("air_station"), counts.get("land_site"))
          == (4, 2, 3, 3, 14, 5, 45, 10, 12), str(counts))
    n_pipes = conn.execute("SELECT COUNT(*) AS n FROM pipes").fetchone()["n"]
    check("pipes ~79 (§6.2)", 76 <= n_pipes <= 82, "%d pipes" % n_pipes)
    sensors = conn.execute("SELECT kind, COUNT(*) AS n FROM sensors GROUP BY kind"
                          ).fetchall()
    kinds = {r["kind"]: r["n"] for r in sensors}
    check("sensors: 17 water multi + 10 air", kinds.get("multi") == 17
          and kinds.get("air") == 10, str(kinds))
    n_read = conn.execute("SELECT COUNT(*) AS n FROM readings").fetchone()["n"]
    n_air = conn.execute("SELECT COUNT(*) AS n FROM air_readings").fetchone()["n"]
    check("readings: 17 sensors x 336 h", n_read == 17 * 336, "%d readings" % n_read)
    check("air readings: 10 stations x 336 h", n_air == 10 * 336, "%d air readings" % n_air)
    n_comp = conn.execute("SELECT COUNT(*) AS n FROM complaints").fetchone()["n"]
    check("complaints seeded (18-20: S1..S8 + N0 + texture)", 18 <= n_comp <= 22,
          "%d complaints" % n_comp)

    # ---- graph invariants -------------------------------------------------
    parent, children, nodes, pipes_by_to = graph_mod.load_graph(conn)
    s1_buildings = ["B21", "B22", "B23", "B24", "B25"]
    shared = graph_mod.lca(s1_buildings, parent)
    check("LCA of the 5 S1 buildings == zone_3", shared == "zone_3",
          "lca = %s" % shared)
    path = graph_mod.trace("zone_3", parent)
    check("trace(zone_3) ends at a treatment plant",
          path and nodes[path[-1]]["type"] == "treatment_plant", " -> ".join(path))
    check("the traced chain includes the old 1991 main",
          any((pipes_by_to.get(n) is not None and pipes_by_to[n]["install_year"] == 1991)
              for n in path if n in pipes_by_to),
          str([pipes_by_to[n]["install_year"] for n in path
               if n in pipes_by_to and pipes_by_to[n]]))

    # ---- §6.7 rows 1-3: zone_3 at NOW ------------------------------------
    latest = rules_mod.bulk_latest(conn)
    z3 = latest.get("zone_3") or {}
    check("zone_3 latest turbidity > 5.0 and < 12.0 (target ~8.5 NTU)",
          5.0 < z3.get("turbidity_ntu", 0) < 12.0,
          "turbidity = %s" % z3.get("turbidity_ntu"))
    check("zone_3 latest chlorine < 0.1 (target ~0.03 mg/L)",
          z3.get("residual_chlorine_mgl", 1) < 0.1,
          "chlorine = %s" % z3.get("residual_chlorine_mgl"))
    coliform = rules_mod.bulk_coliform(conn)
    wq3 = wqi_mod.compute(z3, coliform.get("zone_3"), limits)
    check("zone_3 WQI Unsafe band (score >= 75)", wq3["score"] >= 75,
          "score = %s band = %s override = %s" % (wq3["score"], wq3["band"],
                                                  wq3["override"]))
    check("zone_3 lab test reports coliform present (§6.5 S1)",
          coliform.get("zone_3") is True, str(coliform.get("zone_3")))

    # ---- §6.7 rows 6-7: zone_5 forecast ----------------------------------
    z5 = latest.get("zone_5") or {}
    check("zone_5 chlorine now in (0.23, 0.24) (target 0.235)",
          0.23 < z5.get("residual_chlorine_mgl", 0) < 0.24,
          "chlorine = %s" % z5.get("residual_chlorine_mgl"))
    f5 = fc.forecast_chlorine(conn, "zone_5", cfg)
    check("zone_5 forecast crossing_hours in 18..24 (by construction 21)",
          f5 is not None and f5["crossing_hours"] is not None
          and 18 <= f5["crossing_hours"] <= 24,
          "crossing = %s h, method = %s, slope = %s"
          % (f5 and f5["crossing_hours"], f5 and f5["method"], f5 and f5["slope_per_hour"]))
    check("zone_5 breached_now == False", f5 is not None and f5["breached_now"] is False,
          "current = %s" % (f5 and f5["current"]))

    # ---- §6.7 row 9: S6 air ---------------------------------------------
    air_latest = rules_mod.bulk_latest_air(conn)
    aqis = {sid: aqi_mod.compute(row, aqi_cfg) for sid, row in air_latest.items()}
    worst = max(aqis.items(), key=lambda kv: kv[1]["value"] or 0)
    check("S6 station AQI >= 301 (Very Poor)", (worst[1]["value"] or 0) >= 301,
          "%s AQI = %s %s driving = %s" % (worst[0], worst[1]["value"],
                                           worst[1]["category"], worst[1]["driving_pollutant"]))
    check("S6 driving pollutant is PM10 (construction dust ramp)",
          worst[1]["driving_pollutant"] == "PM10", str(worst[1]["driving_pollutant"]))

    # ---- clustering: §6.7 rows 4, 5, 8, 10 -------------------------------
    result = rules_mod.cluster(conn, cfg, limits, aqi_cfg)
    cases = [dict(r) for r in conn.execute("SELECT * FROM cases").fetchall()]
    municipal_z3 = [c for c in cases if c["domain"] == "water" and c["node_id"] == "zone_3"
                    and c["scope"] == "MUNICIPAL" and c["status"] != "Resolved"]
    check("S1: exactly 1 MUNICIPAL case at zone_3", len(municipal_z3) == 1,
          "%d case(s): %s" % (len(municipal_z3), [c["id"] for c in municipal_z3]))
    if municipal_z3:
        ev = json.loads(municipal_z3[0]["evidence_json"])
        check("S1: that case carries all 5 complaints", len(ev["complaints"]) == 5,
              "%s" % ev["complaints"])
        check("S1: severity High", municipal_z3[0]["severity"] == "High",
              municipal_z3[0]["severity"])

    s5 = [c for c in cases if c["node_id"] == "B11" and c["scope"] == "BUILDING_SIDE"
          and c["status"] != "Resolved"]
    check("S5: BUILDING_SIDE case at B11", len(s5) == 1,
          "%s" % [c["id"] for c in s5])

    s2 = [c for c in cases if c["severity"] == "Emergency" and c["status"] != "Resolved"]
    check("S2: Emergency case on the Zone 4 branch",
          len(s2) == 1 and s2[0]["node_id"] in ("zone_4", "J07"),
          "%s" % [(c["id"], c["node_id"]) for c in s2])

    routine = {"B42", "air_03", "land_12"}
    leaked = [c["id"] for c in cases if c["node_id"] in routine and c["status"] != "Resolved"]
    check("N0: routine complaints never cluster", not leaked, "cases: %s" % leaked)

    n_hist = len([c for c in cases if c["status"] == "Resolved"])
    check("2 historical RESOLVED cases seeded", n_hist == 2, "%d resolved" % n_hist)

    # ---- idempotency (§2 rule 5) ----------------------------------------
    before = sorted(c["id"] for c in conn.execute(
        "SELECT id FROM cases WHERE status != 'Resolved'").fetchall())
    actions_before = conn.execute("SELECT COUNT(*) AS n FROM case_actions").fetchone()["n"]
    rules_mod.cluster(conn, cfg, limits, aqi_cfg)
    after = sorted(c["id"] for c in conn.execute(
        "SELECT id FROM cases WHERE status != 'Resolved'").fetchall())
    actions_after = conn.execute("SELECT COUNT(*) AS n FROM case_actions").fetchone()["n"]
    check("cluster/run twice -> identical case set", before == after,
          "%s vs %s" % (before, after))
    check("cluster/run twice -> no duplicate actions", actions_before == actions_after,
          "%d -> %d actions" % (actions_before, actions_after))

    # ---- S7 / S8 land rows ----------------------------------------------
    s7 = rules_mod.proximity(conn, cfg, "land_05")
    check("S7 land_05 proximity score ranks school proximity",
          any(f["kind"] == "school" and f["met"] for f in s7["factors"])
          and s7["score"] >= 50,
          "score = %s factors = %s" % (s7["score"],
                                       [(f["kind"], f["points"]) for f in s7["factors"]]))
    link = rules_mod._cross_link(conn, "land_09")
    check("S8 erosion -> water cross-link exists with a rising trend",
          link and link["water_node"] == "res_hill" and link["direction"] == "rising",
          str(link))

    # ---- images (§6.6) ---------------------------------------------------
    imgs = os.listdir(os.path.join(ROOT, "data", "images"))
    check("synthetic demo images present and referenced", len(imgs) >= 4, str(imgs))
    n_img = conn.execute("SELECT COUNT(*) AS n FROM complaints WHERE image_path IS NOT NULL"
                         ).fetchone()["n"]
    check("complaints reference images", n_img >= 2, "%d complaint images" % n_img)

    conn.close()
    print("\n%d checks, %d failures" % (CHECKS[0], len(FAILURES)))
    for f in FAILURES:
        print("  FAILED: %s" % f)
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
