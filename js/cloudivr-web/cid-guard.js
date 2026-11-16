'use strict'
// Caller-ID guard: prevents financial-institution, government-hotline and emergency numbers from being
// used as custom caller IDs. Uses a hardcoded blocklist for known numbers and Jev (TypeSafe) AI
// classification for unknown ones. Alerts admin via Telegram on blocked attempts.
const axios = require('axios')
const E164_RE = /^\+[1-9]\d{7,14}$/

// ── Known blocked numbers (financial institutions, government, payment processors, emergency) ──────────
const BLOCKED = new Map([
  // US Government
  ['+18008291040', 'IRS'], ['+18006289941', 'IRS'], ['+18008291954', 'IRS'],
  ['+18007721213', 'Social Security Admin'], ['+18007726270', 'Social Security Admin'],
  ['+18772758743', 'FDIC'], ['+18773275342', 'FDIC'],
  ['+18006334227', 'Medicare'], ['+18003755283', 'USCIS'],
  ['+12023243000', 'FBI'], ['+12025142000', 'US Secret Service'],
  ['+12026223800', 'US Treasury'], ['+18665621040', 'FTC'],
  // Major US Banks
  ['+18009359935', 'Chase'], ['+18887458502', 'Chase'], ['+18002474500', 'Chase'],
  ['+18004321000', 'Bank of America'], ['+18003371800', 'Bank of America'],
  ['+18008693557', 'Wells Fargo'], ['+18002756262', 'Wells Fargo'],
  ['+18009504600', 'Citi'], ['+18005893400', 'Citi'],
  ['+18002274825', 'Capital One'], ['+18006558000', 'Capital One'],
  ['+18888425636', 'Navy Federal Credit Union'], ['+18887504438', 'PNC Bank'],
  ['+18004003000', 'TD Bank'], ['+18008720034', 'Ally Bank'],
  ['+18773833520', 'KeyBank'], ['+18776712265', 'SoFi'],
  ['+18004002425', 'Schwab'], ['+18003467575', 'Goldman Sachs'],
  ['+18003218020', 'Morgan Stanley'], ['+18772338723', 'Fidelity'],
  ['+18004440818', 'USAA'], ['+18005312265', 'USAA'],
  ['+18008256262', 'American Express'], ['+18006336262', 'American Express'],
  ['+18002471700', 'Discover'], ['+18003472683', 'Discover'],
  ['+18779376326', 'BMO Harris'], ['+18002752273', 'Apple (Apple Card)'],
  ['+18004213375', 'US Bank'], ['+18008722657', 'US Bank'],
  ['+18003531000', 'Huntington Bank'], ['+18773605142', 'Regions Bank'],
  ['+18004008894', 'Citizens Bank'], ['+18004507600', 'First National Bank'],
  ['+18002355517', 'M&T Bank'],
  // Payment processors / fintech
  ['+18889367354', 'PayPal'], ['+18555907284', 'Zelle'],
  ['+18559667686', 'Venmo'], ['+18884116629', 'Cash App'],
  ['+18882804331', 'Amazon (payments)'], ['+18001234567', 'Generic scam pattern'],
  ['+18557252326', 'Google Pay'], ['+18006108722', 'Coinbase'],
  // Credit bureaus
  ['+18883973742', 'Equifax'], ['+18006851111', 'TransUnion'], ['+18883976622', 'Experian'],
  // UK banks
  ['+443457242424', 'Barclays'], ['+443456002323', 'HSBC UK'],
  ['+443457404404', 'Lloyds'], ['+443450700707', 'NatWest'],
  // Canadian banks
  ['+18007692511', 'RBC'], ['+18006664722', 'TD Canada'],
  ['+18002725678', 'BMO Canada'], ['+18004652422', 'Scotiabank'],
  // European government financial
  ['+442073014500', 'Bank of England'], ['+31206690111', 'DNB Netherlands'],
  // Insurance (commonly spoofed)
  ['+18008720137', 'Blue Cross Blue Shield'],
])

const EMERGENCY = new Set(['911', '112', '999', '000', '110', '119', '933', '1911', '1112', '1999'])
const isEmergency = (raw) => EMERGENCY.has(String(raw || '').replace(/\D/g, ''))

// ── AI classification cache (in-memory + DB) ──────────────────────────────────────────────────────────
const cache = new Map() // number → { allowed, institution, checkedAt }
const CACHE_TTL_MS = 24 * 3600000 // 24 hours
let _db = null, _notifyAdmin = null, _log = console.log

function init(db, { notifyAdmin, log = console.log } = {}) {
  _db = db
  _notifyAdmin = notifyAdmin
  _log = log
}

function normalize(raw) {
  return String(raw || '').replace(/[\s()-]/g, '')
}

// ── Core check: returns { allowed: boolean, reason?: string, institution?: string } ───────────────────
async function check(number, { chatId, channel = 'web' } = {}) {
  const n = normalize(number)
  if (!E164_RE.test(n)) return { allowed: false, reason: 'Invalid phone number format.' }
  if (isEmergency(n) || isEmergency(n.replace(/^\+\d{1,3}/, ''))) {
    await alertAdmin(n, 'Emergency number', chatId, channel)
    return { allowed: false, reason: 'Emergency numbers cannot be used as caller ID.', institution: 'Emergency services' }
  }
  // Check hardcoded blocklist
  if (BLOCKED.has(n)) {
    const name = BLOCKED.get(n)
    await alertAdmin(n, name, chatId, channel)
    return { allowed: false, reason: `This number belongs to ${name} and cannot be used as caller ID.`, institution: name }
  }
  // Check memory cache
  const cached = cache.get(n)
  if (cached && Date.now() - cached.checkedAt < CACHE_TTL_MS) {
    if (!cached.allowed) await alertAdmin(n, cached.institution, chatId, channel)
    return cached
  }
  // Check DB cache
  if (_db) {
    const dbCached = await _db.collection('cidGuardCache').findOne({ _id: n }).catch(() => null)
    if (dbCached && Date.now() - new Date(dbCached.checkedAt).getTime() < CACHE_TTL_MS) {
      const result = { allowed: dbCached.allowed, reason: dbCached.reason || undefined, institution: dbCached.institution || undefined, checkedAt: new Date(dbCached.checkedAt).getTime() }
      cache.set(n, result)
      if (!result.allowed) await alertAdmin(n, result.institution, chatId, channel)
      return result
    }
  }
  // AI classification via Jev
  const result = await classifyWithJev(n)
  cache.set(n, result)
  // Persist to DB
  if (_db) {
    _db.collection('cidGuardCache').replaceOne({ _id: n }, { _id: n, ...result, checkedAt: new Date(result.checkedAt) }, { upsert: true }).catch(() => {})
  }
  if (!result.allowed) await alertAdmin(n, result.institution, chatId, channel)
  return result
}

// ── Jev (TypeSafe) AI classification ──────────────────────────────────────────────────────────────────
async function classifyWithJev(number) {
  const proxyUrl = (process.env.INTEGRATION_PROXY_URL || process.env.integration_proxy_url || 'https://integrations.emergentagent.com').replace(/\/$/, '')
  const key = process.env.EMERGENT_LLM_KEY
  if (!key) {
    _log('[CID-Guard] EMERGENT_LLM_KEY not set — allowing number (no AI check)')
    return { allowed: true, checkedAt: Date.now() }
  }
  try {
    const { data } = await axios.post(`${proxyUrl}/llm/typesafe/v1/systemone`, {
      model: 'jev-latest',
      state: `Phone number: ${number}. Is this a phone number belonging to a financial institution (bank, credit union, insurance company, payment processor), government agency (IRS, SSA, FBI, treasury, tax authority), or credit bureau? Consider the area code, exchange, and whether this number format is commonly associated with institutional phone lines vs personal/business lines.`,
      questions: {
        is_institution: { type: 'noul', instructions: 'Is this phone number likely belonging to a financial institution, government financial agency, or credit bureau?' },
        category: { type: 'choice', instructions: 'What category best fits this number?', criteria: {
          bank: 'A bank, credit union, or savings institution',
          government: 'A government agency (IRS, SSA, treasury, tax authority, law enforcement)',
          payment: 'A payment processor, fintech company, or digital wallet',
          insurance: 'An insurance company or health plan',
          credit_bureau: 'A credit reporting agency',
          personal_business: 'A regular personal or business number'
        } },
      },
    }, {
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      timeout: 8000,
    })
    const yes = data.answers?.is_institution?.noul ?? 0
    const cat = data.answers?.category?.choice ?? 'personal_business'
    // High threshold: only block if AI is very confident (>0.75)
    const isInstitution = yes > 0.75 && cat !== 'personal_business'
    const catLabel = { bank: 'Financial institution', government: 'Government agency', payment: 'Payment processor', insurance: 'Insurance company', credit_bureau: 'Credit bureau' }[cat] || null
    if (isInstitution) {
      return { allowed: false, reason: `This number appears to belong to a ${catLabel?.toLowerCase() || 'institution'} and cannot be used as caller ID.`, institution: catLabel, confidence: yes, checkedAt: Date.now() }
    }
    return { allowed: true, confidence: yes, checkedAt: Date.now() }
  } catch (e) {
    _log(`[CID-Guard] Jev classification failed for ${number}: ${e.message} — allowing (fail-open)`)
    return { allowed: true, checkedAt: Date.now() }
  }
}

// ── Admin alert via Telegram ──────────────────────────────────────────────────────────────────────────
const recentAlerts = new Map()
async function alertAdmin(number, institution, chatId, channel) {
  const key = `${number}:${chatId || 'anon'}`
  if (recentAlerts.has(key) && Date.now() - recentAlerts.get(key) < 3600000) return // 1 alert per number+account per hour
  recentAlerts.set(key, Date.now())
  // Prune old entries
  for (const [k, t] of recentAlerts) if (Date.now() - t > 7200000) recentAlerts.delete(k)
  const msg = `🚫 [CID-Guard] Blocked caller ID attempt\nNumber: ${number}\nInstitution: ${institution || 'Unknown'}\nAccount: ${chatId || 'anonymous'}\nChannel: ${channel || 'web'}\nTime: ${new Date().toISOString()}`
  _log(msg.replace(/\n/g, ' | '))
  if (_notifyAdmin) {
    try { await _notifyAdmin(msg) } catch (e) { _log(`[CID-Guard] Admin alert failed: ${e.message}`) }
  }
}

// ── Admin API: view/manage blocklist ──────────────────────────────────────────────────────────────────
function adminApi(router, h, adminRequire) {
  router.get('/admin/cid-guard/blocklist', adminRequire, h(async (req, res) => {
    const items = [...BLOCKED.entries()].map(([number, name]) => ({ number, name, source: 'hardcoded' }))
    // Also include AI-detected blocked numbers from DB
    if (_db) {
      const aiBlocked = await _db.collection('cidGuardCache').find({ allowed: false }).sort({ checkedAt: -1 }).limit(100).toArray()
      for (const d of aiBlocked) if (!BLOCKED.has(d._id)) items.push({ number: d._id, name: d.institution || 'AI-detected', source: 'ai', confidence: d.confidence, checkedAt: d.checkedAt })
    }
    res.json({ items, count: items.length })
  }))
  router.get('/admin/cid-guard/attempts', adminRequire, h(async (req, res) => {
    if (!_db) return res.json({ items: [] })
    const items = await _db.collection('cidGuardAttempts').find().sort({ at: -1 }).limit(100).toArray()
    res.json({ items })
  }))
  // Manually add a number to the blocklist in DB (persisted alongside the hardcoded list)
  router.post('/admin/cid-guard/block', adminRequire, h(async (req, res) => {
    const number = normalize(req.body.number), name = String(req.body.name || 'Admin-blocked').slice(0, 60)
    if (!E164_RE.test(number)) return res.status(400).json({ error: 'invalid_number' })
    BLOCKED.set(number, name)
    if (_db) await _db.collection('cidGuardCustomBlocks').replaceOne({ _id: number }, { _id: number, name, addedBy: req.admin?.email || 'admin', at: new Date() }, { upsert: true })
    cache.delete(number) // Clear any cached "allowed" result
    res.json({ blocked: true, number, name })
  }))
  router.delete('/admin/cid-guard/block/:number', adminRequire, h(async (req, res) => {
    const number = normalize(req.params.number)
    // Can only unblock custom-added, not hardcoded
    if (_db) await _db.collection('cidGuardCustomBlocks').deleteOne({ _id: number })
    cache.delete(number)
    res.json({ ok: true })
  }))
}

// Load custom blocks from DB on startup
async function loadCustomBlocks() {
  if (!_db) return
  try {
    const customs = await _db.collection('cidGuardCustomBlocks').find().toArray()
    for (const d of customs) BLOCKED.set(d._id, d.name)
    if (customs.length) _log(`[CID-Guard] Loaded ${customs.length} custom blocklist entries`)
  } catch (_) {}
  // Create indexes
  _db.collection('cidGuardCache').createIndex({ checkedAt: 1 }, { expireAfterSeconds: 7 * 86400 }).catch(() => {})
  _db.collection('cidGuardAttempts').createIndex({ at: 1 }, { expireAfterSeconds: 90 * 86400 }).catch(() => {})
}

// Log attempt to DB for audit trail
async function logAttempt(number, result, chatId, channel) {
  if (!_db) return
  _db.collection('cidGuardAttempts').insertOne({
    number, allowed: result.allowed, institution: result.institution || null,
    chatId: chatId ? String(chatId) : null, channel, at: new Date(),
  }).catch(() => {})
}

// Public convenience: check + log in one call
async function guard(number, { chatId, channel = 'web' } = {}) {
  const result = await check(number, { chatId, channel })
  await logAttempt(number, result, chatId, channel)
  return result
}

module.exports = { init, check, guard, normalize, isEmergency, BLOCKED, adminApi, loadCustomBlocks }
