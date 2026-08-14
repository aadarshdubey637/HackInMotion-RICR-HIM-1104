# Smart Farm DSS

> **HackInMotion Hackathon** — Team **RICR-HIM-1104**

AI-powered farm advisory: crop recommendations, weather-based irrigation, pest/disease alerts, fertilizer planning, yield prediction — works offline.

---
## deployment link
frontend http://65.0.45.45:3000

backend http://65.0.45.45:3001


## Team

| Name |
|---|
| Aadarsh Dubey | 
|Harsh Kumar Verma| 
| Aaryan |
|Vijay Patel|

---

## Quick start for new team members

```bash
# 1. Clone and install
git clone <repo-url>
cd smart-farm-dss
npm install

# 2. One-command setup (copies .env, generates Prisma client, checks DB)
npm run setup

# 3. Start the app
npm run dev:backend     # terminal 1 → http://localhost:3001
npm run dev:frontend    # terminal 2 → http://localhost:3000
```

> **No MongoDB installation needed.** The project uses a shared MongoDB Atlas cluster.  
> The connection string is pre-filled in `.env.example` and copied to `backend/.env` by `npm run setup`.

---

## Database

We use **MongoDB Atlas** (free tier, shared dev cluster). Everyone on the team connects to the same database automatically.

**Requirements:** Internet access (Atlas is cloud-hosted). No local MongoDB, no Docker, no replica-set setup.

### After pulling new code

If a teammate changed `schema.prisma`, regenerate the Prisma client:

```bash
npm run db:generate
```

If the schema has new collections that need data:

```bash
npm run db:seed
```

### If you want a local MongoDB instead

1. Install [MongoDB Community](https://www.mongodb.com/try/download/community) and [mongosh](https://www.mongodb.com/try/download/shell)
2. Run (as Administrator) to enable the replica set Prisma needs:
   ```
   powershell -ExecutionPolicy Bypass -File .\setup-mongo-replicaset.ps1
   ```
3. Change `DATABASE_URL` in `backend/.env` to:
   ```
   DATABASE_URL=mongodb://127.0.0.1:27017/smart_farm?replicaSet=rs0&directConnection=true
   ```

---

## Project structure

```
smart-farm-dss/
├── backend/          Express + Prisma + MongoDB
│   └── src/
│       ├── modules/  Feature modules (auth, weather, crops, health, market…)
│       ├── prisma/   schema.prisma + seed scripts
│       └── domain/   Crop data, nutrition tables
├── frontend/         Next.js 14 App Router + Tailwind
│   └── src/
│       ├── app/      Pages (dashboard, weather, health, planning, community…)
│       ├── components/
│       └── lib/      API client, offline cache, voice, translations
└── scripts/          Dev tooling (setup.js)
```

---

## Environment files

| File | Purpose | Committed? |
|---|---|---|
| `.env.example` | Template with shared Atlas URL pre-filled | ✅ Yes |
| `backend/.env` | Actual secrets (copied from `.env.example`) | ❌ No (gitignored) |
| `frontend/.env.local` | Frontend API URL | ❌ No (gitignored) |

`npm run setup` creates both ignored files automatically.

---

## Useful commands

```bash
npm run setup           # First-time setup: copy .env, generate Prisma, check DB
npm run dev:backend     # Start backend on :3001
npm run dev:frontend    # Start frontend on :3000
npm run db:generate     # Regenerate Prisma client after schema changes
npm run db:push         # Push schema changes to the database
npm run db:seed         # Seed crop varieties and sample price data
npm run db:studio       # Open Prisma Studio (visual DB browser)
```

---

## Features

| Feature | Status |
|---|---|
| Crop Recommendation Engine | ✅ Climate + soil + market scoring |
| Voice Interface | ✅ 6 Indian languages (Hindi, Punjabi, Telugu, Marathi, Bengali, English) |
| Community Pest/Disease Alerts | ✅ Outbreak detection within 5 km radius |
| Fertilizer & Resource Planning | ✅ ICAR-based dosing, soil-adjusted |
| Yield Prediction | ✅ Transparent stress-factor model |
| Offline-First | ✅ localStorage cache + write queue, auto-sync on reconnect |

---

## Tech stack

- **Backend:** Node.js, Express, TypeScript, Prisma ORM
- **Database:** MongoDB Atlas
- **Frontend:** Next.js 14, React, Tailwind CSS, Recharts
- **Auth:** JWT (access + refresh tokens)
- **Weather:** Open-Meteo (no API key needed)
- **Offline:** localStorage cache + write queue (no service worker)