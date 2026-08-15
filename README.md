# Smart Farm DSS

An AI-powered farm decision-support system for Indian smallholders: crop
recommendations, weather-driven irrigation, crop-photo disease diagnosis,
community outbreak alerts, fertiliser planning and yield prediction — in six
languages, with voice, and usable offline.

---

## Team Name

**RICR-HIM-1104** — HackInMotion Hackathon

## Team Members

| Name              |
| ----------------- |
| Aadarsh Dubey     |
| Harsh Kumar Verma |
| Aaryan            |
| Vijay Patel       |

## Deployment Link

- **Frontend** http://65.0.45.45:3000

- **Backend API** http://65.0.45.45:3001 

- **Nginx** https://65.0.45.45



## Selected Theme

**Agriculture / AgriTech — Smart Farming Decision Support.**

Two challenge statements from the theme are implemented as first-class features:

> **Pest/Disease Outbreak Community Alerts** — Let nearby farmers see if others in
> their area are reporting similar crop health issues, to catch outbreaks early.

> **Fertilizer & Resource Planning** — Recommend fertilizer type/quantity based on
> crop, soil, and growth stage.

---

## Problem Statement

A smallholder farmer in India makes high-stakes decisions on thin information.

- **They irrigate on habit, not on need.** Watering a field that does not need it
  wastes water and money; missing the moment a crop enters stress costs yield.
  Neither is visible by looking at the surface of the soil.
- **They see a diseased leaf and cannot name it.** Extension officers are
  stretched thin, a wrong guess means the wrong spray, and by the time an
  infection is obvious it is often too late to contain.
- **They find out about an outbreak last.** Blight moving through neighbouring
  fields is the single best predictor of what is about to reach theirs, and that
  information never travels between farms.
- **They over-apply fertiliser.** Generic shop advice ignores what their soil
  already holds. Buying nutrients the field does not need wastes scarce cash and
  leaches into groundwater.
- **Most tools are unusable for them anyway** — English-only, text-heavy, and
  assuming a live connection that a field does not have.

## Solution Overview

Smart Farm DSS answers one question on every screen: _what do I need to act on
today?_ Each module is failure-isolated, so a provider outage degrades one card
rather than the whole app.

| Feature                            | What it does                                                                                                                                                                                                                                                                                                                                                                                        |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Crop photo diagnosis**           | A photo is analysed by a vision model (Google Gemini, falling back to a local Ollama model, then Plant.id). The model returns _observed symptoms_, which are scored against a curated symptom vocabulary alongside the farmer's own words, recent weather and host susceptibility — so the photo becomes evidence the rule engine corroborates rather than a verdict taken on trust.                |
| **Community outbreak alerts**      | Live reports from farms within 25 km over 14 days are clustered by problem and crop. Problem names are canonicalised first, so `Alternaria solani` from the vision model groups with `early blight` typed by a neighbour. Two or more other farms is flagged as an outbreak; a single nearby report is still shown, labelled as such. Farms are never identified — distances are rounded to 0.5 km. |
| **Fertiliser & resource planning** | ICAR package-of-practices dosing for the crop, adjusted for soil nutrient bands, **pH** (phosphorus is locked up below pH 5.5 and above 8.5), **organic carbon** (humus-rich soil supplies its own nitrogen) and **growth stage** — reported as bags to buy and a split schedule, with passed splits marked.                                                                                        |
| **Weather & irrigation**           | FAO-56 water balance from Open-Meteo forecasts. Produces a depth in mm, not a yes/no.                                                                                                                                                                                                                                                                                                               |
| **Crop recommendations**           | Ranks crops on climate, season, soil, water need and market price.                                                                                                                                                                                                                                                                                                                                  |
| **Yield prediction**               | Transparent stress-factor model that shows its working.                                                                                                                                                                                                                                                                                                                                             |
| **Market prices**                  | Mandi price trends per crop with sell/hold signals.                                                                                                                                                                                                                                                                                                                                                 |
| **Voice + 6 languages**            | English, Hindi, Punjabi, Telugu, Marathi, Bengali. Read-aloud briefing and voice commands.                                                                                                                                                                                                                                                                                                          |
| **Offline-first**                  | localStorage cache plus a write queue that replays mutations on reconnect.                                                                                                                                                                                                                                                                                                                          |

### Design principle: no invented numbers

Every figure on screen is a real reading or a visible blank (`—`). A plausible
wrong number is worse for a farmer than an obvious gap, so the dashboard renders
nothing rather than a placeholder, and states when a photo could not be analysed
or a soil figure is modelled rather than lab-tested.

---

## Technology Stack

**Backend** — Node.js, Express 4, TypeScript 5, Prisma 5 ORM, Zod validation,
JWT (`jsonwebtoken`) + bcrypt, Multer uploads, Pino logging, Nodemailer.

**Frontend** — Next.js 14 (App Router), React 18, Tailwind CSS 3, Recharts,
lucide-react, Web Speech API.

**Database** — MongoDB Atlas (Prisma requires a replica set).

**External services**

| Service           | Purpose                                    | Key required                                                                     |
| ----------------- | ------------------------------------------ | -------------------------------------------------------------------------------- |
| Open-Meteo        | Weather & forecasts                        | **No**                                                                           |
| SoilGrids (ISRIC) | Soil texture, nitrogen, pH, organic carbon | **No**                                                                           |
| Nominatim (OSM)   | Reverse geocoding                          | **No**                                                                           |
| Google Gemini     | Crop photo analysis                        | Yes — **free**, [aistudio.google.com/apikey](https://aistudio.google.com/apikey) |
| Ollama            | Local crop photo analysis (fallback)       | No — needs a model pulled locally                                                |
| Plant.id          | Crop photo analysis (fallback)             | Yes (paid)                                                                       |
| data.gov.in       | Mandi price data                           | Yes (free)                                                                       |
| Google Sign-In    | Optional auth                              | Client ID only — no client secret                                                |
| Gmail SMTP        | Email OTP                                  | App Password                                                                     |

Every keyed service degrades gracefully: an unset key disables one feature and
never blocks server boot.

---

## Installation Guide

**Prerequisites:** Node.js 20+, npm 10+, and internet access (the database is
cloud-hosted).

```bash
# 1. Clone and install (npm workspaces — installs backend + frontend)
git clone <repo-url>
cd smart-farm-dss
npm install

# 2. One-command setup: copies .env files, generates the Prisma client, checks the DB
npm run setup

# 3. Seed reference data (crop varieties, sample prices)
npm run db:seed

# 4. Run — two terminals
npm run dev:backend     # → http://localhost:3001
npm run dev:frontend    # → http://localhost:3000
```

**To enable crop photo diagnosis** (strongly recommended — without it an uploaded
photo is stored but never analysed, and the diagnosis falls back to the typed
description alone):

1. Get a free key at [aistudio.google.com/apikey](https://aistudio.google.com/apikey)
   — no billing account or card needed.
2. Add `GEMINI_API_KEY=<your-key>` to `backend/.env`.
3. Restart the backend.

> **No local MongoDB needed.** The project uses a shared MongoDB Atlas cluster;
> the connection string ships in `.env.example` and is copied to `backend/.env`
> by `npm run setup`.

### Useful commands

```bash
npm run dev             # Backend + frontend together
npm run build           # Build both workspaces
npm run verify          # Typecheck + lint + format check
npm run lint            # ESLint across both workspaces
npm run db:generate     # Regenerate Prisma client after schema changes
npm run db:push         # Push schema changes to the database
npm run db:studio       # Visual database browser
npm run docker:up       # Optional containerised stack
```

### Running a local MongoDB instead

```powershell
# As Administrator — enables the replica set Prisma requires
powershell -ExecutionPolicy Bypass -File .\setup-mongo-replicaset.ps1
```

Then set in `backend/.env`:

```
DATABASE_URL=mongodb://127.0.0.1:27017/smart_farm?replicaSet=rs0&directConnection=true
```

---

## Environment Variables

### Files

| File                          | Purpose                        | Committed?             |
| ----------------------------- | ------------------------------ | ---------------------- |
| `.env.example`                | Template, Atlas URL pre-filled | ✅ Yes                 |
| `backend/.env.example`        | Backend-only template          | ✅ Yes                 |
| `frontend/.env.local.example` | Frontend template              | ✅ Yes                 |
| `backend/.env`                | Real secrets                   | ❌ **No** — gitignored |
| `frontend/.env.local`         | Frontend config                | ❌ **No** — gitignored |

`npm run setup` creates both ignored files. **Never commit a real key.**

### Backend — required

| Variable       | Notes                                                                                            |
| -------------- | ------------------------------------------------------------------------------------------------ |
| `DATABASE_URL` | MongoDB connection string. Must be a replica set.                                                |
| `JWT_SECRET`   | ≥32 chars. Known placeholders are **rejected at boot** — generate one: `openssl rand -base64 48` |

### Backend — crop photo analysis

| Variable                | Default                  | Notes                                                                            |
| ----------------------- | ------------------------ | -------------------------------------------------------------------------------- |
| `GEMINI_API_KEY`        | —                        | **Set this.** Free key, primary vision provider.                                 |
| `GEMINI_VISION_MODEL`   | `gemini-2.5-flash`       | Must support images.                                                             |
| `GEMINI_TIMEOUT_MS`     | `90000`                  | Real photos measure 30–40s; do not lower much.                                   |
| `OLLAMA_VISION_MODEL`   | `gemma3:4b`              | Fallback. `ollama pull gemma3:4b` (~3 GB).                                       |
| `OLLAMA_VISION_ENABLED` | `true`                   |                                                                                  |
| `OLLAMA_BASE_URL`       | `http://localhost:11434` |                                                                                  |
| `OLLAMA_TIMEOUT_MS`     | `120000`                 | A cold model load is slow.                                                       |
| `OLLAMA_KEEP_ALIVE`     | `10m`                    | Keeps weights resident between photos.                                           |
| `VISION_PREFER_LOCAL`   | `false`                  | `true` puts Ollama ahead of Gemini, for when photos must not leave the premises. |
| `PLANT_ID_API_KEY`      | —                        | Paid. Tried last.                                                                |

### Backend — optional

| Variable              | Default                 | Notes                                                      |
| --------------------- | ----------------------- | ---------------------------------------------------------- |
| `PORT`                | `3001`                  |                                                            |
| `NODE_ENV`            | `development`           |                                                            |
| `FRONTEND_URL`        | `http://localhost:3000` | CORS origin.                                               |
| `PUBLIC_URL`          | `http://localhost:3001` | Used to build photo URLs.                                  |
| `UPLOAD_DIR`          | `uploads`               |                                                            |
| `JWT_EXPIRES_IN`      | `7d`                    |                                                            |
| `BCRYPT_ROUNDS`       | `10`                    |                                                            |
| `DATA_GOV_IN_API_KEY` | —                       | Mandi prices; seeded data used without it.                 |
| `GOOGLE_CLIENT_ID`    | —                       | Unset hides the Google button. No secret needed.           |
| `EMAIL_USER`          | —                       | Gmail address for OTP.                                     |
| `EMAIL_APP_PASSWORD`  | —                       | 16-char Google **App Password**, not the account password. |
| `OPENWEATHER_API_KEY` | —                       | Not needed; Open-Meteo is keyless.                         |

### Frontend

| Variable                       | Notes                                               |
| ------------------------------ | --------------------------------------------------- |
| `NEXT_PUBLIC_API_URL`          | Defaults to `http://localhost:3001/api`             |
| `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | Same value as `GOOGLE_CLIENT_ID`. Public by design. |

---

## API Documentation

Full reference with request/response examples: **[`api-documentation.md`](./api-documentation.md)**

All routes are under `/api`. 🔒 marks endpoints requiring
`Authorization: Bearer <accessToken>`.

**Response envelope** — every response, success or failure:

```json
{ "success": true,  "data": { } }
{ "success": false, "error": { "code": "VALIDATION_ERROR", "message": "…", "details": { } } }
```

| Group           | Base path                      | Highlights                                                                                                                      |
| --------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| Health          | `/api/health`                  | Liveness probe; `503` if the database is unreachable                                                                            |
| Auth            | `/api/auth`                    | Register, login (username _or_ email), Google, refresh, email OTP, password reset                                               |
| Farms           | `/api/farms`                   | Farm CRUD, plots, crops, supported crops, `location-info` (address + soil from coordinates)                                     |
| Weather         | `/api/weather/:farmId`         | `forecast`, `irrigation` (FAO-56 water balance), irrigation logs                                                                |
| Crop health     | `/api/crop-health/:farmId`     | `observations` (photo upload + diagnosis), `nearby` (outbreak clustering), `community-reports`, authenticated `photo/:filename` |
| Market          | `/api/market`                  | Per-farm and per-commodity price trends, mandi locations                                                                        |
| Recommendations | `/api/recommendations/:farmId` | Ranked crop suitability                                                                                                         |
| Planning        | `/api/planning/:farmId`        | Fertiliser plan, yield prediction, yield history, record harvest                                                                |
| Alerts          | `/api/alerts/:farmId`          | Feed, counts, mark read, dismiss                                                                                                |
| Dashboard       | `/api/dashboard/:farmId`       | Aggregated, failure-isolated payload for the home screen                                                                        |

Crop photos are **not** served statically — `/api/crop-health/photo/:filename`
authenticates and verifies farm ownership before streaming a byte.

---

## Database Details

**MongoDB Atlas** accessed through **Prisma 5**. A replica set is required
(Prisma uses transactions); the shared Atlas cluster already is one.

16 models and 11 enums in
[`backend/src/prisma/schema.prisma`](./backend/src/prisma/schema.prisma):

| Domain         | Models                                                                       |
| -------------- | ---------------------------------------------------------------------------- |
| Identity       | `User`, `Session`, `EmailOtp`, `PasswordReset`                               |
| Farm structure | `Farm`, `Parcel`, `Crop`, `CropVariety`                                      |
| Environment    | `WeatherData`, `SoilData`, `IrrigationLog`                                   |
| Advisory       | `HealthLog`, `PriceHistory`, `Alert`, `Recommendation`, `YieldPredictionLog` |

Enums: `UserRole`, `FarmStatus`, `CropStatus`, `GrowthStage`, `SoilType`,
`IrrigationMethod`, `AlertType`, `AlertSeverity`, `HealthObservationType`,
`HealthSeverity`, `HealthStatus`.

Notes worth knowing:

- `Farm.soilAnalysis` is JSON — either a farmer-entered soil health card
  (`source: 'soil-health-card'`) or bands derived from SoilGrids at farm creation
  (`source: 'soilgrids'`). Which one is behind a fertiliser plan is reported to
  the farmer, because a lab test and a modelled raster do not warrant the same
  confidence.
- `Alert.dedupeKey` is unique, so a repeated condition updates one row instead of
  spamming the feed.
- `HealthLog.analysisResult` is JSON holding the ranked differential, confidence
  and weather context for the observation.

```bash
npm run db:generate   # after any schema change
npm run db:push       # apply schema to the database
npm run db:seed       # crop varieties + reference data
npm run db:studio     # browse
```

---

## Architecture Diagram

- Rendered diagram: [`architecture/architecture-diagram.png`](./architecture/architecture-diagram.png)
- Source / interactive: [`architecture/architecture-diagram.md`](./architecture/architecture-diagram.md), [`architecture/diagram.html`](./architecture/diagram.html)
- Deeper write-ups: [`docs/project-overview.md`](./docs/project-overview.md), [`docs/tech-stack-api-selection.md`](./docs/tech-stack-api-selection.md)

```
┌──────────────────────────────────────────────────────────────┐
│  Next.js 14 frontend — App Router, Tailwind                  │
│  offline cache + write queue · voice · 6 languages           │
└───────────────────────────┬──────────────────────────────────┘
                            │  REST /api  (JWT bearer)
┌───────────────────────────▼──────────────────────────────────┐
│  Express + TypeScript backend                                │
│                                                              │
│  auth │ farms │ weather │ crop-health │ market │ planning     │
│       │ recommendations │ alerts │ dashboard                 │
│                                                              │
│  domain/  crop profiles · nutrition tables · symptom lexicon  │
│  Every module failure-isolated (Promise.allSettled)          │
└──────┬───────────────────────────────┬───────────────────────┘
       │ Prisma 5                      │ external providers
┌──────▼─────────┐   ┌─────────────────▼──────────────────────┐
│ MongoDB Atlas  │   │ Open-Meteo · SoilGrids · Nominatim     │
│ (replica set)  │   │ Gemini → Ollama → Plant.id (vision)    │
└────────────────┘   │ data.gov.in · Google Sign-In · Gmail   │
                     └────────────────────────────────────────┘
```

---

## Screenshots

<img width="1892" height="898" alt="image" src="https://github.com/user-attachments/assets/31023234-113d-4492-b774-6c55e500e68a" />

<img width="1890" height="884" alt="image" src="https://github.com/user-attachments/assets/0ebca56b-fc76-40ea-ad29-d230ddedec20" />

<img width="1885" height="880" alt="Crop health" src="https://github.com/user-attachments/assets/f84f0b35-b5c9-4f44-ab96-a327b7c82b72" />

<img width="369" height="423" alt="Mobile detail" src="https://github.com/user-attachments/assets/60a7083a-ea95-469c-b424-7460e049e8f2" />

<img width="1892" height="887" alt="Planning" src="https://github.com/user-attachments/assets/d031e024-d988-4106-9281-9bd1e908ec1b" />

<img width="1887" height="875" alt="Market prices" src="https://github.com/user-attachments/assets/1f2d9f68-0c1a-4a5d-899a-e556c0db447f" />

<img width="367" height="797" alt="Mobile dashboard" src="https://github.com/user-attachments/assets/ff00f7c0-261a-4bf8-80c8-fdd718f18d69" />

<img width="368" height="801" alt="Mobile community alerts" src="https://github.com/user-attachments/assets/9d09afb7-d445-4b84-b72b-dc0c15d7d7e9" />

---



---

## Future Scope

- **Soil health card entry.** SoilGrids models nitrogen, pH and organic carbon
  but not plant-available phosphorus or potassium, so those bands are
  deliberately left unset rather than guessed. Letting a farmer type their soil
  health card values would sharpen the P and K doses directly.
- **Push notifications for outbreaks.** Clustering already detects a spreading
  problem; reaching the farmer currently requires them to open the app.
- **Treatment outcome tracking.** `HealthLog` records when an issue was observed
  but never when it resolved, which is also why the health card shows a severity
  breakdown rather than a trend line. Capturing resolution would enable both.
- **On-device vision.** A quantised model in the browser would make photo
  diagnosis work with no connection at all.
- **Wider crop coverage.** The curated disease/pest and nutrition tables cover
  the major Indian crops; unrecognised crops fall back to generic figures and are
  labelled as such.
- **Real service worker.** Offline support is localStorage-based today; a service
  worker would cache the app shell for a genuine cold start offline.
- **Automated tests.** The engines are pure functions and well suited to unit
  tests; coverage is currently thin.


  ## Demo user

  - Name ->    Demo

  - Email ->    Demo@gmail.com

  - password -> Demo@123
