# SafeSips launch checklist

What's still needed to publish SafeSips (web + App Store / Google Play), as of
21 October 2026. Items marked **(you)** need an account, payment or a decision
only you can make; everything else is code.

## 1. Blockers — do these first

1. **Persistent database (you).** Render's free plan has no disk, so every
   deploy or restart wipes the SQLite database: accounts' friends, emergency
   contacts, check-ins, reports and alerts. (Evidence: a SafeSips code and an
   accepted contact disappeared between two deploys on 20 Oct.)
   - Easiest: upgrade the Render service to **Starter** (~$7/month), add a
     **Disk** (1 GB is plenty, ~$0.25/month) mounted at `/var/data`, and set
     `DATABASE_PATH=/var/data/safesips.db`.
   - Location shares now survive restarts too (`presence_shares`), but only once
     the database itself persists.
2. **Production mode on Render (you).** Set `NODE_ENV=production`,
   `JWT_SECRET` (any random 32+ characters — the server refuses to start in
   production without it) and `CLIENT_IP_HEADER=cf-connecting-ip`. Production
   mode turns on HSTS and strict config checks.
3. **Moderators (you).** Set `ADMIN_EMAILS=you@…` on Render. The Moderation tab
   (`/admin`) lists everything people reported; the Terms promise review
   within about 24 hours.
4. **Move the web app to app.safesips.org (you).** Netlify ran out of credits,
   so the live site stopped updating after PR #23. `render.yaml` defines the
   replacement (a free Render static site); see the step-by-step guide in
   `docs/MOVE_TO_APP_SAFESIPS_ORG.md`.
5. **Clerk production instance (you).** The sign-in form says "Development
   mode": dev instances are capped and not meant for real users. Create a
   production instance on your domain, then swap `VITE_CLERK_PUBLISHABLE_KEY`
   (web app on Render) and `CLERK_SECRET_KEY` (API on Render). Enable **Sign in with Apple** in
   Clerk — Apple requires it when you offer Google sign-in (guideline 4.8).
6. **Map tiles (you).** openstreetmap.org's tile servers don't allow app-scale
   use. Get a free key from MapTiler or Stadia Maps and set
   `VITE_MAP_TILE_URL` / `VITE_MAP_TILE_ATTRIBUTION` on the web app's Render site (no code change).

## 2. Getting into the App Store / Google Play

The native app in `mobile/` is a small Expo map-only app: no reports, forum,
check-ins, friends, alerts, push or account deletion. The web app has all of
it. Two realistic routes:

- **A. Wrap the web app** (recommended to launch sooner): Capacitor (or an
  Expo WebView shell) around the existing web app, plus native push
  (APNs/FCM) for check-in alerts and native location permission. Apple may
  reject a plain website wrapper (guideline 4.2), so it needs native value:
  push notifications, location, offline first aid, Sign in with Apple.
  Server work: send push via APNs/FCM (or Expo push) in addition to Web Push.
- **B. Finish the Expo app**: port every web feature to React Native. Bigger
  job (weeks), better long term.

Either way you'll need:

- **Accounts (you):** Apple Developer Program ($99/year); Google Play Console
  ($25 once). New personal Play accounts must run a closed test with at least
  12 testers for 14 days before going public.
- **App Review requirements already covered in this repo:** in-app account
  deletion (Profile → Your data), reporting content and blocking people
  (guideline 1.2), published Terms with a zero-tolerance clause and a contact
  address, privacy policy, emergency/medical disclaimers.
- **Still to prepare (you):**
  - App icons (1024×1024), splash screen, screenshots for each device size.
  - Privacy policy and support pages on a public URL (e.g. safesips.org/privacy).
  - App Privacy "nutrition labels": email, name, photos (avatar), coarse
    location (circle), user content (posts, reports), identifiers.
  - Age rating: alcohol/drug references → likely 17+ (Apple) / Mature (Play).
    The app's own minimum age is 16.
  - A demo account and notes for App Review (how to try check-ins and
    alerts with two accounts).
  - Location permission text: "while using the app" only (no background).
  - Have a lawyer review the Privacy Policy and Terms, and a medical
    professional review the first-aid page (both say so in the app).
- **Email:** `support@safesips.app` is used throughout — make sure that inbox
  exists and is read.

## 3. Nice to have before launch

- Content-Security-Policy (full) for the web app — needs testing with Clerk's
  scripts and Google sign-in; only `frame-ancestors 'none'` is set today.
- A real tile provider for the mobile app (`mobile/src/mapStyle.ts`).
- Show suspended users a clear message (their map just says "Offline").
- Waitlist page is no longer linked from anywhere (re-link it or remove it).
- Remove the unused score/badge code (profile no longer shows points).
- Uptime monitor (e.g. UptimeRobot on `/health`) as a second line behind the
  GitHub keep-alive workflow.

## 4. What changed in this session (21 Oct 2026)

See PR "Launch readiness" for details. Highlights: moderation (report, block,
delete own posts, rate limits, admin queue, auto-hide at 3 reports, suspension
hides content), restart-proof location shares, check-in answer lock-out after
5 wrong answers and Pause/Resume, socket per-IP limit fixed behind the proxy,
push endpoints restricted to real push services, web security headers, many
UI fixes, and clearer wording everywhere (privacy policy and terms rewritten).
