/**
 * Regression test — @HHR2009 (chatId 1960615421, cpUser nnliae74)
 * 2026-08-26 final architecture: WHM impersonation-session upload.
 *
 * BACKSTORY (three fix iterations landed on the same day):
 *   1. 22:37Z — 401/403 CPANEL_AUTH_FAILURE classifier + WHM-root
 *      impersonation fallback for list_files/mkdir/extract. That fix
 *      shipped to Railway and worked for GET-query ops but not for
 *      multipart upload (WHM /json-api/cpanel gateway silently drops
 *      multipart bodies — "You must specify at least one file to upload").
 *   2. 23:34Z — attempted cpPass rotation via WHM /passwd + retry the
 *      original user-level UAPI. WHM /passwd itself succeeded ("Password
 *      changed for user nnliae74") but cpsrvd was STILL rejecting the
 *      fresh password with 401 login-page HTML — this account is stuck in
 *      a cpsrvd security-policy state that denies Basic Auth *regardless
 *      of the password*.
 *   3. 23:45Z — WHM impersonation session (create_user_session + cpsession
 *      cookie → /execute/Fileman/upload_files on CPANEL_API_URL tunnel).
 *      Live-tested end-to-end against nnliae74 — 18/18 upload+list+mkdir
 *      +extract+delete pass. This is the FINAL architecture.
 *
 * The cpPass rotation from iteration 2 is retired but the function is
 * kept in-place for anyone poking around the code. Upload flow no longer
 * calls it.
 */
'use strict'

const path = require('path')
const fs = require('fs')

const routesSrc = fs.readFileSync(path.resolve(__dirname, '..', 'cpanel-routes.js'), 'utf8')
const proxySrc  = fs.readFileSync(path.resolve(__dirname, '..', 'cpanel-proxy.js'), 'utf8')

let passed = 0, failed = 0
function check(name, cond, detail = '') {
  if (cond) { console.log(`  ✅ ${name}`); passed++ }
  else { console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`); failed++ }
}

// ─── 1. uploadFileViaSession helper is defined and shaped correctly ─────
console.log('\n[1] uploadFileViaSession helper exists and is well-structured')
check('function defined', /async function uploadFileViaSession/.test(proxySrc))
check('takes (cpUser, dir, fileName, fileBuffer, whmHost) params', /async function uploadFileViaSession\(cpUser, dir, fileName, fileBuffer, whmHost\)/.test(proxySrc))
check('exported from module', /uploadFileViaSession,/.test(proxySrc))

// ─── 2. WHM create_user_session call shape ───────────────────────────────
console.log('\n[2] WHM /create_user_session call shape')
check('endpoint is /create_user_session', /\/create_user_session/.test(proxySrc))
check('passes user + service=cpaneld', /user:\s*cpUser[\s\S]{0,80}service:\s*'cpaneld'/.test(proxySrc))
check('authorizes with WHM root token', /Authorization:\s*`whm\s+\$\{process\.env\.WHM_USERNAME\s*\|\|\s*'root'\}:\$\{whmToken\}`/.test(proxySrc))
check('checks metadata.result === 1', /sess\.data\?\.metadata\?\.result !== 1/.test(proxySrc))
check('extracts cp_security_token + session from sess.data.data', /cpsess\s*=\s*sessInfo\.cp_security_token[\s\S]{0,80}sessionToken\s*=\s*sessInfo\.session/.test(proxySrc))

// ─── 3. Login step captures cpsession cookie correctly ───────────────────
console.log('\n[3] Login step captures cpsession cookie')
check('uses CPANEL_API_URL as tunnel base (NOT WHM_API_URL)', /cpanelApiUrl = process\.env\.CPANEL_API_URL/.test(proxySrc))
check('checks whmHost matches process.env.WHM_HOST before using tunnel', /whmHost === process\.env\.WHM_HOST/.test(proxySrc))
check('loginUrl = tunnelBase + cpsess + /login/?session=...', /\/login\/\?session=\$\{encodeURIComponent\(sessionToken\)\}/.test(proxySrc))
check('login uses maxRedirects:0 to capture the real cpsession cookie', /maxRedirects:\s*0/.test(proxySrc))
check('extracts cpsession cookie from set-cookie header via regex', /c\.match\(\/cpsession=\(\[\^;\]\+\)\/\)/.test(proxySrc))
check('returns session-cookie-missing via tag if no cpsession found', /via:\s*'session-cookie-missing'/.test(proxySrc))

// ─── 4. Upload step ──────────────────────────────────────────────────────
console.log('\n[4] Upload step uses multipart POST via cpsess path')
check('uploadUrl = tunnelBase + cpsess + /execute/Fileman/upload_files', /\$\{cpsess\}\/execute\/Fileman\/upload_files/.test(proxySrc))
check('sends Cookie header: cpsession=<value>', /Cookie:\s*`cpsession=\$\{cpsessionCookie\}`/.test(proxySrc))
check('form field is "file-1" (cPanel Fileman convention)', /form\.append\('file-1'/.test(proxySrc))
check('form field is "dir" (cPanel Fileman convention)', /form\.append\('dir', dir\)/.test(proxySrc))
check('120s timeout for large uploads', /timeout:\s*120000/.test(proxySrc))

// ─── 5. Return-shape ─────────────────────────────────────────────────────
console.log('\n[5] Normalized return shape')
check('success returns {status:1, via:"whm-session"}', /via:\s*'whm-session'/.test(proxySrc))
check('rejection returns via:session-upload-rejected', /via:\s*'session-upload-rejected'/.test(proxySrc))
check('HTTP failure returns via:session-upload-failed', /via:\s*'session-upload-failed'/.test(proxySrc))
check('exception returns via:session-exception', /via:\s*'session-exception'/.test(proxySrc))
check('config missing returns via:session-unavailable', /via:\s*'session-unavailable'/.test(proxySrc))

// ─── 6. Route wiring ─────────────────────────────────────────────────────
console.log('\n[6] Upload paths wired to uploadFileViaSession')
check('single-shot /files/upload gates on _isAuthBroken', /_isAuthBroken\(result\)[\s\S]{0,400}uploadFileViaSession/.test(routesSrc))
check('single-shot calls cpProxy.uploadFileViaSession(...)', /const sessResult = await cpProxy\.uploadFileViaSession\(req\.cpUser, dir, uploadName/.test(routesSrc))
check('chunked /files/upload-chunk gates on _isAuthBroken', /Chunk upload user-level auth-broken[\s\S]{0,400}uploadFileViaSession/.test(routesSrc))
check('chunked calls cpProxy.uploadFileViaSession(...) with assembled buffer', /cpProxy\.uploadFileViaSession\(req\.cpUser, dir, saveName, assembled/.test(routesSrc))
check('routes log "WHM session fallback" reason tag for ops audit', /WHM session fallback/.test(routesSrc))
check('no upload path calls _repairCpPass any more (superseded)', !/Upload user-level auth-broken[\s\S]{0,600}_repairCpPass/.test(routesSrc) && !/Chunk upload user-level auth-broken[\s\S]{0,600}_repairCpPass/.test(routesSrc))

// ─── 7. uploadFile detects HTTP-200 login-page HTML ──────────────────────
console.log('\n[7] uploadFile catches HTTP-200 login-page HTML (not just 401)')
check('detects <!DOCTYPE html> or <title>cPanel Login</title>', /<title>cPanel Login<\\\/title>\|<!DOCTYPE html>/.test(proxySrc))
check('tags such responses as CPANEL_AUTH_FAILURE so route triggers session fallback', /login-page HTML — treating as auth failure[\s\S]{0,300}code:\s*'CPANEL_AUTH_FAILURE'/.test(proxySrc))

// ─── 8. _verifyDeleted false-positive fix ────────────────────────────────
console.log('\n[8] deleteFile false-positive fix (no promotion of status:0 → status:1)')
check('_verifyDeleted returns null when listing status !== 1', /listing\.status !== 1[\s\S]{0,80}return null/.test(proxySrc))
check('_verifyDeleted returns null when listing.data is not an array', /!Array\.isArray\(listing\.data\)[\s\S]{0,20}return null/.test(proxySrc))
check('deleteFile only promotes result → status:1 if result.status was already 1', /gone === true && result\?\.status === 1/.test(proxySrc))

// ─── 9. Backward-compat: _repairCpPass still defined but not called ──────
console.log('\n[9] _repairCpPass still defined (legacy) but no upload path calls it')
check('_repairCpPass helper still defined', /async function _repairCpPass/.test(routesSrc))
check('no route currently calls _repairCpPass', !/await\s+_repairCpPass\(/.test(routesSrc))

// ─── 10. Env prerequisites ───────────────────────────────────────────────
console.log('\n[10] Env prerequisites for the session fallback path')
require('dotenv').config({ path: path.resolve(__dirname, '..', '..', 'backend', '.env') })
check('WHM_TOKEN present', !!process.env.WHM_TOKEN)
check('WHM_HOST present', !!process.env.WHM_HOST)
check('WHM_API_URL present (WHM :2087 tunnel)', !!process.env.WHM_API_URL)
check('CPANEL_API_URL present (cPanel :2083 tunnel — cpsess+/execute path)', !!process.env.CPANEL_API_URL)

console.log(`\n──────────────────────────────────────────────`)
console.log(`  ${passed} passed, ${failed} failed`)
console.log(`──────────────────────────────────────────────`)
if (failed > 0) process.exit(1)
process.exit(0)
