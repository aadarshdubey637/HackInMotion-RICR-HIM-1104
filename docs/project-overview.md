# Smart Farm DSS — Project Overview

**Team:** RICR-HIM-1104  
**Hackathon:** HackInMotion  
**Project:** Smart Farm Decision Support System

---

## Problem Statement

Small and marginal farmers in India — who operate 86% of all farm holdings — make critical decisions with almost no actionable information. They don't know when to irrigate, which crop will fetch the best price this season, whether the spots on their leaves signal a treatable deficiency or a destructive disease, or how much fertilizer to buy and when to apply it.

The consequences are tangible: 20–30% of yield is lost annually to preventable causes. Farmers over-irrigate because they have no soil moisture model, buy fertilizer they've already applied, and sell at the wrong time because price information is days stale. Advisory services exist but are inaccessible — either behind paywalls, in English, or requiring a smartphone connection that fails in rural areas.

The gap isn't a shortage of data. Weather APIs publish free forecasts. Government mandis report prices daily. Satellite services model soil properties globally. The gap is translation: converting raw data into a decision a farmer can act on in the next 30 minutes, in their own language, on a slow connection or no connection at all.

---

## Solution

Smart Farm DSS is a full-stack web application that pulls together weather forecasts, soil data, market prices, and agronomy knowledge into a single, prioritised action list for each farmer. It answers one question every morning: **what should I do today on my farm, and why?**

Key design constraints that shaped every decision:

- **Works offline.** Poor connectivity is not an edge case — it's the default for many users. All read data is cached locally; writes queue and sync when connectivity returns.
- **Explains itself.** Every recommendation includes the evidence behind it. A farmer who disagrees with the advice needs to understand what assumption to correct.
- **No hidden data requirements.** If a soil type is unknown, the system says so and falls back to conservative defaults. Confidence scores shrink accordingly.
- **Written for farmers, not agronomists.** Every message is written to be shown directly to the user, not interpreted by a specialist first.

---

## Six Challenges — How Each Is Solved

### 1. Crop Recommendation Engine

Recommendations are scored on five weighted dimensions:

| Dimension           | Weight | Data source                                             |
| ------------------- | ------ | ------------------------------------------------------- |
| Climate suitability | 30%    | Open-Meteo archive API (3-year normals, 120-day window) |
| Season fit          | 25%    | Crop knowledge base (kharif / rabi / zaid windows)      |
| Soil compatibility  | 20%    | Farm soil type + optional SoilGrids enrichment          |
| Water requirement   | 15%    | Rainfall forecast vs. crop water demand                 |
| Market potential    | 10%    | Data.gov.in mandi prices — estimated income/hectare     |

Climate and season dominate by design. A crop sown out of its window fails regardless of price. Each dimension returns its numeric score and a one-sentence reason a farmer can read.

---

### 2. Weather-Based Irrigation Advisory

The irrigation module runs a full **FAO-56 soil water balance** model:

1. Fetch 14-day forecast from Open-Meteo (free, no key), including daily ET₀.
2. Calculate crop water demand: `ETc = ET₀ × Kc` (crop coefficient for current growth stage).
3. Track soil depletion: `depletion += ETc − effective_rainfall`.
4. Compare against the Readily Available Water threshold for the soil type.
5. Generate a recommendation with urgency level (`NONE | PLAN | SOON | TODAY | OVERDUE`), exact depth in mm, and volume in m³ for the farm area.

Every assumption (inferred growth stage, default soil, unknown Kc) is listed explicitly. Confidence degrades with each assumption. Weather-based alerts (heat stress, frost risk, high humidity) are raised automatically.

---

### 3. Crop Health Diagnosis

Diagnosis is a **two-stage rule engine with optional AI enrichment:**

- **Stage 1 — Symptom matching:** The farmer describes what they see. A keyword lexicon maps symptoms to disease candidates per crop. Each candidate receives a symptom score.
- **Stage 2 — Weather weighting:** Recent humidity, temperature, and rainfall are compared against each disease's known favouring conditions, adjusting confidence.
- **Optional Stage 3 — Plant.id:** If an image is uploaded and a key is configured, visual results are merged with rule-engine results, boosting matching candidates.

Results are a ranked differential diagnosis — most likely first, ordered by confidence weighted by severity. Severe findings (≥35% confidence, SEVERE+) auto-raise a dashboard alert.

Community reports from nearby farms (50 km radius, last 21 days) are aggregated anonymously and shown in the UI.

---

### 4. Market Price Intelligence

Price data is fetched from **Data.gov.in** and stored as a time series per commodity, market, and date. For each crop the system computes:

- 7-day and 30-day moving averages
- Direction (`RISING | FALLING | STABLE`) with volatility-adjusted thresholds
- Advisory signal (`SELL | HOLD | WATCH`) — explicitly documented as a comparison against the 30-day range, not a forecast

Seeded baseline data is clearly flagged so farmers know when they're seeing generated vs. live prices.

---

### 5. Fertilizer & Resource Planning

Plans are computed from **ICAR (Indian Council of Agricultural Research) package-of-practices** recommendations, adjusted per farm:

1. Baseline NPK requirement from the ICAR knowledge base (kg/hectare per crop).
2. Soil adjustments: low phosphorus → +25% DAP dose; sandy soil → +10% nitrogen for leaching.
3. Product translation: raw NPK to actual commercial fertilizer bags (Urea, DAP, MOP). DAP's nitrogen contribution is correctly subtracted from the urea requirement.
4. Staged schedule across growth stages; past-stage splits are flagged `passed: true`.

---

### 6. Offline-First Support

The offline layer uses browser **localStorage** as both a read cache and a write queue:

- **Read cache:** All API GET responses stored with timestamps. Served immediately on subsequent requests; background refresh if stale.
- **Write queue:** Mutations that fail offline are serialised and queued. A reconnect event triggers automatic replay.
- **Stale-while-revalidate:** UI shows a subtle indicator when data is from cache but does not block guidance display.
- **PWA manifest:** `manifest.json` enables "Add to Home Screen" on Android for a native-feeling app shell.

---

## Technical Architecture

| Layer    | Technology                                                         |
| -------- | ------------------------------------------------------------------ |
| Frontend | Next.js 14 (App Router), React, Tailwind CSS, Recharts             |
| Backend  | Node.js, Express, TypeScript, Prisma ORM                           |
| Database | MongoDB Atlas (replica set, free tier)                             |
| Auth     | JWT — access tokens (7 days) + refresh tokens (30 days)            |
| Voice    | Web Speech API — Hindi, Punjabi, Telugu, Marathi, Bengali, English |

### External APIs (all free / no-key)

| API                       | Purpose                                            |
| ------------------------- | -------------------------------------------------- |
| Open-Meteo                | 14-day forecast + ET₀ + historical climate archive |
| Nominatim (OpenStreetMap) | Reverse geocoding (coordinates → village/district) |
| SoilGrids (ISRIC)         | Soil texture and property lookup                   |
| Data.gov.in               | Mandi commodity prices (optional key)              |
| Plant.id                  | Visual crop disease identification (optional key)  |

---

## Impact

| Without Smart Farm DSS                          | With Smart Farm DSS                                                        |
| ----------------------------------------------- | -------------------------------------------------------------------------- |
| Irrigate by schedule or guess                   | Irrigate when the FAO-56 model says depletion crosses the stress threshold |
| Sell at harvest regardless of price             | See the 30-day trend and hold or sell with context                         |
| Identify disease from a neighbour's description | Get a ranked differential diagnosis with weather context                   |
| Apply fertilizer by habit                       | Get a stage-wise plan with bag counts and soil-adjusted doses              |
| Choose crops based on last year's price         | Score crops on climate, season, soil, water, and current market            |
| No access to advisory while offline             | Full guidance from local cache; writes queue and sync automatically        |

---

## Future Scope

- **SMS/WhatsApp alerts** — thin integration layer over the existing alert system
- **Soil test import** — photograph lab reports to improve fertilizer accuracy
- **Variety-level recommendations** — current system operates at crop level; variety selection is next
- **Satellite imagery** — NDVI from Sentinel-2 (free, 10m) to flag anomalous zones
- **Crop rotation planning** — multi-season recommendations based on soil health and pest pressure
- **Government scheme matching** — match farm profile against PM-KISAN, PMFBY eligibility
