# SafeSips — Project Roadmap & Checklist

> **Interactive version:** open [`TODO.html`](TODO.html) in a browser for a clickable checklist whose progress is saved in your browser.
>
> Derived from [`SafeSips_Master_Information.txt`](SafeSips_Master_Information.txt) (v2.2). Tracks 1, 2, 4, 5 are largely done; **Track 3 — the actual detection technology — has not started beyond the research paper** (no prototype built, no chemistry tested).

## ▶ Start here — recommended next 6 moves

1. **Freeze the minimum claim + formalize the lab test plan** (the paper already has a bench plan — turn it into a real protocol).
2. **Get ICHB lab access + safety approvals, and source the *safe surrogate* reagents** (sarcosine, γ-valerolactone, acetylacetone…).
3. **Run the first cheap bench experiment** — the paper's "specificity-separation" test uses only safe compounds and validates the core dual-detection premise.
4. **Fix the public `<0.2%` / `<5 s` claims** on the live site (label them theoretical) and update the stale legal drafts.
5. **Knock out the small high-leverage app fixes** — mobile handshake, broken CI, engagement-score bug.
6. **Decide whether to host the app** (app/api.safesips.org) now or keep it local until the science firms up.

---

## 1 · Brand & creative foundation
- [x] Name, tagline ("Your best party friend"), closing line
- [x] Brand archetype, voice, tone
- [x] Colour palette (lavender / hot-pink / navy / gold)
- [x] Typography system (Bebas Neue / Nunito / Playfair)
- [x] "Night Bloom Lab" visual system & motion language
- [x] Product look locked (matte-black pen)
- [ ] Final logo / wordmark system
- [ ] Reconcile fonts used on the site (Baloo 2, Fredoka, Lilita One) with the documented type system

## 2 · Science — research (paper)
- [x] Detection concept designed (3 channels: GHB / ketamine / Rohypnol)
- [x] Revised architecture: SEC clean-up + dual optical–electrochemical detection at ITO electrode
- [x] Reagent set chosen (ferric hydroxamate / cobalt thiocyanate / electrochemical nitro-reduction)
- [x] Kinetic + signal-to-noise modelling, projected performance figures
- [x] Validation/bench plan drafted with safe surrogate compounds
- [x] Comparison with published platforms
- [ ] Add OTTLE / spectroelectrochemistry references (paper flags this gap)

## 3 · Science — prototype & lab validation ⚠️ *not started — critical path*
- [ ] Formalize the lab test protocol (controls, concentrations, pass/fail criteria)
- [ ] Obtain institutional/lab access + safety approvals (fume hood, supervision)
- [ ] Verify Romanian/EU law for regulated reagents before purchase
- [ ] Source safe surrogate compounds (sarcosine, L-proline, γ-valerolactone, acetylacetone, benign nitroaromatic)
- [ ] Bench-test each colour channel: 6 matrices × 8-point 0–200 µM ladder × 3 replicates
- [ ] Run the "specificity-separation" headline experiment (colour can't separate; voltammetry can)
- [ ] Prove SEC value: run spikes with vs. without the size-exclusion column
- [ ] Bring up the optically transparent ITO electrode (ferro/ferricyanide couple)
- [ ] Build agreeing optical + electrochemical calibration curves (≥ Rohypnol channel)
- [ ] Quantify dissolved-oxygen interference + test deoxygenation mitigation
- [ ] Measure real LOD, sensitivity, specificity, matrix CV, false-positive rate (replace modelled figures)
- [ ] Fabricate the microfluidic cartridge (channel geometry, dried reagents)
- [ ] Reagent shelf-life, sealing, contamination & disposal studies
- [ ] Optical sensor + electrochemical readout hardware
- [ ] BLE pen-to-app integration proof of concept
- [ ] Independent-laboratory validation (before any public performance claim)

## 4 · Marketing website (safesips.org)
- [x] Static landing live on GitHub Pages
- [x] Hero, sections, animations, waitlist modal
- [x] Waitlist backend (Google Apps Script → Sheet + welcome email)
- [x] Footer legal modal drafts + 112 disclaimer
- [ ] Fix/qualify the `<0.2%` and `<5 s` public claims (label theoretical)
- [ ] Update legal drafts — they still describe the *removed* live-map service
- [ ] Fix the dead "Research Paper" footer link
- [ ] Decide on a single support email (jamld2135@gmail.com vs support@safesips.app)
- [ ] Merge the two parallel waitlists (site Google Sheet + app SQLite)

## 5 · Safety app — v2.0 web
- [x] Accounts, JWT auth, email verification, anti-bot
- [x] Live privacy map with location masking
- [x] Safety reports + community upvoting
- [x] Safe havens (Overpass nearby-help)
- [x] Spiking first-aid content
- [x] Check-in / dead-man's-switch + SOS escalation (recording)
- [x] Community forum + badges
- [x] SQLite persistence, security hardening, unit + smoke tests
- [ ] Wire real SMS/email for SOS escalation (currently a stub — safety-critical)
- [ ] Fix engagement-score bug (downvotes currently raise score)
- [ ] Reconcile 911 vs 112 across the web UI (Romania → 112)
- [ ] Add forum moderation/delete + GDPR account-deletion endpoint
- [ ] Salt the IP/token hashes (currently unsalted SHA-256)
- [ ] Fix the broken CI workflow (wrong `safesips-app/` path)
- [ ] Host app + API (app.safesips.org / api.safesips.org)

## 6 · Mobile app
- [x] v1.x Expo map client (masking, geocoding parity)
- [ ] Restore connectivity — broken against the v2.0 server (no JWT in handshake)
- [ ] Bring mobile to v2.0 (login, accounts, reports, forum, legal modals)
- [ ] Mobile address autocomplete + legal UI parity

## 7 · Legal, privacy & compliance
- [x] Draft Privacy Policy / Terms / disclaimers (in-app + site)
- [ ] Qualified counsel review (Romania / EU GDPR, consumer, location-data law)
- [ ] Formal GDPR documentation (consent, retention, deletion, encryption at rest)
- [ ] Device regulatory classification + supportable claims
- [ ] Claims-governance process (what can be said publicly, when)
- [ ] IP protection (brand, design, software, novel technical elements)

## 8 · Business, funding & operations
- [x] Business plan 2026–2027 (pricing, unit economics, 3-yr model, funding need)
- [x] Product family defined (Starter Kit, refills, Venue Pack/Care)
- [ ] Register SafeSips Technologies SRL (activity codes, tax/accounting)
- [ ] Supplier quotations + prototype bill of materials
- [ ] Rebuild the financial model on real costs
- [ ] Secure funding (grants/competitions → angel/pre-seed → strategic partner)
- [ ] Identify partners: independent lab, microfluidics/electronics suppliers, legal/DP adviser

## 9 · Go-to-market & pilot
- [x] Marketing/content strategy + channel plan drafted
- [ ] User testing (form factor, alert wording, discreetness)
- [ ] Campus ambassadors + 5–10 pilot venues lined up
- [ ] Pilot lot (500–1,000 devices, ≥10,000 cartridges)
- [ ] Controlled pilot with privacy/response protocol
- [ ] Publish validated performance + limits → launch decision (target Sep 2027)

---

*Last updated: July 10, 2026 — supersedes the June 2026 privacy-map roadmap.*
