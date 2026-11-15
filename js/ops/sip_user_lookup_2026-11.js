#!/usr/bin/env node
// Read-only: find a Telegram username across brand DBs and show SIP state + AI support chats. node sip_user_lookup_2026-11.js --env <backend.env> --user <name>
'use strict'
const fs = require('fs')
const A = process.argv.slice(2), arg = (k) => A[A.indexOf(k) + 1]
for (const l of fs.readFileSync(arg('--env'), 'utf8').split('\n')) { const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) process.env[m[1]] = m[2].replace(/^"|"$/g, '') }
const user = arg('--user').replace(/^@/, '').toLowerCase()
const { MongoClient } = require('mongodb')
const mask = (s) => (s ? String(s).slice(0, 2) + '…(' + String(s).length + ')' : '-')
;(async () => {
  const cl = await MongoClient.connect(process.env.MONGO_URL), db = cl.db(process.env.DB_NAME)
  const hits = await db.collection('nameOf').find({ $or: [{ val: new RegExp(`^@?${user}$`, 'i') }, { username: new RegExp(`^@?${user}$`, 'i') }] }).toArray()
  const re = new RegExp(user, 'i')
  for (const c of await db.collection('chatIdOf').find({ _id: re }).limit(5).toArray()) if (!hits.some(h => String(h._id) === String(c.val))) hits.push({ _id: c.val })
  for (const c of await db.collection('nameOf').find({ val: re }).limit(5).toArray()) if (!hits.some(h => String(h._id) === String(c._id))) hits.push({ _id: c._id })
  const sipu = A.includes('--sip') ? arg('--sip') : null, ph = A.includes('--phone') ? arg('--phone') : null
  if (sipu || ph) for (const d of await db.collection('phoneNumbersOf').find({ $or: [...(sipu ? [{ 'val.numbers.sipUsername': sipu }, { 'val.numbers.telnyxSipUsername': sipu }, { 'val.numbers.extraSip.username': sipu }] : []), ...(ph ? [{ 'val.numbers.phoneNumber': ph }] : [])] }, { projection: { _id: 1 } }).toArray()) if (!hits.some(h => String(h._id) === String(d._id))) hits.push({ _id: d._id })
  for (const h of hits) h.name = (await db.collection('nameOf').findOne({ _id: h._id }))?.val
  console.log(process.env.DB_NAME, 'hits', hits.map(h => [h._id, h.name]), hits.map(h => h._id))
  for (const h of hits) {
    const id = h._id
    const p = await db.collection('phoneNumbersOf').findOne({ _id: id })
    for (const n of p?.val?.numbers || []) console.log(JSON.stringify({ phone: n.phoneNumber, status: n.status, plan: n.plan, provider: n.provider, country: n.country, sipUser: n.sipUsername, tUser: n.telnyxSipUsername, pw: mask(n.sipPassword), tpw: mask(n.telnyxSipPassword), same: n.sipPassword === n.telnyxSipPassword, cred: String(n.telnyxCredentialId || '').slice(0, 14), domain: n.sipDomain, sipDisabled: n.sipDisabled, extras: (n.extraSip || []).map(e => e.username), exp: n.expiresAt, conn: n.connectionId || n.telnyxConnectionId, fwd: n.features?.callForwarding?.enabled, ring: n.features?.sipRing ?? n.ringSip }))
    const chats = await db.collection('aiSupportChats').find({ chatId: { $in: [id, String(id), Number(id)] } }).sort({ _id: -1 }).limit(40).toArray()
    for (const c of chats.reverse()) console.log(`[${c.timestamp || c.createdAt || ''}] ${c.role}: ${String(c.content || c.message || '').slice(0, 400).replace(/\n/g, ' ')}`)
  }
  await cl.close()
})().catch(e => { console.error('ERR', e.message); process.exit(1) })
