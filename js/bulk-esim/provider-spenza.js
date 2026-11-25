'use strict'
// eSIM BulkSMS provider adapter: Spenza, one or more accounts. Account 1 = SPENZA_BULK_API_KEY/SECRET (+ SPENZA_BULK_IMEI/EMAIL),
// account n = SPENZA_BULK_API_KEY_n/SECRET_n (+ _IMEI_n/_EMAIL_n). Each account has its own token, SMS rate window and credit;
// every function takes the account id (`spenza1`, `spenza2`, …) and defaults to account 1. Another provider = another file, same exports.
// Preview (WEB_CLOUDIVR_DRY_RUN=true): sends/purchases are simulated; BULK_ESIM_FAKE_ACCOUNTS=n simulates n accounts.
const axios = require('axios')
const crypto = require('crypto')
const API = 'https://api.spenza.com'
const dry = () => process.env.WEB_CLOUDIVR_DRY_RUN === 'true'
const MAX_ACCOUNTS = 9
const env = (name, n) => process.env[`${name}${n === 1 ? '' : `_${n}`}`]
// Pool user email on Spenza: a made-up Gmail derived from the account key (Spenza emails are global and unverified; never our domain).
const poolEmail = (key) => { const h = require('crypto').createHash('sha256').update(`pool:${key}`).digest('hex'); return `textpool.${h.slice(0, 10)}@gmail.com` }
// Accounts present in the environment, in order. In preview without keys: one (or BULK_ESIM_FAKE_ACCOUNTS) simulated account(s).
function accounts() {
  const out = []
  for (let n = 1; n <= MAX_ACCOUNTS; n++) { const key = env('SPENZA_BULK_API_KEY', n), secret = env('SPENZA_BULK_API_SECRET', n); if (key && secret) out.push({ id: `spenza${n}`, n, key, secret, imei: env('SPENZA_BULK_IMEI', n) || process.env.SPENZA_BULK_IMEI || '', email: env('SPENZA_BULK_EMAIL', n) || poolEmail(key) }) }
  if (dry()) { const want = Math.max(out.length, Number(process.env.BULK_ESIM_FAKE_ACCOUNTS || 1)); for (let n = out.length + 1; n <= want; n++) out.push({ id: `spenza${n}`, n, key: `preview-key-${n}`, secret: 'preview', imei: '', email: poolEmail(`preview-key-${n}`) }) }
  return out
}
const configured = () => dry() || accounts().length > 0
// Per-account runtime state: token cache + last X-RateLimit-* headers seen on the SMS endpoint (Spenza: 30/60 s per account by default).
const ST = {}
const stateOf = (id) => (ST[id] ||= { tok: { value: null, exp: 0 }, rate: { limit: null, remaining: null, resetAt: null, at: 0 } })
const acct = (id) => { const list = accounts(); const a = list.find(x => x.id === id) || list[0]; if (!a) { const e = new Error('No Spenza BulkSMS account configured'); e.kind = 'auth'; throw e } return a }
const nOf = (id) => Number(String(id || 'spenza1').replace(/\D/g, '')) || 1
const fake = (name, id) => env(name, nOf(id)) ?? (nOf(id) === 1 ? undefined : process.env[name])

async function token(a) {
  const s = stateOf(a.id)
  if (s.tok.value && Date.now() < s.tok.exp - 60000) return s.tok.value
  const r = await axios.post(`${API}/api/v1.1/auth/token`, { key: a.key, secret: a.secret }, { timeout: 15000 })
  s.tok = { value: r.data.data.access_token, exp: new Date(r.data.data.expires_at).getTime() }
  return s.tok.value
}
const smsRate = (id) => { const f = dry() && fake('BULK_ESIM_FAKE_RATE', id); return f ? (([l, r, sec]) => ({ limit: +l, remaining: +r, resetAt: Date.now() + (+sec) * 1000, at: Date.now() }))(f.split(',')) : stateOf(acct(id).id).rate }
const noteRate = (rate, h = {}) => { if (h['x-ratelimit-limit'] == null) return; const reset = Number(h['x-ratelimit-reset']); rate.limit = Number(h['x-ratelimit-limit']); rate.remaining = Number(h['x-ratelimit-remaining']); rate.resetAt = reset ? (reset > 1e9 ? (reset > 1e12 ? reset : reset * 1000) : Date.now() + reset * 1000) : null; rate.at = Date.now() }
// Errors carry { status, code, retryAfter, kind, account }: kind = rate | credit | temporary | permanent | auth.
async function call(method, path, data, headers = {}, id, retried = false) {
  const a = acct(id), s = stateOf(a.id), sms = path.startsWith('/api/v1.1/sms')
  try { const r = await axios({ method, url: API + path, data, timeout: 30000, headers: { Authorization: `Bearer ${await token(a)}`, ...headers } }); if (sms) noteRate(s.rate, r.headers); return r.data } catch (e) {
    if (e.response?.status === 401 && !retried) { s.tok = { value: null, exp: 0 }; return call(method, path, data, headers, id, true) }
    if (e.response?.status === 429 && sms) { s.rate.remaining = 0; s.rate.resetAt = Date.now() + (Number(e.response.headers?.['retry-after']) || 30) * 1000; s.rate.at = Date.now() }
    const st = e.response?.status, code = e.response?.data?.error?.code || null, msg = e.response?.data?.error?.message || e.message
    const err = new Error(msg); err.status = st; err.code = code; err.retryAfter = Number(e.response?.headers?.['retry-after']) || null; err.account = a.id
    err.kind = st === 429 ? 'rate' : /credit|balance|insufficient|payment/i.test(`${code} ${msg}`) || st === 402 ? 'credit' : !st || st >= 500 ? 'temporary' : st === 401 || st === 403 ? 'auth' : 'permanent'
    throw err
  }
}
const items = (r) => (Array.isArray(r?.data) ? r.data : r?.data?.items || [])

const sendSms = async ({ from, to, text, key, account }) => {
  if (dry()) { if (/^\+1555/.test(to)) { const e = new Error('Invalid destination'); e.kind = 'permanent'; e.status = 400; throw e } return { ok: true, simulated: true } }
  const r = await call('post', '/api/v1.1/sms', { fromNumber: from, toNumber: to, text }, { 'Idempotency-Key': key }, account)
  const d = r?.data || r || {}
  return { ok: true, providerId: d.messageId || d.id || d.Message_ID || d.sid || null, resp: JSON.stringify(r || null).slice(0, 600) }
}
const listSims = async (account) => (dry() ? (process.env.BULK_ESIM_FAKE_SYNC_FAIL ? Promise.reject(Object.assign(new Error('Spenza unavailable (simulated 503)'), { kind: 'temporary', status: 503 })) : process.env.BULK_ESIM_FAKE_MDN ? Object.entries(JSON.parse(process.env.BULK_ESIM_FAKE_MDN)).map(([iccid, phoneNumber]) => ({ iccid, phoneNumber, status: 'ACTIVE', device: { imei: '350000000000001' } })) : null) : items(await call('get', '/api/v1.1/sims?page=1&pageSize=100', undefined, {}, account)))
const brokenFake = (iccid) => { if (String(process.env.BULK_ESIM_FAKE_BROKEN || '').split(',').includes(iccid)) { const e = new Error('SIM not found (simulated)'); e.kind = 'permanent'; throw e } }
const getSim = async (iccid, account) => (dry() ? (brokenFake(iccid), { iccid, status: String(process.env.BULK_ESIM_FAKE_SUSPENDED || '').split(',').includes(iccid) ? 'SUSPENDED' : 'ACTIVE', device: String(process.env.BULK_ESIM_FAKE_NODEVICE || '').split(',').includes(iccid) ? null : { imei: '350000000000001' }, mdn: JSON.parse(process.env.BULK_ESIM_FAKE_MDN || '{}')[iccid] }) : (await call('get', `/api/v1.1/sims/${encodeURIComponent(iccid)}`, undefined, {}, account))?.data)
const serviceState = async (iccid, account) => (dry() ? { sms: true } : (await call('get', `/api/v1.1/sims/${encodeURIComponent(iccid)}/service-state`, undefined, {}, account))?.data)
// Plan period. Spenza renews a line itself at endDate and bills the account balance (so renewals are part of the credit forecast).
const subscription = async (iccid, account) => (dry() ? { status: String(process.env.BULK_ESIM_FAKE_PENDING || '').split(',').includes(iccid) ? 'PENDING' : 'ACTIVE', endDate: new Date(Date.now() + (String(process.env.BULK_ESIM_FAKE_EXPIRED || '').split(',').includes(iccid) ? -1 : 30) * 86400000).toISOString() } : (await call('get', `/api/v1.1/sims/${encodeURIComponent(iccid)}/subscription`, undefined, {}, account))?.data)
const credit = async (account) => {
  if (dry()) { const v = fake('BULK_ESIM_FAKE_CREDIT', account); if (v === 'fail') throw Object.assign(new Error('Spenza unavailable (simulated 503)'), { kind: 'temporary', status: 503 }); return Number(v ?? 50) }
  const c = (await call('get', '/api/v1.1/credit-balance', undefined, {}, account))?.data?.creditBalance || []
  return Number((c.find(x => x.currency === 'USD') || c[0])?.amount || 0)
}
async function plan(account) {
  if (dry()) return { planId: 'SPENZA_001', simId: 'SIM_J', cost: 10 }
  const [p, s] = await Promise.all([call('get', '/api/v1.1/plans?page=1&pageSize=100', undefined, {}, account), call('get', '/api/v1.1/sim-products?page=1&pageSize=100', undefined, {}, account)])
  // USA line plan only (accounts can also list travel-data plans/SIMs, which can't text): SPENZA_001 + the SpenzaJ (T-Mobile) eSIM
  const want = process.env.SPENZA_BULK_PLAN_ID || 'SPENZA_001', P = items(p), Sx = items(s)
  const pl = P.find(x => x.productId === want) || P.find(x => !/travel/i.test(`${x.productId} ${x.description || ''}`))
  const sim = Sx.find(x => x.simId === (process.env.SPENZA_BULK_SIM_ID || 'SIM_J')) || Sx.find(x => x.isEsim && /spenzaj/i.test(x.operator || '')) || Sx.find(x => !/^esim_\d+GB/i.test(x.simId || ''))
  return pl ? { planId: pl.productId, simId: sim?.simId || null, cost: (pl.price || 0) + (sim?.price || 0) } : null
}
// New line: Spenza needs a device IMEI (the platform's own handset, SPENZA_BULK_IMEI[_n]) and a user email.
let fakeFails = 0
const resetFakeFails = () => { fakeFails = 0 }
async function provision({ key, zipcode, account }) {
  if (dry() && process.env.BULK_ESIM_FAKE_PROVISION_FAIL) { const [kind, n] = process.env.BULK_ESIM_FAKE_PROVISION_FAIL.split(':'); fakeFails++; if (!(Number(n) > 0) || fakeFails <= Number(n)) throw Object.assign(new Error(`Spenza ${kind} error (simulated)`), { kind, status: kind === 'credit' ? 402 : kind === 'temporary' ? 503 : 422 }) }
  if (dry()) return { transactionId: `preview-${key}`, simulated: true, phoneNumber: `+1201555${String(Math.floor(1000 + Math.random() * 8999))}`, iccid: `89${crypto.randomBytes(8).toString('hex').replace(/\D/g, '').padEnd(17, '7').slice(0, 17)}` }
  const a = acct(account), p = await plan(a.id), imei = String(a.imei).replace(/\D/g, '')
  if (!p || imei.length !== 15) { const e = new Error(!p ? `No plan on the BulkSMS Spenza account ${a.id}` : `SPENZA_BULK_IMEI${a.n === 1 ? '' : `_${a.n}`} is not set`); e.kind = 'permanent'; throw e }
  const r = await call('post', '/api/v1.1/esim', { imei, simId: p.simId, planId: p.planId, activateNow: true, email: a.email, user: { name: 'BulkSMS pool', email: a.email, ...(zipcode ? { zipcode } : {}) }, ...(zipcode ? { zipcode } : {}) }, { 'Idempotency-Key': key }, a.id)
  return { transactionId: r?.data?.transactionId || r?.transactionId || null }
}
// Ends the plan at the current period end (Spenza bills the balance for every active line each month).
const cancelSubscription = async (iccid, account) => (dry() ? { ok: true, simulated: true } : call('post', `/api/v1.1/subscriptions/${encodeURIComponent(iccid)}/cancel`, {}, {}, account))
const replaceNumber = async (iccid, account) => (dry() ? (String(process.env.BULK_ESIM_FAKE_RENEW_FAIL || '').split(',').includes(iccid) ? Promise.reject(Object.assign(new Error('Number change not supported by the operator (simulated 501)'), { kind: 'permanent' })) : { ok: true, simulated: true }) : call('post', `/api/v1.1/sims/${encodeURIComponent(iccid)}/renew-number`, {}, {}, account))
const setSms = async (iccid, on, account) => (dry() ? { ok: true } : call('patch', `/api/v1.1/sims/${encodeURIComponent(iccid)}/service-state`, { sms: !!on }, {}, account))
async function registerWebhook(url, account) {
  if (dry()) return { url, statusUrl: url.replace(/\/webhook$/, '/webhook-status'), signingSecret: 'whsec_preview', simulated: true }
  const body = { operator: 'SpenzaJ', network: 'SpenzaJ', eventType: 'sms', webhookUrls: { messageUrl: url, callbackMessageUrl: url.replace(/\/webhook$/, '/webhook-status') }, authentication: { type: 'none' } }
  let r = await call('post', '/api/v1.1/webhooks', { ...body, update: true }, {}, account)
  // An update can come back without a signing secret; without it every inbound text fails verification → recreate to get one.
  if (!r?.data?.signingSecret && r?.data?.id) { await call('delete', `/api/v1.1/webhooks/${r.data.id}`, null, {}, account); r = await call('post', '/api/v1.1/webhooks', body, {}, account) }
  if (!r?.data?.signingSecret) throw Object.assign(new Error('Spenza returned no webhook signing secret'), { kind: 'temporary' })
  return { url, statusUrl: url.replace(/\/webhook$/, '/webhook-status'), id: r?.data?.id || null, signingSecret: r?.data?.signingSecret || null }
}
function verify(raw, sig, ts, secret) {
  if (!secret || !sig || !ts || Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false
  const exp = crypto.createHmac('sha256', secret).update(`${ts}.${raw}`).digest('hex')
  const got = String(sig).split(',').find(p => p.startsWith('v1='))?.slice(3) || ''
  return got.length === exp.length && crypto.timingSafeEqual(Buffer.from(exp), Buffer.from(got))
}
const norm = (n) => { const x = String(n || '').replace(/[^\d+]/g, ''); return x.startsWith('+') ? x : x.length === 10 ? '+1' + x : x ? '+' + x : '' }
// Delivery-status callback → { providerId, state: delivered|failed|null, raw status, to, from, error }. Schema unpublished: read every common name.
function parseStatus(body) {
  const b = body?.data || body || {}, first = (v) => (Array.isArray(v) ? v[0] : v)
  const raw = String(b.status || b.Status || b.deliveryStatus || b.Delivery_Status || b.messageStatus || b.Message_Status || b.state || b.event || b.eventType || body?.eventType || '').toLowerCase()
  const state = /undeliver|fail|reject|error|expire|blocked|invalid/.test(raw) ? 'failed' : /deliver/.test(raw) ? 'delivered' : null
  return { providerId: b.messageId || b.Message_ID || b.id || b.sid || b.messageSid || null, state, raw, to: norm(first(b.To) || b.to || b.toNumber || b.destination), from: norm(b.From || b.from || b.fromNumber || b.Owner || b.mdn), error: b.errorMessage || b.error || b.reason || b.Error_Message || null, test: (b.eventType || body?.eventType) === 'webhook.test' }
}
// Inbound SMS → { from, to, text, providerId, direction }.
function parseInbound(body) {
  const b = body?.data || body || {}, first = (v) => (Array.isArray(v) ? v[0] : v)
  return { event: b.eventType || body?.eventType || null, from: norm(b.From || b.from || b.fromNumber), to: norm(b.Owner || first(b.To) || b.to || b.toNumber || b.mdn), text: String(b.Message_Body || b.text || b.message || b.body || '').slice(0, 2000), providerId: b.Message_ID || b.id || null, direction: String(b.Direction || 'inbound').toLowerCase() }
}

module.exports = { parseStatus, resetFakeFails, name: 'spenza', MAX_ACCOUNTS, dry, configured, accounts, smsRate, sendSms, listSims, getSim, serviceState, subscription, cancelSubscription, credit, plan, provision, replaceNumber, setSms, registerWebhook, verify, parseInbound, norm }
