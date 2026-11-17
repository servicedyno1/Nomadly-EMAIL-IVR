'use strict'
// Live data for keypad-menu keys: the owner's own database (read-only lookups), webhook replies, and payment-provider links.
const crypto = require('crypto'), dns = require('dns').promises, axios = require('axios')
const safeUrl = require('./safe-url')

const DB_KINDS = ['postgres', 'mongodb'], PAY_KINDS = ['stripe', 'paypal', 'square', 'razorpay', 'mollie']
let _col = null, _pay = null, _log = () => {}, _notify = null, allowPrivate = false
function init({ db, log, notify }) { _col = db.collection('webIvrConnections'); _pay = db.collection('webIvrPayments'); if (log) _log = log; _notify = notify || null }
function _allowPrivateForTests(on = true) { allowPrivate = !!on; safeUrl._allowPrivateForTests(on) }
class LiveError extends Error { constructor(message) { super(message); this.friendly = true } }

// ── secrets at rest ──
const key = () => {
  const s = process.env.WEB_SESSION_SECRET || process.env.SESSION_SECRET
  if (!s) throw new Error('session secret missing')
  return crypto.createHash('sha256').update(`ivrConnections:${s}`).digest()
}
function seal(obj) {
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', key(), iv)
  const enc = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()])
  return `v1:${iv.toString('base64')}:${c.getAuthTag().toString('base64')}:${enc.toString('base64')}`
}
function unseal(s) {
  const [, iv, tag, enc] = String(s || '').split(':')
  const d = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64'))
  d.setAuthTag(Buffer.from(tag, 'base64'))
  return JSON.parse(Buffer.concat([d.update(Buffer.from(enc, 'base64')), d.final()]).toString('utf8'))
}

// ── owner databases (read-only, public hosts only) ──
async function assertPublicHost(host) {
  if (allowPrivate) return
  if (safeUrl.isBlockedName(host) && !require('net').isIP(host)) throw new LiveError('That database address is inside a private network. Use the public address of your database.')
  const list = await dns.lookup(host, { all: true }).catch(() => [])
  if (!list.length) throw new LiveError('We could not find that database address. Check the host name.')
  if (list.some(a => safeUrl.isBlockedIp(a.address))) throw new LiveError('That database address is inside a private network. Use the public address of your database.')
  return list[0].address
}
const scalar = (v) => (v === null || v === undefined ? '' : v instanceof Date ? v.toISOString().slice(0, 16).replace('T', ' ') : typeof v === 'object' ? (v._bsontype === 'ObjectId' || v._bsontype === 'Decimal128' || typeof v.toHexString === 'function' ? String(v) : null) : String(v))
const flat = (row) => Object.fromEntries(Object.entries(row || {}).map(([k, v]) => [k, scalar(v)]).filter(([, v]) => v !== null).slice(0, 60).map(([k, v]) => [k, String(v).slice(0, 300)]))
const friendlyDb = (e) => new LiveError(e.friendly ? e.message : /password|authentication|auth failed/i.test(e.message) ? 'The database refused the user name or password.' : /timeout|ETIMEDOUT|ECONNREFUSED|ENOTFOUND|server selection/i.test(`${e.code} ${e.message}`) ? 'We could not reach the database. Check the address and that it accepts connections from the internet.' : `The database answered with an error: ${String(e.message).slice(0, 140)}`)

async function withPg(url, fn) {
  const u = new URL(url)
  const ip = await assertPublicHost(u.hostname)
  const { Client } = require('pg')
  const base = { host: ip || u.hostname, port: Number(u.port) || 5432, user: decodeURIComponent(u.username), password: decodeURIComponent(u.password), database: decodeURIComponent(u.pathname.slice(1)) || 'postgres', connectionTimeoutMillis: 6000, statement_timeout: 5000, query_timeout: 7000, options: '-c default_transaction_read_only=on' }
  const tryOne = async (ssl) => {
    const c = new Client({ ...base, ssl: ssl ? { rejectUnauthorized: false, servername: u.hostname } : false })
    c.on('error', () => {})
    await c.connect()
    try { return await fn(c) } finally { c.end().catch(() => {}) }
  }
  if (u.searchParams.get('sslmode') === 'disable') return tryOne(false)
  try { return await tryOne(true) } catch (e) { if (/does not support SSL/i.test(e.message)) return tryOne(false); throw e }
}
const qi = (s) => `"${String(s).replace(/"/g, '""')}"`
const pgName = (t) => { const [a, b] = String(t).split('.'); return b ? [a, b] : ['public', a] }

async function withMongo(url, fn) {
  const m = String(url).match(/^mongodb(\+srv)?:\/\/(?:[^@/]*@)?([^/?]+)(?:\/([^?]*))?/i)
  if (!m) throw new LiveError('That does not look like a MongoDB address (it starts with mongodb:// or mongodb+srv://).')
  const dbName = decodeURIComponent(m[3] || '')
  if (!dbName) throw new LiveError('Add the database name at the end of the address, e.g. …mongodb.net/shop')
  const hosts = m[1] ? (await dns.resolveSrv(`_mongodb._tcp.${m[2]}`).catch(() => [])).map(r => r.name) : m[2].split(',').map(h => h.replace(/:\d+$/, ''))
  if (!hosts.length) throw new LiveError('We could not find that database address. Check the host name.')
  for (const h of hosts) await assertPublicHost(h)
  const { MongoClient } = require('mongodb')
  const c = new MongoClient(url, { serverSelectionTimeoutMS: 6000, connectTimeoutMS: 6000, socketTimeoutMS: 8000, maxPoolSize: 1, ...(allowPrivate ? {} : { lookup: safeUrl.safeLookup }) })
  try { await c.connect(); return await fn(c.db(dbName)) } finally { c.close().catch(() => {}) }
}

const dbApi = {
  postgres: {
    tables: (s) => withPg(s.url, async (c) => (await c.query(`select table_schema s, table_name t from information_schema.tables where table_schema not in ('pg_catalog','information_schema') order by 1,2 limit 300`)).rows.map(r => (r.s === 'public' ? r.t : `${r.s}.${r.t}`))),
    columns: (s, table) => withPg(s.url, async (c) => { const [sc, t] = pgName(table); return (await c.query('select column_name from information_schema.columns where table_schema=$1 and table_name=$2 order by ordinal_position limit 100', [sc, t])).rows.map(r => r.column_name) }),
    find: (s, { table, match, values }) => withPg(s.url, async (c) => {
      const [sc, t] = pgName(table)
      const cols = (await c.query('select column_name from information_schema.columns where table_schema=$1 and table_name=$2', [sc, t])).rows.map(r => r.column_name)
      if (!cols.includes(match)) throw new LiveError('That table or column no longer exists in your database.')
      const r = await c.query(`select * from ${qi(sc)}.${qi(t)} where ${qi(match)}::text = any($1::text[]) limit 1`, [values])
      return r.rows[0] || null
    }),
  },
  mongodb: {
    tables: (s) => withMongo(s.url, async (db) => (await db.listCollections({}, { nameOnly: true }).toArray()).map(c => c.name).filter(n => !n.startsWith('system.')).sort().slice(0, 300)),
    columns: (s, table) => withMongo(s.url, async (db) => { const docs = await db.collection(String(table)).find({}, { maxTimeMS: 5000 }).limit(25).toArray(); return [...new Set(docs.flatMap(d => Object.keys(flat(d))))].slice(0, 100) }),
    find: (s, { table, match, values }) => withMongo(s.url, async (db) => {
      if (/^\$|\./.test(String(match)) && !/^[\w.]+$/.test(String(match))) throw new LiveError('That column name cannot be used.')
      const nums = values.filter(v => /^\d{1,15}$/.test(v)).map(Number)
      return db.collection(String(table)).findOne({ [String(match)]: { $in: [...values, ...nums] } }, { maxTimeMS: 5000 })
    }),
  },
}

// ── payment providers (the owner's own account; hosted checkout only, no card data here) ──
const ZERO_DEC = ['BIF', 'CLP', 'DJF', 'GNF', 'JPY', 'KMF', 'KRW', 'MGA', 'PYG', 'RWF', 'UGX', 'VND', 'VUV', 'XAF', 'XOF', 'XPF']
const minor = (amount, cur) => Math.round(Number(amount) * (ZERO_DEC.includes(cur) ? 1 : 100))
const dec = (amount, cur) => Number(amount).toFixed(ZERO_DEC.includes(cur) ? 0 : 2)
const http = (cfg) => axios.request({ timeout: 12000, ...cfg })
const ppBase = (s) => (s.mode === 'test' ? 'https://api-m.sandbox.paypal.com' : 'https://api-m.paypal.com')
const sqBase = (s) => (s.mode === 'test' ? 'https://connect.squareupsandbox.com' : 'https://connect.squareup.com')
const ppToken = async (s) => (await http({ method: 'post', url: `${ppBase(s)}/v1/oauth2/token`, data: 'grant_type=client_credentials', auth: { username: s.clientId, password: s.clientSecret }, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } })).data.access_token
const bearer = (t) => ({ Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' })
const PAY_FIELDS = {
  stripe: [['key', 'Secret or restricted key (sk_… / rk_…)']],
  paypal: [['clientId', 'Client ID'], ['clientSecret', 'Client secret']],
  square: [['accessToken', 'Access token']],
  razorpay: [['keyId', 'Key ID'], ['keySecret', 'Key secret']],
  mollie: [['apiKey', 'API key (live_… / test_…)']],
}
const payApi = {
  stripe: {
    verify: async (s) => { await http({ url: 'https://api.stripe.com/v1/checkout/sessions?limit=1', auth: { username: s.key, password: '' } }); return {} },
    create: async (s, p) => {
      const b = new URLSearchParams({ mode: 'payment', 'line_items[0][quantity]': '1', 'line_items[0][price_data][currency]': p.currency.toLowerCase(), 'line_items[0][price_data][unit_amount]': String(minor(p.amount, p.currency)), 'line_items[0][price_data][product_data][name]': p.description, success_url: p.returnUrl, cancel_url: p.returnUrl })
      const r = await http({ method: 'post', url: 'https://api.stripe.com/v1/checkout/sessions', data: b, auth: { username: s.key, password: '' }, headers: { 'Idempotency-Key': p.ref } })
      return { id: r.data.id, url: r.data.url }
    },
    status: async (s, id) => (await http({ url: `https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(id)}`, auth: { username: s.key, password: '' } })).data.payment_status === 'paid',
  },
  paypal: {
    verify: async (s) => { await ppToken(s); return {} },
    create: async (s, p) => {
      const t = await ppToken(s)
      const r = await http({ method: 'post', url: `${ppBase(s)}/v2/checkout/orders`, headers: { ...bearer(t), 'PayPal-Request-Id': p.ref }, data: { intent: 'CAPTURE', purchase_units: [{ description: p.description.slice(0, 127), amount: { currency_code: p.currency, value: dec(p.amount, p.currency) } }], application_context: { return_url: p.returnUrl, cancel_url: p.returnUrl, user_action: 'PAY_NOW' } } })
      return { id: r.data.id, url: (r.data.links || []).find(x => x.rel === 'approve' || x.rel === 'payer-action')?.href }
    },
    // An approved PayPal order is not paid until it is captured.
    status: async (s, id) => {
      const t = await ppToken(s)
      const o = (await http({ url: `${ppBase(s)}/v2/checkout/orders/${encodeURIComponent(id)}`, headers: bearer(t) })).data
      if (o.status === 'COMPLETED') return true
      if (o.status !== 'APPROVED') return false
      const c = await http({ method: 'post', url: `${ppBase(s)}/v2/checkout/orders/${encodeURIComponent(id)}/capture`, headers: { ...bearer(t), 'PayPal-Request-Id': `cap-${id}` }, data: {} })
      return c.data.status === 'COMPLETED'
    },
  },
  square: {
    verify: async (s) => {
      const r = await http({ url: `${sqBase(s)}/v2/locations`, headers: bearer(s.accessToken) })
      const loc = (r.data.locations || []).find(l => l.status === 'ACTIVE') || (r.data.locations || [])[0]
      if (!loc) throw new LiveError('Your Square account has no location yet. Add one in Square first.')
      return { locationId: loc.id }
    },
    create: async (s, p) => {
      const r = await http({ method: 'post', url: `${sqBase(s)}/v2/online-checkout/payment-links`, headers: bearer(s.accessToken), data: { idempotency_key: p.ref, quick_pay: { name: p.description, price_money: { amount: minor(p.amount, p.currency), currency: p.currency }, location_id: s.locationId }, checkout_options: { redirect_url: p.returnUrl } } })
      return { id: r.data.payment_link.order_id, url: r.data.payment_link.url || r.data.payment_link.long_url }
    },
    status: async (s, orderId) => {
      const o = (await http({ url: `${sqBase(s)}/v2/orders/${encodeURIComponent(orderId)}`, headers: bearer(s.accessToken) })).data.order || {}
      return o.state === 'COMPLETED' || (o.tenders || []).length > 0
    },
  },
  razorpay: {
    verify: async (s) => { await http({ url: 'https://api.razorpay.com/v1/payment_links/?count=1', auth: { username: s.keyId, password: s.keySecret } }); return {} },
    create: async (s, p) => {
      const r = await http({ method: 'post', url: 'https://api.razorpay.com/v1/payment_links/', auth: { username: s.keyId, password: s.keySecret }, data: { amount: minor(p.amount, p.currency), currency: p.currency, description: p.description, reference_id: p.ref.slice(0, 40), callback_url: p.returnUrl, callback_method: 'get', notify: { sms: false, email: false }, reminder_enable: false } })
      return { id: r.data.id, url: r.data.short_url }
    },
    status: async (s, id) => (await http({ url: `https://api.razorpay.com/v1/payment_links/${encodeURIComponent(id)}`, auth: { username: s.keyId, password: s.keySecret } })).data.status === 'paid',
  },
  mollie: {
    verify: async (s) => { await http({ url: 'https://api.mollie.com/v2/methods', headers: bearer(s.apiKey) }); return {} },
    create: async (s, p) => {
      const r = await http({ method: 'post', url: 'https://api.mollie.com/v2/payments', headers: bearer(s.apiKey), data: { amount: { currency: p.currency, value: dec(p.amount, p.currency) }, description: p.description, redirectUrl: p.returnUrl } })
      return { id: r.data.id, url: r.data._links.checkout.href }
    },
    status: async (s, id) => (await http({ url: `https://api.mollie.com/v2/payments/${encodeURIComponent(id)}`, headers: bearer(s.apiKey) })).data.status === 'paid',
  },
}
const friendlyPay = (e, kind) => new LiveError(e.friendly ? e.message : [401, 403].includes(e.response?.status) ? `${kind[0].toUpperCase()}${kind.slice(1)} did not accept those credentials.` : `${kind[0].toUpperCase()}${kind.slice(1)} answered with an error: ${String(e.response?.data?.error?.message || e.response?.data?.message || e.response?.data?.detail || e.response?.data?.error?.description || e.response?.data?.errors?.[0]?.detail || e.message).slice(0, 160)}`)

// ── connections (per account) ──
const pub = (c) => ({ id: String(c._id), kind: c.kind, type: DB_KINDS.includes(c.kind) ? 'database' : 'payments', name: c.name, hint: c.hint || '', createdAt: c.createdAt })
const newId = () => `ic_${crypto.randomBytes(8).toString('hex')}`
async function list(chatId) { return (await _col.find({ chatId: String(chatId) }).sort({ createdAt: 1 }).toArray()).map(pub) }
async function load(chatId, id) {
  const c = await _col.findOne({ _id: String(id), chatId: String(chatId) })
  return c ? { ...pub(c), secret: unseal(c.secret) } : null
}
async function owns(chatId, ids, type) {
  const want = [...new Set(ids.filter(Boolean).map(String))]
  if (!want.length) return true
  const kinds = type === 'database' ? DB_KINDS : PAY_KINDS
  return (await _col.countDocuments({ _id: { $in: want }, chatId: String(chatId), kind: { $in: kinds } })) === want.length
}
async function create(chatId, body) {
  const kind = String(body.kind || '')
  if ((await _col.countDocuments({ chatId: String(chatId) })) >= 12) throw new LiveError('You can keep up to 12 connections. Remove one first.')
  let secret, hint
  if (DB_KINDS.includes(kind)) {
    const url = String(body.url || '').trim()
    if (!(kind === 'postgres' ? /^postgres(ql)?:\/\/.+/i : /^mongodb(\+srv)?:\/\/.+/i).test(url) || url.length > 600) throw new LiveError(kind === 'postgres' ? 'Paste the full Postgres address. It starts with postgres:// or postgresql://' : 'Paste the full MongoDB address. It starts with mongodb:// or mongodb+srv://')
    secret = { url }
    const tables = await dbApi[kind].tables(secret).catch(e => { throw friendlyDb(e) })
    hint = `${url.replace(/^[a-z+]+:\/\/(?:[^@/]*@)?/i, '').split(/[/?]/)[0].split(',')[0]} · ${tables.length} table${tables.length === 1 ? '' : 's'}`
  } else if (PAY_KINDS.includes(kind)) {
    secret = { mode: body.mode === 'test' ? 'test' : 'live' }
    for (const [f, label] of PAY_FIELDS[kind]) { secret[f] = String(body[f] || '').trim(); if (!secret[f] || secret[f].length > 400) throw new LiveError(`Enter your ${label.replace(/ \(.*/, '')}.`) }
    Object.assign(secret, await payApi[kind].verify(secret).catch(e => { throw friendlyPay(e, kind) }))
    const main = secret[PAY_FIELDS[kind][0][0]]
    hint = `${main.slice(0, 7)}…${main.slice(-4)}${['paypal', 'square'].includes(kind) && secret.mode === 'test' ? ' · sandbox' : ''}`
  } else throw new LiveError('Pick what to connect.')
  const doc = { _id: newId(), chatId: String(chatId), kind, name: String(body.name || '').trim().slice(0, 40) || kind[0].toUpperCase() + kind.slice(1), hint, secret: seal(secret), createdAt: new Date() }
  await _col.insertOne(doc)
  return pub(doc)
}
async function remove(chatId, id) { return (await _col.deleteOne({ _id: String(id), chatId: String(chatId) })).deletedCount === 1 }
async function tables(chatId, id) { const c = await load(chatId, id); if (!c || c.type !== 'database') throw new LiveError('That database connection was removed.'); return dbApi[c.kind].tables(c.secret).catch(e => { throw friendlyDb(e) }) }
async function columns(chatId, id, table) { const c = await load(chatId, id); if (!c || c.type !== 'database') throw new LiveError('That database connection was removed.'); return dbApi[c.kind].columns(c.secret, table).catch(e => { throw friendlyDb(e) }) }
// Values to try for one caller entry: as typed; for a phone number also without "+" and the last 10 digits.
const variants = (value, isPhone) => { const v = String(value || '').trim(); const d = v.replace(/\D/g, ''); return [...new Set(isPhone ? [v, d, `+${d}`, d.slice(-10)] : [v])].filter(Boolean) }
async function find(chatId, id, { table, match, value, isPhone }) {
  const c = await load(chatId, id)
  if (!c || c.type !== 'database') throw new LiveError('That database connection was removed.')
  const row = await dbApi[c.kind].find(c.secret, { table, match, values: variants(value, isPhone) }).catch(e => { throw friendlyDb(e) })
  return row ? flat(row) : null
}

// ── at call time ──
const fill = (tpl, row) => String(tpl || '').replace(/\{([^{}]{1,60})\}/g, (m, k) => { const hit = Object.keys(row || {}).find(x => x.toLowerCase() === k.trim().toLowerCase()); return hit ? String(row[hit]) : '' }).replace(/\s{2,}/g, ' ').trim().slice(0, 600)
const phoneOf = (v) => { const d = String(v || '').replace(/[^\d+]/g, ''); const p = d.startsWith('+') ? d : d.length === 10 ? `+1${d}` : d.length > 10 ? `+${d}` : ''; return /^\+[1-9]\d{7,14}$/.test(p) ? p : '' }
const amountOf = (v) => { const n = Number(String(v ?? '').replace(/[^\d.]/g, '')); return Number.isFinite(n) && n > 0 && n < 1000000 ? Math.round(n * 100) / 100 : 0 }

// Your system's answer: JSON {"say","route","ok","amount","currency"} or plain lines "say: …" / "route to: +1…" / "amount: 42" / "ok: no".
function parseReply(data) {
  let o = data
  if (typeof o === 'string') {
    const t = o.trim()
    try { o = JSON.parse(t) } catch (_) {
      o = {}
      for (const line of t.split(/\r?\n/).slice(0, 12)) { const m = line.match(/^\s*(say|route(?:\s*to)?|amount|currency|ok|found|valid)\s*[:=]\s*(.+)$/i); if (m) o[m[1].toLowerCase().replace(/\s*to$/, '').trim()] = m[2].trim() }
      if (!Object.keys(o).length && t && t.length <= 600 && !/^</.test(t)) o.say = t
    }
  }
  if (!o || typeof o !== 'object') return {}
  const flag = o.ok ?? o.found ?? o.valid ?? o.accept
  const no = flag === false || /^(no|false|0|decline|declined|invalid|not found)$/i.test(String(flag ?? ''))
  return { say: String(o.say ?? o.message ?? '').trim().slice(0, 600), route: phoneOf(o.route ?? o.routeTo ?? o.route_to ?? o.forwardTo ?? o.connect), amount: amountOf(o.amount), currency: /^[A-Za-z]{3}$/.test(String(o.currency || '')) ? String(o.currency).toUpperCase() : '', ok: !no }
}
async function askHook(rawUrl, body) {
  const url = String(rawUrl || '').trim()
  try {
    safeUrl.assertSendable(url)
    const r = await axios.post(url, body, { timeout: 8000, maxContentLength: 32 * 1024, responseType: 'text', transformResponse: [(d) => d], validateStatus: (s) => s < 500, headers: { 'User-Agent': 'CloudIVR-Webhook/1', Accept: 'application/json, text/plain' }, ...safeUrl.sendOptions() })
    if (r.status === 404 || r.status === 403 || r.status === 401) return { reached: true, ok: false, say: '', route: '', amount: 0, currency: '' }
    if (r.status >= 300) return { reached: false }
    return { reached: true, ...parseReply(r.data) }
  } catch (e) { _log(`[IvrLive] webhook reply failed: ${e.code || e.message}`); return { reached: false } }
}

// One answer for a key: { found, say, route, amount, currency, row, error }.
async function resolve(chatId, option, ctx) {
  const check = option.check || {}
  try {
    if (check.source === 'db') {
      const byPhone = !ctx.entered
      const row = await find(chatId, check.connId, { table: check.table, match: check.match, value: byPhone ? ctx.from : ctx.entered, isPhone: byPhone })
      if (!row) return { found: false }
      return { found: true, row, say: fill(check.say, row), route: check.routeColumn ? phoneOf(row[check.routeColumn]) : '', amount: check.amountColumn ? amountOf(row[check.amountColumn]) : 0, currency: '' }
    }
    if (check.source === 'reply') {
      const r = await askHook(option.url || option.webhook, { event: ctx.event, from: ctx.from, to: ctx.to, digit: ctx.digit, ...(ctx.entered ? { collected: ctx.entered } : {}), reply: 'expected', at: new Date().toISOString() })
      if (!r.reached) return { found: false, error: 'Your system did not answer.' }
      return { found: r.ok, say: r.say, route: r.route, amount: r.amount, currency: r.currency }
    }
  } catch (e) { _log(`[IvrLive] lookup failed for ${chatId}: ${e.message}`); return { found: false, error: e.friendly ? e.message : 'The lookup failed.' } }
  return { found: true }
}

// ── payment links ──
const base = () => `${String(process.env.SELF_URL || process.env.SELF_URL_PROD || '').replace(/\/+$/, '')}/cloudivr-web/public`
async function startPayment(chatId, option, { caller, to, amount, currency, note }) {
  const c = await load(chatId, option.connId)
  if (!c || c.type !== 'payments') throw new LiveError('The payment provider for this key was removed.')
  const cur = String(currency || option.currency || 'USD').toUpperCase(), amt = amountOf(amount)
  if (!amt) throw new LiveError('No amount to charge.')
  const token = crypto.randomBytes(7).toString('base64url')
  const description = `${String(option.description || 'Payment').slice(0, 80)}${note ? ` (${String(note).slice(0, 30)})` : ''}`
  const link = await payApi[c.kind].create(c.secret, { amount: amt, currency: cur, description, returnUrl: `${base()}/pay-done?p=${token}`, ref: `civr-${token}` }).catch(e => { throw friendlyPay(e, c.kind) })
  if (!link.url) throw new LiveError('The payment provider did not return a link.')
  await _pay.insertOne({ _id: token, chatId: String(chatId), connId: c.id, kind: c.kind, providerId: link.id, url: link.url, caller, to, amount: amt, currency: cur, description, status: 'open', createdAt: new Date() })
  return { token, url: `${base()}/pay/${token}`, amount: amt, currency: cur }
}
async function checkPayment(token) {
  const p = await _pay.findOne({ _id: String(token) })
  if (!p) return null
  if (p.status === 'paid') return p
  const c = await load(p.chatId, p.connId)
  if (!c) return p
  const paid = await payApi[c.kind].status(c.secret, p.providerId).catch(e => { _log(`[IvrLive] payment status ${token}: ${e.response?.status || e.message}`); return false })
  if (!paid) return p
  const r = await _pay.updateOne({ _id: p._id, status: 'open' }, { $set: { status: 'paid', paidAt: new Date() } })
  if (r.modifiedCount && _notify) _notify(p.chatId, `💳 Payment received: ${p.amount} ${p.currency} from ${p.caller} (payment link sent by your keypad menu on ${p.to}).`)
  return { ...p, status: 'paid' }
}
// Keep checking a sent link for 20 minutes (also captures an approved PayPal order).
function watchPayment(token, onPaid) {
  const t0 = Date.now()
  const tick = async () => {
    const p = await checkPayment(token).catch(() => null)
    if (p?.status === 'paid') return onPaid && onPaid(p)
    const age = Date.now() - t0
    if (p && age < 20 * 60000) { const t = setTimeout(tick, age < 3 * 60000 ? 6000 : 20000); t.unref && t.unref() }
  }
  const t = setTimeout(tick, 6000); t.unref && t.unref()
}
const paymentUrl = async (token) => (await _pay.findOne({ _id: String(token) }, { projection: { url: 1 } }))?.url || null

module.exports = { init, list, load, owns, create, remove, tables, columns, find, resolve, fill, parseReply, askHook, startPayment, checkPayment, watchPayment, paymentUrl, phoneOf, amountOf, LiveError, DB_KINDS, PAY_KINDS, PAY_FIELDS, _allowPrivateForTests, _payApi: payApi }
