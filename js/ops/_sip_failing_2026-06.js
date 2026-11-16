#!/usr/bin/env node
// Read-only: list active calling numbers whose softphone would FAIL to register, by reason.
'use strict'
const fs = require('fs'), path = require('path')
for (const l of fs.readFileSync(path.join(__dirname, '../../backend/.env'), 'utf8').split('\n')) { const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) process.env[m[1]] = m[2].replace(/^"|"$/g, '') }
const { MongoClient } = require('mongodb')
const pc = require('../phone-config')
const mask = p => String(p || '').replace(/^(\+?\d{3})\d+(\d{2})$/, '$1***$2')
;(async () => {
  const cl = await MongoClient.connect(process.env.MONGO_URL), col = cl.db(process.env.DB_NAME).collection('phoneNumbersOf')
  const notify = require('../cloudivr-web/notify')
  const brandDomain = id => (notify.isWebChatId(id) ? pc.WEB_SIP_DOMAIN : pc.SIP_DOMAIN)
  console.log('brand domains: web=', pc.WEB_SIP_DOMAIN, 'bot=', pc.SIP_DOMAIN)
  const problems = []
  for (const d of await col.find({ 'val.numbers.status': 'active' }).toArray()) for (const n of d.val.numbers || []) {
    if (n.status !== 'active') continue
    if (n.kind === 'fax' || n.faxOnly || n.capabilities?.voice === false) continue
    if (!pc.canAccessFeature(n.plan, 'sipCredentials')) continue
    const user = n.telnyxSipUsername || n.sipUsername
    const pass = n.telnyxSipUsername ? (n.telnyxSipPassword || n.sipPassword) : n.sipPassword
    const want = brandDomain(d._id)
    const reasons = []
    if (!user || !pass) reasons.push('NO_LOGIN')
    if (!n.sipDomain) reasons.push('NO_DOMAIN')
    else if (n.sipDomain !== want) reasons.push(`WRONG_DOMAIN(${n.sipDomain}→${want})`)
    if (user && !/^cv[a-z0-9]{8}$/.test(user)) reasons.push('LEGACY_USER')
    if (n.sipDisabled) reasons.push('DISABLED')
    if (reasons.length) problems.push({ chat: String(d._id).slice(0, 6), phone: mask(n.phoneNumber), plan: n.plan, web: notify.isWebChatId(d._id), user: user ? user.slice(0, 4) + '…' : null, cred: n.telnyxCredentialId || null, reasons })
  }
  console.log(`\nActive calling numbers that would FAIL to register: ${problems.length}`)
  console.log(JSON.stringify(problems, null, 1))
  await cl.close()
})().catch(e => { console.error('ERR', e.message); process.exit(1) })
