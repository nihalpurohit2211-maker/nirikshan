"""Gate 2 test — air (S6), land (S7/S8), hotspots, anomaly and the network payload."""

import unittest

from backend.tests.base import NirikshanTest, api


class AirTest(NirikshanTest):

    def setUp(self):
        self.post("/api/cluster/run")
        self.air = self.get("/api/air")

    def test_s6_worst_station_is_very_poor(self):
        self.assertGreaterEqual(self.air["worst"]["aqi"]["value"], 301)
        self.assertEqual(self.air["worst"]["aqi"]["category"], "Very Poor")
        self.assertEqual(self.air["worst"]["aqi"]["driving_pollutant"], "PM10")

    def test_every_station_carries_an_aqi_object(self):
        for station in self.air["stations"]:
            self.assertIsNotNone(station["aqi"], "%s has no AQI" % station["id"])
            for key in ("value", "category", "driving_pollutant", "subindices"):
                self.assertIn(key, station["aqi"])

    def test_dust_complaints_cluster_into_one_air_case(self):
        cases = [c for c in self.get("/api/cases")["cases"]
                 if c["domain"] == "air" and c["status"] != "Resolved"]
        self.assertEqual(len(cases), 1)
        self.assertIn(cases[0]["node_id"], ("air_07", "air_08"))
        self.assertGreaterEqual(cases[0]["evidence"]["aqi"], 301)

    def test_station_series_has_per_row_aqi(self):
        station = self.air["worst"]["id"]
        payload = self.get("/api/air/%s/readings" % station)
        self.assertEqual(payload["hours"], 336)
        last = payload["readings"][-1]
        self.assertIn("aqi", last)
        self.assertGreaterEqual(last["aqi"], 301)

    def test_pm_forecast_tracks_the_driving_pollutant(self):
        fc = self.air["pm_forecast"]
        self.assertEqual(fc["parameter"], "pm10")
        self.assertEqual(len(fc["projected"]), fc["horizon_hours"] + 1)

    def test_unknown_station_is_404_json(self):
        self.expect_error("/api/air/air_99/readings", "GET", None, 404)


class LandTest(NirikshanTest):

    def setUp(self):
        self.post("/api/cluster/run")
        self.reports = self.get("/api/land/reports")

    def test_s7_proximity_score_is_explained_by_factors(self):
        land_05 = [r for r in self.reports["reports"] if r["node_id"] == "land_05"]
        self.assertTrue(land_05, "the dump at land_05 must be in the reports")
        prox = land_05[0]["proximity"]
        self.assertGreaterEqual(prox["score"], 50)
        school = [f for f in prox["factors"] if f["kind"] == "school"]
        self.assertTrue(school and school[0]["met"],
                        "a school within range must be the reason for the score")
        self.assertLessEqual(school[0]["nearest"]["distance_m"],
                             self.reports["weights"]["school_m"])
        self.assertTrue(all(f["points"] <= self.reports["weights"]["cap"]
                            for f in prox["factors"]))

    def test_s8_erosion_links_to_a_rising_water_turbidity(self):
        linked = [r for r in self.reports["reports"]
                  if r["node_id"] == "land_09" and r["cross_link"]]
        self.assertTrue(linked, "land_09 (erosion) must carry a water cross-link")
        link = linked[0]["cross_link"]
        self.assertIsNotNone(link["water_node"])
        self.assertEqual(link["direction"], "rising")
        self.assertGreater(link["trend"], 0)

    def test_land_case_exists_for_the_dump(self):
        cases = [c for c in self.get("/api/cases")["cases"]
                 if c["domain"] == "land" and c["status"] != "Resolved"]
        self.assertTrue(cases)
        self.assertEqual(cases[0]["node_id"], "land_05")
        self.assertIn("proximity", cases[0]["evidence"])

    def test_report_images_are_served(self):
        with_image = [r for r in self.reports["reports"] if r["image_url"]]
        self.assertTrue(with_image, "seeded land reports should carry demo images")
        for report in with_image:
            status, _ = api(report["image_url"])
            self.assertEqual(status, 200, "%s did not serve" % report["image_url"])

    def test_unknown_land_site_rejected(self):
        self.expect_error("/api/land/reports", "POST",
                          {"node_id": "land_99", "category": "Open waste dump",
                           "text": "test"}, 404)


class NetworkAndHotspotTest(NirikshanTest):

    def test_network_payload_is_bulk_and_complete(self):
        net = self.get("/api/network")
        self.assertEqual(len(net["nodes"]), 98)
        self.assertEqual(len(net["pipes"]), 78)
        zone_3 = [n for n in net["nodes"] if n["id"] == "zone_3"][0]
        self.assertEqual(zone_3["wqi"]["band"], "Unsafe")

    def test_anomaly_flags_the_zone3_spike(self):
        node = self.get("/api/nodes/zone_3")
        self.assertTrue(node["anomaly"]["flag"],
                        "the S1 ramp must flag on the same-hour baseline")
        self.assertGreaterEqual(abs(node["anomaly"]["z"]), 2.5)
        self.assertEqual(node["anomaly"]["parameter"], "turbidity_ntu")
        self.assertTrue(node["lab_tests"], "the coliform lab test must be visible")

    def test_maintenance_records_are_visible(self):
        # The S1 inspection note is the human evidence behind the 1991-main story.
        rows = self.get("/api/nodes/J03")["maintenance"]
        self.assertTrue(rows, "J03 must carry the seeded inspection")
        self.assertTrue(any("1991" in str(r["result"]) for r in rows),
                        "the inspection must name the 1991 CI main")

    def test_hotspots_rank_zone_3_first_with_factors(self):
        hot = self.get("/api/hotspots")["hotspots"]
        self.assertEqual(hot[0]["node_id"], "zone_3")
        for factor in ("wqi", "open_cases", "severity", "complaints_24h"):
            self.assertIn(factor, hot[0]["factors"])
        scores = [h["score"] for h in hot]
        self.assertEqual(scores, sorted(scores, reverse=True))

    def test_overview_kpis_match_the_case_list(self):
        ov = self.get("/api/overview")
        self.assertEqual(ov["kpis"]["worst_wqi"]["node_id"], "zone_3")
        self.assertGreaterEqual(ov["kpis"]["worst_aqi"]["value"], 301)
        self.assertEqual(ov["kpis"]["open_cases"], len(ov["triage"]))
        self.assertTrue(ov["triage"], "the demo clock must leave open cases to triage")
        self.assertEqual(ov["demo_now"], "2026-11-03 09:00:00")

    def test_unknown_node_is_404(self):
        self.expect_error("/api/nodes/nope", "GET", None, 404)


if __name__ == "__main__":
    unittest.main()
