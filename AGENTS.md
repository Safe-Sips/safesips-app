# AGENTS.md

Guidance for AI agents (CodeRabbit, Claude, etc.) working in this repo. Keep this file and
[`CLAUDE.md`](CLAUDE.md) in sync; the detailed playbook lives in the `safesips-workflow` skill
under [`.claude/skills/`](.claude/skills/).

## What this is

SafeSips — real-time, privacy-preserving location sharing. TypeScript monorepo:

- `shared/` (`@safesips/shared`) — mask logic, wire types, zod validation. **CommonJS**, used everywhere.
- `server/` (`@safesips/server`) — Express + Socket.io, `better-sqlite3`, Clerk auth. **ESM**.
- `web/` (`@safesips/web`) — React 18 + Vite + Leaflet + Clerk.
- `mobile/` (`@safesips/mobile`) — Expo SDK 52 / RN 0.76 + MapLibre + Clerk; links `shared` via `file:`.

`shared`, `server`, `web` are npm workspaces; `mobile` is separate.

## Build / test (from `safesips-app/`, Node >= 18.18)

- Always build `shared` first after editing it: `npm run build:shared` (dev/build do this automatically).
- `npm run dev` — shared + server (:4000) + web (:5173). `npm run build` — all three.
- `npm test` — builds shared, then `node --test server/test/*.test.ts`. Add `node:test` cases for new server/shared logic.
- `npm run smoke-test`, `npm run uptime-check` against a running server.

## Non-negotiables

- **Privacy invariant:** exact coordinates never leave the device. Only the masked center from
  `maskLocation()` (`shared/src/mask.ts`) is broadcast, with a fresh random offset every update.
  Never log exact coords or put them in URLs/analytics/payloads. *Safety reports* are the one
  deliberate exact-point publish — keep that path separate and keep its UI warning.
- **Auth is Clerk** (`@clerk/*`). Parts of `README.md` still describe the old email/JWT scheme —
  trust the code.
- **Review:** `coderabbit --agent -t uncommitted` — fix critical/high, skip nits unless asked,
  max 3 runs per diff.
