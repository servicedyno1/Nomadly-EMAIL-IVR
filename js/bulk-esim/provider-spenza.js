'use strict'
// eSIM BulkSMS provider adapter: Spenza (separate account, SPENZA_BULK_API_KEY/SECRET). Another provider = another file with the same exports.
// Preview (WEB_CLOUDIVR_DRY_RUN=true): sends/purchases are simulated, reads return a fake fleet of the seeded eSIMs.
const axios = require('axios')
const crypto = require('crypto')
const API = 'https://api.spenza.com'
const dry = () => process.env.WEB_CLOUDIVR_DRY_RUN === 'true'
const configured = () => dry() || !!(process.env.SPENZA_BULK_API_KEY && process.env.SPENZA_BULK_API_SECRET)
let tok = { value: null, exp: 0 }

async function token() {
  if (tok.value && Date.now() < tok.exp - 60000) return tok.value
  const r = await axios.post(`${API}/api/v1.1/auth/token`, { key: process.env.SPENZA_BULK_API_KEY, secret: process.env.SPENZA_BULK_API_SECRET }, { timeout: 15000 })
  tok = { value: r.data.data.access_token, exp: new Date(r.data.data.expires_at).getTime() }
  return tok.value
}
// Errors carry { status, code, retryAfter, kind }: kind = rate | credit | temporary | permanent | auth.
async function call(method, path, data, headers = {}, retried = false) {
  try { return (await axios({ method, url: API + path, data, timeout: 30000, headers: { Authorization: `Bearer ${await token()}`, ...headers } })).data } catch (e) {
    if (e.response?.status === 401 && !retried) { tok = { value: null, exp: 0 }; return call(method, path, data, headers, true) }
    const st = e.response?.status, code = e.response?.data?.error?.code || null, msg = e.response?.data?.error?.message || e.message
    const err = new Error(msg); err.status = st; err.code = code; err.retryAfter = Number(e.response?.headers?.['retry-after']) || null
    err.kind = st === 429 ? 'rate' : /credit|balance|insufficient|payment/i.test(`${code} ${msg}`) || st === 402 ? 'credit' : !st || st >= 500 ? 'temporary' : st === 401 || st === 403 ? 'auth' : 'permanent'
    throw err
  }
}
const items = (r) => (Array.isArray(r?.data) ? r.data : r?.data?.items || [])

const sendSms = async ({ from, to, text, key }) => {
  if (dry()) { if (/^\+1555/.test(to)) { const e = new Error('Invalid destination'); e.kind = 'permanent'; e.status = 400; throw e } return { ok: true, simulated: true } }
  await call('post', '/api/v1.1/sms', { fromNumber: from, toNumber: to, text }, { 'Idempotency-Key': key })
  return { ok: true }
}
const listSims = async () => (dry() ? null : items(await call('get', '/api/v1.1/sims?page=1&pageSize=100')))
const getSim = async (iccid) => (dry() ? { iccid, status: String(process.env.BULK_ESIM_FAKE_SUSPENDED || '').split(',').includes(iccid) ? 'SUSPENDED' : 'ACTIVE' } : (await call('get', `/api/v1.1/sims/${encodeURIComponent(iccid)}`))?.data)
const serviceState = async (iccid) => (dry() ? { sms: true } : (await call('get', `/api/v1.1/sims/${encodeURIComponent(iccid)}/service-state`))?.data)
// Plan period. Spenza renews a line itself at endDate and bills the account balance (so renewals are part of the credit forecast).
const subscription = async (iccid) => (dry() ? { status: 'ACTIVE', endDate: new Date(Date.now() + (String(process.env.BULK_ESIM_FAKE_EXPIRED || '').split(',').includes(iccid) ? -1 : 30) * 86400000).toISOString() } : (await call('get', `/api/v1.1/sims/${encodeURIComponent(iccid)}/subscription`))?.data)
const credit = async () => {
  if (dry()) return Number(process.env.BULK_ESIM_FAKE_CREDIT ?? 50)
  const c = (await call('get', '/api/v1.1/credit-balance'))?.data?.creditBalance || []
  return Number((c.find(x => x.currency === 'USD') || c[0])?.amount || 0)
}
async function plan() {
  if (dry()) return { planId: 'SPENZA_001', simId: 'SIM_J', cost: 10 }
  const [p, s] = await Promise.all([call('get', '/api/v1.1/plans?page=1&pageSize=100'), call('get', '/api/v1.1/sim-products?page=1&pageSize=100')])
  const pl = items(p)[0], sim = items(s)[0]
  return pl ? { planId: pl.productId, simId: sim?.simId || null, cost: (pl.price || 0) + (sim?.price || 0) } : null
}
// New line: Spenza needs a device IMEI (the platform's own handset, env SPENZA_BULK_IMEI) and a user email.
async function provision({ key, zipcode }) {
  if (dry()) return { transactionId: `preview-${key}`, simulated: true, phoneNumber: `+1201555${String(Math.floor(1000 + Math.random() * 8999))}`, iccid: `89${crypto.randomBytes(8).toString('hex').replace(/\D/g, '').padEnd(17, '7').slice(0, 17)}` }
  const p = await plan(), imei = String(process.env.SPENZA_BULK_IMEI || '').replace(/\D/g, '')
  if (!p || imei.length !== 15) { const e = new Error(!p ? 'No plan on the BulkSMS Spenza account' : 'SPENZA_BULK_IMEI is not set'); e.kind = 'permanent'; throw e }
  const email = process.env.SPENZA_BULK_EMAIL || 'bulksms@cloudivr.net'
  const r = await call('post', '/api/v1.1/esim', { imei, simId: p.simId, planId: p.planId, activateNow: true, email, user: { name: 'BulkSMS pool', email, ...(zipcode ? { zipcode } : {}) }, ...(zipcode ? { zipcode } : {}) }, { 'Idempotency-Key': key })
  return { transactionId: r?.data?.transactionId || r?.transactionId || null }
}
const replaceNumber = async (iccid) => (dry() ? { ok: true, simulated: true } : call('post', `/api/v1.1/sims/${encodeURIComponent(iccid)}/renew-number`, {}))
const setSms = async (iccid, on) => (dry() ? { ok: true } : call('patch', `/api/v1.1/sims/${encodeURIComponent(iccid)}/service-state`, { sms: !!on }))
async function registerWebhook(url) {
  if (dry()) return { url, signingSecret: 'whsec_preview', simulated: true }
  const r = await call('post', '/api/v1.1/webhooks', { operator: 'SpenzaJ', network: 'SpenzaJ', eventType: 'sms', webhookUrls: { messageUrl: url }, authentication: { type: 'none' }, update: true })
  return { url, id: r?.data?.id || null, signingSecret: r?.data?.signingSecret || null }
}
function verify(raw, sig, ts, secret) {
  if (!secret || !sig || !ts || Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false
  const exp = crypto.createHmac('sha256', secret).update(`${ts}.${raw}`).digest('hex')
  const got = String(sig).split(',').find(p => p.startsWith('v1='))?.slice(3) || ''
  return got.length === exp.length && crypto.timingSafeEqual(Buffer.from(exp), Buffer.from(got))
}
const norm = (n) => { const x = String(n || '').replace(/[^\d+]/g, ''); return x.startsWith('+') ? x : x.length === 10 ? '+1' + x : x ? '+' + x : '' }
// Inbound SMS → { from, to, text, providerId, direction }.
function parseInbound(body) {
  const b = body?.data || body || {}, first = (v) => (Array.isArray(v) ? v[0] : v)
  return { event: b.eventType || body?.eventType || null, from: norm(b.From || b.from || b.fromNumber), to: norm(b.Owner || first(b.To) || b.to || b.toNumber || b.mdn), text: String(b.Message_Body || b.text || b.message || b.body || '').slice(0, 2000), providerId: b.Message_ID || b.id || null, direction: String(b.Direction || 'inbound').toLowerCase() }
}

module.exports = { name: 'spenza', dry, configured, sendSms, listSims, getSim, serviceState, subscription, credit, plan, provision, replaceNumber, setSms, registerWebhook, verify, parseInbound, norm }
