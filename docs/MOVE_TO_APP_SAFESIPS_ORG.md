# Moving the web app to app.safesips.org

Netlify ran out of credits, so the web app moves to a free **Render static
site** at **app.safesips.org**. The API stays where it is. `render.yaml` in the
repo root already describes the site (build, routing, security headers).

Total time: about 15 minutes of clicking, plus waiting for DNS (usually a few
minutes, at most an hour or two).

## 0. Have these ready

- **Clerk publishable key** (starts with `pk_test_` or `pk_live_`): Netlify →
  your site → *Site configuration → Environment variables →
  VITE_CLERK_PUBLISHABLE_KEY*, or Clerk dashboard → *Configure → API keys →
  Publishable key*.
- Logins for **Render** and **Namecheap**.

> ⚠️ While the API is on Render's free plan, every change to its settings
> redeploys it and **wipes the database** (see `LAUNCH_CHECKLIST.md`). If you're
> also adding the disk / production settings, do them in step 4 together so
> it only happens once.

## 1. Create the web app on Render

1. Render dashboard → **New +** → **Blueprint**.
2. Pick the **Safe-Sips/safesips-app** repository (connect GitHub if asked).
3. Render reads `render.yaml` and shows one service: **safesips-web** (static
   site). It doesn't touch your existing API.
4. When asked for environment values:
   - `VITE_CLERK_PUBLISHABLE_KEY` → paste the key from step 0.
   - `VITE_MAP_TILE_URL` / `VITE_MAP_TILE_ATTRIBUTION` → leave empty for now.
5. Click **Apply**. The first build takes 2–4 minutes.
6. When it's live, open the address Render shows (something like
   `https://safesips-web.onrender.com`). You should see the sign-in page.

## 2. Add the domain on Render

1. **safesips-web** → **Settings** → **Custom Domains** → **Add Custom Domain**.
2. Enter `app.safesips.org` → **Save**.
3. Render shows the DNS record to create: a **CNAME** pointing to
   `safesips-web.onrender.com` (use exactly what it shows).

## 3. Point the domain at Render (Namecheap)

1. Namecheap → **Domain List** → **safesips.org** → **Manage** →
   **Advanced DNS**.
2. **Add New Record**:
   - Type: **CNAME Record**
   - Host: `app`
   - Value: `safesips-web.onrender.com` (from step 2)
   - TTL: Automatic
3. Click the ✓ to save. Don't change the existing records (they keep
   safesips.org on GitHub Pages).
4. Back on Render, next to `app.safesips.org` click **Verify**. Once it's
   verified, Render issues the HTTPS certificate on its own (a few minutes).

## 4. Tell the API about the new address

Render → **safesips-app** (the API) → **Environment**:

| Variable | Value |
|---|---|
| `CORS_ORIGINS` | `https://app.safesips.org` (add `,https://courageous-platypus-df5d5c.netlify.app` if you want the old link to keep working for a while) |
| `WEB_APP_URL` | `https://app.safesips.org` |
| `CLERK_AUTHORIZED_PARTIES` | only if it already exists: add `https://app.safesips.org` to the list |

Good moment to also add (see `LAUNCH_CHECKLIST.md`): the **Disk** +
`DATABASE_PATH=/var/data/safesips.db`, `NODE_ENV=production`, `JWT_SECRET`,
`CLIENT_IP_HEADER=cf-connecting-ip`, `ADMIN_EMAILS`.

**Save Changes** → the API redeploys (1–2 minutes).

## 5. Clerk

- **Development instance (what you have now):** nothing to change.
- **Later, production instance:** add `app.safesips.org` as its domain and
  follow Clerk's DNS steps, then put the new `pk_live_…` key on safesips-web
  and the `sk_live_…` key on the API.

## 6. Check it works

Open **https://app.safesips.org**:

- [ ] Sign-in page loads with the padlock (HTTPS).
- [ ] You can sign in, and the map's status pill says **Online**.
- [ ] Share your location, then refresh: you're still sharing.
- [ ] Friends, Check-ins and Alerts pages load.

Then tell Claude, and it will check headers, the build and the API from the
outside.

## 7. Turn on safesips.org/app

Merge https://github.com/Safe-Sips/SafeSips-Website/pull/1 (it makes
`safesips.org/app` forward to `app.safesips.org`). Only do this after step 6
works.

## 8. Stop Netlify

For **both** Netlify sites (`courageous-platypus-df5d5c` and
`gentle-dragon-b3d241`, a duplicate): *Site configuration → Build & deploy →
Continuous deployment → Stop builds* (or delete the site). That stops them
building previews for every pull request.

## 9. Tell your users

The app has a new address, so on each phone:

1. Open **app.safesips.org** and sign in.
2. Add it to the Home Screen again, and remove the old icon.
3. Turn notifications on again (Check-ins page).

Accounts, friends and contacts live on the server, so nothing else is lost.

## Optional: api.safesips.org for the API

1. Render → **safesips-app** → **Settings → Custom Domains** → add
   `api.safesips.org`.
2. Namecheap → Advanced DNS → CNAME, Host `api`, Value
   `safesips-app.onrender.com` → Verify on Render.
3. Render → **safesips-web** → **Environment** → `VITE_SERVER_URL` =
   `https://api.safesips.org` → **Save, rebuild and deploy**.
