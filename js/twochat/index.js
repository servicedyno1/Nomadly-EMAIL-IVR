'use strict'
// 2Chat UK numbers (local, mobile, toll-free). Each one gets its own Infobip landing number; an admin sets the
// 2Chat call flow "Forward to number → landing" once (no API for it). The watcher below spots when that works
// (Bird's caller-ID call arrives on the landing), then switches the number live and tells the customer.
const axios = require('axios')

const log = (...a) => console.log('[2Chat]', ...a)
const BASE = 'https://api.p.2chat.io/open'
const enabled = () => !!process.env.TWOCHAT_API_KEY
const selling = () => enabled() && String(process.env.NUMBER_PROVIDERS || '').toLowerCase().split(',').map(x => x.trim()).includes('2chat')
const http = () => axios.create({ baseURL: BASE, headers: { 'X-User-API-Key': process.env.TWOCHAT_API_KEY }, timeout: 20000 })
const errOf = (e) => String(e.response?.data?.error_message || e.response?.data?.message || e.message)
const TYPES = { local: 'local', mobile: 'mobile', toll_free: 'tollfree' }
const sellsType = (cc, type) => cc === 'GB' && !!TYPES[type]
const isTc = (id) => String(id || '').startsWith('tc:')

const searched = new Map() // placeholder (bare prefix, e.g. +4420) → { cc, type, groupId, label }
const digits = (x) => String(x || '').replace(/\D/g, '')
// 2Chat picks the exact number inside a location group, so results are the groups themselves (like MultiTEL's
// order-only prefixes): phone_number is the bare prefix and the bought number comes back as _retriedNumber.
async function searchNumbers(countryCode, numberType = 'local', areaCode = null, limit = 5) {
  const cc = String(countryCode || '').toUpperCase(), type = numberType || 'local'
  if (!selling() || !sellsType(cc, type)) return []
  try {
    const params = { country: cc, did_type: TYPES[type] }
    let groups = ((await http().get('/numbers/groups', { params })).data?.data?.groups || [])
      .filter(g => !g.requirements?.length && (g.features || ['voice']).includes('voice') && digits(g.prefix).length > 2)
    // 2Chat ignores its own prefix filter, so match the area code (020, 161…) or a town name here.
    const want = String(areaCode || '').trim(), d = digits(want).replace(/^0/, '')
    if (want) groups = groups.filter(g => (d ? digits(g.prefix).startsWith(`44${d}`) : false) || (!d && String(g.location || '').toLowerCase().includes(want.toLowerCase())))
    if (type === 'local' && !areaCode) groups = [...groups.filter(g => /^London$/i.test(g.location)), ...groups.filter(g => !/^London$/i.test(g.location))]
    const seen = new Set()
    return groups.filter(g => !seen.has(digits(g.prefix)) && seen.add(digits(g.prefix))).slice(0, limit).map(g => {
      const num = `+${digits(g.prefix)}`
      searched.set(num, { cc, type, groupId: g.id, label: g.prefix })
      return { record_type: 'available_phone_number', phone_number: num, _assigned: true, region_information: [{ region_type: 'location', region_name: type === 'toll_free' ? `Freephone ${g.prefix}` : `${g.location} ${g.prefix}` }],
        cost_information: { currency: 'USD', monthly_cost: String(g.price?.monthly_price || '5'), upfront_cost: String(g.price?.setup_price || '0') }, _capabilities: { voice: true, sms: false, mms: false, fax: false }, _provider: '2chat' }
    })
  } catch (e) { log('search:', errOf(e)); return [] }
}
const isTcSearched = (n) => searched.has(String(n || ''))
const searchedMeta = (n) => searched.get(String(n)) || null
const remember = (n, meta) => { if (meta) searched.set(String(n), meta) }

async function ownedNumbers() {
  const out = []
  for (let page = 0; page < 20; page++) {
    const r = (await http().get('/voip/virtual-numbers', { params: { page_number: page } })).data
    if (!r?.numbers?.length) break
    out.push(...r.numbers)
  }
  return out
}
const virtualNumberUuid = async (number) => (await ownedNumbers()).find(x => x.phone_number === number)?.uuid || null

// Landing number: bought on Infobip automatically, or one the admin bought by hand (routed to CloudIVR here).
async function attachLanding(number) {
  const ib = require('../infobip'), e = `+${digits(number)}`
  const hit = ((await ib.http().get('/numbers/1/numbers', { params: { limit: 1000 } })).data?.numbers || []).find(n => `+${digits(n.number)}` === e)
  if (!hit) throw new Error(`${e} isn't on our Infobip account`)
  if (D && await D.db.collection('phoneNumbersOf').findOne({ $or: [{ 'val.numbers.landingNumber': e }, { 'val.numbers.phoneNumber': e }] })) throw new Error(`${e} is already in use`)
  await ib.http().post(`/numbers/2/numbers/${hit.numberKey}/voice`, { action: { type: 'FORWARD_TO_SUBSCRIPTION', callsConfigurationId: ib.configId() } })
  return { number: e, key: hit.numberKey }
}
const landingFor = (landing) => (landing ? attachLanding(landing) : require('../retell').buyLanding())
const done = (got, landing, placeholder) => {
  const id = `tc:${got.uuid}`
  return { id, status: 'success', requirements_met: true, phone_numbers: [{ id, phone_number: got.phone_number, status: 'success' }], _provider: '2chat', _landingNumber: landing.number, _needsForwarding: true, ...(got.phone_number !== placeholder ? { _retriedNumber: got.phone_number } : {}), _assigned: true }
}

// Buy one number from the group → finished order, or a quiet "setting up" hold when 2Chat or Infobip fails
// (the order queue retries; the admin can finish it by hand on the dashboard). Never retried inside: a repeat could buy twice.
async function buyNumber(placeholder) {
  const s = searched.get(placeholder)
  if (!selling() || !s?.groupId) return null
  let res = null, got = s.bought || null
  try {
    if (!got) {
      const before = new Set((await ownedNumbers()).map(x => x.uuid))
      res = (await http().post('/numbers/reservations', { group_id: s.groupId })).data?.data?.reservation_details
      if (!res?.uuid) throw new Error('2Chat could not reserve a number there')
      const p = (await http().post('/numbers/purchase', { number: res.number })).data
      got = (await ownedNumbers()).find(x => !before.has(x.uuid))
      if (!got) throw new Error(`2Chat did not buy it (${JSON.stringify(p?.failed || p).slice(0, 160)})`)
      res = null
    }
    const landing = await require('../retell').buyLanding().catch(e => { s.bought = { uuid: got.uuid, phone_number: got.phone_number }; throw new Error(`Infobip landing: ${e.message}`) })
    searched.delete(placeholder)
    log(`Bought ${got.phone_number} (${got.uuid}) in ${s.label} → landing ${landing.number}; waiting for the 2Chat forward`)
    return done(got, landing, placeholder)
  } catch (e) {
    if (res?.uuid) await http().delete(`/numbers/reservations/${res.uuid}`).catch(() => {})
    log(`buy ${placeholder}:`, errOf(e))
    return require('../pending-orders').pendingResult('2chat', placeholder, { ...s, why: errOf(e).slice(0, 200) })
  }
}

// Admin finished it by hand: a number already bought on our 2Chat account (+ optional own landing number).
async function adopt(number, landing = null, meta = null) {
  const e = `+${digits(number)}`
  const got = meta?.bought?.phone_number === e ? meta.bought : (await ownedNumbers()).find(x => x.phone_number === e)
  if (!got) throw new Error(`${e} isn't on our 2Chat account yet — buy it there first`)
  if (D && await D.db.collection('phoneNumbersOf').findOne({ 'val.numbers': { $elemMatch: { phoneNumber: e, status: { $nin: ['released', 'expired'] } } } })) throw new Error(`${e} already belongs to a customer`)
  return done(got, await landingFor(landing), null)
}

let D = null
async function releaseNumber(id) {
  try {
    const raw = String(id).replace(/^tc:/, '')
    const uuid = raw.startsWith('DID') ? raw : await virtualNumberUuid(raw)
    if (uuid) await http().delete(`/voip/virtual-numbers/${uuid}`)
    const doc = D && await D.db.collection('phoneNumbersOf').findOne({ 'val.numbers.telnyxOrderId': id })
    const landing = doc?.val?.numbers?.find(n => n.telnyxOrderId === id)?.landingNumber
    if (landing) await require('../retell').releaseLanding(landing).catch(e => log(`landing release ${landing}:`, e.message))
    return true
  } catch (e) { log(`release ${id}:`, errOf(e)); return false }
}

// The forwarded leg shows the 2Chat number as caller: read the real caller from 2Chat's live call history.
async function realCaller(number) {
  if (!enabled()) return null
  try {
    const r = await axios.get(`${BASE}/voip/call-history`, { params: { page_number: 0 }, headers: { 'X-User-API-Key': process.env.TWOCHAT_API_KEY }, timeout: 2500 })
    const c = (r.data?.cdrs || []).find(c => c.direction === 'I' && c.received_on_number === number && Date.now() - new Date(c.created_at).getTime() < 60000)
    return /^\+\d{6,15}$/.test(String(c?.from || '')) && c.from !== number ? c.from : null
  } catch (e) { log('call history:', e.response?.status || e.message); return null }
}

// ── Setup watcher: numbers waiting for the admin's 2Chat forward ──
const MIN = 60000
const nextGap = (ageMs) => (ageMs < 2 * 60 * MIN ? 5 * MIN : 30 * MIN)
const GIVE_UP_MS = 7 * 24 * 60 * MIN, REMIND_MS = 12 * 60 * MIN
const adminText = (n) => `🇬🇧 <b>2Chat number to finish: ${n.phoneNumber}</b>\nIn 2Chat → Channels → Virtual numbers → ${n.phoneNumber} → Inbound call handling → call flow: <b>Forward to number → ${n.landingNumber}</b> (nothing before it), then save.\nCloudIVR checks it every few minutes and switches the number on by itself.`

async function tick() {
  if (!D) return
  const col = D.db.collection('phoneNumbersOf'), vcol = D.db.collection('birdCallerIdVerify')
  // Any 2Chat number (web or bot purchase) not yet confirmed forwarding is held as "setting up" until it is.
  const waiting = (x) => x.provider === '2chat' && !x.forwardSetup?.doneAt && ['active', 'provisioning'].includes(x.status)
  const docs = await col.find({ 'val.numbers': { $elemMatch: { provider: '2chat', 'forwardSetup.doneAt': { $exists: false }, status: { $in: ['active', 'provisioning'] } } } }).toArray()
  for (const d of docs) for (const n of d.val.numbers.filter(waiting)) {
    const now = Date.now(), set = (u) => col.updateOne({ _id: d._id, 'val.numbers.phoneNumber': n.phoneNumber }, { $set: Object.fromEntries(Object.entries(u).map(([k, v]) => [`val.numbers.$.${k}`, v])) })
    if (!n.awaitingForward || n.status !== 'provisioning') await set({ awaitingForward: true, status: 'provisioning' })
    const st = n.forwardSetup || {}
    if (!st.alertedAt || now - new Date(st.alertedAt).getTime() > REMIND_MS) {
      D.notifyAdmin(adminText(n)); D.adminEmail?.(`Finish 2Chat number ${n.phoneNumber}`, `<p>${adminText(n).replace(/<\/?b>/g, '').replace(/\n/g, '</p><p>')}</p>`)
      await set({ forwardSetup: { ...st, alertedAt: new Date() } }); st.alertedAt = new Date()
    }
    const v = await vcol.findOne({ _id: n.phoneNumber })
    if (v?.status === 'verified' && (!st.armedAt || new Date(v.verifiedAt || 0) >= new Date(st.armedAt))) {
      await col.updateOne({ _id: d._id, 'val.numbers.phoneNumber': n.phoneNumber }, { $set: { 'val.numbers.$.status': 'active', 'val.numbers.$.forwardSetup.doneAt': new Date() }, $unset: { 'val.numbers.$.awaitingForward': '' } })
      log(`${n.phoneNumber} forward works → live`)
      if (require('../phone-config').canAccessFeature(n.plan, 'sipCredentials')) await require('../sip-logins').ensure(col, d._id, { ...n, status: 'active' }).catch(e => log(`SIP login ${n.phoneNumber}: ${e.message}`))
      D.notifyAdmin(`✅ 2Chat number ${n.phoneNumber} is live (forward to ${n.landingNumber} confirmed, caller ID linked on Bird).`)
      await D.tellCustomer(d._id, n.phoneNumber).catch(e => log(`tell ${d._id}: ${e.message}`))
      continue
    }
    const age = now - new Date(n.purchaseDate || now).getTime()
    if (age > GIVE_UP_MS) {
      if (!st.gaveUpAt) { await set({ forwardSetup: { ...st, gaveUpAt: new Date() } }); D.notifyAdmin(`🚨 2Chat number ${n.phoneNumber} still isn't forwarding after 7 days. ${adminText(n)}`) }
      continue
    }
    if (st.nextTryAt && new Date(st.nextTryAt) > new Date()) continue
    if (await vcol.findOne({ status: 'calling', expiresAt: { $gt: new Date() } })) continue // one Bird verification call at a time
    const r = await D.birdVerify().arm(n.phoneNumber, { name: 'CloudIVR UK', ttlMs: 4 * MIN }).catch(e => ({ error: e.message }))
    await set({ forwardSetup: { ...st, armedAt: new Date(), tries: (st.tries || 0) + 1, nextTryAt: new Date(now + nextGap(age)), lastError: r.error || null } })
    log(`${n.phoneNumber}: checking forward (try ${(st.tries || 0) + 1})${r.error ? ` — ${r.error}` : ''}`)
  }
}

function init(deps) {
  D = deps
  require('../active-slot').singletonInterval('twochat-forward-setup', () => tick().catch(e => log('tick:', e.message)), MIN)
}

// Admin "Check now": the next watcher pass calls this number straight away.
async function checkNow(number) {
  const r = await D.db.collection('phoneNumbersOf').updateOne({ 'val.numbers': { $elemMatch: { phoneNumber: number, provider: '2chat', awaitingForward: true } } }, { $set: { 'val.numbers.$.forwardSetup.nextTryAt': new Date(0) } })
  if (r.modifiedCount) tick().catch(e => log('tick:', e.message))
  return { queued: !!r.modifiedCount }
}

module.exports = { adopt, attachLanding, enabled, selling, sellsType, isTc, searchNumbers, isTcSearched, searchedMeta, remember, buyNumber, releaseNumber, realCaller, init, tick, adminText, COST: { local: 5, mobile: 5, toll_free: 5 } }
