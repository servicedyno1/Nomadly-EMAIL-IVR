# @HHR2009 cPanel Upload 401 — Self-Heal via cpPass Rotation (Follow-up)

**Date:** 2026-08-26 22:54Z
**Reporter:** @HHR2009 (chatId 1960615421) via support chat
**cPanel account:** `nnliae74` (WHM 68.183.77.106, domain `evitesapp.org`)
**Predecessor:** `HHR2009_AUTH_BROKEN_FIX_2026-08-26.md` (earlier the same day)

## TL;DR

Earlier today the initial fix (401/403 → WHM-root impersonation fallback) shipped to Railway at 22:37Z (deploy `3719705c`). **list_files, delete, mkdir, and extract now all work for @HHR2009** via WHM-root impersonation — confirmed via Railway logs:

```
22:53:56  [Panel] list_files succeeded via WHM fallback (8 entries)   ✅
22:54:06  [Panel] Deleted file: Evite_Guest_Access.zip                ✅
```

**But upload_files still failed** because WHM's `/json-api/cpanel` gateway silently drops multipart bodies before forwarding to the impersonated cPanel context. `cpProxy.uploadFileAsRoot()` (multipart POST via WHM impersonation) can therefore never work for `Fileman::upload_files`:

```
22:54:27  [cPanel Proxy] Fileman::upload_files error (401): ... [AUTH]
22:54:27  [Panel] Chunk upload user-level auth-broken (401) → WHM-root fallback
22:54:29  [Panel] Chunk upload WHM-root fallback failed:
          setup_Unassigned.msi — "You must specify at least one file to upload."
```

## Fix — self-heal the underlying stale cpPass

Instead of trying to work around WHM's gateway limitation, **rotate the user's cPanel password via WHM `/passwd` (root token) and retry the ORIGINAL user-level UAPI upload with the fresh pass.** Same code path as a normal upload — no gateway multipart surface at all.

### `_repairCpPass(getCpanelCol, cpUser, whmHost)` — new helper in `cpanel-routes.js`
- **Cool-down**: 60-min guard via `doc.cpPassRotatedAt` to prevent churn on transient WHM blips (cPHulk / ModSecurity 5-min lockouts). If inside cool-down, returns the currently cached cpPass with `rotated:false, reason:"cool-down (Xm left)"`.
- **Password**: 24-char `[A-Za-z0-9]` from `crypto.randomBytes(32)` — 143 bits entropy, URL-safe (no special-char encoding quirks at WHM).
- **WHM call**: `GET /json-api/passwd?api.version=1&user=<cpUser>&password=<new>&db_pass_update=0`.
  - `db_pass_update:0` is critical: rotating bound MySQL passwords would break the customer's live site (their app config still points at the old MySQL pass).
- **Mongo persistence**: `cpAuth.encrypt(newPass)` (same AES-GCM used by `storeCredentials`) → `cpPass_encrypted/iv/tag` + audit stamps:
  - `cpPassRotatedAt: new Date()`
  - `cpPassLastRotateReason: 'CPANEL_AUTH_FAILURE'`
- **Return shape**: `{ ok, cpPass, rotated?, reason?, error? }`.

### `/files/upload` (single-shot) — rewired
On `_isAuthBroken(result)` (401/403 or `code:'CPANEL_AUTH_FAILURE'`):
1. Call `_repairCpPass(getCpanelCol, req.cpUser, req.whmHost)`.
2. If `ok:true`, retry `cpProxy.uploadFile(req.cpUser, repair.cpPass, ...)`.
3. On success, set `req.cpPass = repair.cpPass` so any subsequent op in the same request reuses the new pass.
4. On failure, respond with `via: 'cppass-repair-failed'` or `'cppass-repaired-retry-failed'` for ops observability.

### `/files/upload-chunk` — same wiring
Same shape at line ~836 in `cpanel-routes.js`.

### `uploadFileAsRoot` in `cpanel-proxy.js`
**Still exported** (legacy compat) but **NO LONGER wired into the upload flow**. Kept because it might be useful for a future op where multipart-body isn't required (e.g., if we ever need to bypass user auth for a metadata-only op). Comments in the callers explain the gateway limitation.

## Test coverage

- **`/api/dev/cpanel-auth-broken-check`** expanded from 36 → 51 checks (added section 7b covering all 15 self-heal wiring assertions).
- **`/app/js/tests/test_hhr2009_cppass_repair_2026-08-26.js`** — new local regression, 39/39 pass.
- **`/app/js/tests/test_hhr2009_auth_broken_fallback.js`** — updated 2 checks (uploadFileAsRoot → `_repairCpPass`), still 38/38 pass.
- **Testing agent verdict** (2026-08-26): 62/62 assertions (51 primary + 2 gate + 5 regression + 4 health). No stack traces after node bot restart.

## Deployment note

Sandbox already has this fix live. **On the next Railway deploy after Save-to-GitHub, the self-heal will fire automatically the next time @HHR2009 uploads — one rotation restores upload for good** (until something else desyncs the pass again, which the 60-min cool-down + logs will catch cleanly).

## Cluster impact

Every account whose ProtectionHeartbeat has been logging `WHM read unreliable (empty content after 3 retries)` is a stale-cpPass victim. Once the deploy is live and each of those accounts hits the upload flow, they'll self-heal one at a time. If we want to batch-heal them proactively, we can add a scheduler tick that walks accounts with `protectionLastSkipReason: /empty content/` and calls `_repairCpPass()` — but that's a follow-up. This fix is sufficient for on-demand repair.

## Files touched

- ✅ `/app/js/cpanel-routes.js` — new `_repairCpPass()` helper; `/files/upload` + `/files/upload-chunk` rewired to use it. `uploadFileAsRoot` no longer called from routes.
- ✅ `/app/js/_index.js` — `/dev/cpanel-auth-broken-check` expanded 36 → 51 checks; `accountFound` now surfaces `cpPassRotatedAt` + `cpPassLastRotateReason`.
- ✅ `/app/js/tests/test_hhr2009_cppass_repair_2026-08-26.js` — new regression (39/39).
- ✅ `/app/js/tests/test_hhr2009_auth_broken_fallback.js` — updated 2 checks.
- ✅ `/app/test_result.md` — new backend task; test_sequence bumped to 31.
- ✅ `/app/memory/HHR2009_UPLOAD_SELF_HEAL_2026-08-26_2254Z.md` — this file.
