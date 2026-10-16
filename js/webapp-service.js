// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// AI App Hosting (cPanel Node.js container apps) service
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Thin, normalized wrapper over the cPanel UAPI `WebApp` module (cPanel & WHM
// v138+, cpanel-webapp-plugin). Every function proxies through cpanel-proxy's
// `uapi(cpUser, cpPass, 'WebApp', <func>, params, method, host)` so it inherits
// the Cloudflare-tunnel routing, login-page/auth detection, and control-plane
// DOWN handling already used by the rest of the hosting panel.
//
// The WebApp module verbs (confirmed live on the production WHM box):
//   get_available  — account capacity + enabled runtimes (Node 20/22/24)
//   has_feature    — is the `webapp` feature available to this account
//   list           — all apps for the account (status, domain, env_editable…)
//   stage          — register a new app from a git repo or an uploaded zip
//   configure      — set env / build / startup / output_dir / mode / runtime_tag / db / domain
//   deploy         — build + start (async; returns deploy_id + task_id)
//   redeploy       — pull (git) + build + start (async)
//   start/stop/restart — lifecycle for a `server` category app
//   set_mode       — production | development (recreates the container)
//   fetch_logs     — tail app or per-deploy build log
//   delete         — remove the app (and optionally its created database)
//
// NOTE: this module never stores credentials; callers pass the decrypted
// cPanel password per request exactly as FileManager / MysqlManager do.

const cpProxy = require('./cpanel-proxy')

const log = (msg) => console.log(`[WebAppSvc] ${msg}`)

// Reserved / system-managed env var names the user must not set (cPanel rejects
// PORT server-side; we also surface a friendly client-side guard).
const RESERVED_ENV = new Set(['PORT'])

// Caps enforced by Cpanel::WebApps::Limits on the server — mirrored here so the
// UI/API can validate before a round-trip and show the same numbers.
const LIMITS = {
  maxAppsPerAccount: 4,
  envMaxVars: 64,
  envMaxBytes: 16384,
  envMaxNameLength: 128,
  envMaxValueLength: 4096,
}

// ── Normalize a raw UAPI response into a stable shape ──────────────────────
// cpProxy.uapi returns the sanitized UAPI body: { status, errors, data, ... }
// plus, on transport/auth problems, { status:0, code:'CPANEL_AUTH_FAILURE' }
// or a downResponse(). We fold all of that into one predictable object.
function normalize(res) {
  if (!res || typeof res !== 'object') {
    return { ok: false, data: null, errors: ['Empty response from server'], reason: 'Empty response from server' }
  }
  if (res.code === 'CPANEL_DOWN') {
    return { ok: false, cpanelDown: true, data: null, errors: res.errors || ['Hosting control plane is temporarily unavailable'], reason: 'control_plane_down' }
  }
  if (res.code === 'CPANEL_AUTH_FAILURE') {
    return { ok: false, authFailure: true, data: null, errors: res.errors || ['Authentication failed'], reason: 'auth_failure', httpStatus: res.httpStatus || null }
  }
  const ok = res.status === 1 || res.status === '1'
  const errors = Array.isArray(res.errors) ? res.errors : (res.errors ? [res.errors] : null)
  // On a category error the module puts { error_category } inside data.
  const errorCategory = (res.data && typeof res.data === 'object' && res.data.error_category) || null
  return {
    ok,
    data: res.data ?? null,
    errors: ok ? null : (errors || ['The hosting server rejected the request']),
    error_category: errorCategory,
    reason: ok ? null : ((errors && errors[0]) || errorCategory || 'request_failed'),
    warnings: res.warnings || null,
    raw: res,
  }
}

// ── Core caller ────────────────────────────────────────────────────────────
async function call(cpUser, cpPass, func, params = {}, method = 'GET', host = null) {
  const res = await cpProxy.uapi(cpUser, cpPass, 'WebApp', func, params, method, host)
  const out = normalize(res)
  if (!out.ok) log(`${func} failed: ${out.reason}${out.error_category ? ` [${out.error_category}]` : ''}`)
  return out
}

// ── Read verbs ───────────────────────────────────────────────────────────
const hasFeature = (cpUser, cpPass, host) => call(cpUser, cpPass, 'has_feature', {}, 'GET', host)
const capacity   = (cpUser, cpPass, host) => call(cpUser, cpPass, 'get_available', {}, 'GET', host)
const list       = (cpUser, cpPass, host) => call(cpUser, cpPass, 'list', {}, 'GET', host)

async function get(cpUser, cpPass, host, name) {
  // No single-app verb exists; list() is the source of truth.
  const r = await list(cpUser, cpPass, host)
  if (!r.ok) return r
  const apps = Array.isArray(r.data) ? r.data : []
  const app = apps.find(a => a && a.name === name) || null
  return { ok: true, data: app, errors: app ? null : ['App not found'], notFound: !app }
}

async function logs(cpUser, cpPass, host, name, { log_type = 'app', lines = 200, deploy_id = null } = {}) {
  const params = { name, log_type, lines }
  if (deploy_id) params.deploy_id = deploy_id
  return call(cpUser, cpPass, 'fetch_logs', params, 'GET', host)
}

// ── Write verbs ──────────────────────────────────────────────────────────
// stage: register a new app. source_type: 'git' | 'zip'.
//   git → source = clone URL, optional branch, ssh_key_name, passphrase
//   zip → source = absolute path of the uploaded archive in the account's home
function stage(cpUser, cpPass, host, {
  name, source_type, source, branch, ssh_key_name, mode, runtime, appdir, parent, passphrase,
}) {
  const params = { name, source_type, source }
  if (branch) params.branch = branch
  if (ssh_key_name) params.ssh_key_name = ssh_key_name
  if (mode) params.mode = mode
  if (runtime) params.runtime = runtime
  if (appdir) params.appdir = appdir
  if (parent) params.parent = parent
  if (passphrase) params.passphrase = passphrase
  return call(cpUser, cpPass, 'stage', params, 'POST', host)
}

// configure: apply settings before/after a deploy. Pass env OR env_text, never both.
function configure(cpUser, cpPass, host, name, opts = {}) {
  const allowed = ['env', 'env_text', 'build_command', 'startup_command', 'output_dir',
    'runtime_tag', 'domain', 'mode', 'db', 'db_name', 'appdir', 'deployname', 'use_existing_domain']
  const params = { name }
  for (const k of allowed) if (opts[k] !== undefined && opts[k] !== null) params[k] = opts[k]
  // env object must be JSON-encoded for UAPI
  if (params.env && typeof params.env === 'object') params.env = JSON.stringify(params.env)
  return call(cpUser, cpPass, 'configure', params, 'POST', host)
}

const deploy   = (cpUser, cpPass, host, name, opts = {}) =>
  call(cpUser, cpPass, 'deploy', { name, ...(opts.sshkeypass ? { sshkeypass: opts.sshkeypass } : {}) }, 'POST', host)
const redeploy = (cpUser, cpPass, host, name, opts = {}) =>
  call(cpUser, cpPass, 'redeploy', { name, ...(opts.sshkeypass ? { sshkeypass: opts.sshkeypass } : {}) }, 'POST', host)

function lifecycle(cpUser, cpPass, host, name, action) {
  if (!['start', 'stop', 'restart'].includes(action)) {
    return Promise.resolve({ ok: false, errors: [`Invalid action: ${action}`], reason: 'invalid_action' })
  }
  return call(cpUser, cpPass, action, { name }, 'POST', host)
}

const setMode = (cpUser, cpPass, host, name, mode) =>
  call(cpUser, cpPass, 'set_mode', { name, mode }, 'POST', host)

const remove = (cpUser, cpPass, host, name, { verify, delete_database } = {}) => {
  const params = { name }
  if (verify !== undefined) params.verify = verify
  if (delete_database !== undefined) params.delete_database = delete_database ? 1 : 0
  return call(cpUser, cpPass, 'delete', params, 'POST', host)
}

// ── Local validation helpers (fail fast before a round-trip) ───────────────
function validateAppName(name) {
  if (!name || typeof name !== 'string') return 'An app name is required.'
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(name)) return 'The app name must use lowercase letters, numbers, hyphens and underscores, and start with a letter or number.'
  if (name.length > 64) return 'The app name is too long (max 64 characters).'
  return null
}

// Validate an env object; returns { ok, error } without hitting the server.
function validateEnv(envObj) {
  if (!envObj || typeof envObj !== 'object') return { ok: true }
  const keys = Object.keys(envObj)
  if (keys.length > LIMITS.envMaxVars) return { ok: false, error: `You can set at most ${LIMITS.envMaxVars} environment variables.` }
  let bytes = 0
  for (const k of keys) {
    if (RESERVED_ENV.has(k)) return { ok: false, error: `"${k}" is reserved by the platform and is set automatically.` }
    if (k.length > LIMITS.envMaxNameLength || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) {
      return { ok: false, error: `"${k}" is not a valid variable name. Use letters, numbers and underscores, starting with a letter or underscore.` }
    }
    const v = envObj[k] == null ? '' : String(envObj[k])
    if (v.length > LIMITS.envMaxValueLength) return { ok: false, error: `The value for "${k}" is too long (max ${LIMITS.envMaxValueLength} characters).` }
    if (/[\u0000-\u001F\u007F]/.test(v)) return { ok: false, error: `The value for "${k}" cannot contain line breaks or control characters.` }
    bytes += k.length + v.length + 2
  }
  if (bytes > LIMITS.envMaxBytes) return { ok: false, error: `The environment is too large (max ${LIMITS.envMaxBytes} bytes).` }
  return { ok: true }
}

// Parse a pasted .env blob into an object (mirrors the server's line rules).
function parseEnvText(text) {
  const env = {}
  const lines = String(text || '').split(/\r?\n/)
  for (let raw of lines) {
    const line = raw.replace(/^\s+/, '')
    if (!line.length || line[0] === '#') continue
    const idx = line.indexOf('=')
    if (idx < 0) return { ok: false, error: `Line "${raw.slice(0, 40)}" is not valid. Use NAME=value, or # for a comment.` }
    const name = line.slice(0, idx).trim()
    const value = line.slice(idx + 1)
    env[name] = value
  }
  const v = validateEnv(env)
  if (!v.ok) return v
  return { ok: true, env }
}

module.exports = {
  LIMITS,
  RESERVED_ENV,
  normalize,
  call,
  hasFeature,
  capacity,
  list,
  get,
  logs,
  stage,
  configure,
  deploy,
  redeploy,
  lifecycle,
  setMode,
  remove,
  validateAppName,
  validateEnv,
  parseEnvText,
}
