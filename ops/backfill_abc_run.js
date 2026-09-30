'use strict'
/**
 * A+B backfill for EXISTING DigitalOcean Linux VPS.
 * For each reachable box we can authenticate to, appends the bot's managed SSH
 * key to authorized_keys + runs `ufw allow OpenSSH` (idempotent), then verifies
 * the managed key logs in and marks the record _abcBackfilledAt.
 *
 * DRY-RUN by default (mutates nothing). Set RUN=1 to execute.
 * Skips cancelled/deleted records; skips boxes already backfilled.
 */
require('dotenv').config({ path: '/app/backend/.env' })
const { MongoClient } = require('mongodb')
const vmSetup = require('/app/js/vm-instance-setup')
const secretStore = require('/app/js/vps-secret-store')
const sshPwd = require('/app/js/vps-ssh-password')
const reveal = require('/app/js/vps-password-reveal')
const vpsProvider = require('/app/js/vps-provider')

const RUN = process.env.RUN === '1'
const SKIP_STATUS = new Set(['DELETED', 'cancelled', 'CANCELLED', 'TERMINATED', 'PENDING_CANCELLATION'])
const sleep = ms => new Promise(r => setTimeout(r, ms))

;(async () => {
  const client = new MongoClient(process.env.MONGO_URL)
  await client.connect()
  const db = client.db(process.env.DB_NAME || 'test')
  vmSetup.initVpsDb(db)
  secretStore.initSecretStore(db)
  const vpsPlansOf = db.collection('vpsPlansOf')
  const sshKeysOf = db.collection('sshKeysOf')
  const provider = vpsProvider.pickProviderForOs(false) // DigitalOcean

  console.log(`\n=== A+B BACKFILL  (mode=${RUN ? 'EXECUTE' : 'DRY-RUN'}) ===`)

  const all = await vpsPlansOf.find({
    $and: [
      { $or: [{ provider: 'digitalocean' }, { vpsId: { $regex: '^do-' } }, { contaboInstanceId: { $regex: '^do-' } }] },
      { $or: [{ isRDP: { $ne: true } }, { isRDP: { $exists: false } }] },
      { osType: { $ne: 'Windows' } },
    ],
  }).toArray()

  const results = []
  for (const v of all) {
    const r = { chatId: v.chatId, vpsId: v.vpsId, host: v.host, status: v.status }
    try {
      if (v._abcBackfilledAt) { r.action = 'skip:already-done'; results.push(r); continue }
      if (SKIP_STATUS.has(String(v.status))) { r.action = 'skip:status-' + v.status; results.push(r); continue }
      const host = (v.host && v.host !== 'provisioning...' && v.host !== 'pending') ? v.host : null
      if (!host) { r.action = 'skip:no-host'; results.push(r); continue }

      const diag = await sshPwd.diagnoseSshReachability(host, { sshPort: 22, timeoutMs: 6000 })
      if (diag.verdict !== 'ok') { r.action = `skip:${diag.verdict}(recovery-console)`; results.push(r); continue }

      // Load working credentials (stored keys, then recoverable password)
      const keyDocs = await sshKeysOf.find({ telegramId: String(v.chatId) }).toArray()
      const privateKeys = keyDocs.filter(k => k.privateKey && String(k.privateKey).includes('PRIVATE KEY'))
                                 .map(k => ({ privateKey: k.privateKey, sshKeyName: k.sshKeyName }))
      let currentPassword = null
      if (!privateKeys.length) {
        const rev = await reveal.revealVpsPassword(
          { provider: 'digitalocean', vpsId: v.vpsId, host, defaultUser: v.defaultUser || 'root', rootPasswordSecretId: v.rootPasswordSecretId },
          { sshPrivateKeys: [], verify: false })
        if (rev && rev.status === 'ok' && rev.password) currentPassword = rev.password
      }
      if (!privateKeys.length && !currentPassword) { r.action = 'skip:no-usable-credential'; results.push(r); continue }

      // Ensure a bot-managed key exists and fetch its public/private halves
      const managed = await vmSetup.ensureManagedSSHKey(v.chatId, provider)
      const managedDoc = await sshKeysOf.findOne({ telegramId: String(v.chatId), contaboSecretId: managed.secretId })
      const publicKey = managedDoc && managedDoc.publicKey
      r.managedKey = managed.secretId
      if (!publicKey) { r.action = 'error:managed-pubkey-missing'; results.push(r); continue }

      if (!RUN) {
        r.action = 'WOULD-BACKFILL'
        r.cred = privateKeys.length ? 'ssh-key' : 'password'
        results.push(r); continue
      }

      // EXECUTE: append key + ufw allow over SSH
      const applied = await sshPwd.applyBackfillOverSSH({ host, username: v.defaultUser || 'root', publicKey, privateKeys, currentPassword })
      r.applied = applied.ok
      r.method = applied.method || null
      if (!applied.ok) { r.action = 'FAILED:' + (applied.error || 'unknown'); r.attempts = applied.attempts; results.push(r); continue }

      // Verify the managed key now logs in (auth-only)
      let verifiedManagedKey = false
      if (managedDoc.privateKey) {
        try {
          await sshPwd.execOverSSH({ host, username: v.defaultUser || 'root', privateKey: managedDoc.privateKey, script: null, timeoutMs: 20000 })
          verifiedManagedKey = true
        } catch (_) { verifiedManagedKey = false }
      }
      r.verifiedManagedKey = verifiedManagedKey

      await vpsPlansOf.updateOne(
        { _id: v._id },
        { $set: {
            sshKeySecretId: v.sshKeySecretId || managed.secretId,
            _abcBackfilledAt: new Date(),
            _abcBackfillResult: { method: applied.method, verifiedManagedKey },
        } })
      r.action = 'BACKFILLED'
    } catch (e) {
      r.action = 'error:' + String(e.message || e).slice(0, 100)
    }
    results.push(r)
    await sleep(200)
  }

  console.log('\n=== RESULTS ===')
  for (const r of results) console.log(JSON.stringify(r))
  const tally = results.reduce((m, r) => { const k = r.action.split(':')[0]; m[k] = (m[k] || 0) + 1; return m }, {})
  console.log('\n=== TALLY ===\n' + JSON.stringify(tally, null, 2))
  if (!RUN) console.log('\n(DRY-RUN — nothing mutated. Re-run with RUN=1 to execute.)')
  await client.close()
})().catch(e => { console.error('FATAL', e); process.exit(1) })
