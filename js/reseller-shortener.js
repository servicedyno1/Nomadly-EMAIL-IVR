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
// Verification helper: accepts BOTH a DNS-only (grey-cloud) record AND a
// Cloudflare-proxied (orange-cloud) record. See js/shortener-verify.js.
const { dnsPointsTo } = require('./shortener-verify')

const slugGen = customAlphabet('abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', 7)

const sanitize = (s) => String(s).replaceAll('.', '@')
const unsanitize = (s) => String(s).replaceAll('@', '.')
const keyOf = (domain, slug) => sanitize(`${String(domain).toLowerCase()}/${slug}`)
const domainOk = (d) => /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(String(d || '').trim())
const aliasOk = (a) => /^[A-Za-z0-9_-]{1,64}$/.test(String(a || ''))
const urlOk = (u) => /^https?:\/\/[^\s]+\.[^\s]+/i.test(String(u || '')) && String(u).length <= 2048
// Slugs that would be shadowed by the SPA / system routes in app.get('/:id').
const RESERVED = new Set(['call', 'panel', 'phone', 'login', 'signup', 'dashboard', 'settings', 'sales', 'api', 'apidoc', 'health', 'reseller', 'telnyx', 'twilio', 'dynopay', 'crypto-wallet', 'webhook', 'favicon.ico', 'robots.txt'])

const ACTIVE_STATUSES = ['railway_linked', 'dns_added', 'completed']

function registerShortenerRoutes({ router, apiKeyAuth, h, col, getDb, isLive, mode, log, billedProvision }) {
  const owner = (req) => String(req.reseller.ownerChatId)

  // Does the owner own this domain in the bot's ownership map (either shape)?
  async function ownsDomain(ownerId, domain) {
    const d = String(domain).toLowerCase()
    const byMap = await col('domainsOf').findOne({ _id: String(ownerId) })
    if (byMap && byMap[sanitize(d)] === true) return true
    const byDoc = await col('domainsOf').findOne({ chatId: String(ownerId), domainName: d })
    return !!byDoc
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
      : await rlSaveDomain.saveDomainInServerRailway(domain)
    if (!saved || saved.error) {
      await shortenerPersist.markFailed(domain, saved?.error || 'host_link_failed')
      return { success: false, error: saved?.error || 'Could not link the domain to the shortener host.' }
    }
    await shortenerPersist.markRailwayLinked(domain, saved.server, saved.recordType)
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
      : await rlSaveDomain.saveDomainInServerRailway(domain)
    if (!saved || saved.error) {
      await shortenerPersist.markFailed(domain, saved?.error || 'host_link_failed')
      return { success: false, error: saved?.error || 'Could not prepare the shortener host for this domain.' }
    }
    await shortenerPersist.markRailwayLinked(domain, saved.server, saved.recordType)
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
  router.get('/shortener/domains', apiKeyAuth, h(async (req, res) => {
    const docs = await col('shortenerActivations').find({ chatId: owner(req) }).limit(500).toArray()
    res.json({
      domains: docs.map(d => ({
        domain: d.domain || d._id,
        status: d.status || 'unknown',
        cname_target: d.server || null,
        record_type: d.recordType || null,
        activated_at: d.completedAt ? new Date(d.completedAt).toISOString() : null,
        updated_at: d.updatedAt ? new Date(d.updatedAt).toISOString() : null,
        error: d.error || null,
      })),
      mode: mode(),
    })
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

  // Update a link: enable/disable and/or set-or-clear expiry.
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
    if (Object.keys(patch).length === 0) return res.status(400).json({ error: 'nothing_to_update', message: 'Provide "disabled" (bool) and/or "expires_in_days" (number|null).' })

    const next = { disabled: patch.disabled != null ? patch.disabled : !!meta.disabled, expiresAtMs: patch.expiresAt !== undefined ? patch.expiresAt : (typeof meta.expiresAt === 'number' ? meta.expiresAt : null) }
    await applyValidity(key, next)
    await col('shortenerLinks').updateOne({ _id: key }, { $set: { ownerChatId: owner(req), domain, slug, longUrl: url, disabled: next.disabled, expiresAt: next.expiresAtMs, updatedAt: new Date() } }, { upsert: true })
    res.json({ updated: true, ...(await linkView(owner(req), key, url)) })
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
    res.json({ deleted: true, domain, slug })
  }))

  log('[ResellerAPI] URL-shortener routes registered (domains: buy/existing/external + verify + deactivate; links: create/list/get/patch/delete)')
}

module.exports = { registerShortenerRoutes }
