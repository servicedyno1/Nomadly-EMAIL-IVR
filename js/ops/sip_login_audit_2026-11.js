#!/usr/bin/env node
// Read-only: every active SIP login of a brand is tried against the SIP server (REGISTER query, no Contact — changes
// nothing) and recent AI-support SIP complaints are listed. node sip_login_audit_2026-11.js --env <backend.env> [--days 7]
'use strict'
const fs = require('fs')
const A = process.argv.slice(2), arg = (k, d) => (A.includes(k) ? A[A.indexOf(k) + 1] : d)
for (const l of fs.readFileSync(arg('--env'), 'utf8').split('\n')) { const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) process.env[m[1]] = m[2].replace(/^"|"$/g, '') }
const { MongoClient } = require(process.cwd() + '/../node_modules/mongodb')
const { probe } = require(process.cwd() + '/sip-selftest.js')
const HOST = '188.166.34.29'
const BOT = process.env.SIP_DOMAIN || 'sip.speechcue.com', WEB = process.env.CLOUDIVR_SIP_DOMAIN || 'sip.cloudivr.net'
const isWeb = (id) => /^5\d{15}$/.test(String(id))
;(async () => {
  const cl = await MongoClient.connect(process.env.MONGO_URL), db = cl.db(process.env.DB_NAME)
  const since = new Date(Date.now() - Number(arg('--days', 7)) * 86400000)
  let fails = 0
  const rows = []
  for await (const d of db.collection('phoneNumbersOf').find({ 'val.numbers.status': 'active' })) {
    for (const n of d.val?.numbers || []) {
      if (n.status !== 'active') continue
      const shown = n.telnyxSipUsername || n.sipUsername
      if (!shown) { rows.push({ chat: d._id, phone: n.phoneNumber, plan: n.plan, note: 'NO LOGIN' }); continue }
      const domain = isWeb(d._id) ? WEB : BOT
      const tries = [...new Set([[n.telnyxSipUsername, n.telnyxSipPassword], [n.sipUsername, n.sipPassword], [n.telnyxSipUsername, n.sipPassword]].filter(x => x[0] && x[1]).map(x => x.join('\u0000')))].map(x => x.split('\u0000'))
      const res = []
      for (const [u, p] of tries) {
        if (fails >= 25) { res.push(`${u}:skipped`); continue }
        const r = await probe({ host: HOST, domain, user: u, pass: p })
        if (r.status !== 200) fails++
        res.push(`${u}:${r.status}${r.status === 200 ? `(${r.contacts} dev)` : ''}`)
      }
      rows.push({ chat: d._id, web: isWeb(d._id), phone: n.phoneNumber, plan: n.plan, domain, stored: n.sipDomain, cred: String(n.telnyxCredentialId || '').slice(0, 6), userSame: n.sipUsername === n.telnyxSipUsername, passSame: n.sipPassword === n.telnyxSipPassword, disabled: !!n.sipDisabled, res: res.join(' | ') })
    }
  }
  console.log(`== ${process.env.DB_NAME} bot=${BOT} web=${WEB} numbers=${rows.length}`)
  for (const r of rows) console.log(JSON.stringify(r))
  const seen = await db.collection('sipPresence').find({}).sort({ at: -1 }).limit(60).toArray().catch(() => [])
  console.log('-- presence', seen.map(s => `${s._id}:${s.registered ? 'in' : 'out'}@${new Date(s.at || s.updatedAt || 0).toISOString().slice(5, 16)}:${String(s.ua || '').slice(0, 18)}`).join(' ; '))
  const re = /\bsip\b|regist|softphone|zoiper|linphone|log ?in|sign ?in|password|credential|error 57|408|403|401/i
  for (const col of ['aiSupportChats', 'supportChats']) {
    const chats = await db.collection(col).find({ $or: [{ timestamp: { $gte: since } }, { createdAt: { $gte: since } }, { timestamp: { $gte: since.toISOString() } }] }).sort({ _id: 1 }).toArray().catch(() => [])
    console.log(`-- ${col}: ${chats.length} in window`)
    for (const c of chats) { const t = String(c.content || c.message || c.text || ''); if (c.role !== 'assistant' && re.test(t)) console.log(`[${new Date(c.timestamp || c.createdAt).toISOString().slice(0, 16)}] ${c.chatId} ${c.role || ''}: ${t.slice(0, 260).replace(/\n/g, ' ')}`) }
  }
  await cl.close()
})().catch(e => { console.error('ERR', e.message); process.exit(1) })
