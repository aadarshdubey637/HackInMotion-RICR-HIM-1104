# Security

Smart Farm Decision Support System — Team RICR-HIM-1104

This document records the security controls in the application and the triage of
every outstanding `npm audit` advisory. Last reviewed **15 August 2026** against
`next@14.2.35`.

---

## Reporting a vulnerability

Open a private issue on the repository, or contact the team directly. Please do
not open a public issue for an unpatched flaw.

---

## Controls

### Authentication and session handling

| Control               | Implementation                                                                 |
| --------------------- | ------------------------------------------------------------------------------ |
| Password storage      | bcrypt at `BCRYPT_ROUNDS` (default 10); plaintext never written or logged      |
| Tokens                | JWT — access 7 days, refresh 30 days                                           |
| Signing secret        | `backend/src/config/index.ts` — minimum 32 characters, enforced at boot        |
| Placeholder rejection | Known `.env.example` placeholders are rejected **by name**, not just by length |

The placeholder check exists because `npm run setup` copies `.env.example` into
`backend/.env`. A placeholder long enough to pass `min(32)` would otherwise sail
through, leaving a server signing tokens with a string published in this
repository. The server refuses to boot instead of failing silently.

### Authorisation

Every query is scoped by the authenticated user id. Requesting another farmer's
resource returns **`404`, not `403`** — a distinguishable "forbidden" would
confirm to a stranger which ids exist.

### Private crop photos

Uploaded photos are a farmer's private record. They are **not** served
statically. Every request passes through `GET /api/crop-health/photo/:filename`
(`backend/src/modules/crop-health/photo.ts`), which applies four checks:

1. Bearer token required — the crop-health router authenticates first
2. Filename must match `^[0-9]+-[a-f0-9]{12}\.(jpg|png|webp|heic)$`
3. Resolved path is re-checked against `UPLOAD_ROOT`, so a crafted name cannot
   traverse out of the upload directory even if the regex is loosened later
4. The database row must link the photo to a farm the requesting user owns

Uploads are capped at 8 MB, one file per request, restricted to an explicit MIME
allowlist (`backend/src/common/upload.ts`).

### Transport and HTTP hardening

| Control                 | Value                                                                                                          |
| ----------------------- | -------------------------------------------------------------------------------------------------------------- |
| Content-Security-Policy | `default-src 'none'`; `img-src 'self' data:`; `frame-ancestors 'none'`                                         |
| CORS                    | Allowlist — `FRONTEND_URL` plus localhost only                                                                 |
| Rate limiting           | 300 requests / 15 min in production (`trust proxy` set for real client IP)                                     |
| Request body limit      | 2 MB JSON and urlencoded                                                                                       |
| Frontend headers        | `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin` |

The API returns JSON and image bytes, never executable HTML, so the CSP can be
close to "nothing is allowed". It is set rather than omitted so that any HTML
which _does_ get served — an error page from a dependency, a future admin view —
does not inherit the browser's permissive default.

### Image optimizer

`frontend/next.config.js` defines **no `remotePatterns`**. The Next.js image
optimizer will only serve files from this app's own `public/` directory.

A previous configuration allowed `https://**` — every host on the internet —
which turns the optimizer into an open proxy: anyone could pass a third-party URL
through it and have this deployment fetch, resize and cache the result on our
bandwidth and from our IP. Nothing in the app needs it. Crop photos are fetched
as authenticated blobs via `frontend/src/components/crop-photo.tsx`, and every
`next/image` points at a local file.

### Password reset

`backend/src/modules/auth/password-reset.ts`:

- Six-digit codes stored as **bcrypt hashes**, never plaintext
- 15-minute expiry, enforced attempt cap, single-use via `consumedAt`
- All sessions revoked on successful reset
- **Uniform response** whether or not the address has an account. There is no
  `404` and deliberately **no `429`** — a rate-limit reply that appeared only for
  real accounts would be an account-existence oracle. Requests inside the
  60-second cooldown or past the 5-per-hour ceiling silently send nothing and
  return the same body.

### Secrets

No secrets are tracked in this repository. `.env.example`, `backend/.env.example`
and `docker/.env.example` contain only the placeholder
`REPLACE_WITH_A_RANDOM_STRING_OF_AT_LEAST_32_CHARACTERS`, which the server
actively rejects. `docker/docker-compose.yml` carries no default credentials.

Generate a real secret with:

```
openssl rand -base64 48
```

---

## Dependency advisories

`npm audit` reports **5 high, 0 critical** as of the date above. Each has been
triaged and none is reachable in this application.

### Resolved

Upgrading `next` 14.2.18 → 14.2.35 (commit `ddfce33`) cleared:

| Advisory                                                         | Severity     | Fixed in |
| ---------------------------------------------------------------- | ------------ | -------- |
| GHSA-f82v-jwr5-mffw — Authorization Bypass in Next.js Middleware | **critical** | 14.2.25  |
| GHSA-q4gf-8mx6-v5v3 — DoS with Server Components                 | high         | 14.2.34  |
| GHSA-8h8q-6873-q5fj — DoS with Server Components, follow-up      | high         | 14.2.35  |

### Outstanding, with justification

`npm audit fix --force` would install `next@16.3.1` — a two-major-version jump.
It is not applied because the remaining advisories require features this
application does not use, and the upgrade risk outweighs a theoretical exposure
of zero.

| Root cause                                     | Why it is not reachable                                                                                                                                                        |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `next` — Server Actions advisories (DoS, SSRF) | The codebase contains no `'use server'` directive. Server Actions are never invoked.                                                                                           |
| `next` — Middleware / Proxy bypass             | There is no `middleware.ts` anywhere in the repository. The critical bypass works by sending a header that skips middleware; there is no middleware to skip.                   |
| `next` — Pages Router i18n bypass              | This is an App Router application with no `i18n` configuration. Translation is handled in application code (`frontend/src/lib/language-context.tsx`).                          |
| `next` — SSRF in `rewrites`                    | `frontend/next.config.js` defines no `rewrites`.                                                                                                                               |
| `next` — Image Optimizer advisories            | Mitigated by removing `remotePatterns`. The optimizer serves only local `public/` files and cannot be pointed at an attacker-controlled host.                                  |
| `postcss@8.4.31` (nested)                      | This is Next.js's internal pinned copy, not a direct dependency. The project's own `postcss` is `8.5.26`, which is patched. Build-time only; requires attacker-controlled CSS. |
| `glob` via `eslint-config-next`                | The advisory is command injection in the **glob CLI's `-c`/`--cmd` flag**. It is a devDependency, is never shipped, and no script in this project invokes that CLI.            |

All remaining `next` advisories are fixed only in 15.5.16+ / 15.5.21+. No 14.x
patch exists for them.

### Re-triage trigger

This assessment must be revisited if the application ever adds any of:

- a `middleware.ts` file
- Server Actions (`'use server'`)
- `rewrites` or `i18n` in `next.config.js`
- `remotePatterns` in the image configuration
- a custom server

---

## Verification

```
npm run verify     # prettier --check, eslint --max-warnings 0, tsc + next build
npm audit          # dependency advisories
```
