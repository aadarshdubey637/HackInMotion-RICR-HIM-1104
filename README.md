# Smart Farm Decision Support System

A full-stack web application that helps farmers make data-driven decisions about irrigation, crop selection, and land management — powered by real-time weather data and a rule-based AI engine.

Built for **HackInMotion — RICR-HIM-1104**.

---

## Features

### Core
- **JWT Authentication** — signup, login, protected routes
- **Farm Profile Management** — create and manage multiple farm profiles per user

### Multi-Crop System (new)
- **Multiple crops per farm** — add as many crops as your land allows, each with its own land allocation
- **Crop navigation** — tab between crops on the dashboard; each crop shows its own status and details
- **Land allocation tracker** — visual bar shows how your land is divided across all active crops; prevents over-allocation
- **Crop lifecycle** — cycle crops through `planning → active → harvested` with one click

### AI Crop Suggestions
- **Weather-aware recommendations** — analyses the 7-day forecast (temperature, rainfall) from [Open-Meteo](https://open-meteo.com)
- **Soil-aware scoring** — matches crops to your soil type
- **0–100 suitability score** — every crop gets a score with a plain-language explanation the farmer can read and trust
- **Smart land-division plan** — suggests how to split your available land across the top recommended crops, proportional to suitability score
- **12 crops in the knowledge base** — Wheat, Rice, Maize, Cotton, Soybean, Chickpea, Sugarcane, Tomato, Onion, Mustard, Groundnut, Turmeric

### Irrigation Guidance
- **Real-time weather-based guidance** — tells you whether to irrigate today based on the next 2 days of forecast
- **Risk alerts** — extreme heat, heavy rain, high wind, and frost warnings
- **History** — last 20 irrigation recommendations stored per farm

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Python 3.13, FastAPI, SQLAlchemy, Pydantic v2 |
| Auth | JWT (python-jose), bcrypt (passlib) |
| Database | SQLite (local dev) / PostgreSQL (production) |
| Weather API | [Open-Meteo](https://open-meteo.com) — free, no API key |
| Frontend | React 19, Vite 8, Tailwind CSS v4 |
| HTTP client | Axios |
| Routing | React Router v7 |

---

## Project Structure

```
smart-farm-starter/
├── backend/
│   ├── app/
│   │   ├── core/
│   │   │   ├── config.py        # Settings from .env
│   │   │   ├── database.py      # SQLAlchemy engine + session
│   │   │   ├── deps.py          # JWT auth dependency
│   │   │   └── security.py      # Password hashing, token creation
│   │   ├── models/
│   │   │   └── models.py        # User, FarmProfile, Crop, IrrigationLog, ...
│   │   ├── routers/
│   │   │   ├── auth.py          # POST /api/auth/signup, /login, GET /me
│   │   │   ├── farms.py         # CRUD /api/farms
│   │   │   ├── crops.py         # CRUD /api/farms/{id}/crops + suggestions
│   │   │   └── irrigation.py    # GET /api/farms/{id}/irrigation
│   │   ├── schemas/
│   │   │   ├── auth_schemas.py
│   │   │   ├── farm_schemas.py
│   │   │   └── crop_schemas.py
│   │   ├── services/
│   │   │   ├── weather_service.py          # Open-Meteo integration
│   │   │   └── crop_suggestion_service.py  # AI crop scoring engine
│   │   └── main.py
│   ├── .env.example
│   └── requirements.txt
└── frontend/
    └── src/
        ├── pages/
        │   ├── Dashboard.jsx       # Main dashboard with crop tabs
        │   ├── CropManager.jsx     # Add / edit / delete crops
        │   ├── CropSuggestions.jsx # AI recommendations + land plan
        │   ├── FarmSetup.jsx
        │   ├── Login.jsx
        │   └── Signup.jsx
        ├── components/
        │   ├── ErrorBanner.jsx
        │   ├── RequireAuth.jsx
        │   └── RiskBadge.jsx
        ├── context/AuthContext.jsx
        └── api/client.js
```

---

## Running Locally

### Prerequisites
- Python 3.10+
- Node.js 18+

### Backend

```bash
cd backend
python -m venv venv

# Windows
venv\Scripts\activate
# macOS/Linux
source venv/bin/activate

pip install -r requirements.txt

cp .env.example .env
# Edit .env if needed — SQLite works out of the box, no setup required

uvicorn app.main:app --reload --port 8000
```

API docs available at `http://localhost:8000/docs`

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Runs at `http://localhost:5173` — all `/api` requests are proxied to the backend automatically.

---

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/signup` | Register a new user |
| POST | `/api/auth/login` | Login, returns JWT |
| GET | `/api/auth/me` | Current user info |
| POST | `/api/farms` | Create a farm |
| GET | `/api/farms` | List user's farms |
| PATCH | `/api/farms/{id}` | Update farm |
| DELETE | `/api/farms/{id}` | Delete farm |
| POST | `/api/farms/{id}/crops` | Add a crop to a farm |
| GET | `/api/farms/{id}/crops` | List crops on a farm |
| PATCH | `/api/farms/{id}/crops/{crop_id}` | Update a crop |
| DELETE | `/api/farms/{id}/crops/{crop_id}` | Remove a crop |
| GET | `/api/farms/{id}/crops/suggestions/run` | Run AI crop suggestions |
| GET | `/api/farms/{id}/crops/suggestions/latest` | Fetch cached suggestions |
| GET | `/api/farms/{id}/irrigation` | Get irrigation guidance |
| GET | `/api/farms/{id}/irrigation/history` | Last 20 irrigation logs |
| GET | `/api/health` | Health check |

---

## Third-Party APIs

| API | Purpose | Key required? |
|-----|---------|---------------|
| [Open-Meteo](https://open-meteo.com) | 7-day weather forecast driving irrigation guidance and crop suggestions | No — completely free |

---

## How the Crop Suggestion AI Works

The engine scores each crop in the knowledge base against three factors:

1. **Temperature (40 pts)** — compares your location's average temperature against each crop's ideal range
2. **Rainfall (35 pts)** — extrapolates the 7-day forecast to an annual estimate and checks it against the crop's water requirement
3. **Soil type (25 pts)** — checks your farm's soil against each crop's preferred soils

Every penalty comes with a plain-English reason so farmers understand exactly why a crop scored the way it did.

The land-division plan distributes available acreage proportionally by score, capped at 40% per crop to avoid monoculture, and respects each crop's minimum viable acreage.

---

## Git Push — Steps Followed

1. Set git identity: `git config user.name / user.email`
2. Initialized repo: `git init`
3. Created `.gitignore` (excluded `.env`, `venv/`, `node_modules/`, `*.db`)
4. Staged all files: `git add .`
5. Committed: `git commit -m "Initial commit: Smart Farm DSS with multi-crop system"`
6. Added remote: `git remote add origin <repo-url>`
7. Push rejected — remote had an existing commit (initial README by repo owner)
8. Pulled with: `git pull origin main --allow-unrelated-histories --no-edit`
9. Resolved 6 merge conflicts by keeping our version: `git checkout --ours <files>`
10. Staged resolved files and committed merge: `git add . && git commit --no-edit`
11. Pushed successfully: `git push -u origin main`

---

## Contributors

| Name | Role |
|------|------|
| Harsh Kumar Verma | Developer |
| Aadarsh Dubey | Team Lead / Repo Owner |
