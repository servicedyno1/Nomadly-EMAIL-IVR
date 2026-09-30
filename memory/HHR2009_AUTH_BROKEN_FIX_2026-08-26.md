# @HHR2009 cPanel Panel "Create folder failed: Access denied" + upload 401 — Root Cause & Fix

**Date:** 2026-08-26
**Reporter:** @HHR2009 (chatId 1960615421) via support screenshot
**cPanel account:** `nnliae74` (WHM 68.183.77.106, Cloudflare tunnel `cpanel-api.hostbay.io`)
**Domain:** `evitesapp.org` — Golden Anti-Red HostPanel (1-Month), created 2026-08-07T19:42:14Z

## TL;DR

nnliae74's **cached cpPass in Mongo no longer matched** the actual cPanel account password on WHM. Every user-level HTTP Basic Auth call was rejected at the transport layer:
- UAPI `/execute/...` (list_files, upload_files) → **401** with HTML login page
- API2 `/json-api/cpanel` (mkdir) → **403 "Access denied"**

The existing WHM-root fallback ladder in `/files/mkdir`, `/files` (list_files), and `/files/extract` only tripped on `httpStatus >= 500` OR EPERM error strings — **never on 401/403** — so the raw "Access denied" leaked to the panel UI and the fallback (which uses root creds + `cpanel_jsonapi_user=X` impersonation and would have succeeded) was never tried.

## Symptoms (from Railway logs, deployment 610e7543)

```
2026-08-26T20:33:11Z  [cPanel Proxy API2] Fileman::mkdir error (403): Access denied
2026-08-26T21:26:49Z  [cPanel Proxy] Fileman::upload_files error: Request failed with status code 401
2026-08-26T21:42:15Z  [cPanel Proxy API2] Fileman::mkdir error (403): Access denied     ← screenshot
2026-08-26T21:44:16Z  [cPanel Proxy] Fileman::upload_files error: 401                    ← the "upload"
2026-08-26T21:45:19Z  [cPanel Proxy API2] Fileman::mkdir error (403): Access denied
```

Plus persistent silent degradation:
```
Every hour since 2026-08-24:
[ProtectionHeartbeat] nnliae74 — WHM read unreliable (empty content after 3 retries, no explicit errors).
lastCfIpFixSig present → SKIPPING this cycle
```
(Same root cause — the heartbeat's user-context WHM read was getting the login-page redirect but interpreting the empty body as "unreliable" and skipping.)

## Why the classifier missed 401/403

`cpanel-proxy.js: looksLikeUapiPermFailure` regex was `/uapi.*(EPERM|status\s*1)|EPERM|permission denied|not permitted/i` — matches lowercase "permission denied" but **not** the capitalized "Access denied" that cPanel returns for auth failures. So on 403 Access denied:
- `result.code === 'CPANEL_UAPI_EPERM'` → false
- `result.httpStatus >= 500` → false (403 < 500)
- `looksLikeUapiPermFailure('Access denied')` → false

→ `looksBroken = false` → `whmApi = null` → fell through to `return res.json(result)` → the panel rendered `Create folder failed: Access denied`.

## Fix

### 1. `/app/js/cpanel-proxy.js`
- **New classifier `looksLikeAuthFailure(status, msg)`** — true for httpStatus 401/403, body "Access denied" (case-insensitive), or axios generic "Request failed with status code 40[13]".
- **`uapi()` + `api2()`** now tag response with `code: 'CPANEL_AUTH_FAILURE'` (mutually exclusive with the existing `CPANEL_UAPI_EPERM` tag) when auth-fail is detected.
- **`uploadFile()`** propagates `httpStatus` and `code: 'CPANEL_AUTH_FAILURE'`.
- **New `uploadFileAsRoot(cpUser, dir, fileName, buf, whmHost)`** — multipart POST to WHM `/json-api/cpanel` with `Authorization: whm root:WHM_TOKEN` + `cpanel_jsonapi_user=X&cpanel_jsonapi_apiversion=3&cpanel_jsonapi_module=Fileman&cpanel_jsonapi_func=upload_files`. Impersonates the user without needing their password.
- **Exports:** `looksLikeAuthFailure`, `uploadFileAsRoot`.

### 2. `/app/js/cpanel-routes.js`
- **New `_isAuthBroken(result)`** helper — true if `result.code === 'CPANEL_AUTH_FAILURE'` OR `httpStatus === 401/403` OR `cpProxy.looksLikeAuthFailure(status, first_error)` matches.
- **`/files/mkdir`**: `looksBroken` now includes `_isAuthBroken(result)` → trips WHM-root ladder on 401/403 too. Log line uses reason tag `user-auth-broken` for ops audit.
- **`/files` (list_files)**: same expansion.
- **`/files/extract`**: same expansion.
- **`/files/upload` (single-shot)**: after `cpProxy.uploadFile(...)`, if `_isAuthBroken(result)`, retries via `cpProxy.uploadFileAsRoot(...)`.
- **`/files/upload-chunk` (the path @HHR2009 hit)**: same WHM-root retry on auth-broken response.
- **`/files/delete`** was already unconditionally routing to WHM-root on any non-status:1 result, so it's automatically covered.

### 3. Verification
- **`/app/js/tests/test_hhr2009_auth_broken_fallback.js`** — 38 behavioral checks, all pass. Covers classifier truth-table, EPERM/AUTH mutual exclusion, exports, and route wiring greps.
- **`/app/js/_index.js`** — new READ-ONLY dev endpoint `GET /api/dev/cpanel-auth-broken-check?key=<first16chars(SESSION_SECRET)>` (404 in production, 403 without admin key). Runs 36 checks including classifier truth-table, exports, WHM_TOKEN/HOST/API_URL env presence, and a Mongo read of `cpanelAccounts.nnliae74` as an audit anchor.
- **Testing agent (2026-08-26)**: 47/47 assertions passed — 36 primary + 2 gate + 5 existing dev-endpoint regressions (eperm-preview, domain-payment-msg-test, vps-password-reveal-check, ai-support-health) + 4 health. No stack traces after node bot restart.

## Immediate remediation done in this session

The **code fix restores functionality without needing to reset nnliae74's cPanel password** — the WHM-root fallback uses root credentials + impersonation. Once deployed to Railway, @HHR2009 can create folders, upload files, list files, and extract archives normally. The `[ProtectionHeartbeat]` "empty content" degradation will also resolve because the heartbeat re-uses the same code paths and will now succeed via WHM-root.

## Deeper permanent remediation (NOT executed — pending user decision)

The root cause is a **stale cpPass in Mongo**. Options for a proper resync:
1. **Auto-heal on auth-broken**: When `_isAuthBroken(result)` fires, kick off a background job that resets the cPanel password via WHM `/passwd?user=<user>&pass=<new>&db_pass_update=1` and updates `cpanelAccounts.{cpPass_encrypted, cpPass_iv, cpPass_tag}` in Mongo. Would eliminate the WHM-root fallback tax and restore user's ability to log into cPanel directly. Risk: rotating passwords might surprise users who rely on their cPanel login for external tools.
2. **One-shot resync now**: Same as above but only for nnliae74 (and any other accounts currently in `[ProtectionHeartbeat] ... empty content` state — cluster scan of Railway logs would identify them). Non-invasive; run once.

## Files touched

- ✅ `/app/js/cpanel-proxy.js` — new classifier `looksLikeAuthFailure`, `code:'CPANEL_AUTH_FAILURE'` tagging in `uapi/api2/uploadFile`, new `uploadFileAsRoot()` helper, exports added
- ✅ `/app/js/cpanel-routes.js` — new `_isAuthBroken()` helper, `looksBroken` expanded in `/files/mkdir` + `/files` list_files + `/files/extract`, WHM-root fallback added to single + chunked upload
- ✅ `/app/js/_index.js` — new dev endpoint `/dev/cpanel-auth-broken-check` (404 in production, admin-key gated)
- ✅ `/app/js/tests/test_hhr2009_auth_broken_fallback.js` — new local regression (38 checks, all pass)
- ✅ `/app/test_result.md` — new backend task + agent_communication protocol; test_sequence bumped to 30
- ✅ `/app/memory/HHR2009_AUTH_BROKEN_FIX_2026-08-26.md` — this file

## Deployment note

Changes are on this sandbox pod. Railway production still runs the pre-fix code — user's next `Save to Github` + Railway redeploy will pick up the fix.
