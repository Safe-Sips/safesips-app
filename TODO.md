# SafeSips — Roadmap & To-Do

Prioritized next steps after the June 2026 privacy-map prototype. Full context: [SafeSips_Master_Information.txt](SafeSips_Master_Information.txt) sections 18–19.

## Status

- [x] **Deploy production tooling** — Docker compose, nginx templates, smoke/uptime scripts, CI deploy-check workflow, README deploy section. *Live DNS/TLS at safesips.org still required on the host.*
- [ ] **Mobile parity** — Port address autocomplete, legal modals, map legend, AsyncStorage warning persistence; EAS internal build
- [ ] **Map UX upgrades** — Timed sharing (30/60/120 min), bloom styling, clustering, reconnect UX, RO/EN copy, socket integration tests
- [ ] **Friends link MVP** — Share-with-friends session link (`/join/:code`); viewers see only that user's masked circle
- [ ] **Scroll site scaffold** — Next.js + GSAP ScrollTrigger + R3F nine-chapter homepage with placeholder pen
- [ ] **Waitlist funnel** — CTA with name, email, country, interest type; provisional disclaimers
- [ ] **Lab test plan** — Minimum-claim protocol: one channel, drink panel, controls, pass/fail criteria
- [ ] **Cartridge prototype** — Single-channel microfluidic cartridge; capillary + color reaction validation
- [ ] **BLE alert POC** — Mock pen service + calm SafeSips Alert screen; optional trusted-contact notify stub

## Track 1 — Digital (Sprint 1)

| # | Task | Notes |
|---|------|-------|
| 1 | Deploy API + web | See [deploy/README.md](deploy/README.md). Verify: `npm run smoke-test` |
| 2 | Mobile parity | Match web: autocomplete, legal UI, legend, AsyncStorage |
| 3 | Map UX | Timed sessions, blooms, clustering, reconnect, i18n, tests |
| 4 | Friends link | No-auth trusted-circle bridge before full contacts |

## Track 2 — Marketing (Sprint 2)

| # | Task | Notes |
|---|------|-------|
| 5 | Nine-chapter scroll site | Night Bloom Lab; pen as hero |
| 6 | Waitlist funnel | Wire to [safesips-website/waitlist](https://github.com/Safe-Sips/safesips-website) Apps Script |

## Track 3 — Hardware / science (Sprint 3)

| # | Task | Notes |
|---|------|-------|
| 7 | Lab protocol | Rohypnol channel first; independent lab before public claims |
| 8 | Cartridge v0 | Fluidics before final pen casing |
| 9 | BLE → app alert | Mock pen + calm alert UI; SMS notify stub |

## Deferred

- GDPR / Romania legal review of draft Privacy Policy & Terms
- SafeSips Technologies SRL registration and team roles
- Business case rebuild with real supplier quotes

---

*Last updated: June 2026*
