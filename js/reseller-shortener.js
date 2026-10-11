// ============================================================
// Reseller API · URL Shortener  (js/reseller-shortener.js)
// ------------------------------------------------------------
// Exposes the app's existing self-hosted URL shortener through the reseller API.
// A reseller can:
//   • activate a domain as a shortener — by BUYING it (billed, reuses the domain
//     register flow), CONNECTING an existing on-app domain (free, auto CNAME+TXT
//     via Cloudflare), or CONNECTING an EXTERNAL domain (free; we return the CNAME
//     target + TXT record to add at their own DNS host, then they call /verify).
//   • create / list / inspect (+click analytics) / expire / enable-disable / delete
//     short links on their own activated domains.
//
// Reuses — no new infra:
//   fullUrlOf {_id:key, val:longUrl}   ← the redirect handler (app.get('/:id')) reads this
//   linksOf   {_id:owner, [key]:url}   ← per-owner link list (same doc the bot writes)
//   clicksOn  {_id:key, val:count}     ← per-link clicks (incremented on every redirect)
//   expiryOf  {_id:key, val:ms}        ← isValid() honours this → expired/disabled links 404
//   shortenerActivations {_id:domain}  ← activation state machine (shortener-activation-persistence.js)
//   shortenerLinks {_id:key}           ← API-only metadata (owner, alias, disabled, expiresAt)
// key = (`${domain}/${slug}`).replaceAll('.', '@')   e.g. go.mysite.com/abc → go@mysite@com/abc
// ============================================================
'use strict'

const { get, set, del } = require('./db')
const { customAlphabet } = require('nanoid')
const shortenerPersist = require('./shortener-activation-persistence')
const rlSaveDomain = require('./rl-save-domain-in-server')
const domainService = require('./domain-service')
const safeBrowsing = require('./safe-browsing-service')          // realtime on-demand Google Safe Browsing check
const sbMonitor = require('./safe-browsing-monitor')             // shared liveCheck + stored flag state
// Verification helper: accepts BOTH a DNS-only (grey-cloud) record AND a
// Cloudflare-proxied (orange-cloud) record. See js/shortener-verify.js.
// zoneCandidates yields [host, parent, …] (never the bare TLD) for subdomain support.
const { dnsPointsTo, zoneCandidates } = require('./shortener-verify')

const slugGen = customAlphabet('abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', 7)

const sanitize = (s) => String(s).replaceAll('.', '@')
const unsanitize = (s) => String(s).replaceAll('@', '.')
const keyOf = (domain, slug) => sanitize(`${String(domain).toLowerCase()}/${slug}`)
const domainOk = (d) => /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(String(d || '').trim())
const aliasOk = (a) => /^[A-Za-z0-9_-]{1,64}$/.test(String(a || ''))
const urlOk = (u) => /^https?:\/\/[^\s]+\.[^\s]+/i.test(String(u || '')) && String(u).length <= 2048
// Slugs that would be shadowed by the SPA / system routes in app.get('/:id').
const RESERVED = new Set(['stats', 'call', 'panel', 'phone', 'login', 'signup', 'dashboard', 'settings', 'sales', 'api', 'apidoc', 'health', 'reseller', 'telnyx', 'twilio', 'dynopay', 'crypto-wallet', 'webhook', 'favicon.ico', 'robots.txt'])

// Statuses at which a domain accepts short links. 'host_linked' is the current
// value; 'railway_linked' is kept for legacy records (same meaning).
const ACTIVE_STATUSES = ['host_linked', 'railway_linked', 'dns_added', 'completed']

function registerShortenerRoutes({ router, apiKeyAuth, h, col, getDb, isLive, mode, log, billedProvision }) {
  const owner = (req) => String(req.reseller.ownerChatId)

  // Does the owner own this domain (or its parent registrable domain) in the
  // bot's ownership map? A subdomain (go.namewords.sbs) counts as owned when the
  // owner holds the parent zone (namewords.sbs) already on our platform.
  async function ownsDomain(ownerId, domain) {
    const d = String(domain).toLowerCase()
    const byMap = await col('domainsOf').findOne({ _id: String(ownerId) })
    for (const cand of zoneCandidates(d)) {
      if (byMap && byMap[sanitize(cand)] === true) return true
      const byDoc = await col('domainsOf').findOne({ chatId: String(ownerId), domainName: cand })
      if (byDoc) return true
    }
    return false
  }

  // Fetch (and owner-scope) a domain's activation record.
  async function getActivation(ownerId, domain) {
    const act = await col('shortenerActivations').findOne({ _id: String(domain).toLowerCase() })
    if (!act) return null
    if (String(act.chatId) !== String(ownerId)) return null
    return act
  }

  // Full app-managed activation chain (Cloudflare → Railway custom-domain → CNAME+TXT).
  // LIVE only (mutates DNS + registers a custom domain on the host).
  async function activateAppManaged(ownerId, domain) {
    await shortenerPersist.createActivationTask(ownerId, domain, 'en')
    try { await domainService.ensureCloudflare(domain, getDb()) } catch (e) { log(`[Shortener] ensureCloudflare warn ${domain}: ${e.message}`) }
    const saved = process.env.HOSTED_ON === 'render'
      ? await rlSaveDomain.saveDomainInServerRender(domain)
      : await rlSaveDomain.saveShortenerHost(domain)
    if (!saved || saved.error) {
      await shortenerPersist.markFailed(domain, saved?.error || 'host_link_failed')
      return { success: false, error: saved?.error || 'Could not link the domain to the shortener host.' }
    }
    await shortenerPersist.markHostLinked(domain, saved.server, saved.recordType)
    const addRes = await domainService.addShortenerCNAME(domain, saved.server, getDb(), saved.txtHost, saved.txtValue)
    if (!addRes || addRes.error || !addRes.success) {
      await shortenerPersist.markFailed(domain, addRes?.error || 'dns_add_failed')
      return { success: false, error: addRes?.error || 'DNS record could not be added.', cname_target: saved.server }
    }
    await shortenerPersist.markDnsAdded(domain)
    await shortenerPersist.markCompleted(domain)
    return { success: true, status: 'completed', cname_target: saved.server, record_type: saved.recordType || 'CNAME' }
  }

  // External activation: register the custom domain on the host to obtain the CNAME target
  // + TXT verification, persist a pending task, and hand the records back to the reseller.
  async function activateExternal(ownerId, domain) {
    await shortenerPersist.createActivationTask(ownerId, domain, 'en')
    const saved = process.env.HOSTED_ON === 'render'
      ? await rlSaveDomain.saveDomainInServerRender(domain)
      : await rlSaveDomain.saveShortenerHost(domain)
    if (!saved || saved.error) {
      await shortenerPersist.markFailed(domain, saved?.error || 'host_link_failed')
      return { success: false, error: saved?.error || 'Could not prepare the shortener host for this domain.' }
    }
    await shortenerPersist.markHostLinked(domain, saved.server, saved.recordType)
    return {
      success: true, status: 'pending_dns',
      dns_records: [
        { type: saved.recordType || 'CNAME', host: domain, value: saved.server },
        ...(saved.txtHost ? [{ type: 'TXT', host: saved.txtHost, value: saved.txtValue }] : []),
      ],
    }
  }

  // Shape a single link for API responses.
  async function linkView(ownerId, key, url) {
    const [domainPart, ...rest] = key.split('/')
    const domain = unsanitize(domainPart)
    const slug = rest.join('/')
    const clicks = (await get(col('clicksOn'), key)) || 0
    const expiryMs = await get(col('expiryOf'), key)
    const meta = await col('shortenerLinks').findOne({ _id: key }).catch(() => null)
    const disabled = !!(meta && meta.disabled)
    const expired = typeof expiryMs === 'number' && !disabled && expiryMs <= Date.now()
    return {
      short_url: `https://${domain}/${slug}`,
      domain, slug,
      url,
      clicks: Number(clicks) || 0,
      status: disabled ? 'disabled' : (expired ? 'expired' : 'active'),
      expires_at: (!disabled && typeof expiryMs === 'number') ? new Date(expiryMs).toISOString() : null,
      created_at: meta?.createdAt ? new Date(meta.createdAt).toISOString() : null,
    }
  }

  // Recompute expiryOf from metadata so the (untouched) redirect handler honours disable+expiry.
  //   disabled      → expiryOf = 1 (past)  → isValid() false → 404
  //   future expiry → expiryOf = ms        → valid until then
  //   neither       → delete expiryOf      → always valid
  async function applyValidity(key, { disabled, expiresAtMs }) {
    if (disabled) { await set(col('expiryOf'), key, 1); return }
    if (typeof expiresAtMs === 'number' && expiresAtMs > 0) { await set(col('expiryOf'), key, expiresAtMs); return }
    await del(col('expiryOf'), key)
  }

  // ════════════════════════════════════════════════════════
  // SHORTENER · DOMAINS
  // ════════════════════════════════════════════════════════

  // Activate a domain as a shortener. source = buy | existing | external
  router.post('/shortener/domains', apiKeyAuth, h(async (req, res) => {
    const domain = String(req.body?.domain || '').trim().toLowerCase()
    const source = String(req.body?.source || '').trim().toLowerCase()
    if (!domainOk(domain)) return res.status(400).json({ error: 'invalid_domain', message: 'Provide a valid domain in body: { "domain": "go.mysite.com", "source": "buy|existing|external" }' })
    if (!['buy', 'existing', 'external'].includes(source)) return res.status(400).json({ error: 'invalid_source', message: 'source must be one of: buy, existing, external.' })

    // Reject domains Google Safe Browsing currently flags — do not activate them as a shortener.
    const sbGate = await sbMonitor.assertAddable(domain)
    if (!sbGate.allowed) return res.status(sbGate.status || 422).json({ error: sbGate.error, message: sbGate.message, threats: sbGate.threats })

    // ── BUY: register (billed) then activate, in one order ──
    if (source === 'buy') {
      const priceInfo = await domainService.checkDomainPrice(domain, getDb())
      if (!priceInfo.available) return res.status(409).json({ error: 'domain_unavailable', message: priceInfo.message || 'That domain is not available to register.' })
      const registrar = priceInfo.registrar || 'ConnectReseller'
      return billedProvision(req, res, {
        product: 'shortener', action: 'buy_domain', priceUsd: Number(priceInfo.price),
        request: { domain, registrar, source },
        provision: async () => {
          const r = await domainService.registerDomain(domain, registrar, 'cloudflare', getDb(), owner(req), null)
          if (r && r.success === false) return { success: false, error: r.error || r.message }
          try { await col('domainsOf').updateOne({ _id: owner(req) }, { $set: { [sanitize(domain)]: true } }, { upsert: true }) } catch (_) {}
          const act = await activateAppManaged(owner(req), domain)
          if (!act.success) return { success: false, error: `Domain registered, but shortener activation failed: ${act.error}` }
          return { success: true, domain, registrar, shortener: act }
        },
      })
    }

    // ── EXISTING / EXTERNAL: free, not billed ──
    if (source === 'existing' && !(await ownsDomain(owner(req), domain))) {
      return res.status(404).json({ error: 'not_found', message: 'That domain is not registered under your account. Use source:"external" to connect a domain hosted elsewhere, or source:"buy" to register it.' })
    }

    if (!isLive()) {
      return res.json({
        mode: 'dry_run', domain, source,
        note: 'Dry-run: no DNS / host change was made. On a live pod this activates the shortener' + (source === 'external' ? ' and returns the exact CNAME + TXT records to add at your DNS host.' : ' automatically.'),
        would_activate: true,
      })
    }

    const result = source === 'external' ? await activateExternal(owner(req), domain) : await activateAppManaged(owner(req), domain)
    if (!result.success) return res.status(502).json({ error: 'activation_failed', message: result.error, detail: result })
    return res.json({ mode: 'live', domain, source, ...result })
  }))

  // List the owner's shortener domains + status.
  // `active: true` (status is host_linked | dns_added | completed; legacy railway_linked also
  // counts) means the domain accepts POST /shortener/links. `completed` is the fully-verified state.
  router.get('/shortener/domains', apiKeyAuth, h(async (req, res) => {
    const docs = await col('shortenerActivations').find({ chatId: owner(req) }).limit(500).toArray()
    res.json({
      domains: docs.map(d => ({
        domain: d.domain || d._id,
        status: d.status || 'unknown',
        active: ACTIVE_STATUSES.includes(d.status),
        cname_target: d.server || null,
        record_type: d.recordType || null,
        activated_at: d.completedAt ? new Date(d.completedAt).toISOString() : null,
        updated_at: d.updatedAt ? new Date(d.updatedAt).toISOString() : null,
        error: d.error || null,
      })),
      active_statuses: ACTIVE_STATUSES,
      mode: mode(),
    })
  }))

  // ── Realtime Google Safe Browsing (shortener domains) ───────────────────────
  // LIVE check (bypasses the 30-min cache) for the reseller's shortener domains.
  // Read-only: reports status only; the background monitor handles enforcement.
  // GET /shortener/safe-browsing            → all of your activated shortener domains
  router.get('/shortener/safe-browsing', apiKeyAuth, h(async (req, res) => {
    if (!safeBrowsing.isConfigured()) return res.status(503).json({ error: 'safe_browsing_unconfigured', message: 'Google Safe Browsing is not configured on this server.' })
    const docs = await col('shortenerActivations').find({ chatId: owner(req) }).limit(500).toArray()
    const domains = docs.filter(d => ACTIVE_STATUSES.includes(d.status)).map(d => d.domain || d._id)
    const results = await sbMonitor.liveCheck(getDb(), domains)
    res.json({ product: 'shortener', count: results.length, checked_at: new Date().toISOString(), realtime: true, configured: true, flagged_count: results.filter(r => r.flagged).length, results })
  }))

  // GET /shortener/domains/:domain/safe-browsing → one activated shortener domain
  router.get('/shortener/domains/:domain/safe-browsing', apiKeyAuth, h(async (req, res) => {
    const domain = String(req.params.domain || '').trim().toLowerCase()
    if (!domainOk(domain)) return res.status(400).json({ error: 'invalid_domain' })
    const act = await col('shortenerActivations').findOne({ _id: domain, chatId: owner(req) })
    if (!act) return res.status(404).json({ error: 'not_found', message: `${domain} is not an activated shortener domain on your account.` })
    if (!safeBrowsing.isConfigured()) return res.status(503).json({ error: 'safe_browsing_unconfigured', message: 'Google Safe Browsing is not configured on this server.' })
    const results = await sbMonitor.liveCheck(getDb(), [domain])
    res.json({ product: 'shortener', domain, status: act.status || 'unknown', active: ACTIVE_STATUSES.includes(act.status), checked_at: new Date().toISOString(), realtime: true, configured: true, flagged_count: results.filter(r => r.flagged).length, results })
  }))

  // Re-check DNS for an external domain and finalise activation.
  router.post('/shortener/domains/:domain/verify', apiKeyAuth, h(async (req, res) => {
    const domain = String(req.params.domain || '').trim().toLowerCase()
    if (!domainOk(domain)) return res.status(400).json({ error: 'invalid_domain' })
    const act = await getActivation(owner(req), domain)
    if (!act) return res.status(404).json({ error: 'not_found', message: 'No shortener activation found for that domain under your account.' })
    if (act.status === 'completed') return res.json({ domain, status: 'completed', verified: true, message: 'Already active.' })
    if (!act.server) return res.status(409).json({ error: 'not_ready', message: 'Activation has no DNS target yet — re-run POST /shortener/domains with source:"external".' })

    if (!isLive()) {
      return res.json({ mode: 'dry_run', domain, status: act.status, verified: false, expected: { type: act.recordType || 'CNAME', host: domain, value: act.server }, note: 'Dry-run: DNS is not actually probed on a sandbox pod.' })
    }
    const ok = await dnsPointsTo(domain, act.server)
    if (!ok) {
      const isIp = /^\d{1,3}(\.\d{1,3}){3}$/.test(String(act.server || ''))
      return res.status(409).json({
        domain, verified: false, status: act.status,
        message: `DNS for ${domain} is not pointing at ${act.server} yet. Create ${isIp ? 'an A' : 'a CNAME'} record ${isIp ? `(${domain} → ${act.server})` : `(${domain} → ${act.server})`} and retry. If the record is on our Cloudflare nameservers it verifies whether it is DNS-only or proxied (orange-cloud); DNS propagation can take up to 24h.`,
        expected: { type: act.recordType || (isIp ? 'A' : 'CNAME'), host: domain, value: act.server, proxied_ok: true },
      })
    }
    await shortenerPersist.markDnsAdded(domain)
    await shortenerPersist.markCompleted(domain)
    res.json({ domain, verified: true, status: 'completed', message: `${domain} is now active as a URL shortener.` })
  }))

  // Deactivate a shortener domain (free). Removes the shortener CNAME when we manage its DNS.
  router.delete('/shortener/domains/:domain', apiKeyAuth, h(async (req, res) => {
    const domain = String(req.params.domain || '').trim().toLowerCase()
    if (!domainOk(domain)) return res.status(400).json({ error: 'invalid_domain' })
    const act = await getActivation(owner(req), domain)
    if (!act) return res.status(404).json({ error: 'not_found', message: 'No shortener activation found for that domain under your account.' })

    if (isLive()) {
      try {
        const dnsResult = await domainService.viewDNSRecords(domain, getDb()).catch(() => null)
        const records = dnsResult?.records || []
        const shortenerRec = records.find(r => rlSaveDomain.isShortenerDnsRecord(r))
        if (shortenerRec) await domainService.deleteDNSRecord(domain, shortenerRec, getDb())
      } catch (e) { log(`[Shortener] deactivate DNS cleanup warn ${domain}: ${e.message}`) }
    }
    await col('shortenerActivations').updateOne({ _id: domain }, { $set: { status: 'deactivated', updatedAt: new Date() } })
    res.json({ domain, deactivated: true, mode: mode(), note: 'The domain will no longer serve short links. Existing links are kept but will not resolve until you re-activate.' })
  }))

  // ════════════════════════════════════════════════════════
  // SHORTENER · LINKS
  // ════════════════════════════════════════════════════════

  // Create a short link on one of your activated domains.
  router.post('/shortener/links', apiKeyAuth, h(async (req, res) => {
    const domain = String(req.body?.domain || '').trim().toLowerCase()
    const url = String(req.body?.url || '').trim()
    const alias = req.body?.alias != null ? String(req.body.alias).trim() : null
    const expiresInDays = req.body?.expires_in_days != null ? Number(req.body.expires_in_days) : null
    if (!domainOk(domain)) return res.status(400).json({ error: 'invalid_domain', message: 'Provide { "domain": "go.mysite.com" }.' })
    if (!urlOk(url)) return res.status(400).json({ error: 'invalid_url', message: 'Provide a valid http(s) target URL in { "url": "https://…" }.' })
    if (alias != null && !aliasOk(alias)) return res.status(400).json({ error: 'invalid_alias', message: 'alias may contain only letters, numbers, hyphen and underscore (max 64 chars).' })
    if (alias && RESERVED.has(alias.toLowerCase())) return res.status(409).json({ error: 'reserved_alias', message: `"${alias}" is a reserved word and cannot be used as a short code.` })
    if (expiresInDays != null && (!Number.isFinite(expiresInDays) || expiresInDays <= 0 || expiresInDays > 3650)) return res.status(400).json({ error: 'invalid_expiry', message: 'expires_in_days must be a positive number of days (max 3650).' })

    const act = await getActivation(owner(req), domain)
    if (!act || !ACTIVE_STATUSES.includes(act.status)) {
      return res.status(409).json({ error: 'domain_not_activated', message: 'Activate this domain as a shortener first: POST /shortener/domains { domain, source }.' })
    }

    let slug = alias || slugGen()
    let key = keyOf(domain, slug)
    if (alias) {
      if (await get(col('fullUrlOf'), key)) return res.status(409).json({ error: 'alias_taken', message: `${domain}/${alias} already exists. Choose a different alias.` })
    } else {
      // random: retry a few times on the astronomically-rare collision
      let tries = 0
      while (await get(col('fullUrlOf'), key)) {
        if (++tries > 5) return res.status(500).json({ error: 'slug_generation_failed', message: 'Could not generate a free short code, please retry.' })
        slug = slugGen(); key = keyOf(domain, slug)
      }
    }

    const expiresAtMs = expiresInDays ? Date.now() + Math.round(expiresInDays * 86400000) : null
    await set(col('fullUrlOf'), key, url)
    await set(col('linksOf'), owner(req), key, url)
    await col('totalShortLinks').updateOne({ _id: 'total' }, { $inc: { val: 1 } }, { upsert: true })
    await col('shortenerLinks').updateOne(
      { _id: key },
      { $set: { ownerChatId: owner(req), domain, slug, longUrl: url, alias: alias || null, expiresAt: expiresAtMs, disabled: false, createdAt: new Date(), updatedAt: new Date() } },
      { upsert: true },
    )
    if (expiresAtMs) await applyValidity(key, { disabled: false, expiresAtMs })

    res.status(201).json({ created: true, ...(await linkView(owner(req), key, url)) })
  }))

  // List your short links (optionally filter by domain).
  router.get('/shortener/links', apiKeyAuth, h(async (req, res) => {
    const filterDomain = req.query.domain ? String(req.query.domain).trim().toLowerCase() : null
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 200, 1), 1000)
    const doc = await get(col('linksOf'), owner(req))
    const keys = doc ? Object.keys(doc).filter(k => k !== '_id') : []
    // Owner-scope to the owner's own activated shortener domains.
    const acts = await col('shortenerActivations').find({ chatId: owner(req) }).toArray()
    const myDomains = new Set(acts.map(a => String(a.domain || a._id).toLowerCase()))
    const out = []
    for (const key of keys) {
      const domain = unsanitize(key.split('/')[0])
      if (!myDomains.has(domain)) continue
      if (filterDomain && domain !== filterDomain) continue
      out.push(await linkView(owner(req), key, doc[key]))
      if (out.length >= limit) break
    }
    res.json({ links: out, count: out.length })
  }))

  // ════════════════════════════════════════════════════════
  // SHORTENER · ANALYTICS · SMART ROUTING · QR
  // ════════════════════════════════════════════════════════
  const analytics = require('./reseller-shortener-analytics')

  // A link the caller owns (listed under their account) → { key, url } or null.
  async function ownedLink(req, domain, slug) {
    const key = keyOf(domain, slug)
    const url = await get(col('fullUrlOf'), key)
    const inList = (await get(col('linksOf'), owner(req)))?.[key]
    return url && inList ? { key, url } : null
  }

  // Resolve the set of (slug→key) the owner has for a domain (or all their domains).
  async function ownedKeys(ownerId, filterDomain) {
    const doc = await get(col('linksOf'), ownerId)
    const keys = doc ? Object.keys(doc).filter(k => k !== '_id') : []
    const acts = await col('shortenerActivations').find({ chatId: ownerId }).toArray()
    const myDomains = new Set(acts.map(a => String(a.domain || a._id).toLowerCase()))
    return keys.filter(k => {
      const d = unsanitize(k.split('/')[0])
      if (!myDomains.has(d)) return false
      if (filterDomain && d !== filterDomain) return false
      return true
    })
  }

  const sinceFrom = (q) => {
    if (q.since) { const d = new Date(String(q.since)); if (!isNaN(d.getTime())) return d }
    const days = parseInt(q.days, 10)
    if (Number.isFinite(days) && days > 0) return new Date(Date.now() - Math.min(days, 90) * 86400000)
    return new Date(Date.now() - 30 * 86400000)
  }

  // Bulk analytics for ALL your links in one call (optionally ?domain= / ?since= / ?days= / ?limit=).
  // Registered before GET /shortener/links/:slug so "stats" is never read as a slug.
  router.get('/shortener/links/stats', apiKeyAuth, h(async (req, res) => {
    const filterDomain = req.query.domain ? String(req.query.domain).trim().toLowerCase() : null
    if (filterDomain && !domainOk(filterDomain)) return res.status(400).json({ error: 'invalid_domain' })
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 500, 1), 2000)
    const since = sinceFrom(req.query)
    const keys = (await ownedKeys(owner(req), filterDomain)).slice(0, limit)
    const stats = await analytics.statsForKeys(getDb(), keys, since)
    const links = keys.map(key => {
      const [domainPart, ...rest] = key.split('/')
      const domain = unsanitize(domainPart)
      const s = stats[key] || { total: 0, by_day: [], by_country: [], by_device: [], by_referrer: [] }
      return { domain, slug: rest.join('/'), short_url: `https://${domain}/${rest.join('/')}`, total_clicks: s.total, by_day: s.by_day, by_country: s.by_country, by_device: s.by_device, by_referrer: s.by_referrer }
    }).sort((a, b) => b.total_clicks - a.total_clicks)
    res.json({ since: since.toISOString(), count: links.length, total_clicks: links.reduce((n, l) => n + l.total_clicks, 0), links })
  }))

  // Inspect a single link (+click analytics).
  router.get('/shortener/links/:slug', apiKeyAuth, h(async (req, res) => {
    const domain = String(req.query.domain || '').trim().toLowerCase()
    const slug = String(req.params.slug || '').trim()
    if (!domainOk(domain)) return res.status(400).json({ error: 'invalid_domain', message: 'Pass ?domain=go.mysite.com' })
    const key = keyOf(domain, slug)
    const url = await get(col('fullUrlOf'), key)
    const mine = await col('shortenerLinks').findOne({ _id: key }).catch(() => null)
    const inList = (await get(col('linksOf'), owner(req)))?.[key]
    if (!url || (!inList && !(mine && String(mine.ownerChatId) === owner(req)))) {
      return res.status(404).json({ error: 'not_found', message: 'No such short link under your account.' })
    }
    res.json(await linkView(owner(req), key, url))
  }))

  // Update a link: change destination url, enable/disable, and/or set-or-clear expiry.
  // Editable fields: url (new destination), disabled (bool), expires_in_days (number, or null to
  // clear back to "never"). To change the slug itself, use POST /shortener/links/:slug/rename
  // (it migrates clicks + settings to the new slug).
  router.patch('/shortener/links/:slug', apiKeyAuth, h(async (req, res) => {
    const domain = String(req.body?.domain || req.query.domain || '').trim().toLowerCase()
    const slug = String(req.params.slug || '').trim()
    if (!domainOk(domain)) return res.status(400).json({ error: 'invalid_domain', message: 'Provide { "domain": "go.mysite.com" }.' })
    const key = keyOf(domain, slug)
    const url = await get(col('fullUrlOf'), key)
    const inList = (await get(col('linksOf'), owner(req)))?.[key]
    if (!url || !inList) return res.status(404).json({ error: 'not_found', message: 'No such short link under your account.' })

    const meta = (await col('shortenerLinks').findOne({ _id: key }).catch(() => null)) || { ownerChatId: owner(req), domain, slug, longUrl: url, disabled: false, expiresAt: null }
    const patch = {}
    // Destination URL edit (optional).
    let finalUrl = url
    if (req.body?.url !== undefined) {
      const newUrl = String(req.body.url || '').trim()
      if (!urlOk(newUrl)) return res.status(400).json({ error: 'invalid_url', message: 'Provide a valid http(s) target URL in { "url": "https://…" }.' })
      finalUrl = newUrl
    }
    if (req.body?.disabled != null) {
      if (typeof req.body.disabled !== 'boolean') return res.status(400).json({ error: 'invalid_body', message: '"disabled" must be a boolean.' })
      patch.disabled = req.body.disabled
    }
    if (req.body?.expires_in_days !== undefined) {
      const v = req.body.expires_in_days
      if (v === null) patch.expiresAt = null
      else {
        const n = Number(v)
        if (!Number.isFinite(n) || n <= 0 || n > 3650) return res.status(400).json({ error: 'invalid_expiry', message: 'expires_in_days must be a positive number of days (max 3650), or null to clear.' })
        patch.expiresAt = Date.now() + Math.round(n * 86400000)
      }
    }
    if (Object.keys(patch).length === 0 && finalUrl === url) return res.status(400).json({ error: 'nothing_to_update', message: 'Provide "url" (new destination), "disabled" (bool) and/or "expires_in_days" (number|null to clear). To change the slug, use POST /shortener/links/:slug/rename.' })

    // Persist a destination change across every store the redirector reads.
    if (finalUrl !== url) {
      await set(col('fullUrlOf'), key, finalUrl)
      await set(col('linksOf'), owner(req), key, finalUrl)
    }
    const next = { disabled: patch.disabled != null ? patch.disabled : !!meta.disabled, expiresAtMs: patch.expiresAt !== undefined ? patch.expiresAt : (typeof meta.expiresAt === 'number' ? meta.expiresAt : null) }
    await applyValidity(key, next)
    await col('shortenerLinks').updateOne({ _id: key }, { $set: { ownerChatId: owner(req), domain, slug, longUrl: finalUrl, disabled: next.disabled, expiresAt: next.expiresAtMs, updatedAt: new Date() } }, { upsert: true })
    res.json({ updated: true, ...(await linkView(owner(req), key, finalUrl)) })
  }))

  // Rename a link's slug — moves the link and MIGRATES its clicks + settings
  // (destination, expiry, disabled state) to the new slug. Body: { domain, new_slug }
  // ("alias" accepted as a synonym). The slug IS the link's key, so the OLD slug stops
  // resolving (becomes a 404) and the SAME link lives at the new slug.
  router.post('/shortener/links/:slug/rename', apiKeyAuth, h(async (req, res) => {
    const domain = String(req.body?.domain || req.query.domain || '').trim().toLowerCase()
    const oldSlug = String(req.params.slug || '').trim()
    const newSlug = String(req.body?.new_slug ?? req.body?.alias ?? '').trim()
    if (!domainOk(domain)) return res.status(400).json({ error: 'invalid_domain', message: 'Provide { "domain": "go.mysite.com" }.' })
    if (!newSlug) return res.status(400).json({ error: 'missing_new_slug', message: 'Provide the new slug in { "new_slug": "my-new-code" }.' })
    if (!aliasOk(newSlug)) return res.status(400).json({ error: 'invalid_alias', message: 'new_slug may contain only letters, numbers, hyphen and underscore (max 64 chars).' })
    if (RESERVED.has(newSlug.toLowerCase())) return res.status(409).json({ error: 'reserved_alias', message: `"${newSlug}" is a reserved word and cannot be used as a short code.` })

    const oldKey = keyOf(domain, oldSlug)
    const newKey = keyOf(domain, newSlug)

    // Source link must exist and belong to the caller.
    const url = await get(col('fullUrlOf'), oldKey)
    const inList = (await get(col('linksOf'), owner(req)))?.[oldKey]
    if (!url || !inList) return res.status(404).json({ error: 'not_found', message: 'No such short link under your account.' })

    if (newKey === oldKey) return res.status(400).json({ error: 'same_slug', message: 'The new slug is the same as the current one.' })
    if (await get(col('fullUrlOf'), newKey)) return res.status(409).json({ error: 'alias_taken', message: `${domain}/${newSlug} already exists. Choose a different slug.` })

    // Snapshot everything stored under the old key.
    const clicks = await get(col('clicksOn'), oldKey)
    const expiryMs = await get(col('expiryOf'), oldKey)
    const meta = await col('shortenerLinks').findOne({ _id: oldKey }).catch(() => null)
    const disabled = !!(meta && meta.disabled) || expiryMs === 1

    // Write the new key: destination, ownership listing, migrated clicks, validity, metadata.
    await set(col('fullUrlOf'), newKey, url)
    await set(col('linksOf'), owner(req), newKey, url)
    if (typeof clicks === 'number' && clicks > 0) await set(col('clicksOn'), newKey, clicks)
    if (typeof expiryMs === 'number') await set(col('expiryOf'), newKey, expiryMs)
    await col('shortenerLinks').updateOne(
      { _id: newKey },
      { $set: {
        ownerChatId: owner(req), domain, slug: newSlug, longUrl: url, alias: newSlug,
        disabled,
        expiresAt: (meta && typeof meta.expiresAt === 'number') ? meta.expiresAt : null,
        ...(meta && meta.routing ? { routing: meta.routing } : {}),
        createdAt: meta?.createdAt || new Date(),
        updatedAt: new Date(),
      } },
      { upsert: true },
    )
    await analytics.renameKey(getDb(), oldKey, newKey)

    // Remove the old key everywhere — the old slug now 404s.
    await del(col('fullUrlOf'), oldKey)
    await col('linksOf').updateOne({ _id: owner(req) }, { $unset: { [oldKey]: '' } })
    await del(col('clicksOn'), oldKey)
    await del(col('expiryOf'), oldKey)
    await col('shortenerLinks').deleteOne({ _id: oldKey }).catch(() => {})

    res.json({ renamed: true, old_slug: oldSlug, old_short_url: `https://${domain}/${oldSlug}`, ...(await linkView(owner(req), newKey, url)) })
  }))

  // Delete a short link.
  router.delete('/shortener/links/:slug', apiKeyAuth, h(async (req, res) => {
    const domain = String(req.query.domain || req.body?.domain || '').trim().toLowerCase()
    const slug = String(req.params.slug || '').trim()
    if (!domainOk(domain)) return res.status(400).json({ error: 'invalid_domain', message: 'Pass ?domain=go.mysite.com' })
    const key = keyOf(domain, slug)
    const inList = (await get(col('linksOf'), owner(req)))?.[key]
    const url = await get(col('fullUrlOf'), key)
    if (!url || !inList) return res.status(404).json({ error: 'not_found', message: 'No such short link under your account.' })
    await del(col('fullUrlOf'), key)
    await col('linksOf').updateOne({ _id: owner(req) }, { $unset: { [key]: '' } })
    await del(col('expiryOf'), key)
    await del(col('clicksOn'), key)
    await col('shortenerLinks').deleteOne({ _id: key }).catch(() => {})
    await analytics.deleteKey(getDb(), key)
    res.json({ deleted: true, domain, slug })
  }))

  // Per-link analytics breakdown (country / device / referrer / per-day) for the retention window.
  router.get('/shortener/links/:slug/stats', apiKeyAuth, h(async (req, res) => {
    const domain = String(req.query.domain || '').trim().toLowerCase()
    const slug = String(req.params.slug || '').trim()
    if (!domainOk(domain)) return res.status(400).json({ error: 'invalid_domain', message: 'Pass ?domain=go.mysite.com' })
    const link = await ownedLink(req, domain, slug)
    if (!link) return res.status(404).json({ error: 'not_found', message: 'No such short link under your account.' })
    const { key, url } = link
    const since = sinceFrom(req.query)
    const s = (await analytics.statsForKeys(getDb(), [key], since))[key]
    res.json({ domain, slug, short_url: `https://${domain}/${slug}`, url, since: since.toISOString(), total_clicks: s.total, by_day: s.by_day, by_country: s.by_country, by_device: s.by_device, by_referrer: s.by_referrer })
  }))

  // Set / replace / clear the smart-routing rules for a link.
  // Body { routing: { targets:[{country|device, url}], default? } } or { routing: null } to clear.
  router.put('/shortener/links/:slug/routing', apiKeyAuth, h(async (req, res) => {
    const domain = String(req.body?.domain || req.query.domain || '').trim().toLowerCase()
    const slug = String(req.params.slug || '').trim()
    if (!domainOk(domain)) return res.status(400).json({ error: 'invalid_domain', message: 'Provide { "domain": "go.mysite.com" }.' })
    const link = await ownedLink(req, domain, slug)
    if (!link) return res.status(404).json({ error: 'not_found', message: 'No such short link under your account.' })
    const { key, url } = link
    const parsed = analytics.parseRouting(req.body?.routing === undefined ? null : req.body.routing)
    if (!parsed.ok) return res.status(400).json({ error: parsed.error, message: parsed.message })
    if (parsed.rules) await col('shortenerLinks').updateOne({ _id: key }, { $set: { ownerChatId: owner(req), domain, slug, longUrl: url, routing: parsed.rules, updatedAt: new Date() }, $setOnInsert: { createdAt: new Date(), disabled: false } }, { upsert: true })
    else await col('shortenerLinks').updateOne({ _id: key }, { $unset: { routing: '' }, $set: { updatedAt: new Date() } })
    res.json({ updated: true, domain, slug, short_url: `https://${domain}/${slug}`, base_url: url, routing: parsed.rules || null, note: parsed.rules ? 'Visitors are routed by the first matching rule (country/device); non-matches get the base url (or routing.default).' : 'Smart routing cleared — every visitor gets the base url.' })
  }))

  // QR code for a short link. ?format=png (default) | svg, ?size=300 (png, 64–1024).
  router.get('/shortener/links/:slug/qr', apiKeyAuth, h(async (req, res) => {
    const domain = String(req.query.domain || '').trim().toLowerCase()
    const slug = String(req.params.slug || '').trim()
    if (!domainOk(domain)) return res.status(400).json({ error: 'invalid_domain', message: 'Pass ?domain=go.mysite.com' })
    const link = await ownedLink(req, domain, slug)
    if (!link) return res.status(404).json({ error: 'not_found', message: 'No such short link under your account.' })
    const shortUrl = `https://${domain}/${slug}`
    const format = String(req.query.format || 'png').toLowerCase()
    const QRCode = require('qrcode')
    try {
      if (format === 'svg') {
        const svg = await QRCode.toString(shortUrl, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' })
        res.set('Content-Type', 'image/svg+xml').set('Cache-Control', 'private, max-age=3600').send(svg)
        return
      }
      if (format !== 'png') return res.status(400).json({ error: 'invalid_format', message: 'format must be png or svg.' })
      const width = Math.min(Math.max(parseInt(req.query.size, 10) || 300, 64), 1024)
      const buf = await QRCode.toBuffer(shortUrl, { type: 'png', width, margin: 1, errorCorrectionLevel: 'M' })
      res.set('Content-Type', 'image/png').set('Cache-Control', 'private, max-age=3600').send(buf)
    } catch (e) {
      res.status(500).json({ error: 'qr_failed', message: e.message })
    }
  }))

  log('[ResellerAPI] URL-shortener routes registered (domains: buy/existing/external + verify + deactivate; links: create/list/get/patch/rename/delete + stats/routing/qr)')
}

module.exports = { registerShortenerRoutes }
