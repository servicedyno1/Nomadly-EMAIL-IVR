/* global process */
/**
 * Google Safe Browsing + Domain Reputation Monitoring
 * Checks domains against Google Safe Browsing API v4 for malware/phishing flags.
 * Also checks domain/IP reputation via external blacklist services.
 */

require('dotenv').config()
const axios = require('axios')
const { log } = require('console')

const SB_API_KEY = process.env.GOOGLE_SAFE_BROWSING_KEY || ''
const SB_ENDPOINT = 'https://safebrowsing.googleapis.com/v4/threatMatches:find'

// In-memory cache: domain → { status, threats, checkedAt }
const cache = new Map()
const CACHE_TTL = 30 * 60 * 1000 // 30 minutes

/**
 * Check a single domain against Google Safe Browsing API v4
 * Returns { safe: true/false, threats: [...], error: string|null }
 */
async function checkDomain(domain) {
  if (!SB_API_KEY) {
    return { safe: null, threats: [], error: 'GOOGLE_SAFE_BROWSING_KEY not configured' }
  }

  // Check cache first
  const cached = cache.get(domain)
  if (cached && Date.now() - cached.checkedAt < CACHE_TTL) {
    return { safe: cached.safe, threats: cached.threats, error: null, cached: true }
  }

  try {
    const urls = [
      { url: `http://${domain}/` },
      { url: `https://${domain}/` },
    ]

    const res = await axios.post(`${SB_ENDPOINT}?key=${SB_API_KEY}`, {
      client: { clientId: 'nomadly-hosting', clientVersion: '1.0' },
      threatInfo: {
        threatTypes: ['MALWARE', 'SOCIAL_ENGINEERING', 'UNWANTED_SOFTWARE', 'POTENTIALLY_HARMFUL_APPLICATION'],
        platformTypes: ['ANY_PLATFORM'],
        threatEntryTypes: ['URL'],
        threatEntries: urls,
      },
    }, { timeout: 15000 })

    const matches = res.data?.matches || []
    const threats = matches.map(m => ({
      type: m.threatType,
      platform: m.platformType,
      url: m.threat?.url,
    }))

    const safe = threats.length === 0
    cache.set(domain, { safe, threats, checkedAt: Date.now() })
    return { safe, threats, error: null }
  } catch (err) {
    log(`[SafeBrowsing] Error checking ${domain}:`, err.message)
    return { safe: null, threats: [], error: err.message }
  }
}

/**
 * Check multiple domains at once (batched, max 500 URLs per request)
 */

/**
 * Check an IP against common DNS blacklists (DNSBL) — no API key needed.
 * Pass { ip } = the ORIGIN server IP. Without it the domain is resolved, which behind Cloudflare
 * yields a shared CF edge IP (meaningless for reputation) → ip_source 'resolved'.
 * Only 127.0.0.2–127.0.0.255 answers mean "listed"; other answers (e.g. Spamhaus 127.255.255.25x
 * "public resolver refused / rate-limited") and resolver errors are reported as `unavailable`.
 */
const isDnsblHit = (a) => /^127\.0\.0\.(\d{1,3})$/.test(a) && Number(a.split('.')[3]) >= 2

async function checkBlacklists(domain, { ip: originIp } = {}) {
  const dns = require('dns').promises
  const blacklists = [
    'zen.spamhaus.org',
    'bl.spamcop.net',
    'b.barracudacentral.org',
  ]

  try {
    let ip = originIp ? String(originIp).trim() : ''
    let ipSource = 'origin'
    if (ip && !/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) ip = ((await dns.resolve4(ip).catch(() => []))[0]) || ''
    if (!ip) {
      const addresses = await dns.resolve4(domain).catch(() => [])
      if (addresses.length === 0) return { listed: false, error: 'Could not resolve domain', lists: [], unavailable: [] }
      ip = addresses[0]
      ipSource = 'resolved'
    }
    const reversed = ip.split('.').reverse().join('.')
    const listed = []
    const unavailable = []

    for (const bl of blacklists) {
      try {
        const answers = await dns.resolve4(`${reversed}.${bl}`)
        if (answers.some(isDnsblHit)) listed.push(bl)
        else unavailable.push({ list: bl, reason: `non-listing answer ${answers[0]}` })
      } catch (e) {
        // NXDOMAIN / no data = not listed (expected for clean IPs)
        if (e && e.code !== 'ENOTFOUND' && e.code !== 'ENODATA') unavailable.push({ list: bl, reason: e.code || 'lookup_failed' })
      }
    }

    return { listed: listed.length > 0, ip, ip_source: ipSource, lists: listed, unavailable, error: null }
  } catch (err) {
    return { listed: false, error: err.message, lists: [], unavailable: [] }
  }
}

/**
 * Get cached status for a domain (if available)
 */

/**
 * Check if Safe Browsing API is configured
 */
function isConfigured() {
  return !!SB_API_KEY
}

module.exports = {
  checkDomain,
  
  checkBlacklists,
  
  isConfigured,
}
