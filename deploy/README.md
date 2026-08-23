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

| Service | File / host | Key vars |
|---------|-------------|----------|
| API (Render) | Environment Variables + `server/.env.production` | `CLERK_SECRET_KEY` (**required**), `JWT_SECRET`, `CORS_ORIGINS`, `PORT` |
| Web (Netlify) | Build env + `web/.env.production` | `VITE_CLERK_PUBLISHABLE_KEY` (**required**), `VITE_SERVER_URL` |
| Mobile | `mobile/.env.production` | `EXPO_PUBLIC_SERVER_URL` |

### Clerk (Netlify + Render)

Without these, sign-in succeeds in the browser but `/api/auth/me` returns **401** and the app shows “Could not connect your account”.

1. **Netlify** (Site → Environment variables): set `VITE_CLERK_PUBLISHABLE_KEY` to your Clerk publishable key, then **trigger a new deploy** (Vite bakes this in at build time).
2. **Render** (Service → Environment): set `CLERK_SECRET_KEY` to the matching Clerk secret key (`sk_test_…` or `sk_live_…`). Redeploy/restart the service.
3. Use a **matching pair** from the same Clerk instance (both test or both live).
4. In the [Clerk Dashboard](https://dashboard.clerk.com/) → Paths / Domains, allow your production web origins (e.g. `https://safesips.org`, `https://your-site.netlify.app`).
5. If you open the site on a Netlify preview URL, add that origin to Render `CORS_ORIGINS` as well.

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
