"""Gate 2 test — the 24 h chlorine forecast (§7.6, S4 contract row)."""

import unittest

from backend.tests.base import NirikshanTest


class ForecastTest(NirikshanTest):

    def test_zone5_is_the_pinned_s4_case(self):
        fc = self.get("/api/nodes/zone_5/forecast")
        self.assertAlmostEqual(fc["current"], 0.235, places=3)
        self.assertFalse(fc["breached_now"])
        self.assertEqual(fc["crossing_hours"], 21)
        self.assertEqual(fc["method"], "trend")
        self.assertEqual(fc["limit"], 0.2)
        self.assertAlmostEqual(fc["slope_per_hour"], (0.235 - 0.315) / 48.0, places=5)

    def test_projected_series_covers_the_horizon(self):
        fc = self.get("/api/nodes/zone_5/forecast")
        self.assertEqual(len(fc["projected"]), fc["horizon_hours"] + 1)
        self.assertEqual(fc["projected"][0], fc["current"])
        # monotone decline, and it really does cross the minimum inside the window
        values = [p["value"] if isinstance(p, dict) else p for p in fc["projected"]]
        self.assertTrue(all(b <= a + 1e-9 for a, b in zip(values, values[1:])))
        self.assertLess(values[-1], fc["limit"])

    def test_a_breached_node_reports_breached_now(self):
        fc = self.get("/api/nodes/zone_3/forecast")
        self.assertTrue(fc["breached_now"], "zone_3 chlorine is already below 0.2")
        self.assertEqual(fc["crossing_hours"], 0)
        self.assertEqual(fc["method"], "trend")

    def test_physics_branch_is_used_when_there_is_no_monotone_trend(self):
        """§7.6: a sensor with no clean 48 h decline decays by pipe physics."""
        fc = self.get("/api/nodes/zone_1/forecast")
        self.assertEqual(fc["method"], "physics")
        self.assertGreater(fc["decay_k"], 0)
        self.assertFalse(fc["breached_now"])
        self.assertIsNotNone(fc["crossing_hours"])
        trend = self.get("/api/nodes/zone_5/forecast")
        self.assertIsNone(trend["decay_k"], "the trend branch has no decay constant")

    def test_node_without_a_sensor_says_so(self):
        self.expect_error("/api/nodes/B21/forecast", "GET", None, 404)

    def test_air_pm_forecast_exists(self):
        air = self.get("/api/air")
        self.assertIsNotNone(air["pm_forecast"])
        fc = air["pm_forecast"]
        self.assertEqual(fc["parameter"], "pm10")
        self.assertGreater(len(fc["projected"]), 1)


if __name__ == "__main__":
    unittest.main()
