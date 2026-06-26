# SafeSips · Real-Time Privacy Map

A real-time web and native-mobile app that lets users share an **approximate**
location while keeping their **exact** position private.

- The exact GPS position is shown as a blue dot **only on the user's own
  device** and is **never transmitted**.
- A randomized point within **50 m** of the real location is computed locally
  and used as the center of a **200 m** yellow, semi-transparent privacy circle
  with an animated radar/pulse border.
- Only that masked center is broadcast in real time to all connected users.

## Monorepo layout

```
safesips-app/
  shared/   @safesips/shared  - mask logic, wire types, payload validation (used everywhere)
  server/   @safesips/server  - Express + Socket.io real-time presence backend
  web/      @safesips/web      - React + Vite + Leaflet web client (responsive, PWA)
  mobile/   @safesips/mobile   - Expo + React Native + MapLibre native app
```

`shared`, `server`, and `web` are npm workspaces. `mobile` (Expo) is a separate
project that links `shared` via a `file:` dependency to avoid Expo/Metro
hoisting issues.

## Accounts & community features

Beyond the anonymous live map, SafeSips now has account-based features backed by
**SQLite** (`better-sqlite3`):

- **Accounts** — email + password (bcrypt), JWT sessions, email verification.
  Anti-bot: email verification + auth rate-limiting + a pluggable **Cloudflare
  Turnstile** hook (enabled only when `TURNSTILE_SECRET` is set).
- **Profile** — Reddit-style activity history and engagement **badges**
  (bronze/silver/gold = level 1/2/3), computed from activity in
  [`shared/src/badges.ts`](shared/src/badges.ts).
- **Safety reports** — users mark a place safe/unsafe and **upvote** reports
  (one vote per user). Unlike the masked presence circle, a report is an
  **intentional public publish of an exact point** tied to the author's display
  name — the UI warns about this explicitly.
- **Safe havens** — marking a place unsafe surfaces nearby help (police,
  hospital, fire station, fuel, pharmacy, 24/7 spots) via an Overpass proxy.
- **Check-ins & SOS** — schedule recurring check-ins with a security question; a
  server-side scheduler escalates to your primary SOS contact if you miss one
  (works even if the app is closed). Notifier is a stub today (logs), pluggable
  to SMS/email later.
- **Community forum**, **first-aid info** (spiking), and a **waitlist**.

Privacy invariant is preserved: exact presence coordinates never leave the
device, the socket handshake is authenticated, and the broadcast presence
`publicId` is never linked to an account.

Key extra server env (see [server/.env.example](server/.env.example)):
`JWT_SECRET` (required in production), `DATABASE_PATH`, `TURNSTILE_SECRET`
(optional), `WEB_APP_URL`. Web: `VITE_TURNSTILE_SITEKEY` (optional).

Run the test suite (badges, votes, check-in state machine):

```bash
npm test
```

## Prerequisites

- **Node.js >= 18.18** and npm (this repo was authored on a machine without
  Node installed; install it before running).
- For the mobile app: a **custom dev build** (MapLibre is a native module, so it
  does **not** run in Expo Go). Android Studio / Xcode or an EAS build.

## Privacy model (how the exact location is protected)

1. The client obtains the exact location (GPS or geocoded address) and keeps it
   in **local memory only**.
2. `maskLocation()` (`shared/src/mask.ts`) picks a point uniformly **by area**
   within 50 m: random angle, radius = `50 * sqrt(random())`, converted to a
   geographically correct lat/lng offset (longitude scaled by `cos(lat)`).
3. Only `{ lat, lng }` of the masked center is emitted via `location:update`.
4. The server validates ranges, rate-limits, stores only the masked center, and
   broadcasts it. Exact coordinates never reach the server, other clients, logs,
   URLs, or analytics.
5. A new random offset is generated on **every** update.

## Configuration

Copy the example env files and adjust as needed:

```
server/.env.example  -> server/.env
web/.env.example     -> web/.env
mobile/.env.example  -> mobile/.env
```

Key server settings (`server/.env`):

- `PORT` (default 4000)
- `CORS_ORIGINS` - comma-separated allowed origins (e.g. `http://localhost:5173`)
- `PRESENCE_TTL_MS` - inactivity timeout before a circle is removed (default 60000)
- `SWEEP_INTERVAL_MS` - how often expired records are purged (default 5000)
- `MIN_UPDATE_INTERVAL_MS` - per-socket rate limit (default 2000)
- `NODE_ENV=production` - enables `trust proxy` for HTTPS/WSS termination

## Install & run (web + server)

From `safesips-app/`:

```bash
npm install            # installs shared, server, web workspaces
npm run build:shared   # compile @safesips/shared once
npm run dev            # builds shared, then runs server + web together
```

Then open the web client at `http://localhost:5173`.
The presence server runs at `http://localhost:4000` (`/health` for a status JSON).

Run pieces individually:

```bash
npm run dev:server     # backend only (tsx watch)
npm run dev:web        # web only (Vite)
```

Production build:

```bash
npm run build          # builds shared + server + web
npm run start:server   # node dist/index.js (set NODE_ENV=production + server/.env.production)
# serve web/dist with any static host / CDN behind HTTPS
```

## Production deployment (safesips.org)

Targets: **api.safesips.org** (API + WebSockets) and **app.safesips.org** (static web).

| Component | Config |
|-----------|--------|
| API | [server/.env.production](server/.env.production) — `CORS_ORIGINS`, rate/TTL limits |
| Web build | [web/.env.production](web/.env.production) — `VITE_SERVER_URL=https://api.safesips.org` |

### Docker (recommended)

```bash
npm run build
npm run deploy:compose   # builds images; web on http://localhost:8080, API on :4000
```

See [deploy/README.md](deploy/README.md) for TLS/WSS nginx templates (`deploy/nginx-api.conf`, `deploy/nginx-web.conf`).

### Verify before go-live

```bash
# Local
npm run dev              # in another terminal, or:
npm run build && npm run start:server
npm run smoke-test
npm run uptime-check

# After DNS + TLS are configured
API_URL=https://api.safesips.org WEB_ORIGIN=https://app.safesips.org npm run smoke-test
```

CI runs build + smoke test on every push via [.github/workflows/deploy-check.yml](.github/workflows/deploy-check.yml).


The shared package must be built first so Metro can resolve it:

```bash
cd safesips-app
npm run build:shared
cd mobile
npm install
# point the app at your server over the LAN (not localhost) for a real device:
#   EXPO_PUBLIC_SERVER_URL=http://<your-LAN-ip>:4000
npx expo install --fix     # align native deps to your installed Expo SDK
npx expo prebuild          # generate native projects (MapLibre needs a dev build)
npx expo run:android       # or: npx expo run:ios
```

Notes:

- MapLibre uses **free OpenStreetMap raster tiles**; no token is required
  (`MapLibreGL.setAccessToken(null)`).
- Version pins target Expo SDK 52 / RN 0.76. If your installed SDK differs, run
  `npx expo install --fix` and let Expo reconcile native dependency versions.

## Security & privacy summary

- Only the masked center + an anonymous `publicId` + timestamps cross the wire.
- HTTPS/WSS expected in production (`trust proxy`, env-based CORS origins).
- Incoming payloads are validated and rate-limited server-side; extra fields are
  dropped.
- Inactive/stale presence is purged automatically; **Stop sharing** removes the
  circle from every client immediately.
- Location masking reduces precision but does not guarantee anonymity; the UI
  states this and warns before sharing from sensitive places.

## Manual verification (multi-user)

1. Start `npm run dev`. Open two browser tabs (or two devices) at the web app.
2. In tab A, click **Share My Location** (or type an address and press **Go**).
   - Tab A shows a blue dot at the exact spot and a yellow 200 m circle offset
     from it.
   - Tab B shows **only** the yellow circle (no blue dot, no exact position).
3. Click **Update** in tab A a few times - the circle's center shifts within the
   50 m mask each time, live in tab B (no refresh).
4. Open the browser Network/WS frames: confirm payloads contain only the masked
   `lat`/`lng`, never the exact position.
5. Click **Stop sharing** in tab A - the circle disappears from tab B instantly.
6. Share again, then close tab A without stopping. After `PRESENCE_TTL_MS`
   (default 60s) the circle is removed from tab B by the server sweep.
7. Repeat across web + mobile to confirm both clients interoperate on the same
   server.
