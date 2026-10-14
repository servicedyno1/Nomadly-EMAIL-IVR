'use strict'
// Bot "🔄 Reinstall OS" for DigitalOcean Linux VPS (owner decisions 2026-10-14).
// • Any image from DigitalOcean's live distribution list (digitalocean-service.listImages).
// • Same login afterwards: DO's rebuild keeps the droplet's SSH keys and re-runs its create-time setup
//   (= the ORIGINAL password). A later "Reset Password" is not part of that setup, so once the rebuilt
//   box is up we re-apply the password the customer last had, over SSH, after cloud-init finished.
// • SSH-key-only images (Fedora / CentOS / AlmaLinux / Rocky Linux) only on a server that has a key.

const T = { firstWaitMs: 20000, pollMs: 10000, retryMs: 20000, maxMs: 15 * 60000 }
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

const hasSshKey = (rec) => !!(rec && (rec.sshKeySecretId || (Array.isArray(rec.sshKeyIds) && rec.sshKeyIds.length)))
const currentOsId = (rec, live) => String((rec && (rec.osId || rec.imageId)) || (live && live.osId) || '').toLowerCase()

/** Keyboard options: live images, SSH-key-only ones hidden on a key-less server, current one flagged. */
async function options(rec, provider, live) {
  const cur = currentOsId(rec, live)
  const keyOk = hasSshKey(rec)
  const imgs = await provider.listImages('linux')
  return imgs.filter(i => keyOk || !i.requiresSshKey).map(i => ({ id: i.imageId, name: i.name, current: i.imageId === cur, requiresSshKey: !!i.requiresSshKey }))
}

/**
 * Start the rebuild now and return at once; `onDone({ ok, passwordApplied, verified })` fires when the box
 * is back with the customer's password (or when that could not be confirmed).
 */
async function start({ rec, osId, provider, privateKeys = [], applyPassword, onDone = () => {} }) {
  const img = provider.getLinuxImage(osId)
  if (!img) { const e = new Error(`${osId} is not offered by DigitalOcean any more`); e.code = 'invalid_os'; throw e }
  if (img.requiresSshKey && !hasSshKey(rec)) { const e = new Error(`${img.name} needs an SSH key on the server`); e.code = 'ssh_key_required'; throw e }
  let password = null
  if (rec.rootPasswordSecretId) { try { password = await provider.getSecretPassword(rec.rootPasswordSecretId) } catch (_) { password = null } }
  const instanceId = rec.contaboInstanceId || rec.instanceId || rec.vpsId
  await provider.reinstallInstance(instanceId, { osId: img.slug || osId })
  const username = rec.defaultUser || 'root'
  finish({ instanceId, host: rec.host, username, password, privateKeys, provider, applyPassword })
    .catch(e => ({ ok: false, passwordApplied: false, error: e.message }))
    .then(done => onDone({ ...done, password: done.passwordApplied ? password : null, username, osName: img.name }))
  return { osId: img.slug || osId, osName: img.name, etaMinutes: 3, password }
}

async function finish({ instanceId, host, username, password, privateKeys, provider, applyPassword }) {
  const deadline = Date.now() + T.maxMs
  await sleep(T.firstWaitMs)
  let ip = host
  while (Date.now() < deadline) {
    const live = await provider.getInstance(instanceId).catch(() => null)
    if (live && /^(running|active)$/i.test(String(live.status || ''))) { ip = live.mainIp || live.ipv4 || ip; break }
    await sleep(T.pollMs)
  }
  if (!password || !ip) return { ok: true, passwordApplied: false, ip }
  while (Date.now() < deadline) {
    const r = await applyPassword({ host: ip, username, newPassword: password, privateKeys, currentPassword: password, waitForCloudInit: true, timeoutMs: 11 * 60000 }).catch(e => ({ ok: false, error: e.message }))
    if (r && r.ok) return { ok: true, passwordApplied: true, verified: !!r.verified, ip }
    await sleep(T.retryMs)
  }
  return { ok: false, passwordApplied: false, ip }
}

module.exports = { options, start, hasSshKey, currentOsId, _timing: T }
