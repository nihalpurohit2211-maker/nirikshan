"""Workstream C gate — POST /api/ask.

The three things this file insists on: the offline answer is real (its numbers are
the engine's, read from the same endpoints the UI uses), every answer carries a
citation, and a provider that invents a digit loses its whole rewrite.

`_Stub`/`_use` mirror backend/tests/test_agent.py: the tests share the process with
the in-process uvicorn, so installing a fake provider on `backend.agent` reaches the
endpoint without any network call.
"""

import os
import unittest

from backend import agent
from backend.tests.base import NirikshanTest, api

_ENV_KEYS = ("LLM_PROVIDER", "LLM_API_KEY", "LLM_MODEL", "LLM_BASE_URL")

QUESTIONS = [
    "Why is Ward 3 unsafe?",
    "Which standard covers turbidity?",
    "Which branch is running out of chlorine?",
    "What should the officer do first?",
    "hello there",
]


class _Stub(agent.Provider):
    name = "stub"

    def __init__(self, reply=None, error=None):
        self.reply = reply
        self.error = error
        self.calls = []

    def chat(self, system, user, json_mode=False):
        self.calls.append((system, user, json_mode))
        if self.error:
            raise self.error
        return self.reply


def _use(stub):
    """Install `stub` as the configured provider; returns the restore callable."""
    saved_get, saved_mode = agent.get_provider, agent.provider_mode
    saved_cache, saved_flag = dict(agent._provider_cache), agent._degraded["flag"]
    agent._provider_cache.clear()
    agent._degraded["flag"] = False
    agent.get_provider = lambda: stub

    def mode():
        return "offline" if isinstance(agent.get_provider(), agent.OfflineProvider) \
            or agent._degraded["flag"] else "online"
    agent.provider_mode = mode

    def restore():
        agent.get_provider, agent.provider_mode = saved_get, saved_mode
        agent._provider_cache.clear()
        agent._provider_cache.update(saved_cache)
        agent._degraded["flag"] = saved_flag
    return restore


class AskOfflineTest(NirikshanTest):
    """The endpoint answers with no provider configured — the demo's normal state."""

    def ask(self, question, case_id=None):
        body = {"question": question}
        if case_id:
            body["case_id"] = case_id
        return self.post("/api/ask", body)

    def test_answer_shape_is_offline_and_cited(self):
        out = self.ask("Why is Ward 3 unsafe?")
        for key in ("answer", "citations", "provider"):
            self.assertIn(key, out, "the response must carry answer/citations/provider")
        self.assertTrue(out["answer"].strip(), "the answer must not be blank")
        self.assertEqual(out["provider"], "offline")
        self.assertTrue(out["citations"], "every answer needs at least one citation")

    def test_citations_are_only_the_three_documented_kinds(self):
        for question in QUESTIONS:
            out = self.ask(question)
            for cite in out["citations"]:
                self.assertIn(cite["kind"], ("doc", "case", "node"),
                              "%s: unexpected citation %r" % (question, cite))
                if cite["kind"] == "doc":
                    self.assertEqual(cite["doc"], "docs/is10500_excerpt.txt")
                    self.assertIsInstance(cite["line"], int)
                    self.assertGreater(cite["line"], 0)
                    self.assertTrue(cite["quote"].strip())
                else:
                    self.assertTrue(cite["id"])
                    self.assertEqual(cite["href"], "#/%ss/%s"
                                     % ("case" if cite["kind"] == "case" else "node",
                                        cite["id"]))

    def test_ward_answer_carries_the_served_numbers(self):
        worst = self.get("/api/overview")["kpis"]["worst_wqi"]
        node = self.get("/api/nodes/zone_3")
        served_score = str(node["wqi"]["score"])
        served_turbidity = str(node["latest"]["turbidity_ntu"])
        self.assertEqual(worst["node_id"], "zone_3")

        answer = self.ask("Why is Ward 3 unsafe?")["answer"]
        self.assertIn(served_score, answer,
                      "the answer must quote the WQI the engine serves (%s)"
                      % served_score)
        self.assertIn(served_turbidity, answer,
                      "the breached turbidity must be the served reading")
        self.assertIn(node["wqi"]["band"], answer)
        self.assertNotIn("123456", answer, "an invented placeholder number leaked in")

    def test_standard_answer_quotes_the_excerpt_line(self):
        out = self.ask("Which standard covers turbidity?")
        doc = [c for c in out["citations"] if c["kind"] == "doc"]
        self.assertTrue(doc, "a standards question must cite the excerpt")
        with open(os.path.join(os.path.dirname(os.path.dirname(
                os.path.dirname(os.path.abspath(__file__)))), doc[0]["doc"]),
                  encoding="utf-8") as fh:
            lines = fh.read().splitlines()
        self.assertIn("Turbidity", lines[doc[0]["line"] - 1],
                      "the cited line number must actually be the turbidity row")
        self.assertEqual(out["citations"][0]["quote"], lines[doc[0]["line"] - 1].strip())
        self.assertIn(doc[0]["quote"].split()[0], out["answer"])

    def test_chlorine_answer_uses_the_forecast_payload(self):
        fc = self.get("/api/nodes/zone_5/forecast")
        out = self.ask("Which branch is running out of chlorine?")
        self.assertIn(str(fc["current"]), out["answer"])
        self.assertIn(str(fc["limit"]), out["answer"])
        if fc["crossing_hours"] is None:
            self.assertIn("no crossing", out["answer"])
            self.assertIn(str(fc["horizon_hours"]), out["answer"])
        else:
            self.assertIn(str(fc["crossing_hours"]), out["answer"])
        self.assertTrue([c for c in out["citations"] if c["kind"] == "node"])

    def test_officer_answer_names_the_top_case_from_the_served_list(self):
        cases = self.get("/api/cases")["cases"]
        open_rows = [c for c in cases if c["status"] != "Resolved"]
        top = next(c for c in open_rows if c["severity"] == "Emergency") \
            if any(c["severity"] == "Emergency" for c in open_rows) else open_rows[0]
        out = self.ask("What should the officer do first?")
        self.assertIn(top["id"], out["answer"],
                      "the ranked top case is the engine's, not the page's")
        self.assertTrue([c for c in out["citations"] if c["kind"] == "case"])

    def test_case_id_deep_link_is_answered_about_that_case(self):
        case = [c for c in self.get("/api/cases")["cases"]
                if c["domain"] == "water" and c["status"] != "Resolved"][0]
        out = self.ask("Explain this case", case["id"])
        self.assertIn(case["id"], out["answer"])
        self.assertIn(case["id"], [c.get("id") for c in out["citations"]])

    def test_a_really_long_question_still_answers(self):
        out = self.ask("why is ward 3 unsafe " + "and what about the pipes " * 40)
        self.assertTrue(out["answer"].strip())
        self.assertEqual(out["provider"], "offline")

    def test_missing_question_is_a_json_envelope_422(self):
        self.expect_error("/api/ask", "POST", {}, 422)


class AskProviderTest(NirikshanTest):
    """The rewrite is cosmetic: a number it was not given costs it the whole answer."""

    def ask(self, question):
        status, payload = api("/api/ask", method="POST", body={"question": question})
        self.assertEqual(status, 200)
        return payload

    def test_invented_number_is_rejected_and_offline_text_returns(self):
        restore = _use(_Stub(reply="the WQI is 999"))
        try:
            out = self.ask("Why is Ward 3 unsafe?")
            self.assertNotIn("999", out["answer"],
                             "a rewrite that invents a number must be discarded")
            self.assertTrue(out["answer"].strip())
            self.assertIn("Ward 3", out["answer"])
        finally:
            restore()

    def test_faithful_rewrite_is_kept(self):
        offline = self.ask("Why is Ward 3 unsafe?")["answer"]
        score = [t for t in offline.replace(",", " ").split() if "." in t]
        self.assertTrue(score, "the offline answer should contain a decimal figure")
        stub = _Stub(reply="Ward 3 reads Unsafe at %s." % score[0])
        restore = _use(stub)
        try:
            out = self.ask("Why is Ward 3 unsafe?")
            self.assertEqual(out["provider"], "online")
            self.assertIn("Ward 3 reads Unsafe", out["answer"])
            self.assertEqual(len(stub.calls), 1, "one rewrite call, no retry loop")
        finally:
            restore()

    def test_provider_failure_falls_back_without_leaking(self):
        restore = _use(_Stub(error=RuntimeError("429 rate limited")))
        try:
            out = self.ask("What should the officer do first?")
            self.assertEqual(out["provider"], "offline")
            self.assertTrue(out["answer"].strip())
            self.assertNotIn("429", out["answer"])
            self.assertTrue(out["citations"])
        finally:
            restore()


if __name__ == "__main__":
    unittest.main()
