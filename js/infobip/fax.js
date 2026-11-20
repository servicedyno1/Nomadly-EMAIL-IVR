'use strict'
// Fax numbers on Infobip (FAX_PROVIDER=infobip). Receive: the Infobip number's call is connected over our SIP trunk to
// `fax.<number>` → Asterisk ReceiveFAX → POST /fax/asterisk-hook. Send: Asterisk (ARI) dials via Bird showing the fax
// number, fetches the PDF from /fax/ib-file, SendFAX → hook reports delivered/failed. Bird links the number automatically.
const crypto = require('crypto')
const axios = require('axios')
const https = require('https')
const ib = require('./index')
const { INSTANT } = require('./countries')

const log = (...a) => console.log('[IbFax]', ...a)
const enabled = () => String(process.env.FAX_PROVIDER || '').toLowerCase() === 'infobip' && ib.enabled() && !!ib.sipTrunk() && !!process.env.ASTERISK_ARI_URL
const e164 = (n) => `+${String(n || '').replace(/\D/g, '')}`
const digits = (n) => String(n || '').replace(/\D/g, '')
const key = () => process.env.SIP_SERVER_SECRET || ''
const sign = (s) => crypto.createHmac('sha256', key()).update(`fax:${s}`).digest('hex').slice(0, 32)
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const call = async (fn) => { for (let i = 0; ; i++) { try { return await fn() } catch (e) { if (e.response?.status !== 429 || i >= 4) throw e; await sleep(1500 * (i + 1)) } } }

const COUNTRIES = Object.entries(INSTANT).map(([code, name]) => ({ code, name, areaCodes: ['US', 'CA'].includes(code), types: [{ type: 'local', label: 'Local', paperwork: 'none' }] }))
  .sort((a, b) => (a.code === 'US' ? -1 : b.code === 'US' ? 1 : a.name.localeCompare(b.name)))

const found = new Map() // e164 → Infobip available entry
async function searchFax(country, areaCode, limit = 12) {
  const cc = String(country || 'US').toUpperCase()
  if (!INSTANT[cc]) return []
  const list = (await call(() => ib.http().get('/numbers/1/numbers/available', { params: { country: cc, capabilities: 'VOICE', limit: 50 } }))).data?.numbers || []
  const ac = /^\d{3}$/.test(String(areaCode || '')) ? String(areaCode) : null
  const rows = list.filter(n => !n.additionalSetupRequired).map(n => ({ n, num: e164(n.number) }))
  rows.sort((a, b) => (ac ? Number(b.num.slice(2, 5) === ac) - Number(a.num.slice(2, 5) === ac) : 0))
  return rows.slice(0, limit).map(({ n, num }) => { found.set(num, n); return { phoneNumber: num, assigned: false, nearby: !!ac && num.slice(2, 5) !== ac, region: n.city || n.region || INSTANT[cc] } })
}

async function orderFax(phoneNumber) {
  const n = found.get(phoneNumber) || { number: digits(phoneNumber) }
  const got = (await call(() => ib.http().post('/numbers/1/numbers', n.numberKey ? { numberKey: n.numberKey } : { number: n.number }))).data
  const k = got.numberKey || n.numberKey
  await call(() => ib.http().post(`/numbers/2/numbers/${k}/voice`, { action: { type: 'FORWARD_TO_SUBSCRIPTION', callsConfigurationId: ib.configId() } }))
  found.delete(phoneNumber)
  log(`bought fax number ${phoneNumber}`)
  return { id: `ibfax:${k}`, phoneNumber }
}
async function releaseFax(phoneNumber) {
  const list = (await call(() => ib.http().get('/numbers/1/numbers', { params: { limit: 1000 } }))).data?.numbers || []
  const hit = list.find(n => e164(n.number) === e164(phoneNumber))
  if (hit) await call(() => ib.http().delete(`/numbers/1/numbers/${hit.numberKey}`))
  return !!hit
}

// Inbound: a call to a fax number goes straight to the SIP server's fax receiver.
let _db = null
const isFaxNumber = async (to) => !!_db && !!(await _db.collection('faxNumbers').findOne({ _id: e164(to), provider: 'infobip_fax', status: { $ne: 'released' } }))
async function inbound(id, from, to) {
  await ib.voice.answerCall(id).catch(() => {})
  const r = await ib.connectSip(id, `fax.${digits(to)}`, from)
  log(`fax call ${from} → ${to}: ${r ? 'to fax receiver' : 'connect failed'}`)
  return r
}

// Outbound via ARI: Bird leg, then the fax-out dialplan fetches the PDF and sends it.
const ari = () => axios.create({ baseURL: `${String(process.env.ASTERISK_ARI_URL).replace(/\/+$/, '')}/ari`, auth: { username: process.env.ASTERISK_ARI_USER, password: process.env.ASTERISK_ARI_PASSWORD }, timeout: 15000, httpsAgent: new https.Agent({ rejectUnauthorized: false }) })
// Fax over a voice route fails training now and then, so each fax gets up to MAX_TRIES calls (ECM alternates).
const MAX_TRIES = Number(process.env.FAX_SEND_TRIES || 4)
const RETRY_MS = 90000
const jobs = () => _db?.collection('ibFaxJobs')
async function dial(job) {
  const url = `${String(process.env.SELF_URL).replace(/\/+$/, '')}/infobip/fax-file/${encodeURIComponent(job.fileId)}?k=${sign(job.fileId)}`
  await ari().post('/channels', { endpoint: `PJSIP/${digits(job.to)}@bird`, context: 'fax-out', extension: 's', priority: 1, callerId: `<${digits(job.from)}>`, timeout: 60, variables: { FAXURL: url, FAXID: job._id, FAXECM: job.attempt % 2 ? 'no' : 'yes' } })
}
async function sendFax({ from, to, fileId }) {
  const job = { _id: `ibf_${crypto.randomUUID()}`, from, to, fileId, attempt: 1, createdAt: new Date() }
  await jobs()?.insertOne(job)
  await dial(job)
  log(`sending ${job._id}: ${from} → ${to}`)
  return job._id
}
// true = another try was scheduled, so the failure is not final yet.
async function retry(faxId, error) {
  const job = await jobs()?.findOneAndUpdate({ _id: faxId, attempt: { $lt: MAX_TRIES } }, { $inc: { attempt: 1 }, $set: { lastError: error || null } }, { returnDocument: 'after' })
  const j = job?.value !== undefined ? job.value : job
  if (!j) return false
  const retryAt = new Date(Date.now() + RETRY_MS)
  await jobs().updateOne({ _id: faxId }, { $set: { retryAt } })
  log(`${faxId} failed (${error}) — try ${j.attempt}/${MAX_TRIES} in ${RETRY_MS / 1000}s`)
  schedule({ ...j, retryAt })
  return true
}
// The retry time is saved, so a restart (or the other deploy slot) picks it up; only one process wins each redial.
function schedule(j) {
  setTimeout(async () => {
    const won = await jobs().updateOne({ _id: j._id, retryAt: j.retryAt }, { $unset: { retryAt: 1 } }).catch(() => null)
    if (!won?.modifiedCount) return
    dial(j).catch(e => { log(`${j._id} redial failed: ${e.message}`); require('../fax-service').handleEvent({ event_type: 'fax.failed', payload: { fax_id: j._id, page_count: 0, failure_reason: j.lastError } }).catch(() => {}) })
  }, Math.max(0, new Date(j.retryAt) - Date.now()))
}
async function resumeRetries() {
  for (const j of await jobs().find({ retryAt: { $exists: true } }).toArray()) schedule(j)
}

function routes(app, express) {
  app.get('/infobip/fax-file/:id', async (req, res) => {
    if (req.query.k !== sign(req.params.id)) return res.status(403).end()
    try { res.type('application/pdf').send(await require('../fax-service').readFile(req.params.id)) } catch (e) { res.status(404).end() }
  })
  // From the SIP server: ?dir=in|out&key=…&to=&from=&status=&pages=&id=&error=, body = PDF (inbound).
  app.post('/fax/asterisk-hook', express.raw({ type: () => true, limit: '40mb' }), async (req, res) => {
    const q = req.query
    if (!key() || q.key !== key()) return res.status(403).end()
    res.json({ ok: true })
    const fs = require('../fax-service'), ok = String(q.status).toUpperCase() === 'SUCCESS', pages = Number(q.pages) || 0
    try {
      if (q.dir === 'in') {
        if (!ok || !req.body?.length) return log(`inbound fax to ${q.to} failed: ${q.status} ${q.error || ''}`)
        await fs.handleEvent({ event_type: 'fax.received', payload: { fax_id: `ibf_in_${q.id}`, from: digits(q.from) ? e164(q.from) : 'Unknown', to: e164(q.to), pdf: Buffer.from(req.body), page_count: pages } })
      } else {
        if (!ok && await retry(q.id, q.error || q.status)) return
        await fs.handleEvent({ event_type: ok ? 'fax.delivered' : 'fax.failed', payload: { fax_id: q.id, page_count: pages, failure_reason: ok ? undefined : (q.error || q.status) } })
      }
    } catch (e) { log(`hook ${q.dir} ${q.id}: ${e.message}`) }
  })
}
const init = (db) => { _db = db; resumeRetries().catch(e => log(`resume retries: ${e.message}`)) }

module.exports = { enabled, COUNTRIES, searchFax, orderFax, releaseFax, isFaxNumber, inbound, sendFax, routes, init }
