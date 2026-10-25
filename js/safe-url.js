'use strict'
// Guards the webhooks customers point at their own systems (CloudIVR call events, SMS forwarding, reseller pushes) so a
// webhook can never be aimed back at our servers: loopback, private networks, cloud metadata (169.254.169.254), CGNAT,
// IPv6 local ranges, and IPv4-mapped / NAT64 spellings of those (e.g. https://[::ffff:127.0.0.1]/).
//  • checkUrl()  — when a URL is SAVED (and before each send): blocked names + IP literals + every DNS answer.
//  • sendOptions() — axios options for every DELIVERY: connections go through safeLookup(), which re-validates each
//    resolved address at connect time (so a hostname re-pointed after saving — DNS rebinding — is still refused), and
//    redirects are refused (or, with follow: true, re-checked hop by hop).
const dns = require('dns')
const net = require('net')
const http = require('http')
const https = require('https')

const V4 = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
  ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
]
const V6 = [
  ['::', 96], // unspecified, loopback and the old IPv4-compatible form
  ['64:ff9b::', 96], ['64:ff9b:1::', 48], ['100::', 64], ['2001::', 23], ['2001:db8::', 32], ['2002::', 16],
  ['fc00::', 7], ['fe80::', 10], ['fec0::', 10], ['ff00::', 8],
]
const block4 = new net.BlockList()
const block6 = new net.BlockList()
V4.forEach(([a, p]) => block4.addSubnet(a, p, 'ipv4'))
V6.forEach(([a, p]) => block6.addSubnet(a, p, 'ipv6'))

// Local test harnesses deliver to receivers on 127.0.0.1. Code-level switch only (never read from env or a request).
let allowPrivate = false
function _allowPrivateForTests(on = true) { allowPrivate = !!on }

const bare = (h) => String(h || '').trim().toLowerCase().replace(/^\[|\]$/g, '').split('%')[0].replace(/\.$/, '')

// 8 numeric groups of an IPv6 address (handles "::" and a trailing dotted quad).
function groups6(ip) {
  let s = ip
  const dot = s.match(/(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (dot) {
    const [a, b, c, d] = dot.slice(1).map(Number)
    s = `${s.slice(0, s.length - dot[0].length)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`
  }
  const [head, tail] = s.split('::')
  const h = head ? head.split(':') : []
  if (tail === undefined) return h.map(g => parseInt(g, 16))
  const t = tail ? tail.split(':') : []
  return [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill('0'), ...t].map(g => parseInt(g || '0', 16))
}

// ::ffff:a.b.c.d (mapped) and ::ffff:0:a.b.c.d (translated) are really IPv4 addresses.
function embeddedV4(ip) {
  const g = groups6(ip)
  if (g.length !== 8 || g.some(Number.isNaN)) return null
  const mapped = g.slice(0, 5).every(x => x === 0) && g[5] === 0xffff
  const translated = g.slice(0, 4).every(x => x === 0) && g[4] === 0xffff && g[5] === 0
  return mapped || translated ? [g[6] >> 8, g[6] & 255, g[7] >> 8, g[7] & 255].join('.') : null
}

function isBlockedIp(ip) {
  const s = bare(ip)
  const fam = net.isIP(s)
  if (fam === 4) return block4.check(s, 'ipv4')
  if (fam === 6) {
    const v4 = embeddedV4(s)
    return v4 ? block4.check(v4, 'ipv4') : block6.check(s, 'ipv6')
  }
  return true // not an IP at all → never connect
}

// Names that only make sense inside a network. Single-label names (e.g. "mongodb") resolve via local search domains.
function isBlockedName(host) {
  const h = bare(host)
  if (!h || !h.includes('.')) return true
  return h === 'localhost' || /\.(localhost|local|localdomain|internal|intranet|lan|home|corp|home\.arpa)$/.test(h)
}

const blockedHost = (host) => { if (allowPrivate) return false; const h = bare(host); return net.isIP(h) ? isBlockedIp(h) : isBlockedName(h) }

function blockedError(host) {
  const e = new Error(`Blocked: ${bare(host) || 'host'} is a private or internal address`)
  e.code = 'EBLOCKED'
  return e
}

const LOOKUP_TIMEOUT_MS = 4000
function lookupAll(host) {
  return Promise.race([
    dns.promises.lookup(host, { all: true, verbatim: true }),
    new Promise((_, rej) => setTimeout(() => rej(Object.assign(new Error('DNS timeout'), { code: 'ETIMEOUT' })), LOOKUP_TIMEOUT_MS).unref()),
  ])
}

// → { ok: true } | { ok: false, reason: 'invalid_url' | 'private_address' }, without DNS (scheme, names, IP literals).
function quickCheck(raw, { httpsOnly = true } = {}) {
  let u
  try { u = new URL(String(raw || '').trim()) } catch (_) { return { ok: false, reason: 'invalid_url' } }
  if (u.protocol !== 'https:' && ((httpsOnly && !allowPrivate) || u.protocol !== 'http:')) return { ok: false, reason: 'invalid_url' }
  const host = bare(u.hostname)
  if (!host) return { ok: false, reason: 'invalid_url' }
  if (blockedHost(host)) return { ok: false, reason: 'private_address' }
  return { ok: true, host }
}

// Same plus every DNS answer (use when SAVING). A name that does not resolve right now is accepted (delivery then simply
// fails and is logged); the connect-time check still applies to every send.
async function checkUrl(raw, { httpsOnly = true, resolve = true } = {}) {
  const q = quickCheck(raw, { httpsOnly })
  if (!q.ok) return q
  if (net.isIP(q.host) || !resolve || allowPrivate) return { ok: true }
  try {
    const addrs = await lookupAll(q.host)
    if (!addrs.length || addrs.some(a => isBlockedIp(a.address))) return { ok: false, reason: 'private_address' }
    return { ok: true }
  } catch (_) { return { ok: true, unresolved: true } }
}

// Throws (code EBLOCKED / EINVALIDURL) unless `url` may be sent to. Call right before EVERY delivery: IP-literal hosts
// skip DNS, so the connect-time lookup alone would not see them.
function assertSendable(url, { httpsOnly = true } = {}) {
  const q = quickCheck(url, { httpsOnly })
  if (q.ok) return
  if (q.reason === 'invalid_url') throw Object.assign(new Error('Invalid webhook URL'), { code: 'EINVALIDURL' })
  let host = ''
  try { host = new URL(String(url)).hostname } catch (_) { /* invalid already handled */ }
  throw blockedError(host)
}

// dns.lookup-compatible; refuses blocked names and any blocked answer.
function safeLookup(hostname, options, cb) {
  if (typeof options === 'function') { cb = options; options = {} }
  const opts = typeof options === 'number' ? { family: options } : { ...(options || {}) }
  if (!allowPrivate && isBlockedName(hostname) && !net.isIP(bare(hostname))) return process.nextTick(cb, blockedError(hostname))
  dns.lookup(hostname, { ...opts, all: true }, (err, addrs) => {
    if (err) return cb(err)
    const list = addrs || []
    if (!list.length || (!allowPrivate && list.some(a => isBlockedIp(a.address)))) return cb(blockedError(hostname))
    if (opts.all) return cb(null, list)
    return cb(null, list[0].address, list[0].family)
  })
}

const httpAgent = new http.Agent({ lookup: safeLookup })
const httpsAgent = new https.Agent({ lookup: safeLookup })

function beforeRedirect(options) {
  const host = options.hostname || String(options.host || '').replace(/:\d+$/, '')
  if (blockedHost(host)) throw blockedError(host)
}

// Spread into axios config for every outbound customer webhook (after assertSendable(url)).
function sendOptions({ follow = false } = {}) {
  return follow
    ? { httpAgent, httpsAgent, proxy: false, maxRedirects: 3, beforeRedirect }
    : { httpAgent, httpsAgent, proxy: false, maxRedirects: 0 }
}

module.exports = { checkUrl, quickCheck, assertSendable, isBlockedIp, isBlockedName, blockedHost, safeLookup, sendOptions, embeddedV4, _allowPrivateForTests }
