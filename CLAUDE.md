# SafeSips — agent guide

Real-time, privacy-preserving location-sharing app. Users share an **approximate**
location (a masked 200 m circle); the **exact** position never leaves the device.

## Monorepo layout (npm workspaces: `shared`, `server`, `web`; `mobile` is separate)

| Package | Name | Stack |
|---|---|---|
| `shared/` | `@safesips/shared` | Mask logic, wire types, zod validation, badges. **CommonJS**, consumed everywhere. |
| `server/` | `@safesips/server` | Express + Socket.io presence backend. **ESM**, `better-sqlite3`, Clerk auth. |
| `web/` | `@safesips/web` | React 18 + Vite + Leaflet/react-leaflet + react-router + Clerk. |
| `mobile/` | `@safesips/mobile` | Expo SDK 52 / RN 0.76 + MapLibre + Clerk. Links `shared` via `file:` (not a workspace). |

**Build order matters:** `shared` must be compiled before server/web/mobile can resolve
it (`tsc` + Metro read `shared/dist`). `npm run dev` and `npm run build` do this for you;
after editing `shared`, rebuild it (`npm run build:shared`).

## Commands (run from `safesips-app/`)

```bash
npm install            # shared + server + web workspaces
npm run dev            # build shared, then run server (:4000) + web (:5173) together
npm run dev:server     # server only (tsx watch)
npm run dev:web        # web only (Vite)
npm run build          # shared + server + web
npm run start:server   # node dist/index.js (needs NODE_ENV=production + server/.env.production)
npm test               # builds shared, then: node --test server/test/*.test.ts
npm run smoke-test     # hits a running server (API_URL / WEB_ORIGIN env override the target)
npm run uptime-check
npm run mobile         # expo start --dev-client (mobile needs a custom dev build, not Expo Go)
```

Node **>= 18.18**. CI (`.github/workflows/deploy-check.yml`) runs on Node 20 from
`safesips-app/`: `npm ci` → `npm run build` → start server → smoke + uptime check.

## Privacy invariant — do not break

- Exact coordinates stay in **local device memory only**. Only the masked center
  `{ lat, lng }` (`maskLocation()` in `shared/src/mask.ts`) is emitted via `location:update`.
- A **new** random offset is generated on every update. Never log exact coords, and never
  put them in URLs, analytics, or any payload.
- **Exception:** a *safety report* is an intentional public publish of an exact point tied
  to a display name — distinct from presence, and the UI warns about it. Keep them separate.
- When touching anything under presence/location/sockets, preserve this and update the
  "Manual verification (multi-user)" steps in `README.md` if behavior changes.

## Conventions

- **Auth is Clerk** (`@clerk/react`, `@clerk/express`/`@clerk/backend`, `@clerk/expo`). Parts of
  `README.md` still describe the older email+password/JWT scheme — trust the code and Clerk here.
- **Env files** are per-workspace: `server/.env`, `web/.env`, `mobile/.env` (see each `.env.example`;
  `server/.env.production`, `web/.env.production` for prod). `JWT_SECRET` required in prod.
- **Code review:** this repo uses the CodeRabbit CLI — `coderabbit --agent -t uncommitted`,
  fix critical/high, skip nits unless asked, max 3 runs on the same diff. It also reads
  `.cursor/rules/`. In-session `/code-review` and `/security-review` are also available.
- Deploy: `npm run deploy:compose` (Docker; web :8080, api :4000, nginx templates in `deploy/`).
  Web also ships via **Netlify**; API + WS target `api.safesips.org`, web `app.safesips.org`.

For the full build/test/debug/deploy playbook, see the `safesips-workflow` skill in `.claude/skills/`.
