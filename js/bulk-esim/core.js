'use strict'
// eSIM BulkSMS engine (USA/Canada). One shared database for every bot (env BULK_ESIM_MONGO_URL / BULK_ESIM_DB, else the bot's own DB):
// eSIM pool, quotas, bookings, campaigns, the send queue, sessions, inbound routing, health, credit watch and reports.
// Customer id (cid) = `${brand}:${chatId}`. Only one process sends (leader lock); each bot delivers its own customers' notices (bsNotify).
const crypto = require('crypto')
const { MongoClient } = require('mongodb')
const P = require('./provider-spenza')
const { validUsCa, quietWait, hourOpen } = require('./tz')

const DEFAULTS = {
  defaultDailyLimit: 2000, maxCustomerLimit: 10000, resetHourUtc: 0, countSegments: true, refundFailed: true, quietStart: 8, quietEnd: 21,
  platformPerMin: 30, esimPerMin: 10, platformDailyLimit: 40000, slotUtilization: 0.8,
  minVolume: 500, maxVolume: 2000, pricePlain: 0.10, priceLink: 0.15, freeBookings: false, freeVolume: 500, holdMinutes: 15, testSends: 2,
  minEsims: 1, maxEsims: 20, autoProvision: false, manualApproval: true, provisionThreshold: 0.8, provisionBudget: 100,
  minCredit: 10, healthEveryMin: 10, testEveryHours: 6, sessionHours: 72, emergencyStop: false,
  esimDailyLimit: 400, warmupDays: 5, warmupStart: 50, leadDays: 2, providerSmsCost: 0.01, creditWarnDays: 3, renewalWindowDays: 30, autoReplace: true, maxReplacesPerDay: 3,
}
const today = () => new Date().toISOString().slice(0, 10)
const daysAhead = (date) => Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(today())) / 86400000)
// Age of a line (in days, first day = 1) on `date`, and how many texts a line of that age may send that day (warm-up ramp).
const lineAge = (at, date) => Math.max(1, Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(new Date(at).toISOString().slice(0, 10))) / 86400000) + 1)
const lineCap = (c, age) => (age >= c.warmupDays ? c.esimDailyLimit : Math.max(c.warmupStart, Math.round((c.esimDailyLimit * age) / c.warmupDays)))
const LIVE_BOOKING = ['pending', 'awaiting_payment', 'confirmed', 'provisioning', 'scheduled', 'processing']
const USABLE = ['active', 'available', 'allocated']
const GOOD_HEALTH = ['healthy', 'degraded']
const STOP = /^(stop|stop all|stopall|unsubscribe|cancel|end|quit|optout|opt out)$/
const HELP = /^(help|info)$/
const kw = (t) => String(t || '').toLowerCase().replace(/[^a-z ]/g, ' ').trim().replace(/\s+/g, ' ')
// Appended to every first-contact text (campaigns, tests, one-off texts).
const OPT = '\nReply STOP to opt out'
const LINK = /(https?:\/\/|www\.|\b[a-z0-9-]{2,}\.[a-z]{2,24}\b)/i
const hasPhone = (t) => (String(t).match(/\+?\d[\d\s().-]{5,}\d/g) || []).some(x => x.replace(/\D/g, '').length >= 7)
const hasLinkOrPhone = (t) => LINK.test(t) || hasPhone(t)
const E = (error, ...args) => ({ error, args })
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
const notify = (cid, type, key, args = [], extra = {}) => { const [brand, chatId] = cid.split(':'); return C('bsNotify').insertOne({ brand, chatId, type, key, args, ...extra, sent: false, at: new Date() }) }

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
async function reserve(cid, n, c, day = dayKey(Date.now(), c)) {
  const cu = await C('bsCustomers').findOne({ _id: cid }), limit = cu?.dailyLimit ?? c.defaultDailyLimit
  try { await C('bsDaily').findOneAndUpdate({ _id: `${cid}:${day}`, used: { $lte: limit - n } }, { $inc: { used: n }, $setOnInsert: { cid, day, limit } }, { upsert: true }); return day } catch (e) { if (e.code === 11000) return null; throw e }
}
const unreserve = (cid, day, n, field) => C('bsDaily').updateOne({ _id: `${cid}:${day}` }, { $inc: { used: -n, ...(field ? { [field]: n } : {}) } })
const countDay = (cid, day, field) => C('bsDaily').updateOne({ _id: `${cid}:${day}` }, { $inc: { [field]: 1 } })

// ---------- pause / resume (credit watch, admin, provider auth) ----------
const state = async () => ({ reasons: [], ...((await C('bsConfig').findOne({ _id: 'state' })) || {}) })
async function pause(reason, note) {
  const r = await C('bsConfig').updateOne({ _id: 'state', reasons: { $ne: reason } }, { $addToSet: { reasons: reason }, $set: { [`notes.${reason}`]: note || null, pausedAt: new Date() } }, { upsert: true }).catch(e => (e.code === 11000 ? { modifiedCount: 0 } : Promise.reject(e)))
  if (r.modifiedCount || r.upsertedCount) { alert(`⏸ Sending PAUSED — ${reason}${note ? `: ${note}` : ''}. Queued texts wait and continue automatically when it clears.`); incident('paused', { reason, note }) }
}
async function resume(reason) {
  const r = await C('bsConfig').updateOne({ _id: 'state', reasons: reason }, { $pull: { reasons: reason } })
  if (r.modifiedCount) { const left = (await state()).reasons; alert(`▶️ ${reason} cleared. ${left.length ? `Still paused: ${left.join(', ')}` : 'Sending resumed.'}`); incident('resumed', { reason }) }
}
let planCache = { at: 0, cost: 10 }
async function planCost() { if (Date.now() - planCache.at > 10 * MIN) { const p = await P.plan().catch(() => null); planCache = { at: Date.now(), cost: p?.cost || planCache.cost } } return planCache.cost }
// Credit forecast: balance minus what is already promised (queued prepaid texts, plan renewals due soon) minus the floor, and the runway at the last week's pace.
async function forecast(c, bal) {
  const wk = new Date(Date.now() - 7 * DAY)
  const [q] = await C('bsMessages').aggregate([{ $match: { direction: 'out', status: { $in: ['queued', 'processing', 'submitted'] }, test: { $ne: true } } }, { $group: { _id: null, parts: { $sum: '$segments' } } }]).toArray()
  const [vb] = await C('bsBookings').aggregate([{ $match: { campaignId: null, paymentStatus: 'paid', status: { $in: ['confirmed', 'scheduled', 'provisioning', 'processing'] } } }, { $group: { _id: null, parts: { $sum: '$volume' } } }]).toArray()
  const parts = (q?.parts || 0) + (vb?.parts || 0)
  const cost = await planCost(), renewals = await C('bsEsims').countDocuments({ status: { $in: [...USABLE, 'testing'] }, expirationDate: { $ne: null, $lt: new Date(Date.now() + c.renewalWindowDays * DAY) } })
  const sent7 = await C('bsMessages').countDocuments({ direction: 'out', status: { $in: ['sent', 'delivered'] }, sentAt: { $gt: wk } })
  const [p7] = await C('bsAudit').aggregate([{ $match: { action: 'provision', at: { $gt: wk } } }, { $group: { _id: null, usd: { $sum: '$cost' } } }]).toArray()
  const committed = Math.round((parts * c.providerSmsCost + renewals * cost) * 100) / 100, available = Math.round((bal - committed - c.minCredit) * 100) / 100
  const daily = (sent7 * c.providerSmsCost + (p7?.usd || 0)) / 7
  return { credit: bal, committed, available, daily: Math.round(daily * 100) / 100, runway: daily > 0 ? Math.round((available / daily) * 10) / 10 : null, renewals, lineCost: cost, at: new Date() }
}
const once = async (key) => (await C('bsConfig').updateOne({ _id: key }, { $setOnInsert: { at: new Date() } }, { upsert: true })).upsertedCount > 0
async function creditWatch() {
  const c = await cfg()
  let bal; try { bal = await P.credit() } catch (_) { return }
  const f = await forecast(c, bal)
  await C('bsConfig').updateOne({ _id: 'state' }, { $set: { credit: bal, creditAt: new Date(), forecast: f } }, { upsert: true }).catch(() => {})
  if (bal < c.minCredit) {
    await pause('provider_credit', `Spenza balance $${bal} is below $${c.minCredit}. Add credit at web.spenza.com`)
    const st = await state(); if (Date.now() - (st.creditNagAt || 0) > HOUR) { await C('bsConfig').updateOne({ _id: 'state' }, { $set: { creditNagAt: Date.now() } }); if (st.creditNagAt) alert(`⏸ Still paused: Spenza balance $${bal} (floor $${c.minCredit}). ${f.committed ? `$${f.committed} of texts are waiting. ` : ''}Add credit at web.spenza.com`) }
  } else {
    await resume('provider_credit')
    if ((f.available < 0 || (f.runway != null && f.runway < c.creditWarnDays)) && await once(`creditwarn:${today()}`)) alert(`⚠️ Spenza credit is getting low: $${bal} on the account, $${f.committed} already promised (${f.renewals} renewal(s) due within ${c.renewalWindowDays} days), ~$${f.daily}/day lately → ${f.available < 0 ? 'new bookings are on hold' : `about ${f.runway} day(s) left`}. Add credit at web.spenza.com`)
  }
}
// Bookings stop while the balance can't cover what is already promised plus this one (no forecast yet → allowed).
async function creditShort(c, parts) { const st = await state(); return st.reasons?.includes('provider_credit') || (st.forecast ? st.forecast.available - parts * c.providerSmsCost < 0 : false) }

// ---------- inventory ----------
async function nextEsimId() { const r = await C('bsConfig').findOneAndUpdate({ _id: 'esimSeq' }, { $inc: { n: 1 } }, { upsert: true, returnDocument: 'after' }); const n = (r?.value || r).n; return `ESIM-${String(n).padStart(4, '0')}` }
async function addEsim(fields, status = 'testing') {
  const doc = { _id: await nextEsimId(), provider: P.name, providerEsimId: fields.iccid || null, iccid: fields.iccid || null, imsi: fields.imsi || null, msisdn: fields.msisdn || null, providerRef: fields.providerRef || null, status, health: 'unknown', healthScore: 100, activationDate: fields.msisdn ? new Date() : null, expirationDate: fields.expirationDate || null, replaces: fields.replaces || null, verify: !!fields.verify, stats: { submitted: 0, sent: 0, failed: 0 }, history: [{ status, at: new Date() }], createdAt: new Date() }
  await C('bsEsims').insertOne(doc); return doc
}
const setEsim = (eid, status, extra = {}) => C('bsEsims').updateOne({ _id: eid }, { $set: { status, ...extra, updatedAt: new Date() }, $push: { history: { status, at: new Date(), ...(extra.note ? { note: extra.note } : {}) } } })
const liveCount = () => C('bsEsims').countDocuments({ status: { $nin: ['replaced', 'failed', 'expired'] } })
const spentMonth = async () => (await C('bsConfig').findOne({ _id: `spend:${new Date().toISOString().slice(0, 7)}` }))?.usd || 0
// How many lines could still be bought right now (max, monthly budget, credit forecast); 0 unless auto-provisioning is on.
async function buyable(c) {
  if (!c.autoProvision || c.manualApproval) return 0
  const cost = await planCost(), f = (await state()).forecast
  return Math.max(0, Math.min(c.maxEsims - await liveCount(), Math.floor((c.provisionBudget - await spentMonth()) / cost), f ? Math.floor(f.available / cost) : Infinity))
}
async function provisionOne(reason, by) {
  const c = await cfg(), month = new Date().toISOString().slice(0, 7)
  const spent = await spentMonth(), cost = await planCost(), f = (await state()).forecast
  if ((await liveCount()) >= c.maxEsims) return { error: `Inventory is at the maximum (${c.maxEsims}).` }
  if (spent + cost > c.provisionBudget) { alert(`Provisioning blocked: monthly budget $${c.provisionBudget} (spent $${spent}).`); return { error: 'Monthly provisioning budget reached.' } }
  if (f && f.available - cost < 0) { if (await once(`provcredit:${today()}`)) alert(`Provisioning blocked: Spenza credit $${f.credit} must keep $${f.committed} for promised texts/renewals plus the $${c.minCredit} floor — a new line costs $${cost}. Add credit at web.spenza.com`); return { error: 'Not enough Spenza credit for a new line.' } }
  const e = await addEsim({}, 'purchasing')
  try {
    const r = await P.provision({ key: e._id })
    await C('bsConfig').updateOne({ _id: `spend:${month}` }, { $inc: { usd: cost } }, { upsert: true })
    await setEsim(e._id, r.phoneNumber ? 'testing' : 'provisioning', { providerRef: r.transactionId, iccid: r.iccid || null, providerEsimId: r.iccid || null, msisdn: r.phoneNumber || null, activationDate: r.phoneNumber ? new Date() : null })
    await C('bsConfig').updateOne({ _id: 'state', forecast: { $ne: null } }, { $inc: { 'forecast.available': -cost } }).catch(() => {})
    audit('provision', { esimId: e._id, reason, by, cost }); return { ok: true, esimId: e._id }
  } catch (err) {
    await setEsim(e._id, 'failed', { note: err.message }); alert(`❌ Provisioning ${e._id} failed: ${err.message}`)
    if (err.kind === 'credit') await pause('provider_credit', err.message)
    return { error: err.message }
  }
}
async function provisionMany(n, reason, by) {
  let ok = 0, error = null
  for (let i = 0; i < n; i++) { const r = await provisionOne(reason, by); if (r.error) { error = r.error; break } ok++ }
  return { ok, error }
}
// Serialises "how many lines are missing → buy them" so two payments or a payment + autoscale never buy the same gap twice.
async function provisionFor(reason, computeNeed, buy = true) {
  if (!(await lock('provision', 120000))) return { need: 0, ok: 0, error: 'busy' }
  try { const need = await computeNeed(); const r = need && buy ? await provisionMany(need, reason) : { ok: 0, error: null }; return { need, ...r } } finally { await unlock('provision') }
}
// Provider-suspended / restricted line: ask for a new number (bounded per day); the new number must pass a delivery test.
async function autoReplace(e, why, c) {
  if (!c.autoReplace || e.replacedBy || e.status === 'replaced') return
  const key = `replaces:${today()}`, r = await C('bsConfig').updateOne({ _id: key, n: { $not: { $gte: c.maxReplacesPerDay } } }, { $inc: { n: 1 }, $set: { at: new Date() } }, { upsert: true }).catch(x => (x.code === 11000 ? null : Promise.reject(x)))
  if (!r || !(r.modifiedCount || r.upsertedCount)) { if (await once(`replimit:${today()}:${e._id}`)) alert(`⚠️ ${e._id} ${e.msisdn || ''}: ${why} — today's auto-replacement limit (${c.maxReplacesPerDay}) is reached. /bulkreplace ${e._id} to do it by hand.`); return }
  const x = await replaceEsim(e._id, `auto: ${why}`, 'system')
  alert(x.ok ? `🔁 ${e._id} ${e.msisdn || ''} ${why} → new number requested as ${x.newEsimId}; it joins the pool only after a delivery test.` : `❌ ${e._id} ${why} — number replacement failed. ${c.autoProvision && !c.manualApproval ? 'Buying a new eSIM instead.' : 'Use /bulkprovision for a new eSIM.'}`)
  if (!x.ok && c.autoProvision && !c.manualApproval) await provisionOne(`replacement of ${e._id} failed`)
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
    if (/SUSPEND|DEACTIV|BLOCK/.test(st) && e.status !== 'suspended') { await setEsim(e._id, 'suspended', { ...set, note: `provider ${st}` }); alert(`⚠️ ${e._id} ${e.msisdn || ''} suspended by provider (${st}).`); await autoReplace({ ...e, ...set }, `suspended by provider (${st})`, await cfg()); continue }
    await C('bsEsims').updateOne({ _id: e._id }, { $set: set })
    if (e.status === 'provisioning' && msisdn) await setEsim(e._id, 'testing')
  }
}
async function replaceEsim(eid, reason, by) {
  const e = await C('bsEsims').findOne({ _id: eid }); if (!e || e.status === 'replaced') return { error: 'Not found' }
  await setEsim(eid, 'replaced', { note: reason })
  const n = await addEsim({ iccid: e.iccid, replaces: eid, verify: true }, 'provisioning')
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
  for (const e of await C('bsEsims').find({ status: { $in: [...USABLE, 'testing', 'degraded', 'suspended'] }, iccid: { $ne: null }, replacedBy: null }).toArray()) {
    let health = 'healthy', err = null, expires = e.expirationDate || null
    try { const sim = await P.getSim(e.iccid), sv = await P.serviceState(e.iccid), sub = await P.subscription(e.iccid).catch(() => null); const st = String(sim?.status || '').toUpperCase()
      if (sub?.endDate && !isNaN(Date.parse(sub.endDate))) expires = new Date(sub.endDate)
      if (expires && expires < new Date()) health = 'expired'; else if (/SUSPEND|BLOCK/.test(st)) health = 'suspended'; else if (sv && sv.sms === false) health = 'provider_restricted'; else if (st && st !== 'ACTIVE') health = 'temporarily_unavailable'
    } catch (x) { err = x; health = x.kind === 'temporary' || x.kind === 'rate' ? 'temporarily_unavailable' : 'technically_failed' }
    const recent = await C('bsMessages').find({ esimId: e._id, direction: 'out', submittedAt: { $gt: new Date(Date.now() - DAY) } }, { projection: { status: 1 } }).toArray()
    const fails = recent.filter(m => m.status === 'failed').length, rate = recent.length ? fails / recent.length : 0
    if (health === 'healthy' && recent.length >= 20 && rate > 0.3) health = 'sending_failure'; else if (health === 'healthy' && (e.recvMiss || 0) >= 3) health = 'degraded'
    const score = Math.max(0, Math.round(100 - rate * 100 - (e.recvMiss || 0) * 5 - (health === 'healthy' ? 0 : 30)))
    await C('bsTests').insertOne({ esimId: e._id, type: 'status', result: health, providerResponse: err?.message || null, errorCode: err?.code || null, at: new Date() })
    const set = { health, healthScore: score, lastTestAt: new Date(), expirationDate: expires, ...(health === 'healthy' ? { lastOkAt: new Date() } : {}) }
    if (health === 'expired') { await setEsim(e._id, 'expired', { ...set, note: 'plan ended' }); alert(`⌛ ${e._id} ${e.msisdn || ''}: plan ended (not renewed by Spenza — check the account credit). It left the pool.`); incident('esim_expired', { esimId: e._id }); continue }
    if (e.status === 'testing' && health === 'healthy' && e.msisdn) {
      if (e.verify && (await verifyLine(e, c)) !== 'passed') { await C('bsEsims').updateOne({ _id: e._id }, { $set: set }); continue }
      await setEsim(e._id, 'available', set); alert(`✅ ${e._id} ${e.msisdn} passed checks and joined the pool.`); continue
    }
    if (['suspended', 'technically_failed', 'sending_failure', 'provider_restricted'].includes(health) && e.health !== health) { alert(`⚠️ ${e._id} ${e.msisdn || ''}: ${health.replace(/_/g, ' ')}${err ? ` (${err.message})` : ''}. New sends avoid it.`); incident('esim_health', { esimId: e._id, health }) }
    await C('bsEsims').updateOne({ _id: e._id }, { $set: set })
    if (['suspended', 'provider_restricted'].includes(health) && [...USABLE, 'suspended'].includes(e.status)) { if (e.status !== 'suspended') await setEsim(e._id, 'suspended', { note: health }); await autoReplace({ ...e, ...set }, health.replace(/_/g, ' '), c) }
    else if (e.status === 'suspended' && health === 'healthy') { await setEsim(e._id, 'available', { note: 'provider lifted the suspension' }); alert(`✅ ${e._id} ${e.msisdn || ''}: suspension lifted by the provider — back in the pool.`) }
  }
  if (Date.now() - ((await state()).loopAt || 0) > c.testEveryHours * HOUR) await loopTest()
}
// Delivery test for a replaced line: a text to another pool line must come back through the webhook (2 misses → retired, new eSIM bought).
async function verifyLine(e, c) {
  if (await C('bsTests').findOne({ esimId: e._id, type: 'verify', result: 'passed' })) return 'passed'
  if ((await C('bsTests').countDocuments({ esimId: e._id, type: 'verify', result: 'no_reply' })) >= 2) {
    await setEsim(e._id, 'failed', { note: 'delivery test failed twice' }); alert(`❌ ${e._id} ${e.msisdn}: the new number does not deliver texts — retired.${c.autoProvision && !c.manualApproval ? ' Buying a new eSIM.' : ' Use /bulkprovision for a new eSIM.'}`); incident('verify_failed', { esimId: e._id })
    if (c.autoProvision && !c.manualApproval) await provisionOne(`${e._id} failed its delivery test`)
    return 'failed'
  }
  if (await C('bsTests').findOne({ esimId: e._id, type: 'verify', result: 'pending' })) return 'pending'
  const peer = await C('bsEsims').findOne({ _id: { $ne: e._id }, status: { $in: USABLE }, health: { $in: GOOD_HEALTH }, msisdn: { $ne: null } })
  if (!peer) { alert(`⚠️ ${e._id} ${e.msisdn}: no other line to test delivery against — joined the pool unverified.`); return 'passed' }
  const code = crypto.randomBytes(3).toString('hex')
  await C('bsTests').insertOne({ esimId: e._id, peer: peer._id, type: 'verify', code, result: 'pending', at: new Date() })
  await C('bsMessages').insertOne(msgDoc({ cid: 'system:health', to: peer.msisdn, body: `CloudIVR line check ${code}`, priority: 2, esimId: e._id, system: true }))
  return 'pending'
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
  for (const t of await C('bsTests').find({ type: { $in: ['loop', 'verify'] }, result: 'pending', at: { $lt: new Date(Date.now() - 10 * MIN) } }).toArray()) {
    await C('bsTests').updateOne({ _id: t._id }, { $set: { result: 'no_reply' } })
    if (t.type === 'loop') await C('bsEsims').updateOne({ _id: t.peer }, { $inc: { recvMiss: 1 } })
  }
}

// ---------- capacity + bookings ----------
// Lines that can carry `date` with each one's cap that day: usable healthy lines, plus (from tomorrow) lines already bought/testing.
async function fleet(date, c, pendingToo = daysAhead(date) >= 1) {
  const rows = await C('bsEsims').find({ $or: [{ status: { $in: USABLE }, health: { $in: GOOD_HEALTH } }, ...(pendingToo ? [{ status: { $in: ['purchasing', 'provisioning', 'testing'] } }] : [])] }, { projection: { activationDate: 1, createdAt: 1 } }).toArray()
  return rows.map(e => ({ id: e._id, cap: lineCap(c, lineAge(e.activationDate || e.createdAt, date)) }))
}
// Capacity for `date`: per hour (Spenza limit vs lines × per-line rate) and per day (sum of line caps). Dates at least
// `leadDays` ahead also count lines the engine can still buy, so a big booking triggers the purchase instead of a refusal.
async function capacity(date, c) {
  const lines = await fleet(date, c), ahead = daysAhead(date), extra = ahead >= c.leadDays ? await buyable(c) : 0
  const n = lines.length + extra, dayCap = lines.reduce((a, l) => a + l.cap, 0) + extra * lineCap(c, ahead + 1)
  return { lines: n, projected: extra, perHour: Math.floor(Math.min(c.platformPerMin, n * c.esimPerMin) * 60 * c.slotUtilization), perDay: Math.floor(dayCap * c.slotUtilization) }
}
// Lines still missing to carry everything booked for `date` (plus `extra` unmet demand); lines on their way count, unbought ones don't.
async function linesShort(date, c, extra = 0, pendingToo = true) {
  const res = await reservedBySlot([date]), dayRes = Object.values(res).reduce((a, v) => a + v, 0) + extra, hourMax = Math.max(0, ...Object.values(res))
  const lines = await fleet(date, c, pendingToo), dayCap = lines.reduce((a, l) => a + l.cap, 0) * c.slotUtilization, hourCap = Math.min(c.platformPerMin, lines.length * c.esimPerMin) * 60 * c.slotUtilization
  const per = lineCap(c, daysAhead(date) + 1) * c.slotUtilization, perHour = c.esimPerMin * 60 * c.slotUtilization
  return Math.max(0, Math.ceil((dayRes - dayCap) / per), Math.ceil((hourMax - hourCap) / perHour))
}
// A refused booking is demand too: remembered per customer and day so the autoscaler buys lines for the coming days.
const unmet = (cid, date, volume) => { const a = daysAhead(date); return a >= 0 && a <= 7 ? C('bsDemand').updateOne({ _id: `${cid}:${date}` }, { $max: { volume }, $set: { at: new Date(), date } }, { upsert: true }).catch(() => {}) : null }
async function unmetDemand() { const [g] = await C('bsDemand').aggregate([{ $match: { at: { $gt: new Date(Date.now() - DAY) } } }, { $group: { _id: null, v: { $sum: '$volume' } } }]).toArray(); return g?.v || 0 }
const slotKey = (date, h) => `${date}T${String(h).padStart(2, '0')}`
async function reservedBySlot(dates) {
  const now = new Date(), out = {}
  for (const b of await C('bsBookings').find({ date: { $in: dates }, status: { $in: LIVE_BOOKING } }).toArray()) {
    if (['pending', 'awaiting_payment'].includes(b.status) && b.holdUntil < now) continue
    for (const [k, v] of Object.entries(b.allocation || {})) out[k] = (out[k] || 0) + v
  }
  return out
}
// 24 hourly slots (UTC) with what is left; past hours are closed. `dayFree` caps the whole day (per-line daily limits).
async function availability(date) {
  const c = await cfg(), cap = await capacity(date, c), next = new Date(new Date(`${date}T00:00:00Z`).getTime() + DAY).toISOString().slice(0, 10)
  const res = await reservedBySlot([date, next]), maint = (await C('bsConfig').findOne({ _id: 'maintenance' }))?.slots || []
  const dayFree = Math.max(0, cap.perDay - Object.entries(res).filter(([k]) => k.startsWith(date)).reduce((a, [, v]) => a + v, 0))
  return { capacity: cap.perHour, perDay: cap.perDay, dayFree, lines: cap.lines, projected: cap.projected, slots: Array.from({ length: 24 }, (_, h) => { const k = slotKey(date, h), past = new Date(`${k}:00:00Z`).getTime() < Date.now() + 5 * MIN, quiet = !hourOpen(date, h, c.quietStart, c.quietEnd); return { hour: h, key: k, quiet, free: past || quiet || maint.includes(k) || c.emergencyStop ? 0 : Math.min(dayFree, Math.max(0, cap.perHour - (res[k] || 0))) } }) }
}
function allocate(slots, from, volume, dayFree = Infinity) {
  if (volume > dayFree) return null
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
// Volume = SMS parts. Price = parts × (link/phone or plain rate). The day's allowance must have room for the whole booking.
async function createBooking(cid, { date, hour, volume, type = 'paid', campaignId }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date)) || isNaN(Date.parse(date)) || !(Number.isInteger(Number(hour)) && hour !== null && hour !== '' && Number(hour) >= 0 && Number(hour) < 24)) return E('err_slot')
  const c = await cfg(), cu = await C('bsCustomers').findOne({ _id: cid }), cp = campaignId ? await C('bsCampaigns').findOne({ _id: campaignId, cid }) : null
  const v = Math.round(Number(cp ? cp.parts : volume)), unit = cp?.withLinks ? c.priceLink : c.pricePlain, limit = cu?.dailyLimit ?? c.defaultDailyLimit
  if (cu?.status !== 'active') return E('err_suspended')
  if (!(v >= c.minVolume && v <= c.maxVolume)) return E('err_volume', c.minVolume, c.maxVolume)
  if (v > limit) return E('err_allowance_over', limit)
  if (type === 'free' && (!c.freeBookings || v > c.freeVolume)) return E('err_free')
  if (!(await capacity(date, c)).perHour) { await unmet(cid, date, v); return E('err_no_lines') }
  if (await creditShort(c, v)) return E('err_no_lines')
  const startAt = new Date(`${slotKey(date, hour)}:00:00Z`), used = (await C('bsDaily').findOne({ _id: `${cid}:${dayKey(startAt, c)}` }))?.used || 0
  if (used + v > limit) return E('err_allowance_day', Math.max(0, limit - used), dayKey(startAt, c))
  if (!(await lock(`book:${date}`))) return E('err_busy')
  try {
    const { slots, dayFree } = await availability(date), alloc = allocate(slots, Number(hour), v, dayFree)
    if (!alloc) { if (v > dayFree) await unmet(cid, date, v); return E('err_slot') }
    const b = { _id: id('bk'), cid, campaignId: campaignId || null, type, date, hour: Number(hour), startAt, estimatedCompletion: new Date(`${Object.keys(alloc).pop()}:59:59Z`), volume: v, unitPrice: unit, allocation: alloc, price: type === 'free' ? 0 : Math.round(v * unit * 100) / 100, status: 'awaiting_payment', paymentStatus: type === 'free' ? 'free' : 'unpaid', holdUntil: new Date(Date.now() + c.holdMinutes * MIN), history: [{ status: 'awaiting_payment', at: new Date() }], createdAt: new Date() }
    await C('bsBookings').insertOne(b); await C('bsDemand').deleteOne({ _id: `${cid}:${date}` }).catch(() => {}); return { booking: b }
  } finally { await unlock(`book:${date}`) }
}
const setBooking = (bid, status, extra = {}) => C('bsBookings').updateOne({ _id: bid }, { $set: { status, ...extra, updatedAt: new Date() }, $push: { history: { status, at: new Date() } } })
// Payment confirmed by the bot (wallet / crypto / bank already collected). Expired holds are re-checked for capacity.
async function confirmBooking(bid, { method, amount, ref } = {}) {
  const b = await C('bsBookings').findOne({ _id: bid }); if (!b) return E('err_not_found')
  if (!['pending', 'awaiting_payment'].includes(b.status)) return { ...E('err_not_waiting'), refund: b.price }
  if (b.holdUntil < new Date()) { const { slots, dayFree } = await availability(b.date); if (!allocate(slots, b.hour, b.volume, dayFree)) { await setBooking(bid, 'failed', { note: 'Hold expired and the slot filled up' }); return { ...E('err_hold_full'), refund: b.price } } }
  const c0 = await cfg(), quotaDay = await reserve(b.cid, b.volume, c0, dayKey(b.startAt, c0))
  if (!quotaDay) { await setBooking(bid, 'failed', { note: 'daily allowance full' }); return { ...E('err_allowance_day', 0, dayKey(b.startAt, c0)), refund: b.price } }
  await C('bsBookings').updateOne({ _id: bid }, { $set: { quotaDay } }); b.quotaDay = quotaDay
  await C('bsPayments').insertOne({ cid: b.cid, bookingId: bid, amount: amount ?? b.price, currency: 'USD', method: method || 'wallet', reference: ref || null, status: 'paid', at: new Date() })
  const c = await cfg()
  await setBooking(bid, 'scheduled', { paymentStatus: b.type === 'free' ? 'free' : 'paid', holdUntil: new Date(Date.now() + c.holdMinutes * MIN) })
  const r = await provisionFor(`booking ${bid}`, () => linesShort(b.date, c), c.autoProvision && !c.manualApproval && b.type === 'paid')
  if (r.need) {
    await setBooking(bid, 'provisioning')
    alert(`📦 Booking ${bid} (${b.volume} SMS on ${b.date}) needs ${r.need} more line(s)${r.ok ? ` — buying ${r.ok}` : ''}${r.ok < r.need ? `. ${r.need - r.ok} still missing: ${r.error || 'approve with /bulkprovision'}` : ''}.`)
  }
  if (b.campaignId) await queueCampaign(b.campaignId, b)
  await notify(b.cid, 'booking', 'n_booking', [b.volume, b.date, String(b.hour).padStart(2, '0')], { bookingId: bid })
  audit('booking_confirm', { bookingId: bid, method }); return { ok: true }
}
async function cancelBooking(bid, { by = 'customer', cid } = {}) {
  const b = await C('bsBookings').findOne({ _id: bid, ...(cid ? { cid } : {}) }); if (!b) return E('err_not_found')
  if (!['pending', 'awaiting_payment', 'confirmed', 'scheduled', 'provisioning'].includes(b.status)) return E('err_cant_cancel')
  if (by === 'customer' && b.startAt < new Date(Date.now() + 30 * MIN) && b.paymentStatus === 'paid') return E('err_cancel_late')
  if (await C('bsMessages').countDocuments({ bookingId: bid, test: { $ne: true }, status: { $ne: 'queued' } }, { limit: 1 })) return E('err_cant_cancel')
  const paid = b.paymentStatus === 'paid'
  await setBooking(bid, paid ? 'refunded' : 'cancelled', { cancelledBy: by })
  await C('bsMessages').updateMany({ bookingId: bid, status: 'queued' }, { $set: { status: 'expired', failureReason: 'booking_cancelled' } })
  if (b.campaignId) await C('bsCampaigns').updateOne({ _id: b.campaignId }, { $set: { status: 'cancelled' } })
  if (b.quotaDay) await unreserve(b.cid, b.quotaDay, b.volume)
  if (paid) await notify(b.cid, 'refund', 'n_refund_cancel', [b.volume, b.date, b.price], { amount: b.price, bookingId: bid })
  audit('booking_cancel', { bookingId: bid, by }); return { ok: true, refunded: paid ? b.price : 0 }
}
async function expireHolds() {
  await C('bsConfig').deleteMany({ _id: /^(creditwarn|replaces|scale|provcredit|help|replimit):/, at: { $lt: new Date(Date.now() - 30 * DAY) } }).catch(() => {})
  for (const b of await C('bsBookings').find({ status: { $in: ['pending', 'awaiting_payment'] }, holdUntil: { $lt: new Date(Date.now() - 6 * HOUR) } }).limit(100).toArray()) await setBooking(b._id, 'cancelled', { note: 'hold_expired' })
}

// ---------- campaigns + messages ----------
function msgDoc({ cid, to, body, campaignId = null, bookingId = null, sessionId = null, esimId = null, priority = 0, notBefore = null, test = false, system = false, prepaid = false, quotaDay = null, expireAt = null }) {
  return { _id: id('m'), cid, brand: cid.split(':')[0], campaignId, bookingId, sessionId, esimId, to, from: null, body, segments: segs(body), direction: 'out', status: 'queued', history: [{ s: 'queued', at: new Date() }], attempts: 0, priority, nextAt: notBefore || new Date(), test, system, prepaid, quotaDay, expireAt, createdAt: new Date() }
}
// contacts: raw text (one per line / comma separated, CSV ok). Keeps valid USA/Canada numbers, drops duplicates and opted-out ones.
async function parseContacts(cid, raw) {
  const seen = new Set(); let bad = 0, dup = 0
  for (const tok of String(raw || '').split(/[\n,;\t]+/)) { const t = tok.trim(); if (!t) continue; const p = normPhone(t); if (p && validUsCa(p)) { if (seen.has(p)) dup++; seen.add(p) } else if (/\d{7,}/.test(t)) bad++ }
  const list = [...seen], sup = new Set((await C('bsSuppression').find({ $or: [{ cid }, { cid: '*' }], phone: { $in: list } }).toArray()).map(s => s.phone))
  return { contacts: list.filter(p => !sup.has(p)), invalid: bad, optedOut: sup.size, duplicates: dup }
}
// Checks the declared link/phone choice, adds the opt-out line, counts SMS parts and keeps contacts within the max parts.
function checkContent(content, withLinks) {
  const parts = (Array.isArray(content) ? content : String(content || '').split(/\n?---\n?/)).map(x => x.trim()).filter(Boolean)
  if (!parts.length) return E('err_add_text')
  if (parts.some(p => segs(p + OPT) > 3)) return E('err_too_long')
  if (!withLinks && parts.some(hasLinkOrPhone)) return E('err_has_link')
  return { parts, segs: parts.map(p => segs(p + OPT)) }
}
async function createCampaign(cid, { name, content, contacts, withLinks = false, consent = false, uploadId = null }) {
  const c = await cfg(), k = checkContent(content, withLinks); if (k.error) return k
  if (!consent) return E('err_consent')
  let total = 0, n = 0
  for (; n < contacts.length; n++) { const s = k.segs[n % k.parts.length]; if (total + s > c.maxVolume) break; total += s }
  if (total < c.minVolume) return E('err_few', c.minVolume, total)
  const doc = { _id: id('cp'), cid, name: String(name || 'Campaign').slice(0, 60), content: k.parts, withLinks: !!withLinks, consentAt: new Date(), contacts: contacts.slice(0, n), dropped: contacts.length - n, parts: total, uploadId, volume: n, status: 'draft', testsUsed: 0, stats: { queued: 0, sent: 0, failed: 0, rejected: 0, replies: 0, optOuts: 0 }, createdAt: new Date() }
  await C('bsCampaigns').insertOne(doc); return { campaign: doc }
}
// Up to cfg.testSends test texts per campaign during setup; they use the daily allowance like any text.
async function testSend(cid, campaignId, to) {
  const c = await cfg(), cp = await C('bsCampaigns').findOne({ _id: campaignId, cid }), p = normPhone(to)
  if (!cp) return E('err_campaign')
  if (!validUsCa(p)) return E('err_number')
  const r = await C('bsCampaigns').updateOne({ _id: campaignId, testsUsed: { $lt: c.testSends } }, { $inc: { testsUsed: 1 } })
  if (!r.modifiedCount) return E('err_tests_used', c.testSends)
  const m = msgDoc({ cid, to: p, body: cp.content[0] + OPT, campaignId, priority: 1, test: true })
  await C('bsMessages').insertOne(m); return { ok: true, left: c.testSends - cp.testsUsed - 1, messageId: m._id }
}
async function queueCampaign(campaignId, b) {
  const cp = await C('bsCampaigns').findOne({ _id: campaignId }); if (!cp || cp.status !== 'draft') return
  const docs = cp.contacts.map((to, i) => msgDoc({ cid: cp.cid, to, body: cp.content[i % cp.content.length] + OPT, campaignId, bookingId: b._id, notBefore: b.startAt, prepaid: true, quotaDay: b.quotaDay, expireAt: new Date(b.startAt.getTime() + 2 * DAY) }))
  for (let i = 0; i < docs.length; i += 500) await C('bsMessages').insertMany(docs.slice(i, i + 500))
  await C('bsCampaigns').updateOne({ _id: campaignId }, { $set: { status: 'scheduled', bookingId: b._id, scheduledAt: b.startAt, 'stats.queued': docs.length } })
}
// One text in an existing conversation (or a new one). Same queue, same quota.
async function sendOne(cid, to, text, sessionId) {
  const cu = await C('bsCustomers').findOne({ _id: cid }), p = normPhone(to), body = String(text || '').trim()
  if (cu?.status !== 'active') return E('err_suspended')
  if (!validUsCa(p)) return E('err_number')
  if (!body) return E('err_add_text')
  const full = sessionId ? body : body + OPT
  if (segs(full) > 3) return E('err_too_long')
  if ((await usage(cid)).remaining < segs(full)) return E('err_quota_used')
  if (await C('bsSuppression').findOne({ $or: [{ cid }, { cid: '*' }], phone: p })) return E('err_opted')
  const m = msgDoc({ cid, to: p, body: full, sessionId: sessionId || null, priority: 1 }); await C('bsMessages').insertOne(m)
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
  // New conversations respect each line's daily cap (warm-up); replies inside a session stay on their line regardless.
  const pool = await C('bsEsims').find({ status: { $in: USABLE }, health: { $in: GOOD_HEALTH }, msisdn: { $ne: null } }).sort({ 'stats.submitted': 1 }).toArray(), d = dayKey(Date.now(), c)
  const used = Object.fromEntries((await C('bsEsimDaily').find({ _id: { $in: pool.map(e => `${e._id}:${d}`) } }).toArray()).map(x => [x._id, x.n]))
  return pool.find(e => ok(e) && (used[`${e._id}:${d}`] || 0) < lineCap(c, lineAge(e.activationDate || e.createdAt, d))) || null
}
async function processOne(m, c) {
  const later = (ms, extra = {}) => C('bsMessages').updateOne({ _id: m._id }, { $set: { status: 'queued', nextAt: new Date(Date.now() + ms), ...extra } })
  if (!m.system) {
    const cu = await C('bsCustomers').findOne({ _id: m.cid })
    const drop = async (status, why) => { if (m.prepaid && m.quotaDay) await unreserve(m.cid, m.quotaDay, c.countSegments ? m.segments : 1); return mark(m, status, { failureReason: why }) }
    if (cu?.status !== 'active') return drop('rejected', 'customer_suspended')
    if (await C('bsSuppression').findOne({ $or: [{ cid: m.cid }, { cid: '*' }], phone: m.to })) return drop('rejected', 'opted_out')
    if (m.expireAt && new Date(m.expireAt) < new Date()) return drop('expired', 'too_late')
    if (!m.test && !m.sessionId) { const w = quietWait(m.to, c.quietStart, c.quietEnd); if (w) return later(w) }
  }
  const e = await pickEsim(m, c); if (!e) { await later(15000); return 'starved' }
  const n = c.countSegments ? m.segments : 1, day = m.system ? null : m.quotaDay || await reserve(m.cid, n, c)
  if (!m.system && !day) { await mark(m, 'rejected', { failureReason: 'daily_allowance' }); return notifyQuotaOnce(m.cid, c) }
  win.all.push(Date.now()); (win.esim[e._id] ||= []).push(Date.now())
  await mark(m, 'submitted', { esimId: e._id, from: e.msisdn, quotaDay: day, submittedAt: new Date() })
  await C('bsEsims').updateOne({ _id: e._id }, { $inc: { 'stats.submitted': 1 } })
  if (!m.system && !m.sessionId) { const d = dayKey(Date.now(), c); await C('bsEsimDaily').updateOne({ _id: `${e._id}:${d}` }, { $inc: { n: 1 }, $setOnInsert: { esimId: e._id, day: d } }, { upsert: true }) }
  try {
    await P.sendSms({ from: e.msisdn, to: m.to, text: m.body, key: m._id })
    await mark(m, 'sent', { sentAt: new Date() }); await C('bsEsims').updateOne({ _id: e._id }, { $inc: { 'stats.sent': 1 } })
    if (day) await countDay(m.cid, day, 'sent')
    if (!m.system) await C('bsSessions').updateOne({ cid: m.cid, esimId: e._id, to: m.to }, { $set: { status: 'active', lastActivityAt: new Date(), expiresAt: new Date(Date.now() + c.sessionHours * HOUR) }, $setOnInsert: { _id: id('s'), from: e.msisdn, startedAt: new Date() } }, { upsert: true })
    if (m.campaignId) await C('bsCampaigns').updateOne({ _id: m.campaignId }, { $inc: { 'stats.sent': 1 } })
  } catch (err) {
    const retryable = ['rate', 'credit', 'auth'].includes(err.kind) || (err.kind === 'temporary' && m.attempts < 3)
    if (retryable) { if (day && !m.prepaid) await unreserve(m.cid, day, n); await later(err.kind === 'rate' ? (err.retryAfter || 30) * 1000 : err.kind === 'temporary' ? 30000 * 2 ** m.attempts : 60000, { quotaDay: m.prepaid ? day : null, attempts: m.attempts + (err.kind === 'temporary' ? 1 : 0), lastError: err.message }) }
    else { await mark(m, 'failed', { failureReason: err.message }); await C('bsEsims').updateOne({ _id: e._id }, { $inc: { 'stats.failed': 1 } }); if (day) { if (c.refundFailed) await unreserve(m.cid, day, n, 'failed'); else await countDay(m.cid, day, 'failed') } if (m.campaignId) await C('bsCampaigns').updateOne({ _id: m.campaignId }, { $inc: { 'stats.failed': 1 } }); await C('bsReputation').insertOne({ esimId: e._id, cid: m.cid, deliveryStatus: 'failed', providerError: err.message, incidentType: err.status === 400 ? 'invalid_recipient' : 'provider_rejection', at: new Date() }) }
    if (err.kind === 'credit') await pause('provider_credit', err.message)
    if (err.kind === 'auth') await pause('provider_auth', err.message)
  }
}
async function notifyQuotaOnce(cid, c) {
  const k = `${cid}:${dayKey(Date.now(), c)}`
  const r = await C('bsDaily').updateOne({ _id: k, quotaNotified: { $ne: true } }, { $set: { quotaNotified: true } })
  if (r.modifiedCount) await notify(cid, 'quota', 'n_quota', [nextReset(c).toISOString().slice(11, 16)])
}
// Prepaid texts still waiting 2 days after the start (long pause, no healthy line) expire; their allowance is returned.
async function expireStale(c) {
  // 'processing'/'submitted' left behind by a crash: outcome unknown, counted as failed so the customer is refunded.
  for (const m of await C('bsMessages').find({ prepaid: true, status: { $in: ['queued', 'processing', 'submitted'] }, expireAt: { $lt: new Date() } }).limit(2000).toArray()) {
    const r = await C('bsMessages').updateOne({ _id: m._id, status: m.status }, { $set: { status: m.status === 'queued' ? 'expired' : 'failed', failureReason: m.status === 'queued' ? 'too_late' : 'stuck_unknown' } })
    if (r.modifiedCount && m.quotaDay) await unreserve(m.cid, m.quotaDay, c.countSegments ? m.segments : 1)
  }
}
// Paid campaign done: SMS parts that failed or never went out go back to the wallet.
async function refundUnsent(cp) {
  const b = await C('bsBookings').findOne({ _id: cp.bookingId }); if (!b || b.paymentStatus !== 'paid' || b.refundedUnsent != null) return
  const [g] = await C('bsMessages').aggregate([{ $match: { campaignId: cp._id, test: { $ne: true }, direction: 'out', status: { $in: ['failed', 'rejected', 'expired'] } } }, { $group: { _id: null, parts: { $sum: '$segments' } } }]).toArray()
  const parts = Math.min(g?.parts || 0, b.volume), amount = Math.round(parts * (b.unitPrice ?? b.price / b.volume) * 100) / 100
  const r = await C('bsBookings').updateOne({ _id: b._id, refundedUnsent: null }, { $set: { refundedUnsent: amount, refundedParts: parts } })
  if (r.modifiedCount && amount > 0) await notify(cp.cid, 'refund', 'n_refund_unsent', [cp.name, parts, amount], { amount, bookingId: b._id, campaignId: cp._id })
}
async function finishCampaigns() {
  await expireStale(await cfg())
  for (const cp of await C('bsCampaigns').find({ status: { $in: ['scheduled', 'running'] } }).toArray()) {
    const open = await C('bsMessages').countDocuments({ campaignId: cp._id, test: false, status: { $in: ['queued', 'processing', 'submitted'] } })
    const started = await C('bsMessages').countDocuments({ campaignId: cp._id, test: false, status: { $ne: 'queued' } })
    if (cp.status === 'scheduled' && started) { await C('bsCampaigns').updateOne({ _id: cp._id }, { $set: { status: 'running', startedAt: new Date() } }); await setBooking(cp.bookingId, 'processing'); await notify(cp.cid, 'campaign', 'n_started', [cp.name], { campaignId: cp._id }) }
    if (started && !open) { await C('bsCampaigns').updateOne({ _id: cp._id }, { $set: { status: 'completed', completedAt: new Date() } }); await setBooking(cp.bookingId, 'completed'); const r = await report(cp._id); await notify(cp.cid, 'campaign', 'n_done', [cp.name, r.sent, r.failed, r.rejected, r.replies], { campaignId: cp._id }); await refundUnsent(cp) }
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
      if ((await processOne(m, c)) === 'starved') break
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
  const isStop = STOP.test(kw(x.text)), isHelp = HELP.test(kw(x.text))
  // STOP blocks the number for every customer, even when the line or the reply can't be matched.
  const newStop = isStop && (await C('bsSuppression').updateOne({ cid: '*', phone: x.from }, { $setOnInsert: { reason: 'STOP', source: 'inbound', line: x.to, at: new Date() } }, { upsert: true })).upsertedCount
  if (isStop) {
    for (const q of await C('bsMessages').find({ to: x.from, direction: 'out', status: 'queued', system: { $ne: true } }).toArray()) {
      const r = await C('bsMessages').updateOne({ _id: q._id, status: 'queued' }, { $set: { status: 'rejected', failureReason: 'opted_out' } })
      if (r.modifiedCount && q.prepaid && q.quotaDay) await unreserve(q.cid, q.quotaDay, q.segments || 1)
    }
  }
  const e = await C('bsEsims').findOne({ msisdn: x.to, status: { $ne: 'replaced' } })
  if (!e) { await C('bsWebhooks').updateOne({ _id: key }, { $set: { status: 'unmatched_number' } }); return { status: 200 } }
  const peer = await C('bsEsims').findOne({ msisdn: x.from })
  if (peer) { const code = (x.text.match(/check ([0-9a-f]{6})/) || [])[1]; const t = code && await C('bsTests').findOneAndUpdate({ type: { $in: ['loop', 'verify'] }, code, result: 'pending' }, { $set: { result: 'passed', at2: new Date() } }); if (t) await C('bsEsims').updateOne({ _id: e._id }, { $set: { recvMiss: 0, lastRecvOkAt: new Date() } }); await C('bsWebhooks').updateOne({ _id: key }, { $set: { status: 'health_test' } }); return { status: 200 } }
  const helpOnce = isHelp && (await C('bsConfig').updateOne({ _id: `help:${x.from}:${new Date().toISOString().slice(0, 10)}` }, { $setOnInsert: { at: new Date() } }, { upsert: true })).upsertedCount
  if (newStop) {
    await C('bsMessages').insertOne(msgDoc({ cid: 'system:compliance', to: x.from, body: 'You are unsubscribed and will not get more texts from this number. Reply HELP for help.', esimId: e._id, priority: 2, system: true }))
  } else if (helpOnce) await C('bsMessages').insertOne(msgDoc({ cid: 'system:compliance', to: x.from, body: 'Business text messages sent via CloudIVR. Reply STOP to opt out. Msg & data rates may apply.', esimId: e._id, priority: 2, system: true }))
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
  await notify(cid, 'inbound', isStop ? 'n_inbound_stop' : 'n_inbound', [x.from, x.text], { sessionId: s._id, from: x.from })
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
  const d = dayKey(Date.now(), await cfg())
  const [esims, st, c, bookings, todayRows, used] = await Promise.all([C('bsEsims').find({}, { projection: { history: 0 } }).sort({ _id: 1 }).toArray(), state(), cfg(), C('bsBookings').aggregate([{ $group: { _id: { s: '$status', t: '$type' }, n: { $sum: 1 }, usd: { $sum: '$price' } } }]).toArray(), C('bsMessages').aggregate([{ $match: { direction: 'out', createdAt: { $gte: new Date(d) } } }, { $group: { _id: '$status', n: { $sum: 1 } } }]).toArray(), C('bsEsimDaily').find({ day: d }).toArray()])
  const by = (s) => esims.filter(e => s.includes(e.status)).length, cap = await capacity(d, c), tomorrow = await capacity(new Date(Date.now() + DAY).toISOString().slice(0, 10), c)
  const list = esims.map(e => ({ ...e, today: used.find(u => u.esimId === e._id)?.n || 0, cap: lineCap(c, lineAge(e.activationDate || e.createdAt, d)) }))
  return { paused: st.reasons || [], notes: st.notes || {}, credit: st.credit ?? null, forecast: st.forecast || null, esims: { total: esims.length, active: by(USABLE), available: by(['available']), allocated: by(['allocated']), testing: by(['testing']), pending: by(['pending', 'purchasing', 'provisioning', 'activating']), failed: by(['failed']), suspended: by(['suspended']), replaced: by(['replaced']), expired: by(['expired']), list }, capacity: { perHour: cap.perHour, perDay: cap.perDay, lines: cap.lines, tomorrow: tomorrow.perDay, unmet: await unmetDemand() }, bookings, today: Object.fromEntries(todayRows.map(x => [x._id, x.n])), config: c }
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
// Every 30 min: keep the minimum, cover the next 7 days of bookings plus yesterday's refused demand, release bookings whose lines arrived.
async function autoscale() {
  const c = await cfg(), total = await liveCount(), extra = await unmetDemand()
  let need = Math.max(0, c.minEsims - total), why = need ? 'below minimum inventory' : 'demand'
  for (let i = 0; i < 7; i++) { const d = new Date(Date.now() + i * DAY).toISOString().slice(0, 10); need = Math.max(need, await linesShort(d, c, i >= c.leadDays ? extra : 0)) }
  for (const b of await C('bsBookings').find({ status: 'provisioning' }).toArray()) if (b.startAt < new Date() || !(await linesShort(b.date, c, 0, false))) await setBooking(b._id, 'scheduled')
  if (!need) return
  const healthy = await C('bsEsims').countDocuments({ status: { $in: USABLE }, health: { $in: GOOD_HEALTH } })
  if (c.autoProvision && !c.manualApproval) {
    const r = await provisionFor(why, async () => { let n = Math.max(0, c.minEsims - await liveCount()); for (let i = 0; i < 7; i++) n = Math.max(n, await linesShort(new Date(Date.now() + i * DAY).toISOString().slice(0, 10), c, i >= c.leadDays ? extra : 0)); return Math.min(n, Math.max(0, c.maxEsims - await liveCount())) })
    if (r.ok) alert(`📈 Bought ${r.ok} eSIM(s) (${why}; ${healthy} healthy, ${total} total before).`); if (r.ok < r.need && await once(`scale:${today()}`)) alert(`📈 ${r.need - r.ok} more line(s) needed but not bought: ${r.error || `maximum ${c.maxEsims} reached`}.`)
  }
  else if (await once(`scale:${today()}`)) alert(`📈 Capacity: ${healthy} healthy eSIM(s), ${total} total (min ${c.minEsims}); ${need} more line(s) needed for the next 7 days${extra ? ` (incl. ${extra} SMS refused in the last 24 h)` : ''}. Provisioning needs approval: /bulkprovision, or /bulkset autoProvision true + /bulkset manualApproval false.`)
}

function init({ db, log = console.log, notifyAdmin }) {
  const own = db, url = process.env.BULK_ESIM_MONGO_URL
  S = { db: own, log, notifyAdmin }
  const ready = url ? MongoClient.connect(url).then(cl => { S.db = cl.db(process.env.BULK_ESIM_DB || 'bulkesim') }) : Promise.resolve()
  return ready.then(() => {
    C('bsMessages').createIndex({ status: 1, priority: -1, nextAt: 1 }).catch(() => {}); C('bsMessages').createIndex({ campaignId: 1, status: 1 }).catch(() => {}); C('bsMessages').createIndex({ cid: 1, createdAt: -1 }).catch(() => {})
    C('bsSessions').createIndex({ esimId: 1, to: 1, status: 1 }).catch(() => {}); C('bsSuppression').createIndex({ cid: 1, phone: 1 }, { unique: true }).catch(() => {}); C('bsNotify').createIndex({ brand: 1, sent: 1 }).catch(() => {}); C('bsEsims').createIndex({ msisdn: 1 }).catch(() => {}); C('bsEsimDaily').createIndex({ day: 1 }).catch(() => {}); C('bsTests').createIndex({ esimId: 1, type: 1, result: 1 }).catch(() => {})
    if (process.env.BULK_ESIM_WORKER === 'false') return
    if (!configured()) { log('[BulkESIM] needs SPENZA_BULK_API_KEY/SECRET and BULK_ESIM_MONGO_URL (shared DB) — engine idle'); return }
    const every = (ms, fn, name) => setInterval(async () => { try { if (await leader()) await fn() } catch (e) { log(`[BulkESIM] ${name}: ${e.message}`) } }, ms)
    setInterval(tick, 2000)
    every(2 * MIN, creditWatch, 'credit'); every(5 * MIN, syncInventory, 'sync'); every(MIN, async () => { await finishCampaigns(); await expireHolds(); await loopTimeouts() }, 'campaigns')
    every(10 * MIN, healthCheck, 'health'); every(30 * MIN, autoscale, 'autoscale')
    log(`[BulkESIM] engine ready (${P.dry() ? 'simulated provider' : 'live Spenza'}${url ? ', shared DB' : ''})`)
  })
}
const db = () => S.db

// Live (non-simulated) use needs the shared database so all bots use one pool and one Spenza rate limit.
const configured = () => P.configured() && (P.dry() || !!process.env.BULK_ESIM_MONGO_URL)
module.exports = { OPT, provisionFor, capacity, linesShort, lineCap, lineAge, forecast, provisionMany, verifyLine, autoReplace, unmetDemand, checkContent, hasLinkOrPhone, refundUnsent, expireStale, init, db, configured, cfg, DEFAULTS, cidOf, customer, usage, createCampaign, parseContacts, testSend, createBooking, confirmBooking, cancelBooking, availability, sendOne, onWebhook, registerWebhook, report, overview, setConfig, setCustomer, provisionOne, replaceEsim, healthCheck, syncInventory, creditWatch, pause, resume, state, addEsim, setEsim, tick, autoscale, finishCampaigns, segs, normPhone }
