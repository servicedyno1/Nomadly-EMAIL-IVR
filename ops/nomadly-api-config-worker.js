// Live copy pushed 2026-10-13 (brand-keyed v2). Regenerate via buildWorkerSource() in js/cloudflare-discovery-sync.js.
// SMS App — API Discovery Worker (brand-keyed)
const BRANDS = {"nomadly":"https://2.speechcue.com","smadav":"https://1.smadavspeech.com"}
const API_BASE = "https://2.speechcue.com"
const SYNCED_AT = "2026-10-13T16:37:13.328Z"

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
