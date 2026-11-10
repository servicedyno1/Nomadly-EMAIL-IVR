'use strict'
// Link safety for BulkSMS content: every link (and, for short links, the site it redirects to) is checked with Google
// (Web Risk uris.search when GOOGLE_WEB_RISK_API_KEY is set — the commercial product; else Safe Browsing v4 with
// GOOGLE_SAFE_BROWSING_API_KEY). Results are cached ≤ 9 min (Google allows 30). No key or preview → simulated:
// links containing "flagged-test" or listed in BULK_ESIM_FAKE_FLAGGED are flagged; BULK_ESIM_FAKE_URLCHECK_DOWN=1 = Google down.
const axios = require('axios')
const dns = require('dns').promises
const net = require('net')

const THREATS = ['MALWARE', 'SOCIAL_ENGINEERING', 'UNWANTED_SOFTWARE']
const TTL = 9 * 60000
const cache = new Map()
const withScheme = (u) => (/^https?:\/\//i.test(u) ? u : `http://${u}`)
const keyMode = () => (process.env.GOOGLE_WEB_RISK_API_KEY ? 'webrisk' : process.env.GOOGLE_SAFE_BROWSING_API_KEY ? 'safebrowsing' : null)
const live = (dry) => !!keyMode() && (!dry || process.env.BULK_ESIM_URLCHECK_LIVE === 'true')

const privateIp = (ip) => (net.isIPv4(ip) ? /^(10\.|127\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/.test(ip) : /^(::1$|fc|fd|fe80|::ffff:(10|127|192\.168|169\.254)\.)/i.test(ip))
async function publicHost(host) {
  if (!host || /^localhost$/i.test(host)) return false
  if (net.isIP(host)) return !privateIp(host)
  try { const all = await dns.lookup(host, { all: true }); return all.length > 0 && all.every(a => !privateIp(a.address)) } catch (_) { return false }
}
// Short links: follow up to 5 redirects by hand (each hop must be a public host), return every URL on the way.
async function chain(url) {
  const out = [url]; let cur = url
  for (let i = 0; i < 5; i++) {
    let u; try { u = new URL(cur) } catch (_) { break }
    if (!/^https?:$/.test(u.protocol) || !(await publicHost(u.hostname))) break
    let r; try { r = await axios.get(cur, { maxRedirects: 0, timeout: 6000, responseType: 'stream', validateStatus: () => true, headers: { 'User-Agent': 'Mozilla/5.0 (link check)' } }); r.data?.destroy?.() } catch (_) { break }
    const loc = r.status >= 300 && r.status < 400 && r.headers.location; if (!loc) break
    cur = new URL(loc, cur).toString(); if (out.includes(cur)) break; out.push(cur)
  }
  return out
}
async function google(urls) {
  if (keyMode() === 'webrisk') {
    const hits = {}
    await Promise.all(urls.map(async (u) => {
      const r = await axios.get('https://webrisk.googleapis.com/v1/uris:search', { params: { uri: u, threatTypes: THREATS, key: process.env.GOOGLE_WEB_RISK_API_KEY }, paramsSerializer: { indexes: null }, timeout: 10000 })
      if (r.data?.threat?.threatTypes?.length) hits[u] = r.data.threat.threatTypes
    }))
    return hits
  }
  const r = await axios.post('https://safebrowsing.googleapis.com/v4/threatMatches:find', { client: { clientId: 'cloudivr-bulksms', clientVersion: '1.0' }, threatInfo: { threatTypes: THREATS, platformTypes: ['ANY_PLATFORM'], threatEntryTypes: ['URL'], threatEntries: urls.map(url => ({ url })) } }, { params: { key: process.env.GOOGLE_SAFE_BROWSING_API_KEY }, timeout: 10000 })
  const hits = {}; for (const m of r.data?.matches || []) (hits[m.threat?.url] ||= []).push(m.threatType)
  return hits
}
function fake(urls) {
  if (process.env.BULK_ESIM_FAKE_URLCHECK_DOWN === '1') throw Object.assign(new Error('Google check unavailable (simulated)'), { status: 503 })
  const list = String(process.env.BULK_ESIM_FAKE_FLAGGED || '').split(',').filter(Boolean)
  const hits = {}; for (const u of urls) if (/flagged-test/i.test(u) || list.some(x => u.toLowerCase().includes(x.toLowerCase()))) hits[u] = ['SOCIAL_ENGINEERING']
  return hits
}
// links: as written in the text. → { flagged: [{ link, url, threats }], checked, unavailable, error }
async function checkLinks(links, { dry = false, fresh = false } = {}) {
  const uniq = [...new Set(links.map(l => String(l).trim()).filter(Boolean))], flagged = []
  if (!uniq.length) return { flagged, checked: 0, unavailable: false }
  const isLive = live(dry), plan = []
  for (const link of uniq) {
    const c = !fresh && cache.get(link.toLowerCase())
    if (c && Date.now() - c.at < TTL) { if (c.threats) flagged.push({ link, url: c.url, threats: c.threats }); continue }
    plan.push({ link, urls: isLive || process.env.BULK_ESIM_URLCHECK_FOLLOW === 'true' ? await chain(withScheme(link)) : [withScheme(link)] })
  }
  if (!plan.length) return { flagged, checked: uniq.length, unavailable: false }
  let hits
  try { hits = isLive ? await google([...new Set(plan.flatMap(p => p.urls))]) : fake(plan.flatMap(p => p.urls)) } catch (e) { return { flagged, checked: uniq.length, unavailable: true, error: e.response ? `HTTP ${e.response.status}` : e.message } }
  for (const p of plan) {
    const bad = p.urls.find(u => hits[u]), threats = bad ? hits[bad] : null
    cache.set(p.link.toLowerCase(), { at: Date.now(), url: bad || null, threats })
    if (threats) flagged.push({ link: p.link, url: bad, threats })
  }
  return { flagged, checked: uniq.length, unavailable: false }
}
const clearCache = () => cache.clear()

module.exports = { checkLinks, chain, publicHost, clearCache, keyMode }
