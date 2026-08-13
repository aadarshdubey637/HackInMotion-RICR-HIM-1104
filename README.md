# Smart Farm Decision Support System

**HackInMotion — Team RICR-HIM-1104**

A web application that turns weather, agronomy and market data into clear,
specific advice for a farmer: *should I irrigate today, is this leaf spot
serious, and is now a good time to sell?*

> *"Because a farmer's biggest risk isn't hard work — it's making the wrong
> decision at the wrong time."*

---

## The problem we're solving

The information a farmer needs already exists — forecasts, agronomic thresholds,
mandi prices — but it is scattered, raw, and rarely phrased as a decision. A
7-day forecast is not advice. "32°C, 70% humidity" does not tell you whether to
irrigate.

This app does the interpretation. Every screen answers a question a farmer would
actually ask, and every recommendation explains *why*, so it can be trusted or
overruled.

---

## What it does

### 1. Accounts and farm profiles
Email/password sign-up with JWT auth. Every query is scoped by user id, so one
farmer can never see another's data. A profile captures location, land size,
soil type and crops — and that profile drives everything else. Nothing in the app
is generic advice.

### 2. Irrigation guidance — the core engine
Rather than reacting to "did it rain", the app maintains a **running soil water
balance** for the root zone, following FAO Irrigation & Drainage Paper 56:

```
depletion(t) = depletion(t-1) + ETc(t) − Pe(t) − irrigation(t)

  ETc = ET₀ × Kc      crop water use (reference ET × crop coefficient)
  Pe                  effective rainfall — what actually reaches the roots
```

Irrigation is advised when depletion reaches the crop's **Readily Available
Water** — the point at which the plant starts working to extract moisture and
yield begins to suffer.

This is what lets the app say *"hold off, Thursday's rain will cover you"*
instead of just showing a forecast. Inputs are crop-specific (rice tolerates
~20% depletion; wheat, with 1.2 m roots, tolerates ~55%) and soil-specific
(sandy soil holds 70 mm/m of available water, clay 180 mm/m).

It also issues risk alerts — heat stress, frost, heavy rain, dry spells, high
wind — each with a specific action, not just a warning.

### 3. Crop health monitoring
The farmer describes what they see and optionally attaches a photo. The engine
returns a **ranked differential diagnosis** with confidence scores, evidence, and
what to check next. Approach and justification in
[Crop health](#3-crop-health-analysis-rule-based-engine) below.

### 4. Market price insights
Recent mandi price trends per crop, with 7/30-day movement, volatility, and a
plain-language sell/hold signal that compares today's price against the recent
range.

### 5. Unified dashboard
Everything collapses into one ranked list: **what to act on today**. Irrigation,
weather risks, health flags and price opportunities are scored by urgency and
sorted together, so the farmer opens the app and immediately knows what matters.

---

## Bonus challenges — all six implemented

| Challenge | How it works |
|---|---|
| **Crop recommendation engine** | Scores every crop on five weighted dimensions — climate 30%, season 25%, soil 20%, water 15%, market 10% — using **real historical climate** for the farm's exact coordinates (Open-Meteo archive, 3-year average over the coming 120-day window), not a forecast. Every dimension returns a plain-language reason. |
| **Fertilizer & resource planning** | Converts N-P-K requirements into bags of urea, DAP and MOP with a split-dose schedule. Adjusts for soil test values (±25% by nutrient level), adds 10% on sandy soil for leaching, and correctly **subtracts DAP's 18% nitrogen from the urea requirement** — skipping that step over-applies nitrogen. Stages already passed are marked done. |
| **Yield prediction** | Transparent stress-factor model: `attainable × water × heat × health × management`. Each factor is derived from data actually held (water balance, logged weather, health observations) and returned with its reason and loss percentage. Uncertainty narrows as the season progresses. |
| **Pest/disease outbreak alerts** | Anonymous aggregation of severe reports from farms within 50 km over 21 days, surfaced on the dashboard and health page. Individual farms are never identified. |
| **Voice interface** | Two-way, in six languages. **Output:** one button composes a spoken briefing that leads with what needs acting on. **Input:** a mic button takes spoken commands ("मंडी भाव बताओ" → prices) and dictates symptom descriptions straight into the crop-health form. Both follow the selected language, and the spoken language is auto-detected — see below. |
| **Offline-first support** | Successful dashboard reads are cached in `localStorage`; when the network fails the cached copy is served with a visible "saved N hours ago" banner. Cache is cleared on sign-out so data cannot leak between accounts on a shared phone. |

**On offline support specifically:** we deliberately did *not* use a service
worker. `next-pwa` is unreliable with the Next.js 14 App Router, and a
half-working service worker that serves stale JavaScript is worse for a farmer
than none at all. The localStorage approach covers the case that actually
matters — *"I opened the app in a field with no signal and still need to know
whether to irrigate."*

### Language and voice

The interface ships in **six languages** — English, Hindi, Punjabi, Telugu,
Marathi and Bengali — switchable from any screen, including the sign-in page
(a farmer handed a phone in the wrong language cannot navigate to a settings
page to fix it). The choice is saved to the account, so it follows the farmer
to another device.

**Voice input and language detection.** The Web Speech API has no language
auto-detection: `recognition.lang` must be set *before* listening, and the
recogniser forces whatever it hears into that language. So detection is done
in two layers instead:

1. Listen in the language the app is set to — right the vast majority of the time.
2. Match the transcript against the command vocabulary of **every** language at
   once. Only the Punjabi list contains "ਮੰਡੀ ਭਾਅ", so matching it both resolves
   the intent (open prices) *and* proves the farmer is speaking Punjabi. The app
   switches to Punjabi and answers in Punjabi. Script ranges catch the same case
   for dictated text; Hindi and Marathi share Devanagari and are separated by
   function words.

If neither fires, recognition is retried across the other locales before giving
up. Command matching ranks by **specificity, not phrase length** — "मेरी फसल में
बीमारी है" contains both "मेरी फसल" (crop list) and "बीमारी" (disease), and the
longer phrase is the less informative one.

**Dictated symptoms actually reach the diagnosis engine.** The rule engine
scores against an English symptom vocabulary, so "पत्तों पर पीले धब्बे" would
otherwise share no substring with "yellow patches" and score zero.
`crop-health/symptom-lexicon.ts` maps 43 regional symptom groups — Devanagari,
Gurmukhi, Bengali, Telugu and romanised spellings — onto the canonical English
keywords before scoring, so speaking Hindi or Punjabi diagnoses exactly as well
as typing English.

Recognition is Chrome/Edge/Safari only; Firefox has none. Everything degrades to
the typed input that was always there.

---

## Third-party data sources — what we chose and why

This was treated as a real engineering decision, not a default.

### 1. Weather: **Open-Meteo**

`https://api.open-meteo.com/v1/forecast` — no API key, no account.

| Option | Verdict |
|---|---|
| **Open-Meteo** ✅ | No key, no card. Publishes `et0_fao_evapotranspiration` directly. Modelled soil moisture at depth. `past_days` returns history in the same call. |
| OpenWeatherMap One Call 3.0 | ❌ The only tier exposing the agronomic fields we need **requires a credit card on file** even inside the free allowance. Unacceptable single point of failure for a graded demo. |
| WeatherAPI.com | ❌ Generous free tier, but no FAO-56 reference ET. We would have to derive ET₀ ourselves from temperature alone — markedly less accurate than a full Penman-Monteith computation. |

**Why it mattered most:** Open-Meteo publishes ET₀ computed by the FAO-56
Penman-Monteith equation from the full radiation/humidity/wind stack. That single
field is the input our irrigation engine is built on. Deriving it from a
general-purpose weather API would have measurably degraded every recommendation.

`past_days=7` also gives the water balance a history to converge on and the
disease rules their 7-day lookback — in one request.

**Integration:** `backend/src/modules/weather/openmeteo.ts`. 12s timeout,
1-hour cache in MongoDB, and on failure the service falls back to the last stored
bundle with a visible "data is N hours old" warning rather than an error screen.

*Licence: free for non-commercial use, CC-BY-4.0.*

### 2. Market prices: **AGMARKNET via data.gov.in**

Resource `9ef84268-d588-465a-a308-a864a43d0070` — *Current Daily Price of Various
Commodities from Various Markets (Mandi)*.

| Option | Verdict |
|---|---|
| **AGMARKNET / data.gov.in** ✅ | Authoritative Government of India mandi-level data, 300+ commodities, free, key issued instantly. |
| Scraping agmarknet.gov.in | ❌ No official API; brittle HTML, and hammering a government site during a hackathon is not defensible. |
| FAO FPMA / World Bank Pink Sheet | ❌ International commodity prices. Useless to a farmer choosing which mandi to sell at this week. |

**The honest limitation, and how we handled it:** that endpoint serves *only the
current day*. It has no history endpoint — so it cannot produce a trend on its
own. We therefore:

1. ingest daily snapshots and accumulate our own time series in MongoDB, which
   becomes genuinely real history the longer the app runs; and
2. ship a **seeded baseline series** so charts and trend analysis work from day
   one on a fresh database.

Seeded rows are tagged `source: 'seed'` and the API returns an `isSeeded` flag —
the UI shows *"Includes baseline data"* rather than passing generated numbers off
as observations. Seed values use approximate 2024-25 modal rates with real
seasonal structure (harvest gluts depress prices; lean months lift them), and are
deterministic so a rehearsed demo reproduces exactly.

**Integration:** `backend/src/modules/market/market.service.ts`.
Without a key the app serves stored history and stays fully functional.

### 3. Crop health analysis: **rule-based engine** (with optional Plant.id)

**We deliberately did not train an image classifier**, and did not want to claim
a photo model we could not validate. Instead the engine performs an
**evidence-weighted differential diagnosis** over three independent signals:

| Signal | What it contributes |
|---|---|
| **Symptoms** | Keyword matching of the farmer's description against a curated symptom vocabulary per disease. Multi-word phrases score higher — *"water soaked"* is far more diagnostic than *"spot"*. |
| **Epidemiology** | Whether recent weather at *that farm* actually favours the candidate. Late blight needs cool wet weather with leaf wetness; flagging it during a dry spell would be wrong regardless of symptoms. |
| **Host** | Which diseases affect this specific crop at all. |

Scores combine at 65% symptom / 35% weather, and the output is a *ranked
differential with explicit confidence*, not a single confident answer.

**Why this beats a naive image model here:**

- **Explainable.** The farmer sees exactly which words matched and which weather
  conditions applied.
- **It degrades honestly.** Vague input yields low confidence, not a confident guess.
- **It cannot hallucinate.** It will never flag a disease that is impossible for
  the crop, or one the weather actively contradicts. An image classifier can and does.

Verified behaviour:

| Input | Crop | Result |
|---|---|---|
| *"Diamond shaped lesions with grey centre and brown border"* | Rice | Rice Blast, 74%, SEVERE |
| *"Dark water soaked patches, white fuzz underneath, fruit rotting"* | Tomato | Late Blight, 66%, CRITICAL |
| *"Tiny white insects fly up when I shake the plant, sticky leaves"* | Tomato | Whitefly 56%, Aphids 37% (ranked differential) |
| *"The plants do not look very healthy"* | Rice | No diagnosis, 20% — asks for detail |

Findings are framed as *"go and check this"*, never *"your crop has X"*, and
every result carries its own limitations.

**Optional upgrade:** if `PLANT_ID_API_KEY` is set, Plant.id image analysis runs
and is folded in as an additional weighted signal — it never replaces the
reasoning above. Without a key, everything still works.

### 4. Agronomy data: curated knowledge base

`backend/src/domain/crops.ts` — 12 crops (rice, wheat, maize, cotton, tomato,
potato, sugarcane, soybean, onion, chickpea, mustard, groundnut) with crop
coefficients and rooting depths from **FAO-56 Tables 12 and 22**, and
disease/pest profiles from ICAR and state agricultural university advisories.

Unrecognised crops are accepted — a farmer knows their land better than our
database does — and fall back to conservative generic values, with the UI
flagging the guidance as approximate.

---

## Tech stack

| Layer | Technology | Why |
|---|---|---|
| Frontend | Next.js 14 (App Router), React 18, TypeScript | Mobile-first; App Router keeps bundles small on poor connections |
| Styling | Tailwind CSS | Severity colour is a design token, consistent everywhere |
| Charts | Recharts | Composable, responsive, small |
| Backend | Node 20, Express 4, TypeScript | Shared types with the frontend; one runtime for the whole system |
| Database | MongoDB + Prisma | Flexible for JSON-heavy weather/analysis payloads; type-safe access |
| Auth | JWT + bcryptjs | Stateless, standard |
| Validation | Zod | One schema definition, inferred types, farmer-readable error messages |
| Uploads | Multer → local disk | No object-storage dependency; swap for S3 by changing one path |

---

## Running it locally

### Prerequisites
Node 20+, and MongoDB **running as a replica set**.

> **Why a replica set?** Prisma's MongoDB connector wraps writes in transactions
> for emulated referential integrity, and MongoDB only supports transactions on a
> replica set. A default standalone `mongod` fails every write with `P2031`.
> MongoDB Atlas is a replica set out of the box. On Windows, where MongoDB is
> installed as a service on port 27017, convert that service in place — run
> `setup-mongo-replicaset.ps1` from an **Administrator** PowerShell once.
>
> To run a throwaway single-node set instead (foreground; dies with the terminal,
> so `DATABASE_URL` must match the port you choose):
>
> ```bash
> mongod --port 27017 --dbpath .mongodb/data --replSet rs0 --bind_ip 127.0.0.1
> mongosh --port 27017 --eval 'rs.initiate({_id:"rs0",members:[{_id:0,host:"127.0.0.1:27017"}]})'
> ```
>
> Either way, `DATABASE_URL` needs the replica-set params:
> `mongodb://127.0.0.1:27017/smart_farm?replicaSet=rs0&directConnection=true`

### Setup

```bash
git clone https://github.com/aadarshdubey637/HackInMotion-RICR-HIM-1104.git
cd HackInMotion-RICR-HIM-1104

# Backend
cd backend
npm install
cp ../.env.example .env        # then set DATABASE_URL and JWT_SECRET
npx prisma generate
npx prisma db push
npm run db:seed                # demo farm + 90 days of price history
npm run db:seed:community      # neighbouring farms, for outbreak alerts
npm run dev                    # http://localhost:3001

# Frontend (separate terminal)
cd frontend
npm install
echo "NEXT_PUBLIC_API_URL=http://localhost:3001/api" > .env.local
npm run dev                    # http://localhost:3000
```

### Demo account

```
farmer@demo.com  /  demo1234
```

A 3.2 ha farm near Lucknow with rice (vegetative) and tomato (flowering),
two plots, an irrigation record, and 90 days of price history across 12
commodities.

### Environment variables

Only two are required.

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | ✅ | MongoDB connection string |
| `JWT_SECRET` | ✅ | Minimum 32 characters |
| `PLANT_ID_API_KEY` | — | Enables image analysis; rule engine used without it |
| `DATA_GOV_IN_API_KEY` | — | Enables live mandi prices; seeded history used without it |
| `FRONTEND_URL` | — | CORS origin, defaults to `http://localhost:3000` |

**Weather needs no key.** By design — see above.

---

## Project structure

```
backend/
  src/
    config/           environment contract (Zod-validated, fail-fast)
    common/           errors, error handler, validation, logging, uploads
    domain/crops.ts   agronomy knowledge base — the system's reference data
    modules/
      auth/           JWT, sessions, password handling
      farm/           farm profiles, plots, crops
      weather/        openmeteo.ts (provider) + irrigation.ts (FAO-56 engine)
      crop-health/    diagnosis.ts (differential engine) + service
      market/         AGMARKNET ingestion, trend analysis, sell guidance
      alerts/         alert feed
      dashboard/      cross-cutting "what to do today" aggregation
    prisma/           schema + seed
frontend/
  src/
    app/              routes: login, register, onboarding, dashboard,
                      weather, health, market, crops
    components/       app shell + design system
    lib/              typed API client, auth context, formatting
legacy/               superseded implementations (see legacy/README.md)
```

---

## Error handling

Never leave the farmer with a blank or broken screen.

| Failure | Behaviour |
|---|---|
| Weather API down | Serve last stored forecast with a visible "N hours old" warning |
| No weather history either | Dashboard renders; other sections unaffected; irrigation card explains why |
| Market API down / no key | Serve stored history, labelled |
| Image analysis unavailable | Rule engine runs alone; result states the photo was not analysed |
| Photo too large / wrong type | Clean 400 with a plain-language message |
| Photo fails to save | Observation is still recorded; response warns the photo was lost |
| Unsupported crop | Accepted; generic agronomy used; UI flags guidance as approximate |
| Invalid id in URL | 400 with a readable message, not a 500 |
| Database unreachable | 503 with a retry message |

Each dashboard section resolves independently via `Promise.allSettled`, so one
failing upstream cannot blank the page.

---

## Design decisions worth calling out

**Confidence is always shown.** Irrigation guidance reports its confidence and
lists the assumptions it had to make ("soil type not recorded — assuming loamy").
Health results carry their limitations. A farmer deciding whether to spend money
on diesel deserves to know how sure the system is.

**Colour means one thing.** Red only ever means *act now*. Severity is a single
design token shared by alerts, badges and cards.

**Mobile-first, genuinely.** 44px minimum tap targets, thumb-reachable bottom
navigation, five destinations maximum, land size enterable in acres.

**Every alert carries an action.** "Frost risk" is not useful on its own. "Frost
risk — irrigate the evening before; wet soil holds heat and raises canopy
temperature by 1–2°C" is.

---

## Future scope

- **Voice input**, not just output — once regional-language recognition is
  reliable enough to trust for data entry.
- **Full offline write queue** — currently reads work offline; queuing
  observations logged offline and syncing on reconnect is the natural next step.
- **Real yield calibration** — the prediction model is transparent but
  uncalibrated. Recording actual harvest weights would let it learn per-farm.
- **Soil test integration** — the fertiliser engine already consumes N-P-K
  levels; importing soil health card data directly would remove manual entry.
- **SMS/WhatsApp alerts** for farmers who will not open an app daily.

---

## Documentation

- [`api-documentation.md`](./api-documentation.md) — every endpoint
- [`architecture/architecture-diagram.png`](./architecture/) — system architecture
- [`docs/tech-stack-api-selection.md`](./docs/tech-stack-api-selection.md) — extended evaluation
- [`legacy/README.md`](./legacy/README.md) — superseded implementations

---

## References

Allen, R.G., Pereira, L.S., Raes, D. & Smith, M. (1998). *Crop
evapotranspiration — Guidelines for computing crop water requirements.* FAO
Irrigation and Drainage Paper 56.
