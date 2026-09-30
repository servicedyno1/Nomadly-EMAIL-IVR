/**
 * Regression test — @HHR2009 (chatId 1960615421, cpUser nnliae74)
 * 2026-08-26 "Create folder failed: Access denied" / upload 401 fix.
 *
 * Repro (from Railway logs, deploy 610e7543):
 *   [cPanel Proxy API2] Fileman::mkdir error (403): Access denied      ×3
 *   [cPanel Proxy] Fileman::upload_files error: Request failed with status code 401
 *   [cPanel Proxy] Fileman::list_files error (401): <!DOCTYPE html>    (login page)
 *   [ProtectionHeartbeat] nnliae74 — WHM read unreliable (empty content) — hourly since 2026-08-24
 *
 * Root cause: nnliae74's cached cpPass in Mongo no longer matches the actual
 * cPanel account password on WHM 68.183.77.106. All user-level HTTP Basic
 * Auth calls fail (401 UAPI / 403 API2). Existing WHM-root fallback in
 * mkdir/list_files/extract only tripped on `httpStatus >= 500` or EPERM
 * strings — never on 401/403 — so the raw "Access denied" leaked to the UI.
 *
 * Fix: treat 401/403 (and body "Access denied") as user-auth-broken →
 * trigger WHM-root fallback ladder (root creds + `cpanel_jsonapi_user=X`
 * impersonation). Also added `uploadFileAsRoot()` for multipart uploads.
 */
'use strict'

const assert = require('assert')
const path = require('path')
const fs = require('fs')

const cp = require(path.resolve(__dirname, '..', 'cpanel-proxy.js'))
const routesSrc = fs.readFileSync(path.resolve(__dirname, '..', 'cpanel-routes.js'), 'utf8')

let passed = 0, failed = 0
function check(name, cond) {
  if (cond) { console.log(`  ✅ ${name}`); passed++ }
  else { console.log(`  ❌ ${name}`); failed++ }
}

// ─── 1. looksLikeAuthFailure classifies 401/403 correctly ───────────────
console.log('\n[1] looksLikeAuthFailure classifies WHM user-auth breaks')
check('401 → true', cp.looksLikeAuthFailure(401, 'anything') === true)
check('403 → true', cp.looksLikeAuthFailure(403, 'anything') === true)
check('403 with "Access denied" body → true', cp.looksLikeAuthFailure(403, 'Access denied') === true)
check('body "Access denied" (no status) → true', cp.looksLikeAuthFailure(null, 'Access denied') === true)
check('body "access denied" case-insensitive → true', cp.looksLikeAuthFailure(null, 'access denied') === true)
check('axios generic 401 message → true', cp.looksLikeAuthFailure(null, 'Request failed with status code 401') === true)
check('axios generic 403 message → true', cp.looksLikeAuthFailure(null, 'Request failed with status code 403') === true)
check('500 → false (not auth, that\'s server/EPERM class)', cp.looksLikeAuthFailure(500, 'oops') === false)
check('404 → false', cp.looksLikeAuthFailure(404, 'not found') === false)
check('null/empty → false', cp.looksLikeAuthFailure(null, '') === false)
check('legit "already exists" mkdir failure → false', cp.looksLikeAuthFailure(null, 'File exists') === false)

// ─── 2. EPERM and AUTH are mutually exclusive & non-overlapping ─────────
console.log('\n[2] EPERM vs AUTH classifier don\'t collide')
check('"permission denied" is EPERM, not AUTH', cp.looksLikeUapiPermFailure('permission denied') === true && cp.looksLikeAuthFailure(null, 'permission denied') === false)
check('"Access denied" is AUTH, not EPERM', cp.looksLikeUapiPermFailure('Access denied') === false && cp.looksLikeAuthFailure(null, 'Access denied') === true)
check('401 is AUTH, not EPERM', cp.looksLikeAuthFailure(401, '') === true && cp.looksLikeUapiPermFailure('') === false)

// ─── 3. uploadFileAsRoot helper is exported ─────────────────────────────
console.log('\n[3] WHM-root multipart upload helper is wired')
check('uploadFileAsRoot exported', typeof cp.uploadFileAsRoot === 'function')
check('looksLikeAuthFailure exported', typeof cp.looksLikeAuthFailure === 'function')

// ─── 4. cpanel-routes.js has the auth-broken detector + wiring ──────────
console.log('\n[4] cpanel-routes.js wires WHM-root fallback for 401/403')
check('_isAuthBroken helper defined', /function _isAuthBroken/.test(routesSrc))
check('_isAuthBroken checks CPANEL_AUTH_FAILURE code', /result\.code === 'CPANEL_AUTH_FAILURE'/.test(routesSrc))
check('_isAuthBroken checks httpStatus 401/403', /result\.httpStatus === 401 \|\| result\.httpStatus === 403/.test(routesSrc))
check('mkdir looksBroken includes authBroken', /const authBroken = _isAuthBroken\(result\)[\s\S]{0,50}const looksBroken =[\s\S]{0,20}authBroken/.test(routesSrc))
check('list_files looksBroken includes authBrokenList', /const authBrokenList = _isAuthBroken\(result\)[\s\S]{0,80}looksBroken = authBrokenList/.test(routesSrc))
check('extract looksBroken includes authBrokenExt', /const authBrokenExt = _isAuthBroken\(result\)[\s\S]{0,80}looksBroken = authBrokenExt/.test(routesSrc))
check('single upload wired to uploadFileViaSession on auth-broken', /_isAuthBroken\(result\)[\s\S]{0,600}cpProxy\.uploadFileViaSession/.test(routesSrc))
check('chunk upload wired to uploadFileViaSession on auth-broken', /Chunk upload user-level auth-broken[\s\S]{0,600}uploadFileViaSession/.test(routesSrc))

// ─── 5. api2 error path tags CPANEL_AUTH_FAILURE — simulate via 403 ─────
console.log('\n[5] api2 return shape correctly tags AUTH failures')
// Simulate what api2() would return given a 403 with "Access denied" body:
// We check the classification logic directly since we can't run the whole api2 fn without axios.
const scenarios = [
  { desc: '403 Access denied (mkdir @HHR2009)', status: 403, msg: 'Access denied', expectedCode: 'CPANEL_AUTH_FAILURE' },
  { desc: '401 login-page HTML (list_files @HHR2009)', status: 401, msg: '<!DOCTYPE html>', expectedCode: 'CPANEL_AUTH_FAILURE' },
  { desc: '500 EPERM (@hellpeaces)', status: 500, msg: '"/usr/local/cpanel/uapi" exited with status 1 (EPERM)', expectedCode: 'CPANEL_UAPI_EPERM' },
  { desc: '404 File exists (mkdir legit error)', status: 404, msg: 'File exists', expectedCode: undefined },
]
for (const s of scenarios) {
  const eperm = cp.looksLikeUapiPermFailure(s.msg)
  const authFail = !eperm && cp.looksLikeAuthFailure(s.status, s.msg)
  const actualCode = eperm ? 'CPANEL_UAPI_EPERM' : (authFail ? 'CPANEL_AUTH_FAILURE' : undefined)
  check(`${s.desc} → code=${s.expectedCode || 'undefined'}`, actualCode === s.expectedCode)
}

// ─── 6. mkdir route source references the @HHR2009 fix anchor ───────────
console.log('\n[6] Route source references the fix\'s user-facing anchor')
check('mkdir has 2026-08-26 @HHR2009 comment', /2026-08-26 @HHR2009/.test(routesSrc))
check('mkdir mentions stale cpPass / cPanel session', /stale cpPass|cPanel session/i.test(routesSrc))
check('mkdir logs "user-auth-broken" reason tag', /user-auth-broken/.test(routesSrc))
check('_isAuthBroken helper is called from mkdir/list_files/extract', (routesSrc.match(/_isAuthBroken\(/g) || []).length >= 4)

// ─── 7. Backward compat — legitimate EPERM path still works ─────────────
console.log('\n[7] EPERM handling is untouched (regression safety)')
check('_isEpermReason still defined', /function _isEpermReason/.test(routesSrc))
check('_replyEperm still defined', /function _replyEperm/.test(routesSrc))
check('CPANEL_UAPI_EPERM still referenced in mkdir', /CPANEL_UAPI_EPERM/.test(routesSrc))

// ─── 8. api2 return shape emits httpStatus so router can inspect ─────────
console.log('\n[8] cpanel-proxy.js api2/uapi/uploadFile expose httpStatus + code')
const proxySrc = fs.readFileSync(path.resolve(__dirname, '..', 'cpanel-proxy.js'), 'utf8')
check('api2 sets code=CPANEL_AUTH_FAILURE when authFail', /authFail\s*=\s*!eperm\s*&&\s*looksLikeAuthFailure[\s\S]{0,400}code:\s*eperm\s*\?\s*'CPANEL_UAPI_EPERM'\s*:\s*\(authFail\s*\?\s*'CPANEL_AUTH_FAILURE'/.test(proxySrc))
check('uapi sets code=CPANEL_AUTH_FAILURE when authFail', (proxySrc.match(/code:\s*eperm\s*\?\s*'CPANEL_UAPI_EPERM'\s*:\s*\(authFail\s*\?\s*'CPANEL_AUTH_FAILURE'/g) || []).length >= 2)
check('uploadFile propagates httpStatus + CPANEL_AUTH_FAILURE code', /Fileman::upload_files error[\s\S]{0,300}httpStatus:\s*status\s*\|\|\s*null,\s*code:\s*authFail\s*\?\s*'CPANEL_AUTH_FAILURE'/.test(proxySrc))

console.log(`\n──────────────────────────────────────────────`)
console.log(`  ${passed} passed, ${failed} failed`)
console.log(`──────────────────────────────────────────────`)
if (failed > 0) process.exit(1)
process.exit(0)
