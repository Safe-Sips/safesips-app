# SafeSips production deployment

Targets: **api.safesips.org** (API + WebSockets) and **app.safesips.org** (static web).

## Quick deploy (Docker)

```bash
cd safesips-app
npm run build
docker compose -f deploy/docker-compose.yml up -d --build
```

Web is exposed on **http://localhost:8080**. Point `app.safesips.org` DNS at this host and terminate TLS with your reverse proxy.

## Environment

| Service | File | Key vars |
|---------|------|----------|
| API | `server/.env.production` | `CORS_ORIGINS`, `PORT`, rate/TTL limits |
| Web | `web/.env.production` | `VITE_SERVER_URL=https://api.safesips.org` |
| Mobile | `mobile/.env.production` | `EXPO_PUBLIC_SERVER_URL` |

## TLS + WSS

1. Obtain certificates for `api.safesips.org` and `app.safesips.org`.
2. Use `deploy/nginx-api.conf` as a template — proxy WebSocket upgrade headers to the API container.
3. Serve `web/dist` (or the `safesips-web` container) behind HTTPS for the app subdomain.

## Verify

```bash
# Local
npm run dev
node scripts/smoke-test.mjs

# Production (after DNS + TLS)
API_URL=https://api.safesips.org WEB_ORIGIN=https://app.safesips.org node scripts/smoke-test.mjs
node scripts/uptime-check.mjs
```

## GitHub Actions

`.github/workflows/deploy-check.yml` runs build + smoke test on every push.
