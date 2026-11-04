"""The AI layer (PLAN.md §8) — provider-agnostic, stdlib-only, never in charge.

Everything here is *advisory*: the agent turns free text into the fields the rules
engine already computes, and turns computed evidence into prose a human can read.
No branch of this module decides a severity, a status, or a case — `rules.py`
does, from the config and the readings (§2 rule 9: LLM never decides).

Contract that keeps the demo alive (§8.3, unbreakable):
  any exception, non-200, missing key or timeout -> ONE retry -> OfflineProvider.
`provider_mode()` reports what actually happened so the UI can badge "online" or
"offline", and `/api/health` never touches the network.
"""

import json
import logging
import os
import re
import urllib.error
import urllib.request

log = logging.getLogger("nirikshan.agent")

GEMINI_BASE = "https://generativelanguage.googleapis.com"
DEFAULT_BASE_URL = "https://api.groq.com/openai/v1"      # §8.2 table
DEFAULT_GEMINI_MODEL = "gemini-2.5-flash"
TIMEOUT_DEFAULT = 15

# The enum from the §8.4 extraction prompt. Kept as data so the offline keyword
# map and the online prompt can never drift apart.
CATEGORIES = [
    "muddy/turbid water", "bad smell", "bad taste", "no/low pressure",
    "suspected contamination", "stomach illness reported", "air pollution",
    "dust", "open waste dump", "soil erosion", "other",
]

DISCLAIMER_SUFFIX = ("This explanation supports human judgment and is not an "
                     "official regulatory decision.")

# ---------------------------------------------------------------------------
# §8.4 prompts, verbatim
# ---------------------------------------------------------------------------

SYSTEM_EXTRACTION = """You extract structured fields from citizen complaints about environmental issues.
Return STRICT JSON: {"category": one of [muddy/turbid water, bad smell, bad taste,
no/low pressure, suspected contamination, stomach illness reported, air pollution,
dust, open waste dump, soil erosion, other], "location_hint": string or null,
"severity_hint": low|medium|high, "duration_days": number or null, "area_m2": number or null}.
Never invent numbers the user did not give. Use null when unsure."""

SYSTEM_EXPLAINATION = """You explain an automated water/air/land quality assessment to a municipal officer.
You may ONLY paraphrase the provided standard rows and the provided evidence.
Never state a limit, number, or verdict that is not in the provided text.
End with: "This explanation supports human judgment and is not an official regulatory decision." """

SYSTEM_ADVISORY = """Draft a short public advisory (boil-water / stay-indoors / waste-removal)
for the incident described in the provided case evidence and standard rows.
3-5 sentences, plain language, no invented numbers. Say what people should do,
who is fixing it, and that a municipal officer has approved the wording."""

SYSTEM_DAILY = """Summarize the provided KPI numbers and case list into 5 bullet sections
(overview, water, air, land, what needs a human today). Use ONLY the numbers in the
provided text — no invented numbers, no predictions."""


class NotSupported(Exception):
    """This provider cannot do the modality that was asked for (e.g. vision)."""


# ---------------------------------------------------------------------------
# providers (§8.1)
# ---------------------------------------------------------------------------

class Provider:
    """One text call and one image call. Implementations must not raise on
    transport failure — that is `call()`'s job — but may raise NotSupported."""

    name = "provider"

    def chat(self, system, user, json_mode=False):
        raise NotImplementedError

    def vision(self, system, text, image_bytes, mime="image/jpeg"):
        raise NotSupported("%s has no vision" % self.name)


def _env():
    return {
        "provider": (os.environ.get("LLM_PROVIDER") or "offline").strip().lower(),
        "key": (os.environ.get("LLM_API_KEY") or "").strip(),
        "model": (os.environ.get("LLM_MODEL") or "").strip(),
        "base": (os.environ.get("LLM_BASE_URL") or "").strip(),
        "timeout": _timeout(),
    }


def _timeout():
    try:
        return float(os.environ.get("LLM_TIMEOUT") or TIMEOUT_DEFAULT)
    except ValueError:
        return float(TIMEOUT_DEFAULT)


class _HTTPProvider(Provider):
    """Shared POST + response-shape checking. Returns text or raises."""

    def _post(self, url, payload, headers=None):
        req = urllib.request.Request(
            url, data=json.dumps(payload).encode("utf-8"), method="POST")
        req.add_header("Content-Type", "application/json")
        for k, v in (headers or {}).items():
            req.add_header(k, v)
        with urllib.request.urlopen(req, timeout=_env()["timeout"]) as resp:
            if resp.status != 200:
                raise RuntimeError("provider returned %s" % resp.status)
            return json.loads(resp.read().decode("utf-8"))


class GeminiProvider(_HTTPProvider):
    """Native generateContent wire format (§8.3)."""

    name = "gemini"

    def __init__(self, key, model=None, base=GEMINI_BASE):
        self.key = key
        self.model = model or DEFAULT_GEMINI_MODEL
        self.base = base.rstrip("/")

    def _generate(self, parts, json_mode):
        cfg = {"temperature": 0}
        if json_mode:
            cfg["responseMimeType"] = "application/json"
        payload = {"contents": [{"role": "user", "parts": parts}],
                   "generationConfig": cfg}
        url = "%s/v1beta/models/%s:generateContent?key=%s" % (
            self.base, self.model, self.key)
        data = self._post(url, payload)
        try:
            return data["candidates"][0]["content"]["parts"][0]["text"]
        except (KeyError, IndexError, TypeError):
            raise RuntimeError("gemini response had no text part")

    def chat(self, system, user, json_mode=False):
        return self._generate([{"text": system + "\n\n" + user}], json_mode)

    def vision(self, system, text, image_bytes, mime="image/jpeg"):
        import base64
        parts = [{"text": system + "\n\n" + text},
                 {"inline_data": {"mime_type": mime,
                                  "data": base64.b64encode(image_bytes).decode()}}]
        return self._generate(parts, False)


class OpenAICompatProvider(_HTTPProvider):
    """/chat/completions — Groq, OpenRouter, DashScope/Qwen (§8.3)."""

    name = "openai"

    def __init__(self, key, model, base=DEFAULT_BASE_URL):
        self.key = key
        self.model = model
        self.base = base.rstrip("/")

    def _complete(self, content, json_mode):
        payload = {"model": self.model,
                   "messages": [{"role": "system", "content": content[0]},
                                {"role": "user", "content": content[1]}],
                   "temperature": 0}
        if json_mode:
            payload["response_format"] = {"type": "json_object"}
        data = self._post("%s/chat/completions" % self.base, payload,
                          headers={"Authorization": "Bearer " + self.key})
        try:
            return data["choices"][0]["message"]["content"]
        except (KeyError, IndexError, TypeError):
            raise RuntimeError("openai-compatible response had no message")

    def chat(self, system, user, json_mode=False):
        return self._complete([system, user], json_mode)

    def vision(self, system, text, image_bytes, mime="image/jpeg"):
        import base64
        user = [{"type": "text", "text": text},
                {"type": "image_url",
                 "image_url": {"url": "data:%s;base64,%s" % (
                     mime, base64.b64encode(image_bytes).decode())}}]
        return self._complete([system, user], False)


class OfflineProvider(Provider):
    """Deterministic keywords + templates (§8.5). Always works, needs no key."""

    name = "offline"

    def chat(self, system, user, json_mode=False):
        raise NotSupported("the offline provider does not do free-form chat")

    def vision(self, system, text, image_bytes, mime="image/jpeg"):
        raise NotSupported("offline vision is metadata only")


_OFFLINE = OfflineProvider()
_provider_cache = {}

# A network provider that just failed reports itself as offline until one call
# succeeds, so the UI badge tells the truth about the last answer it showed.
_degraded = {"flag": False}


def build_provider(env=None):
    """The provider the environment asks for, or OfflineProvider. No network here."""
    e = env or _env()
    if e["provider"] == "gemini" and e["key"]:
        return GeminiProvider(e["key"], e["model"] or None)
    if e["provider"] == "openai" and e["key"] and e["model"]:
        return OpenAICompatProvider(e["key"], e["model"],
                                   e["base"] or DEFAULT_BASE_URL)
    return _OFFLINE


def get_provider():
    """Env-driven, cached per env signature so a changed environment is picked up."""
    e = _env()
    signature = (e["provider"], bool(e["key"]), e["model"], e["base"])
    cached = _provider_cache.get("entry")
    if cached and cached[0] == signature:
        return cached[1]
    provider = build_provider(e)
    _provider_cache["entry"] = (signature, provider)
    return provider


def provider_mode():
    """"online" when a network provider is configured and healthy, else "offline"."""
    if _degraded["flag"]:
        return "offline"
    return "offline" if isinstance(get_provider(), OfflineProvider) else "online"


def _recover():
    """A successful call clears the degraded badge (see provider_mode)."""
    _degraded["flag"] = False


def call(system, user, json_mode=False):
    """ONE retry against the configured provider, then the offline provider (§8.3).

    Returns (text, mode). Never raises — a dead network is a normal demo state.
    """
    provider = get_provider()
    if isinstance(provider, OfflineProvider):
        return None, "offline"
    last_error = None
    for attempt in (1, 2):
        try:
            text = provider.chat(system, user, json_mode=json_mode)
            if text:
                _recover()
                return text, "online"
            last_error = RuntimeError("empty completion")
        except Exception as exc:                  # noqa: BLE001 - fall back, never leak
            last_error = exc
            log.warning("agent attempt %d failed (%s): %s",
                        attempt, provider.name, exc)
    _degraded["flag"] = True
    return None, "offline"


def call_vision(system, text, image_bytes, mime="image/jpeg"):
    """Same contract for an uploaded photo; offline answers with metadata only."""
    provider = get_provider()
    if isinstance(provider, OfflineProvider):
        return None, "offline"
    last_error = None
    for attempt in (1, 2):
        try:
            out = provider.vision(system, text, image_bytes, mime)
            if out:
                _recover()
                return out, "online"
            last_error = RuntimeError("empty vision completion")
        except NotSupported as exc:               # no retry: the shape cannot change
            last_error = exc
            break
        except Exception as exc:                  # noqa: BLE001
            last_error = exc
            log.warning("agent vision attempt %d failed: %s", attempt, exc)
    _degraded["flag"] = True
    log.info("vision fell back to metadata only (%s)", last_error)
    return None, "offline"


# ---------------------------------------------------------------------------
# §8.5 offline extraction
# ---------------------------------------------------------------------------

# §8.5 order, first match wins: muddy -> smell -> pressure -> dust/smoke -> waste ->
# erosion. The three rows after those are additive (the enum in §8.4 has eleven
# categories; §8.5 maps six of them). Matching is word-aware so "hair" is never
# "air" and "muddy" is a word, not a substring accident.
#   "term"        whole word, optional plural
#   "term*"       prefix (stems like contaminat-)
#   "two words"   phrase, substring
KEYWORDS = [
    ("muddy/turbid water", ("muddy", "turbid", "mud", "brown", "cloudy", "dirty water",
                            "yellow water", "sand", "particles")),
    ("bad smell", ("smell", "smelled", "smells", "odour", "odor", "stink", "sewage",
                   "rotten")),
    ("no/low pressure", ("pressure", "no water", "no supply", "low flow", "no flow",
                         "dry tap", "supply cut", "supply failure")),
    ("air pollution", ("dust", "smoke", "fume", "soot", "air pollution", "air quality",
                       "burning", "emission*")),
    ("open waste dump", ("garbage", "waste", "dump", "rubbish", "trash", "plastic",
                         "debris", "litter")),
    ("soil erosion", ("erosion", "eroded", "soil", "silt", "landslide", "mud flow")),
    ("stomach illness reported", ("stomach*", "vomit*", "nausea", "diarrhoea",
                                  "diarrhea", "sick*", "illness", "hospital")),
    ("suspected contamination", ("contaminat*", "poison*", "chemical", "dead insect",
                                 "worm", "floating")),
    ("bad taste", ("taste", "tastes", "salty", "brackish", "metallic", "bitter")),
]


_DURATION_RE = re.compile(r"since\s+(\d+)\s*days?", re.I)
_DURATION_ALSO_RE = re.compile(r"(\d+)\s*days?\s+(?:now|since|back)", re.I)
_AREA_RE = re.compile(r"(\d+(?:\.\d+)?)\s*(?:sq\s?m|m2|sqm|square metres?|square meters?)",
                      re.I)
_SEVERE_WORDS = ("hospital", "children", "school", "outbreak", "emergency",
                 "no water", "collapse")
_SEVERE_CATEGORIES = ("stomach illness reported", "suspected contamination")
_MILD_WORDS = ("sometimes", "occasionally", "minor", "slight")


def _term_pattern(term):
    if " " in term:
        return re.escape(term.lower())
    if term.endswith("*"):
        return r"\b%s\w*" % re.escape(term[:-1].lower())
    return r"\b%s\w{0,3}\b" % re.escape(term.lower())


_COMPILED = [(category, re.compile("|".join(_term_pattern(t) for t in terms)))
             for category, terms in KEYWORDS]


def _match_category(text):
    lowered = (text or "").lower()
    for category, pattern in _COMPILED:
        if pattern.search(lowered):
            return category
    return "other"


def _offline_extract(text):
    numbers = re.findall(r"\d+(?:\.\d+)?", text or "")
    duration = _DURATION_RE.search(text or "")
    if duration is None:
        duration = _DURATION_ALSO_RE.search(text or "")
    area = _AREA_RE.search(text or "")
    lowered = (text or "").lower()
    category = _match_category(text or "")
    if category in _SEVERE_CATEGORIES or any(w in lowered for w in _SEVERE_WORDS):
        severity = "high"
    elif any(word in lowered for word in _MILD_WORDS):
        severity = "low"
    elif numbers:
        severity = "medium"
    else:
        severity = "low"
    return {
        "category": category,
        "location_hint": None,
        "severity_hint": severity,
        "duration_days": int(duration.group(1)) if duration else None,
        "area_m2": float(area.group(1)) if area else None,
    }


def _parse_json_object(text):
    """Best-effort: strip code fences, then take the first balanced {...}."""
    if not text:
        return None
    cleaned = re.sub(r"^```(?:json)?|```$", "", text.strip(), flags=re.M).strip()
    start = cleaned.find("{")
    if start < 0:
        return None
    depth = 0
    for i in range(start, len(cleaned)):
        if cleaned[i] == "{":
            depth += 1
        elif cleaned[i] == "}":
            depth -= 1
            if depth == 0:
                try:
                    return json.loads(cleaned[start:i + 1])
                except json.JSONDecodeError:
                    return None
    return None


def _normalise_extraction(raw):
    """Coerce whatever the model returned into the §8.4 field contract."""
    out = _offline_extract("")
    if isinstance(raw, dict):
        category = (raw.get("category") or "").strip().lower()
        if category in [c.lower() for c in CATEGORIES]:
            out["category"] = CATEGORIES[[c.lower() for c in CATEGORIES].index(category)]
        hint = raw.get("location_hint")
        out["location_hint"] = hint.strip() if isinstance(hint, str) and hint.strip() else None
        severity = (raw.get("severity_hint") or "").strip().lower()
        if severity in ("low", "medium", "high"):
            out["severity_hint"] = severity
        for key in ("duration_days", "area_m2"):
            value = raw.get(key)
            if isinstance(value, (int, float)) and value >= 0:
                out[key] = int(value) if key == "duration_days" else float(value)
    return out


# ---------------------------------------------------------------------------
# public API (§8.1)
# ---------------------------------------------------------------------------

def extract_complaint(text):
    """{"category","location_hint","severity_hint","duration_days","area_m2"} always.

    The offline answer is the *floor*, not the fallback: whatever the model says is
    merged over it, and a model that cannot be reached leaves the keyword answer.
    """
    base = _offline_extract(text)
    online, _mode = call(
        SYSTEM_EXTRACTION,
        "Citizen complaint text:\n%s\n\nReturn the JSON object only." % (text or ""),
        json_mode=True)
    parsed = _parse_json_object(online)
    if parsed is None:
        return base
    merged = _normalise_extraction(parsed)
    # Numbers the model invented are dropped: §8.4 forbids it, §2 rule 9 forbids trust.
    for key in ("duration_days", "area_m2"):
        if merged[key] is not None and str(merged[key]) not in (text or ""):
            merged[key] = base[key]
    if merged["category"] == "other" and base["category"] != "other":
        merged["category"] = base["category"]
    if merged["location_hint"] is None:
        merged["location_hint"] = base["location_hint"]
    return merged


def explain_case(case, standards_rows, evidence=None):
    """Paraphrase-only explanation. Offline uses the §8.5 template."""
    evidence = evidence or {}
    online, _mode = call(SYSTEM_EXPLAINATION,
                         "Case:\n%s\n\nStandards rows:\n%s\n\nEvidence:\n%s\n\n"
                         "Write the explanation." % (
                             json.dumps({k: case.get(k) for k in
                                         ("id", "domain", "node_id", "scope",
                                          "severity", "status", "title")}, indent=1),
                             json.dumps(standards_rows or [], indent=1),
                             json.dumps(evidence, indent=1, default=str)))
    if online and online.strip():
        text = online.strip()
        if DISCLAIMER_SUFFIX not in text:
            text += "\n\n" + DISCLAIMER_SUFFIX
        return text
    return _offline_explain(case, evidence, standards_rows)


def _limit_text(limit):
    """A readable bound out of a `config/limits.json` row, or None.

    `acceptable` is the headline the classifier uses (1 NTU, 500 mg/L); `ideal`
    0.0 is a target, not a limit, so it is only a last resort. A range prints as
    "6.5-8.5"; a one-sided row like [0.2, null] prints as "0.2 minimum".
    """
    if not isinstance(limit, dict):
        return limit if isinstance(limit, (int, float, str)) else None
    value = limit.get("acceptable")
    if isinstance(value, (int, float)):
        return value
    if isinstance(value, list):
        low = next((v for v in value if isinstance(v, (int, float))), None)
        high = next((v for v in reversed(value) if isinstance(v, (int, float))), None)
        if low is None:
            return None
        if high is None or low == high:
            return low
        return "%s-%s" % (low, high)
    return _limit_text(limit.get("ideal"))


def _offline_explain(case, evidence, standards_rows):
    readings = evidence.get("readings") or {}
    limits = evidence.get("limits") or {}
    complaints = evidence.get("complaints") or []
    domain = case.get("domain") or "water"
    parts = []
    if domain == "water":
        parts.append("The system grouped %d complaints from buildings sharing the "
                     "upstream node %s." % (len(complaints), case.get("node_id")))
    else:
        parts.append("The system opened this %s case at %s from %d linked report(s)."
                     % (domain, case.get("node_id"), len(complaints)))
    # Every number quoted here is copied from the evidence the rules engine wrote,
    # never from a default — §8.4 "never state a limit that is not in the text".
    observed = []
    for key in sorted(readings):
        value = readings.get(key)
        if not isinstance(value, (int, float)):
            continue
        limit = _limit_text(limits.get(key))
        observed.append("%s is %s%s" % (key.replace("_", " "), value,
                                        "" if limit is None
                                        else " against the standard's %s" % limit))
    if observed:
        parts.append("Latest readings: " + "; ".join(observed) + ".")
    if evidence.get("rule"):
        parts.append("Rule fired: %s." % evidence["rule"])
    if standards_rows:
        first = standards_rows[0]
        parts.append("Standard cited: %s (%s)." % (first.get("parameter"),
                                                   first.get("citation")))
    parts.append("A human officer must verify.")
    parts.append(DISCLAIMER_SUFFIX)
    return " ".join(p for p in parts if p)


def draft_advisory(case, evidence, standards_rows=None):
    """The DRAFT text the officer approves on screen (the caller stamps DRAFT)."""
    evidence = evidence or {}
    online, _mode = call(SYSTEM_ADVISORY,
                         "Case:\n%s\n\nEvidence:\n%s\n\nStandard rows:\n%s\n\n"
                         "Write the advisory." % (
                             json.dumps({k: case.get(k) for k in
                                         ("domain", "node_id", "severity", "title")},
                                        indent=1),
                             json.dumps(evidence, indent=1, default=str),
                             json.dumps(standards_rows or [], indent=1)))
    if online and online.strip():
        return online.strip()
    return _offline_advisory(case, evidence, standards_rows or [])


def _offline_advisory(case, evidence, standards_rows):
    domain = case.get("domain") or "water"
    readings = evidence.get("readings") or {}
    node = case.get("node_id") or "the affected area"
    if domain == "air":
        action = ("Stay indoors where you can, keep windows shut during the dustiest "
                  "hours, and use a covered mask outdoors. People with breathing "
                  "problems should avoid outdoor work.")
        problem = "Air quality at %s is in the %s band right now." % (
            node, evidence.get("category") or "poor")
    elif domain == "land":
        action = ("Keep clear of the dumped material and do not let children play "
                  "there. Cover stored water until the site is cleared.")
        problem = "A waste/erosion report at %s is being verified." % node
    else:
        action = ("Boil drinking water until further notice. Use it cooled for "
                  "cooking, brushing teeth and for children.")
        problem = "Water supplied to %s does not meet the standard." % node
        if readings.get("turbidity_ntu") is not None:
            problem += " Measured turbidity is %s NTU." % readings["turbidity_ntu"]
        if readings.get("residual_chlorine_mgl") is not None:
            problem += (" Disinfection residual is %s mg/L."
                        % readings["residual_chlorine_mgl"])
    lines = [problem,
             action,
             "A municipal team is checking the source and will publish the result here.",
             "DRAFT - not sent until a human officer approves the wording."]
    if standards_rows:
        lines.append("Standard cited: %s." % standards_rows[0].get("citation"))
    return " ".join(l for l in lines if l)


def draft_daily(overview):
    """Five bullet sections, numbers only from the snapshot it was given."""
    online, _mode = call(SYSTEM_DAILY,
                         "Snapshot:\n%s\n\nWrite the 5 sections."
                         % json.dumps(overview, indent=1, default=str))
    if online and online.strip():
        return online.strip()
    return _offline_daily(overview)


def _band(entry):
    """"94 Unsafe (Ward 3)" / "313 Very Poor (air_08)", or "n/a"."""
    if not entry:
        return "n/a"
    value = entry.get("score", entry.get("value"))
    label = entry.get("band") or entry.get("category")
    return "%s %s (%s)" % (value, label, entry.get("name") or entry.get("node_id")
                           or entry.get("station_id"))


def _offline_daily(o):
    kpis = o.get("kpis") or {}
    cases = [c for c in (o.get("triage") or []) if c.get("status") != "Resolved"]

    def lines(domain):
        mine = [c for c in cases if c.get("domain") == domain]
        out = [domain.upper()]
        if not mine:
            out.append("- No open cases.")
        else:
            out.append("- %d open case(s)." % len(mine))
            for c in mine[:3]:
                out.append("- %s at %s (%s): %s" % (c.get("severity"),
                                                     c.get("node_id"),
                                                     c.get("status"), c.get("title")))
        return out

    overview_lines = [
        "OVERVIEW",
        "- Demo clock %s. %s open case(s), %s complaint(s) in the last 24 h."
        % (o.get("demo_now"), kpis.get("open_cases", len(cases)),
           kpis.get("complaints_24h")),
        "- Worst water index %s, worst air index %s."
        % (_band(kpis.get("worst_wqi")), _band(kpis.get("worst_aqi"))),
    ]
    urgent = ["WHAT NEEDS A HUMAN TODAY"]
    for c in [x for x in cases if x.get("severity") == "Emergency"] + \
             [x for x in cases if x.get("severity") == "High"]:
        urgent.append("- %s: %s -> approve or reject the draft, then route it."
                      % (c.get("id"), c.get("title")))
    if len(urgent) == 1:
        urgent.append("- Nothing escalated; review the open cases in order.")
    sections = [overview_lines, lines("water"), lines("air"), lines("land"), urgent]
    body = "\n".join("\n".join(s) for s in sections)
    return body + "\n\nDRAFT - figures come from the case list above; a human officer signs it."
