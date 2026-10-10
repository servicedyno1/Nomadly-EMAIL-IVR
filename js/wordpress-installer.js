'use strict'
// One-click WordPress installer (HostPanel "Apps" tab + reseller API POST /hosting/:user/apps).
// No shell / no WP Toolkit licence: creates a MySQL DB + user via cPanel UAPI, uploads + extracts the
// latest WordPress into the doc root, writes wp-config.php + the permalink .htaccess block, then runs
// wp_install() over HTTP through a one-time bootstrap PHP that is deleted right after.
// Everything the installer created is rolled back on failure. Dependency-injected (cp, antiRed, http).
const crypto = require('crypto')

const WP_ZIP_URL = process.env.WORDPRESS_ZIP_URL || 'https://wordpress.org/latest.zip'
const WP_SALT_URL = 'https://api.wordpress.org/secret-key/1.1/salt/'
// WordPress's own top-level entries (the archive nests everything under wordpress/).
const WP_CORE_ENTRIES = ['index.php', 'wp-activate.php', 'wp-blog-header.php', 'wp-comments-post.php', 'wp-config-sample.php', 'wp-cron.php', 'wp-links-opml.php', 'wp-load.php', 'wp-login.php', 'wp-mail.php', 'wp-settings.php', 'wp-signup.php', 'wp-trackback.php', 'xmlrpc.php', 'license.txt', 'readme.html', 'wp-admin', 'wp-content', 'wp-includes']
const CONFLICT_ENTRIES = new Set([...WP_CORE_ENTRIES.filter((n) => !['license.txt', 'readme.html'].includes(n)), 'wp-config.php'])
const PLACEHOLDER_INDEXES = ['index.html', 'index.htm']
// Same-origin XHR headers: the Anti-Red Worker passes these straight to origin (no challenge page).
const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  Accept: 'text/plain, */*', 'Accept-Language': 'en-US,en;q=0.9', 'Cache-Control': 'no-cache',
  'Sec-Fetch-Site': 'same-origin', 'Sec-Fetch-Mode': 'cors', 'Sec-Fetch-Dest': 'empty',
}

const rand = (n) => crypto.randomBytes(n).toString('hex').slice(0, n)
const b64 = (s) => Buffer.from(String(s), 'utf8').toString('base64')
const ok = (r) => !!r && (r.status === 1 || r.status === '1' || r.result === 1 || r.success === true)
const errOf = (r) => (r && (r.errors && r.errors[0])) || (r && r.error) || (r && r.reason) || 'cpanel_error'
const authFailed = (r) => !ok(r) && !!r && r.code === 'CPANEL_AUTH_FAILURE'

class InstallError extends Error {
  constructor(code, message) { super(message || code); this.code = code }
}

// A 24-char password with upper/lower/digit/symbol (WordPress admin + MySQL user). No quotes/backslashes.
function strongPassword() {
  const sets = ['ABCDEFGHJKMNPQRSTUVWXYZ', 'abcdefghijkmnpqrstuvwxyz', '23456789', '!@#%^*-_=+']
  const all = sets.join('')
  const pick = (s) => s[crypto.randomInt(s.length)]
  const out = sets.map(pick)
  for (let i = out.length; i < 24; i++) out.push(pick(all))
  for (let i = out.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1);[out[i], out[j]] = [out[j], out[i]] }
  return out.join('')
}

const newAppId = () => `wp_${rand(10)}`
const adminUsername = () => `admin_${rand(4)}`

// "" | "blog" | "blog/en" — trimmed, no leading/trailing slashes, public_html prefix stripped.
const normPath = (p) => String(p == null ? '' : p).trim().replace(/^\/+|\/+$/g, '').replace(/^public_html\/?/, '')

function docRootFor(cpUser, path) {
  const sub = normPath(path).replace(new RegExp(`^home/${cpUser}/(public_html/?)?`), '')
  const base = `/home/${cpUser}/public_html`
  return sub ? `${base}/${sub}` : base
}

function siteUrls(domain, path) {
  const sub = normPath(path)
  const base = `https://${domain}${sub ? '/' + sub : ''}`
  return { siteUrl: base, adminUrl: `${base}/wp-admin/` }
}

function wpConfig({ dbName, dbUser, dbPass, salts, tablePrefix = 'wp_' }) {
  return `<?php
define( 'DB_NAME', '${dbName}' );
define( 'DB_USER', '${dbUser}' );
define( 'DB_PASSWORD', '${dbPass}' );
define( 'DB_HOST', 'localhost' );
define( 'DB_CHARSET', 'utf8mb4' );
define( 'DB_COLLATE', '' );

${salts}

$table_prefix = '${tablePrefix}';

define( 'WP_DEBUG', false );
define( 'FS_METHOD', 'direct' );
define( 'DISALLOW_FILE_EDIT', true );

if ( ! defined( 'ABSPATH' ) ) {
\tdefine( 'ABSPATH', __DIR__ . '/' );
}
require_once ABSPATH . 'wp-settings.php';
`
}

// 8 unique salt/key defines (same format WordPress ships), used when api.wordpress.org is unreachable.
function generateSalts() {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()-_ []{}<>~`+=,.;:/?|'
  const line = (name) => { let s = ''; for (let i = 0; i < 64; i++) s += chars[crypto.randomInt(chars.length)]; return `define( '${name}', '${s}' );` }
  return ['AUTH_KEY', 'SECURE_AUTH_KEY', 'LOGGED_IN_KEY', 'NONCE_KEY', 'AUTH_SALT', 'SECURE_AUTH_SALT', 'LOGGED_IN_SALT', 'NONCE_SALT'].map(line).join('\n')
}

// WordPress permalink rules for a site at "/" or "/<sub>/".
function wpHtaccessBlock(path) {
  const sub = normPath(path)
  const base = sub ? `/${sub}/` : '/'
  return `# BEGIN WordPress
<IfModule mod_rewrite.c>
RewriteEngine On
RewriteRule .* - [E=HTTP_AUTHORIZATION:%{HTTP:Authorization}]
RewriteBase ${base}
RewriteRule ^index\\.php$ - [L]
RewriteCond %{REQUEST_FILENAME} !-f
RewriteCond %{REQUEST_FILENAME} !-d
RewriteRule . ${base}index.php [L]
</IfModule>
# END WordPress`
}

// Append the WordPress block (drops an auto SPA fallback, which would swallow WP routes). null = unchanged.
function withWordPressBlock(existing, path) {
  const cur = String(existing || '')
  if (/^# BEGIN WordPress/m.test(cur)) return null
  const cleaned = cur.replace(/\n?# BEGIN SPA Fallback \(auto\)[\s\S]*?# END SPA Fallback \(auto\)\n?/g, '\n').replace(/\s+$/, '')
  return `${cleaned ? cleaned + '\n\n' : ''}${wpHtaccessBlock(path)}\n`
}

// One-shot bootstrap running wp_install() (values base64-encoded → no quoting/injection).
function bootstrapPhp({ title, user, email, password }) {
  const d = (s) => `base64_decode('${b64(s)}')`
  return `<?php
error_reporting(0); @ini_set('display_errors','0');
define('WP_INSTALLING', true);
require __DIR__.'/wp-load.php';
require ABSPATH.'wp-admin/includes/upgrade.php';
if ( is_blog_installed() ) { echo 'WP_ALREADY_INSTALLED'; exit; }
$r = wp_install(${d(title)}, ${d(user)}, ${d(email)}, true, '', ${d(password)});
echo is_array($r) ? 'WP_INSTALL_OK:'.$GLOBALS['wp_version'] : 'WP_INSTALL_FAIL';
`
}

function resetPhp({ adminUser, password }) {
  const d = (s) => `base64_decode('${b64(s)}')`
  return `<?php
error_reporting(0); @ini_set('display_errors','0');
require __DIR__.'/wp-load.php';
$u = get_user_by('login', ${d(adminUser || '')});
if ( ! $u ) { $u = get_users(array('role'=>'administrator','number'=>1)); $u = $u ? $u[0] : null; }
if ( ! $u ) { echo 'WP_NO_ADMIN'; exit; }
wp_set_password(${d(password)}, $u->ID);
echo 'WP_RESET_OK:'.$u->user_login;
`
}

function makeInstaller({ cp, antiRed, http, log = () => {}, bypassWaitMs = 1500 }) {
  const h = http || require('axios')

  // UAPI with a WHM-root impersonation fallback when the stored cpPass is stale/missing.
  async function uapi(ctx, mod, func, params, method = 'POST') {
    const r = await cp.uapi(ctx.cpUser, ctx.cpPass, mod, func, params, method, ctx.whmHost)
    if (authFailed(r) && cp.uapiViaWhmRoot) return (await cp.uapiViaWhmRoot(ctx.cpUser, mod, func, params, ctx.whmHost)) || r
    return r
  }
  async function api2(ctx, func, params) {
    const r = await cp.api2(ctx.cpUser, ctx.cpPass, 'Fileman', func, params, ctx.whmHost)
    if (authFailed(r) && cp.api2ViaWhmRoot) return (await cp.api2ViaWhmRoot(ctx.cpUser, 'Fileman', func, params, ctx.whmHost)) || r
    return r
  }
  const fileop = (ctx, params) => api2(ctx, 'fileop', { doubledecode: 0, ...params })
  const remove = (ctx, full, isDir) => fileop(ctx, { op: isDir ? 'trash' : 'unlink', sourcefiles: full }).catch(() => null)

  async function listNames(ctx, dir) {
    const r = await uapi(ctx, 'Fileman', 'list_files', { dir, types: 'dir|file', include_mime: 0, include_permissions: 0 }, 'GET')
    if (!ok(r) || !Array.isArray(r.data)) return null
    return r.data.map((f) => f && (f.file || f.fullname)).filter(Boolean)
  }
  async function readFile(ctx, dir, file) {
    const r = await uapi(ctx, 'Fileman', 'get_file_content', { dir, file }, 'GET')
    return ok(r) && r.data ? String(r.data.content || '') : null
  }
  async function saveFile(ctx, dir, file, content) {
    const r = await uapi(ctx, 'Fileman', 'save_file_content', { dir, file, content }, 'POST')
    if (!ok(r)) throw new InstallError('file_write_failed', `Could not write ${file}: ${errOf(r)}`)
  }
  async function upload(ctx, dir, name, buf) {
    let r = await cp.uploadFile(ctx.cpUser, ctx.cpPass, dir, name, buf, ctx.whmHost)
    if (authFailed(r) && cp.uploadFileViaSession) r = (await cp.uploadFileViaSession(ctx.cpUser, dir, name, buf, ctx.whmHost)) || r
    if (!ok(r)) throw new InstallError('upload_failed', errOf(r))
  }

  // Doc root must exist and hold no WordPress/PHP app files we would overwrite.
  async function prepareDocRoot(ctx, docroot) {
    let names = await listNames(ctx, docroot)
    if (names === null && docroot !== `/home/${ctx.cpUser}/public_html`) {
      let parent = `/home/${ctx.cpUser}/public_html`
      for (const seg of docroot.slice(parent.length + 1).split('/')) {
        await api2(ctx, 'mkdir', { path: parent, name: seg }).catch(() => null)
        parent = `${parent}/${seg}`
      }
      names = await listNames(ctx, docroot)
    }
    if (names === null) throw new InstallError('docroot_unavailable', 'The install folder could not be read on the hosting account.')
    const clash = names.filter((n) => CONFLICT_ENTRIES.has(n))
    if (clash.length) throw new InstallError('docroot_not_empty', `The install folder already contains ${clash.slice(0, 4).join(', ')}. Pick an empty folder (path) or remove those files first.`)
    return names
  }

  async function createDbAndUser(ctx, undo) {
    const name = `${ctx.cpUser}_wp${rand(4)}`
    const dbPass = strongPassword()
    const c1 = await uapi(ctx, 'Mysql', 'create_database', { name })
    if (!ok(c1)) throw new InstallError('db_create_failed', errOf(c1))
    undo.push(() => uapi(ctx, 'Mysql', 'delete_database', { name }))
    const c2 = await uapi(ctx, 'Mysql', 'create_user', { name, password: dbPass })
    if (!ok(c2)) throw new InstallError('db_user_failed', errOf(c2))
    undo.push(() => uapi(ctx, 'Mysql', 'delete_user', { name }))
    const c3 = await uapi(ctx, 'Mysql', 'set_privileges_on_database', { user: name, database: name, privileges: 'ALL PRIVILEGES' })
    if (!ok(c3)) throw new InstallError('db_grant_failed', errOf(c3))
    return { dbName: name, dbUser: name, dbPass }
  }

  async function fetchWordPressZip() {
    let r
    try { r = await h.get(WP_ZIP_URL, { responseType: 'arraybuffer', timeout: 120000, maxContentLength: 100 * 1024 * 1024 }) }
    catch (e) { throw new InstallError('wp_download_failed', `WordPress download failed: ${e.message}`) }
    const buf = Buffer.from(r.data)
    if (buf.length < 1024) throw new InstallError('wp_download_failed', 'WordPress archive download was empty.')
    return buf
  }

  async function fetchSalts() {
    try { const r = await h.get(WP_SALT_URL, { timeout: 15000 }); if (typeof r.data === 'string' && r.data.includes('AUTH_KEY') && !/[\\]/.test(r.data)) return r.data.trim() } catch (_) { /* local fallback */ }
    return generateSalts()
  }

  // Upload → extract → move WP core out of the nested wordpress/ dir → clean up.
  async function deployFiles(ctx, docroot, zipBuf, undo) {
    const zipName = `wp-core-${rand(6)}.zip`
    await upload(ctx, docroot, zipName, zipBuf)
    const nested = `${docroot}/wordpress`
    undo.push(() => remove(ctx, nested, true))
    try {
      const ex = await fileop(ctx, { op: 'extract', sourcefiles: `${docroot}/${zipName}`, destfiles: docroot })
      if (!ok(ex)) throw new InstallError('extract_failed', errOf(ex))
    } finally { await remove(ctx, `${docroot}/${zipName}`, false) }
    const names = (await listNames(ctx, nested)) || []
    if (!names.includes('wp-settings.php')) throw new InstallError('extract_incomplete', 'WordPress core files were not found after extraction.')
    for (const name of names) {
      const mv = await fileop(ctx, { op: 'move', sourcefiles: `${nested}/${name}`, destfiles: `${docroot}/${name}` })
      if (!ok(mv)) throw new InstallError('move_failed', `Could not place ${name}: ${errOf(mv)}`)
      undo.push(() => remove(ctx, `${docroot}/${name}`, !/\.[a-z]+$/i.test(name)))
    }
    await remove(ctx, nested, true)
  }

  async function writeConfig(ctx, docroot, db, undo) {
    const content = wpConfig({ dbName: db.dbName, dbUser: db.dbUser, dbPass: db.dbPass, salts: await fetchSalts() })
    await saveFile(ctx, docroot, 'wp-config.php', content)
    undo.push(() => remove(ctx, `${docroot}/wp-config.php`, false))
  }

  // Best-effort: a failed .htaccess write only costs pretty permalinks, never the install.
  async function ensurePermalinks(ctx, docroot, path) {
    try {
      const next = withWordPressBlock(await readFile(ctx, docroot, '.htaccess'), path)
      if (next) await saveFile(ctx, docroot, '.htaccess', next)
    } catch (e) { log(`[WPInstaller] .htaccess permalink block skipped for ${ctx.cpUser}: ${e.message}`) }
  }

  // GET a one-time PHP file through the edge; retry once with the Anti-Red challenge bypassed.
  async function runBootstrap(ctx, docroot, siteUrl, php, okRx) {
    const file = `wp-setup-${rand(12)}.php`
    await saveFile(ctx, docroot, file, php)
    const url = `${siteUrl}/${file}`
    const attempt = async () => {
      try { const r = await h.get(url, { timeout: 90000, maxRedirects: 2, responseType: 'text', validateStatus: () => true, headers: { ...BROWSER_HEADERS, Referer: `${siteUrl}/` } }); return String(r.data || '') }
      catch (e) { return `ERR:${e.message}` }
    }
    try {
      let body = await attempt()
      if (!okRx.test(body) && antiRed && ctx.domain) {
        log(`[WPInstaller] bootstrap for ${ctx.domain} did not answer — retrying with the Anti-Red challenge bypassed`)
        let toggled = false
        try { const b = await antiRed.setDomainChallengeBypass(ctx.domain, true); toggled = !!(b && b.success) } catch (_) { /* best-effort */ }
        try { await new Promise((r) => setTimeout(r, bypassWaitMs)); body = await attempt() }
        finally { if (toggled && ctx.priorBypass !== true) { try { await antiRed.setDomainChallengeBypass(ctx.domain, false) } catch (_) { /* best-effort */ } } }
      }
      return body
    } finally {
      await remove(ctx, `${docroot}/${file}`, false)
    }
  }

  // A static index.html/htm would shadow WordPress's index.php — keep it as a backup.
  async function retirePlaceholders(ctx, docroot, names) {
    for (const n of PLACEHOLDER_INDEXES.filter((x) => names.includes(x))) {
      await fileop(ctx, { op: 'rename', sourcefiles: `${docroot}/${n}`, destfiles: `${docroot}/${n}.pre-wordpress` }).catch(() => null)
    }
  }

  // Full install. ctx = { cpUser, cpPass, whmHost, domain, priorBypass }.
  async function installWordPress(ctx, { path = '', adminEmail, title, onProgress = () => {} } = {}) {
    const docroot = docRootFor(ctx.cpUser, path)
    const site = siteUrls(ctx.domain, path)
    const admin = { user: adminUsername(), password: strongPassword(), email: adminEmail || `admin@${ctx.domain}`, title: title || ctx.domain }
    const undo = []
    try {
      onProgress('preflight')
      const existing = await prepareDocRoot(ctx, docroot)
      onProgress('database')
      const db = await createDbAndUser(ctx, undo)
      onProgress('download')
      const zip = await fetchWordPressZip()
      onProgress('files')
      await deployFiles(ctx, docroot, zip, undo)
      onProgress('config')
      await writeConfig(ctx, docroot, db, undo)
      await ensurePermalinks(ctx, docroot, path)
      onProgress('install')
      const body = await runBootstrap(ctx, docroot, site.siteUrl, bootstrapPhp(admin), /WP_INSTALL_OK|WP_ALREADY_INSTALLED/)
      if (!/WP_INSTALL_OK|WP_ALREADY_INSTALLED/.test(body)) {
        throw new InstallError('wp_install_failed', body.startsWith('ERR:') ? `The site did not answer: ${body.slice(4)}` : 'WordPress setup did not complete — the site may be offline or behind a challenge.')
      }
      await retirePlaceholders(ctx, docroot, existing)
      const ver = (body.match(/WP_INSTALL_OK:([0-9][0-9.]*)/) || [])[1] || null
      return {
        app: 'wordpress', path: normPath(path), doc_root: docroot, version: ver,
        site_url: site.siteUrl, admin_url: site.adminUrl,
        admin_user: admin.user, admin_password: admin.password, admin_email: admin.email, title: admin.title,
        db_name: db.dbName, db_user: db.dbUser,
      }
    } catch (e) {
      for (const fn of undo.reverse()) { try { await fn() } catch (_) { /* best-effort rollback */ } }
      throw e instanceof InstallError ? e : new InstallError('install_failed', e.message)
    }
  }

  async function resetAdminPassword(ctx, { docRoot, siteUrl, adminUser } = {}) {
    const password = strongPassword()
    const body = await runBootstrap(ctx, docRoot, siteUrl, resetPhp({ adminUser, password }), /WP_RESET_OK|WP_NO_ADMIN/)
    const m = body.match(/WP_RESET_OK:([^\s<]+)/)
    if (m) return { admin_user: m[1].trim(), admin_password: password }
    if (/WP_NO_ADMIN/.test(body)) throw new InstallError('no_admin_user', 'No WordPress administrator account was found for this site.')
    throw new InstallError('reset_failed', body.startsWith('ERR:') ? `The site did not answer: ${body.slice(4)}` : 'Password reset did not complete.')
  }

  return { installWordPress, resetAdminPassword }
}

module.exports = { makeInstaller, InstallError, docRootFor, siteUrls, normPath, wpConfig, generateSalts, wpHtaccessBlock, withWordPressBlock, bootstrapPhp, resetPhp, strongPassword, newAppId, WP_CORE_ENTRIES }
