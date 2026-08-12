# Smart Farm Decision Support System — starter

Working scaffold covering the auth, farm profile, and irrigation-guidance
slice end to end. Crop health logging and market prices are stubbed on the
dashboard — wire them up the same way irrigation is wired (router → service
→ dashboard section).

## What's implemented

- Signup/login with JWT (`backend/app/routers/auth.py`)
- Farm profile CRUD, private per user (`backend/app/routers/farms.py`)
- Weather-based irrigation guidance via Open-Meteo, rule engine included
  (`backend/app/services/weather_service.py`)
- React frontend: login, signup, farm setup, dashboard
  (`frontend/src/pages/`)

## Third-party APIs used (fill this in further as you add more)

- **Weather**: [Open-Meteo](https://open-meteo.com) — free, no API key
  required, used for the 7-day forecast that drives irrigation guidance and
  risk alerts. Chosen for zero-friction setup during the hackathon (no key
  approval wait, generous free-tier limits for a live demo).

Add entries here for whichever crop-health and market-price sources you
integrate — the problem statement's README requirement expects this section
filled in with what you chose and why.

## Running locally

### Backend
```bash
cd backend
python3 -m venv venv && source venv/bin/activate   # or your preferred env tool
pip install -r requirements.txt
cp .env.example .env       # then edit DATABASE_URL to point at your Postgres
uvicorn app.main:app --reload --port 8000
```
API docs at `http://localhost:8000/docs` once running.

You need a real PostgreSQL database — either local
(`createdb smart_farm`) or a free hosted one (Render, Neon, Supabase all
work). Paste the connection string into `.env` as `DATABASE_URL`.

### Frontend
```bash
cd frontend
npm install
npm run dev
```
Runs on `http://localhost:5173`, proxies `/api` to `http://localhost:8000`
(see `vite.config.js`) so you don't need CORS headaches in dev.

## Next up (see the build-order steps discussed in chat)

1. Crop health logging: image upload endpoint + storage + your chosen
   analysis approach (rule-based CV, pretrained model, or third-party API)
2. Market price trends: integrate a commodity price source, cache results,
   render a small trend chart on the dashboard
3. Deploy: frontend → Vercel/Netlify, backend → Render/Railway, DB → same
   provider's managed Postgres or Neon
4. `architecture-diagram.png`, `api-documentation.md`, `presentation.pptx`
   for the deliverables checklist
