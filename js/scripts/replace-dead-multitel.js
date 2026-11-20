'use strict'
// MultiTEL lost every number. Main numbers → a Retell number of the same type (same area code / toll-free prefix
// when available), swapped in place so menu, forwarding, voicemail, SIP login, plan and renewal stay. Extra numbers
// (parentNumber) and internal test lines are hidden (status 'released', record kept, no renewal). Every old number
// is removed from Bird's caller IDs. Customers get a message (no provider names).
// Usage (prod release dir): node js/scripts/replace-dead-multitel.js [--apply] [--only=<chatId>] [--no-notify]
require('../config-setup')
const { MongoClient } = require('mongodb')
const axios = require('axios')
const rt = require('../retell')
const bird = require('../bird')

const APPLY = process.argv.includes('--apply')
const NOTIFY = !process.argv.includes('--no-notify')
const ONLY = (process.argv.find(a => a.startsWith('--only=')) || '').split('=')[1] || null
const TOLL_FREE = new Set(['800', '833', '844', '855', '866', '877', '888'])
const area = (p) => String(p).replace(/\D/g, '').slice(1, 4)
const e164 = (n) => `+${String(n || '').replace(/\D/g, '')}`
const pretty = (p) => String(p).replace(/^\+1(\d{3})(\d{3})(\d{4})$/, '+1 $1-$2-$3')
const used = new Set()
const TEST_ACCOUNT = '5000000000000004', HIDE_EXTRAS_OF = ['5000000000000143'] // businessintelusa@gmail.com: only his 2 main numbers are replaced
const NEAR = { 202: ['771', '301', '240', '703', '571'] } // no stock in the area code → neighbours first
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

async function pickNear(old) {
  const ac = area(old.phoneNumber), tf = TOLL_FREE.has(ac), cc = !tf && old.country === 'CA' ? 'CA' : 'US' // toll-free is North-America wide → US stock
  const type = tf ? 'toll_free' : 'local'
  for (const a of [ac, ...(NEAR[ac] || []), null]) {
    let r = []
    for (let i = 0; i < 3 && !r.length; i++) { if (i) await sleep(2000); r = (await rt.searchNumbers(cc, type, a, 10)).filter(x => !used.has(x.phone_number)) }
    if (!r.length) continue
    const best = r.find(x => area(x.phone_number) === ac) || r[0]
    used.add(best.phone_number)
    return { phone: best.phone_number, same: area(best.phone_number) === ac, type }
  }
  return null
}

async function tell(db, chatId, text) {
  if (!NOTIFY) return 'skipped'
  try {
    if (require('../cloudivr-web/notify').isWebChatId(chatId)) {
      const notify = require('../cloudivr-web/notify'); notify.setDb(db)
      await notify.push(chatId, text, null, { kind: 'number' }); return 'in-app'
    }
    await axios.post(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN_PROD}/sendMessage`, { chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true }, { timeout: 15000 })
    return 'telegram'
  } catch (e) { return `failed: ${e.response?.data?.description || e.message}` }
}

;(async () => {
  const c = await MongoClient.connect(process.env.MONGO_URL); const db = c.db(process.env.DB_NAME)
  const col = db.collection('phoneNumbersOf'), log = db.collection('numberReplacements')
  const dead = [], swaps = [], hides = []
  for (const d of await col.find(ONLY ? { _id: ONLY } : { 'val.numbers.provider': 'multitel' }).toArray()) {
    for (const n of (d.val?.numbers || []).filter(x => x.provider === 'multitel' && x.status !== 'released')) {
      dead.push(n.phoneNumber)
      // Replace paid, active customer numbers; hide test lines, suspended numbers and the extras listed in HIDE_EXTRAS_OF.
      const why = n.internalTest || String(d._id) === TEST_ACCOUNT ? 'internal test line' : n.status !== 'active' ? `status ${n.status}` : n.parentNumber && HIDE_EXTRAS_OF.includes(String(d._id)) ? `extra of ${n.parentNumber}` : null
      if (why) hides.push({ chatId: d._id, n, why })
      else swaps.push({ chatId: d._id, n })
    }
  }
  console.log(`${swaps.length} to replace, ${hides.length} to hide, ${dead.length} old numbers to remove from Bird`)
  for (const s of swaps) {
    const pick = await pickNear(s.n)
    s.pick = pick
    console.log(`${APPLY ? '→' : '[dry]'} ${s.chatId} ${s.n.phoneNumber} (${s.n.plan}) → ${pick ? `${pick.phone}${pick.same ? ' same prefix' : ' other prefix'}` : 'NONE FOUND'}`)
  }
  for (const h of hides) console.log(`${APPLY ? '→' : '[dry]'} hide ${h.chatId} ${h.n.phoneNumber} (${h.why})`)
  if (!APPLY) { await c.close(); process.exit(0) }

  for (const s of swaps) {
    if (!s.pick) continue
    const bought = await rt.buyNumber(s.pick.phone)
    if (!bought) { console.log(`  ✗ ${s.n.phoneNumber}: buy failed for ${s.pick.phone}`); continue }
    const nu = bought.phone_numbers[0].phone_number, now = new Date().toISOString(), old = s.n.phoneNumber
    const set = { phoneNumber: nu, provider: 'retell', landingNumber: bought._landingNumber, telnyxOrderId: bought.id, replacedFrom: old, replacedAt: now,
      messagingProfileId: null, capabilities: { ...(s.n.capabilities || {}), voice: true, sms: false, fax: false }, 'features.sms': false }
    const $set = Object.fromEntries(Object.entries(set).map(([k, v]) => [`val.numbers.$.${k}`, v]))
    const r = await col.updateOne({ _id: s.chatId, 'val.numbers': { $elemMatch: { phoneNumber: old, status: { $ne: 'released' } } } }, { $set })
    // Settings kept elsewhere follow the number.
    await col.updateMany({ _id: s.chatId }, { $set: { 'val.numbers.$[x].parentNumber': nu } }, { arrayFilters: [{ 'x.parentNumber': old }] })
    await db.collection('bulkCallCampaigns').updateMany({ callerId: old, status: { $nin: ['completed', 'cancelled', 'canceled', 'failed'] } }, { $set: { callerId: nu } })
    await db.collection('sipPresence').updateMany({ phoneNumber: old }, { $set: { phoneNumber: nu } })
    await db.collection('sipPreDialBlocklist').updateMany({ phoneNumber: old }, { $set: { phoneNumber: nu } })
    const cd = await db.collection('callerIdDefaults').findOne({ _id: old })
    if (cd) { await db.collection('callerIdDefaults').insertOne({ ...cd, _id: nu }).catch(() => {}); await db.collection('callerIdDefaults').updateOne({ _id: old }, { $set: { replacedBy: nu } }) }
    const msg = `📞 <b>Your number has been replaced</b>\n\nYour line <code>${pretty(old)}</code> stopped receiving calls on the carrier side, so we moved you to a new number at no cost:\n\n<b>${pretty(nu)}</b>\n\nEverything moved over: your menu, forwarding, voicemail, SIP / softphone login, plan and renewal date. Incoming calls work now; outgoing calls will show the new number within the hour.\n\nPlease update the number anywhere you publish it. Sorry for the trouble.`
    const sent = await tell(db, s.chatId, msg)
    await log.insertOne({ chatId: s.chatId, from: old, to: nu, landing: bought._landingNumber, samePrefix: s.pick.same, reason: 'multitel_lost', notified: sent, at: new Date() })
    console.log(`  ✓ ${old} → ${nu} (landing ${bought._landingNumber}) updated=${r.modifiedCount} notified=${sent}`)
  }
  for (const h of hides) {
    const r = await col.updateOne({ _id: h.chatId, 'val.numbers': { $elemMatch: { phoneNumber: h.n.phoneNumber, status: { $ne: 'released' } } } },
      { $set: { 'val.numbers.$.status': 'released', 'val.numbers.$.autoRenew': false, 'val.numbers.$.releasedReason': 'multitel_lost', 'val.numbers.$.hiddenAt': new Date().toISOString() } })
    console.log(`  ✓ hidden ${h.n.phoneNumber} updated=${r.modifiedCount}`)
  }
  // Bird: drop every old number from the verified caller IDs (never a system caller or a customer's verified own number).
  const keep = new Set([...require('../ivr-outbound').SYSTEM_CALLERS().map(e164), ...(await db.collection('webCallerIds').find({ status: 'verified' }, { projection: { _id: 1 } }).toArray()).map(d => e164(d._id))])
  const deadSet = new Set(dead.map(e164).filter(p => !keep.has(p)))
  let removed = 0
  for (const v of (await bird.listCallerIds()).filter(v => deadSet.has(e164(v.phone_number)))) if (await bird.deleteCallerId(v.id)) removed++
  await db.collection('birdCallerIdVerify').updateMany({ _id: { $in: [...deadSet] } }, { $set: { status: 'removed', removedAt: new Date() } })
  console.log(`Bird: removed ${removed} old caller ID(s). New numbers link to Bird automatically (about one every 3 min).`)
  await c.close(); process.exit(0)
})().catch(e => { console.error('ERR', e.message); process.exit(1) })
