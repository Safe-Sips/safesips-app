---
name: safesips-workflow
description: >-
  SafeSips monorepo playbook — build, run, test, debug, and deploy the
  shared→server→web→mobile workspaces, and guardrails for the location-privacy
  invariant. Use when building/running/testing/debugging/deploying any part of
  this repo (npm run dev/build/test, smoke-test, Docker/Render release, Expo
  mobile) or when editing presence/location/socket/masking code.
---

# SafeSips workflow

TypeScript monorepo. `shared`, `server`, `web` are npm workspaces; `mobile` (Expo) links
`shared` via a `file:` dependency. All commands run from `safesips-app/`.

## Golden rule: build `shared` first

`server`, `web`, and `mobile` resolve `@safesips/shared` from `shared/dist`. After any edit
to `shared/`, rebuild it or dependents will use stale types/logic:

```bash
npm run build:shared
```

`npm run dev` and `npm run build` already do this. If you see "cannot find module
@safesips/shared" or stale behavior, the fix is almost always a missing `build:shared`.

## Run locally

```bash
npm install          # once; installs shared + server + web
npm run dev          # shared build + server (:4000) + web (:5173), concurrently
# or individually:
npm run dev:server   # tsx watch
npm run dev:web      # Vite
```

Health check: `http://localhost:4000/health`. Web client: `http://localhost:5173`.
Mobile: `npm run mobile` — needs a **custom dev build** (MapLibre is native; Expo Go won't
work). First run: `npm run build:shared`, then in `mobile/`: `npm install`,
`npx expo install --fix`, `npx expo prebuild`, `npx expo run:android|ios`. Point a real
device at the LAN IP via `EXPO_PUBLIC_SERVER_URL=http://<lan-ip>:4000`.

## Test

```bash
npm test             # builds shared, then: node --test server/test/*.test.ts
```

Covers mask/badges/votes/check-in logic. When adding server logic or shared rules, add a
`node:test` case in `server/test/`. Fast; run it before proposing a change is done.

## Debug checklist

- **Stale `shared`** → `npm run build:shared` (see golden rule).
- **Socket not connecting / CORS** → `CORS_ORIGINS` in `server/.env` must list the web origin
  (`http://localhost:5173`); `VITE_SERVER_URL` in `web/.env` must point at the server.
- **Auth 500s / sync** → Clerk. Check `@clerk/express`/`@clerk/backend` wiring and Clerk env
  keys; README's legacy JWT description is outdated.
- **Circle disappears** → presence TTL. `PRESENCE_TTL_MS` (default 5 min) + `SWEEP_INTERVAL_MS`;
  "Share for <duration>" overrides the default TTL.
- **Rate limited updates** → `MIN_UPDATE_INTERVAL_MS` (default 2000) per socket.

## Privacy invariant (must hold)

1. Exact GPS stays in local memory. Only the masked center from `maskLocation()`
   (`shared/src/mask.ts`) is emitted via `location:update` — a fresh random offset every update.
2. Never log exact coordinates; never put them in URLs, analytics, or any payload. Server
   validates ranges, rate-limits, stores/broadcasts only the masked center.
3. Safety reports are the deliberate exception: an exact point published with the author's
   name. Keep that path separate from anonymous presence, and keep the UI warning.
4. If presence/sharing behavior changes, update the "Manual verification (multi-user)" steps
   in `README.md` and confirm WS frames carry only masked `lat`/`lng`.

## Review before done

```bash
coderabbit --agent -t uncommitted   # fix critical/high; skip nits unless asked; max 3 runs
```

Parse the `--agent` JSON output. In-session `/code-review` and `/security-review` are also
available. CodeRabbit reads `.cursor/rules/` for extra project context.

## Deploy

- Config: `server/.env.production` (CORS, TTL/rate limits), `web/.env.production`
  (`VITE_SERVER_URL=https://api.safesips.org`).
- Docker: `npm run build && npm run deploy:compose` → web `:8080`, API `:4000`. TLS/WSS nginx
  templates in `deploy/` (`nginx-api.conf`, `nginx-web.conf`).
- Web ships as a **Render static site** (`render.yaml`) at `app.safesips.org`; the API is the
  Render service `safesips-app` (https://safesips-app.onrender.com). Netlify is retired.
- Verify after deploy:
  ```bash
  API_URL=https://api.safesips.org WEB_ORIGIN=https://app.safesips.org npm run smoke-test
  npm run uptime-check
  ```
- CI (`.github/workflows/deploy-check.yml`) runs build + smoke + uptime on every push/PR to `main`.
