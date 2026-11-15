'use strict'
// CloudIVR invoices & receipts for every CloudIVR charge, whether it was paid in the app or the chat bot.
// Built from the payment logs (phoneTransactions + transactions) into `cloudivrInvoices`, numbered CIVR-<year>-<seq>.
// Wording never mentions the bot: every document reads as a cloudivr.net order.
const SELLER = { name: 'CloudIVR', site: 'cloudivr.net', address: 'Rua Aquilino Ribeiro, Nr. 255, 1º Esq., 2870-047 Montijo, Setúbal, Portugal' }
const BOT_BILL_TO = { name: 'Zeynep Kaya', address: 'İstiklal Caddesi No: 120, Hüseyinağa Mahallesi, Beyoğlu / İstanbul 34435, Türkiye' }
const round2 = (n) => Math.round(Number(n) * 10000) / 10000 // keeps sub-cent lookup prices exact

const PHONE = { purchase: 'Phone number', purchase_sub: 'Extra phone number', 'sub-number-purchase': 'Extra phone number', purchase_verification: 'Phone number', renew: 'Phone number renewal', auto_renew: 'Phone number renewal', upgrade: 'Plan upgrade', sms_reply: 'Extra texts' }
const TX = {
  'esim-purchase': 'USA eSIM', 'mobile-number-purchase': 'USA Texting Number', 'esim-renewal': 'eSIM / Texting Number renewal', 'esim-number-replace': 'eSIM / Texting Number replacement',
  'travel-esim': 'Travel eSIM', 'fax-number': 'Fax number', 'fax-number-renewal': 'Fax number renewal', 'number-replace': 'Number replacement',
  'hosted-sms-setup': 'Business texting setup', 'hosted-sms-renewal': 'Business texting monthly', 'lead-check': 'Lead check', 'cnam-lookup': 'Owner-name lookup',
  'caller-id-verify': 'Caller ID verification', 'number-lookup': 'Number lookup', 'email-check': 'Email check', ai_summary: 'AI call summaries', leads: 'Lead list',
}
const REFUND = { 'esim-refund': 'Refund · USA eSIM', 'mobile-number-refund': 'Refund · USA Texting Number', 'esim-number-refund': 'Refund · number replacement', 'travel-esim-refund': 'Refund · Travel eSIM', 'hosted-sms-refund': 'Refund · Business texting', 'lead-check-refund': 'Refund · lead check' }
// Per-call / per-text charges: one itemised usage invoice per account per finished month.
const USAGE = { outbound_call: 'Outbound calls', connection_fee: 'Call connection fees', sip_per_minute: 'Softphone call minutes', twilio_bridge_per_minute: 'Forwarded call minutes', ai_agent_call: 'AI agent calls', text_relay_call: 'Text relay calls', 'esim-sms': 'eSIM texts' }
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const PLAN = { starter: 'Basic', standard: 'Starter', pro: 'Pro', business: 'Business' }

// 'crypto_dynopay_BTC' / '🪙 Crypto (BTC)' → 'Crypto (BTC)'; wallet → 'CloudIVR wallet'. null = not a real charge.
function paidWith(m) {
  const s = String(m || 'wallet')
  if (/restor|gift|admin|none|no debit/i.test(s)) return null
  const coin = (s.match(/crypto[_ ]?(?:dynopay_|blockbee_)?\(?([A-Z0-9-]{2,12})\)?/i) || [])[1]
  if (/crypto/i.test(s)) return coin && !/order/i.test(coin) ? `Crypto (${coin.toUpperCase()})` : 'Crypto'
  if (/card|mollie|paypal/i.test(s)) return 'Card / PayPal'
  return 'CloudIVR wallet'
}

function createInvoices({ db, h, adminRequire, log = console.log }) {
  const col = db.collection('cloudivrInvoices')
  const counters = db.collection('counters')
  const accounts = db.collection('webAccounts')
  col.createIndex({ chatId: 1, issuedAt: -1 }).catch(() => {})
  col.createIndex({ number: 1 }, { unique: true }).catch(() => {})

  const billTo = async (chatId) => {
    const acc = await accounts.findOne({ _id: Number(chatId) }, { projection: { email: 1, legalProfile: 1 } }).catch(() => null)
    // Web-range ids (5000000000000xxx) with no account left = deleted web account, not a chat order.
    if (!acc) return /^5000000000\d{3,}$/.test(String(chatId)) ? { name: `Customer #${chatId}` } : { ...BOT_BILL_TO }
    const eu = require('./legal-profile').endUser(acc)
    return { name: eu?.name || acc.legalProfile?.fullName || null, email: acc.email, address: eu?.address || null, ...(eu?.vatNumber ? { vat: eu.vatNumber } : {}) }
  }
  const nextNumber = async (year) => {
    const r = await counters.findOneAndUpdate({ _id: `cloudivr-invoice-${year}` }, { $inc: { seq: 1 } }, { upsert: true, returnDocument: 'after', includeResultMetadata: false })
    return `CIVR-${year}-${String(r.seq).padStart(6, '0')}`
  }
  async function add(id, { chatId, at, kind, description, amount, items, title, paidWith: pw }) {
    if (await col.findOne({ _id: id }, { projection: { _id: 1 } })) return false
    const issuedAt = new Date(at || Date.now())
    const doc = { _id: id, number: await nextNumber(issuedAt.getUTCFullYear()), chatId: String(chatId), kind, issuedAt, seller: SELLER, billTo: await billTo(chatId), ...(title ? { title } : {}),
      items: items || [{ description, amount: round2(amount) }], total: round2(amount), currency: 'USD', paidWith: pw, status: kind === 'credit_note' ? 'refunded' : 'paid', createdAt: new Date() }
    try { await col.insertOne(doc); return true } catch (e) { if (e.code === 11000) return false; throw e }
  }

  // Closed months only, so a usage invoice never changes after it is issued.
  async function usage(from) {
    const cur = new Date().toISOString().slice(0, 7), start = from.toISOString().slice(0, 7)
    const month = (f) => ({ $substrCP: [{ $toString: f }, 0, 7] })
    const rows = [
      ...await db.collection('walletLedger').aggregate([{ $match: { type: { $in: Object.keys(USAGE) }, amount: { $lt: 0 } } }, { $project: { chatId: { $toString: '$chatId' }, type: 1, amount: 1, m: month('$timestamp') } }, { $match: { m: { $gte: start, $lt: cur } } }, { $group: { _id: { c: '$chatId', m: '$m', t: '$type' }, n: { $sum: 1 }, sum: { $sum: '$amount' } } }]).toArray(),
      ...await db.collection('transactions').aggregate([{ $match: { type: 'esim-sms', status: { $ne: 'failed' }, createdAt: { $gte: from } } }, { $project: { chatId: { $toString: '$chatId' }, type: 1, amount: 1, m: month('$createdAt') } }, { $match: { m: { $lt: cur } } }, { $group: { _id: { c: '$chatId', m: '$m', t: '$type' }, n: { $sum: 1 }, sum: { $sum: { $abs: '$amount' } } } }]).toArray(),
    ]
    const by = {}
    for (const r of rows) (by[`${r._id.c}:${r._id.m}`] = by[`${r._id.c}:${r._id.m}`] || []).push(r)
    return Object.entries(by).map(([k, rs]) => {
      const [chatId, m] = k.split(':'), [y, mo] = m.split('-').map(Number)
      const items = Object.keys(USAGE).map(t => rs.find(r => r._id.t === t)).filter(Boolean).map(r => ({ description: `${USAGE[r._id.t]} · ${r.n} ${r.n === 1 ? 'charge' : 'charges'}`, amount: round2(Math.abs(r.sum)) })).filter(i => i.amount > 0)
      const amount = items.reduce((a, i) => a + i.amount, 0)
      return [`usage:${chatId}:${m}`, { chatId, at: new Date(Date.UTC(y, mo, 0, 23, 59, 59)), kind: 'invoice', title: `Calls & texts · ${MONTHS[mo - 1]} ${y}`, items, amount, paidWith: 'CloudIVR wallet' }]
    }).filter(([, d]) => round2(d.amount) > 0)
  }

  // Phone line: "Phone number · +1 555 · Pro plan"
  const phoneLine = (t) => [PHONE[t.action], t.phoneNumber, t.plan && PLAN[t.plan] ? `${PLAN[t.plan]} plan` : null].filter(Boolean).join(' · ')
  let lastUsage = 0
  async function sync({ since } = {}) {
    const from = since || new Date(Date.now() - 400 * 864e5)
    const todo = []
    for (const t of await db.collection('phoneTransactions').find({ action: { $in: Object.keys(PHONE) }, amount: { $gt: 0 }, $or: [{ timestamp: { $gte: from.toISOString() } }, { timestamp: { $gte: from } }] }).limit(5000).toArray()) {
      const pw = paidWith(t.paymentMethod); if (!pw || !t.chatId) continue
      todo.push([`ptx:${t._id}`, { chatId: t.chatId, at: t.timestamp, kind: 'invoice', description: phoneLine(t), amount: Number(t.amount), paidWith: pw }])
    }
    const types = [...Object.keys(TX), ...Object.keys(REFUND), 'wallet-topup']
    for (const t of await db.collection('transactions').find({ type: { $in: types }, createdAt: { $gte: from } }).limit(5000).toArray()) {
      const amount = Math.abs(Number(t.amount) || 0); if (round2(amount) <= 0 || !t.chatId || t.status === 'failed') continue
      if (t.type === 'wallet-topup' && (t.status !== 'completed' || t.metadata?.value === 'preview')) continue
      const ref = t.metadata?.phoneNumber || (t.type === 'travel-esim' ? t.ref : null)
      const doc = t.type === 'wallet-topup'
        ? { kind: 'receipt', description: 'Wallet top-up', paidWith: t.metadata?.psp === 'mollie' ? 'Card / PayPal' : `Crypto${t.metadata?.coin ? ` (${String(t.metadata.coin).toUpperCase()})` : ''}` }
        : REFUND[t.type] ? { kind: 'credit_note', description: `${REFUND[t.type]}${ref ? ` · ${ref}` : ''}`, paidWith: 'Refunded to CloudIVR wallet' }
          : { kind: 'invoice', description: `${TX[t.type]}${ref ? ` · ${ref}` : ''}`, paidWith: paidWith(t.metadata?.paymentMethod || t.paymentMethod) || 'CloudIVR wallet' }
      todo.push([`tx:${t._id}`, { chatId: t.chatId, at: t.createdAt, amount, ...doc }])
    }
    if (!since || Date.now() - lastUsage > 6 * 3600000) { todo.push(...await usage(since ? new Date(Date.now() - 62 * 864e5) : from)); lastUsage = Date.now() }
    // Numbers follow the issue date.
    todo.sort((a, b) => new Date(a[1].at) - new Date(b[1].at))
    let n = 0
    for (const [id, d] of todo) if (await add(id, d)) n++
    if (n) log(`[Invoices] created ${n}`)
    return n
  }
  let last = 0, running = null
  const tick = () => { if (running) return running; running = sync({ since: last ? new Date(last - 3600000) : undefined }).then((n) => { last = Date.now(); return n }).finally(() => { running = null }); return running }
  setTimeout(() => tick().catch(e => log(`[Invoices] sync failed: ${e.message}`)), 20000).unref?.()
  setInterval(() => tick().catch(e => log(`[Invoices] sync failed: ${e.message}`)), 5 * 60000).unref?.()

  const pub = ({ _id, createdAt, ...d }) => ({ id: _id, ...d })
  function routes(r) {
    r.get('/billing/invoices', h(async (req, res) => {
      await tick().catch(() => {})
      res.json({ invoices: (await col.find({ chatId: String(req.webChatId) }).sort({ issuedAt: -1 }).limit(200).toArray()).map(pub) })
    }))
    r.get('/billing/invoices/:id', h(async (req, res) => {
      const d = await col.findOne({ _id: String(req.params.id), chatId: String(req.webChatId) })
      if (!d) return res.status(404).json({ error: 'not_found', message: 'Invoice not found.' })
      res.json({ invoice: pub(d) })
    }))
  }
  function adminRoutes(r) {
    r.get('/admin/invoices', adminRequire, h(async (req, res) => {
      await tick().catch(() => {})
      const q = String(req.query.q || '').trim(), esc = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const filter = q ? { $or: [{ number: new RegExp(esc, 'i') }, { chatId: q }, { 'billTo.email': new RegExp(esc, 'i') }, { 'billTo.name': new RegExp(esc, 'i') }, { 'items.description': new RegExp(esc, 'i') }, { title: new RegExp(esc, 'i') }] } : {}
      const [list, total] = await Promise.all([col.find(filter).sort({ issuedAt: -1 }).limit(200).toArray(), col.countDocuments(filter)])
      res.json({ invoices: list.map(pub), total })
    }))
  }
  return { routes, adminRoutes, sync, paidWith }
}

module.exports = { createInvoices, paidWith, SELLER, BOT_BILL_TO, USAGE }
