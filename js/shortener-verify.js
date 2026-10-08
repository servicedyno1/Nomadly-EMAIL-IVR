/*global */
// ============================================================
// Shortener domain verification helpers
// ============================================================
// A shortener host is "verified" when it points at the shortener origin. There
// are TWO correct configurations and verification must accept both:
//
//   1. DNS-only (grey-cloud) — the host resolves DIRECTLY to the origin IP
//      (A/AAAA) or a CNAME to the origin host. A live public DNS lookup sees
//      the origin, so a simple resolve4/resolveCname match works.
//
//   2. Cloudflare-proxied (orange-cloud) — REQUIRED whenever the origin serves
//      TLS with a Cloudflare Origin-CA certificate (our DigitalOcean droplet
//      does: it mints an Origin-CA cert per host and sets the zone SSL mode to
//      full/strict). In this mode public DNS for the host resolves to
//      Cloudflare ANYCAST IPs (104.21.x.x / 172.67.x.x), NOT the origin, so a
//      live resolve4() can NEVER equal the origin IP. The record is still
//      correct and the host serves perfectly through Cloudflare's edge
//      (browser gets a valid Universal-SSL cert; CF reaches the origin over the
//      Origin-CA trust). We therefore confirm correctness from the
//      AUTHORITATIVE Cloudflare zone record instead of the public resolver.
//
// dnsPointsTo() tries (1) first, then falls back to (2), so a shortener
// activates end-to-end whether the record is DNS-only or Cloudflare-proxied.
//
// cfService / dns are injectable (deps arg) purely so the unit tests can run
// the proxied branch without real network I/O.
// ============================================================

const realDns = require('dns').promises
const realCfService = require('./cf-service')

// Apex-zone candidates for a hostname, most-specific first:
//   go.a.example.co.uk -> ['go.a.example.co.uk','a.example.co.uk','example.co.uk','co.uk']
// Cloudflare's getZoneByName only resolves the true apex, so we probe each
// suffix until one is a zone we actually manage. This handles both a subdomain
// shortener (go.example.com) and an apex/main-domain shortener (example.com),
// and multi-label TLDs.
function zoneCandidates(host) {
  const parts = String(host || '').toLowerCase().replace(/\.$/, '').split('.').filter(Boolean)
  const out = []
  for (let i = 0; i < parts.length - 1; i++) out.push(parts.slice(i).join('.'))
  return out
}

const norm = (s) => String(s || '').toLowerCase().replace(/\.$/, '')

// Authoritative check against the Cloudflare zone WE manage for this host.
// Returns true when the host has an A/AAAA record whose content is the origin
// `target` (or a CNAME equal to `target`) — REGARDLESS of the proxied flag.
// This is the proxied (orange-cloud) verification path.
async function cfZoneRecordMatches(host, target, deps = {}) {
  const cf = deps.cfService || realCfService
  const h = norm(host)
  const t = norm(target)
  if (!h || !t) return false
  for (const cand of zoneCandidates(h)) {
    let zone = null
    try { zone = await cf.getZoneByName(cand) } catch (_) { zone = null }
    if (!zone || !zone.id) continue
    let recs = []
    try { recs = await cf.listDNSRecords(zone.id) } catch (_) { recs = [] }
    for (const r of recs || []) {
      if (norm(r.name) !== h) continue
      const type = String(r.type || '').toUpperCase()
      const content = norm(r.content)
      if ((type === 'A' || type === 'AAAA') && content === t) return true
      if (type === 'CNAME' && content === t) return true
    }
    // We own this zone but the record isn't (yet) the origin — stop probing
    // parent suffixes; the record simply hasn't been created/corrected.
    return false
  }
  // Not a zone on our Cloudflare account — caller relies on the public-DNS path.
  return false
}

// Does `domain` resolve/point to `target`?
//   Step 1 (public DNS)  -> covers DNS-only / externally-hosted domains.
//   Step 2 (CF zone)     -> covers Cloudflare-proxied records whose public DNS
//                           shows Cloudflare edge IPs instead of the origin.
async function dnsPointsTo(domain, target, deps = {}) {
  const dns = deps.dns || realDns
  if (!target) return false
  const t = norm(target)

  // 1a. CNAME equals the origin host (DNS-only CNAME shorteners / Railway).
  try {
    const cn = (await dns.resolveCname(domain).catch(() => [])).map(norm)
    if (cn.includes(t)) return true
  } catch (_) { /* fallthrough */ }

  // 1b. Shared A-record IP (DNS-only A-record shorteners).
  try {
    const [dIps, tIps] = await Promise.all([
      dns.resolve4(domain).catch(() => []),
      dns.resolve4(t).catch(() => []),
    ])
    if (dIps.length && tIps.length && dIps.some(ip => tIps.includes(ip))) return true
  } catch (_) { /* fallthrough */ }

  // 2. Authoritative Cloudflare zone (proxied / orange-cloud records).
  try {
    if (await cfZoneRecordMatches(domain, t, deps)) return true
  } catch (_) { /* no match */ }

  return false
}

module.exports = { zoneCandidates, cfZoneRecordMatches, dnsPointsTo }
