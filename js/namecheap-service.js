/* global process */
// ============================================================
// Namecheap XML API client
// ------------------------------------------------------------
// Used for domains WE own at Namecheap (e.g. hosta.sh — the vanity
// nameserver domain behind ns1/ns2.hosta.sh). Covers:
//   • domains.getInfo / domains.dns.getList      (read delegation)
//   • domains.dns.setCustom / dns.setDefault     (switch nameservers)
//   • domains.ns.create / getInfo / update / delete (child NS = glue records)
//
// Env:
//   NAMECHEAP_API_KEY      (required)
//   NAMECHEAP_USERNAME     (required — also used as ApiUser)
//   NAMECHEAP_API_USER     (optional, defaults to NAMECHEAP_USERNAME)
//   NAMECHEAP_CLIENT_IP    (optional — whitelisted public IPv4; auto-detected if unset)
//   NAMECHEAP_API_URL      (optional — defaults to production endpoint)
//
// SECURITY: the API key travels in the query string (Namecheap design), so
// this module NEVER logs request URLs or axios error configs.
// ============================================================

const axios = require('axios')
const { XMLParser } = require('fast-xml-parser')

const NC_URL = process.env.NAMECHEAP_API_URL || 'https://api.namecheap.com/xml.response'
const log = (...a) => console.log('[Namecheap]', ...a)

const ARRAY_TAGS = new Set(['Error', 'Warning', 'Nameserver', 'host', 'Host', 'Status'])
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  isArray: (tagName) => ARRAY_TAGS.has(tagName),
})

// Multi-label public suffixes we may realistically meet. SLD/TLD split for
// everything else is "last label = TLD".
const MULTI_LABEL_TLDS = new Set([
  'co.uk', 'org.uk', 'me.uk', 'ltd.uk', 'plc.uk', 'net.uk', 'com.au', 'net.au', 'org.au',
  'co.nz', 'com.br', 'com.mx', 'com.co', 'net.co', 'nom.co', 'co.in', 'com.ph', 'com.sg',
])

function domainParts(domain) {
  const d = String(domain || '').trim().toLowerCase().replace(/\.$/, '')
  const labels = d.split('.')
  if (labels.length < 2) throw new Error(`Invalid domain: ${domain}`)
  const last2 = labels.slice(-2).join('.')
  if (labels.length >= 3 && MULTI_LABEL_TLDS.has(last2)) {
    return { SLD: labels.slice(0, -2).join('.'), TLD: last2 }
  }
  return { SLD: labels.slice(0, -1).join('.'), TLD: labels[labels.length - 1] }
}

// ── Client IP (must be whitelisted in Namecheap → API Access) ──
let _ipCache = { ip: null, at: 0 }
async function getClientIp() {
  if (process.env.NAMECHEAP_CLIENT_IP) return process.env.NAMECHEAP_CLIENT_IP.trim()
  if (_ipCache.ip && Date.now() - _ipCache.at < 30 * 60 * 1000) return _ipCache.ip
  const probes = ['https://api.ipify.org', 'https://ipv4.icanhazip.com', 'https://ifconfig.me/ip']
  for (const url of probes) {
    try {
      const r = await axios.get(url, { timeout: 6000, responseType: 'text' })
      const ip = String(r.data || '').trim()
      if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) {
        _ipCache = { ip, at: Date.now() }
        return ip
      }
    } catch (_) { /* try next */ }
  }
  throw new Error('Could not determine public IPv4 for Namecheap ClientIp (set NAMECHEAP_CLIENT_IP)')
}

function isConfigured() {
  return !!(process.env.NAMECHEAP_API_KEY && (process.env.NAMECHEAP_USERNAME || process.env.NAMECHEAP_API_USER))
}

class NamecheapError extends Error {
  constructor(message, errors = [], command = '') {
    super(message)
    this.name = 'NamecheapError'
    this.namecheapErrors = errors
    this.command = command
  }
}

function _extractErrors(resp) {
  const raw = resp?.Errors?.Error || []
  return (Array.isArray(raw) ? raw : [raw]).filter(Boolean).map((e) => ({
    code: String(e?.['@_Number'] ?? ''),
    message: String(typeof e === 'string' ? e : (e?.['#text'] ?? '')).trim(),
  }))
}

/**
 * Low-level call. Returns the parsed <CommandResponse> object.
 * Throws NamecheapError on HTTP failure or ApiResponse Status="ERROR".
 */
async function call(command, params = {}) {
  if (!isConfigured()) throw new NamecheapError('Namecheap API not configured (NAMECHEAP_API_KEY / NAMECHEAP_USERNAME)', [], command)
  const username = process.env.NAMECHEAP_USERNAME || process.env.NAMECHEAP_API_USER
  const query = {
    ApiUser: process.env.NAMECHEAP_API_USER || username,
    ApiKey: process.env.NAMECHEAP_API_KEY,
    UserName: username,
    ClientIp: await getClientIp(),
    Command: command,
    ...params,
  }
  let data
  try {
    const res = await axios.get(NC_URL, { params: query, timeout: 30000, responseType: 'text' })
    data = res.data
  } catch (err) {
    // Do NOT log err.config (contains ApiKey in the URL)
    throw new NamecheapError(`HTTP ${err.response?.status || ''} ${err.code || err.message}`.trim(), [], command)
  }
  let root
  try { root = parser.parse(String(data || '')) } catch (e) {
    throw new NamecheapError(`Invalid XML from Namecheap: ${e.message}`, [], command)
  }
  const resp = root?.ApiResponse
  const errors = _extractErrors(resp)
  if (!resp || resp['@_Status'] !== 'OK' || errors.length) {
    const msg = errors.map((e) => `${e.code}: ${e.message}`).join('; ') || 'Namecheap returned an error'
    throw new NamecheapError(msg, errors, command)
  }
  return resp.CommandResponse || {}
}

const _arr = (v) => (Array.isArray(v) ? v : v == null ? [] : [v])
const _text = (v) => (v == null ? '' : typeof v === 'object' ? String(v['#text'] ?? '') : String(v))
const _bool = (v) => String(v).toLowerCase() === 'true'
const _lowerNs = (list) => _arr(list).map((n) => _text(n).trim().toLowerCase().replace(/\.$/, '')).filter(Boolean)

// ── Domain info / delegation ──
async function getInfo(domain) {
  const cr = await call('namecheap.domains.getInfo', { DomainName: domain })
  const r = cr.DomainGetInfoResult || {}
  const dns = r.DnsDetails || {}
  return {
    domain: r['@_DomainName'] || domain,
    status: r['@_Status'] || null,
    isOwner: _bool(r['@_IsOwner']),
    expires: r.DomainDetails?.ExpiredDate || null,
    dnsProvider: dns['@_ProviderType'] || null,
    isUsingNamecheapDns: _bool(dns['@_IsUsingOurDNS']),
    nameservers: _lowerNs(dns.Nameserver),
  }
}

async function getNameservers(domain) {
  const cr = await call('namecheap.domains.dns.getList', domainParts(domain))
  const r = cr.DomainDNSGetListResult || {}
  return {
    domain: r['@_Domain'] || domain,
    isUsingNamecheapDns: _bool(r['@_IsUsingOurDNS']),
    nameservers: _lowerNs(r.Nameserver),
  }
}

/** Replace the full nameserver set of a domain. */
async function setCustomNameservers(domain, nameservers) {
  const list = _arr(nameservers).map((n) => String(n).trim().toLowerCase().replace(/\.$/, '')).filter(Boolean)
  if (list.length < 2) throw new NamecheapError('At least 2 nameservers are required', [], 'namecheap.domains.dns.setCustom')
  const cr = await call('namecheap.domains.dns.setCustom', { ...domainParts(domain), Nameservers: list.join(',') })
  const r = cr.DomainDNSSetCustomResult || {}
  return { domain: r['@_Domain'] || domain, updated: _bool(r['@_Updated']), nameservers: list }
}

/** Revert a domain to Namecheap BasicDNS. */
async function setDefaultDns(domain) {
  const cr = await call('namecheap.domains.dns.setDefault', domainParts(domain))
  const r = cr.DomainDNSSetDefaultResult || {}
  return { domain: r['@_Domain'] || domain, updated: _bool(r['@_Updated']) }
}

// ── Child nameservers (glue records at the registry) ──
async function getChildNameserver(domain, nameserver) {
  const cr = await call('namecheap.domains.ns.getInfo', { ...domainParts(domain), Nameserver: nameserver })
  const r = cr.DomainNSInfoResult || {}
  return {
    nameserver: String(r['@_Nameserver'] || nameserver).toLowerCase(),
    ip: r['@_IP'] || null,
    statuses: _arr(r.NameserverStatuses?.Status).map(_text),
  }
}

async function createChildNameserver(domain, nameserver, ip) {
  const cr = await call('namecheap.domains.ns.create', { ...domainParts(domain), Nameserver: nameserver, IP: ip })
  const r = cr.DomainNSCreateResult || {}
  return { nameserver: r['@_Nameserver'] || nameserver, ip: r['@_IP'] || ip, success: _bool(r['@_IsSuccess']) }
}

async function updateChildNameserver(domain, nameserver, oldIp, ip) {
  const cr = await call('namecheap.domains.ns.update', { ...domainParts(domain), Nameserver: nameserver, OldIP: oldIp, IP: ip })
  const r = cr.DomainNSUpdateResult || {}
  return { nameserver, ip, success: _bool(r['@_IsSuccess']) }
}

async function deleteChildNameserver(domain, nameserver) {
  const cr = await call('namecheap.domains.ns.delete', { ...domainParts(domain), Nameserver: nameserver })
  const r = cr.DomainNSDeleteResult || {}
  return { nameserver, success: _bool(r['@_IsSuccess']) }
}

/**
 * Idempotent glue upsert: create the child NS, or update its IP if it already
 * exists with a different address. Returns { nameserver, ip, action }.
 */
async function ensureChildNameserver(domain, nameserver, ip) {
  let existing = null
  try { existing = await getChildNameserver(domain, nameserver) } catch (_) { existing = null }
  if (existing?.ip) {
    if (existing.ip === ip) return { nameserver, ip, action: 'unchanged' }
    const u = await updateChildNameserver(domain, nameserver, existing.ip, ip)
    log(`glue ${nameserver}: ${existing.ip} → ${ip} (${u.success ? 'ok' : 'not-confirmed'})`)
    return { nameserver, ip, action: 'updated', previousIp: existing.ip, success: u.success }
  }
  const c = await createChildNameserver(domain, nameserver, ip)
  log(`glue ${nameserver} → ${ip} created (${c.success ? 'ok' : 'not-confirmed'})`)
  return { nameserver, ip, action: 'created', success: c.success }
}

module.exports = {
  isConfigured,
  getClientIp,
  domainParts,
  call,
  getInfo,
  getNameservers,
  setCustomNameservers,
  setDefaultDns,
  getChildNameserver,
  createChildNameserver,
  updateChildNameserver,
  deleteChildNameserver,
  ensureChildNameserver,
  NamecheapError,
}
