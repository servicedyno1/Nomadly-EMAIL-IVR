'use strict'
// Customer compliance: Stripe Identity (photo ID + live selfie) for countries that need ID, company papers approved by an
// admin for business customers, and the usage-policy agreement. One doc per web account in `compliance`.
const Stripe = require('stripe')
const crypto = require('crypto')
const { put, get, MIME, upload } = require('./number-docs')

const POLICY_VERSION = '2026-11'
const stripe = () => new Stripe(process.env.STRIPE_SECRET_KEY)
const IDENTITY_MAP = { verified: 'verified', processing: 'pending', requires_input: 'failed', canceled: 'none' }

function createCompliance({ db, h, adminRequire, notifyAdmin = () => {}, notify, log = console.log }) {
  const col = db.collection('compliance')
  const accounts = db.collection('webAccounts')
  const of = async (chatId) => (await col.findOne({ _id: chatId })) || { _id: chatId }
  const pub = (d) => ({
    identity: { status: d.identity?.status || 'none', verifiedAt: d.identity?.verifiedAt || null, name: d.identity?.name || null, reason: d.identity?.reason || null },
    company: { status: d.company?.status || 'none', files: (d.company?.files || []).map(f => ({ id: f.id, name: f.name, size: f.size, kind: f.kind })), note: d.company?.note || null, submittedAt: d.company?.submittedAt || null },
    policy: { accepted: d.policy?.version === POLICY_VERSION, version: POLICY_VERSION, acceptedAt: d.policy?.acceptedAt || null },
  })
  const state = async (chatId) => pub(await of(chatId))

  // Stripe session → our identity status (idempotent; used by refresh, return page and webhook).
  async function applySession(s) {
    const chatId = Number(s.metadata?.chatId)
    if (!chatId) return null
    const status = IDENTITY_MAP[s.status] || 'pending'
    const vo = s.verified_outputs
    const set = { 'identity.status': status, 'identity.sessionId': s.id, 'identity.updatedAt': new Date(),
      ...(status === 'verified' ? { 'identity.verifiedAt': new Date(), 'identity.name': [vo?.first_name, vo?.last_name].filter(Boolean).join(' ') || null, 'identity.reason': null } : {}),
      ...(status === 'failed' ? { 'identity.reason': s.last_error?.reason || s.last_error?.code || 'The check could not be completed.' } : {}) }
    const prev = await col.findOneAndUpdate({ _id: chatId }, { $set: set }, { upsert: true, returnDocument: 'before' })
    if (status === 'verified' && (prev?.value || prev)?.identity?.status !== 'verified') {
      log(`[Compliance] ${chatId} identity verified (${s.id})`)
      notify?.push(chatId, 'Your ID check passed. You can now buy numbers in countries that need ID.', null, { kind: 'billing' }).catch(() => {})
    }
    return status
  }

  function routes(r) {
    r.get('/compliance', h(async (req, res) => res.json(await state(req.webChatId))))

    r.post('/compliance/policy', h(async (req, res) => {
      if (req.body?.accept !== true) return res.status(400).json({ error: 'not_accepted', message: 'Tick the box to accept the usage policy.' })
      await col.updateOne({ _id: req.webChatId }, { $set: { policy: { version: POLICY_VERSION, acceptedAt: new Date(), ip: req.ip } } }, { upsert: true })
      res.json(await state(req.webChatId))
    }))

    r.post('/compliance/identity', h(async (req, res) => {
      const cur = await of(req.webChatId)
      if (cur.identity?.status === 'verified') return res.json({ status: 'verified' })
      const origin = String(req.headers.origin || process.env.SELF_URL || '').replace(/\/+$/, '')
      const acc = await accounts.findOne({ _id: req.webChatId }, { projection: { email: 1 } })
      const s = await stripe().identity.verificationSessions.create({
        type: 'document',
        options: { document: { require_matching_selfie: true, require_live_capture: true, allowed_types: ['passport', 'driving_license', 'id_card'] } },
        metadata: { chatId: String(req.webChatId) },
        ...(acc?.email ? { provided_details: { email: acc.email } } : {}),
        return_url: `${origin}/cloudivr/app/settings?identity=done`,
      })
      await col.updateOne({ _id: req.webChatId }, { $set: { 'identity.status': 'pending', 'identity.sessionId': s.id, 'identity.startedAt': new Date() } }, { upsert: true })
      res.json({ url: s.url })
    }))

    r.post('/compliance/identity/refresh', h(async (req, res) => {
      const cur = await of(req.webChatId)
      if (cur.identity?.sessionId && cur.identity.status !== 'verified') await applySession(await stripe().identity.verificationSessions.retrieve(cur.identity.sessionId))
      res.json(await state(req.webChatId))
    }))

    // Company papers: registration document + proof of company address (PDF/JPG/PNG).
    r.post('/compliance/company', (req, res, next) => upload.array('files', 4)(req, res, (e) => (e ? res.status(400).json({ error: 'bad_upload', message: e.code === 'LIMIT_FILE_SIZE' ? 'Each file must be 10 MB or less.' : 'Upload up to 4 files (PDF, JPG or PNG).' }) : next())), h(async (req, res) => {
      const files = req.files || []
      const kind = ['registration', 'address'].includes(req.body?.kind) ? req.body.kind : 'registration'
      if (!files.length) return res.status(400).json({ error: 'no_files', message: 'Pick at least one file.' })
      const bad = files.find(f => !MIME[f.mimetype])
      if (bad) return res.status(400).json({ error: 'bad_type', message: `${bad.originalname} is not a PDF, JPG or PNG.` })
      const saved = []
      for (const f of files) {
        const id = crypto.randomUUID()
        const out = await put(`cloudivr/compliance/${req.webChatId}/${id}.${MIME[f.mimetype]}`, f.buffer, f.mimetype)
        saved.push({ id, kind, path: out.path, name: String(f.originalname || 'document').slice(0, 120), type: f.mimetype, size: f.size, at: new Date() })
      }
      await col.updateOne({ _id: req.webChatId }, { $push: { 'company.files': { $each: saved } }, $set: { 'company.status': 'draft', 'company.note': null } }, { upsert: true })
      res.json(await state(req.webChatId))
    }))
    r.delete('/compliance/company/:id', h(async (req, res) => {
      await col.updateOne({ _id: req.webChatId, 'company.status': { $ne: 'approved' } }, { $pull: { 'company.files': { id: req.params.id } }, $set: { 'company.status': 'draft' } })
      res.json(await state(req.webChatId))
    }))
    r.post('/compliance/company/submit', h(async (req, res) => {
      const d = await of(req.webChatId)
      const kinds = new Set((d.company?.files || []).map(f => f.kind))
      if (!kinds.has('registration') || !kinds.has('address')) return res.status(400).json({ error: 'missing_files', message: 'Add both a company registration document and a proof of company address.' })
      await col.updateOne({ _id: req.webChatId }, { $set: { 'company.status': 'submitted', 'company.submittedAt': new Date() } })
      notifyAdmin(`🏢 Company papers submitted for review — web account ${req.webChatId} (${(d.company?.files || []).length} file(s)). Admin → Compliance.`)
      res.json(await state(req.webChatId))
    }))

  }

  function adminRoutes(r) {
    const A = adminRequire
    r.get('/admin/compliance', A, h(async (req, res) => {
      const status = ['submitted', 'approved', 'rejected'].includes(req.query.status) ? req.query.status : 'submitted'
      const docs = await col.find({ 'company.status': status }).sort({ 'company.submittedAt': -1 }).limit(100).toArray()
      const accs = new Map((await accounts.find({ _id: { $in: docs.map(d => d._id) } }, { projection: { email: 1, legalProfile: 1 } }).toArray()).map(a => [a._id, a]))
      res.json({ items: docs.map(d => { const lp = accs.get(d._id)?.legalProfile; return { chatId: d._id, email: accs.get(d._id)?.email || null, business: lp?.companyName || null, registrationNumber: lp?.registrationNumber || null, country: lp?.address?.countryCode || null, ...pub(d) } }) })
    }))
    r.get('/admin/compliance/:chatId/file/:id', A, h(async (req, res) => {
      const d = await of(Number(req.params.chatId))
      const f = (d.company?.files || []).find(x => x.id === req.params.id)
      if (!f) return res.status(404).json({ error: 'not_found', message: 'File not found.' })
      res.set('Content-Type', f.type).set('Content-Disposition', `inline; filename="${f.name.replace(/"/g, '')}"`).send(await get(f.path))
    }))
    r.post('/admin/compliance/:chatId/company', A, h(async (req, res) => {
      const chatId = Number(req.params.chatId)
      const approve = req.body?.decision === 'approve'
      const note = String(req.body?.note || '').slice(0, 500) || null
      if (!approve && !note) return res.status(400).json({ error: 'note_needed', message: 'Say why the papers were rejected.' })
      const u = await col.updateOne({ _id: chatId, 'company.status': 'submitted' }, { $set: { 'company.status': approve ? 'approved' : 'rejected', 'company.note': note, 'company.reviewedAt': new Date(), 'company.reviewedBy': req.admin?.email || 'admin' } })
      if (!u.modifiedCount) return res.status(409).json({ error: 'not_pending', message: 'These papers are not waiting for review.' })
      notify?.push(chatId, approve ? 'Your company papers were approved.' : `Your company papers were not approved: ${note} Upload new papers in Settings → Compliance.`, null, { kind: 'billing' }).catch(() => {})
      log(`[Compliance] company ${chatId} ${approve ? 'approved' : 'rejected'}`)
      res.json({ ok: true })
    }))
  }

  // Stripe webhook (signature-checked, raw body) — keeps identity status current when the customer leaves early.
  async function webhook(req, res) {
    let evt
    try { evt = stripe().webhooks.constructEvent(req.rawBody, req.headers['stripe-signature'], process.env.STRIPE_WEBHOOK_SECRET) } catch (e) { log(`[Compliance] Stripe webhook rejected: ${e.message}`); return res.status(400).send('bad signature') }
    res.json({ received: true })
    if (String(evt.type).startsWith('identity.verification_session.')) await applySession(evt.data.object).catch(e => log(`[Compliance] webhook apply: ${e.message}`))
  }

  // Purchase gates. level 2 (documents) countries: ID check; business customers also need approved company papers.
  async function idIssue(chatId, isBusiness) {
    const d = await of(chatId)
    if (d.identity?.status !== 'verified') return 'This country needs an ID check. Verify your ID in Settings → Compliance first (photo ID and a quick selfie).'
    if (isBusiness && d.company?.status !== 'approved') return d.company?.status === 'submitted' ? 'Your company papers are still being reviewed. You can buy this number once they are approved.' : 'This country needs approved company papers. Upload them in Settings → Compliance.'
    return null
  }
  const policyAccepted = async (chatId) => (await of(chatId)).policy?.version === POLICY_VERSION

  return { routes, adminRoutes, webhook, state, idIssue, policyAccepted, POLICY_VERSION }
}

module.exports = { createCompliance, POLICY_VERSION }
