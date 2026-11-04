"""Gate 2 test — every row of the §6.7 demo numbers contract, through the API.

The tests PIN the numbers; nothing in the app forces them (§0 rule 8). If one of
these fails, the fix belongs in seed.py, not in the module under test.
"""

import unittest

from backend.tests.base import NirikshanTest


class ContractTest(NirikshanTest):

    def setUp(self):
        self.cluster_result = self.post("/api/cluster/run")

    def case_at(self, node_id, scope=None, resolved_ok=False):
        cases = self.get("/api/cases")["cases"]
        out = [c for c in cases if c["node_id"] == node_id
               and (scope is None or c["scope"] == scope)]
        if not resolved_ok:
            out = [c for c in out if c["status"] != "Resolved"]
        return out

    # ---- rows 1-3: zone_3 sensor state ------------------------------------
    def test_zone3_turbidity(self):
        node = self.get("/api/nodes/zone_3")
        value = node["latest"]["turbidity_ntu"]
        self.assertGreater(value, 5.0, "zone_3 turbidity must breach permissible")
        self.assertLess(value, 12.0)

    def test_zone3_chlorine(self):
        node = self.get("/api/nodes/zone_3")
        self.assertLess(node["latest"]["residual_chlorine_mgl"], 0.1)

    def test_zone3_wqi_is_unsafe(self):
        wqi = self.get("/api/nodes/zone_3")["wqi"]
        self.assertGreaterEqual(wqi["score"], 75)
        self.assertEqual(wqi["band"], "Unsafe")
        self.assertTrue(wqi["override"], "the worst-parameter override must be set")

    # ---- row 4: S1 cluster -------------------------------------------------
    def test_s1_one_municipal_case_at_zone3(self):
        cases = self.case_at("zone_3", "MUNICIPAL")
        self.assertEqual(len(cases), 1, "S1 must collapse into exactly one case")
        detail = self.get("/api/cases/%s" % cases[0]["id"])
        self.assertEqual(len(detail["evidence"]["complaints"]), 5)
        self.assertEqual(cases[0]["severity"], "High")

    # ---- row 5: S5 building-side ------------------------------------------
    def test_s5_building_side_case_at_b11(self):
        cases = self.case_at("B11", "BUILDING_SIDE")
        self.assertEqual(len(cases), 1)

    # ---- row 6: zone_5 chlorine now ---------------------------------------
    def test_zone5_chlorine_now(self):
        value = self.get("/api/nodes/zone_5")["latest"]["residual_chlorine_mgl"]
        self.assertGreater(value, 0.23)
        self.assertLess(value, 0.24)

    # ---- row 7: zone_5 forecast crossing ----------------------------------
    def test_zone5_forecast_crossing(self):
        fc = self.get("/api/nodes/zone_5/forecast")
        self.assertFalse(fc["breached_now"])
        self.assertGreaterEqual(fc["crossing_hours"], 18)
        self.assertLessEqual(fc["crossing_hours"], 24)

    # ---- row 8: S2 emergency ----------------------------------------------
    def test_s2_emergency_on_zone4_branch(self):
        cases = self.get("/api/cases")["cases"]
        emergency = [c for c in cases if c["severity"] == "Emergency"
                     and c["status"] != "Resolved"]
        self.assertEqual(len(emergency), 1)
        self.assertIn(emergency[0]["node_id"], ("zone_4", "J07"))

    # ---- row 9: S6 air -----------------------------------------------------
    def test_s6_station_aqi_very_poor(self):
        worst = self.get("/api/air")["worst"]
        self.assertGreaterEqual(worst["aqi"]["value"], 301)
        self.assertEqual(worst["aqi"]["category"], "Very Poor")

    # ---- row 10: N0 never clusters ----------------------------------------
    def test_n0_routine_complaints_do_not_cluster(self):
        for node in ("B42", "air_03", "land_12"):
            self.assertEqual(self.case_at(node), [],
                             "routine complaint at %s opened a case" % node)

    # ---- supporting: the historical cases the dashboard needs --------------
    def test_two_resolved_cases_are_seeded(self):
        resolved = [c for c in self.get("/api/cases")["cases"]
                    if c["status"] == "Resolved"]
        self.assertEqual(len(resolved), 2)

    def test_standards_carry_citations(self):
        detail = self.get("/api/cases/%s" % self.case_at("zone_3", "MUNICIPAL")[0]["id"])
        self.assertTrue(detail["standards"], "a water case must cite a standard")
        for row in detail["standards"]:
            self.assertTrue(row["citation"], "every standard row needs a citation")


if __name__ == "__main__":
    unittest.main()
