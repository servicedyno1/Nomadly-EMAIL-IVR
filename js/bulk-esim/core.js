'use strict'
// eSIM BulkSMS engine (USA/Canada). One shared database for every bot (env BULK_ESIM_MONGO_URL / BULK_ESIM_DB, else the bot's own DB):
// eSIM pool, quotas, bookings, campaigns, the send queue, sessions, inbound routing, health, credit watch and reports.
// Customer id (cid) = `${brand}:${chatId}`. Only one process sends (leader lock); each bot delivers its own customers' notices (bsNotify).
const crypto = require('crypto')
const { MongoClient } = require('mongodb')
const P = require('./provider-spenza')

const DEFAULTS = {
  defaultDailyLimit: 2000, maxCustomerLimit: 10000, resetHourUtc: 0, countSegments: false, refundFailed: true,
  platformPerMin: 30, esimPerMin: 10, platformDailyLimit: 40000, slotUtilization: 0.8,
  minVolume: 500, maxVolume: 2000, pricePerSms: 0.05, freeBookings: false, freeVolume: 500, holdMinutes: 15, testSends: 2,
  minEsims: 1, maxEsims: 20, initialEsims: 1, autoProvision: false, manualApproval: true, provisionThreshold: 0.8, provisionBudget: 100,
  minCredit: 10, healthEveryMin: 10, testEveryHours: 6, sessionHours: 72, emergencyStop: false,
}
const LIVE_BOOKING = ['pending', 'awaiting_payment', 'confirmed', 'provisioning', 'scheduled', 'processing']
const USABLE = ['active', 'available', 'allocated']
const GOOD_HEALTH = ['healthy', 'degraded']
const STOP = /^\s*(stop|stopall|unsubscribe|cancel|end|quit|optout|opt out)\s*$/i
const HELP = /^\s*(help|info)\s*$/i
const NANP = /^\+1[2-9]\d{2}[2-9]\d{6}$/
const MIN = 60000, HOUR = 3600000, DAY = 86400000

let S = null
const C = (n) => S.db.collection(n)
const id = (p) => `${p}_${crypto.randomBytes(6).toString('hex')}`
const cidOf = (brand, chatId) => `${brand}:${chatId}`
const segs = (t) => { const s = String(t || ''); const gsm = /^[\x20-\x7E\n\r£¥èéùìòÇØøÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ¡ÄÖÑÜ§¿äöñüà€]*$/.test(s); const one = gsm ? 160 : 70, many = gsm ? 153 : 67; return s.length <= one ? 1 : Math.ceil(s.length / many) }
const normPhone = (p) => { const d = String(p || '').replace(/[^\d]/g, ''); return d.length === 10 ? `+1${d}` : d.length === 11 && d[0] === '1' ? `+${d}` : '' }

async function cfg() { return { ...DEFAULTS, ...((await C('bsConfig').findOne({ _id: 'settings' }))?.values || {}) } }
const dayKey = (t, c) => new Date(new Date(t).getTime() - (c.resetHourUtc || 0) * HOUR).toISOString().slice(0, 10)
const nextReset = (c) => { const d = new Date(Date.now() - c.resetHourUtc * HOUR); d.setUTCHours(0, 0, 0, 0); return new Date(d.getTime() + DAY + c.resetHourUtc * HOUR) }
const audit = (action, d = {}) => C('bsAudit').insertOne({ action, ...d, at: new Date() }).catch(() => {})
const incident = (type, d = {}) => C('bsIncidents').insertOne({ type, ...d, at: new Date() }).catch(() => {})
const alert = (text) => { try { S.notifyAdmin?.(`🛰 <b>eSIM BulkSMS</b>\n${text}`) } catch (_) { /* best effort */ } }
// Customer notices go through the owning bot (it may live in another process).
const notify = (cid, type, text, extra = {}) => { const [brand, chatId] = cid.split(':'); return C('bsNotify').insertOne({ brand, chatId, type, text, ...extra, sent: false, at: new Date() }) }

// ---------- customers + quota ----------
async function customer(brand, chatId) {
  const cid = cidOf(brand, chatId)
  await C('bsCustomers').updateOne({ _id: cid }, { $setOnInsert: { brand, chatId: String(chatId), status: 'active', dailyLimit: null, createdAt: new Date() } }, { upsert: true })
  return C('bsCustomers').findOne({ _id: cid })
}
async function usage(cid) {
  const c = await cfg(), cu = await C('bsCustomers').findOne({ _id: cid }), limit = cu?.dailyLimit ?? c.defaultDailyLimit
  const d = await C('bsDaily').findOne({ _id: `${cid}:${dayKey(Date.now(), c)}` })
  const used = d?.used || 0
  return { limit, used, remaining: Math.max(0, limit - used), pct: limit ? Math.round((used / limit) * 1000) / 10 : 0, resetAt: nextReset(c), delivered: d?.sent || 0, failed: d?.failed || 0, unit: c.countSegments ? 'SMS segments' : 'messages' }
}
// Atomic: never lets `used` pass the limit (a full day makes the upsert collide → rejected).
async function reserve(cid, n, c) {
  const cu = await C('bsCustomers').findOne({ _id: cid }), limit = cu?.dailyLimit ?? c.defaultDailyLimit, day = dayKey(Date.now(), c)
  try { await C('bsDaily').findOneAndUpdate({ _id: `${cid}:${day}`, used: { $lte: limit - n } }, { $inc: { used: n }, $setOnInsert: { cid, day, limit } }, { upsert: true }); return day } catch (e) { if (e.code === 11000) return null; throw e }
}
const unreserve = (cid, day, n, field) => C('bsDaily').updateOne({ _id: `${cid}:${day}` }, { $inc: { used: -n, ...(field ? { [field]: n } : {}) } })
const countDay = (cid, day, field) => C('bsDaily').updateOne({ _id: `${cid}:${day}` }, { $inc: { [field]: 1 } })

// ---------- pause / resume (credit watch, admin, provider auth) ----------
const state = async () => (await C('bsConfig').findOne({ _id: 'state' })) || { reasons: [] }
async function pause(reason, note) {
  const r = await C('bsConfig').updateOne({ _id: 'state', reasons: { $ne: reason } }, { $addToSet: { reasons: reason }, $set: { [`notes.${reason}`]: note || null, pausedAt: new Date() } }, { upsert: true }).catch(e => (e.code === 11000 ? { modifiedCount: 0 } : Promise.reject(e)))
  if (r.modifiedCount || r.upsertedCount) { alert(`⏸ Sending PAUSED — ${reason}${note ? `: ${note}` : ''}. Queued texts wait and continue automatically when it clears.`); incident('paused', { reason, note }) }
}
async function resume(reason) {
  const r = await C('bsConfig').updateOne({ _id: 'state', reasons: reason }, { $pull: { reasons: reason } })
  if (r.modifiedCount) { const left = (await state()).reasons; alert(`▶️ ${reason} cleared. ${left.length ? `Still paused: ${left.join(', ')}` : 'Sending resumed.'}`); incident('resumed', { reason }) }
}
async function creditWatch() {
  const c = await cfg()
  let bal; try { bal = await P.credit() } catch (_) { return }
  await C('bsConfig').updateOne({ _id: 'state' }, { $set: { credit: bal, creditAt: new Date() } }, { upsert: true }).catch(() => {})
  if (bal < c.minCredit) await pause('provider_credit', `Spenza balance $${bal} is below $${c.minCredit}. Add credit at web.spenza.com`)
  else await resume('provider_credit')
}

// ---------- inventory ----------
async function nextEsimId() { const r = await C('bsConfig').findOneAndUpdate({ _id: 'esimSeq' }, { $inc: { n: 1 } }, { upsert: true, returnDocument: 'after' }); const n = (r?.value || r).n; return `ESIM-${String(n).padStart(4, '0')}` }
async function addEsim(fields, status = 'testing') {
  const doc = { _id: await nextEsimId(), provider: P.name, providerEsimId: fields.iccid || null, iccid: fields.iccid || null, imsi: fields.imsi || null, msisdn: fields.msisdn || null, providerRef: fields.providerRef || null, status, health: 'unknown', healthScore: 100, activationDate: fields.msisdn ? new Date() : null, expirationDate: fields.expirationDate || null, replaces: fields.replaces || null, stats: { submitted: 0, sent: 0, failed: 0 }, history: [{ status, at: new Date() }], createdAt: new Date() }
  await C('bsEsims').insertOne(doc); return doc
}
const setEsim = (eid, status, extra = {}) => C('bsEsims').updateOne({ _id: eid }, { $set: { status, ...extra, updatedAt: new Date() }, $push: { history: { status, at: new Date(), ...(extra.note ? { note: extra.note } : {}) } } })
async function provisionOne(reason, by) {
  const c = await cfg(), month = new Date().toISOString().slice(0, 7)
  const spent = (await C('bsConfig').findOne({ _id: `spend:${month}` }))?.usd || 0, p = await P.plan().catch(() => null), cost = p?.cost || 10
  if ((await C('bsEsims').countDocuments({ status: { $nin: ['replaced', 'failed', 'expired'] } })) >= c.maxEsims) return { error: `Inventory is at the maximum (${c.maxEsims}).` }
  if (spent + cost > c.provisionBudget) { alert(`Provisioning blocked: monthly budget $${c.provisionBudget} (spent $${spent}).`); return { error: 'Monthly provisioning budget reached.' } }
  const e = await addEsim({}, 'purchasing')
  try {
    const r = await P.provision({ key: e._id })
    await C('bsConfig').updateOne({ _id: `spend:${month}` }, { $inc: { usd: cost } }, { upsert: true })
    await setEsim(e._id, r.phoneNumber ? 'testing' : 'provisioning', { providerRef: r.transactionId, iccid: r.iccid || null, providerEsimId: r.iccid || null, msisdn: r.phoneNumber || null, activationDate: r.phoneNumber ? new Date() : null })
    audit('provision', { esimId: e._id, reason, by, cost }); return { ok: true, esimId: e._id }
  } catch (err) {
    await setEsim(e._id, 'failed', { note: err.message }); alert(`❌ Provisioning ${e._id} failed: ${err.message}`)
    if (err.kind === 'credit') await pause('provider_credit', err.message)
    return { error: err.message }
  }
}
// Provider fleet → inventory: new lines get an internal id, pending lines get their number, provider-suspended lines are flagged.
async function syncInventory() {
  const sims = await P.listSims(); if (!sims) return
  for (const s of sims) {
    const msisdn = P.norm(s.phoneNumber || s.msisdn), iccid = s.iccid
    let e = await C('bsEsims').findOne({ iccid, status: { $ne: 'replaced' } })
    if (!e) e = await C('bsEsims').findOne({ status: 'provisioning', iccid: null })
    if (!e) { await addEsim({ iccid, msisdn, imsi: s.imsi || null }); continue }
    const set = { iccid, providerEsimId: iccid, imsi: s.imsi || e.imsi || null }
    if (msisdn && msisdn !== e.msisdn) Object.assign(set, { msisdn, activationDate: new Date() })
    const st = String(s.status || '').toUpperCase()
    if (/SUSPEND|DEACTIV|BLOCK/.test(st) && e.status !== 'suspended') { await setEsim(e._id, 'suspended', { ...set, note: `provider ${st}` }); alert(`⚠️ ${e._id} ${e.msisdn || ''} suspended by provider (${st}).`); continue }
    await C('bsEsims').updateOne({ _id: e._id }, { $set: set })
    if (e.status === 'provisioning' && msisdn) await setEsim(e._id, 'testing')
  }
}
async function replaceEsim(eid, reason, by) {
  const e = await C('bsEsims').findOne({ _id: eid }); if (!e || e.status === 'replaced') return { error: 'Not found' }
  await setEsim(eid, 'replaced', { note: reason })
  const n = await addEsim({ iccid: e.iccid, replaces: eid }, 'provisioning')
  await C('bsEsims').updateOne({ _id: eid }, { $set: { replacedBy: n._id } })
  let st = 'requested'
  try { const r = await P.replaceNumber(e.iccid); if (r?.simulated) await setEsim(n._id, 'testing', { msisdn: `+1201555${String(Math.floor(1000 + Math.random() * 8999))}`, activationDate: new Date() }) } catch (err) { st = 'failed'; await setEsim(n._id, 'failed', { note: err.message }); alert(`❌ Replacement of ${eid} failed: ${err.message}`) }
  await C('bsReplacements').insertOne({ oldEsimId: eid, newEsimId: n._id, reason, providerRef: e.iccid, status: st, by: by || 'system', at: new Date() })
  await C('bsSessions').updateMany({ esimId: eid, status: 'active' }, { $set: { status: 'reassign' } })
  audit('replace', { esimId: eid, newEsimId: n._id, reason, by }); return { ok: st !== 'failed', newEsimId: n._id }
}

// ---------- health ----------
async function healthCheck() {
  const c = await cfg()
  for (const e of await C('bsEsims').find({ status: { $in: [...USABLE, 'testing', 'degraded'] }, iccid: { $ne: null } }).toArray()) {
    let health = 'healthy', err = null
    try { const sim = await P.getSim(e.iccid), sv = await P.serviceState(e.iccid); const st = String(sim?.status || '').toUpperCase()
      if (/SUSPEND|BLOCK/.test(st)) health = 'suspended'; else if (sv && sv.sms === false) health = 'provider_restricted'; else if (st && st !== 'ACTIVE') health = 'temporarily_unavailable'
    } catch (x) { err = x; health = x.kind === 'temporary' || x.kind === 'rate' ? 'temporarily_unavailable' : 'technically_failed' }
    const recent = await C('bsMessages').find({ esimId: e._id, direction: 'out', submittedAt: { $gt: new Date(Date.now() - DAY) } }, { projection: { status: 1 } }).toArray()
    const fails = recent.filter(m => m.status === 'failed').length, rate = recent.length ? fails / recent.length : 0
    if (health === 'healthy' && recent.length >= 20 && rate > 0.3) health = 'sending_failure'; else if (health === 'healthy' && (e.recvMiss || 0) >= 3) health = 'degraded'
    const score = Math.max(0, Math.round(100 - rate * 100 - (e.recvMiss || 0) * 5 - (health === 'healthy' ? 0 : 30)))
    await C('bsTests').insertOne({ esimId: e._id, type: 'status', result: health, providerResponse: err?.message || null, errorCode: err?.code || null, at: new Date() })
    const set = { health, healthScore: score, lastTestAt: new Date(), ...(health === 'healthy' ? { lastOkAt: new Date() } : {}) }
    if (e.status === 'testing' && health === 'healthy' && e.msisdn) { await setEsim(e._id, 'available', set); alert(`✅ ${e._id} ${e.msisdn} passed checks and joined the pool.`); continue }
    if (['suspended', 'technically_failed', 'sending_failure', 'provider_restricted'].includes(health) && e.health !== health) { alert(`⚠️ ${e._id} ${e.msisdn || ''}: ${health.replace(/_/g, ' ')}${err ? ` (${err.message})` : ''}. New sends avoid it.`); incident('esim_health', { esimId: e._id, health }) }
    await C('bsEsims').updateOne({ _id: e._id }, { $set: set })
  }
  if (Date.now() - ((await state()).loopAt || 0) > c.testEveryHours * HOUR) await loopTest()
}
// Send/receive test between two pool lines. A missing reply only counts as a "miss", never as a failure by itself.
async function loopTest() {
  await C('bsConfig').updateOne({ _id: 'state' }, { $set: { loopAt: Date.now() } }, { upsert: true })
  const pool = await C('bsEsims').find({ status: { $in: [...USABLE, 'testing'] }, msisdn: { $ne: null } }).toArray()
  for (let i = 0; i < pool.length && pool.length > 1; i++) {
    const a = pool[i], b = pool[(i + 1) % pool.length], code = crypto.randomBytes(3).toString('hex')
    await C('bsTests').insertOne({ esimId: a._id, peer: b._id, type: 'loop', code, result: 'pending', at: new Date() })
    await C('bsMessages').insertOne(msgDoc({ cid: 'system:health', to: b.msisdn, body: `CloudIVR line check ${code}`, priority: 2, esimId: a._id, system: true }))
  }
}
async function loopTimeouts() {
  for (const t of await C('bsTests').find({ type: 'loop', result: 'pending', at: { $lt: new Date(Date.now() - 10 * MIN) } }).toArray()) {
    await C('bsTests').updateOne({ _id: t._id }, { $set: { result: 'no_reply' } })
    await C('bsEsims').updateOne({ _id: t.peer }, { $inc: { recvMiss: 1 } })
  }
}

// ---------- capacity + bookings ----------
async function slotCapacity(c) {
  const healthy = await C('bsEsims').countDocuments({ status: { $in: USABLE }, health: { $in: GOOD_HEALTH } })
  return Math.floor(Math.min(c.platformPerMin, Math.max(1, healthy) * c.esimPerMin) * 60 * c.slotUtilization)
}
const slotKey = (date, h) => `${date}T${String(h).padStart(2, '0')}`
async function reservedBySlot(dates) {
  const now = new Date(), out = {}
  for (const b of await C('bsBookings').find({ date: { $in: dates }, status: { $in: LIVE_BOOKING } }).toArray()) {
    if (['pending', 'awaiting_payment'].includes(b.status) && b.holdUntil < now) continue
    for (const [k, v] of Object.entries(b.allocation || {})) out[k] = (out[k] || 0) + v
  }
  return out
}
// 24 hourly slots (UTC) with what is left; past hours are closed.
async function availability(date) {
  const c = await cfg(), cap = await slotCapacity(c), next = new Date(new Date(`${date}T00:00:00Z`).getTime() + DAY).toISOString().slice(0, 10)
  const res = await reservedBySlot([date, next]), maint = (await C('bsConfig').findOne({ _id: 'maintenance' }))?.slots || []
  return { capacity: cap, slots: Array.from({ length: 24 }, (_, h) => { const k = slotKey(date, h), past = new Date(`${k}:00:00Z`).getTime() < Date.now() + 5 * MIN; return { hour: h, key: k, free: past || maint.includes(k) || c.emergencyStop ? 0 : Math.max(0, cap - (res[k] || 0)) } }) }
}
function allocate(slots, from, volume) {
  const alloc = {}; let left = volume
  for (const s of slots.filter(x => x.hour >= from)) { if (!left) break; if (!s.free) { if (Object.keys(alloc).length) break; continue } const n = Math.min(s.free, left); alloc[s.key] = n; left -= n }
  return left ? null : alloc
}
async function lock(key, ms = 8000) {
  for (let i = 0; i < 20; i++) { try { await C('bsLocks').findOneAndUpdate({ _id: key, until: { $lt: new Date() } }, { $set: { until: new Date(Date.now() + ms) } }, { upsert: true }); return true } catch (e) { if (e.code !== 11000) throw e; await new Promise(r => setTimeout(r, 250)) } }
  return false
}
const unlock = (key) => C('bsLocks').deleteOne({ _id: key })
// Holds capacity for `holdMinutes` while the customer pays. type: 'paid' | 'free'.
async function createBooking(cid, { date, hour, volume, type = 'paid', campaignId }) {
  const c = await cfg(), v = Math.round(Number(volume)), cu = await C('bsCustomers').findOne({ _id: cid })
  if (cu?.status !== 'active') return { error: 'Your BulkSMS access is suspended. Contact support.' }
  if (!(v >= c.minVolume && v <= c.maxVolume)) return { error: `Volume must be between ${c.minVolume} and ${c.maxVolume} SMS.` }
  if (v > (cu.dailyLimit ?? c.defaultDailyLimit)) return { error: `That is above your daily allowance (${cu.dailyLimit ?? c.defaultDailyLimit}).` }
  if (type === 'free' && (!c.freeBookings || v > c.freeVolume)) return { error: 'Free bookings are not available for this volume.' }
  if (!(await lock(`book:${date}`))) return { error: 'Busy, try again in a moment.' }
  try {
    const { slots } = await availability(date), alloc = allocate(slots, Number(hour), v)
    if (!alloc) return { error: 'Not enough capacity from that time. Pick another slot.' }
    const b = { _id: id('bk'), cid, campaignId: campaignId || null, type, date, hour: Number(hour), startAt: new Date(`${slotKey(date, hour)}:00:00Z`), estimatedCompletion: new Date(`${Object.keys(alloc).pop()}:59:59Z`), volume: v, allocation: alloc, price: type === 'free' ? 0 : Math.round(v * c.pricePerSms * 100) / 100, status: 'awaiting_payment', paymentStatus: type === 'free' ? 'free' : 'unpaid', holdUntil: new Date(Date.now() + c.holdMinutes * MIN), history: [{ status: 'awaiting_payment', at: new Date() }], createdAt: new Date() }
    await C('bsBookings').insertOne(b); return { booking: b }
  } finally { await unlock(`book:${date}`) }
}
const setBooking = (bid, status, extra = {}) => C('bsBookings').updateOne({ _id: bid }, { $set: { status, ...extra, updatedAt: new Date() }, $push: { history: { status, at: new Date() } } })
// Payment confirmed by the bot (wallet / crypto / bank already collected). Expired holds are re-checked for capacity.
async function confirmBooking(bid, { method, amount, ref } = {}) {
  const b = await C('bsBookings').findOne({ _id: bid }); if (!b) return { error: 'Booking not found.' }
  if (!['pending', 'awaiting_payment'].includes(b.status)) return { error: 'This booking is no longer waiting for payment.', refund: b.price }
  if (b.holdUntil < new Date()) { const { slots } = await availability(b.date); if (!allocate(slots, b.hour, b.volume)) { await setBooking(bid, 'failed', { note: 'Hold expired and the slot filled up' }); return { error: 'The hold expired and that slot is now full.', refund: b.price } } }
  await C('bsPayments').insertOne({ cid: b.cid, bookingId: bid, amount: amount ?? b.price, currency: 'USD', method: method || 'wallet', reference: ref || null, status: 'paid', at: new Date() })
  const c = await cfg(), cap = await slotCapacity(c), needMore = Math.max(...Object.values(b.allocation)) > cap
  await setBooking(bid, needMore ? 'provisioning' : 'scheduled', { paymentStatus: b.type === 'free' ? 'free' : 'paid' })
  if (needMore) { const r = c.autoProvision && !c.manualApproval && b.type === 'paid' ? await provisionOne(`booking ${bid}`) : null; alert(`📦 Booking ${bid} needs more capacity${r?.ok ? ` — provisioning ${r.esimId}` : ' — approve provisioning in admin'}.`) }
  if (b.campaignId) await queueCampaign(b.campaignId, b)
  await notify(b.cid, 'booking', `✅ Booking confirmed: ${b.volume} SMS from ${b.date} ${String(b.hour).padStart(2, '0')}:00 UTC. We'll tell you when sending starts.`, { bookingId: bid })
  audit('booking_confirm', { bookingId: bid, method }); return { ok: true }
}
async function cancelBooking(bid, { by = 'customer', cid } = {}) {
  const b = await C('bsBookings').findOne({ _id: bid, ...(cid ? { cid } : {}) }); if (!b) return { error: 'Booking not found.' }
  if (!['pending', 'awaiting_payment', 'confirmed', 'scheduled', 'provisioning'].includes(b.status)) return { error: 'This booking can no longer be cancelled.' }
  if (by === 'customer' && b.startAt < new Date(Date.now() + 30 * MIN) && b.paymentStatus === 'paid') return { error: 'Bookings can be cancelled up to 30 minutes before the start.' }
  const paid = b.paymentStatus === 'paid'
  await setBooking(bid, paid ? 'refunded' : 'cancelled', { cancelledBy: by })
  await C('bsMessages').updateMany({ bookingId: bid, status: 'queued' }, { $set: { status: 'expired', failureReason: 'booking_cancelled' } })
  if (b.campaignId) await C('bsCampaigns').updateOne({ _id: b.campaignId }, { $set: { status: 'cancelled' } })
  if (paid) await notify(b.cid, 'refund', `↩️ Booking ${b.volume} SMS on ${b.date} cancelled. $${b.price} refunded to your wallet.`, { amount: b.price, bookingId: bid })
  audit('booking_cancel', { bookingId: bid, by }); return { ok: true, refunded: paid ? b.price : 0 }
}
async function expireHolds() {
  for (const b of await C('bsBookings').find({ status: { $in: ['pending', 'awaiting_payment'] }, holdUntil: { $lt: new Date(Date.now() - 6 * HOUR) } }).limit(100).toArray()) await setBooking(b._id, 'cancelled', { note: 'hold_expired' })
}

// ---------- campaigns + messages ----------
function msgDoc({ cid, to, body, campaignId = null, bookingId = null, sessionId = null, esimId = null, priority = 0, notBefore = null, test = false, system = false }) {
  return { _id: id('m'), cid, brand: cid.split(':')[0], campaignId, bookingId, sessionId, esimId, to, from: null, body, segments: segs(body), direction: 'out', status: 'queued', history: [{ s: 'queued', at: new Date() }], attempts: 0, priority, nextAt: notBefore || new Date(), test, system, createdAt: new Date() }
}
// contacts: raw text (one per line / comma separated, CSV ok). Keeps valid USA/Canada numbers, drops duplicates and opted-out ones.
async function parseContacts(cid, raw) {
  const seen = new Set(), bad = []
  for (const tok of String(raw || '').split(/[\n,;\t]+/)) { const t = tok.trim(); if (!t) continue; const p = normPhone(t); if (p && NANP.test(p)) seen.add(p); else if (/\d{7,}/.test(t)) bad.push(t) }
  const list = [...seen], sup = new Set((await C('bsSuppression').find({ $or: [{ cid }, { cid: '*' }], phone: { $in: list } }).toArray()).map(s => s.phone))
  return { contacts: list.filter(p => !sup.has(p)), invalid: bad.length, optedOut: sup.size, duplicates: 0 }
}
async function createCampaign(cid, { name, content, contacts, uploadId = null }) {
  const parts = (Array.isArray(content) ? content : String(content || '').split(/\n?---\n?/)).map(x => x.trim()).filter(Boolean)
  if (!parts.length) return { error: 'Add the message text.' }
  if (parts.some(p => segs(p) > 3)) return { error: 'Each message must fit in 3 SMS parts (about 459 characters).' }
  const doc = { _id: id('cp'), cid, name: String(name || 'Campaign').slice(0, 60), content: parts, contacts, uploadId, volume: contacts.length, status: 'draft', testsUsed: 0, stats: { queued: 0, sent: 0, failed: 0, rejected: 0, replies: 0, optOuts: 0 }, createdAt: new Date() }
  await C('bsCampaigns').insertOne(doc); return { campaign: doc }
}
// Up to cfg.testSends test texts per campaign during setup; they use the daily allowance like any text.
async function testSend(cid, campaignId, to) {
  const c = await cfg(), cp = await C('bsCampaigns').findOne({ _id: campaignId, cid }), p = normPhone(to)
  if (!cp) return { error: 'Campaign not found.' }
  if (!NANP.test(p)) return { error: 'Enter a USA or Canada number: +1 and 10 digits.' }
  const r = await C('bsCampaigns').updateOne({ _id: campaignId, testsUsed: { $lt: c.testSends } }, { $inc: { testsUsed: 1 } })
  if (!r.modifiedCount) return { error: `You've used your ${c.testSends} test texts for this campaign.` }
  const m = msgDoc({ cid, to: p, body: cp.content[0], campaignId, priority: 1, test: true })
  await C('bsMessages').insertOne(m); return { ok: true, left: c.testSends - cp.testsUsed - 1, messageId: m._id }
}
async function queueCampaign(campaignId, b) {
  const cp = await C('bsCampaigns').findOne({ _id: campaignId }); if (!cp || cp.status !== 'draft') return
  const docs = cp.contacts.slice(0, b.volume).map((to, i) => msgDoc({ cid: cp.cid, to, body: cp.content[i % cp.content.length], campaignId, bookingId: b._id, notBefore: b.startAt }))
  for (let i = 0; i < docs.length; i += 500) await C('bsMessages').insertMany(docs.slice(i, i + 500))
  await C('bsCampaigns').updateOne({ _id: campaignId }, { $set: { status: 'scheduled', bookingId: b._id, scheduledAt: b.startAt, 'stats.queued': docs.length } })
}
// One text in an existing conversation (or a new one). Same queue, same quota.
async function sendOne(cid, to, text, sessionId) {
  const cu = await C('bsCustomers').findOne({ _id: cid }), p = normPhone(to), body = String(text || '').trim()
  if (cu?.status !== 'active') return { error: 'Your BulkSMS access is suspended.' }
  if (!NANP.test(p)) return { error: 'Enter a USA or Canada number: +1 and 10 digits.' }
  if (!body) return { error: 'Type a message.' }
  if (segs(body) > 3) return { error: 'The message is too long (max 3 SMS parts).' }
  if ((await usage(cid)).remaining < segs(body)) return { error: 'Your daily SMS allowance is used up. It resets at the next reset time.' }
  if (await C('bsSuppression').findOne({ $or: [{ cid }, { cid: '*' }], phone: p })) return { error: 'This number opted out of your texts.' }
  const m = msgDoc({ cid, to: p, body, sessionId: sessionId || null, priority: 1 }); await C('bsMessages').insertOne(m)
  return { ok: true, messageId: m._id, segments: m.segments }
}

// ---------- send worker (leader only) ----------
const me = id('w')
const win = { all: [], esim: {} }
const roomIn = (arr, per) => { const t = Date.now() - MIN; while (arr.length && arr[0] < t) arr.shift(); return arr.length < per }
async function leader() { try { await C('bsLocks').findOneAndUpdate({ _id: 'worker', $or: [{ until: { $lt: new Date() } }, { owner: me }] }, { $set: { owner: me, until: new Date(Date.now() + 20000) } }, { upsert: true }); return true } catch (e) { if (e.code === 11000) return false; throw e } }
const mark = (m, status, extra = {}) => C('bsMessages').updateOne({ _id: m._id }, { $set: { status, ...extra }, $push: { history: { s: status, at: new Date(), ...(extra.failureReason ? { r: extra.failureReason } : {}) } } })
async function pickEsim(m, c) {
  if (m.esimId) return C('bsEsims').findOne({ _id: m.esimId, msisdn: { $ne: null } })
  const s = await C('bsSessions').findOne({ cid: m.cid, to: m.to, status: 'active' }, { sort: { lastActivityAt: -1 } })
  const ok = (e) => e && USABLE.includes(e.status) && GOOD_HEALTH.includes(e.health) && roomIn(win.esim[e._id] ||= [], c.esimPerMin)
  if (s) { const e = await C('bsEsims').findOne({ _id: s.esimId }); if (ok(e)) return e; if (e && USABLE.includes(e.status) && GOOD_HEALTH.includes(e.health)) return null }
  const pool = await C('bsEsims').find({ status: { $in: USABLE }, health: { $in: GOOD_HEALTH }, msisdn: { $ne: null } }).sort({ 'stats.submitted': 1 }).toArray()
  return pool.find(ok) || null
}
async function processOne(m, c) {
  const later = (ms, extra = {}) => C('bsMessages').updateOne({ _id: m._id }, { $set: { status: 'queued', nextAt: new Date(Date.now() + ms), ...extra } })
  if (!m.system) {
    const cu = await C('bsCustomers').findOne({ _id: m.cid })
    if (cu?.status !== 'active') return mark(m, 'rejected', { failureReason: 'customer_suspended' })
    if (await C('bsSuppression').findOne({ $or: [{ cid: m.cid }, { cid: '*' }], phone: m.to })) return mark(m, 'rejected', { failureReason: 'opted_out' })
    if (m.bookingId && Date.now() - new Date(m.nextAt).getTime() > 2 * DAY) return mark(m, 'expired', { failureReason: 'too_late' })
  }
  const e = await pickEsim(m, c); if (!e) return later(5000)
  const n = c.countSegments ? m.segments : 1, day = m.system ? null : m.quotaDay || await reserve(m.cid, n, c)
  if (!m.system && !day) { await mark(m, 'rejected', { failureReason: 'daily_allowance' }); return notifyQuotaOnce(m.cid, c) }
  win.all.push(Date.now()); (win.esim[e._id] ||= []).push(Date.now())
  await mark(m, 'submitted', { esimId: e._id, from: e.msisdn, quotaDay: day, submittedAt: new Date() })
  await C('bsEsims').updateOne({ _id: e._id }, { $inc: { 'stats.submitted': 1 } })
  try {
    await P.sendSms({ from: e.msisdn, to: m.to, text: m.body, key: m._id })
    await mark(m, 'sent', { sentAt: new Date() }); await C('bsEsims').updateOne({ _id: e._id }, { $inc: { 'stats.sent': 1 } })
    if (day) await countDay(m.cid, day, 'sent')
    if (!m.system) await C('bsSessions').updateOne({ cid: m.cid, esimId: e._id, to: m.to }, { $set: { status: 'active', lastActivityAt: new Date(), expiresAt: new Date(Date.now() + c.sessionHours * HOUR) }, $setOnInsert: { _id: id('s'), from: e.msisdn, startedAt: new Date() } }, { upsert: true })
    if (m.campaignId) await C('bsCampaigns').updateOne({ _id: m.campaignId }, { $inc: { 'stats.sent': 1 } })
  } catch (err) {
    const retryable = ['rate', 'credit', 'auth'].includes(err.kind) || (err.kind === 'temporary' && m.attempts < 3)
    if (retryable) { if (day) await unreserve(m.cid, day, n); await later(err.kind === 'rate' ? (err.retryAfter || 30) * 1000 : err.kind === 'temporary' ? 30000 * 2 ** m.attempts : 60000, { quotaDay: null, attempts: m.attempts + (err.kind === 'temporary' ? 1 : 0), lastError: err.message }) }
    else { await mark(m, 'failed', { failureReason: err.message }); await C('bsEsims').updateOne({ _id: e._id }, { $inc: { 'stats.failed': 1 } }); if (day) { if (c.refundFailed) await unreserve(m.cid, day, n, 'failed'); else await countDay(m.cid, day, 'failed') } if (m.campaignId) await C('bsCampaigns').updateOne({ _id: m.campaignId }, { $inc: { 'stats.failed': 1 } }); await C('bsReputation').insertOne({ esimId: e._id, cid: m.cid, deliveryStatus: 'failed', providerError: err.message, incidentType: err.status === 400 ? 'invalid_recipient' : 'provider_rejection', at: new Date() }) }
    if (err.kind === 'credit') await pause('provider_credit', err.message)
    if (err.kind === 'auth') await pause('provider_auth', err.message)
  }
}
async function notifyQuotaOnce(cid, c) {
  const k = `${cid}:${dayKey(Date.now(), c)}`
  const r = await C('bsDaily').updateOne({ _id: k, quotaNotified: { $ne: true } }, { $set: { quotaNotified: true } })
  if (r.modifiedCount) await notify(cid, 'quota', `⛔ Your daily SMS allowance is used up. Remaining texts wait for the next reset (${nextReset(c).toISOString().slice(11, 16)} UTC).`)
}
async function finishCampaigns() {
  for (const cp of await C('bsCampaigns').find({ status: { $in: ['scheduled', 'running'] } }).toArray()) {
    const open = await C('bsMessages').countDocuments({ campaignId: cp._id, test: false, status: { $in: ['queued', 'processing', 'submitted'] } })
    const started = await C('bsMessages').countDocuments({ campaignId: cp._id, test: false, status: { $ne: 'queued' } })
    if (cp.status === 'scheduled' && started) { await C('bsCampaigns').updateOne({ _id: cp._id }, { $set: { status: 'running', startedAt: new Date() } }); await setBooking(cp.bookingId, 'processing'); await notify(cp.cid, 'campaign', `🚀 Campaign “${cp.name}” started sending.`, { campaignId: cp._id }) }
    if (started && !open) { await C('bsCampaigns').updateOne({ _id: cp._id }, { $set: { status: 'completed', completedAt: new Date() } }); await setBooking(cp.bookingId, 'completed'); const r = await report(cp._id); await notify(cp.cid, 'campaign', `🏁 Campaign “${cp.name}” finished: ${r.sent} sent, ${r.failed} failed, ${r.rejected} skipped, ${r.replies} replies.`, { campaignId: cp._id }) }
  }
}
let busy = false
async function tick() {
  if (busy || process.env.BULK_ESIM_WORKER === 'false' || !(await leader())) return
  busy = true
  try {
    const c = await cfg(), st = await state(), platformToday = await C('bsMessages').countDocuments({ direction: 'out', submittedAt: { $gte: new Date(new Date().toISOString().slice(0, 10)) } })
    if (st.reasons?.length || c.emergencyStop || platformToday >= c.platformDailyLimit) return
    while (roomIn(win.all, c.platformPerMin)) {
      const r = await C('bsMessages').findOneAndUpdate({ status: 'queued', direction: 'out', nextAt: { $lte: new Date() } }, { $set: { status: 'processing' } }, { sort: { priority: -1, nextAt: 1 }, returnDocument: 'after' })
      const m = r?.value !== undefined ? r.value : r; if (!m) break
      await processOne(m, c)
      if ((await state()).reasons?.length) break
    }
  } catch (e) { S.log(`[BulkESIM] tick: ${e.message}`) } finally { busy = false }
}

// ---------- inbound ----------
async function onWebhook(raw, headers, body) {
  const wh = await C('bsConfig').findOne({ _id: 'webhook' })
  if (!P.dry() && !P.verify(raw, headers['x-spenza-signature'], headers['x-spenza-timestamp'], wh?.signingSecret)) return { status: 401 }
  const x = P.parseInbound(body); if (x.event === 'webhook.test' || x.direction !== 'inbound' || !x.text) return { status: 200 }
  const key = x.providerId || crypto.createHash('sha1').update(`${x.from}|${x.to}|${x.text}|${Math.floor(Date.now() / MIN)}`).digest('hex')
  try { await C('bsWebhooks').insertOne({ _id: key, eventType: 'incoming-sms', providerMessageId: x.providerId, payload: body, status: 'received', at: new Date() }) } catch (e) { if (e.code === 11000) return { status: 200 }; throw e }
  const e = await C('bsEsims').findOne({ msisdn: x.to, status: { $ne: 'replaced' } })
  if (!e) { await C('bsWebhooks').updateOne({ _id: key }, { $set: { status: 'unmatched_number' } }); return { status: 200 } }
  const peer = await C('bsEsims').findOne({ msisdn: x.from })
  if (peer) { const code = (x.text.match(/check ([0-9a-f]{6})/) || [])[1]; const t = code && await C('bsTests').findOneAndUpdate({ type: 'loop', code, result: 'pending' }, { $set: { result: 'passed', at2: new Date() } }); if (t) await C('bsEsims').updateOne({ _id: e._id }, { $set: { recvMiss: 0, lastRecvOkAt: new Date() } }); await C('bsWebhooks').updateOne({ _id: key }, { $set: { status: 'health_test' } }); return { status: 200 } }
  const isStop = STOP.test(x.text)
  // STOP blocks the number for every customer, even when the reply can't be routed.
  if (isStop) {
    await C('bsSuppression').updateOne({ cid: '*', phone: x.from }, { $setOnInsert: { reason: 'STOP', source: 'inbound', esimId: e._id, at: new Date() } }, { upsert: true })
    await C('bsMessages').updateMany({ to: x.from, direction: 'out', status: 'queued', system: { $ne: true } }, { $set: { status: 'rejected', failureReason: 'opted_out' } })
    await C('bsMessages').insertOne(msgDoc({ cid: 'system:compliance', to: x.from, body: 'You are unsubscribed and will not get more texts from this number. Reply HELP for help.', esimId: e._id, priority: 2, system: true }))
  } else if (HELP.test(x.text)) await C('bsMessages').insertOne(msgDoc({ cid: 'system:compliance', to: x.from, body: 'Business text messages sent via CloudIVR. Reply STOP to opt out. Msg & data rates may apply.', esimId: e._id, priority: 2, system: true }))
  const sess = await C('bsSessions').find({ esimId: e._id, to: x.from, status: 'active', expiresAt: { $gt: new Date() } }).sort({ lastActivityAt: -1 }).toArray()
  const owners = [...new Set(sess.map(s => s.cid))]
  if (owners.length !== 1) { await C('bsMessages').insertOne({ _id: id('m'), cid: null, esimId: e._id, from: x.from, to: x.to, body: x.text, direction: 'in', status: owners.length ? 'review' : 'unrouted', providerMessageId: x.providerId, createdAt: new Date() }); if (owners.length) { incident('ambiguous_inbound', { esimId: e._id, from: x.from, owners }); alert(`❓ Reply from ${x.from} to ${e._id} matches ${owners.length} customers — held for review.`) } await C('bsWebhooks').updateOne({ _id: key }, { $set: { status: owners.length ? 'review' : 'unrouted' } }); return { status: 200 } }
  const s = sess[0], cid = s.cid
  await C('bsSessions').updateOne({ _id: s._id }, { $set: { lastActivityAt: new Date() } })
  const last = await C('bsMessages').findOne({ cid, to: x.from, direction: 'out', campaignId: { $ne: null } }, { sort: { createdAt: -1 } })
  await C('bsMessages').insertOne({ _id: id('m'), cid, brand: cid.split(':')[0], sessionId: s._id, esimId: e._id, from: x.from, to: x.to, body: x.text, direction: 'in', status: 'received', campaignId: last?.campaignId || null, providerMessageId: x.providerId, createdAt: new Date() })
  if (last?.campaignId) await C('bsCampaigns').updateOne({ _id: last.campaignId }, { $inc: { 'stats.replies': 1 } })
  if (isStop) {
    await C('bsSuppression').updateOne({ cid: '*', phone: x.from }, { $set: { by: cid } })
    if (last?.campaignId) await C('bsCampaigns').updateOne({ _id: last.campaignId }, { $inc: { 'stats.optOuts': 1 } })
    await optOutWatch(cid)
  }
  await notify(cid, 'inbound', `💬 Reply from ${x.from}${isStop ? ' (opted out — blocked for all future campaigns)' : ''}:\n${x.text}`, { sessionId: s._id, from: x.from })
  await C('bsWebhooks').updateOne({ _id: key }, { $set: { status: 'routed', cid } }); return { status: 200 }
}
// Many opt-outs in a day → admin alert (suspension stays a human decision).
async function optOutWatch(cid) {
  const n = await C('bsSuppression').countDocuments({ by: cid, at: { $gt: new Date(Date.now() - DAY) } })
  if (n === 25 || n === 100) { alert(`🚩 ${cid}: ${n} opt-outs in 24 h. Review the customer.`); incident('excessive_opt_outs', { cid, n }) }
}
async function registerWebhook(baseUrl) {
  const url = `${String(baseUrl || '').replace(/\/$/, '')}/api/bulk-esim/webhook`
  const r = await P.registerWebhook(url); await C('bsConfig').updateOne({ _id: 'webhook' }, { $set: { ...r, at: new Date() } }, { upsert: true }); return r
}

// ---------- reports + admin ----------
async function report(campaignId) {
  const rows = await C('bsMessages').aggregate([{ $match: { campaignId, test: { $ne: true } } }, { $group: { _id: { d: '$direction', s: '$status' }, n: { $sum: 1 } } }]).toArray()
  const g = (d, s) => rows.filter(r => r._id.d === d && (!s || s.includes(r._id.s))).reduce((a, r) => a + r.n, 0)
  const sent = g('out', ['sent', 'delivered']), failed = g('out', ['failed']), total = g('out')
  return { total, sent, failed, rejected: g('out', ['rejected', 'expired']), queued: g('out', ['queued', 'processing', 'submitted']), replies: g('in'), successPct: total ? Math.round((sent / total) * 1000) / 10 : 0 }
}
async function overview() {
  const [esims, st, c, bookings, today] = await Promise.all([C('bsEsims').find({}, { projection: { history: 0 } }).sort({ _id: 1 }).toArray(), state(), cfg(), C('bsBookings').aggregate([{ $group: { _id: { s: '$status', t: '$type' }, n: { $sum: 1 }, usd: { $sum: '$price' } } }]).toArray(), C('bsMessages').aggregate([{ $match: { direction: 'out', createdAt: { $gte: new Date(new Date().toISOString().slice(0, 10)) } } }, { $group: { _id: '$status', n: { $sum: 1 } } }]).toArray()])
  const by = (s) => esims.filter(e => s.includes(e.status)).length
  return { paused: st.reasons || [], notes: st.notes || {}, credit: st.credit ?? null, esims: { total: esims.length, active: by(USABLE), available: by(['available']), allocated: by(['allocated']), testing: by(['testing']), pending: by(['pending', 'purchasing', 'provisioning', 'activating']), failed: by(['failed']), suspended: by(['suspended']), replaced: by(['replaced']), list: esims }, capacity: { perHour: await slotCapacity(c) }, bookings, today: Object.fromEntries(today.map(x => [x._id, x.n])), config: c }
}
async function setConfig(patch, by) {
  const allowed = Object.keys(DEFAULTS), clean = {}
  for (const [k, v] of Object.entries(patch || {})) if (allowed.includes(k)) clean[`values.${k}`] = typeof DEFAULTS[k] === 'boolean' ? v === true || v === 'true' || v === 'on' : Number(v)
  if (!Object.keys(clean).length) return { error: `Unknown setting. Use one of: ${allowed.join(', ')}` }
  await C('bsConfig').updateOne({ _id: 'settings' }, { $set: clean }, { upsert: true }); audit('config', { by, patch }); return { ok: true }
}
async function setCustomer(cid, { dailyLimit, status }, by) {
  const c = await cfg(), set = {}
  if (dailyLimit != null) { const n = Number(dailyLimit); if (!(n >= 0 && n <= c.maxCustomerLimit)) return { error: `Limit must be 0–${c.maxCustomerLimit}.` }; set.dailyLimit = n }
  if (status) set.status = status === 'suspended' ? 'suspended' : 'active'
  const r = await C('bsCustomers').updateOne({ _id: cid }, { $set: set }); audit('customer', { cid, set, by }); return r.matchedCount ? { ok: true } : { error: 'Customer not found.' }
}
async function autoscale() {
  const c = await cfg(), healthy = await C('bsEsims').countDocuments({ status: { $in: USABLE }, health: { $in: GOOD_HEALTH } }), total = await C('bsEsims').countDocuments({ status: { $nin: ['replaced', 'failed', 'expired'] } })
  const demand = (await C('bsBookings').find({ status: { $in: ['confirmed', 'scheduled', 'processing', 'provisioning'] }, startAt: { $lt: new Date(Date.now() + DAY) } }).toArray()).reduce((a, b) => a + b.volume, 0)
  const cap = healthy * c.esimPerMin * 60 * 24 * c.slotUtilization
  if (total < c.minEsims || (demand && demand > cap * c.provisionThreshold)) {
    if (c.autoProvision && !c.manualApproval && total < c.maxEsims) await provisionOne(total < c.minEsims ? 'below minimum inventory' : 'demand')
    else { const k = `scale:${new Date().toISOString().slice(0, 10)}`; if (await C('bsConfig').updateOne({ _id: k }, { $setOnInsert: { at: new Date() } }, { upsert: true }).then(r => r.upsertedCount)) alert(`📈 Capacity: ${healthy} healthy eSIM(s), ${total} total (min ${c.minEsims}); next-24h demand ${demand} SMS. Provisioning needs approval.`) }
  }
}

function init({ db, log = console.log, notifyAdmin }) {
  const own = db, url = process.env.BULK_ESIM_MONGO_URL
  S = { db: own, log, notifyAdmin }
  const ready = url ? MongoClient.connect(url).then(cl => { S.db = cl.db(process.env.BULK_ESIM_DB || 'bulkesim') }) : Promise.resolve()
  return ready.then(() => {
    C('bsMessages').createIndex({ status: 1, priority: -1, nextAt: 1 }).catch(() => {}); C('bsMessages').createIndex({ campaignId: 1, status: 1 }).catch(() => {}); C('bsMessages').createIndex({ cid: 1, createdAt: -1 }).catch(() => {})
    C('bsSessions').createIndex({ esimId: 1, to: 1, status: 1 }).catch(() => {}); C('bsSuppression').createIndex({ cid: 1, phone: 1 }, { unique: true }).catch(() => {}); C('bsNotify').createIndex({ brand: 1, sent: 1 }).catch(() => {}); C('bsEsims').createIndex({ msisdn: 1 }).catch(() => {})
    if (process.env.BULK_ESIM_WORKER === 'false') return
    if (!P.configured()) { log('[BulkESIM] SPENZA_BULK_API_KEY/SECRET not set — engine idle'); return }
    const every = (ms, fn, name) => setInterval(async () => { try { if (await leader()) await fn() } catch (e) { log(`[BulkESIM] ${name}: ${e.message}`) } }, ms)
    setInterval(tick, 2000)
    every(2 * MIN, creditWatch, 'credit'); every(5 * MIN, syncInventory, 'sync'); every(MIN, async () => { await finishCampaigns(); await expireHolds(); await loopTimeouts() }, 'campaigns')
    every(10 * MIN, healthCheck, 'health'); every(30 * MIN, autoscale, 'autoscale')
    log(`[BulkESIM] engine ready (${P.dry() ? 'simulated provider' : 'live Spenza'}${url ? ', shared DB' : ''})`)
  })
}
const db = () => S.db

const configured = () => P.configured()
module.exports = { init, db, configured, cfg, DEFAULTS, cidOf, customer, usage, createCampaign, parseContacts, testSend, createBooking, confirmBooking, cancelBooking, availability, sendOne, onWebhook, registerWebhook, report, overview, setConfig, setCustomer, provisionOne, replaceEsim, healthCheck, syncInventory, creditWatch, pause, resume, state, addEsim, setEsim, tick, autoscale, finishCampaigns, segs, normPhone }
