# How to Run — Smart Farm DSS

A complete guide to running this project locally on Windows.

---

## What's in This Project

| Service | Tech | Port |
|---|---|---|
| Backend API | Node.js + Express + Prisma | 3001 |
| Frontend | Next.js | 3000 |
| Intelligence | Python + FastAPI | 8001 (not yet implemented) |
| Database | MongoDB | 27017 |

---

## Prerequisites — Install These First

### 1. Node.js (v20 or higher)
You already have Node v22 installed. ✅
Verify: `node --version`

### 2. MongoDB
The backend uses MongoDB. You have two options:

**Option A — MongoDB Atlas (recommended, no install needed)**
1. Go to https://www.mongodb.com/cloud/atlas
2. Create a free account and a free cluster
3. Click "Connect" → "Drivers" → copy the connection string
4. It looks like: `mongodb+srv://<user>:<pass>@cluster0.xxxxx.mongodb.net/smart_farm`

**Option B — MongoDB locally on Windows**
1. Download from https://www.mongodb.com/try/download/community
2. Install with default settings
3. MongoDB must run as a **Replica Set** because Prisma requires it.
   After install, run this once in a terminal:
   ```
   mongod --replSet rs0 --dbpath "C:\data\db"
   ```
   Then in a second terminal:
   ```
   mongosh --eval "rs.initiate()"
   ```
   Your connection string will be:
   `mongodb://127.0.0.1:27017/smart_farm?replicaSet=rs0&directConnection=true`
   (This is already set in backend/.env)

### 3. Docker (optional — only needed for full stack)
Download Docker Desktop from https://www.docker.com/products/docker-desktop/
Not required if you just want to run the backend + frontend locally.

---

## Method 1 — Run Locally (Recommended for Development)

This runs the backend and frontend directly on your machine without Docker.

### Step 1 — Clone / open the project

If you already have it on your desktop, just open a terminal in the project folder:
```bash
cd C:\Users\SHRESTH\Desktop\smart-farm-dss
```

### Step 2 — Install all dependencies

Run this once from the project root:
```bash
npm install
```

This installs dependencies for backend, frontend, and root (it's a monorepo with workspaces).

### Step 3 — Set up the backend environment

The file `backend/.env` already exists with default values. Open it and check:
```
DATABASE_URL=mongodb://127.0.0.1:27017/smart_farm?replicaSet=rs0&directConnection=true
```

If you are using MongoDB Atlas, replace that line with your Atlas connection string:
```
DATABASE_URL=mongodb+srv://<user>:<password>@cluster0.xxxxx.mongodb.net/smart_farm
```

The JWT_SECRET is already set for development — leave it as is.

### Step 4 — Generate the Prisma client

Run this once (and again any time you change schema.prisma):
```bash
npm run db:generate
```

Or from the backend folder:
```bash
cd backend
npx prisma generate
```

### Step 5 — Push the database schema

This creates all the collections in MongoDB:
```bash
npm run db:push
```

Or from the backend folder:
```bash
cd backend
npx prisma db push
```

### Step 6 — Run the backend

Open a terminal and run:
```bash
npm run dev:backend
```

You should see:
```
🚀 Server running on port 3001 in development mode
```

Test it's working: http://localhost:3001/health

### Step 7 — Run the frontend

Open a **second terminal** and run:
```bash
npm run dev:frontend
```

You should see:
```
▲ Next.js 14
- Local: http://localhost:3000
```

Open your browser at: http://localhost:3000

### Step 8 — Run both at the same time (optional)

Instead of two terminals, you can run both together from the project root:
```bash
npm run dev
```

This uses `concurrently` to run backend + frontend side by side.

---

## Method 2 — Run with Docker (Full Stack)

Use this if you want MongoDB, Redis, MinIO, and everything running in containers.

### Requirements
- Docker Desktop installed and running

### Step 1 — Create a docker .env file

Create a file at `docker/.env` (next to docker-compose.yml):
```
POSTGRES_PASSWORD=smart_farm_dev
JWT_SECRET=change-me-to-something-long-and-random-32chars
FRONTEND_URL=http://localhost:3000
MINIO_ROOT_USER=smartfarm
MINIO_ROOT_PASSWORD=smartfarm123
```

### Step 2 — Start everything

From the project root:
```bash
npm run docker:up
```

Or directly:
```bash
docker-compose -f docker/docker-compose.yml up -d
```

### Step 3 — Check services are running
```bash
npm run docker:logs
```

### Step 4 — Stop everything
```bash
npm run docker:down
```

### Docker service URLs

| Service | URL |
|---|---|
| Frontend | http://localhost:3000 |
| Backend API | http://localhost:3001 |
| Health check | http://localhost:3001/health |
| MinIO console | http://localhost:9001 |
| Flower (Celery) | http://localhost:5555 |

---

## API Endpoints (Backend)

Once the backend is running on port 3001, these routes are available:

| Method | Route | Description |
|---|---|---|
| GET | /health | Server health check |
| POST | /api/auth/register | Create account |
| POST | /api/auth/login | Login |
| POST | /api/auth/refresh | Refresh access token |
| POST | /api/auth/logout | Logout |
| GET | /api/auth/profile | Get logged-in user profile |
| GET | /api/farms | List your farms |
| POST | /api/farms | Create a farm |
| GET | /api/farms/:id | Get a farm |
| PUT | /api/farms/:id | Update a farm |
| DELETE | /api/farms/:id | Archive a farm |
| GET | /api/farms/:id/crops | List crops on a farm |
| POST | /api/farms/:farmId/crops | Add a crop |
| GET | /api/farms/:farmId/crops/:cropId/dashboard | Crop dashboard |
| GET | /api/weather/forecast/:farmId | Weather forecast |
| GET | /api/weather/irrigation/:farmId | Irrigation guidance |
| GET | /api/alerts/:farmId | Get alerts |
| GET | /api/market/prices/:farmId | Market prices |

---

## Common Errors and Fixes

**Error: `DATABASE_URL` is required**
→ Make sure `backend/.env` exists and has a valid MongoDB connection string.

**Error: `JWT_SECRET must be at least 32 characters`**
→ Open `backend/.env` and make sure `JWT_SECRET` is at least 32 characters long.

**Error: `MongoServerError: not primary`**
→ MongoDB is not running as a replica set. Run `rs.initiate()` in mongosh (see Step 2 above).

**Error: `Cannot find module '@prisma/client'`**
→ Run `npm run db:generate` to regenerate the Prisma client.

**Error: `EADDRINUSE: address already in use 3001`**
→ Something else is already on port 3001. Stop it or change `PORT` in `backend/.env`.

**Frontend shows blank page / 404**
→ The frontend `src/app/` folder is currently empty — the UI pages haven't been built yet.
   The backend API is fully functional; the frontend is scaffolded but not implemented.

**`npm install` fails with workspace errors**
→ Make sure you are running from the project root (where the root `package.json` is), not inside `backend/` or `frontend/`.

---

## Project Status

| Layer | Status |
|---|---|
| Backend API (auth, farms, crops, weather, health, market, alerts) | ✅ Implemented |
| Database schema (MongoDB via Prisma) | ✅ Implemented |
| Irrigation engine (FAO-56 water balance) | ✅ Implemented |
| Open-Meteo weather client | ✅ Implemented |
| Crop knowledge base (9 crops, diseases, pests) | ✅ Implemented |
| Frontend (Next.js UI) | ⚠️ Scaffolded, pages not yet built |
| Intelligence service (Python/FastAPI/ML) | ⚠️ Scaffolded, not yet implemented |

You can fully use and test the backend API right now.
The frontend and intelligence service are the next things to build.

---

## Quick Start Summary (TL;DR)

```bash
# 1. Install deps
npm install

# 2. Generate Prisma client
npm run db:generate

# 3. Push schema to MongoDB
npm run db:push

# 4. Run backend + frontend together
npm run dev
```

Then open:
- Frontend → http://localhost:3000
- Backend health → http://localhost:3001/health
