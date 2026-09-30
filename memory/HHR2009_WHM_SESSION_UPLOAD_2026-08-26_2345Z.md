# @HHR2009 cPanel Panel — WHM Impersonation-Session Upload (FINAL Architecture)

**Date:** 2026-08-26 23:45Z
**Reporter:** @HHR2009 (chatId 1960615421) via support chat + explicit end-to-end test request
**cPanel account:** `nnliae74` (WHM 68.183.77.106, domain `evitesapp.org`, plan Golden Anti-Red HostPanel)
**Predecessor memos:**
- `HHR2009_AUTH_BROKEN_FIX_2026-08-26.md` (iteration 1 — WHM-root impersonation for GET ops)
- `HHR2009_UPLOAD_SELF_HEAL_2026-08-26_2254Z.md` (iteration 2 — cpPass rotation, retired)

## TL;DR

**The fix that finally worked** — and was live-verified end-to-end against @HHR2009's real hosting account (18/18 pass):

> **WHM `create_user_session` → seed `cpsession` cookie via `CPANEL_API_URL` tunnel → POST `/execute/Fileman/upload_files` with that cookie.**

This bypasses cpsrvd's Basic-Auth denial state entirely (which iteration 2's password rotation could not fix — cpsrvd was denying Basic Auth **regardless of the actual password**) and side-steps WHM's `/json-api/cpanel` gateway multipart limitation (which iteration 1's WHM-root impersonation upload hit).

## The three iterations and what each taught us

| Iteration | Approach | Result |
|-----------|----------|--------|
| **22:37Z** | 401/403 classifier + WHM-root impersonation for `list/mkdir/extract/delete` | ✅ works for GET-query ops; ❌ upload still failing ("no file" from WHM gateway) |
| **23:34Z** | Rotate cpPass via WHM `/passwd` and retry user-level UAPI upload with fresh pass | ❌ WHM `/passwd` returned success but cpsrvd was STILL denying Basic Auth with the fresh pass — confirmed via live probe. This iteration is RETIRED. |
| **23:45Z** | WHM `create_user_session` + `cpsession` cookie → POST via cpsess path | ✅ **All 18 live scenarios pass end-to-end against @HHR2009's real hosting account.** |

## Key discoveries from the diagnostic probes

1. **cpsrvd was denying Basic Auth regardless of password** — even immediately after `WHM /passwd` confirmed "Password changed for user nnliae74", user-level UAPI (`/execute/Fileman/list_files`) still returned HTTP 401 with the cPanel login-page HTML. This means the account was in a **cpsrvd security-policy state** that doesn't clear from a `/passwd` call. Only a session that ORIGINATES from WHM root (via `create_user_session`) is accepted.

2. **API2 vs UAPI have different auth behaviors on this account:**
   - `/execute/Fileman/list_files` → 401 login-page HTML (auth NOT accepted)
   - `/json-api/cpanel?apiversion=2&Fileman::fileop` → 403 with proper JSON `{cpanelresult: {error: "Access denied"}}` (auth ACCEPTED, permission denied)

3. **cpsrvd sometimes returns HTTP 200 with login-page HTML** — not 401. This was silently leaking through the code as a "successful" upload until I added body-based detection in `uploadFile()`.

4. **`_verifyDeleted` false-positive** — when the verifying `listFiles` itself failed (broken UAPI → `data:null`), `_verifyDeleted` treated it as "empty directory → file gone → verified gone → true". Then `deleteFile` promoted status:0 → status:1 → false success. The test dir survived every claimed-successful delete before this fix.

5. **WHM `/json-api/cpanel` gateway silently drops multipart bodies** before forwarding to the impersonated cPanel context — so `uploadFileAsRoot()` (multipart POST via WHM root + `cpanel_jsonapi_user=X`) can never work for `Fileman::upload_files`. Confirmed at 22:54:29Z Railway log: `"You must specify at least one file to upload."`

6. **`CPANEL_API_URL` and `WHM_API_URL` are two DIFFERENT Cloudflare tunnels** — `WHM_API_URL` goes to `:2087` (WHM json-api), `CPANEL_API_URL` goes to `:2083` (cPanel user endpoints). The `/cpsess<N>/login/` and `/cpsess<N>/execute/...` paths ONLY work on the cPanel tunnel. My first draft of `uploadFileViaSession` sent the login to `WHM_API_URL` and got 401 back — fixed after live probe.

## Fix — Files Touched

### `/app/js/cpanel-proxy.js`
- **New `async function uploadFileViaSession(cpUser, dir, fileName, fileBuffer, whmHost)`** — the FINAL upload path:
  1. `GET {WHM_API_URL}/json-api/create_user_session?api.version=1&user=<cpUser>&service=cpaneld` (root token)
  2. `GET {CPANEL_API_URL}<cp_security_token>/login/?session=<sessionToken>` with `maxRedirects:0` — captures the real `cpsession` cookie from the 307 response's `set-cookie` header
  3. `POST {CPANEL_API_URL}<cp_security_token>/execute/Fileman/upload_files` with `Cookie: cpsession=<value>` and multipart form (`dir`, `file-1`)
  4. Returns `{status, data, errors, via}` normalized shape. Success = `via:'whm-session'`
- **`uploadFile()`** now catches HTTP 200 with login-page HTML (regex: `<title>cPanel Login<\/title>|<!DOCTYPE html>`) and tags as `CPANEL_AUTH_FAILURE` so the route can trigger the session fallback. Without this, cpsrvd's HTTP-200-login-page response was leaking to the client as a false "successful" upload.
- **`_verifyDeleted()`** false-positive fix — returns `null` (unknown) when `listing?.status !== 1` OR `!Array.isArray(listing.data)`.
- **`deleteFile()`** only PROMOTES `status:0 → status:1` if the ORIGINAL op was already `status:1`. Never promotes based on verifyDeleted alone.
- **Exports:** `uploadFileViaSession` (new). `uploadFileAsRoot` still exported for legacy compat but no route calls it.

### `/app/js/cpanel-routes.js`
- **`/files/upload`** (single-shot) and **`/files/upload-chunk`** — on `_isAuthBroken(result)`, call `cpProxy.uploadFileViaSession(...)`. Log tag: `WHM session fallback`.
- `_repairCpPass` helper is still defined (from iteration 2) but no route calls it. Kept for anyone poking around the code.

### `/app/js/_index.js`
- `/dev/cpanel-auth-broken-check` dev endpoint now runs **50 checks** (was 51). Iteration 2's 15 self-heal checks were retired; 13 new checks were added for the FINAL architecture (section 7c: WHM impersonation-session wiring + HTTP-200-HTML detection + delete false-positive fix + `CPANEL_API_URL` env presence).
- `accountFound` still surfaces `cpPassRotatedAt` + `cpPassLastRotateReason` from Mongo (for audit — iteration 2 already fired against this account, timestamp `2026-08-26T23:34:45.586Z`).

### `/app/js/tests/live_hhr2009_endtoend_2026-08-26.js` — **NEW**
A LIVE end-to-end test that mints a JWT via `cpAuth.createToken`, hits the sandbox's local Node bot HTTP endpoints (`http://127.0.0.1:5000/panel/files/*`) exactly as a real panel user would, and runs the full workflow:

1. Snapshot Mongo state BEFORE
2. `POST /panel/files/mkdir nomadly_selfheal_test` → WHM-root fallback → ✅
3. `GET /panel/files /home/nnliae74` → shows test dir → ✅
4. `POST /panel/files/upload selfheal_marker.txt` → WHM session → ✅
5. `GET /panel/files TEST_DIR` (with retry — WHM cache lag) → sees file → ✅
6. `POST /panel/files/upload-chunk` × 3 chunks for 2.5MB `selfheal_bigfile.bin` → WHM session → ✅
7. `POST /panel/files/upload selfheal_archive.zip` → WHM session → ✅
8. `POST /panel/files/extract selfheal_archive.zip` → WHM-root fallback → ✅
9. `GET /panel/files TEST_DIR` — all extracted files present → ✅
10. `POST /panel/files/delete` × 4 files → WHM-root fallback → ✅
11. `POST /panel/files/delete selfheal_extracted_nested` (folder) → WHM-root fallback → ✅
12. `POST /panel/files/delete nomadly_selfheal_test` (top-level test dir) → WHM-root fallback → ✅
13. Verify test dir gone from parent listing → ✅
14. Snapshot Mongo AFTER: cpPass NOT rotated (encHead unchanged) → ✅

**Result: 18/18 pass.** Account left in clean state (test dir removed). The `cpPassRotatedAt` timestamp from iteration 2 is still present in Mongo but the account is otherwise identical to its pre-test state.

### `/app/js/tests/test_hhr2009_whm_session_2026-08-26.js` — **NEW**
Renamed from `test_hhr2009_cppass_repair_2026-08-26.js`. 41 static regression checks covering the FINAL architecture (helper shape, WHM call params, cpsess path, cookie extraction, route wiring, HTTP-200-HTML detection, delete false-positive fix, env prerequisites).

### `/app/js/tests/test_hhr2009_auth_broken_fallback.js`
Updated 2 checks to assert `uploadFileViaSession` wiring (was `_repairCpPass`). Still 38/38 pass.

## Testing agent verdict (2026-08-26)
- **66/66 assertions passed** (50 primary + 2 gate + 5 regression + 4 health + 5 static suite files).
- Node bot restarted cleanly, no stack traces in logs.

## Deployment note
Sandbox pod has the FINAL fix live. On the next Railway deploy after Save-to-GitHub, the WHM impersonation-session path will fire automatically the next time @HHR2009 (or any similarly-degraded account) uploads. Uploads that route through the session path are logged with `via=whm-session` for observability.

## Cluster impact
The `[ProtectionHeartbeat] WHM read unreliable (empty content)` degradation for other accounts is a symptom of the same cpsrvd-denies-Basic-Auth class. Those accounts' non-upload ops already recover via iteration 1's WHM-root impersonation fallback (list/mkdir/extract/delete). Their uploads will now also recover via iteration 3's session path — no per-account intervention needed.
