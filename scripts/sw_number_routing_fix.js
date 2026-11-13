#!/usr/bin/env node
// Finds SignalWire numbers / SIP endpoints used by this brand's customers that send calls or texts anywhere but
// this live app (e.g. a preview "-dev" topic) and, with --confirm, points them at the live app.
//   node scripts/sw_number_routing_fix.js [--env /path/backend.env] [--confirm]
'use strict'
const fs = require('fs'), path = require('path')
const arg = (k) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : null }
const ENVF = arg('--env') || path.resolve(__dirname, '../backend/.env')
for (const l of fs.readFileSync(ENVF, 'utf8').split('\n')) { const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) process.env[m[1]] = m[2].replace(/^"|"$/g, '') }
const { MongoClient } = require('mongodb')
const rest = require('../js/signalwire/rest')
const CONFIRM = process.argv.includes('--confirm')

async function all(url) {
  const out = []
  while (url) { const r = (await rest.http().get(url)).data; out.push(...(r.data || [])); url = r.links?.next ? String(r.links.next).replace(/^https?:\/\/[^/]+/, '') : null }
  return out
}

;(async () => {
  const cl = await MongoClient.connect(process.env.MONGO_URL), db = cl.db(process.env.DB_NAME)
  try {
    const used = new Map()
    for (const d of await db.collection('phoneNumbersOf').find({}, { projection: { 'val.numbers.phoneNumber': 1, 'val.numbers.status': 1 } }).toArray())
      for (const n of d.val?.numbers || []) if (n.phoneNumber && !/released|expired|cancel/i.test(String(n.status || ''))) used.set(n.phoneNumber, String(d._id))
    const want = { topic: rest.liveTopic(), sms: rest.handlerBody().message_request_url }
    console.log(`brand ${rest.brandSlug()} | customer numbers ${used.size} | live topic "${want.topic}" | texts → ${want.sms}`)
    let bad = 0, fixed = 0
    const callTopic = (x) => x.call_relay_topic || x.call_relay_context
    for (const n of await all('/api/relay/rest/phone_numbers?page_size=1000')) {
      if (!used.has(n.number)) continue
      const wrongCall = !/^relay_(topic|context)$/.test(n.call_handler) || callTopic(n) !== want.topic
      const wrongSms = n.message_request_url !== want.sms
      if (!wrongCall && !wrongSms) continue
      bad++
      console.log(`  ${n.number} (customer ${used.get(n.number)}): calls → ${n.call_handler}:${callTopic(n) || '-'}${wrongSms ? ` | texts → ${n.message_request_url || '-'}` : ''}`)
      if (CONFIRM && await rest.configureNumber(n.id)) { fixed++; console.log('    ✅ now points at the live app') }
    }
    for (const s of await all('/api/relay/rest/endpoints/sip?page_size=1000')) {
      const num = s.caller_id || s.send_as
      if (!used.has(num) || (/^relay_(topic|context)$/.test(s.call_handler) && callTopic(s) === want.topic)) continue
      bad++
      console.log(`  SIP ${s.username} (${num}): calls → ${s.call_handler}:${callTopic(s) || '-'}`)
      if (CONFIRM) {
        try { await rest.http().put(`/api/relay/rest/endpoints/sip/${s.id}`, { call_handler: 'relay_topic', call_relay_topic: want.topic }); fixed++; console.log('    ✅ now points at the live app') } catch (e) { console.log('    ❌', rest.errOf(e)) }
      }
    }
    console.log(`RESULT: ${bad} pointing elsewhere${CONFIRM ? `, ${fixed} fixed` : ' (dry run — add --confirm to fix)'}`)
  } finally { await cl.close() }
})().catch(e => { console.error('ERR', e.message); process.exit(1) })
