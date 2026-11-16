'use strict'
// US/Canada toll-free texting verification. The customer fills in the business + use details on the number's Texting tab;
// an admin checks it in the dashboard and files it with MultiTEL (no public API for this — filed in their portal/support).
// Texting can be switched on once it's marked active, or straight away if MultiTEL already shows the number as verified.
// One doc per number in `tollFreeVerify` (_id = E.164).
const USE_CASES = ['CUSTOMER_CARE', 'ACCOUNT_NOTIFICATION', 'DELIVERY_NOTIFICATION', 'MARKETING', 'MIXED', 'TWO_FACTOR_AUTH']
const VOLUMES = ['1,000', '10,000', '100,000', '250,000', '500,000', '1,000,000']
const s = (v, n = 200) => String(v ?? '').trim().slice(0, n)
const needsTfv = (n) => !!n && n.type === 'toll_free' && ['US', 'CA'].includes(n.country) && n.provider === 'multitel'
const esc = (x) => String(x || '').replace(/</g, '&lt;')

function validate(b = {}) {
  const f = { businessName: s(b.businessName, 100), website: s(b.website, 200), contactName: s(b.contactName, 80), email: s(b.email, 120), phone: s(b.phone, 20).replace(/[^\d+]/g, ''),
    street: s(b.street, 120), city: s(b.city, 60), state: s(b.state, 2).toUpperCase(), postalCode: s(b.postalCode, 10), country: ['US', 'CA'].includes(b.country) ? b.country : 'US',
    useCase: USE_CASES.includes(b.useCase) ? b.useCase : null, volume: VOLUMES.includes(b.volume) ? b.volume : null, description: s(b.description, 500), sample: s(b.sample, 320), optIn: s(b.optIn, 500), optInUrl: s(b.optInUrl, 300) }
  if (!f.businessName || !f.contactName) return { error: 'Enter the business name and a contact name.' }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email) || f.phone.replace(/\D/g, '').length < 10) return { error: 'Enter a contact email and phone number.' }
  if (!f.street || !f.city || !f.state || !f.postalCode) return { error: 'Enter the business address.' }
  if (!f.useCase || !f.volume) return { error: 'Pick what the texts are for and the monthly volume.' }
  if (f.description.length < 20 || f.sample.length < 10 || f.optIn.length < 20) return { error: 'Describe the texts, add a sample message and explain how people agree to get them.' }
  return f
}

// MultiTEL already shows the toll-free number as verified for texting?
async function carrierVerified(phone) {
  try {
    const d = await require('../multitel').api('get', `registration_status/${String(phone).replace(/\D/g, '')}`)
    return /approved|verified|complete/i.test(String(d?.response?.verification_status || ''))
  } catch (e) { console.log(`[TollFree] status ${phone}: ${e.message}`); return false }
}
async function canText(db, chatId, phone) {
  const d = await db.collection('tollFreeVerify').findOne({ _id: phone }, { projection: { status: 1, chatId: 1 } })
  return (d?.status === 'active' && d.chatId === String(chatId)) || carrierVerified(phone)
}

function createTollFree({ db, h, adminRequire, notify, notifyAdmin = () => {}, log = console.log }) {
  const col = db.collection('tollFreeVerify'), nums = db.collection('phoneNumbersOf')
  const pub = (d) => d ? { status: d.status, form: d.form, note: d.note || null, submittedAt: d.submittedAt || null } : { status: 'none' }
  const mine = async (chatId, phone) => ((await nums.findOne({ _id: String(chatId) }))?.val?.numbers || []).find(n => n.phoneNumber === phone && n.status === 'active')


  function routes(r) {
    r.get('/numbers/:phone/tollfree', h(async (req, res) => {
      const n = await mine(req.webChatId, req.params.phone)
      if (!needsTfv(n)) return res.status(404).json({ error: 'not_found', message: 'This isn’t a toll-free number.' })
      const d = await col.findOne({ _id: n.phoneNumber, chatId: String(req.webChatId) })
      res.json({ ...pub(d), useCases: USE_CASES, volumes: VOLUMES, carrierVerified: d?.status === 'active' ? true : await carrierVerified(n.phoneNumber) })
    }))
    r.put('/numbers/:phone/tollfree', h(async (req, res) => {
      const n = await mine(req.webChatId, req.params.phone)
      if (!needsTfv(n)) return res.status(404).json({ error: 'not_found', message: 'This isn’t a toll-free number.' })
      const cur = await col.findOne({ _id: n.phoneNumber })
      if (cur && cur.chatId !== String(req.webChatId)) return res.status(409).json({ error: 'locked', message: 'This number already has a verification on file.' })
      if (['submitted', 'filed', 'active'].includes(cur?.status)) return res.status(409).json({ error: 'locked', message: 'Your verification is already being processed.' })
      const v = validate(req.body)
      if (v.error) return res.status(400).json({ error: 'invalid', message: v.error })
      await col.updateOne({ _id: n.phoneNumber }, { $set: { chatId: String(req.webChatId), form: v, status: 'submitted', submittedAt: new Date(), note: null } }, { upsert: true })
      notifyAdmin(`📝 Toll-free texting verification for ${n.phoneNumber} (web account ${req.webChatId}, ${esc(v.businessName)}). Admin → Compliance → Toll-free.`)
      res.json(pub(await col.findOne({ _id: n.phoneNumber })))
    }))
  }

  function adminRoutes(r) {
    const A = adminRequire
    r.get('/admin/tollfree', A, h(async (req, res) => {
      const st = String(req.query.status || 'submitted')
      const docs = await col.find(st === 'all' ? {} : { status: st }).sort({ submittedAt: -1 }).limit(100).toArray()
      const accs = new Map((await db.collection('webAccounts').find({ _id: { $in: docs.map(d => Number(d.chatId)) } }, { projection: { email: 1 } }).toArray()).map(a => [String(a._id), a.email]))
      res.json({ items: docs.map(d => ({ phone: d._id, chatId: d.chatId, email: accs.get(String(d.chatId)) || null, ...pub(d) })) })
    }))
    r.post('/admin/tollfree/:phone/decision', A, h(async (req, res) => {
      const phone = String(req.params.phone), d = String(req.body?.decision || ''), note = s(req.body?.note, 500) || null
      const cur = await col.findOne({ _id: phone })
      if (!cur) return res.status(404).json({ error: 'not_found', message: 'No verification for this number.' })
      if (d === 'reject') {
        if (!note) return res.status(400).json({ error: 'note_needed', message: 'Say why it was rejected.' })
        await col.updateOne({ _id: phone }, { $set: { status: 'rejected', note } })
        // Was approved before → texting can't stay on.
        if (cur.status === 'active') await db.collection('phoneNumbersOf').updateOne({ _id: cur.chatId, 'val.numbers.phoneNumber': phone }, { $set: { 'val.numbers.$.features.sms': false } })
        notify?.push(cur.chatId, `Your toll-free texting verification for ${phone} needs changes: ${note}`, null, { kind: 'billing' }).catch(() => {})
        return res.json({ status: 'rejected' })
      }
      if (d === 'approve') {
        if (cur.status !== 'submitted') return res.status(409).json({ error: 'not_pending', message: 'This verification is not waiting for review.' })
        await col.updateOne({ _id: phone }, { $set: { status: 'filed', filedAt: new Date(), approvedBy: req.admin?.email || 'admin' } })
        const f = cur.form
        notifyAdmin(`📨 File toll-free verification with MultiTEL for ${phone}:\n${esc(f.businessName)} · ${esc(f.website)} · ${esc(f.contactName)} ${esc(f.email)} ${esc(f.phone)}\n${esc(f.street)}, ${esc(f.city)} ${esc(f.state)} ${esc(f.postalCode)} ${f.country}\n${f.useCase} · ${f.volume}/month\n${esc(f.description)}\nSample: ${esc(f.sample)}\nOpt-in: ${esc(f.optIn)} ${esc(f.optInUrl)}`)
        notify?.push(cur.chatId, `Your toll-free texting verification for ${phone} was sent to the carrier. It usually takes a few business days — we’ll tell you when texting can be switched on.`, null, { kind: 'billing' }).catch(() => {})
        return res.json({ status: 'filed' })
      }
      if (d === 'activate') {
        if (cur.status !== 'filed') return res.status(409).json({ error: 'not_filed', message: 'Approve and file it with the carrier first.' })
        await col.updateOne({ _id: phone }, { $set: { status: 'active', activatedAt: new Date() } })
        notify?.push(cur.chatId, `Toll-free texting is approved for ${phone}. Switch texting on in the number’s Texting tab.`, null, { kind: 'billing' }).catch(() => {})
        return res.json({ status: 'active' })
      }
      res.status(400).json({ error: 'bad_decision', message: 'Use approve, reject or activate.' })
    }))
  }

  // Filed verifications: MultiTEL shows them verified → active.
  async function tick() {
    for (const d of await col.find({ status: 'filed' }).limit(50).toArray()) {
      if (!(await carrierVerified(d._id))) continue
      await col.updateOne({ _id: d._id }, { $set: { status: 'active', activatedAt: new Date() } })
      notify?.push(d.chatId, `Toll-free texting is approved for ${d._id}. Switch texting on in the number’s Texting tab.`, null, { kind: 'billing' }).catch(() => {})
    }
  }

  return { routes, adminRoutes, tick }
}

module.exports = { createTollFree, needsTfv, validate, canText, carrierVerified }
