# API Documentation

**Smart Farm Decision Support System** — REST API  
**Team:** RICR-HIM-1104 | **Hackathon:** HackInMotion

| Environment | URL |
|---|---|
| Development | `http://localhost:3001/api` |
| Live backend | `http://65.0.45.45:3001/api` |
| Live frontend | `http://65.0.45.45:3000` |

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

All endpoints except `/auth/register`, `/auth/login`, `/auth/google`,
`/auth/refresh`, `/auth/forgot-password` and `/auth/reset-password` require:

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

| Code                     | HTTP | Meaning                                           |
| ------------------------ | ---- | ------------------------------------------------- |
| `VALIDATION_ERROR`       | 400  | Request failed schema validation; see `details`   |
| `AUTHENTICATION_ERROR`   | 401  | Missing, invalid or expired token                 |
| `NOT_FOUND`              | 404  | Resource absent, or not owned by this user        |
| `CONFLICT`               | 409  | Unique constraint (e.g. email already registered) |
| `RATE_LIMIT_EXCEEDED`    | 429  | 300 req / 15 min in production                    |
| `EXTERNAL_SERVICE_ERROR` | 502  | Upstream provider failed and no cache available   |
| `DATABASE_UNAVAILABLE`   | 503  | Database unreachable                              |
| `INTERNAL_SERVER_ERROR`  | 500  | Unexpected; details suppressed in production      |

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

One call creates the account and signs the farmer in.

| Field             | Type   | Rules                                                                                                      |
| ----------------- | ------ | ---------------------------------------------------------------------------------------------------------- |
| `name`            | string | 2–100 characters                                                                                           |
| `email`           | string | Must end `@gmail.com`; lowercased                                                                          |
| `phone`           | string | Indian mobile. `9876543210`, `+91 98765 43210`, `098765-43210` all accepted; normalised to `+919876543210` |
| `password`        | string | Min 8 characters                                                                                           |
| `confirmPassword` | string | Must equal `password` — compared server-side, not trusted from the browser                                 |
| `language`        | string | Optional, defaults `en`                                                                                    |

There is **no `username`**. The Gmail address is the credential: it signs the
farmer in, receives the verification and reset codes, and is what "Continue with
Google" matches on. A `username` sent by an older client is ignored, not
rejected. Accounts created before this change keep the username they chose and
can still sign in with it.

The password is hashed with bcrypt at `BCRYPT_ROUNDS` before it is stored; the
plaintext is never written or logged. Gmail address and mobile number are each
checked for availability before the insert.

**`201`** — the same `{ user, tokens }` shape as login, which is what makes
registration and sign-in one moment: the client stores these tokens and goes
straight to the dashboard.

```json
{
  "success": true,
  "data": {
    "user": {
      "id": "6a7d…",
      "email": "ramesh@gmail.com",
      "username": null,
      "name": "Ramesh Kumar",
      "phone": "+919876543210",
      "role": "FARMER"
    },
    "tokens": { "accessToken": "eyJ…", "refreshToken": "eyJ…", "expiresIn": 604800000 }
  }
}
```

| Response               | Meaning                                                     |
| ---------------------- | ----------------------------------------------------------- |
| `400 VALIDATION_ERROR` | A field failed validation; `details` is keyed by field name |
| `409 CONFLICT`         | `details` names which of `email` / `phone` is taken         |

### `POST /api/auth/login`

Body: `{ "identifier", "password" }`, where `identifier` is a **Gmail address** —
or a username, on an account created before registration stopped asking for one.
The server looks up both. `{ "email", … }` is still accepted as a fallback for
clients written against the previous contract.

Returns the same shape as register. `401` on bad credentials, and the message
does not reveal whether the account exists.

Logging out does not send anyone back to registration: the account and its
password hash outlive the session. A forgotten password is the other way back
in — see the two endpoints below.

### `POST /api/auth/forgot-password`

Body: `{ "email" }`. Emails a six-digit code, valid **15 minutes**.

Unauthenticated, which is the whole design constraint: anyone can call it, so it
answers identically whether or not that address has an account. There is no
`404`, and **no `429`** — a rate-limit reply that only appeared for real accounts
would be an account-existence oracle. A request inside the 60-second cooldown, or
past the 5-per-hour ceiling, quietly sends nothing and returns the same body.

**`200`** — always:

```json
{
  "success": true,
  "data": {
    "resendAfter": 60,
    "message": "If that Gmail address has an account, a reset code is on its way."
  }
}
```

| Response                     | Meaning                                                                                   |
| ---------------------------- | ----------------------------------------------------------------------------------------- |
| `400 VALIDATION_ERROR`       | `email` is not a valid Gmail address — a fact about what was typed, not about any account |
| `502 EXTERNAL_SERVICE_ERROR` | This server has no mailbox configured, or Gmail refused the message                       |

A Google-only account gets a code too, and completing the reset gives it a first
password. Whoever holds the code can already read the inbox Google verifies
against, so this grants nothing new — and it rescues a farmer whose Google
sign-in will not work on the phone in their hand.

### `POST /api/auth/reset-password`

Body: `{ "email", "code", "newPassword", "confirmPassword" }`. The address is
repeated because there is no session to read it from; it is the **code** that
authorises the change. `newPassword` has the same 8-character floor as
registration, and `confirmPassword` is compared server-side.

On success the password is replaced, the account is marked verified (receiving
the code proved the mailbox is readable), the code is spent, and **every session
on the account is revoked** — including any held by whoever knew the old
password. No tokens are returned; the farmer signs in again.

**`200`** — `{ "message": "Password changed. Please sign in with your new password." }`

| Response               | Meaning                                                                                                                                                                                |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `400 VALIDATION_ERROR` | Code wrong, expired, already used, out of attempts, or the address has no account — all one message, keyed to `code`. A wrong guess against a live code also reports the attempts left |

Five wrong guesses kill a code; a new one must be requested. Codes are stored as
bcrypt hashes, never plaintext, and issuing one retires any previous code so only
the newest email ever works.

### `POST /api/auth/google`

Sign in **or** sign up with Google. Body:

```json
{ "idToken": "<ID token from Google Identity Services>", "language": "hi" }
```

`language` is optional and applied only when this call creates the account — it
carries over the language the farmer selected on the sign-in screen.

Returns the register/login shape plus `isNewUser`, with `201` when an account was
created and `200` when an existing one was used:

```json
{ "user": { … }, "tokens": { … }, "isNewUser": false }
```

The ID token is verified server-side against Google's public keys, checking
signature, issuer, expiry and that the audience is _our_ client id. Only the
client id is configured (`GOOGLE_CLIENT_ID`) — there is no client secret in this
system, because the browser obtains the token and we merely verify it.

If the email matches an existing password account and Google reports it verified,
the Google identity is **linked** to that account rather than rejected — the
alternative locks a farmer out of their own farm data. Tokens for unverified
Google emails are refused, which is what makes that linking safe.

| Response                   | Meaning                                                                |
| -------------------------- | ---------------------------------------------------------------------- |
| `400 VALIDATION_ERROR`     | `idToken` missing, or `GOOGLE_CLIENT_ID` not configured on this server |
| `401 AUTHENTICATION_ERROR` | Token invalid, expired, issued to another app, or email unverified     |

Related: an account created this way has no password, so `POST /api/auth/login`
against it returns `401` telling the farmer to use the Google button, and
`POST /api/auth/change-password` returns `400`.

### `POST /api/auth/refresh`

Body: `{ "refreshToken" }` → `{ "tokens": { … } }`. The old refresh token is
invalidated (rotation).

### `POST /api/auth/logout`

Body: `{ "refreshToken" }`. Invalidates that session.

### `GET /api/auth/me` 🔒

Returns `{ "user": { … } }`.

### `PATCH /api/auth/me` 🔒

Body: any of `name`, `phone`, `language`, `avatarUrl`.

`phone` runs through the registration normaliser, so an edited number cannot
collide with another account's by being spelled differently. Changing it returns
`409` if another account already holds that number.

### `POST /api/auth/change-password` 🔒

Body: `{ "currentPassword", "newPassword" }`. Revokes all other sessions.

---

## Farms

All 🔒. Ownership enforced per query.

### `GET /api/farms`

`{ "farms": [ … ] }` — excludes archived farms, includes crops, plots and counts.

### `POST /api/farms`

| Field               | Type            | Rules                                                                    |
| ------------------- | --------------- | ------------------------------------------------------------------------ |
| `name`              | string          | 1–100 chars                                                              |
| `latitude`          | number          | −90 … 90                                                                 |
| `longitude`         | number          | −180 … 180                                                               |
| `totalAreaHectares` | number          | > 0                                                                      |
| `soilTypePrimary`   | enum            | Optional — `SANDY \| LOAMY \| CLAY \| SILTY \| PEATY \| CHALKY \| MIXED` |
| `address`           | string          | Optional                                                                 |
| `boundary`          | GeoJSON Polygon | Optional, display only                                                   |

**`201`** → `{ "farm": { … } }`

### `GET /api/farms/:farmId`

### `PATCH /api/farms/:farmId`

### `DELETE /api/farms/:farmId`

Soft delete — sets status `ARCHIVED`, preserving history.

### `GET /api/farms/location-info`

Query: `latitude`, `longitude`. Resolves a human address and the soil beneath a
point, so onboarding can pre-fill the farm profile from a map tap. Keyless —
Nominatim for the address, SoilGrids for the soil.

```json
{
  "location": {
    "village": "Kakori",
    "district": "Lucknow",
    "state": "Uttar Pradesh",
    "country": "India",
    "formattedAddress": "Kakori, Lucknow, Uttar Pradesh, India"
  },
  "soil": {
    "soilType": "LOAMY",
    "soilProperties": { "clay_0-5cm": 240, "sand_0-5cm": 450, "phh2o_0-5cm": 72 },
    "soilAnalysis": {
      "nitrogen": "medium",
      "ph": 7.2,
      "organicCarbonGKg": 8.4,
      "source": "soilgrids",
      "depthCm": "0-15"
    }
  }
}
```

`soilProperties` holds raw SoilGrids values in **mapped units** (nitrogen cg/kg,
pH×10, clay/sand/silt g/kg). `soilAnalysis` is the same data converted and banded
for the fertiliser engine — see
[Planning](#get-apiplanningfarmidcropscropidfertilizer-) for how it is used, and
why `phosphorus` and `potassium` are absent.

Every field can be `null`; both providers are best-effort and neither blocks farm
creation. `POST /api/farms` performs this lookup server-side too, so a farm
created without `soilAnalysis` still gets one.

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

| Field                 | Type     | Notes                                                                                      |
| --------------------- | -------- | ------------------------------------------------------------------------------------------ |
| `cropName`            | string   | Required                                                                                   |
| `parcelId`            | ObjectId | Optional                                                                                   |
| `plantingDate`        | date     | Optional — enables growth-stage inference                                                  |
| `expectedHarvestDate` | date     | Optional                                                                                   |
| `growthStage`         | enum     | `SEED \| GERMINATION \| VEGETATIVE \| FLOWERING \| FRUIT_SET \| RIPENING \| HARVEST_READY` |
| `status`              | enum     | `PLANNED \| PLANTED \| GROWING \| FLOWERING \| FRUITING \| HARVESTED \| FAILED \| FALLOW`  |

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
    {
      "date": "2026-08-13",
      "tempMaxC": 33.1,
      "tempMinC": 26.4,
      "precipitationMm": 4.3,
      "precipitationProbability": 82,
      "et0Mm": 4.53,
      "humidityMeanPct": 74.2
    }
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
    {
      "date": "2026-08-13",
      "isPast": false,
      "etcMm": 3.5,
      "effectiveRainMm": 3.7,
      "rawRainMm": 4.3,
      "rainProbability": 82,
      "depletionMm": 5.5,
      "stressRatio": 0.1,
      "tempMaxC": 33.1,
      "tempMinC": 26.4
    }
  ],
  "alerts": [
    {
      "type": "HEAT_STRESS",
      "severity": "MEDIUM",
      "title": "High temperatures expected",
      "message": "33°C forecast on Friday, above the 32°C comfort limit for wheat.",
      "action": "Keep soil moisture topped up — well-watered crops tolerate heat far better."
    }
  ],
  "assumptions": ["Growth stage estimated as vegetative from the planting date."],
  "crop": { "id": "6a7d…", "name": "wheat", "label": "Wheat", "isKnown": true }
}
```

**Field notes**

| Field                     | Meaning                                                                       |
| ------------------------- | ----------------------------------------------------------------------------- |
| `urgency`                 | `NONE \| PLAN \| SOON \| TODAY \| OVERDUE`                                    |
| `readilyAvailableWaterMm` | The irrigation trigger. Depletion above this means stress.                    |
| `recommendation.depthMm`  | Millimetres to apply; also given as litres and m³ for the farm's area         |
| `confidence`              | Reduced for each assumption made (unknown soil, unknown crop, inferred stage) |
| `assumptions`             | Human-readable list of everything inferred rather than known                  |

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

| Field             | Type     | Notes                                                              |
| ----------------- | -------- | ------------------------------------------------------------------ |
| `cropId`          | ObjectId | Required                                                           |
| `description`     | string   | Required, 5–2000 chars                                             |
| `observationType` | enum     | `DISEASE \| PEST \| NUTRIENT \| GROWTH \| WEATHER_DAMAGE \| OTHER` |
| `image`           | file     | Optional. JPG/PNG/WebP/HEIC, max 8 MB                              |

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
          "symptomScore": 0.86,
          "weatherScore": 0.75,
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

`method` names which vision provider actually looked at the photo:
`rule-engine` (none did), `rule-engine+gemini-vision`, `rule-engine+ollama-vision`
or `rule-engine+plant-id`.

Providers are tried in order — **Gemini** (free key, primary), then a local
**Ollama** model, then **Plant.id** — and the first to answer wins. A "not a
plant" or "looks healthy" verdict _is_ an answer, so no further provider is
asked. Set `VISION_PREFER_LOCAL=true` to put Ollama first.

With no provider configured the photo is stored but never analysed and
`limitations` says so explicitly:
`"Image analysis was unavailable, so the photo was stored but not analysed."`
The `image` object is then absent. See the root README for setting
`GEMINI_API_KEY`.

When a provider did run, `image` reports what it concluded — `isPlant`,
`looksHealthy`, `quality` (`good` / `acceptable` / `poor`), `observedSymptoms`
and `affectedParts`. `observedSymptoms` are short English symptom phrases read
off the photograph; they are scored against the curated symptom vocabulary
exactly like the farmer's own words, which is what lets a photo _corroborate_ a
candidate rather than override the rest of the evidence.

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

Anonymous outbreak signal for the area around a farm. Query: `radiusKm`
(default **25**, max 200).

Counts **live** reports (`ACTIVE` or `MONITORING`) from the last **14 days**.
Individual farms are never identified — `approxDistanceKm` is rounded to the
nearest 0.5 km and no farm id, name or coordinate is returned.

```json
{
  "outbreaks": [
    {
      "name": "Early Blight",
      "crop": "tomato",
      "count": 3,
      "latest": "2026-08-14T06:12:00.000Z",
      "approxDistanceKm": 2.5,
      "severity": "SEVERE",
      "guidance": ["Inspect leaves daily for water-soaked spots or dark lesions.", "…"],
      "isOutbreak": true,
      "reportedOnYourFarm": false
    }
  ],
  "farmsInArea": 7,
  "radiusKm": 25
}
```

| Field                | Meaning                                                                                                                                                                                                               |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `count`              | Distinct **other** farms reporting this. Never includes the caller's own farm.                                                                                                                                        |
| `farmsInArea`        | Other farms within the radius. Excludes the caller's own.                                                                                                                                                             |
| `isOutbreak`         | `true` once ≥2 other farms report it. `false` is a single nearby report — still returned, because one neighbour is exactly the early warning this endpoint exists to give, but clients must not label it an outbreak. |
| `reportedOnYourFarm` | The caller also has an open report of the same problem.                                                                                                                                                               |
| `severity`           | Worst severity in the cluster: `CRITICAL` > `SEVERE` > `MODERATE` > `MILD`.                                                                                                                                           |

Results are sorted confirmed-outbreaks first, then by farm count, then recency.

**Clustering.** Problem names are canonicalised against the crop's curated
disease and pest vocabulary before grouping, so a vision-model finding of
`Alternaria solani` clusters with a neighbour who typed `early blight`. Without
this, the same outbreak reaching three farms under three spellings counts as
three unrelated single reports. Unrecognised names are preserved verbatim and
still cluster with identical reports.

Engine-detected problems below 30% confidence are excluded; farmer-submitted
community reports always count.

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
  "series": [{ "date": "2026-08-13", "modalPrice": 2120, "minPrice": 1993, "maxPrice": 2247 }],
  "current": { "price": 2120, "date": "2026-08-13", "marketName": "Lucknow" },
  "statistics": {
    "average7Day": 2135,
    "average30Day": 2201,
    "change7DayPercent": -1.4,
    "change30DayPercent": -3.2,
    "high30Day": 2310,
    "low30Day": 2098,
    "volatilityPercent": 3.1
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

| Field               | Meaning                                                                            |
| ------------------- | ---------------------------------------------------------------------------------- |
| `direction`         | `RISING \| FALLING \| STABLE`. Threshold widens in volatile markets.               |
| `advice.signal`     | `SELL \| HOLD \| WATCH`. Compares today against the 30-day range — not a forecast. |
| `volatilityPercent` | Coefficient of variation. High means an unpredictable market.                      |
| `isSeeded`          | **True if the series includes generated baseline data.** Surfaced in the UI.       |

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
    {
      "id": "6a7d…",
      "alertType": "HEAT_STRESS",
      "severity": "MEDIUM",
      "title": "High temperatures expected",
      "message": "…",
      "action": "…",
      "crop": { "id": "…", "cropName": "rice" },
      "isRead": false
    }
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
    "meanTempC": 25.5,
    "meanMinTempC": 22.1,
    "meanMaxTempC": 38.4,
    "totalRainfallMm": 321,
    "frostDays": 0,
    "yearsSampled": 3,
    "windowDays": 120
  },
  "recommendations": [
    {
      "cropKey": "onion",
      "label": "Onion",
      "suitabilityScore": 91,
      "rating": "EXCELLENT",
      "climate": {
        "score": 83,
        "reason": "Average 25.5°C sits comfortably in this crop's 13-32°C range."
      },
      "season": { "score": 100, "reason": "Kharif is a normal sowing season for this crop." },
      "soil": { "score": 100, "reason": "Grows well on loamy soil." },
      "water": {
        "score": 84,
        "reason": "Rainfall of about 321 mm leaves roughly 129 mm to make up by irrigation."
      },
      "market": {
        "score": 81,
        "reason": "Estimated gross income of about ₹5,57,250 per hectare at typical yield."
      },
      "summary": "Strong choice for your farm this season — climate, soil and timing all line up.",
      "cautions": [],
      "agronomy": {
        "growingDays": 130,
        "waterRequirementMm": 450,
        "expectedRainfallMm": 321,
        "irrigationNeedMm": 129,
        "seasons": ["rabi", "kharif"]
      },
      "economics": {
        "currentPrice": 2229,
        "unit": "Rs/quintal",
        "estimatedIncomePerHa": 557250,
        "attainableYieldKgHa": 25000
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
    {
      "product": "Urea",
      "totalKg": 394,
      "bags": 9,
      "bagSizeKg": 45,
      "supplies": "181 kg nitrogen"
    },
    {
      "product": "DAP",
      "totalKg": 326,
      "bags": 7,
      "bagSizeKg": 50,
      "supplies": "150 kg phosphorus + 59 kg nitrogen"
    },
    {
      "product": "MOP (Muriate of Potash)",
      "totalKg": 133,
      "bags": 3,
      "bagSizeKg": 50,
      "supplies": "80 kg potassium"
    }
  ],
  "schedule": [
    {
      "timing": "At transplanting (basal)",
      "stage": "SEED",
      "ureaKg": 197,
      "dapKg": 326,
      "mopKg": 133,
      "passed": true
    },
    {
      "timing": "At active tillering, ~3 weeks after transplanting",
      "stage": "VEGETATIVE",
      "ureaKg": 99,
      "dapKg": 0,
      "mopKg": 0,
      "passed": false
    }
  ],
  "adjustments": [
    "Nitrogen is low in your soil — dose increased by 25%.",
    "Soil nitrogen is estimated from a soil map for your location, not a laboratory test. A soil health card would make this more exact — and often shows you need less than this.",
    "Your soil is acidic (pH 5.2). Phosphorus gets locked up by iron and aluminium, so the dose is raised 20% — but liming with 2-3 quintals of agricultural lime per acre before sowing is the cheaper fix.",
    "Your soil is rich in organic matter, which releases nitrogen as the crop grows — nitrogen reduced 10%."
  ],
  "notes": [
    "Apply nitrogen to a drained field, then re-flood after 24 hours — this cuts losses sharply."
  ],
  "basis": "Based on ICAR package-of-practices recommendations for irrigated conditions, adjusted for your mapped soil chemistry, area and growth stage."
}
```

**Things worth noting in the arithmetic:**

1. DAP supplies phosphorus _and_ 18% nitrogen. That nitrogen is subtracted from
   the urea requirement — in the example above 181 + 59 = 240 kg N exactly.
   Skipping this step over-applies nitrogen by a meaningful margin.
2. Soil nutrient bands scale the dose ±25% per nutrient, and sandy soil adds 10%
   nitrogen for leaching.
3. **pH** does not change what the crop needs, it changes how much of what you
   spread it can reach. Phosphorus is raised 20% below pH 5.5 (iron/aluminium
   fixation) and 15% above pH 8.5 (calcium fixation) — and the farmer is told
   that lime, or banding instead of broadcasting, is cheaper than more DAP.
4. **Organic carbon** ≥15 g/kg cuts nitrogen 10% (humus-rich soil mineralises its
   own), and <5 g/kg raises it 10%.

Every adjustment is reported in `adjustments`.

**Where the soil figures come from.** `Farm.soilAnalysis` is either a
farmer-entered soil health card (`source: 'soil-health-card'`) or bands derived
from a SoilGrids lookup at farm creation (`source: 'soilgrids'`). Which one is
behind a given plan is stated in both `adjustments` and `basis`, because a
laboratory test and a modelled raster do not warrant the same confidence.

SoilGrids models nitrogen, pH and organic carbon but **not** plant-available
phosphorus or potassium, so those bands are only ever present from a real soil
test. They are deliberately left unset rather than guessed — a fabricated band
would scale the DAP and MOP a farmer actually buys by ±25% on the strength of
nothing. A missing band means "apply the standard dose".

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
    {
      "name": "Water",
      "factor": 1,
      "lossPercent": 0,
      "severity": "none",
      "reason": "Soil moisture has been kept in the comfortable range."
    },
    {
      "name": "Crop health",
      "factor": 0.84,
      "lossPercent": 16,
      "severity": "moderate",
      "reason": "2 unresolved issues, worst severity severe."
    }
  ],
  "confidence": 0.64,
  "seasonProgress": 0.46,
  "estimatedIncome": 193393,
  "improvements": [
    "Treating the outstanding crop health issues would recover a meaningful share of this loss."
  ],
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

## Crop photos

`GET /api/crop-health/photo/:filename` — streams an uploaded crop photo.

Authenticated, and additionally checks that the photo belongs to a farm the
caller owns. A photo belonging to someone else returns `404`, the same as one
that does not exist, so the endpoint cannot be used to test whether a given
filename is real. Responses are `Cache-Control: private, max-age=3600`.

There is no public static file route. Photos were previously served by
`GET /uploads/:filename` with no authentication; that mount has been removed.
Because the client reads only the trailing filename, health-log rows written
before the change still resolve.

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
