# Legacy / superseded code

Earlier implementations kept for reference. **None of this is built, deployed
or part of the running application.** The live app is `backend/` (Node + Express
+ TypeScript) and `frontend/` (Next.js 14).

Everything here remains in git history and can be restored at any time.

---

## `python-backend-app/` — FastAPI backend

The team's first backend: Python 3.13, FastAPI, SQLAlchemy, SQLite/PostgreSQL.

It implemented authentication, farm profiles, multi-crop management with land
allocation, weather-based irrigation guidance, and a crop-suggestion engine with
0–100 suitability scoring.

**Why it was superseded:** it did not cover two of the problem statement's
must-have requirements — crop health monitoring (#4) and market price insights
(#5). Rather than extend two backends in parallel, the team consolidated on the
Node implementation, which covers all five must-haves plus the unified dashboard.

Original commit: `4269307` — *"Initial commit: Smart Farm DSS with multi-crop system"*.

**Worth revisiting:** the crop-suggestion engine
(`services/crop_suggestion_service.py`) is a genuinely good feature and maps to
the "Crop Recommendation Engine" bonus challenge. It is tracked as future scope
in the main README.

## `vite-frontend/` — React + Vite frontend

The UI that paired with the FastAPI backend: React 19, Vite, React Router 7,
Axios, Tailwind v4.

**Why it was superseded:** it targets Vite rather than Next.js, and it was written
against the older API contract (integer ids, bare JSON responses, no unified
dashboard endpoint). Its screens are reimplemented in `frontend/src/app/`.

## `intelligence-stub/` — unused Python microservice

A Dockerfile and `pyproject.toml` for a planned FastAPI service (OR-Tools
optimisation, ONNX inference). No source was ever written. The functionality it
was meant to host — the irrigation water balance and the crop-health engine —
lives in the Node backend instead, which removed the need for a second runtime.
