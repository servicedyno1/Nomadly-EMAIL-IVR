'use strict'
// Journey events for performance + marketing (signup source, chosen service, buying steps, drop-offs).
// Public route; the account id is attached when signed in. Names are whitelisted; props are trimmed.
const NAMES = new Set(['page_view', 'signup_started', 'signup_done', 'purpose_picked', 'purpose_skipped', 'buy_viewed', 'search', 'checkout_started', 'paid', 'checkout_failed', 'intl_texting_country', 'travel_esim_zone', 'travel_esim_paid', 'lookup_done', 'upgrade_viewed'])
const clean = (o) => Object.fromEntries(Object.entries(o && typeof o === 'object' ? o : {}).slice(0, 12).map(([k, v]) => [String(k).slice(0, 40), typeof v === 'number' || typeof v === 'boolean' ? v : String(v ?? '').slice(0, 300)]))

function createJourney({ db, h, accountOf }) {
  const col = db.collection('webEvents')
  col.createIndex({ at: 1 }, { expireAfterSeconds: 180 * 86400 }).catch(() => {}) // kept 180 days
  const hits = new Map()
  const limited = (ip) => { const now = Date.now(), x = hits.get(ip) || { at: now, n: 0 }; if (now - x.at > 60000) { x.at = now; x.n = 0 } x.n += 1; hits.set(ip, x); if (hits.size > 5000) hits.clear(); return x.n > 120 }
  col.createIndex({ chatId: 1, at: -1 }).catch(() => {})
  function routes(r) {
    r.post('/events', h(async (req, res) => {
      if (limited(String(req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim())) return res.status(429).json({ error: 'rate_limited' })
      const name = String(req.body?.name || '')
      if (!NAMES.has(name)) return res.status(400).json({ error: 'unknown_event' })
      const chatId = (await accountOf(req).catch(() => null)) || null
      await col.insertOne({ name, props: clean(req.body?.props), chatId: chatId ? String(chatId) : null, anon: String(req.body?.anon || '').slice(0, 40) || null, path: String(req.body?.path || '').slice(0, 200), ua: String(req.headers['user-agent'] || '').slice(0, 200), at: new Date() })
      res.json({ ok: true })
    }))
  }
  return { routes }
}
const sourceOf = (s) => clean(['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid', 'fbclid', 'ref', 'referrer', 'landing'].reduce((o, k) => (s && s[k] ? { ...o, [k]: s[k] } : o), {}))

module.exports = { createJourney, sourceOf }
