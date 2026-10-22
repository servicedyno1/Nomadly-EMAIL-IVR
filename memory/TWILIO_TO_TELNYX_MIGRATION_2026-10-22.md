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
- ✅ DONE 2026-10-22 08:42Z: `TWILIO_ENABLED=false` appended to ALL 4 droplet envs
  `/opt/nomadly/shared/{app-main,app-wl,app-voodoo,app-proshop}/backend.env` (backups `backend.env.bak.twilio-off.20261022T084243Z`).
  All 4 brands share the same (suspended) Twilio SID. No restart: running releases (21 Oct) predate the flag; it takes
  effect on the next deploy (owner "Save to GitHub" → main deploy + Sync main → WhiteLabel → wl/voodoo/proshop).
  Railway is dormant — not changed. WhiteLabel sync dry-run: clean (exit 0, _index.js + voice-service.js 3-way merged).
- ✅ LIVE 2026-10-22 ~08:54Z on all 4 bots via direct droplet deploy (not via GitHub) — Twilio OFF, Telnyx Bulk IVR +
  controls/intl pricing/voicemail drop live. Details + rollback in PRD.md (2026-10-23 entry). GitHub still needs the code.
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
- DONE 2026-10-22: graceful "being upgraded" banner (myNumbersList + manageNumber, en/fr/zh/hi) and
  Quick-IVR guard in voice-service initiateOutboundIvrCall (friendly error, no Twilio call) + Bulk IVR
  capable list excludes Twilio numbers when the flag is off. Tests: js/tests/test_twilio_switch_2026-10.js (43/0).
- Lint cleanup same day: all no-empty / no-undef / dupe-key / const-assign etc. fixed in _index.js,
  voice-service.js, phone-config.js (2 real bugs: askVPSPlanAutoRenewal const reassign; domain-purchase
  catch out-of-scope `name`). Remaining cosmetic only: no-unused-vars 414, no-useless-assignment 35, no-useless-escape 10.
- Reassign the 6 users to new Telnyx toll-free numbers; route their forwarding / voicemail /
  inbound SIP / Quick IVR through the existing Telnyx paths.
- When `TWILIO_ENABLED=false`, any lingering Twilio-number action should return a friendly
  "number is being upgraded" message instead of a raw 401.

## Phase 2 — DONE (sandbox) — Bulk IVR on Telnyx Call Control
- `bulk-call-service.js`: campaigns carry `provider` ('telnyx' | 'twilio'; missing = legacy twilio).
  Telnyx campaigns need no sub-account; dial via `voiceService.initiateOutboundIvrCall` (audio+DTMF,
  hold-music bridge transfer, multi-key menu, report-only). New `onCallComplete` (called by
  voice-service hangup) → shared `finalizeLead` (atomic, once per lead) → `billLead` ($0.15/min, min 1,
  failed+0s not billed) → progress → next dial → completion/report.
- Status map (Telnyx): answered→completed; answered+AMD machine (no key)→**voicemail** (app hangs up);
  busy/user_busy/call_rejected→busy; timeout/no_answer/originator_cancel/normal_clearing→no_answer; else→failed.
- Safety: atomic `claimLead` (no double-dial), account-wide pacing `BULK_TELNYX_DIAL_GAP_MS` (1000),
  stuck-lead sweeper `BULK_STUCK_LEAD_MAX_MIN` (20, every 2 min), recovery skips in-process campaigns,
  keeps warm-loaded live Telnyx legs, hangs up orphaned legs before re-dial; Telnyx account errors
  (insufficient funds / account inactive / auth) end the campaign "provider suspended".
- voice-service: no unified IVR_Outbound billing for campaign calls (no double charge); transferred flag
  only on a real transfer attempt; bridged transfer sets `transferConnected`.
- Legacy Twilio campaigns while `TWILIO_ENABLED=false` → cancelled "Twilio number being upgraded" + friendly DM.
- `_index.js`: Telnyx numbers always Bulk-IVR capable (caller list + ☎️ badge); Twilio only when flag on.
- Report: Voicemail line (en/fr/hi/zh), CSV "Answered By" column.
- Tests (sandbox Mongo 27999, Telnyx stubbed): test_bulk_telnyx_2026-10.js 22/22,
  test_bulk_telnyx_edge_2026-10.js 17/17, Twilio regressions green. Report: test_reports/iteration_105.json.
- OPEN owner decisions: intl leads bill flat $0.15/min on Telnyx (Quick IVR intl = $0.50) — margin risk;
  no "resume paused campaign" action exists in the bot (pre-existing).

## Phase 3 — deferred — Telnyx toll-free SMS verification; retire Twilio code paths.
