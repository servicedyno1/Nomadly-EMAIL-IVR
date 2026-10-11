# RCA + Fix: Hosting order failed — "domain already exists in the userdata" (@smsbeast_real)

**Date:** 2026-10-11 • **Bot:** nomadlybot (app-main) • **Severity:** customer-facing paid-order failure (no money lost)

## Incident
User `5976060042` (`@smsbeast_real`) bought a **Premium Anti-Red (1-Week)** plan at 23:42 UTC with
`luxelitecasinoreviews.com` as the **primary** domain. Flow: deposited $26.03 (USDT-TRC20) → wallet $28.58 →
"✅ Complete My Order" ($28.50) → "✅ Yes". Provisioning then failed:

```
[WHM] Username "luxe44a0" failed ((XID 5zduuq) The domain "luxelitecasinoreviews.com" already exists in the userdata.), retrying…
[WHM] Username "luxe657c" failed (… already exists in the userdata.), retrying…
[Hosting] WHM createAccount failed: (XID hqaxgc) The domain "luxelitecasinoreviews.com" already exists in the userdata.
❌ Hosting setup failed.
```
Admin alert correctly said **"💵 Wallet: not charged (existing domain)"** → user kept their $28.58 wallet balance. **No money lost.**

## Root cause
`luxelitecasinoreviews.com` was an **ADDON domain** on the user's OWN earlier cPanel account:
```
cpUser=elitda5b  domain=eliteescapesau.com  addonDomains=[…, luxelitecasinoreviews.com]
suspended=true (2026-10-10 04:07, plan expired)  deleted=false (at failure time)
```
That suspended account still existed on WHM, so its addon domain was still in WHM userdata. The new purchase tried to
create a fresh cPanel account with that domain as **primary** → WHM `createacct` collided.

Three compounding defects:
1. **Pre-flight guard gap** (`cr-register-domain-&-create-cpanel.js`): the idempotency/duplicate guard only matched the
   primary `domain` field, not `addonDomains`, so it never caught the conflict before `createAccount`.
2. **`isRetryableError`** (`whm-service.js`): the broad pattern `'already exists'` matched *"the domain … already exists
   in the userdata"*, so a DOMAIN conflict was treated as a USERNAME conflict → 3 wasted `createacct` retries (new
   username can't fix a domain conflict).
3. **No userdata self-heal** in the primary provisioning path (addon-flow / change-primary / reseller-hosting-mgmt all
   had it; the main hosting purchase did not).

## Fix (code in repo — deploy via Save to GitHub)
- **(A)** `cr-register-domain-&-create-cpanel.js` pre-flight guard now matches `$or:[{domain},{addonDomains}]`. When the
  requested domain is an addon on an existing (active/suspended) plan it **blocks before createAccount / before any
  charge** with an actionable message (same-owner → "it's part of your plan for <primary>; unlink it first via My
  Hosting Plans → Unlink a Domain"; other-owner → generic "contact support"). Returns `{addonConflict:true}`.
- **(B)** `whm-service.isRetryableError` now explicitly returns `false` for "already exists in the userdata" / "the
  domain X already exists" (username conflicts like "reserved username", "username already exists", "account already
  exists" still retry). Exported for tests.
- **(C)** `cr-register-domain-&-create-cpanel.js` provisioning path now runs `whm-userdata-heal.attemptUserdataRelease`
  (same-owner only, DELETED stale rows) on a userdata-conflict error, then retries `createAccount` once — defense in
  depth for the Mongo-deleted / WHM-not-removed class.

## Tests
`js/tests/test_hosting_addon_userdata_conflict.js` — 19/19 PASS (isRetryableError matrix + static wiring guards for A & C).
Pre-existing unrelated staleness in `test_whm_userdata_heal.js` (1 regex guard expects old raw `setInterval`; scheduler
now uses `activeSlot.singletonInterval` — not touched here).

## Customer state (verified read-only)
`@smsbeast_real` manually cancelled the old `eliteescapesau.com` plan at 23:43:19, which removed account `elitda5b` from
WHM. `whm.domainExists()` now returns `{exists:false}` for BOTH `luxelitecasinoreviews.com` and `eliteescapesau.com` →
**user is already unblocked and can re-purchase hosting for either domain right now.** Wallet $28.58 intact.

## Follow-up (optional, not done)
Move the addon-conflict check EARLIER (domain-selection step in `_index.js`), pre-payment, so the user never deposits
before being told to unlink — current fix blocks at provisioning (post-deposit) but no order charge occurs and the
deposit stays as usable wallet balance.
