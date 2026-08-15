# Smart Farm DSS — Frontend

Next.js 14 (App Router) + React 18 + Tailwind CSS 3.

> This file previously contained the default **Vite + React** template text, which
> described a build tool this project does not use. See the
> [root README](../README.md) for the project overview, team, theme and full
> installation guide.

## Running

From the repository root (npm workspaces):

```bash
npm run dev:frontend      # → http://localhost:3000
npm run build:frontend
```

Or from this directory:

```bash
npm run dev
npm run build
npm start
```

The backend must be running on `:3001` for anything to load — see the
[root README](../README.md#installation-guide).

## Environment

Copy `.env.local.example` to `.env.local` (done automatically by
`npm run setup` at the root).

| Variable                       | Default                     | Notes                                                                                            |
| ------------------------------ | --------------------------- | ------------------------------------------------------------------------------------------------ |
| `NEXT_PUBLIC_API_URL`          | `http://localhost:3001/api` | Backend base URL                                                                                 |
| `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | —                           | Same value as the backend's `GOOGLE_CLIENT_ID`. Public by design; unset hides the Google button. |

Anything prefixed `NEXT_PUBLIC_` is embedded in the browser bundle — never put a
secret behind that prefix.

## Structure

```
src/
├── app/                 Routes (App Router). Each page is a client component
│   │                    wrapped in <AppShell>.
│   ├── dashboard/       Home screen — "what do I need to act on today?"
│   ├── weather/         Forecast + FAO-56 irrigation guidance
│   ├── health/          Crop photo upload and diagnosis
│   ├── community/       Pest/disease outbreak alerts + report submission
│   ├── crops/           Farm profile and crop management
│   ├── market/          Mandi price trends
│   ├── planning/        Fertiliser plan and yield prediction
│   ├── recommendations/ Ranked crop suitability
│   └── login/ register/ verify-email/ forgot-password/ onboarding/
├── components/
│   ├── app-shell.tsx    Nav, farm switcher, auth gate
│   ├── ui.tsx           Card, Badge, Notice, ErrorState, severity styling
│   ├── voice-assistant.tsx
│   └── crop-photo.tsx   Fetches private photos as blob URLs (they need a token)
└── lib/
    ├── api.ts           Typed client. Every GET is cache-backed.
    ├── auth-context.tsx Session, farms, active-farm selection
    ├── language-context.tsx  t() / tCrop() / tStage() / tNarrative()
    ├── translations.ts  Six languages
    ├── offline.ts       localStorage cache + mutation write queue
    ├── voice.ts         Web Speech API wrapper
    └── types.ts         Mirrors the backend API contract
```

## Conventions worth knowing

**No invented numbers.** Every figure is a real reading or a visible blank
(`—`). A plausible wrong number is worse for a farmer than an obvious gap, so
cards render nothing rather than a placeholder, and charts plot real series or
draw nothing at all.

**Offline-first.** `lib/api.ts` routes GETs through a cache: network first, then
`localStorage` on a network error, with the cached copy's age surfaced in the UI.
Key mutations queue and replay on reconnect. FormData uploads (photos) are not
queued — they need a real connection.

**The dashboard refreshes itself** every 5 minutes, plus on tab focus and on
`online`. Polling pauses while the tab is hidden. A failed background poll keeps
what is on screen rather than downgrading to the cache, since the rendered data
came from a successful fetch and is newer.

**Private photos.** Crop images require a bearer token, so a plain `<img src>`
cannot load them. `crop-photo.tsx` fetches the bytes and hands the browser a
`blob:` URL — callers must revoke it on unmount.

**Translations.** Use `t('path.key')`; missing keys fall back to English, then to
the key path itself. `tNarrative()` translates whole backend-generated sentences
via a template map.

## Checks

```bash
npx tsc --noEmit      # types
npx eslint src/       # lint
npx prettier --write src/
```

Or `npm run verify` from the repository root for all workspaces.
