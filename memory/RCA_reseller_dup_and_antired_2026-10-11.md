# RCA — reseller hosting "duplicate protection" + namewords.sbs "Verification failed" (2026-10-11)

Domain in all three: **namewords.sbs**, owner chatId **5590563715**.
Repo code == prod code (origin/main 8ba53f37 vs deployed 97dec6f differ only in `.emergent/emergent.yml`).

## 1) Dev reseller order (existing domain) — DID it work E2E?
- `nameaf15@namewords.sbs` created 2026-10-11 11:23:26, `provisionState:active`. Dev log shows full chain:
  WHM acct created → CF DNS (tunnel CNAME) → AutoSSL → anti-red worker deployed → creds email sent → OP NS updated → health-check scheduled. domain_mode=existing (no re-register).
- ⚠️ It only "succeeded" because the **dev pod's inner idempotency guard reads `MONGO_URL=mongodb://localhost:27017` (empty local DB)** while the reseller writes go to the Railway prod DB via `col()`. The guard was blind to the prod duplicate/stub → provisioning proceeded.
- ⚠️ Bigger issue: the dev reseller API is LIVE (`RESELLER_API_LIVE=true`, `RESELLER_DB_URL`→Railway). The "dev" order really provisioned a live WHM account + Cloudflare + anti-red on PRODUCTION infra and wrote `nameaf15=active` into the prod reseller DB.

## 2) Why the SIMILAR prod order failed (duplicate protection) in last 24h
- 2026-10-11 **07:29:13** prod app-main: `[Hosting] IDEMPOTENCY: cpanel already exists for *** (cpUser=undefined, chatId=5590563715) — aborting duplicate provisioning for reseller_a8c467dc…`
- Flow: `reseller-api.js` POST `/hosting` passes its OUTER dup check (line 1800: `provisionState:{$ne:'failed'}`), charges, then **inserts a placeholder stub** `cpanelAccounts {_id:<username>, domain, provisionState:'provisioning'}` (line 1829, non-deleted, no cpUser). Worker → `registerDomainAndCreateCpanel` → **INNER guard** (`cr-register-domain-&-create-cpanel.js` line 67):
  `findOne({ domain, deleted:{$ne:true} })` — **does NOT exclude `provisionState:'failed'` and does NOT exclude the order's own stub.**
- So the inner guard self-collided with the order's own `provisioning` stub (cpUser=undefined) → returned `duplicate_provisioning_prevented` → wallet refunded → stub `nameb2b2` left as `provisionState:failed`, **deleted NOT set**.
- **Permanent block:** the leftover non-deleted `failed` ghost `nameb2b2` is exactly what the inner guard matches now. Verified live: `findOne({domain:'namewords.sbs',deleted:{$ne:true}})` → `nameb2b2` (failed). Every future namewords.sbs reseller order is blocked + refunded ("a retry would be blocked the same way").
- Inconsistency with 10-05 (name65fb succeeded, name1d6a/name303c failed) = same self-stub / ghost race.

### Fix (Task 2) — inner guard in `cr-register-domain-&-create-cpanel.js`
Mirror the already-correct outer check + exclude the own stub:
```
findOne({ domain, deleted:{$ne:true}, provisionState:{$ne:'failed'},
          _id:{ $ne: info.customUsername || null } })
```
(+ in `reseller-api.js runHostingJob` failure path, mark the stub `deleted:true` so no ghost lingers.)
Once deployed, the `failed` ghost `nameb2b2` is auto-ignored → namewords.sbs unblocked (optional: set nameb2b2 deleted:true for hygiene).

## 3) Why namewords.sbs shows "Verification failed. Please use a standard browser."
- Anti-red shared Worker Step 7 serves the "Verifying your browser" challenge to any visitor without a valid `__ar_v` cookie. `challengePage()` client JS hard-fails at score **≥35** → shows "Verification failed…".
- Chrome-version ceiling is self-adjusting (estimatedStable≈157 now) — NOT the cause.
- Cause: client heuristics stack past 35 for legitimate-but-non-standard setups: Linux desktop +30, software WebGL (SwiftShader/llvmpipe, common on VM/RDP/accel-off) +30, empty `navigator.plugins` +15, `window.chrome` undefined +25, canvas-blocked +20. A real human on Linux/VM/RDP/privacy browser easily hits ≥35 → locked out with no recourse.
- Aggravator: the dev pod redeployed the shared worker at 11:23 with a fresh random `SECRET` → invalidated every existing `__ar_v` cookie, forcing all returning visitors back through the challenge; and `BACKEND_REPORT_URL` now points at the dev preview URL.

### Fix options (Task 3) — confirm with owner (security vs usability)
- Soften client weights (Linux/SwiftShader/plugins) and/or raise fail threshold; and/or give a human fallback ("click to continue") instead of a dead-end fail. Sensitive: affects the shared worker across all live anti-red domains.
