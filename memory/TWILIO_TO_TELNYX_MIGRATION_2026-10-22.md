# Twilio → Telnyx Migration (reversible) — started 2026-10-22

## Why
Twilio **main account AC754fb3… is SUSPENDED** ("status 4 is not active", HTTP 401).
A suspended main account also disables every Twilio **sub-account**, so all Twilio-powered
numbers lose voice + SMS at once.

### Verified impact (read-only prod probe 2026-10-22)
- Last successful Twilio bulk call: **2026-10-21 18:02 UTC**; auth-failure monitor fired **2026-10-22 00:03 UTC**.
- Active Twilio numbers: **7** (all **US toll-free**, 6 users). Features in use: callForwarding (7), SMS (7), voicemail (2).
- **Bulk IVR** (Twilio-only feature): 431 completed calls on 2026-10-20; 127 campaigns / 10 users in 90 days.
- Telnyx account: ACTIVE, 3 toll-free numbers, voice + SMS profiles enabled, balance **$6.92 (needs top-up)**.
- Telnyx already implements the full stack: SIP connection + credentials, call control
  (answer/transfer/play/gatherDTMF/record/bridge/hangup), outbound calls + AMD, messaging.
  Quick/Single outbound IVR + inbound voice already run on Telnyx today.

## Owner decisions (2026-10-22)
1. Replace the 7 live Twilio toll-free numbers with **new Telnyx toll-free numbers** (reassign 6 users; numbers change).
2. Phase order: 0 → 1 → 2.
3. Bulk IVR billing isolation → **drop Twilio sub-account model, use the existing in-app wallet ledger per call**.
4. **No SMS** on Telnyx for now (defer toll-free verification) — voice/IVR only.
5. Ship via sandbox build+test → owner "Save to GitHub" + deploy.
6. **Must stay reversible**: when Twilio is reinstated, one flag flip restores today's exact behavior.

## The reversible switch — `TWILIO_ENABLED`  (backend/.env)
- unset / `true`  → **current dual-provider behavior** (Twilio + Telnyx). Flip here to restore Twilio.
- `false`         → Twilio hidden: Telnyx-only catalog, purchases steered to Telnyx.
- Default is `true`, so a missing var is always safe (stays in today's mode).
- Read at **module load** (env is fixed per process; flipping requires an .env edit + restart anyway).
- Design = **gate, don't rewrite**: no stored data is changed, so flipping back is instant.

### PRODUCTION rollout for the flag (owner action)
Set `TWILIO_ENABLED=false` in BOTH prod envs, then redeploy/restart:
- Railway service `Nomadly-EMAIL-IVR` (env `production`)
- Droplet `/opt/nomadly/shared/{app-main,app-wl}/backend.env`
Also re-lock the vault after editing sandbox .env if it becomes the source of truth.
**And top up the Telnyx balance** (currently $6.92).

## Phase 0 — DONE (sandbox, 2026-10-22) — steer new purchases to Telnyx
Code (reversible, gated on `TWILIO_ENABLED`):
- `js/phone-config.js`: `isTwilioEnabled()` helper (exported). `allCountries` and `moreCountries`
  are built at module load WITHOUT the Twilio countries when the flag is false (US/CA only;
  the "More Countries" button auto-hides via the existing `moreCountries.length > 0` guards;
  `countryByName` no longer resolves Twilio country names).
- `js/twilio-service.js`: `searchNumbers()` returns `[]` and `buyNumber()` returns a friendly
  error when the flag is false (boundary defense-in-depth — no Twilio inventory ever offered/bought).
- `js/_index.js`: `canSearchBoth = (nativeProvider==='telnyx') && phoneConfig.isTwilioEnabled()`
  (2 spots) so US/CA return the full 5 Telnyx results instead of a wasted dual search.
Verified: unit check (true→full catalog incl. GB; false→US/CA only, Twilio search/buy blocked),
clean Node boot with `TWILIO_ENABLED=false`, `/api/health` 200. Sandbox .env has `TWILIO_ENABLED=false`.

## Phase 1 — NEXT — existing numbers on Telnyx
- Reassign the 6 users to new Telnyx toll-free numbers; route their forwarding / voicemail /
  inbound SIP / Quick IVR through the existing Telnyx paths.
- When `TWILIO_ENABLED=false`, any lingering Twilio-number action should return a friendly
  "number is being upgraded" message instead of a raw 401.

## Phase 2 — LATER — Bulk IVR on Telnyx
- Rebuild `js/bulk-call-service.js` on Telnyx Call Control (reuse the Telnyx outbound-IVR state
  machine in voice-service.js: menu / OTP / transfer / AMD), with queue + concurrency + per-lead
  tracking. Billing via the in-app wallet ledger (no Twilio sub-accounts). Then Telnyx numbers
  become "☎️ Bulk IVR capable" and the Twilio-sub-account requirement is gated on the flag.

## Phase 3 — deferred — Telnyx toll-free SMS verification; retire Twilio code paths.
