"""Gate 2 test — the identity engine: idempotency, scenarios, status whitelist."""

import unittest

from backend.tests.base import NirikshanTest, api


class ClusterTest(NirikshanTest):

    def run_cluster(self):
        return self.post("/api/cluster/run")

    def open_case_ids(self):
        return sorted(c["id"] for c in self.get("/api/cases")["cases"]
                      if c["status"] != "Resolved")

    def total_actions(self):
        total = 0
        for cid in self.open_case_ids():
            total += len(self.get("/api/cases/%s" % cid)["actions"])
        return total

    def test_two_runs_give_the_same_cases_and_actions(self):
        """§2 rule 5: clustering is idempotent — same case set, no new actions."""
        self.run_cluster()
        first_ids, first_actions = self.open_case_ids(), self.total_actions()
        again = self.run_cluster()
        self.assertEqual(again["created"], [],
                         "a second run must not create anything: %s"
                         % [c["id"] for c in again["created"]])
        self.assertEqual(self.open_case_ids(), first_ids)
        self.assertEqual(self.total_actions(), first_actions)

    def test_s1_collapses_five_complaints_into_one_case(self):
        self.run_cluster()
        cases = [c for c in self.get("/api/cases")["cases"]
                 if c["domain"] == "water" and c["node_id"] == "zone_3"
                 and c["status"] != "Resolved"]
        self.assertEqual(len(cases), 1)
        detail = self.get("/api/cases/%s" % cases[0]["id"])
        self.assertEqual(len(detail["complaints"]), 5)
        self.assertEqual(detail["case"]["severity"], "High")
        self.assertEqual(detail["case"]["scope"], "MUNICIPAL")
        # the identity rule is stated in the evidence, not hidden in the UI
        self.assertIn("PLACE", detail["evidence"]["rule"])

    def test_every_water_case_names_its_own_ward(self):
        # Regression: the rule string once reported a leaked loop variable, so a
        # zone_3 case claimed "PLACE ward zone_5" in front of the judge.
        self.run_cluster()
        parents = {}
        for node in self.get("/api/network")["nodes"]:
            if node["parent_id"]:
                parents[node["id"]] = node["parent_id"]
        for case in self.get("/api/cases")["cases"]:
            if case["domain"] != "water" or case["status"] == "Resolved":
                continue
            rule = case["evidence"].get("rule") or ""
            if "PLACE ward" not in rule:
                continue
            cited = rule.split("PLACE ward ")[1].split(" ->")[0].strip()
            wards = {parents.get(b, b) for b in case["evidence"]["buildings"]}
            self.assertIn(cited, wards,
                          "%s cites ward %s but its buildings are in %s"
                          % (case["id"], cited, sorted(wards)))

    def test_s5_is_building_side_not_municipal(self):
        self.run_cluster()
        cases = [c for c in self.get("/api/cases")["cases"] if c["node_id"] == "B11"]
        self.assertEqual(len(cases), 1)
        self.assertEqual(cases[0]["scope"], "BUILDING_SIDE")
        self.assertEqual(cases[0]["severity"], "Low")

    def test_s2_is_the_emergency(self):
        self.run_cluster()
        emergency = [c for c in self.get("/api/cases")["cases"]
                     if c["severity"] == "Emergency"]
        self.assertEqual(len(emergency), 1)
        self.assertEqual(emergency[0]["domain"], "water")
        self.assertIn("supply loss", emergency[0]["title"].lower())

    def test_n0_routine_complaints_stay_out(self):
        self.run_cluster()
        for node in ("B42", "air_03", "land_12"):
            self.assertFalse([c for c in self.get("/api/cases")["cases"]
                              if c["node_id"] == node and c["status"] != "Resolved"])

    def test_status_whitelist(self):
        """Open -> Investigating -> Action Taken -> Resolved, one step at a time."""
        self.run_cluster()
        case = [c for c in self.get("/api/cases")["cases"]
                if c["node_id"] == "zone_3" and c["scope"] == "MUNICIPAL"
                and c["status"] != "Resolved"][0]
        cid = case["id"]
        self.expect_error("/api/cases/%s/status" % cid, "PATCH",
                          {"status": "Action Taken", "actor": "tester"}, 400)
        self.expect_error("/api/cases/%s/status" % cid, "PATCH",
                          {"status": "Open", "actor": "tester"}, 400)
        result = api("/api/cases/%s/status" % cid, method="PATCH",
                     body={"status": "Investigating", "actor": "A. Officer",
                           "role": "Ward officer", "note": "site visit"})
        self.assertEqual(result[0], 200, result[1])
        self.assertEqual(result[1]["case"]["status"], "Investigating")
        actions = self.get("/api/cases/%s" % cid)["actions"]
        self.assertTrue(any(a["action"].startswith("Status ->") for a in actions),
                        "a status change must write a case action")
        self.assertTrue(any(a["actor"] == "A. Officer" for a in actions))

    def test_overdue_flag_on_a_stagnant_high_case(self):
        self.run_cluster()
        case = [c for c in self.get("/api/cases")["cases"]
                if c["severity"] in ("High", "Emergency")
                and c["status"] != "Resolved"][0]
        # Seeded demo clock is 09:00 and the cases were created at 09:00, so
        # nothing is overdue yet; the flag must still be present for the UI.
        self.assertIn("overdue", case)

    def test_trace_finds_the_old_main(self):
        self.run_cluster()
        case = [c for c in self.get("/api/cases")["cases"]
                if c["node_id"] == "zone_3" and c["scope"] == "MUNICIPAL"
                and c["status"] != "Resolved"][0]
        trace = self.get("/api/trace/%s" % case["id"])
        self.assertEqual(trace["path"][0], "zone_3")
        self.assertEqual(trace["path"][-1], "plant_n")
        self.assertTrue(trace["hops"] >= 4)
        # The whole demo claim: the pipe the physics picks is the 1991 CI main
        # between J02 and J03, not merely the chronologically oldest trunk pipe.
        self.assertEqual(trace["worst_pipe"]["install_year"], 1991)
        self.assertEqual(trace["worst_pipe"]["material"], "CI")
        self.assertIn("1991", trace["explanation"])
        self.assertIn("P048", trace["explanation"])
        inspection = self.get("/api/nodes/J03")["maintenance"]
        self.assertTrue(any("1991" in (m["result"] or "") for m in inspection),
                        "the logged J03 inspection should corroborate the trace")


if __name__ == "__main__":
    unittest.main()
