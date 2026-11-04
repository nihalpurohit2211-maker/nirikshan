"""Rehearse the 3-minute demo end-to-end against a running server (Phase 6).

    PY -m uvicorn backend.app:app --port 8000        # terminal one
    PY rehearse_demo.py                              # terminal two: walks every beat

Each beat is one page plus one call, so a failure here is a dead end in the demo, not a
data problem — and it doubles as the contract check for the frontend handoff. The script
WRITES (files a complaint, advances a case, drafts and approves an advisory), which is
the point, so restore the pristine demo afterwards — with the server STOPPED, because
Windows will not let a running server swap the database file out from under it:

    PY seed.py && PY verify_seed.py

Exit 0 only when every beat passed. `--port 8010` / `--base http://host:port` move it.
"""

import json
import os
import sys
import urllib.error
import urllib.request

BASE = os.environ.get("NIRIKSHAN_BASE", "http://127.0.0.1:8000")
_args = sys.argv[1:]
if "--port" in _args:
    BASE = "http://127.0.0.1:%s" % _args[_args.index("--port") + 1]
if "--base" in _args:
    BASE = _args[_args.index("--base") + 1]

HERO = "CASE-2026-003"          # zone_3 contamination — the hero story
BURST = "CASE-2026-004"         # ward 4 burst — act two
AIR_CASE = "CASE-2026-007"
BUILDING = "B21"                # a ward-3 society, upstream of the same main

results = []


def call(path, method="GET", body=None):
    """One JSON call. Returns (status, payload); 4xx bodies are real envelopes, not raises."""
    data = None if body is None else json.dumps(body).encode("utf-8")
    req = urllib.request.Request(BASE + path, data=data, method=method,
                                 headers={"Content-Type": "application/json",
                                          "X-Request-Id": "rehearsal"})
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return resp.status, json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8", "replace")
        try:
            return exc.code, json.loads(raw)
        except ValueError:
            return exc.code, {"detail": raw[:200]}
    except Exception as exc:                                        # noqa: BLE001
        return 0, {"detail": "%s: %s" % (type(exc).__name__, exc)}


def page(path):
    """Fetch a non-JSON page and report (status, content-type)."""
    try:
        with urllib.request.urlopen(BASE + path, timeout=60) as resp:
            return resp.status, resp.headers.get("Content-Type", "")
    except Exception as exc:                                        # noqa: BLE001
        return 0, type(exc).__name__


def beat(label, title, checks):
    ok = all(passed for _n, passed, _o in checks)
    results.append((label, title, ok))
    print("%s  %-5s %s" % ("PASS" if ok else "FAIL", label, title))
    for name, passed, observed in checks:
        print("        %s %-28s %s" % ("  ok" if passed else "MISS", name, observed))


# --------------------------------------------------------------------------- beats


def opener():
    status, health = call("/api/health")
    beat("pre", "server answers, offline, on the demo clock", [
        ("health 200", status == 200, status),
        ("demo clock", bool(health.get("demo_now")), health.get("demo_now")),
        ("ai mode is offline", health.get("ai") == "offline", health.get("ai")),
        ("seed counts", health["counts"]["nodes"] == 98,
         "%(nodes)s nodes, %(pipes)s pipes, %(readings)s readings, %(cases)s cases"
         % health["counts"]),
    ])
    status, ctype = page("/")
    beat("pre", "the root URL serves a page, never a 404", [
        ("GET / renders", status == 200 and "html" in ctype, "%s %s" % (status, ctype)),
    ])


def dashboard():
    status, overview = call("/api/overview")
    kpi = overview["kpis"]
    hero = next((c for c in overview["triage"] if c["id"] == HERO), None)
    beat("0:00", "officer dashboard: the zone-3 case is open and red", [
        ("open cases", kpi["open_cases"] >= 6, kpi["open_cases"]),
        ("worst WQI is zone_3", kpi["worst_wqi"]["node_id"] == "zone_3",
         "%.1f %s %s" % (kpi["worst_wqi"]["score"], kpi["worst_wqi"]["band"],
                         kpi["worst_wqi"]["colour"])),
        ("worst AQI station", bool(kpi["worst_aqi"]["station_id"]),
         "%s %s (%s)" % (kpi["worst_aqi"]["station_id"], kpi["worst_aqi"]["value"],
                         kpi["worst_aqi"]["category"])),
        ("hero case in triage", bool(hero), hero and "%s %s" % (hero["severity"],
                                                                hero["status"])),
        ("hotspot ranking", overview["hotspots"][0]["node_id"] == "zone_3",
         "%s score %.1f from %s" % (overview["hotspots"][0]["node_id"],
                                    overview["hotspots"][0]["score"],
                                    ", ".join(sorted(overview["hotspots"][0]["factors"])))),
        ("disclaimer on payload", bool(overview.get("disclaimer")), "banner text is served"),
    ])
    return overview


def complaint_readings():
    status, detail = call("/api/cases/" + HERO)
    ev = detail["evidence"]
    water = ev["readings"]
    beat("0:15", "open the complaint: turbidity ~8.5 NTU, chlorine ~0.03", [
        ("turbidity", water["turbidity_ntu"] > 5, water["turbidity_ntu"]),
        ("residual chlorine", 0 < water["residual_chlorine_mgl"] < 0.1,
         water["residual_chlorine_mgl"]),
        ("WQI band", ev["wqi"]["band"] == "Unsafe",
         "%.1f %s" % (ev["wqi"]["score"], ev["wqi"]["band"])),
        ("anomaly flagged", ev["anomaly"]["anomaly_flag"], "z=%s on %s"
         % (ev["anomaly"]["z"], ev["anomaly"]["parameter"])),
    ])
    return detail


def intake_and_cluster(detail):
    status, filed = call("/api/complaints", "POST", {
        "domain": "water", "node_id": BUILDING,
        "text": "Brown water from the tap since 3 days, smells of sewage"})
    row = filed.get("complaint", {})
    cluster = filed.get("cluster", {})
    joined = [cid for key in ("created", "updated") for cid in cluster.get(key, [])]
    beat("0:30", "file a complaint from a ward-3 society", [
        ("accepted", status == 200 and row.get("id"), row.get("id", filed.get("detail"))),
        ("extraction is a suggestion", bool(filed.get("suggestion")),
         json.dumps(filed["suggestion"])[:70]),
        ("nearest sensor under the pipes",
         filed.get("nearest_sensor", {}).get("node_id") == "zone_3",
         "%s at %s m, WQI %s" % (filed["nearest_sensor"]["node_id"],
                                 filed["nearest_sensor"]["distance_m"],
                                 filed["nearest_sensor"]["wqi"]["score"])),
        ("it landed in the hero case", HERO in joined,
         "cluster: %s" % ", ".join(sorted(set(joined)))[:60]),
    ])
    complaint_id = row.get("id")

    status, first = call("/api/cluster/run", "POST", {})
    status, again = call("/api/cluster/run", "POST", {})
    ids = lambda payload: sorted(r["id"] for key in ("created", "updated")
                                 for r in payload[key])
    hero_after = next(c for c in call("/api/cases")[1]["cases"] if c["id"] == HERO)
    beat("0:30", "clustering collapses the complaints into one case", [
        ("returns the touched cases", {"created", "updated"} <= set(first),
         "created %d, updated %d" % (len(first["created"]), len(first["updated"]))),
        ("idempotent (button twice)", ids(first) == ids(again),
         "same cases both times: %s" % ", ".join(ids(again))[:52]),
        ("new complaint is in the case", complaint_id in hero_after["evidence"]["complaints"],
         "%d complaints on %s" % (len(hero_after["evidence"]["complaints"]), HERO)),
        ("routine complaints stay out",
         {"CMP017", "CMP018", "CMP019", "CMP020"} <=
         {c["id"] for c in call("/api/complaints")[1]["complaints"]
          if not any(c["id"] in cas["evidence"]["complaints"]
                     for cas in call("/api/cases")[1]["cases"])},
         "N0 normal-day complaints are not clustered"),
    ])
    return complaint_id


def evidence_panel():
    status, detail = call("/api/cases/" + HERO)
    ev = detail["evidence"]
    params = [p for p in ev["readings"] if p != "timestamp"]
    beat("0:45", "evidence panel: shared node, the rule that fired, readings vs limits", [
        ("shared node", ev["shared_node"] == "zone_3",
         "%s -> %s" % (ev["shared_node"], detail["case"]["node_id"])),
        ("rule string", bool(ev["rule"]), ev["rule"][:66]),
        ("every reading has a limit",
         all(p in ev["limits"] for p in params),
         "%d parameters against %d limit rows" % (len(params), len(ev["limits"]))),
        ("confidence", ev["confidence"] is not None, ev["confidence"]),
        ("sibling cases", bool(ev["sibling_status"]), "shown as context, not merged"),
    ])


def trace_upstream():
    status, trace = call("/api/trace/" + HERO)
    status_bad, refused = call("/api/trace/" + AIR_CASE)
    beat("1:15", "trace upstream: red pulse to the 1991 main", [
        ("hops", trace["hops"] >= 2, "%d hops over %s" % (trace["hops"], trace["domain"])),
        ("path is drawable", len(trace["path"]) >= 3 and bool(trace["steps"]),
         "%s -> %s" % (trace["path"][0], trace["path"][-1])),
        ("worst pipe named", trace["worst_pipe"]["material"] == "CI",
         "%s %s %d, k=%s" % (trace["worst_pipe"]["id"], trace["worst_pipe"]["material"],
                             trace["worst_pipe"]["install_year"],
                             trace["worst_pipe_decay_k"])),
        ("explanation in words", "1991" in trace["explanation"] or bool(trace["explanation"]),
         trace["explanation"][:66]),
        ("air case refused with a message", status_bad == 400 and "detail" in refused,
         "%s: %s" % (status_bad, str(refused.get("detail"))[:44])),
    ])


def standards():
    status, detail = call("/api/cases/" + HERO)
    rows = detail["standards"]
    beat("1:45", "standards panel: IS 10500 rows with citations", [
        ("only the breaches come back", len(rows) >= 1, "%d rows" % len(rows)),
        ("value against limit", all(r["permissible"] for r in rows),
         "%s: %s vs %s" % (rows[0]["parameter"], rows[0]["acceptable"],
                           rows[0]["permissible"])),
        ("every row cites", all(r["citation"] for r in rows), rows[0]["citation"]),
        ("raw excerpt ships", bool(detail["standards_excerpt"]),
         "%d chars to quote" % len(detail["standards_excerpt"])),
    ])


def forecast():
    status, fc = call("/api/nodes/zone_5/forecast")
    status_nosensor, _ = call("/api/nodes/B01/forecast")
    beat("2:00", "zone 5 forecast: 0.235 now, crosses the 0.2 minimum in ~21 h", [
        ("current", abs(fc["current"] - 0.235) < 0.01, "%.3f mg/L" % fc["current"]),
        ("crossing the minimum", 18 <= (fc["crossing_hours"] or 0) <= 24,
         "%s h (limit %s)" % (fc["crossing_hours"], fc["limit"])),
        ("warn, not alarm", fc["breached_now"] is False, fc["breached_now"]),
        ("projection is plottable", len(fc["projected"]) > 3,
         "%d points, %s h horizon, %s" % (len(fc["projected"]), fc["horizon_hours"],
                                          fc["method"])),
        ("no-sensor node is an empty state", status_nosensor == 404,
         "GET /api/nodes/B01/forecast -> %d" % status_nosensor),
    ])


def act_two():
    status, cases = call("/api/cases")
    burst = next((c for c in cases["cases"] if c["id"] == BURST), None)
    severities = sorted({c["severity"] for c in cases["cases"]})
    scopes = sorted({c["scope"] for c in cases["cases"]})
    beat("2:20", "act two: the burst is Emergency, and every badge has data", [
        ("burst present", bool(burst), burst and "%s at %s" % (burst["title"],
                                                               burst["node_id"])),
        ("severity", burst and burst["severity"] == "Emergency", burst and burst["severity"]),
        ("overdue is rendered, not computed",
         burst is not None and "overdue" in burst,
         "overdue=%s at the seeded clock (needs 2 h with no action)" % burst["overdue"]),
        ("all four severities exist", severities == ["Emergency", "High", "Low", "Medium"],
         severities),
        ("building-side exists", "BUILDING_SIDE" in scopes, scopes),
        ("worst first", [c["severity"] for c in cases["cases"]][:1] == ["Emergency"],
         "list order"),
    ])
    return burst


def workflow():
    status, draft = call("/api/cases/%s/draft" % BURST, "POST", {})
    status, moved = call("/api/cases/%s/status" % BURST, "PATCH", {
        "status": "Investigating", "actor": "Officer R. Rao", "role": "Ward Officer",
        "note": "Crew dispatched to the Plateau tee."})
    status_bad, refused = call("/api/cases/%s/status" % BURST, "PATCH", {
        "status": "Resolved", "actor": "Officer R. Rao", "role": "Ward Officer"})
    status, approved = call("/api/cases/%s/approve" % BURST, "POST", {
        "actor": "Officer R. Rao", "role": "Ward Officer", "advance_to": "Action Taken"})
    beat("2:40", "draft advisory -> approve -> Action Taken", [
        ("draft is stamped", draft["status"] == "DRAFT",
         "%s, written by the %s provider" % (draft["status"], draft["ai"])),
        ("advisory + explanation", len(draft["text"]) > 80 and bool(draft["explanation"]),
         "%d chars of advisory" % len(draft["text"])),
        ("legal move accepted", moved["case"]["status"] == "Investigating",
         moved["case"]["status"]),
        ("illegal move refused", status_bad == 400 and "detail" in refused,
         "%d: %s" % (status_bad, str(refused.get("detail"))[:48])),
        ("signed off and advanced", approved["case"]["status"] == "Action Taken",
         "%s by %s" % (approved["case"]["status"], approved["approved_by"])),
    ])


def history():
    status, detail = call("/api/cases/" + BURST)
    actions = [a["action"] for a in detail["actions"]]
    beat("2:50", "history: who did what, when", [
        ("timeline", len(detail["actions"]) >= 4, " -> ".join(actions)),
        ("draft and approval recorded",
         any("Draft" in a for a in actions) and any("approved" in a for a in actions),
         detail["actions"][-1]["actor"]),
        ("only legal next moves", detail["allowed_transitions"] == ["Resolved"],
         detail["allowed_transitions"]),
    ])


def air():
    status, air = call("/api/air")
    worst = air["worst"]
    status_series, series = call("/api/air/%s/readings" % worst["id"])
    beat("air", "dust episode: gauge, history and a case", [
        ("worst station", worst["aqi"]["value"] >= 301,
         "%s %s AQI %.1f (%s, %s)" % (worst["id"], worst["name"], worst["aqi"]["value"],
                                      worst["aqi"]["category"],
                                      worst["aqi"]["driving_pollutant"])),
        ("history for the chart", series["hours"] > 100,
         "%d h of readings, PM10 %.0f" % (series["hours"], worst["latest"]["pm10"])),
        ("24 h forecast", bool(air["pm_forecast"]["projected"]),
         "%s projected %.0f -> %.0f over %s h" % (air["pm_forecast"]["parameter"],
                                                  air["pm_forecast"]["projected"][0],
                                                  air["pm_forecast"]["projected"][-1],
                                                  air["pm_forecast"]["horizon_hours"])),
        ("the case behind it", any(c["id"] == AIR_CASE for c in
                                  call("/api/cases?domain=air")[1]["cases"]),
         "CASE-2026-007 with evidence.aqi"),
        ("category colours ship", len(air["categories"]) >= 6,
         ", ".join("%s %s" % (c["name"], c["colour"]) for c in air["categories"])[:60]),
    ])


def land():
    status, land = call("/api/land/reports")
    dump = next((r for r in land["reports"] if r["node_id"] == "land_05"), None)
    link = next((r for r in land["reports"] if r.get("cross_link")), None)
    status_img, ctype = page(dump["image_url"]) if dump and dump["image_url"] else (0, "none")
    beat("land", "waste report: photo, proximity score, cross-link", [
        ("photo served and fetchable", status_img == 200,
         "%s -> %s %s" % (dump["id"], status_img, ctype.split(";")[0])),
        ("duration and area", dump["duration_days"] >= 7,
         "%s days, %s m2" % (dump["duration_days"], dump["area_m2"])),
        ("proximity explained", dump["proximity"]["score"] >= 50,
         "%s from %d factors (%s)" % (dump["proximity"]["score"],
                                      len(dump["proximity"]["factors"]),
                                      "; ".join(f["label"]
                                                for f in dump["proximity"]["factors"]))[:96]),
        ("erosion reaches the water", bool(link),
         "%s %s %s trend %s" % (link["id"], link["cross_link"]["water_node"],
                                link["cross_link"]["direction"],
                                link["cross_link"]["trend"])),
        ("weights documented", bool(land["weights"]), "the UI can explain the score"),
    ])


def reports():
    status, daily = call("/api/reports/daily", "POST", {})
    sections = [ln for ln in daily["text"].splitlines() if ln.isupper()]
    beat("reports", "daily summary: a draft beside live numbers", [
        ("five sections", len(sections) == 5, ", ".join(sections)),
        ("snapshot attached", daily["snapshot"]["kpis"]["open_cases"] >= 1,
         "open %s, worst WQI %.1f, complaints 24h %s"
         % (daily["snapshot"]["kpis"]["open_cases"],
            daily["snapshot"]["kpis"]["worst_wqi"]["score"],
            daily["snapshot"]["kpis"]["complaints_24h"])),
        ("never auto-approved", daily["status"] == "DRAFT",
         "%s (ai: %s)" % (daily["status"], daily["ai"])),
    ])


def errors():
    status, missing = call("/api/nodes/nope")
    status2, bad = call("/api/cases/nope")
    status3, envelope = call("/api/complaints", "POST", {"domain": "water"})
    beat("edge", "empty states come back as messages, not crashes", [
        ("unknown node", status == 404 and "detail" in missing,
         "%d: %s" % (status, str(missing.get("detail"))[:44])),
        ("unknown case", status2 == 404 and "detail" in bad,
         "%d: %s" % (status2, str(bad.get("detail"))[:44])),
        ("bad request explained", status3 == 422 and "detail" in envelope,
         "%d: %s" % (status3, str(envelope.get("detail"))[:44])),
    ])


def main():
    opener()
    dashboard()
    complaint_readings()
    intake_and_cluster(None)
    evidence_panel()
    trace_upstream()
    standards()
    forecast()
    act_two()
    workflow()
    history()
    air()
    land()
    reports()
    errors()

    failed = [r for r in results if not r[2]]
    print("\n%d/%d beats clean" % (len(results) - len(failed), len(results)))
    if failed:
        print("dead ends: " + "; ".join("%s %s" % (l, t) for l, t, _ok in failed))
        return 1
    print("Demo path runs end to end. Restore the pristine seed with:")
    print("    PY seed.py && PY verify_seed.py")
    return 0


if __name__ == "__main__":
    sys.exit(main())
