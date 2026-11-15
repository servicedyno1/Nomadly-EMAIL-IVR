#!/usr/bin/env node
// Quiet SIP repair: every active calling number on a paid plan gets one working login on our SIP server; logins that
// already work are kept. Each login is then proven with a REGISTER (Expires 0, no device binding). No customer messages.
//   node js/ops/sip_repair_2026-11.js --env /opt/nomadly/shared/<app>/backend.env [--apply]
'use strict'
const fs = require('fs'), path = require('path'), { spawnSync } = require('child_process')
const ARGS = process.argv.slice(2), envf = ARGS[ARGS.indexOf('--env') + 1]
for (const l of fs.readFileSync(envf, 'utf8').split('\n')) { const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) process.env[m[1]] = m[2].replace(/^"|"$/g, '') }
const APPLY = ARGS.includes('--apply')
const SIP_IP = process.env.SIP_SERVER_IP || '188.166.34.29'
const { MongoClient } = require('mongodb'), sipLogins = require('../sip-logins')
const registers = (domain, user, pass) => {
  const r = spawnSync('python3', [path.join(__dirname, '../../scripts/sw_sip_register_check.py'), domain, user, pass, SIP_IP], { encoding: 'utf8', timeout: 30000, env: { ...process.env, SIP_EXPIRES: '0' } })
  return /2nd:\s*SIP\/2\.0 200/.test(r.stdout || '')
}

;(async () => {
  const cl = await MongoClient.connect(process.env.MONGO_URL), col = cl.db(process.env.DB_NAME).collection('phoneNumbersOf')
  console.log(`${APPLY ? 'APPLY' : 'DRY RUN'} db=${process.env.DB_NAME}`)
  const r = { eligible: 0, repaired: 0, verified: 0, failed: 0 }
  for (const d of await col.find({ 'val.numbers.status': 'active' }).toArray()) for (const n of d.val.numbers || []) {
    const diff = sipLogins.repairFields(d._id, n)
    const ok = n.status === 'active' && process.env.SIP_SERVER_SECRET && n.capabilities?.voice !== false && require('../phone-config').canAccessFeature(n.plan, 'sipCredentials')
    if (!ok) continue
    r.eligible++
    if (diff) {
      console.log(`  ${String(d._id).slice(0, 4)}… ${n.phoneNumber} fix: ${Object.keys(diff).filter(k => !/Password/.test(k)).join(', ')}${diff.sipPassword || diff.telnyxSipPassword ? ' (+password)' : ''}`)
      if (!APPLY) continue
      await sipLogins.ensure(col, d._id, n)
      r.repaired++
    }
    const good = registers(n.sipDomain || sipLogins.brandDomain(d._id), n.telnyxSipUsername || n.sipUsername, n.telnyxSipPassword || n.sipPassword)
    good ? r.verified++ : r.failed++
    if (!good) console.log(`  ❌ ${n.phoneNumber} ${n.telnyxSipUsername || n.sipUsername} REGISTER failed`)
  }
  console.log('RESULT', JSON.stringify(r))
  await cl.close()
})().catch(e => { console.error('ERR', e.message); process.exit(1) })
