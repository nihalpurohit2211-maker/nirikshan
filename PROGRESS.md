# PROGRESS — Nirikshan (Infomatrix HackOps 2)

**Spec:** `PLAN.md` (this repo root). Build order Phase 0 → Phase 6, gates + checkpoints CP0–CP6.
**Started:** 2026-11-04 06:11 · **OS:** Windows 10 (Git Bash / MINGW64 shell) · **Python:** 3.12.10 · **Node:** v24.18.0, npm 11.16.0

## Phase checklist

- [x] Phase 0 — scaffold, venv, pinned deps, `config/*.json`, `docs/` → **CP0** (committed `d5b5f60`)
- [x] Phase 1 — `schema.sql`, `seed.py`, `verify_seed.py`, demo numbers contract → **CP1** (31 checks, 0 failures)
- [ ] Phase 2 — backend core modules + API + tests green on 8010 → **CP2**
- [ ] Phase 3 — `agent.py` + offline fallback, DRAFT stamp → **CP3**
- [ ] Phase 4 — `frontend_fallback/index.html` (first) + React app builds → **CP4**
- [ ] Phase 5 — air + land + reports wired, all scenarios walk through → **CP5**
- [ ] Phase 6 — README, rehearsal, offline check, submission, `TRANSFER.md` → **CP6**

## Environment notes (read before running any command)

- This session's shell is **Git Bash on Windows**, not PowerShell. The PLAN `PY` shorthand
  (Windows row) resolves here to `./.venv/Scripts/python.exe` — forward slashes, same venv
  interpreter as `.\\.venv\\Scripts\\python.exe`. Linux agents use `./.venv/bin/python`.
- Venv is NOT activated; every Python command uses `PY` explicitly. Never bare `python`/`python3`.
- `nirikshan.db` is generated, never committed (see `.gitignore`).
- Dev server port **8000**; tests boot uvicorn on **8010** against a temp DB copy. Never mix.

## Notes / decisions

- `config/rules.json` contains the verbatim §5.3 contract **plus** an additive
  `land_proximity` block (§10 weights: school 30 / water 30 / road 20 / duration 20).
  No contract key was renamed or removed — this keeps §2 rule 6 (no magic numbers in code)
  true without breaking the frozen schema.
- `config/aqi.json` contains the verbatim §5.2 contract **plus** `index_bounds`, the
  NO2/SO2/O3/CO breakpoint rows the `_note` asks for, and `units`. Non-PM rows are labelled
  "demo excerpt — verify against CPCB" in both the config and `docs/cpcb_aqi_excerpt.txt`.
  The S6 AQI contract number uses PM10 only, which is a confirmed NAQI row.
- **Phase 1 ran before Phase 2 modules on purpose.** Four of the §6.7 contract rows are
  clustering outcomes, so `graph.py`, `wqi.py`, `aqi.py`, `anomaly.py`, `forecast.py`,
  `db.py` and the clustering part of `rules.py` were written during Phase 1 to make
  `verify_seed.py` able to assert them. Phase 2 adds `standards.py`, `agent.py`, `app.py`
  and the tests, not a rewrite of these.
- §6.7 pins zone_3 at chlorine ~0.03 *and* turbidity ~8.5 at the same node. A generic
  pipe generator cannot satisfy both (low chlorine needs a long/high-k chain, high
  turbidity needs a short one), so `seed.py` hand-authors `PIPE_SPECS`: Ward 3 hangs off
  `plant_n -> res_hill -> pump_1 -> J02 -> J03 -> J04 -> zone_3` with Σk·dt ≈ 0.83 across
  6 hops, one hop dated 2002 to hold turbidity down. Measured: turbidity 8.962,
  chlorine 0.0382, WQI 94.4 (Unsafe). Ward 1 sits on a new 1996/2006/2010/2012 branch so
  its sibling sensors stay inside limits, which is what makes S5 a building-side case.
- S4 (zone_5 forecast) is a **pure straight line** 0.315 -> 0.235 with no daily cycle and
  no noise, and `forecast.py` uses `eps = 1e-9` in the trend test: any noise moves the
  crossing off the pinned 21 h.
- **Clustering refinement (documented in `backend/rules.py`).** §7.7 chooses the shared
  node among candidates by (a) most complaints. Unscoped, the treatment plant wins every
  time — its subtree contains all 12 complaining buildings — and the whole night's demo
  collapses into one plant case with zone_3, zone_4 and B11 left with none. §7.7 step 1
  itself says `water -> lca(buildings)`, and §1 says "5 scattered complaints about **one
  ward** collapse into 1 case", so PLACE is ward-scoped (the building's parent zone) first;
  within a ward the candidate is `lca(buildings)`. The three tie-breaks then order the
  ward candidates. Nothing else about §7.7 changed and no seed number was touched.
- Windows console renders the `§` in test labels as `` (e.g. "pipes ~79 (6.2)").
  Cosmetic only, on `cp1252` stdout; the files and assertions are UTF-8 and correct.

## Gate results

- **Gate 0:** `PY -c "import json; ..."` -> `config ok` · committed `d5b5f60 CP0: scaffold, pinned deps, config`
- **Gate 1:** `PY seed.py` then `PY verify_seed.py` -> **31 checks, 0 failures**, exit 0
  (`set -o pipefail` — a plain pipe to `tail` hides the real exit code behind `tail`'s 0).

---

## SESSION — 2026-11-04 06:11 — unattended agent (build session 1)
- Entered at: nothing (CP0 not reached). Verified by: `git log --oneline` → `fatal: your current branch 'master' does not have any commits yet`; `git status --short` → untracked `.gitignore`, `PLAN.md`, `backend/`; only `backend/__init__.py` + `backend/tests/__init__.py` existed. A prior agent had run `git init`, written `.gitignore`, moved `v2/PLAN.md` to root, and created the two `__init__.py` files, then died before Gate 0.
- Work done:
  - Confirmed PLAN.md already at workspace root (Step 1 of the start prompt was already done).
  - Read PLAN.md in full, ran §0.1 checklist A–D.
  - Created folder tree (§4), created `.venv` and installing pinned deps
    (`fastapi==0.115.6`, `uvicorn==0.32.1`, `pydantic==2.10.4`).
  - Wrote `config/limits.json`, `config/aqi.json`, `config/rules.json` (§5.1–5.3 verbatim + additive blocks).
  - Wrote `docs/is10500_excerpt.txt`, `docs/cpcb_aqi_excerpt.txt`, `docs/swm_rules_excerpt.txt`.
  - Wrote this `PROGRESS.md`.
- Left at: CP0 — gate PENDING (waiting on pip verify below).
- Blockers: none.
- Next action for the next agent: `PY -c "import fastapi, uvicorn, pydantic; print('ok')"` then `PY seed.py` / `PY verify_seed.py` (Phase 1, §6).

## SESSION — 2026-11-04 07:55 — unattended agent (build session 2)
- Entered at: CP0 (verified by: `git log --oneline` -> `d5b5f60 CP0: scaffold, pinned deps, config`; `PY -c "import json; [...]"` -> `config ok`). Work continued from session 1, which died mid-Phase 1 with an uncommitted tree.
- Work done (Phase 1 complete):
  - `schema.sql` (§6.1 DDL verbatim + two additive tables `land_meta`, `features` — no frozen table gained a column).
  - `seed.py` rewritten twice: removed dead scaffolding from the first pass, then hand-authored
    `PIPE_SPECS` to satisfy the §6.7 chlorine/turbidity pair. Deterministic (single
    `random.Random(42)` per sensor, no `time.time()`, `NOW = 2026-11-03 09:00`).
    Seeded: 98 nodes, 78 pipes, 27 sensors, 5712 water + 3360 air readings, 20 complaints,
    13 standards rows, 8 features, 4 `data/images/*.svg`, 2 historical RESOLVED cases.
  - Phase 2 modules needed by the contract rows: `backend/db.py` (PRAGMAs, `next_id` off the
    `seq` table, `demo_now`), `graph.py` (bulk load, `chain`/`depth`/`lca`/`trace`),
    `wqi.py`, `aqi.py`, `anomaly.py`, `forecast.py`, `rules.py` (clustering, severity,
    status whitelist, proximity, cross-link, hotspots).
  - `verify_seed.py` — 31 print-and-assert checks over every §6.7 row plus counts, LCA,
    trace, idempotency, S7/S8.
  - Fixed Gate 1's three failures (S1 zone_3, S2 zone_4, S5 B11) by ward-scoping PLACE in
    `rules.cluster()` — see Notes above. No seed value was changed to chase a case.
- Left at: CP1 — gate **PASS** (`PY seed.py && PY verify_seed.py` -> `31 checks, 0 failures`, exit 0).
  Case set after clustering: `CASE-2026-003` zone_3 MUNICIPAL High · `004` zone_4 MUNICIPAL Emergency
  (supply loss) · `005` zone_2 MUNICIPAL Low · `006` B11 BUILDING_SIDE Low · `007` air_08 High ·
  `008` land_05 Medium · plus the 2 seeded RESOLVED. Idempotent: second run leaves 6 open cases,
  14 -> 14 actions.
- Blockers: none.
- Next action for the next agent: Phase 2 (§7) — `backend/standards.py`, then `backend/app.py`
  with the §7.9 endpoints, then `backend/tests/` (port 8010, temp DB): `PY -m unittest discover -s backend/tests -v`.
