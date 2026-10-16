# SIP low-balance "503" — silent lock + threshold retune (2026-10-16)

## Trigger
- Nomadly prod user **@pirate_script** (chatId `1005284399`) reported "error using SIP" — Zoiper
  softphone showed **`Service Unavailable (503)`** on the dialpad.
- Owner also complained the user got NO bot alert, and that his balance ($49.11) "isn't low".

## RCA
- His number **+18445716353** and its SIP credential are 100% healthy:
  - Telnyx telephony_credential `1a1746bd-379b-4956-9327-df6eb9e1af4e` (`gencredZNgz…`) = active, on shared
    connection `2898118323872990714` (sip.speechcue.com → Telnyx 192.76.120.10).
  - Twilio sub-account `ACebf061…` active, number `in-use`, voice webhook → `/twilio/voice-webhook`.
- The **503 was our backend rejecting his outbound SIP INVITE**: at 2026-10-15 23:56 his wallet was **$0.18**
  (he'd just spent ~$118/$120 buying the Business number). `handleOutboundSipCall` hit the LOW BALANCE LOCK,
  added his SIP cred to the pre-dial instant-block list, and `rejectCall()` → Telnyx surfaces that as 503.
- He topped up **$50 (DynoPay) on 2026-10-16 16:25 → balance $49.11**; bot Quick-IVR calls then worked (17:32).
  So calling already works again — the lock was correct behaviour at the time.

## Two real gaps (fixed)
1. **Silent lock.** The low-balance alert was gated on `if (baseMsg)` where `baseMsg = _trans('vs.outboundCallingLocked')`.
   If that string is missing/empty the WHOLE alert (incl. the hardcoded English body) was suppressed → user saw only
   Zoiper's bare "503". The auto-routed/sip-blocked paths had the same `if (msg)` gate. No record of any alert ever
   reaching chatId 1005284399.
2. **Thresholds not what owner expected.** Prod had `BULK_CALL_MIN_WALLET=$50`, and single/SIP used code defaults
   TRIGGER=$1 / RESUME=$20 (`CALL_LOW_BALANCE_*` unset).

## Fix
Code (`js/voice-service.js`, `js/_index.js`):
- Added `LOCK_FALLBACK_HEADER` and made every low-balance alert **always send** with an English fallback (never silent):
  `notifyPreDialLowBalance`, the LOW BALANCE LOCK branch, `vs.sipCallBlocked`, auto-routed
  `callDisconnectedAutoRouted` + `callDisconnectedWalletInsufficient`.
- `removeSipPreDialBlockByChatId` now **always** clears lingering `walletRejectCooldown` entries (previously only when an
  in-memory block existed — cooldowns escalate up to 2h and could keep rejecting after a top-up) and returns a count.
- `addFundsTo` (single credit choke point for ALL top-ups) now, when a top-up brings a **previously-locked** user back to
  ≥ resume, sends a **"✅ Outbound calling re-enabled"** confirmation (only when something was actually cleared).

Env (all 4 brands' `shared/app-*/backend.env`):
- `CALL_LOW_BALANCE_TRIGGER=1`, `CALL_LOW_BALANCE_RESUME=5`, `BULK_CALL_MIN_WALLET=20`.

## Deploy (2026-10-16)
- Hot-patched LIVE releases for ALL 4 bots (app-main `…174434Z-4c0844a`, app-wl `…174555Z-8339065`,
  app-voodoo `…174735Z-8339065`, app-proshop `…174914Z-8339065`): copied new `voice-service.js` (identical across
  brands), string-patched the `addFundsTo` hook in `_index.js` (WhiteLabel `_index.js` differs elsewhere so patched,
  not copied). `.bak_sipfix_<ts>` backups kept. `node -c` OK on all. Env set via `scripts/ops/set_env_keys.py`
  (keys 238→240 etc, MONGO_URL/TOKEN intact). `pm2 reload <slot> --update-env` on each active slot.
- Verified live: `TRIGGER=1 RESUME=5 BULK=20`, `vs.LOW_BALANCE_RESUME=5` on all 4; `/health` healthy (main).
- **NEEDS "Save to GitHub"** to persist the code change in the repo (CI then keeps releases in sync).

## Tests
- `js/tests/test_call_billing_thresholds.js` 6/6.
- `js/tests/test_sip_lowbalance_alert_2026-10.js` 3/3 (alert never silent; top-up clears cooldown + returns count;
  no-op clear returns 0).

## Ops helpers (persistent)
- `scripts/ops/patch_sip_lowbalance.js` (safe one-shot `_index.js` block swap), `scripts/ops/set_env_keys.py`.
