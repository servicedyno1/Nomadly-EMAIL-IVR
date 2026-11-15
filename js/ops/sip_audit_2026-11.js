#!/usr/bin/env node
// Read-only SIP login audit: node js/ops/sip_audit_2026-11.js --env <backend.env> [--users a,b,c]
'use strict'
const fs = require('fs')
const ARGS = process.argv.slice(2), envf = ARGS[ARGS.indexOf('--env') + 1]
for (const l of fs.readFileSync(envf, 'utf8').split('\n')) { const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) process.env[m[1]] = m[2].replace(/^"|"$/g, '') }
const users = ARGS.includes('--users') ? ARGS[ARGS.indexOf('--users') + 1].split(',') : []
const { MongoClient } = require('mongodb')
const mask = (s) => (s ? String(s).slice(0, 3) + '…' + String(s).length : '-')
;(async () => {
  const cl = await MongoClient.connect(process.env.MONGO_URL), db = cl.db(process.env.DB_NAME), col = db.collection('phoneNumbersOf')
  const stats = {}, bump = (k) => { stats[k] = (stats[k] || 0) + 1 }
  const rows = []
  for (const d of await col.find({}).toArray()) for (const n of d.val?.numbers || []) {
    const web = /^w/i.test(String(d._id)) || String(d._id).length > 15
    const tag = `${n.status}|${n.plan}|${web ? 'web' : 'bot'}`
    const all = [n.sipUsername, n.telnyxSipUsername, ...(n.extraSip || []).map(e => e.username)]
    if (users.length && all.some(u => users.includes(u))) rows.push({ chat: String(d._id), phone: n.phoneNumber, status: n.status, plan: n.plan, provider: n.provider, sipUser: n.sipUsername, tUser: n.telnyxSipUsername, pw: mask(n.sipPassword), tpw: mask(n.telnyxSipPassword), same: n.sipPassword === n.telnyxSipPassword, cred: String(n.telnyxCredentialId || '').slice(0, 12), domain: n.sipDomain, sipDisabled: n.sipDisabled, extras: (n.extraSip || []).map(e => e.username), expiry: n.expiresAt || n.expiry, replacedBy: n.replacedBy, released: n._releasedReason })
    if (n.status !== 'active') continue
    bump(`active ${tag}`)
    if (n.kind === 'fax' || n.faxOnly) { bump('active fax-only'); continue }
    if (!n.sipUsername && !n.telnyxSipUsername) bump(`NO SIP ${tag}`)
    else {
      const cred = String(n.telnyxCredentialId || '')
      bump(`cred ${cred.startsWith('kam:') ? 'kam' : cred.startsWith('sw:') ? 'sw' : /^\d{6,}$/.test(cred) ? 'telnyx-conn' : cred ? 'telnyx-other' : 'none'}`)
      if (n.telnyxSipUsername && n.sipUsername && n.telnyxSipUsername !== n.sipUsername) bump('user mismatch sip vs telnyx')
      if (n.telnyxSipUsername && n.telnyxSipPassword && n.sipPassword && n.telnyxSipPassword !== n.sipPassword) bump('pw mismatch sip vs telnyx')
      if (n.telnyxSipUsername && !n.telnyxSipPassword && !n.sipPassword) bump('NO PASSWORD')
      if (!/^cv[a-z0-9]{8}$/.test(n.telnyxSipUsername || n.sipUsername)) bump('long/legacy username')
      bump(`domain ${n.sipDomain || 'none'}`)
      if (n.sipDisabled) bump('sipDisabled')
    }
  }
  console.log(process.env.DB_NAME, JSON.stringify(stats, null, 1))
  if (rows.length) console.log(JSON.stringify(rows, null, 1))
  await cl.close()
})().catch(e => { console.error('ERR', e.message); process.exit(1) })
