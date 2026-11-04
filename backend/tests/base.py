"""Shared test harness (PLAN.md §7.10) — stdlib only, no pytest.

Boots the real app under uvicorn on 127.0.0.1:8010 against a TEMP COPY of the
seeded database (§2 rule 10: dev is 8000, tests are 8010, and a test never writes
to nirikshan.db). The server starts once per process and is shared by every test
module, so `unittest discover` boots it exactly once.
"""

import atexit
import json
import logging
import os
import shutil
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request

import uvicorn

from backend import app as backend_app
from backend.db import clear_now_cache

# `unittest -v` already shows per-test results; the app's request log would bury it.
logging.getLogger("nirikshan").setLevel(logging.WARNING)

HOST = "127.0.0.1"
PORT = 8010
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SEED_DB = os.path.join(ROOT, "nirikshan.db")

_state = {"server": None, "thread": None, "tmpdir": None, "db": None}


def _temp_db():
    if not os.path.exists(SEED_DB):
        raise RuntimeError("nirikshan.db is missing — run PY seed.py before the tests"
                           " (Gate 2 does exactly that)")
    tmpdir = tempfile.mkdtemp(prefix="nirikshan-tests-")
    db = os.path.join(tmpdir, "nirikshan.db")
    shutil.copy2(SEED_DB, db)
    for side in ("-wal", "-shm"):
        if os.path.exists(SEED_DB + side):
            shutil.copy2(SEED_DB + side, db + side)
    os.environ["NIRIKSHAN_DB"] = db
    clear_now_cache()
    return tmpdir, db


def _shutdown():
    server = _state["server"]
    if server is not None:
        server.should_exit = True
        thread = _state["thread"]
        if thread is not None:
            thread.join(timeout=10)
    if _state["tmpdir"] and os.path.isdir(_state["tmpdir"]):
        shutil.rmtree(_state["tmpdir"], ignore_errors=True)
    _state.update({"server": None, "thread": None, "tmpdir": None, "db": None})


def start_server():
    if _state["server"] is not None:
        return _state["db"]
    tmpdir, db = _temp_db()
    config = uvicorn.Config(backend_app.app, host=HOST, port=PORT,
                            log_level="warning", access_log=False)
    server = uvicorn.Server(config)
    thread = threading.Thread(target=server.run, daemon=True, name="nirikshan-test")
    thread.start()
    _state.update({"server": server, "thread": thread, "tmpdir": tmpdir, "db": db})
    deadline = 10.0
    waited = 0.0
    while waited < deadline:
        try:
            status, _ = api("/api/health")
            if status == 200:
                atexit.register(_shutdown)
                return db
        except Exception:
            pass
        time.sleep(0.1)
        waited += 0.1
    _shutdown()
    raise RuntimeError("uvicorn did not serve /api/health on %s:%d within 10 s"
                       % (HOST, PORT))


def _body(raw_bytes):
    # Some paths serve binary (the demo images); decoding must not raise.
    return raw_bytes.decode("utf-8", errors="replace")


def _send(path, method="GET", body=None, headers=None):
    """One request against the test server. Returns (status, raw_text, headers)."""
    url = "http://%s:%d%s" % (HOST, PORT, path)
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Accept", "application/json")
    if data is not None:
        req.add_header("Content-Type", "application/json")
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return resp.status, _body(resp.read()), resp.headers
    except urllib.error.HTTPError as exc:
        return exc.code, _body(exc.read()), exc.headers


def api(path, method="GET", body=None, headers=None):
    """One request against the test server. Returns (status, parsed_json)."""
    status, raw, _headers = _send(path, method, body, headers)
    try:
        return status, json.loads(raw) if raw else {}
    except json.JSONDecodeError:
        # An error page instead of the JSON envelope is a real defect: hand the
        # raw text back so the test fails with it visible.
        return status, {"_non_json": raw[:400]}


def api_headers(path, method="GET", body=None):
    """Same request, but answers with the response headers — for middleware tests."""
    status, _raw, headers = _send(path, method, body)
    return status, headers


class NirikshanTest(unittest.TestCase):
    """Base class: guarantees the server is up and gives the assert helpers."""

    @classmethod
    def setUpClass(cls):
        cls.db_path = start_server()

    def ok(self, status, payload, path):
        self.assertEqual(status, 200, "%s returned %s: %s" % (path, status, payload))
        return payload

    def get(self, path):
        status, payload = api(path)
        return self.ok(status, payload, path)

    def post(self, path, body=None):
        status, payload = api(path, method="POST", body=body or {})
        return self.ok(status, payload, path)

    def expect_error(self, path, method, body, status):
        got, payload = api(path, method=method, body=body)
        self.assertEqual(got, status, "%s %s -> expected %d, got %d: %s"
                         % (method, path, status, got, payload))
        self.assertNotIn("_non_json", payload,
                         "%s returned a non-JSON error body: %s"
                         % (path, payload.get("_non_json")))
        self.assertIsInstance(payload.get("detail"), str,
                              "error envelope must be {\"detail\": \"...\"}: %s"
                              % payload)
        return payload
