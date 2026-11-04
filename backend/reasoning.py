"""Reasoning trace and typed evidence for POST /api/ask.

The trace is descriptive, never generative: every step records work the engine
already did (route matched, scope resolved, values read, rule applied, records
cited). A model may re-word the answer; it may never add a step, a number or a
citation. `_numbers_bound` is the guard that enforces the number part: prose may
only state a value that is bound to evidence, and 94.40 matches 94.4 because both
normalise to the same float.
"""

import re

LABEL = {
    "ward": "a ward-level water failure",
    "standard": "a standards lookup",
    "forecast": "a supply forecast",
    "priority": "a triage question",
    "case": "a case explanation",
    "unspecified": "an open question, routed to the worst records",
}
TOOL = {
    "ward": "standards.breach + wqi.compute",
    "standard": "standards.for_water_breaches",
    "forecast": "forecast.chlorine",
    "priority": "rules.severity + rules.is_overdue",
    "case": "rules.cluster (evidence stored on the case)",
    "unspecified": "rules.hotspots",
}
_TOKEN = re.compile(r"\d+(?:\.\d+)?")


def intent_key(question, case_id, ward_in):
    """Mirror of the branch order in ask._offline; keep the two in step."""
    low = (question or "").lower()

    def word(*words):
        return any(re.search(r"\b%s" % re.escape(w), low) for w in words)

    if word("why") and word("ward", "zone", "unsafe"):
        return "ward"
    if word("turbidity") and word("standard", "limit", "is 10500", "is10500",
                                 "what", "which"):
        return "standard"
    if word("chlorine") and word("branch", "running out", "forecast", "cross",
                                "empty", "low", "out"):
        return "forecast"
    if word("standard", "limit", "is 10500") and word("ph", "tds", "dissolved",
                                                     "coliform", "bacteria",
                                                     "chlorine", "turbidity"):
        return "standard"
    if word("officer", "priority", "first") or re.search(
            r"\bwhat\b.{0,40}\b(do|needs?)\b", low):
        return "priority"
    if case_id:
        return "case"
    return "unspecified"


def scalars(numbers):
    return [(k, v) for k, v in (numbers or {}).items()
            if isinstance(v, (int, float, str)) and not isinstance(v, bool)]


def cite_ids(citations, kinds=("case", "node")):
    out = []
    for cite in citations or []:
        if cite.get("kind") in kinds:
            ident = cite.get("id") or cite.get("doc")
            if ident and ident not in out:
                out.append(ident)
    return out


def bindings(numbers, intent):
    """Typed evidence: every served value, with the module that produced it."""
    out = []
    for i, (field, value) in enumerate(scalars(numbers), 1):
        unit = ""
        if field.endswith("_mgl") or field in ("current", "limit"):
            unit = "mg/L"
        elif field in ("wqi_score", "aqi"):
            unit = "index"
        out.append({"id": "v%d" % i, "field": field, "value": value,
                    "unit": unit, "source": intent})
    return out


def _norm(token):
    try:
        return "%.10g" % float(token)
    except (TypeError, ValueError):
        return str(token)


def allowed_numbers(text, citations, bindings_):
    """Every number the reader can already see: prose, quotes, typed bindings."""
    allowed = {_norm(t) for t in _TOKEN.findall(text or "")}
    for cite in citations or []:
        for field in ("quote", "line", "id", "doc"):
            allowed.update(_norm(t) for t in _TOKEN.findall(str(cite.get(field, ""))))
    for binding in bindings_ or []:
        allowed.update(_norm(t) for t in _TOKEN.findall(str(binding.get("value"))))
    return allowed


def numbers_bound(text, allowed):
    """False if the rewrite states a number that is not bound to any evidence."""
    return all(_norm(t) in allowed for t in set(_TOKEN.findall(text or "")))


def _num(value):
    if isinstance(value, bool):
        return "present" if value else "absent"
    if isinstance(value, float):
        return "%.6g" % value
    return "unknown" if value is None else str(value)


def _node_name(conn, node_id):
    row = conn.execute("SELECT name FROM nodes WHERE id = ?", (node_id,)).fetchone()
    return row["name"] if row else node_id


def steps(conn, intent, numbers, citations, text):
    """Six steps, each one a fact about the work rather than a claim about it."""
    values = scalars(numbers)
    node_id = numbers.get("node_id")
    case_id = numbers.get("case_id") or numbers.get("top_case_id")
    if node_id:
        scope = "%s (%s)" % (_node_name(conn, node_id), node_id)
    elif case_id:
        scope = case_id
    else:
        scope = "the open case set, ranked by served severity"
    docs = [c for c in citations if c.get("kind") == "doc"]
    records = cite_ids(citations)
    if values:
        shown, more = values[:5], max(0, len(values) - 5)
        body = ", ".join("%s = %s" % (k.replace("_", " "), _num(v)) for k, v in shown)
        detail = "Read %d value(s) from the payload the screens render: %s%s." % (
            len(values), body, " (+%d more)" % more if more else "")
    else:
        detail = "No numeric field was needed for this route."
    if docs:
        rule = "Quoted %d line(s) of the bundled standard: %s." % (
            len(docs), ", ".join("%s:%s" % (d["doc"].split("/")[-1], d["line"])
                                 for d in docs))
    elif intent == "forecast":
        rule = "Compared the projected series with the process minimum in config."
    elif intent == "priority":
        rule = "Ranked by the served severity ladder and the overdue flag."
    else:
        rule = "Applied the rule the engine used to open the records below."
    return [
        {"n": 1, "title": "Read the question", "tool": "ask._intent_key",
         "detail": "Routed the wording to %s; no model was called for routing."
                   % LABEL.get(intent, LABEL["unspecified"]), "citations": []},
        {"n": 2, "title": "Resolve the scope", "tool": "graph.node / rules.rank",
         "detail": "Scoped the answer to %s." % scope,
         "citations": [case_id] if case_id else []},
        {"n": 3, "title": "Read the served values", "tool": "db.readings",
         "detail": detail, "citations": []},
        {"n": 4, "title": "Apply the rule", "tool": TOOL.get(intent, "rules"),
         "detail": rule,
         "citations": [d["doc"] + ":" + str(d["line"]) for d in docs]},
        {"n": 5, "title": "Cite the records", "tool": "ask._citation",
         "detail": "Attached %d record(s): %s." % (
             len(records), ", ".join(records) if records else "none"),
         "citations": records},
        {"n": 6, "title": "Answer", "tool": "ask._offline",
         "detail": "Composed from the values above, starting: %s"
                   % text.split("\n")[0], "citations": []},
    ]


def followups(conn, numbers, cfg, limits):
    """Questions the served data can actually answer next, de-duplicated, capped."""
    from backend import rules as rules_mod

    out = []
    case_id = numbers.get("case_id") or numbers.get("top_case_id")
    node_id = numbers.get("node_id")
    if case_id:
        out.append("Explain %s in plain language" % case_id)
    try:
        hot = rules_mod.hotspots(conn, cfg, limits)[0]
        if hot["node_id"] != node_id:
            out.append("Why is %s the hottest ward?" % hot["name"])
    except Exception:                    # a thin seed must not break the answer
        pass
    if node_id:
        out.append("Which standard covers the reading at %s?" % node_id)
    out.extend(["What should the officer do first?",
                "Which branch is running out of chlorine?"])
    seen, unique = set(), []
    for q in out:
        if q not in seen:
            seen.add(q)
            unique.append(q)
    return unique[:3]


def resolve_followup(question, history, ward_in):
    """Carry the previous scope into a short follow-up ("and Ward 4?", "why?").

    Only the scope is inherited — never a verdict and never a number: those are
    re-read from the engine for the new question.
    """
    previous = None
    for turn in reversed(history or []):
        if isinstance(turn, dict) and turn.get("text") and turn.get("role") != "assistant":
            previous = str(turn["text"])
            break
    if not previous:
        return question, None
    low = (question or "").lower().strip()
    if not low:
        return question, previous
    short = len(low.split()) <= 5
    anaphora = re.match(r"^(and|what about|why|how about|then|there|it)\b", low)
    if not (short or anaphora):
        return question, previous
    ward = ward_in(previous)
    asked = ward_in(question)
    if asked and ward and asked != ward:
        # "and Ward 4?" keeps the previous intent and swaps the scope.
        swapped, label = previous, "Ward " + asked.split("_")[-1]
        for old in ("Ward " + ward.split("_")[-1], "Zone " + ward.split("_")[-1],
                    "zone_" + ward.split("_")[-1]):
            at = swapped.lower().find(old.lower())
            if at >= 0:
                swapped = swapped[:at] + label + swapped[at + len(old):]
                break
        return swapped, previous
    if ward and not asked:
        return "%s Ward %s?" % (question.rstrip("? ").rstrip(), ward.split("_")[-1]), previous
    return question, previous


def honest_prefix(intent):
    """Say so when the words matched no tool, instead of answering something else."""
    if intent != "unspecified":
        return ""
    return ("I could not match that wording to one of the served questions, so"
            " nothing below is specific to it. What the records can answer right"
            " now:\n")
