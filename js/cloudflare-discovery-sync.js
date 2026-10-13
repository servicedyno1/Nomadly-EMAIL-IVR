/**
 * Cloudflare Discovery Worker sync — BRAND-KEYED (2026-06).
 *
 * One Worker serves every APK in the wild. Each bot (Nomadly on 2.speechcue.com,
 * Smadav on 1.smadavspeech.com) owns ONE key in the payload and never touches the
 * other's, so restarts can no longer flip all users to the wrong backend:
 *
 *   { apiBase: <nomadly url (legacy APKs)>, brands: { nomadly: url, smadav: url }, version: 2 }
 *
 * The APK asks `?brand=<slug>` and reads `brands[slug]`, falling back to its baked
 * per-brand URL. `apiBase` is only ever written by the "nomadly" brand so pre-2.8
 * single-brand APKs keep working.
 */
const { brandSlug } = require('./sms-app-brand.js')

const CF_ACCOUNT_ID = 'ed6035ebf6bd3d85f5b26c60189a21e2'
const CF_SCRIPT_NAME = 'nomadly-api-config'
const CF_DISCOVERY_URL = 'https://nomadly-api-config.nomadly-cfg.workers.dev/'
const LEGACY_BRAND = 'nomadly'

function buildWorkerSource(brands, apiBase) {
  return `// SMS App — API Discovery Worker (brand-keyed)
const BRANDS = ${JSON.stringify(brands)}
const API_BASE = ${JSON.stringify(apiBase)}
const SYNCED_AT = ${JSON.stringify(new Date().toISOString())}

addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request))
})

async function handleRequest(request) {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  }
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }
  const url = new URL(request.url)
  const brand = (url.searchParams.get('brand') || '').toLowerCase().replace(/[^a-z0-9]/g, '')
  const payload = { apiBase: brand && BRANDS[brand] ? BRANDS[brand] : API_BASE, brand: brand || null, brands: BRANDS, version: 2, syncedAt: SYNCED_AT }
  return new Response(JSON.stringify(payload, null, 2), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=60',
      ...corsHeaders,
    },
  })
}
`
}

// Pure merge: current payload + this brand's URL → { brands, apiBase, changed }
function mergeDiscovery(current, slug, desiredUrl) {
  const hadBrands = !!current?.brands
  const brands = { ...(current?.brands || {}) }
  // v1 payload migration: its single apiBase belonged to whichever bot synced last;
  // only treat it as the legacy (nomadly) URL when it is clearly not ours.
  if (!hadBrands && current?.apiBase && current.apiBase !== desiredUrl) brands[LEGACY_BRAND] = current.apiBase
  const before = brands[slug]
  brands[slug] = desiredUrl
  const apiBase = brands[LEGACY_BRAND] || current?.apiBase || desiredUrl
  const changed = !hadBrands || before !== desiredUrl || current?.apiBase !== apiBase
  return { brands, apiBase, changed }
}

async function syncDiscoveryWorker() {
  try {
    if (process.env.CF_DISCOVERY_SYNC !== 'true') {
      console.log('[CF-Sync] Disabled (CF_DISCOVERY_SYNC!=true) — skipping')
      return
    }
    if (process.env.DISABLE_CF_DISCOVERY_SYNC === 'true') {
      console.log('[CF-Sync] Disabled via env — skipping')
      return
    }
    // SAFETY: Never sync the Discovery Worker from a development environment
    const botEnv = (process.env.BOT_ENVIRONMENT || '').toLowerCase().trim()
    if (botEnv === 'development') {
      console.log('[CF-Sync] Skipped — BOT_ENVIRONMENT=development (only production can sync the Discovery Worker)')
      return
    }

    const desiredUrl = String(process.env.SELF_URL || '').trim().replace(/\/+$/, '')
    if (!/^https:\/\/.+/.test(desiredUrl)) {
      console.log('[CF-Sync] SELF_URL not set / invalid — skipping')
      return
    }
    const email = process.env.CLOUDFLARE_EMAIL
    const key = process.env.CLOUDFLARE_API_KEY
    if (!email || !key) {
      console.log('[CF-Sync] CLOUDFLARE credentials missing — skipping')
      return
    }

    const slug = brandSlug()
    let current = null
    try {
      const resp = await fetch(CF_DISCOVERY_URL, { headers: { 'cache-control': 'no-cache' }, signal: AbortSignal.timeout(5000) })
      if (resp.ok) current = await resp.json()
      else console.log(`[CF-Sync] Current Worker returned ${resp.status}`)
    } catch (e) {
      console.log('[CF-Sync] Could not read current Worker (network?):', e.message)
    }
    // Never PUT blind: without the current payload we would drop the other brand's entry.
    if (!current) {
      console.log(`[CF-Sync] Current Worker payload unavailable — not overwriting (brand=${slug})`)
      return
    }

    const { brands, apiBase, changed } = mergeDiscovery(current, slug, desiredUrl)
    if (!changed) {
      console.log(`[CF-Sync] Discovery Worker already in sync for brand=${slug}: ${desiredUrl}`)
      return
    }
    console.log(`[CF-Sync] Updating brand=${slug} → ${desiredUrl} (was ${current?.brands?.[slug] || current?.apiBase || '(none)'}); other brands untouched: ${JSON.stringify(Object.fromEntries(Object.entries(brands).filter(([k]) => k !== slug)))}`)

    const putUrl = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/workers/scripts/${CF_SCRIPT_NAME}`
    const putResp = await fetch(putUrl, {
      method: 'PUT',
      headers: { 'X-Auth-Email': email, 'X-Auth-Key': key, 'Content-Type': 'application/javascript' },
      body: buildWorkerSource(brands, apiBase),
      signal: AbortSignal.timeout(15000),
    })
    if (!putResp.ok) {
      const txt = await putResp.text().catch(() => '')
      console.error(`[CF-Sync] PUT failed ${putResp.status}:`, txt.slice(0, 300))
      return
    }
    console.log(`[CF-Sync] ✅ Discovery Worker updated — brands=${JSON.stringify(brands)} apiBase=${apiBase}`)
  } catch (e) {
    console.error('[CF-Sync] Unexpected error:', e.message)
  }
}

module.exports = { syncDiscoveryWorker, mergeDiscovery, buildWorkerSource, CF_DISCOVERY_URL }
