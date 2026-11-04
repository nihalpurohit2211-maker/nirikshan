# PROGRESS — Nirikshan (Infomatrix HackOps 2)

**Spec:** `PLAN.md` (this repo root). Build order Phase 0 → Phase 6, gates + checkpoints CP0–CP6.
**Started:** 2026-11-04 06:11 · **OS:** Windows 10 (Git Bash / MINGW64 shell) · **Python:** 3.12.10 · **Node:** v24.18.0, npm 11.16.0

## Phase checklist

- [ ] Phase 0 — scaffold, venv, pinned deps, `config/*.json`, `docs/` → **CP0**
- [ ] Phase 1 — `schema.sql`, `seed.py`, `verify_seed.py`, demo numbers contract → **CP1**
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
