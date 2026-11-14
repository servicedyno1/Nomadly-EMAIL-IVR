'use strict'
// US 10DLC texting registration. The customer fills in brand + campaign details; an admin approves in the dashboard,
// which files them automatically with the carrier of each US local number (Infobip: brand → register → campaign →
// submit; MultiTEL: brand_nonBlocking → campaignBuilder_insert). Outgoing texts from those numbers stay blocked
// until the registration is active. One doc per web account in `tenDlc`; every step is kept in `filings`.
const ENTITY = ['PRIVATE_PROFIT', 'PUBLIC_PROFIT', 'NON_PROFIT', 'SOLE_PROPRIETOR']
const USE_CASES = ['CUSTOMER_CARE', 'ACCOUNT_NOTIFICATION', 'DELIVERY_NOTIFICATION', 'MARKETING', 'MIXED', 'TWO_FACTOR_AUTH', 'LOW_VOLUME']
const IB_USE = { CUSTOMER_CARE: 'CHAT', ACCOUNT_NOTIFICATION: 'ALERTS', DELIVERY_NOTIFICATION: 'ALERTS', MARKETING: 'PROMOTIONAL_MARKETING', MIXED: 'ALERTS', TWO_FACTOR_AUTH: 'TWO_FACTOR_AUTH', LOW_VOLUME: 'ALERTS' }
const IB_TYPE = { PRIVATE_PROFIT: 'TENDLC_PRIVATE_COMPANY', PUBLIC_PROFIT: 'TENDLC_PUBLIC_COMPANY', NON_PROFIT: 'TENDLC_NON_PROFIT', SOLE_PROPRIETOR: 'TENDLC_SOLE_PROPRIETOR' }
const s = (v, n = 200) => String(v ?? '').trim().slice(0, n)
const needs10dlc = (n) => n && n.country === 'US' && (n.type || 'local') === 'local' && ['infobip', 'multitel'].includes(n.provider)

function validate(b = {}) {
  const brand = { entityType: ENTITY.includes(b.brand?.entityType) ? b.brand.entityType : null, companyName: s(b.brand?.companyName, 100), ein: s(b.brand?.ein, 20), website: s(b.brand?.website, 200), vertical: s(b.brand?.vertical, 40) || 'PROFESSIONAL',
    email: s(b.brand?.email, 120), phone: s(b.brand?.phone, 20).replace(/[^\d+]/g, ''), street: s(b.brand?.street, 120), city: s(b.brand?.city, 60), state: s(b.brand?.state, 2).toUpperCase(), postalCode: s(b.brand?.postalCode, 10), firstName: s(b.brand?.firstName, 60), lastName: s(b.brand?.lastName, 60) }
  const campaign = { useCase: USE_CASES.includes(b.campaign?.useCase) ? b.campaign.useCase : null, description: s(b.campaign?.description, 500), sample1: s(b.campaign?.sample1, 320), sample2: s(b.campaign?.sample2, 320), messageFlow: s(b.campaign?.messageFlow, 1024) }
  if (!brand.entityType) return { error: 'Pick your business type.' }
  if (brand.entityType === 'SOLE_PROPRIETOR' ? !(brand.firstName && brand.lastName) : !(brand.companyName && /^\d{2}-?\d{7}$/.test(brand.ein))) return { error: brand.entityType === 'SOLE_PROPRIETOR' ? 'Enter your first and last name.' : 'Enter the legal company name and the 9-digit EIN (e.g. 12-3456789).' }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(brand.email) || brand.phone.replace(/\D/g, '').length < 10) return { error: 'Enter a support email and phone number.' }
  if (!(brand.street && brand.city && /^[A-Za-z]{2}$/.test(String(b.brand?.state || '').trim()) && brand.postalCode)) return { error: 'Enter the full US business address (street, city, 2-letter state, ZIP).' }
  if (!campaign.useCase) return { error: 'Pick what the texts are for.' }
  if (campaign.description.length < 40) return { error: 'Describe the texts you will send (at least 40 characters).' }
  if (campaign.sample1.length < 20 || campaign.sample2.length < 20) return { error: 'Add two sample messages (at least 20 characters each).' }
  if (campaign.messageFlow.length < 40) return { error: 'Explain how people agree to get your texts (at least 40 characters), e.g. a checkbox on your website form.' }
  return { brand, campaign }
}

const FEE = Number(process.env.TENDLC_SERVICE_FEE || 49)
function createTenDlc({ db, h, adminRequire, notify, notifyAdmin = () => {}, walletOps, log = console.log }) {
  const w = walletOps(db)
  const col = db.collection('tenDlc')
  const nums = db.collection('phoneNumbersOf')
  const usNumbers = async (chatId) => ((await nums.findOne({ _id: chatId }))?.val?.numbers || []).filter(n => needs10dlc(n) && !/released|expired/.test(n.status || '')).map(n => ({ phoneNumber: n.phoneNumber, provider: n.provider }))
  const pub = (d) => d ? { status: d.status, brand: d.brand, campaign: d.campaign, note: d.note || null, numbers: d.numbers || [], submittedAt: d.submittedAt || null, filings: (d.filings || []).map(f => ({ provider: f.provider, status: f.status, error: f.error || null, at: f.at })) } : { status: 'none' }

  async function isActive(chatId, phone) {
    const d = await col.findOne({ _id: String(chatId) }, { projection: { status: 1, numbers: 1 } })
    return d?.status === 'active' && (d.numbers || []).some(n => n.phoneNumber === phone)
  }

  const AH = (s) => s.replace(/\s+/g, ' ')
  async function fileInfobip(d, numbers) {
    const http = require('../infobip').http()
    const b = d.brand, c = d.campaign
    const brand = (await http.post('/number-registration/1/brands', { type: IB_TYPE[b.entityType], name: b.companyName || `${b.firstName} ${b.lastName}`, legalName: b.companyName || `${b.firstName} ${b.lastName}`, website: b.website || undefined,
      address: { street: b.street, city: b.city, state: b.state, zipCode: b.postalCode }, countryCode: 'US', supportEmail: b.email, supportPhone: b.phone.replace(/\D/g, ''), vertical: b.vertical, taxId: b.ein || undefined, taxIdIssuingCountry: 'US', referenceId: `civr-${d._id}` })).data
    await http.post(`/number-registration/1/brands/${brand.id}/register`)
    const camp = (await http.post('/number-registration/1/campaigns', { type: 'TEN_DIGIT_LONG_CODE', referenceId: `civr-${d._id}-${Date.now() % 1e6}`, name: s(`${b.companyName || b.lastName} texts`, 30), brandId: brand.id, programSummary: c.description, exampleMessages: [c.sample1, c.sample2],
      messageTypes: ['SMS'], useCases: [IB_USE[c.useCase]], lowVolume: c.useCase === 'LOW_VOLUME', customerCareEmail: b.email, customerCarePhone: b.phone.replace(/\D/g, ''),
      helpMessage: AH(`${b.companyName || b.lastName}: help at ${b.email}. Msg&data rates may apply. Reply STOP to cancel.`), stopMessage: AH(`${b.companyName || b.lastName}: you are unsubscribed and will get no more messages.`),
      optIns: { web: { callToAction: AH(`${c.messageFlow} Msg frequency varies. Msg&data rates may apply. Reply HELP for help, STOP to cancel.`), url: b.website || 'https://cloudivr.net' } },
      numbers: numbers.map(n => n.phoneNumber.replace(/\D/g, '')) })).data
    await http.post(`/number-registration/1/campaigns/${camp.id}/register`)
    return { brandId: brand.id, campaignId: camp.id }
  }
  async function fileMultitel(d, numbers) {
    const mt = require('../multitel'), b = d.brand, c = d.campaign
    const br = await mt.api('post', 'brand_nonBlocking', { entityType: b.entityType, companyName: b.companyName, displayName: b.companyName || `${b.firstName} ${b.lastName}`, firstName: b.firstName, lastName: b.lastName, ein: b.ein, einIssuingCountry: 'US', phone: b.phone, email: b.email, street: b.street, city: b.city, state: b.state, postalCode: b.postalCode, country: 'US', website: b.website, vertical: b.vertical, brandRelationship: 'BASIC_ACCOUNT' })
    const brandId = br?.response?.brandId || br?.response?.id
    if (!brandId) throw new Error(br?.status?.msg || 'MultiTEL did not return a brand id')
    const cp = await mt.api('post', 'campaignBuilder_insert', { brandId, usecase: c.useCase, description: c.description, sample1: c.sample1, sample2: c.sample2, messageFlow: c.messageFlow, subscriberOptin: 'true', subscriberOptout: 'true', subscriberHelp: 'true', numbers: numbers.map(n => n.phoneNumber.replace(/\D/g, '')).join(',') })
    const campaignId = cp?.response?.campaignId || cp?.response?.id
    if (!campaignId) throw new Error(cp?.status?.msg || 'MultiTEL did not return a campaign id')
    return { brandId, campaignId }
  }

  // Admin approved → file with every provider that owns one of the customer's US local numbers.
  async function file(chatId) {
    const d = await col.findOne({ _id: String(chatId) })
    const numbers = await usNumbers(chatId)
    const filings = []
    for (const provider of [...new Set(numbers.map(n => n.provider))]) {
      const own = numbers.filter(n => n.provider === provider)
      try { filings.push({ provider, status: 'filed', ...(provider === 'infobip' ? await fileInfobip(d, own) : await fileMultitel(d, own)), numbers: own.map(n => n.phoneNumber), at: new Date() }) }
      catch (e) { const msg = e.response?.data?.requestError?.serviceException?.text || e.response?.data?.errorMessage || e.message; filings.push({ provider, status: 'failed', error: String(msg).slice(0, 300), at: new Date() }); log(`[10DLC] ${chatId} ${provider} filing failed: ${msg}`) }
    }
    const status = !filings.length ? 'approved' : filings.every(f => f.status === 'filed') ? 'filed' : 'failed'
    await col.updateOne({ _id: String(chatId) }, { $set: { status, numbers, filedAt: new Date() }, $push: { filings: { $each: filings } } })
    notifyAdmin(`📨 10DLC for web account ${chatId}: ${status}${filings.length ? ' — ' + filings.map(f => `${f.provider} ${f.status}${f.error ? ` (${f.error})` : ''}`).join(', ') : ' (no US Infobip/MultiTEL numbers yet)'}`)
    return status
  }

  function routes(r) {
    r.get('/tendlc', h(async (req, res) => res.json({ ...pub(await col.findOne({ _id: req.webChatId })), usNumbers: await usNumbers(req.webChatId), useCases: USE_CASES, entityTypes: ENTITY, fee: FEE })))
    r.put('/tendlc', h(async (req, res) => {
      const cur = await col.findOne({ _id: req.webChatId })
      if (['submitted', 'approved', 'filed', 'active'].includes(cur?.status)) return res.status(409).json({ error: 'locked', message: 'Your registration is already being processed.' })
      const v = validate(req.body)
      if (v.error) return res.status(400).json({ error: 'invalid', message: v.error })
      if (!(await usNumbers(req.webChatId)).length) return res.status(400).json({ error: 'no_us_numbers', message: 'US texting registration is only needed for US local numbers. Get one first, then register.' })
      // One-off $49 service fee (refunded if we reject it); carrier fees are separate.
      if (!cur?.feePaid && FEE > 0 && !(await w.debit(req.webChatId, FEE))) return res.status(402).json({ error: 'insufficient_balance', message: `The registration service costs $${FEE}. Top up your wallet first.` })
      if (!cur?.feePaid && FEE > 0) await db.collection('transactions').insertOne({ _id: `tendlc-${req.webChatId}-${Date.now()}`, chatId: String(req.webChatId), type: 'tendlc-service', amount: FEE, currency: 'USD', status: 'completed', createdAt: new Date() })
      await col.updateOne({ _id: req.webChatId }, { $set: { ...v, status: 'submitted', submittedAt: new Date(), note: null, feePaid: cur?.feePaid || FEE > 0 } }, { upsert: true })
      notifyAdmin(`📝 New 10DLC registration from web account ${req.webChatId} (${v.brand.companyName || v.brand.lastName}). Admin → Compliance → 10DLC.`)
      res.json(pub(await col.findOne({ _id: req.webChatId })))
    }))
  }

  function adminRoutes(r) {
    const A = adminRequire
    r.get('/admin/tendlc', A, h(async (req, res) => {
      const st = String(req.query.status || 'submitted')
      const docs = await col.find(st === 'all' ? {} : { status: st }).sort({ submittedAt: -1 }).limit(100).toArray()
      const accs = new Map((await db.collection('webAccounts').find({ _id: { $in: docs.map(d => Number(d._id)) } }, { projection: { email: 1 } }).toArray()).map(a => [String(a._id), a.email]))
      res.json({ items: await Promise.all(docs.map(async d => ({ chatId: d._id, email: accs.get(String(d._id)) || null, ...pub(d), usNumbers: await usNumbers(d._id) }))) })
    }))
    r.post('/admin/tendlc/:chatId/decision', A, h(async (req, res) => {
      const chatId = String(req.params.chatId), d = String(req.body?.decision || '')
      const note = s(req.body?.note, 500) || null
      if (d === 'reject') {
        if (!note) return res.status(400).json({ error: 'note_needed', message: 'Say why it was rejected.' })
        const cur = await col.findOne({ _id: chatId })
        if (cur?.feePaid && !['filed', 'active'].includes(cur.status)) {
          await w.credit(chatId, FEE)
          await db.collection('transactions').insertOne({ _id: `tendlc-refund-${chatId}-${Date.now()}`, chatId, type: 'tendlc-refund', amount: -FEE, currency: 'USD', status: 'completed', createdAt: new Date() })
        }
        await col.updateOne({ _id: chatId }, { $set: { status: 'rejected', note, feePaid: false } })
        notify?.push(chatId, `Your US texting registration needs changes: ${note}`, null, { kind: 'billing' }).catch(() => {})
        return res.json({ status: 'rejected' })
      }
      if (d === 'activate' && !['filed', 'approved', 'active'].includes((await col.findOne({ _id: chatId }))?.status)) return res.status(409).json({ error: 'not_filed', message: 'Approve and file it first. Use Mark active again later to add newly bought numbers.' })
      if (d === 'activate') { await col.updateOne({ _id: chatId }, { $set: { status: 'active', activatedAt: new Date(), numbers: await usNumbers(chatId) } }); notify?.push(chatId, 'Your US texting registration is approved. Your US numbers can now send texts.', null, { kind: 'billing' }).catch(() => {}); return res.json({ status: 'active' }) }
      if (d !== 'approve') return res.status(400).json({ error: 'bad_decision', message: 'Use approve, reject or activate.' })
      const cur = await col.findOne({ _id: chatId })
      if (!['submitted', 'failed', 'approved'].includes(cur?.status)) return res.status(409).json({ error: 'not_pending', message: 'This registration is not waiting for approval.' })
      await col.updateOne({ _id: chatId }, { $set: { status: 'approved', approvedAt: new Date(), approvedBy: req.admin?.email || 'admin' } })
      res.json({ status: process.env.WEB_CLOUDIVR_DRY_RUN === 'true' ? (await col.updateOne({ _id: chatId }, { $set: { status: 'filed' }, $push: { filings: { provider: 'preview', status: 'filed', at: new Date() } } }), 'filed') : await file(chatId) })
    }))
  }

  // Filed Infobip campaigns: poll their network status → active.
  async function tick() {
    for (const d of await col.find({ status: 'filed' }).limit(50).toArray()) {
      const ib = (d.filings || []).filter(f => f.provider === 'infobip' && f.status === 'filed' && f.campaignId).pop()
      if (!ib) continue
      try {
        const c = (await require('../infobip').http().get(`/number-registration/1/campaigns/${ib.campaignId}`)).data
        if (/ACTIVE|REGISTERED|APPROVED/i.test(c.stage || c.status || '')) {
          await col.updateOne({ _id: d._id }, { $set: { status: 'active', activatedAt: new Date() } })
          notify?.push(d._id, 'Your US texting registration is approved. Your US numbers can now send texts.', null, { kind: 'billing' }).catch(() => {})
        } else if (/REJECT|DECLIN/i.test(c.stage || c.status || '')) {
          await col.updateOne({ _id: d._id }, { $set: { status: 'rejected', note: (c.campaignFeedback?.rejectionReasons || []).join(' ') || 'The carrier rejected the campaign.' } })
          notifyAdmin(`❌ Infobip rejected 10DLC campaign for web account ${d._id}`)
        }
      } catch (e) { log(`[10DLC] status ${d._id}: ${e.message}`) }
    }
  }

  return { routes, adminRoutes, isActive, tick, needs10dlc, FEE }
}

module.exports = { createTenDlc, needs10dlc, validate }
