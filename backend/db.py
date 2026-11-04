"""SQLite access (PLAN.md §7.1).

Every connection gets the three PRAGMAs from §2 rule 2. The database path comes
from NIRIKSHAN_DB so the test harness can point at a temp copy (§2 rule 10).
"""

import datetime as dt
import os
import sqlite3

_DEFAULT = "nirikshan.db"

# demo_now() cache: {db_path: latest reading timestamp}. The seeded dataset never
# moves inside one process, so the cache is only invalidated by clear_now_cache()
# (the test harness calls it after copying a fresh temp DB).
_NOW_CACHE = {}


def db_path():
    return os.environ.get("NIRIKSHAN_DB", _DEFAULT)


def connect(path=None):
    path = path or db_path()
    conn = sqlite3.connect(path, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    conn.execute("PRAGMA busy_timeout=5000")
    return conn


def demo_now(conn):
    """Latest reading timestamp = the demo clock. SELECT MAX, cached per DB."""
    key = conn.execute("PRAGMA database_list").fetchone()[2]
    if key in _NOW_CACHE:
        return _NOW_CACHE[key]
    row = conn.execute("SELECT MAX(timestamp) AS t FROM readings").fetchone()
    value = row["t"] if row else None
    _NOW_CACHE[key] = value
    return value


def clear_now_cache():
    _NOW_CACHE.clear()


def next_id(conn, kind, width=3):
    """Sequential id from the `seq` table (§2 rule 4 — never COUNT(*)).

    SQLite >= 3.35 RETURNING, inside the caller's transaction.
    """
    row = conn.execute(
        "UPDATE seq SET value = value + 1 WHERE name = ? RETURNING value", (kind,)
    ).fetchone()
    if row is None:
        raise KeyError("unknown sequence: %s" % kind)
    n = row["value"]
    prefixes = {"complaint": "CMP", "case": "CASE", "action": "ACT",
                "lab": "LAB", "maint": "MNT"}
    prefix = prefixes.get(kind, kind.upper())
    if kind == "case":
        # The year in a case id is the demo clock's year, not today's — an empty
        # database is the only case with no readings to read it from.
        now = demo_now(conn)
        year = int(now[:4]) if now else dt.datetime.now().year
        return "%s-%d-%0*d" % (prefix, year, width, n)
    return "%s%0*d" % (prefix, width, n)
