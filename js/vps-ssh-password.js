'use strict'
/**
 * vps-ssh-password.js — apply a password to a LIVE Linux VPS over SSH.
 *
 * ─── WHY THIS EXISTS ─────────────────────────────────────────────────────
 * DigitalOcean's API physically cannot set a password on an existing droplet:
 *
 *   • `user_data` is accepted ONLY by the droplet-CREATE endpoint and is
 *     immutable afterwards. The `rebuild` action silently IGNORES any
 *     user_data you send and re-runs the ORIGINAL creation cloud-init.
 *   • `password_reset` generates a random password and EMAILS it to the
 *     account owner, so neither the bot nor the customer ever sees it.
 *
 * The previous resetPassword() implementation sent user_data together with
 * `rebuild`, which meant every "🔑 Reset Password" tap:
 *   1. WIPED the customer's server (fresh OS install), and
 *   2. left the ORIGINAL creation password in place, while the bot displayed
 *      a brand-new password that had never been applied anywhere.
 * Customers therefore got "Permission denied, please try again." forever and
 * lost their data on every retry. (Real incident: chatId 6277663071 — 3
 * rebuilds in 20h, 3 wipes, 0 working passwords.)
 *
 * This module instead logs in to the RUNNING box — SSH key first, then the
 * currently known password — sets the new password in place, re-enables
 * password auth, and finally VERIFIES the new password by logging in with it.
 * No reboot, no data loss, and the bot never shows a password it hasn't
 * proven to work.
 */

const crypto = require('crypto')
const net = require('net')
const { Client } = require('ssh2')

const log = (...a) => console.log('[VPS-SSH]', ...a)

const DEFAULT_TIMEOUT_MS = 45000

/**
 * ssh2 only understands PKCS#1 (`BEGIN RSA PRIVATE KEY`), SEC1 and OpenSSH
 * private keys — it rejects PKCS#8 (`BEGIN PRIVATE KEY`) with
 * "Unsupported key format". The bot's own generateNewSSHkey() emits PKCS#8,
 * so every key in `sshKeysOf` needs converting before use. Node's crypto can
 * re-encode it without any extra dependency.
 */
function normalizePrivateKey(pem) {
  if (!pem) return null
  const raw = String(pem).trim()
  // Already in a format ssh2 accepts
  if (raw.includes('BEGIN RSA PRIVATE KEY') ||
      raw.includes('BEGIN OPENSSH PRIVATE KEY') ||
      raw.includes('BEGIN EC PRIVATE KEY') ||
      raw.includes('BEGIN DSA PRIVATE KEY')) {
    return raw
  }
  try {
    const keyObj = crypto.createPrivateKey(raw)
    const type = keyObj.asymmetricKeyType
    if (type === 'rsa' || type === 'rsa-pss') {
      return keyObj.export({ type: 'pkcs1', format: 'pem' }).toString()
    }
    if (type === 'ec') {
      return keyObj.export({ type: 'sec1', format: 'pem' }).toString()
    }
    // ed25519/x25519 have no PKCS#1/SEC1 equivalent — hand back the original
    // and let ssh2 decide (newer ssh2 builds accept some of these).
    return raw
  } catch (e) {
    log(`normalizePrivateKey failed (${e.message || e}) — using key as-is`)
    return raw
  }
}

/**
 * Build the remote bash script that sets `username`'s password and makes sure
 * sshd actually accepts password logins.
 *
 * The credential is passed as base64 (`user:password`) and piped straight into
 * `chpasswd`, so the password is NEVER interpolated into the shell — any
 * character (quotes, $, !, #, spaces) is safe.
 */
function buildPasswordScript(username, newPassword) {
  const cred = Buffer.from(`${username}:${newPassword}`, 'utf-8').toString('base64')
  return [
    'set -u',
    // 1. Set the password without ever exposing it to the shell parser
    `echo '${cred}' | base64 -d | chpasswd`,
    // 2. Unlock the account (Ubuntu 24.04 ships root locked)
    `passwd -u ${username} 2>/dev/null || true`,
    // 3. Enable password auth + root login in the main config
    "sed -i 's/^#*PasswordAuthentication.*/PasswordAuthentication yes/' /etc/ssh/sshd_config 2>/dev/null || true",
    "sed -i 's/^#*PermitRootLogin.*/PermitRootLogin yes/' /etc/ssh/sshd_config 2>/dev/null || true",
    "grep -q '^PasswordAuthentication yes' /etc/ssh/sshd_config 2>/dev/null || echo 'PasswordAuthentication yes' >> /etc/ssh/sshd_config",
    "grep -q '^PermitRootLogin yes' /etc/ssh/sshd_config 2>/dev/null || echo 'PermitRootLogin yes' >> /etc/ssh/sshd_config",
    // 4. Neutralise drop-ins that turn it back off.
    //    DO's Ubuntu images ship /etc/ssh/sshd_config.d/60-cloudimg-settings.conf
    //    with `PasswordAuthentication no`.
    'for f in /etc/ssh/sshd_config.d/*.conf; do',
    '  [ -f "$f" ] || continue',
    '  sed -i "s/^PasswordAuthentication no/PasswordAuthentication yes/" "$f"',
    '  sed -i "s/^PermitRootLogin prohibit-password/PermitRootLogin yes/" "$f"',
    '  sed -i "s/^PermitRootLogin no/PermitRootLogin yes/" "$f"',
    'done',
    // 5. Reload sshd so the config edits take effect. `reload` (not `restart`)
    //    so we never kill our own session; the HUP fallback covers images
    //    without systemd.
    'systemctl reload sshd 2>/dev/null || systemctl reload ssh 2>/dev/null || systemctl restart sshd 2>/dev/null || systemctl restart ssh 2>/dev/null || service ssh reload 2>/dev/null || pkill -HUP -x sshd 2>/dev/null || true',
    'echo NOMADLY_PWD_OK',
  ].join('\n')
}

/**
 * Run a command over SSH. Resolves { code, stdout, stderr }.
 * Pass script=null to only test that authentication succeeds.
 */
function execOverSSH(opts = {}) {
  const {
    host,
    port = 22,
    username = 'root',
    privateKey = null,
    password = null,
    script = null,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = opts

  return new Promise((resolve, reject) => {
    if (!host) return reject(new Error('execOverSSH: host is required'))
    if (!privateKey && !password) return reject(new Error('execOverSSH: privateKey or password is required'))

    const conn = new Client()
    let settled = false
    const finish = (err, val) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try { conn.end() } catch (_) { /* noop */ }
      err ? reject(err) : resolve(val)
    }
    const timer = setTimeout(
      () => finish(new Error(`SSH timeout after ${timeoutMs}ms`)),
      timeoutMs
    )

    conn.on('ready', () => {
      if (!script) return finish(null, { code: 0, stdout: '', stderr: '', authOnly: true })
      conn.exec(script, (err, stream) => {
        if (err) return finish(err)
        let stdout = ''
        let stderr = ''
        stream.on('data', d => { stdout += d.toString() })
        stream.stderr.on('data', d => { stderr += d.toString() })
        stream.on('close', code => finish(null, { code, stdout, stderr }))
      })
    })

    conn.on('error', e => finish(e))

    // Some images only offer keyboard-interactive for password auth.
    conn.on('keyboard-interactive', (_n, _i, _il, _p, cb) => {
      if (password) return cb([password])
      return cb([])
    })

    const cfg = {
      host,
      port: Number(port) || 22,
      username,
      readyTimeout: timeoutMs,
      keepaliveInterval: 0,
    }
    if (privateKey) {
      cfg.privateKey = normalizePrivateKey(privateKey)
    } else {
      cfg.password = password
      cfg.tryKeyboard = true
    }

    try {
      conn.connect(cfg)
    } catch (e) {
      finish(e)
    }
  })
}

/**
 * Verify that `password` can actually log in. This is what stops the bot from
 * ever handing a customer a password that does not work.
 */
async function verifyPasswordLogin({ host, port = 22, username = 'root', password, timeoutMs = 30000 }) {
  try {
    await execOverSSH({ host, port, username, password, script: null, timeoutMs })
    return true
  } catch (_) {
    return false
  }
}

/**
 * Apply `newPassword` to a running VPS.
 *
 * Auth is attempted in this order:
 *   1. every stored SSH private key (the customer's key is injected at create
 *      time and re-injected by DO on rebuild, so it keeps working)
 *   2. the password we currently believe is set
 *
 * @returns {Promise<{ok:boolean, method:string|null, verified:boolean, attempts:Array, error?:string}>}
 */
async function applyPasswordOverSSH(opts = {}) {
  const {
    host,
    port = 22,
    username = 'root',
    newPassword,
    privateKeys = [],
    currentPassword = null,
    verify = true,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = opts

  const attempts = []
  if (!host) return { ok: false, method: null, verified: false, attempts, error: 'no host on record' }
  if (!newPassword) return { ok: false, method: null, verified: false, attempts, error: 'no newPassword supplied' }

  const script = buildPasswordScript(username, newPassword)

  const candidates = []
  for (const k of (Array.isArray(privateKeys) ? privateKeys : [privateKeys])) {
    const key = typeof k === 'string' ? k : (k && (k.privateKey || k.key))
    const name = (k && k.sshKeyName) || (k && k.name) || 'ssh-key'
    if (key && String(key).includes('PRIVATE KEY')) {
      candidates.push({ method: `ssh-key:${name}`, privateKey: String(key) })
    }
  }
  if (currentPassword) candidates.push({ method: 'ssh-password', password: currentPassword })

  if (!candidates.length) {
    return { ok: false, method: null, verified: false, attempts, error: 'no SSH key and no known current password' }
  }

  for (const cand of candidates) {
    try {
      const res = await execOverSSH({
        host, port, username, script, timeoutMs,
        privateKey: cand.privateKey || null,
        password: cand.password || null,
      })
      const ok = res.code === 0 || String(res.stdout).includes('NOMADLY_PWD_OK')
      attempts.push({ method: cand.method, ok, code: res.code, stderr: String(res.stderr || '').slice(0, 200) })
      if (!ok) continue

      let verified = false
      if (verify) {
        // sshd needs a moment after reload before it honours the new config
        await new Promise(r => setTimeout(r, 2500))
        verified = await verifyPasswordLogin({ host, port, username, password: newPassword })
        if (!verified) {
          // one retry — cloud images can be slow to reload sshd
          await new Promise(r => setTimeout(r, 4000))
          verified = await verifyPasswordLogin({ host, port, username, password: newPassword })
        }
      }
      log(`password applied on ${host} via ${cand.method} (verified=${verified})`)
      return { ok: true, method: cand.method, verified, attempts }
    } catch (e) {
      attempts.push({ method: cand.method, ok: false, error: String(e.message || e).slice(0, 200) })
    }
  }

  return {
    ok: false,
    method: null,
    verified: false,
    attempts,
    error: `all SSH auth attempts failed: ${attempts.map(a => `${a.method}=${a.error || a.code}`).join('; ')}`,
  }
}

/**
 * Parse a root/admin password out of a cloud-init `#cloud-config` document.
 *
 * The bot writes create-time user_data shaped like:
 *   #cloud-config
 *   chpasswd:
 *     list: |
 *       root:SomePassword
 *     expire: false
 *   ssh_pwauth: true
 *
 * YAML keys that are part of the schema (expire/list/...) are skipped so only
 * the `user:password` lines are considered.
 */
function parsePasswordFromCloudInit(userData, username = 'root') {
  if (!userData) return null
  const RESERVED = new Set([
    'expire', 'list', 'chpasswd', 'users', 'ssh_pwauth', 'runcmd', 'password',
    'packages', 'write_files', 'name', 'lock_passwd', 'shell', 'sudo', 'groups',
  ])
  const lines = String(userData).split('\n')
  let fallback = null
  for (const line of lines) {
    // password entries are always indented inside the `list: |` block
    const m = line.match(/^\s{2,}([A-Za-z0-9._-]+):(.+)$/)
    if (!m) continue
    const user = m[1]
    const value = m[2].trim()
    if (RESERVED.has(user.toLowerCase()) || !value) continue
    if (user === username) return value
    if (!fallback) fallback = value
  }
  return fallback
}

/**
 * Recover the ORIGINAL create-time password of a droplet by reading the
 * cloud-init user-data the provider still serves it.
 *
 * Why this works (and why we need it): DigitalOcean stores `user_data`
 * immutably at create time and keeps serving it for the life of the droplet —
 * that is the very quirk that broke the old password reset. We can turn it to
 * our advantage: for every VPS created before password secrets were persisted
 * (they used to live in a per-process Map and died on each redeploy), the
 * original password is still recoverable straight off the box.
 *
 * Requires an SSH key, which the bot injects at create time and DO re-injects
 * on every rebuild.
 *
 * @returns {Promise<{ok:boolean, password?:string, source?:string, error?:string}>}
 */
async function recoverPasswordFromCloudInit(opts = {}) {
  const { host, port = 22, username = 'root', privateKeys = [], timeoutMs = DEFAULT_TIMEOUT_MS } = opts
  if (!host) return { ok: false, error: 'no host on record' }

  const keys = (Array.isArray(privateKeys) ? privateKeys : [privateKeys])
    .map(k => (typeof k === 'string' ? k : (k && (k.privateKey || k.key))))
    .filter(k => k && String(k).includes('PRIVATE KEY'))
  if (!keys.length) return { ok: false, error: 'no SSH key on file' }

  // Read the delivered user-data; fall back to the cloud metadata service.
  const script = [
    'cat /var/lib/cloud/instance/user-data.txt 2>/dev/null',
    '  || cat /var/lib/cloud/instances/*/user-data.txt 2>/dev/null',
    '  || curl -s --max-time 5 http://169.254.169.254/metadata/v1/user-data 2>/dev/null',
    '  || true',
  ].join(' ')

  for (const privateKey of keys) {
    try {
      const res = await execOverSSH({ host, port, username, privateKey, script, timeoutMs })
      const password = parsePasswordFromCloudInit(res.stdout, username)
      if (password) {
        log(`recovered create-time password for ${host} from cloud-init user-data`)
        return { ok: true, password, source: 'cloud-init-user-data' }
      }
      return { ok: false, error: 'user-data contained no password entry' }
    } catch (e) {
      // try the next key
      if (keys.indexOf(privateKey) === keys.length - 1) {
        return { ok: false, error: String(e.message || e).slice(0, 200) }
      }
    }
  }
  return { ok: false, error: 'could not read user-data' }
}

/**
 * Work out whether a password we hold actually grants access, and if not, WHY.
 *
 * This is what stops the bot from ever showing a customer a credential that
 * silently does not work (the @user_uu0 failure mode).
 *
 * @returns {Promise<{status:'ok'|'password_auth_disabled'|'password_wrong'|'unreachable', detail:string}>}
 */
async function diagnosePasswordAccess(opts = {}) {
  const { host, port = 22, username = 'root', password, privateKeys = [], timeoutMs = 30000 } = opts
  if (!host) return { status: 'unreachable', detail: 'no host on record' }

  if (password && await verifyPasswordLogin({ host, port, username, password, timeoutMs })) {
    return { status: 'ok', detail: 'password login succeeded' }
  }

  // Password did not work. Use the SSH key to find out whether sshd is even
  // accepting passwords — otherwise we would blame the password unfairly.
  const keys = (Array.isArray(privateKeys) ? privateKeys : [privateKeys])
    .map(k => (typeof k === 'string' ? k : (k && (k.privateKey || k.key))))
    .filter(k => k && String(k).includes('PRIVATE KEY'))

  for (const privateKey of keys) {
    try {
      const res = await execOverSSH({
        host, port, username, privateKey, timeoutMs,
        script: 'sshd -T 2>/dev/null | grep -i "^passwordauthentication" || echo unknown',
      })
      const out = String(res.stdout || '').toLowerCase()
      if (out.includes('passwordauthentication no')) {
        return { status: 'password_auth_disabled', detail: 'sshd is refusing all password logins' }
      }
      return { status: 'password_wrong', detail: 'server accepts passwords but rejected this one' }
    } catch (_) { /* try next key */ }
  }

  return { status: 'unreachable', detail: 'could not reach the server to check' }
}

/**
 * Open a bare TCP connection to host:port and resolve true if it accepts the
 * connection within `timeoutMs`. Never throws. Used to tell "the box is down"
 * apart from "the box is up but SSH (22) is firewalled".
 */
function probeTcpPort(host, port, timeoutMs = 6000) {
  return new Promise((resolve) => {
    if (!host) return resolve(false)
    const sock = new net.Socket()
    let done = false
    const finish = (val) => {
      if (done) return
      done = true
      try { sock.destroy() } catch (_) { /* noop */ }
      resolve(val)
    }
    sock.setTimeout(timeoutMs)
    sock.once('connect', () => finish(true))
    sock.once('timeout', () => finish(false))
    sock.once('error', () => finish(false))
    try {
      sock.connect(Number(port) || 22, host)
    } catch (_) {
      finish(false)
    }
  })
}

/**
 * Diagnose why an SSH operation could not reach a VPS.
 *   verdict 'ok'          — SSH port is open (problem is auth, not reachability)
 *   verdict 'ssh-blocked' — box is ONLINE (a web port answers) but SSH is closed
 *                           → almost always the guest firewall (ufw) blocking 22
 *   verdict 'host-down'   — nothing answers on SSH or the common web ports
 *
 * @returns {Promise<{sshOpen:boolean, webOpen:boolean, hostUp:boolean, verdict:string}>}
 */
async function diagnoseSshReachability(host, opts = {}) {
  const sshPort = Number(opts.sshPort) || 22
  const timeoutMs = Number(opts.timeoutMs) || 6000
  const sshOpen = await probeTcpPort(host, sshPort, timeoutMs)
  if (sshOpen) {
    return { sshOpen: true, webOpen: false, hostUp: true, verdict: 'ok' }
  }
  // SSH closed — is the box otherwise alive? Probe common always-on ports.
  const webPorts = Array.isArray(opts.webPorts) && opts.webPorts.length ? opts.webPorts : [80, 443]
  let webOpen = false
  for (const p of webPorts) {
    if (await probeTcpPort(host, p, timeoutMs)) { webOpen = true; break }
  }
  return {
    sshOpen: false,
    webOpen,
    hostUp: webOpen,
    verdict: webOpen ? 'ssh-blocked' : 'host-down',
  }
}

/**
 * A+B BACKFILL for EXISTING droplets — DO has no API to add an SSH key or
 * change the firewall after create, so we do it over SSH on the running box:
 * append the bot's managed PUBLIC key to root's authorized_keys (idempotent)
 * and register `ufw allow OpenSSH` (idempotent — only OPENS a port, never
 * closes one). Also re-asserts password auth to match create-time hardening.
 * Requires an existing working credential (a stored key or the current/
 * recoverable password) — locked-out boxes can't be reached and must be fixed
 * via the provider recovery console.
 */
function buildBackfillScript(publicKey) {
  const pub = String(publicKey || '').trim().replace(/'/g, "'\"'\"'")
  return [
    '#!/bin/bash',
    'mkdir -p /root/.ssh && chmod 700 /root/.ssh',
    'touch /root/.ssh/authorized_keys && chmod 600 /root/.ssh/authorized_keys',
    `KEY='${pub}'`,
    // idempotent: only append if the exact key line is not already present
    'grep -qxF "$KEY" /root/.ssh/authorized_keys || echo "$KEY" >> /root/.ssh/authorized_keys',
    // never firewall SSH out — additive only
    'if command -v ufw >/dev/null 2>&1; then ufw allow OpenSSH 2>/dev/null || ufw allow 22/tcp 2>/dev/null || true; fi',
    // re-assert password auth + root login (idempotent), incl. drop-ins
    "sed -i 's/^#*PasswordAuthentication.*/PasswordAuthentication yes/' /etc/ssh/sshd_config 2>/dev/null || true",
    "sed -i 's/^#*PermitRootLogin.*/PermitRootLogin yes/' /etc/ssh/sshd_config 2>/dev/null || true",
    'for f in /etc/ssh/sshd_config.d/*.conf; do [ -f "$f" ] && sed -i "s/^PasswordAuthentication no/PasswordAuthentication yes/" "$f" 2>/dev/null; done || true',
    // reload (not restart) so we never kill our own session
    'systemctl reload sshd 2>/dev/null || systemctl reload ssh 2>/dev/null || systemctl restart ssh 2>/dev/null || pkill -HUP -x sshd 2>/dev/null || true',
    'echo NOMADLY_BACKFILL_OK',
  ].join('\n')
}

/**
 * Apply the A+B backfill to a RUNNING droplet over SSH.
 * Auth order: every stored private key, then the current password.
 * @returns {Promise<{ok:boolean, method:string|null, attempts:Array, error?:string}>}
 */
async function applyBackfillOverSSH(opts = {}) {
  const {
    host, port = 22, username = 'root', publicKey,
    privateKeys = [], currentPassword = null, timeoutMs = DEFAULT_TIMEOUT_MS,
  } = opts
  const attempts = []
  if (!host) return { ok: false, method: null, attempts, error: 'no host on record' }
  if (!publicKey) return { ok: false, method: null, attempts, error: 'no publicKey supplied' }

  const script = buildBackfillScript(publicKey)
  const candidates = []
  for (const k of (Array.isArray(privateKeys) ? privateKeys : [privateKeys])) {
    const key = typeof k === 'string' ? k : (k && (k.privateKey || k.key))
    const name = (k && k.sshKeyName) || (k && k.name) || 'ssh-key'
    if (key && String(key).includes('PRIVATE KEY')) candidates.push({ method: `ssh-key:${name}`, privateKey: String(key) })
  }
  if (currentPassword) candidates.push({ method: 'ssh-password', password: currentPassword })
  if (!candidates.length) return { ok: false, method: null, attempts, error: 'no SSH key and no known current password' }

  for (const cand of candidates) {
    try {
      const res = await execOverSSH({
        host, port, username, script, timeoutMs,
        privateKey: cand.privateKey || null, password: cand.password || null,
      })
      const ok = res.code === 0 || String(res.stdout).includes('NOMADLY_BACKFILL_OK')
      attempts.push({ method: cand.method, ok, code: res.code, stderr: String(res.stderr || '').slice(0, 150) })
      if (ok) { log(`backfill applied on ${host} via ${cand.method}`); return { ok: true, method: cand.method, attempts } }
    } catch (e) {
      attempts.push({ method: cand.method, ok: false, error: String(e.message || e).slice(0, 150) })
    }
  }
  return { ok: false, method: null, attempts, error: 'all auth attempts failed' }
}

module.exports = {
  applyPasswordOverSSH,
  verifyPasswordLogin,
  diagnosePasswordAccess,
  recoverPasswordFromCloudInit,
  parsePasswordFromCloudInit,
  execOverSSH,
  buildPasswordScript,
  normalizePrivateKey,
  probeTcpPort,
  diagnoseSshReachability,
  buildBackfillScript,
  applyBackfillOverSSH,
}
