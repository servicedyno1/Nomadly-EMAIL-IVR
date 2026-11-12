// Telnyx → SignalWire number migration report (dry run by default, buys nothing).
// For every active US/CA cloud number still on Telnyx, find a SignalWire number in the same area code (else same state).
// Usage: MONGO_URL=… DB_NAME=… node scripts/sw_migration_plan.js [--json]
require('dotenv').config({ path: require('path').join(__dirname, '../backend/.env') })
const { MongoClient } = require('mongodb')
const rest = require('../js/signalwire/rest')

const TOLL_FREE = /^8(00|33|44|55|66|77|88)$/
;(async () => {
  const c = await MongoClient.connect(process.env.MONGO_URL)
  const db = c.db(process.env.DB_NAME)
  await rest.refreshOwned(true)
  const docs = await db.collection('phoneNumbersOf').find({ 'val.numbers.0': { $exists: true } }, { projection: { 'val.numbers': 1 } }).toArray()
  const rows = []
  for (const d of docs) {
    for (const n of d.val.numbers || []) {
      if (!['active', 'suspended'].includes(n.status) || n.provider === 'twilio') continue
      if (!/^\+1\d{10}$/.test(n.phoneNumber || '') || String(n.telnyxOrderId || '').startsWith('sw:') || rest.ownsNumber(n.phoneNumber)) continue
      rows.push({ chatId: d._id, number: n.phoneNumber, plan: n.plan, status: n.status, area: n.phoneNumber.slice(2, 5), sip: !!(n.telnyxSipUsername || n.sipUsername), ivr: !!n.features?.ivr?.enabled, fwd: !!n.features?.callForwarding?.enabled, expires: n.expiresAt })
    }
  }
  const byArea = {}
  for (const r of rows) byArea[r.area] = (byArea[r.area] || 0) + 1
  const avail = {}
  for (const area of Object.keys(byArea)) {
    const type = TOLL_FREE.test(area) ? 'toll_free' : 'local'
    const found = await rest.searchNumbers('US', type, area, Math.min(10, byArea[area] + 1))
    avail[area] = found.length || (await rest.searchNumbers('CA', type, area, 2)).length
  }
  const offer = {}
  for (const area of Object.keys(byArea)) offer[area] = (await rest.searchNumbers('US', TOLL_FREE.test(area) ? 'toll_free' : 'local', area, byArea[area] + 2)).map(n => n.phone_number)
  const names = await db.collection('nameOf').find({ _id: { $in: [...new Set(rows.map(r => r.chatId))] } }).toArray().catch(() => [])
  const nameOf = Object.fromEntries(names.map(n => [String(n._id), n.val]))
  const plan = rows.map(r => ({ ...r, user: nameOf[String(r.chatId)] || null, proposed: offer[r.area]?.shift() || null, sameAreaAvailable: avail[r.area] > 0 }))
  if (process.argv.includes('--table')) for (const p of plan) console.log(`ROW|${p.user ? '@' + p.user : p.chatId}|${p.number}|${p.proposed || 'none'}|${p.plan}|${p.status}|${[p.ivr && 'IVR', p.fwd && 'forwarding', p.sip && 'SIP'].filter(Boolean).join('+')}|${String(p.expires || '').slice(0, 10)}`)
  if (process.argv.includes('--json')) console.log(JSON.stringify(plan, null, 1))
  const tf = (x) => plan.filter(x).length
  console.log(`numbers to move: ${plan.length} (customers: ${new Set(plan.map(p => String(p.chatId))).size})`)
  console.log(`same area code available on SignalWire: ${tf(p => p.sameAreaAvailable)} | no same-area stock: ${tf(p => !p.sameAreaAvailable)}`)
  console.log(`with SIP: ${tf(p => p.sip)} | IVR on: ${tf(p => p.ivr)} | forwarding on: ${tf(p => p.fwd)} | suspended: ${tf(p => p.status === 'suspended')}`)
  console.log('area codes:', Object.entries(byArea).sort((a, b) => b[1] - a[1]).map(([a, k]) => `${a}×${k}${avail[a] ? '' : '(none)'}`).join(' '))
  await c.close()
})().catch(e => { console.log('ERR', e.message); process.exit(1) })
