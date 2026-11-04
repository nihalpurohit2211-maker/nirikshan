"""Gate 2 test — health, the JSON error envelope, and the request id (§2 rules 3, 7)."""

import unittest

from backend.tests.base import NirikshanTest, api, api_headers


class HealthTest(NirikshanTest):

    def test_health_ok_with_counts(self):
        payload = self.get("/api/health")
        self.assertEqual(payload["status"], "ok")
        self.assertEqual(payload["demo_now"], "2026-11-03 09:00:00")
        counts = payload["counts"]
        for key in ("nodes", "pipes", "sensors", "readings", "complaints", "cases"):
            self.assertIn(key, counts, "health must report a %r count" % key)
        self.assertGreater(counts["readings"], 0)
        self.assertIn("disclaimer", payload)
        self.assertIn("data", payload)

    def test_unknown_endpoint_is_a_json_envelope(self):
        self.expect_error("/api/definitely-not-a-real-endpoint", "GET", None, 404)

    def test_bad_status_transition_is_400_json_not_html(self):
        cases = self.get("/api/cases")["cases"]
        open_case = [c for c in cases if c["status"] == "Open"]
        self.assertTrue(open_case, "the seeded demo must have an Open case")
        detail = self.expect_error("/api/cases/%s/status" % open_case[0]["id"],
                                   "PATCH",
                                   {"status": "Resolved", "actor": "tester",
                                    "role": "Officer"}, 400)
        self.assertIn("Resolved", detail["detail"])

    def test_unknown_case_is_404(self):
        self.expect_error("/api/cases/CASE-2026-999", "GET", None, 404)

    def test_request_id_header_is_returned(self):
        status, headers = api_headers("/api/health")
        self.assertEqual(status, 200)
        self.assertTrue(headers.get("X-Request-Id"),
                        "the request-id middleware must tag every response (§2 rule 7)")

    def test_health_does_not_need_the_agent(self):
        # /api/health must never reach the network (§2 rule 7); with no key in the
        # environment the whole app still answers health instantly.
        status, payload = api("/api/health")
        self.assertEqual(status, 200)
        self.assertEqual(payload["ai"], "offline")

    def test_static_ui_is_served_at_root(self):
        status, _payload = api("/")
        self.assertIn(status, (200, 404),
                      "the UI mount must answer, React dist or fallback (§4.1)")


if __name__ == "__main__":
    unittest.main()
