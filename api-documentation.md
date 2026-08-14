# API Documentation

**Smart Farm Decision Support System** — REST API
Team RICR-HIM-1104

Base URL: `http://localhost:3001/api` (development)

---

## Conventions

### Response envelope

Every response uses the same shape, so the client has one parsing path.

**Success**
```json
{ "success": true, "data": { ... } }
```

**Failure**
```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Please check the highlighted fields",
    "details": { "email": "Please enter a valid email address" }
  }
}
```

`error.details` is a `field → message` map on validation failures, so the UI can
render errors inline. Messages are written to be shown directly to a farmer.

### Authentication

All endpoints except `/auth/register`, `/auth/login` and `/auth/refresh` require:

```
Authorization: Bearer <accessToken>
```

Access tokens last 7 days, refresh tokens 30 days. Every query is additionally
scoped by the authenticated user id — requesting another farmer's farm returns
`404`, not `403`, so the API does not leak which ids exist.

### Identifiers

All ids are MongoDB ObjectIds (24 hex characters). A malformed id returns `400`
with a readable message rather than reaching the database.

### Error codes

| Code | HTTP | Meaning |
|---|---|---|
| `VALIDATION_ERROR` | 400 | Request failed schema validation; see `details` |
| `AUTHENTICATION_ERROR` | 401 | Missing, invalid or expired token |
| `NOT_FOUND` | 404 | Resource absent, or not owned by this user |
| `CONFLICT` | 409 | Unique constraint (e.g. email already registered) |
| `RATE_LIMIT_EXCEEDED` | 429 | 300 req / 15 min in production |
| `EXTERNAL_SERVICE_ERROR` | 502 | Upstream provider failed and no cache available |
| `DATABASE_UNAVAILABLE` | 503 | Database unreachable |
| `INTERNAL_SERVER_ERROR` | 500 | Unexpected; details suppressed in production |

---

## Health

### `GET /api/health`

Liveness probe. Returns `503` if the database is unreachable.

```json
{
  "success": true,
  "data": {
    "status": "ok",
    "database": "connected",
    "environment": "development",
    "timestamp": "2026-08-13T11:31:12.811Z"
  }
}
```

---

## Authentication

### `POST /api/auth/register`

| Field | Type | Rules |
|---|---|---|
| `email` | string | Valid email, lowercased |
| `password` | string | Min 8 characters |
| `name` | string | 2–100 characters |
| `phone` | string | Optional, 7–15 digits |
| `language` | string | Optional, defaults `en` |

**`201`**
```json
{
  "success": true,
  "data": {
    "user": { "id": "6a7d…", "email": "farmer@demo.com", "name": "Ramesh Kumar", "role": "FARMER" },
    "tokens": { "accessToken": "eyJ…", "refreshToken": "eyJ…", "expiresIn": 604800000 }
  }
}
```

`409` if the email is already registered.

### `POST /api/auth/login`

Body: `{ "email", "password" }`. Returns the same shape as register.
`401` on bad credentials — the message does not reveal whether the email exists.

### `POST /api/auth/refresh`
Body: `{ "refreshToken" }` → `{ "tokens": { … } }`. The old refresh token is
invalidated (rotation).

### `POST /api/auth/logout`
Body: `{ "refreshToken" }`. Invalidates that session.

### `GET /api/auth/me` 🔒
Returns `{ "user": { … } }`.

### `PATCH /api/auth/me` 🔒
Body: any of `name`, `phone`, `language`, `avatarUrl`.

### `POST /api/auth/change-password` 🔒
Body: `{ "currentPassword", "newPassword" }`. Revokes all other sessions.

---

## Farms

All 🔒. Ownership enforced per query.

### `GET /api/farms`
`{ "farms": [ … ] }` — excludes archived farms, includes crops, plots and counts.

### `POST /api/farms`

| Field | Type | Rules |
|---|---|---|
| `name` | string | 1–100 chars |
| `latitude` | number | −90 … 90 |
| `longitude` | number | −180 … 180 |
| `totalAreaHectares` | number | > 0 |
| `soilTypePrimary` | enum | Optional — `SANDY \| LOAMY \| CLAY \| SILTY \| PEATY \| CHALKY \| MIXED` |
| `address` | string | Optional |
| `boundary` | GeoJSON Polygon | Optional, display only |

**`201`** → `{ "farm": { … } }`

### `GET /api/farms/:farmId`
### `PATCH /api/farms/:farmId`
### `DELETE /api/farms/:farmId`
Soft delete — sets status `ARCHIVED`, preserving history.

### `GET /api/farms/supported-crops`
Crops with full agronomic backing (crop coefficients, disease profiles).

```json
{ "crops": [ { "key": "rice", "label": "Rice (Paddy)" }, … ] }
```

Other crop names are still accepted when creating a crop; guidance falls back to
conservative generic values and is flagged as approximate.

### Plots

- `POST /api/farms/:farmId/parcels`
- `GET /api/farms/:farmId/parcels/:parcelId`
- `PATCH /api/farms/:farmId/parcels/:parcelId`
- `DELETE /api/farms/:farmId/parcels/:parcelId` — detaches crops rather than deleting them

### Crops

#### `POST /api/farms/:farmId/crops`

| Field | Type | Notes |
|---|---|---|
| `cropName` | string | Required |
| `parcelId` | ObjectId | Optional |
| `plantingDate` | date | Optional — enables growth-stage inference |
| `expectedHarvestDate` | date | Optional |
| `growthStage` | enum | `SEED \| GERMINATION \| VEGETATIVE \| FLOWERING \| FRUIT_SET \| RIPENING \| HARVEST_READY` |
| `status` | enum | `PLANNED \| PLANTED \| GROWING \| FLOWERING \| FRUITING \| HARVESTED \| FAILED \| FALLOW` |

Response includes `isRecognised` — whether the crop matched the knowledge base.

- `GET /api/farms/:farmId/crops`
- `GET /api/farms/:farmId/crops/:cropId`
- `PATCH /api/farms/:farmId/crops/:cropId`
- `DELETE /api/farms/:farmId/crops/:cropId`

#### `GET /api/farms/:farmId/crops/:cropId/dashboard`

Query: `includeWeather`, `includeHealth`, `includeMarket`, `includeIrrigation`
(all default `true`). Sections resolve in parallel and fail independently.

---

## Weather & irrigation

### `GET /api/weather/:farmId/forecast` 🔒

Query: `days` (1–14, default 7), `force` (bypass the 1-hour cache).

```json
{
  "location": { "latitude": 26.8467, "longitude": 80.9462, "timezone": "Asia/Kolkata" },
  "current": { "temperatureC": 32.4, "humidityPct": 73, "description": "Overcast" },
  "daily": [
    { "date": "2026-08-13", "tempMaxC": 33.1, "tempMinC": 26.4,
      "precipitationMm": 4.3, "precipitationProbability": 82,
      "et0Mm": 4.53, "humidityMeanPct": 74.2 }
  ],
  "stale": false,
  "provider": "open-meteo"
}
```

If the provider is unreachable, returns the last stored bundle with
`"stale": true` and a `warning` string instead of failing.

### `GET /api/weather/:farmId/irrigation` 🔒

**The core endpoint.** Runs the FAO-56 soil water balance.

Query: `cropId` (optional — defaults to the farm's primary active crop).

```json
{
  "shouldIrrigate": false,
  "urgency": "NONE",
  "headline": "No irrigation needed this week",
  "reason": "Soil moisture is good and roughly 70 mm of rain is expected over the coming week.",
  "recommendation": null,
  "nextIrrigationDate": null,
  "daysUntilIrrigation": null,
  "confidence": 0.9,
  "riskLevel": "LOW",
  "waterBalance": {
    "totalAvailableWaterMm": 100.8,
    "readilyAvailableWaterMm": 55.4,
    "currentDepletionMm": 5.5,
    "depletionPercent": 10,
    "rootDepthM": 0.72,
    "cropCoefficient": 0.77,
    "soilType": "LOAMY",
    "initialisedFrom": "soil-moisture-model"
  },
  "forecast": [
    { "date": "2026-08-13", "isPast": false, "etcMm": 3.5, "effectiveRainMm": 3.7,
      "rawRainMm": 4.3, "rainProbability": 82, "depletionMm": 5.5,
      "stressRatio": 0.1, "tempMaxC": 33.1, "tempMinC": 26.4 }
  ],
  "alerts": [
    { "type": "HEAT_STRESS", "severity": "MEDIUM", "title": "High temperatures expected",
      "message": "33°C forecast on Friday, above the 32°C comfort limit for wheat.",
      "action": "Keep soil moisture topped up — well-watered crops tolerate heat far better." }
  ],
  "assumptions": ["Growth stage estimated as vegetative from the planting date."],
  "crop": { "id": "6a7d…", "name": "wheat", "label": "Wheat", "isKnown": true }
}
```

**Field notes**

| Field | Meaning |
|---|---|
| `urgency` | `NONE \| PLAN \| SOON \| TODAY \| OVERDUE` |
| `readilyAvailableWaterMm` | The irrigation trigger. Depletion above this means stress. |
| `recommendation.depthMm` | Millimetres to apply; also given as litres and m³ for the farm's area |
| `confidence` | Reduced for each assumption made (unknown soil, unknown crop, inferred stage) |
| `assumptions` | Human-readable list of everything inferred rather than known |

`alerts` are also persisted to the alert feed, deduplicated per farm/type/day.

### `POST /api/weather/:farmId/irrigation-log` 🔒

Body: `{ "cropId", "waterAmountMm", "irrigationMethod", "irrigatedAt?" }`

`irrigationMethod`: `DRIP | SPRINKLER | FLOOD | FURROW | SUBSURFACE | MANUAL | RAINFED`

Recording irrigation feeds back into the water balance and dismisses any open
"irrigate now" alert.

### `GET /api/weather/:farmId/irrigation-log` 🔒
### `PATCH /api/weather/alerts/:alertId/read` 🔒
### `PATCH /api/weather/alerts/:alertId/dismiss` 🔒

---

## Crop health

### `POST /api/crop-health/:farmId/observations` 🔒

**`multipart/form-data`**

| Field | Type | Notes |
|---|---|---|
| `cropId` | ObjectId | Required |
| `description` | string | Required, 5–2000 chars |
| `observationType` | enum | `DISEASE \| PEST \| NUTRIENT \| GROWTH \| WEATHER_DAMAGE \| OTHER` |
| `image` | file | Optional. JPG/PNG/WebP/HEIC, max 8 MB |

**`201`**
```json
{
  "log": { "id": "6a7d…", "severity": "SEVERE", "diseaseDetected": "Rice Blast", "imageUrl": "…" },
  "diagnosis": {
    "summary": "Most likely rice blast.",
    "severity": "SEVERE",
    "confidence": 0.74,
    "method": "rule-engine",
    "candidates": [
      {
        "kind": "disease",
        "name": "Rice Blast",
        "confidence": 0.74,
        "severity": "SEVERE",
        "evidence": [
          "You described: diamond, grey centre, brown border.",
          "Recent weather favours it — humidity has averaged 87%, and 3 days of leaf wetness."
        ],
        "actions": ["Look for diamond/spindle-shaped lesions with grey centres…"],
        "explanation": "High humidity with moderate temperatures and prolonged leaf wetness is the classic blast trigger.",
        "signals": {
          "symptomScore": 0.86, "weatherScore": 0.75,
          "matchedKeywords": ["diamond", "grey centre", "brown border"],
          "weatherFavourable": true
        }
      }
    ],
    "nextSteps": ["…"],
    "limitations": [
      "No photo was provided, so this is based on your description alone.",
      "This is guidance to help you check the right things — not a confirmed diagnosis."
    ]
  },
  "imageStored": true
}
```

`candidates` is a **ranked differential**, most likely first, ordered by
confidence weighted by severity — a possible CRITICAL outranks a marginally more
confident MILD, because missing late blight costs more than a false alarm.

`method` is `rule-engine` or `rule-engine+plant-id`.

An empty `candidates` array is a valid, honest result: the description did not
match anything for that crop. `nextSteps` then explains what detail would help.

Findings of `SEVERE` or above with ≥35% confidence also raise a dashboard alert.

### `GET /api/crop-health/:farmId/observations` 🔒
Query: `cropId`, `status`, `limit` (default 20).

### `GET /api/crop-health/:farmId/observations/:logId` 🔒
### `PATCH /api/crop-health/:farmId/observations/:logId` 🔒
Body: `{ "status": "ACTIVE" | "MONITORING" | "TREATED" | "RESOLVED" }`.
Resolving clears the associated alert.

### `DELETE /api/crop-health/:farmId/observations/:logId` 🔒

### `GET /api/crop-health/:farmId/nearby` 🔒

Anonymous aggregate of severe problems reported by farms within `radiusKm`
(default 50, max 200) in the last 21 days. Individual farms are never identified.

```json
{ "reports": [ { "name": "Rice Blast", "crop": "rice", "count": 3 } ],
  "farmsInArea": 7, "radiusKm": 50 }
```

---

## Market prices

### `GET /api/market/farm/:farmId` 🔒
Price trends for every crop on the farm. Triggers a background refresh from
data.gov.in when a key is configured; never blocks the read.

### `GET /api/market/commodity/:commodity` 🔒
Query: `days` (7–180, default 60).

```json
{
  "commodity": "Rice",
  "unit": "Rs/quintal",
  "series": [ { "date": "2026-08-13", "modalPrice": 2120, "minPrice": 1993, "maxPrice": 2247 } ],
  "current": { "price": 2120, "date": "2026-08-13", "marketName": "Lucknow" },
  "statistics": {
    "average7Day": 2135, "average30Day": 2201,
    "change7DayPercent": -1.4, "change30DayPercent": -3.2,
    "high30Day": 2310, "low30Day": 2098, "volatilityPercent": 3.1
  },
  "direction": "FALLING",
  "advice": {
    "signal": "HOLD",
    "headline": "Prices are low right now",
    "reasoning": "At ₹2120, this is near the 30-day low of ₹2098. If your crop stores well…"
  },
  "isSeeded": true,
  "dataPoints": 60,
  "markets": ["Lucknow", "Kanpur"]
}
```

| Field | Meaning |
|---|---|
| `direction` | `RISING \| FALLING \| STABLE`. Threshold widens in volatile markets. |
| `advice.signal` | `SELL \| HOLD \| WATCH`. Compares today against the 30-day range — not a forecast. |
| `volatilityPercent` | Coefficient of variation. High means an unpredictable market. |
| `isSeeded` | **True if the series includes generated baseline data.** Surfaced in the UI. |

### `POST /api/market/sync/:commodity` 🔒
Pulls the latest mandi snapshot on demand. Returns `{ "ingested": n }`; `0` means
no key, no new data, or an upstream failure — all non-fatal.

---

## Alerts

### `GET /api/alerts/:farmId` 🔒
Query: `unreadOnly`, `severity`, `limit` (default 50).
Sorted by severity, then recency.

```json
{
  "alerts": [
    { "id": "6a7d…", "alertType": "HEAT_STRESS", "severity": "MEDIUM",
      "title": "High temperatures expected", "message": "…", "action": "…",
      "crop": { "id": "…", "cropName": "rice" }, "isRead": false }
  ],
  "counts": { "total": 3, "unread": 2, "critical": 0, "high": 1 }
}
```

### `POST /api/alerts/:farmId/read-all` 🔒
### `PATCH /api/alerts/item/:alertId/read` 🔒
### `PATCH /api/alerts/item/:alertId/dismiss` 🔒

---

## Dashboard

### `GET /api/dashboard/:farmId` 🔒

The unified view. Aggregates every subsystem into one ranked action list.

```json
{
  "farm": { "id": "…", "name": "Kumar Farm", "totalAreaHectares": 3.2, "season": "kharif" },
  "actions": [
    {
      "id": "irrigation",
      "priority": "HIGH",
      "category": "IRRIGATION",
      "title": "Irrigate today — about 28 mm",
      "detail": "The soil has dried to 28 mm below field capacity…",
      "action": "Apply about 28 mm (896 m³ across 3.2 ha).",
      "cropName": "rice"
    }
  ],
  "crops": [ { "id": "…", "cropName": "rice", "isRecognised": true, "daysToHarvest": 65 } ],
  "weather": { "available": true, "today": { … }, "upcoming": [ … ] },
  "irrigation": { "available": true, "shouldIrrigate": true, "depletionPercent": 112 },
  "health": { "activeIssues": 1, "recent": [ … ] },
  "market": { "available": true, "trends": [ … ] },
  "alerts": { "unread": 2, "items": [ … ] },
  "generatedAt": "2026-08-13T11:31:12.811Z"
}
```

**`actions` is the point of the whole application.** Irrigation needs, weather
risks, health flags, price opportunities and profile gaps are scored on one
scale — `CRITICAL | HIGH | MEDIUM | LOW | INFO` — and sorted together, so the
farmer sees a single prioritised list rather than five separate widgets.

Sections are resolved with `Promise.allSettled`. Any that fails reports
`available: false` with a `warning`; the rest of the dashboard still renders.

---

## Crop recommendations

### `GET /api/recommendations/:farmId` 🔒

Which crops suit this farm, this season. Scored on five weighted dimensions
using **historical climate normals** for the farm's coordinates — a 3-year
average of the coming 120-day window from Open-Meteo's archive API, not a
short-range forecast.

```json
{
  "farm": { "id": "…", "soilType": "LOAMY", "areaHectares": 3.2 },
  "season": "kharif",
  "climate": {
    "meanTempC": 25.5, "meanMinTempC": 22.1, "meanMaxTempC": 38.4,
    "totalRainfallMm": 321, "frostDays": 0,
    "yearsSampled": 3, "windowDays": 120
  },
  "recommendations": [
    {
      "cropKey": "onion",
      "label": "Onion",
      "suitabilityScore": 91,
      "rating": "EXCELLENT",
      "climate": { "score": 83, "reason": "Average 25.5°C sits comfortably in this crop's 13-32°C range." },
      "season":  { "score": 100, "reason": "Kharif is a normal sowing season for this crop." },
      "soil":    { "score": 100, "reason": "Grows well on loamy soil." },
      "water":   { "score": 84, "reason": "Rainfall of about 321 mm leaves roughly 129 mm to make up by irrigation." },
      "market":  { "score": 81, "reason": "Estimated gross income of about ₹5,57,250 per hectare at typical yield." },
      "summary": "Strong choice for your farm this season — climate, soil and timing all line up.",
      "cautions": [],
      "agronomy": {
        "growingDays": 130, "waterRequirementMm": 450,
        "expectedRainfallMm": 321, "irrigationNeedMm": 129,
        "seasons": ["rabi", "kharif"]
      },
      "economics": {
        "currentPrice": 2229, "unit": "Rs/quintal",
        "estimatedIncomePerHa": 557250, "attainableYieldKgHa": 25000
      }
    }
  ],
  "generatedAt": "2026-08-13T13:20:00.000Z"
}
```

**Weighting:** climate 30%, season 25%, soil 20%, water 15%, market 10%.
Season and climate dominate deliberately — a crop sown out of season fails
regardless of price, and chasing a high price into an unsuitable window is
exactly the decision this app exists to prevent.

Crops the farmer is **already growing** are always included in the response even
if they fall outside the top N, so the current crop can be compared against the
alternatives.

`climate` is `null` and a `warning` is set if the archive lookup fails; scores
then fall back to season and soil only.

### `GET /api/recommendations/:farmId/history` 🔒
Previously generated recommendations, so the farmer can see how advice has
changed across seasons.

---

## Planning — fertiliser and yield

### `GET /api/planning/:farmId` 🔒
Fertiliser plan and yield prediction for every active crop. Each crop resolves
independently; a failure on one does not lose the others.

### `GET /api/planning/:farmId/crops/:cropId/fertilizer` 🔒

```json
{
  "crop": { "key": "rice", "label": "Rice (Paddy)", "isKnown": true },
  "areaHectares": 2,
  "requirement": { "nitrogenKg": 240, "phosphorusKg": 150, "potassiumKg": 80 },
  "products": [
    { "product": "Urea", "totalKg": 394, "bags": 9, "bagSizeKg": 45, "supplies": "181 kg nitrogen" },
    { "product": "DAP",  "totalKg": 326, "bags": 7, "bagSizeKg": 50, "supplies": "150 kg phosphorus + 59 kg nitrogen" },
    { "product": "MOP (Muriate of Potash)", "totalKg": 133, "bags": 3, "bagSizeKg": 50, "supplies": "80 kg potassium" }
  ],
  "schedule": [
    { "timing": "At transplanting (basal)", "stage": "SEED",
      "ureaKg": 197, "dapKg": 326, "mopKg": 133, "passed": true },
    { "timing": "At active tillering, ~3 weeks after transplanting", "stage": "VEGETATIVE",
      "ureaKg": 99, "dapKg": 0, "mopKg": 0, "passed": false }
  ],
  "adjustments": ["Phosphorus is low in your soil — dose increased by 25%."],
  "notes": ["Apply nitrogen to a drained field, then re-flood after 24 hours — this cuts losses sharply."],
  "basis": "Based on ICAR package-of-practices recommendations…"
}
```

**Two things worth noting in the arithmetic:**

1. DAP supplies phosphorus *and* 18% nitrogen. That nitrogen is subtracted from
   the urea requirement — in the example above 181 + 59 = 240 kg N exactly.
   Skipping this step over-applies nitrogen by a meaningful margin.
2. Soil test values scale the dose ±25% per nutrient, and sandy soil adds 10%
   nitrogen for leaching. Every adjustment is reported in `adjustments`.

Splits whose growth stage has already passed are flagged `passed: true`, so the
farmer sees what is still owed rather than the whole season's plan.

### `GET /api/planning/:farmId/crops/:cropId/yield` 🔒

```json
{
  "crop": { "key": "rice", "label": "Rice (Paddy)", "isKnown": true },
  "attainableKgHa": 5500,
  "predictedKgHa": 4620,
  "predictedTotalKg": 9240,
  "rangeTotalKg": { "low": 6854, "high": 10910 },
  "unit": "kg",
  "factors": [
    { "name": "Water", "factor": 1, "lossPercent": 0, "severity": "none",
      "reason": "Soil moisture has been kept in the comfortable range." },
    { "name": "Crop health", "factor": 0.84, "lossPercent": 16, "severity": "moderate",
      "reason": "2 unresolved issues, worst severity severe." }
  ],
  "confidence": 0.64,
  "seasonProgress": 0.46,
  "estimatedIncome": 193393,
  "improvements": ["Treating the outstanding crop health issues would recover a meaningful share of this loss."],
  "limitations": ["This is a data-driven estimate, not a guarantee…"]
}
```

The model is `attainable × water × heat × health × management`. Every factor is
in [0,1], derived from data actually held, and returned with its reason — a
farmer can see exactly why the estimate moved and disagree with any single
input. Uncertainty (`rangeTotalKg`) narrows as `seasonProgress` rises.

---

## Rate limiting

300 requests / 15 minutes per IP in production (2000 in development), applied to
`/api/*`. Exceeding it returns `429` with `RATE_LIMIT_EXCEEDED`.

---

## Static files

`GET /uploads/:filename` — uploaded crop photos, cached 7 days.

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