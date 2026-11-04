# Deploying Nirikshan

The demo is designed to run offline on loopback. This document is the optional hosted
path: one Python process serving the API and the UI, backed by SQLite.

## Why one service

`backend/app.py` mounts `frontend_fallback/` at `/` and serves `/api/*` from the same
process. There is no separate frontend server, no build step and no CORS setup. The
database is a SQLite file (`nirikshan.db`) created by `seed.py`.

```
browser ──► FastAPI (uvicorn) ──► SQLite (nirikshan.db)
              ├── /api/*            built by seed.py
              └── / (static UI)
```

## Render (free) — one click after authorising

Files in the repo:

- `requirements.txt` — the three pinned dependencies.
- `render.yaml` — Blueprint: Python 3.12, free plan, health check `/api/health`,
  start command `python seed.py && uvicorn ... --port $PORT`.
- `Dockerfile` / `.dockerignore` — for any container host instead of Render.

Steps:

1. Open <https://dashboard.render.com/blueprints> and sign in with GitHub.
2. **New Blueprint Instance** → choose `nihalpurohit2211-maker/nirikshan` → **Apply**.
3. Wait for the first build (~2 minutes). The URL will look like
   `https://nirikshan.onrender.com`.
4. Open it. It lands on `#/welcome`; pick **Officer**, or open
   `https://<service>.onrender.com/#/?role=officer`.

Render redeploys automatically on every push to `master` (`autoDeploy: true`).

### Free-plan behaviour to know

- The service **sleeps after ~15 minutes idle**; the next request cold-starts it
  (~30–60 s). Warm it up before showing it to anyone.
- The filesystem is **ephemeral**. `startCommand` reseeds on every boot, which is why
  the demo opens with exactly the contracted numbers (20 complaints, 8 cases, WQI 94.4).
  Writes made through the UI (filing a complaint, approving a draft) survive until the
  next restart/sleep, then the deterministic seed returns.
- If you need writes to persist, add a Render disk mounted at `/data` and set
  `NIRIKSHAN_DB=/data/nirikshan.db`; the free plan does not include disks.

## Any container host

```bash
docker build -t nirikshan .
docker run --rm -p 8000:8000 nirikshan
# open http://127.0.0.1:8000/
```

The image installs `requirements.txt`, copies the repo, seeds the database at start and
binds `0.0.0.0:$PORT` (default 8000). It works on Fly.io, Koyeb, Railway, Hugging Face
Spaces (Docker SDK) and similar.

## Verification after deploy

```bash
curl -s https://<service>/api/health
# {"status":"ok","demo_now":"2026-11-03 09:00:00", ... ,"ai":"offline"}
curl -s https://<service>/api/overview | head -c 300
curl -s -X POST https://<service>/api/ask \
  -H 'content-type: application/json' \
  -d '{"question":"Why is Ward 3 unsafe?"}'
```

The last call should return the offline answer naming Ward 3, WQI 94.4 Unsafe, and
citations of kind `doc`, `case` and `node`.

## Honest trade-off

The build brief prizes a fully offline, loopback-only demo. Hosting it does not change
the code or the data — the same synthetic seed and the same offline agent run — but the
deployment now depends on a third-party platform being awake. Keep the local
`uvicorn` path as the primary demo and treat the hosted URL as a convenience for judges.
