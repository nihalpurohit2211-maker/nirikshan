"""Gate 3 test — the agent contract (§8.6).

The tests run in the same process as the in-process uvicorn, so a fake provider can
be installed on `backend.agent` and the real endpoints will use it. Nothing here ever
touches the network: the offline path is asserted, and the "online" path is a canned
string from a stub.
"""

import base64
import os
import unittest

from backend import agent
from backend.tests.base import NirikshanTest, api

_ENV_KEYS = ("LLM_PROVIDER", "LLM_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY",
             "OPENAI_API_KEY", "LLM_MODEL", "LLM_BASE_URL")


def _set_env(key, value):
    if value is None:
        os.environ.pop(key, None)
    else:
        os.environ[key] = value


class _Stub(agent.Provider):
    """A provider whose replies are fixed; `error` makes every call fail."""

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
    saved_get, saved_cache = agent.get_provider, dict(agent._provider_cache)
    agent._provider_cache.clear()
    agent._degraded["flag"] = False
    agent._degraded["error"] = ""
    agent._degraded["failure_count"] = 0
    agent._degraded["last_failure_ts"] = None
    agent.get_provider = lambda: stub
    saved_mode = agent.provider_mode

    def mode():
        return "offline" if isinstance(agent.get_provider(), agent.OfflineProvider) \
            or agent._degraded["flag"] else "online"
    agent.provider_mode = mode

    def restore():
        agent.get_provider = saved_get
        agent._provider_cache.clear()
        agent._provider_cache.update(saved_cache)
        agent.provider_mode = saved_mode
        agent._degraded["flag"] = False
        agent._degraded["error"] = ""
        agent._degraded["failure_count"] = 0
        agent._degraded["last_failure_ts"] = None
    return restore


class CallContractTest(unittest.TestCase):
    """§8.3: one retry, then offline — and nothing ever raises."""

    def test_success_is_reported_online(self):
        stub = _Stub(reply="paraphrased text")
        restore = _use(stub)
        try:
            text, mode = agent.call("sys", "user")
            self.assertEqual(text, "paraphrased text")
            self.assertEqual(mode, "online")
            self.assertEqual(len(stub.calls), 1)
        finally:
            restore()

    def test_exactly_one_retry_then_offline(self):
        stub = _Stub(error=RuntimeError("boom"))
        restore = _use(stub)
        try:
            text, mode = agent.call("sys", "user")
            self.assertIsNone(text)
            self.assertEqual(mode, "offline")
            self.assertEqual(len(stub.calls), 2, "one retry, not a retry loop")
        finally:
            restore()

    def test_failure_detail_is_kept_without_the_key(self):
        stub = _Stub(error=RuntimeError("boom"))
        restore = _use(stub)
        try:
            agent.call("sys", "user")
            self.assertIn("RuntimeError: boom", agent.provider_detail())
            stub.error = None
            stub.reply = "recovered"
            text, mode = agent.call("sys", "user")
            self.assertEqual((text, mode), ("recovered", "online"))
            self.assertEqual(agent.provider_detail(), "")
        finally:
            restore()

    def test_empty_completion_also_falls_back(self):
        stub = _Stub(reply="")
        restore = _use(stub)
        try:
            text, mode = agent.call("sys", "user")
            self.assertIsNone(text)
            self.assertEqual(mode, "offline")
        finally:
            restore()

    def test_json_is_parsed_out_of_a_fenced_reply(self):
        reply = 'Sure!\n```json\n{"category": "dust", "location_hint": "Main Rd",\n' \
                ' "severity_hint": "low", "duration_days": null, "area_m2": null}\n```'
        stub = _Stub(reply=reply)
        restore = _use(stub)
        try:
            out = agent.extract_complaint("the factory burns plastic")
            self.assertEqual(out["category"], "dust")
            self.assertEqual(out["location_hint"], "Main Rd")
        finally:
            restore()

    def test_model_duration_must_be_a_standalone_text_token(self):
        # "5" is not a token of "since 15 days" -> the offline value (15) wins.
        stub = _Stub(reply='{"category": "muddy/turbid water", "location_hint": null,'
                         ' "severity_hint": "low", "duration_days": 5, "area_m2": null}')
        restore = _use(stub)
        try:
            out = agent.extract_complaint("the tap water has been brown since 15 days")
            self.assertEqual(out["duration_days"], 15)
        finally:
            restore()

    def test_model_area_must_be_a_standalone_text_token(self):
        # "30" is not a token of "about 300 sq m" -> the offline value (300.0) wins.
        stub = _Stub(reply='{"category": "open waste dump", "location_hint": null,'
                         ' "severity_hint": "low", "duration_days": null, "area_m2": 30}')
        restore = _use(stub)
        try:
            out = agent.extract_complaint("garbage heap near the school since 12 days, "
                                          "about 300 sq m")
            self.assertEqual(out["area_m2"], 300.0)
        finally:
            restore()

    def test_circuit_breaker_skips_dead_provider(self):
        stub = _Stub(error=RuntimeError("boom"))
        restore = _use(stub)
        try:
            # three consecutive failed calls open the circuit (2 attempts each)
            for _ in range(3):
                text, mode = agent.call("sys", "user")
                self.assertIsNone(text)
                self.assertEqual(mode, "offline")
            self.assertEqual(len(stub.calls), 6)
            # fourth call skips the provider entirely while the circuit is open
            text, mode = agent.call("sys", "user")
            self.assertIsNone(text)
            self.assertEqual(mode, "offline")
            self.assertEqual(len(stub.calls), 6, "provider not called while open")
        finally:
            restore()


class OfflineAgentTest(unittest.TestCase):
    """§8.6 bullet 1: offline extraction is valid, deterministic, no network."""

    def test_muddy_water_text(self):
        out = agent.extract_complaint("The water from my tap is brown and muddy "
                                      "since 5 days and children got sick")
        self.assertEqual(out["category"], "muddy/turbid water")
        self.assertEqual(out["duration_days"], 5)
        self.assertIsNone(out["area_m2"])
        self.assertIsNone(out["location_hint"])
        self.assertIn(out["severity_hint"], ("low", "medium", "high"))
        self.assertEqual(out["severity_hint"], "high")   # "children ... sick"

    def test_garbage_since_12_days(self):
        out = agent.extract_complaint("garbage heap near the school since 12 days, "
                                      "about 300 sq m")
        self.assertEqual(out["category"], "open waste dump")
        self.assertEqual(out["duration_days"], 12)
        self.assertEqual(out["area_m2"], 300.0)

    def test_every_field_is_always_present(self):
        keys = {"category", "location_hint", "severity_hint", "duration_days", "area_m2"}
        for text in ("", "help", "no water since 2 days", "dust from demolition"):
            self.assertEqual(set(agent.extract_complaint(text)), keys)

    def test_offline_keyword_map_follows_8_5_order(self):
        # §8.5 maps dust/smoke to air pollution; only a model refines it to "dust".
        cases = {
            "brown water since 5 days": "muddy/turbid water",
            "the tap water has a foul smell": "bad smell",
            "there is no water at all in the morning": "no/low pressure",
            "dust from the demolition site": "air pollution",
            "garbage since 12 days": "open waste dump",
            "soil erosion after the rain": "soil erosion",
            "my child was vomiting and had stomach pain": "stomach illness reported",
            "i saw a worm floating in the tank": "suspected contamination",
            "the water tastes salty": "bad taste",
        }
        for text, category in cases.items():
            self.assertEqual(agent.extract_complaint(text)["category"], category,
                             "%r should be %s" % (text, category))

    def test_hair_is_not_air(self):
        # The matcher is word-aware, so short needles cannot fire inside other words.
        self.assertEqual(agent.extract_complaint("the plumber cut my hair")["category"],
                         "other")

    def test_wastewater_is_not_a_dump(self):
        self.assertEqual(agent.extract_complaint("wastewater smells bad")["category"],
                         "bad smell")

    def test_numbers_are_extracted_by_regex_only(self):
        out = agent.extract_complaint("muddy water covering 1200 sqm since 3 days")
        self.assertEqual(out["duration_days"], 3)
        self.assertEqual(out["area_m2"], 1200.0)
        self.assertIsNone(agent.extract_complaint("muddy water")["area_m2"])

    def test_unknown_text_falls_to_other(self):
        self.assertEqual(agent.extract_complaint("qwerty")["category"], "other")

    def test_templates_quote_only_evidence_numbers(self):
        case = {"id": "CASE-2026-003", "domain": "water", "node_id": "zone_3"}
        evidence = {"complaints": ["CMP011"] * 5,
                    "readings": {"turbidity_ntu": 8.96, "residual_chlorine_mgl": 0.038},
                    "limits": {"turbidity_ntu": 1.0},
                    "rule": "PLACE ward 3 -> lca(buildings)"}
        text = agent._offline_explain(case, evidence, [
            {"parameter": "Turbidity (NTU)", "citation": "IS 10500:2012 Cl. 5"}])
        self.assertIn("5 complaints", text)
        self.assertIn("8.96", text)
        self.assertIn("against the standard's 1.0", text)
        self.assertIn("lca(buildings)", text)
        self.assertIn("IS 10500:2012", text)
        self.assertIn("human officer must verify", text.lower())
        # A reading with no limit in the evidence is quoted as a measurement only:
        # §8.4 forbids the agent from stating a limit it was not given.
        self.assertIn("residual chlorine mgl is 0.038", text)
        self.assertNotIn("chlorine mgl is 0.038 against", text)

    def test_daily_report_uses_snapshot_numbers(self):
        snapshot = {"demo_now": "2026-11-03 09:00:00",
                    "kpis": {"open_cases": 6, "complaints_24h": 3,
                             "worst_wqi": {"score": 94.4, "band": "Unsafe",
                                           "name": "Ward 3"},
                             "worst_aqi": {"value": 313, "category": "Very Poor",
                                           "name": "air_08"}},
                    "triage": [{"id": "CASE-2026-004", "domain": "water",
                                "node_id": "zone_4", "severity": "Emergency",
                                "status": "Open", "title": "Supply loss"}]}
        text = agent._offline_daily(snapshot)
        self.assertEqual(len([ln for ln in text.splitlines() if ln.isupper()]), 5)
        self.assertIn("94.4 Unsafe", text)
        self.assertIn("CASE-2026-004", text)
        self.assertIn("DRAFT", text)

    def test_offline_provider_never_chats(self):
        offline = agent.OfflineProvider()
        with self.assertRaises(agent.NotSupported):
            offline.chat("sys", "user")
        with self.assertRaises(agent.NotSupported):
            offline.vision("sys", "text", b"x")


class ProviderSelectionTest(unittest.TestCase):
    """§8.2: the environment decides, and no key always means offline."""

    def setUp(self):
        self._saved = {k: os.environ.get(k) for k in _ENV_KEYS}
        for key in _ENV_KEYS:
            _set_env(key, None)
        agent._provider_cache.clear()

    def tearDown(self):
        for key, value in self._saved.items():
            _set_env(key, value)
        agent._provider_cache.clear()
        agent._degraded["flag"] = False

    def test_defaults_to_offline(self):
        self.assertIsInstance(agent.build_provider(), agent.OfflineProvider)
        self.assertEqual(agent.provider_mode(), "offline")

    def test_gemini_without_key_is_offline(self):
        _set_env("LLM_PROVIDER", "gemini")
        self.assertIsInstance(agent.build_provider(), agent.OfflineProvider)

    def test_gemini_with_key(self):
        _set_env("LLM_PROVIDER", "gemini")
        _set_env("LLM_API_KEY", "fake-key")
        provider = agent.build_provider()
        self.assertIsInstance(provider, agent.GeminiProvider)
        self.assertEqual(provider.model, "gemini-3.5-flash-lite")

    def test_gemini_sends_key_in_a_header_not_the_url(self):
        provider = agent.GeminiProvider("secret-key")
        seen = {}

        def fake_post(url, payload, headers=None):
            seen["url"] = url
            seen["headers"] = headers or {}
            return {"candidates": [{"content": {"parts": [{"text": "ok"}]}}]}

        provider._post = fake_post
        self.assertEqual(provider.chat("system", "user"), "ok")
        self.assertNotIn("secret-key", seen["url"])
        self.assertEqual(seen["headers"].get("x-goog-api-key"), "secret-key")

    def test_gemini_accepts_gemini_api_key_alias(self):
        _set_env("LLM_PROVIDER", "gemini")
        _set_env("GEMINI_API_KEY", "fake-gemini-key")
        provider = agent.build_provider()
        self.assertIsInstance(provider, agent.GeminiProvider)
        self.assertEqual(provider.key, "fake-gemini-key")

    def test_llm_api_key_wins_over_provider_alias(self):
        _set_env("LLM_PROVIDER", "gemini")
        _set_env("LLM_API_KEY", "primary-key")
        _set_env("GEMINI_API_KEY", "alias-key")
        provider = agent.build_provider()
        self.assertIsInstance(provider, agent.GeminiProvider)
        self.assertEqual(provider.key, "primary-key")

    def test_openai_with_model(self):
        _set_env("LLM_PROVIDER", "openai")
        _set_env("LLM_API_KEY", "fake-key")
        _set_env("LLM_MODEL", "llama-3.3-70b-versatile")
        provider = agent.build_provider()
        self.assertIsInstance(provider, agent.OpenAICompatProvider)
        self.assertTrue(provider.base.endswith("/v1"))

    def test_openai_without_model_is_offline(self):
        _set_env("LLM_PROVIDER", "openai")
        _set_env("LLM_API_KEY", "fake-key")
        self.assertIsInstance(agent.build_provider(), agent.OfflineProvider)


class EndpointAgentTest(NirikshanTest):
    """§8.6 bullets 2 and 3, through the real HTTP endpoints."""

    def _water_case(self):
        cases = [c for c in self.get("/api/cases")["cases"]
                 if c["domain"] == "water" and c["status"] != "Resolved"]
        return sorted(cases, key=lambda c: c["id"])[0]

    def test_draft_with_offline_provider_is_stamped_draft(self):
        case = self._water_case()
        status, payload = api("/api/cases/%s/draft" % case["id"], method="POST")
        self.assertEqual(status, 200)
        self.assertEqual(payload["status"], "DRAFT")
        self.assertEqual(payload["ai"], "offline")
        self.assertTrue(payload["text"].strip())
        self.assertIn("DRAFT", payload["text"])

    def test_canned_provider_text_reaches_the_draft(self):
        restore = _use(_Stub(reply="Boil the water in Ward 3 until the crew reports."))
        try:
            case = self._water_case()
            payload = self.post("/api/cases/%s/draft" % case["id"])
            self.assertEqual(payload["status"], "DRAFT")
            self.assertEqual(payload["ai"], "online")
            self.assertIn("Boil the water in Ward 3", payload["text"])
            self.assertIn("not an official regulatory decision",
                          payload["explanation"])
        finally:
            restore()

    def test_provider_failure_falls_back_without_leaking(self):
        restore = _use(_Stub(error=RuntimeError("429 rate limited")))
        try:
            case = self._water_case()
            payload = self.post("/api/cases/%s/draft" % case["id"])
            self.assertEqual(payload["status"], "DRAFT")
            self.assertEqual(payload["ai"], "offline")
            self.assertTrue(payload["text"].strip())
            self.assertNotIn("429", payload["text"])
        finally:
            restore()

    def test_extraction_merges_the_model_answer(self):
        reply = '{"category": "suspected contamination", "location_hint": "Lane 4",' \
                ' "severity_hint": "high", "duration_days": 5, "area_m2": null}'
        restore = _use(_Stub(reply=reply))
        try:
            payload = self.post("/api/complaints", {
                "domain": "water", "node_id": "B11",
                "text": "the tap water has been brown since 5 days"})
            self.assertEqual(payload["suggestion"]["category"],
                             "suspected contamination")
            self.assertEqual(payload["suggestion"]["location_hint"], "Lane 4")
            self.assertEqual(payload["suggestion"]["duration_days"], 5)
        finally:
            restore()

    def test_invented_numbers_are_dropped(self):
        reply = '{"category": "muddy/turbid water", "location_hint": null,' \
                ' "severity_hint": "medium", "duration_days": 99, "area_m2": 4000}'
        restore = _use(_Stub(reply=reply))
        try:
            out = agent.extract_complaint("brown water since 5 days")
            self.assertEqual(out["duration_days"], 5)     # 99 was never in the text
            self.assertIsNone(out["area_m2"])
        finally:
            restore()

    def test_daily_report_endpoints_answer_offline(self):
        payload = self.post("/api/reports/daily")
        self.assertEqual(payload["status"], "DRAFT")
        self.assertEqual(payload["ai"], "offline")
        self.assertTrue(payload["text"].strip())

    def test_health_never_calls_the_provider(self):
        restore = _use(_Stub(error=RuntimeError("unreachable")))
        try:
            status, payload = api("/api/health")
            self.assertEqual(status, 200)
            self.assertEqual(payload["status"], "ok")
        finally:
            restore()

    def test_land_report_without_an_upload_has_no_vision(self):
        payload = self.post("/api/land/reports", {
            "node_id": "land_05", "category": "Open waste dump",
            "text": "garbage pile growing near the school since 12 days"})
        self.assertIsNone(payload["vision"])

    def test_upload_is_stored_and_described_from_metadata_offline(self):
        png = base64.b64encode(b"\x89PNG\r\n\x1a\n" + b"0" * 32).decode()
        payload = self.post("/api/land/reports", {
            "node_id": "land_05", "category": "Open waste dump",
            "text": "photo of the dump", "image": "data:image/png;base64," + png})
        vision = payload["vision"]
        self.assertFalse(vision["analysed"])     # offline: metadata only
        self.assertEqual(vision["ai"], "offline")
        self.assertEqual(vision["bytes"], 40)
        image_url = payload["complaint"]["image_path"]
        self.assertTrue(image_url.startswith("data/images/upload_CMP"))
        status, _ = api("/" + image_url)
        self.assertEqual(status, 200, "the stored upload must be servable")
        # The stored file is left in data/images/ on purpose: Windows will not let a
        # running StaticFiles handle be unlinked, and the path is gitignored (it is
        # user data, like nirikshan.db). The complaint row itself dies with the temp DB.

    def test_non_upload_image_string_is_stored_as_a_path(self):
        payload = self.post("/api/land/reports", {
            "node_id": "land_05", "category": "Open waste dump",
            "text": "reference to a sample image",
            "image": "data/images/garbage_heap.svg"})
        self.assertIsNone(payload["vision"])
        self.assertEqual(payload["complaint"]["image_path"],
                         "data/images/garbage_heap.svg")


if __name__ == "__main__":
    unittest.main()
