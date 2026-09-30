'use strict'
// READ-ONLY inventory of existing DigitalOcean Linux VPS for A+B backfill scoping.
// Classifies each box; MUTATES NOTHING.
require('dotenv').config({ path: '/app/backend/.env' })
const { MongoClient } = require('mongodb')
const vmSetup = require('/app/js/vm-instance-setup')
const secretStore = require('/app/js/vps-secret-store')
const sshPwd = require('/app/js/vps-ssh-password')
const reveal = require('/app/js/vps-password-reveal')

const sleep = ms => new Promise(r => setTimeout(r, ms))

;(async () => {
  const client = new MongoClient(process.env.MONGO_URL)
  await client.connect()
  const db = client.db(process.env.DB_NAME || 'test')
  vmSetup.initVpsDb(db)
  secretStore.initSecretStore(db)
  const vpsPlansOf = db.collection('vpsPlansOf')
  const sshKeysOf = db.collection('sshKeysOf')

  // DO Linux only (skip RDP/Windows and non-DO providers)
  const all = await vpsPlansOf.find({
    $and: [
      { $or: [{ provider: 'digitalocean' }, { vpsId: { $regex: '^do-' } }, { contaboInstanceId: { $regex: '^do-' } }] },
      { $or: [{ isRDP: { $ne: true } }, { isRDP: { $exists: false } }] },
      { osType: { $ne: 'Windows' } },
    ],
  }).toArray()

  console.log(`\n=== DO Linux VPS records: ${all.length} ===`)
  const summary = { total: all.length, done: 0, backfillable: 0, reachable_no_cred: 0, needs_recovery_console: 0, no_host: 0, error: 0 }
  const rows = []

  for (const v of all) {
    const host = (v.host && v.host !== 'provisioning...' && v.host !== 'pending') ? v.host : null
    const row = { chatId: v.chatId, vpsId: v.vpsId, host, status: v.status }
    if (v._abcBackfilledAt) { row.klass = 'DONE'; summary.done++; rows.push(row); continue }
    if (!host) { row.klass = 'NO_HOST'; summary.no_host++; rows.push(row); continue }
    try {
      const diag = await sshPwd.diagnoseSshReachability(host, { sshPort: 22, timeoutMs: 6000 })
      row.verdict = diag.verdict
      if (diag.verdict !== 'ok') {
        row.klass = 'NEEDS_RECOVERY_CONSOLE'; summary.needs_recovery_console++; rows.push(row); continue
      }
      // reachable — do we have a usable credential (stored key or recoverable pwd)?
      const keys = await sshKeysOf.find({ telegramId: String(v.chatId) }).toArray()
      const privKeys = keys.filter(k => k.privateKey && String(k.privateKey).includes('PRIVATE KEY'))
                           .map(k => ({ privateKey: k.privateKey, sshKeyName: k.sshKeyName }))
      let cred = privKeys.length ? 'ssh-key' : null
      if (!cred) {
        const rev = await reveal.revealVpsPassword(
          { provider: 'digitalocean', vpsId: v.vpsId, host, defaultUser: v.defaultUser || 'root', rootPasswordSecretId: v.rootPasswordSecretId },
          { sshPrivateKeys: [], verify: false }
        )
        if (rev && rev.status === 'ok' && rev.password) cred = 'password'
      }
      row.cred = cred || 'none'
      if (cred) { row.klass = 'BACKFILLABLE'; summary.backfillable++ }
      else { row.klass = 'REACHABLE_NO_CRED'; summary.reachable_no_cred++ }
    } catch (e) {
      row.klass = 'ERROR'; row.err = String(e.message || e).slice(0, 80); summary.error++
    }
    rows.push(row)
    await sleep(150)
  }

  console.log('\n=== CLASSIFICATION ===')
  for (const r of rows) console.log(JSON.stringify(r))
  console.log('\n=== SUMMARY ===')
  console.log(JSON.stringify(summary, null, 2))
  await client.close()
})().catch(e => { console.error('FATAL', e); process.exit(1) })
