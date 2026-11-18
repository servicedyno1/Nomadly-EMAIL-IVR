'use strict'
// SignalWire REST: numbers, number lookup, SIP endpoints and texts. Shapes mirror telnyx-service so callers need no changes.
const axios = require('axios')

const log = (...a) => console.log('[SignalWire]', ...a)
const host = () => String(process.env.SIGNALWIRE_SPACE_URL || '').replace(/^https?:\/\//, '').replace(/\/+$/, '')
const enabled = () => !!(process.env.SIGNALWIRE_PROJECT_ID && process.env.SIGNALWIRE_API_TOKEN && host()) && String(process.env.SIGNALWIRE_ENABLED || 'true').toLowerCase() !== 'false'
const http = () => axios.create({ baseURL: `https://${host()}`, auth: { username: process.env.SIGNALWIRE_PROJECT_ID, password: process.env.SIGNALWIRE_API_TOKEN }, timeout: 15000 })
const errOf = (e) => {
  const d = e.response?.data
  const x = d?.errors?.[0]
  return String(x?.detail || x?.message || d?.message || (d && typeof d === 'object' ? JSON.stringify(d) : d) || e.message)
}

// One RELAY topic per bot brand; preview gets its own so it never takes production calls.
const brandSlug = () => String(process.env.CHAT_BOT_BRAND || 'nomadly').toLowerCase().replace(/[^a-z0-9]/g, '') || 'nomadly'
const topic = () => process.env.SIGNALWIRE_TOPIC || `${brandSlug()}${process.env.BOT_ENVIRONMENT === 'production' ? '' : '-dev'}`
const selfUrl = () => String(process.env.SELF_URL || '').replace(/\/+$/, '')
// Numbers and SIP endpoints always point at the live app, even when bought from preview.
const liveTopic = () => process.env.SIGNALWIRE_NUMBER_TOPIC || brandSlug()
const liveUrl = () => String(process.env.SIGNALWIRE_LIVE_URL || process.env.SELF_URL || '').replace(/\/+$/, '')
const smsWebhook = () => `${liveUrl()}/signalwire/sms-webhook`

let _sipDomain = null
async function sipDomain() {
  if (process.env.SIGNALWIRE_SIP_DOMAIN) return process.env.SIGNALWIRE_SIP_DOMAIN
  if (_sipDomain) return _sipDomain
  try { _sipDomain = (await http().get('/api/relay/rest/sip_profile')).data?.domain || null } catch (e) { log('sip_profile:', errOf(e)) }
  return _sipDomain
}

// ── Numbers ──
const searched = new Set() // numbers last offered from SignalWire search → buyNumber knows which provider to order from
const owned = new Map() // e164 → SignalWire phone number id
let ownedAt = 0

async function refreshOwned(force = false) {
  if (!enabled()) return owned
  if (!force && Date.now() - ownedAt < 5 * 60000 && ownedAt) return owned
  try {
    let url = '/api/relay/rest/phone_numbers?page_size=1000'
    const next = new Map()
    while (url) {
      const r = (await http().get(url)).data
      for (const n of r.data || []) next.set(n.number, n.id)
      url = r.links?.next ? String(r.links.next).replace(/^https?:\/\/[^/]+/, '') : null
    }
    owned.clear(); for (const [k, v] of next) owned.set(k, v)
    ownedAt = Date.now()
  } catch (e) { log('list numbers:', errOf(e)) }
  return owned
}
const ownsNumber = (e164) => owned.has(String(e164 || ''))

// SignalWire caps how many numbers one Space may hold. Once a buy is refused for that, its stock is hidden (file = shared
// by every app process on the box) until numbers are released, the window ends, or a buy works again.
const FULL_FILE = process.env.SIGNALWIRE_FULL_FILE || require('path').join(require('os').tmpdir(), 'signalwire-numbers-full.json')
const FULL_MS = 2 * 3600000
const AT_LIMIT = /maximum allowed phone numbers/i
let fullCache = { at: 0, v: null }
let onFull = () => {}
const readFull = () => {
  if (Date.now() - fullCache.at < 30000) return fullCache.v
  let v = null
  try { v = JSON.parse(require('fs').readFileSync(FULL_FILE, 'utf8')) } catch (_) { /* not full */ }
  fullCache = { at: Date.now(), v }
  return v
}
const isFull = () => { const f = readFull(); return !!f && f.until > Date.now() && !(ownedAt && owned.size < f.count) }
function setFull(on) {
  const v = on ? { until: Date.now() + FULL_MS, count: owned.size } : null
  if (!on && !readFull()) return
  try { if (v) require('fs').writeFileSync(FULL_FILE, JSON.stringify(v)); else require('fs').unlinkSync(FULL_FILE) } catch (_) { /* best effort */ }
  fullCache = { at: Date.now(), v }
}
const isSwSearched = (e164) => searched.has(String(e164 || ''))

// US area code → state / CA area code → province, so an out-of-stock area code falls back to in-state numbers.
// Every US state / Canadian province with its area codes (overlays included).
const AREA_CODES = {
  AL: '205 251 256 334 659 938', AK: '907', AZ: '480 520 602 623 928', AR: '327 479 501 870',
  CA: '209 213 279 310 323 341 350 369 408 415 424 442 510 530 559 562 619 626 628 650 657 661 669 707 714 738 747 760 805 818 820 831 837 840 858 909 916 925 949 951',
  CO: '303 719 720 970 983', CT: '203 475 860 959', DE: '302', DC: '202 771',
  FL: '239 305 321 324 352 386 407 448 561 645 656 689 727 728 754 772 786 813 850 863 904 941 954',
  GA: '229 404 470 478 678 706 762 770 912 943', HI: '808', ID: '208 986',
  IL: '217 224 309 312 331 447 464 618 630 708 730 773 779 815 847 861 872', IN: '219 260 317 463 574 765 812 930',
  IA: '319 515 563 641 712', KS: '316 620 785 913', KY: '270 364 502 606 859', LA: '225 318 337 504 985', ME: '207',
  MD: '227 240 301 410 443 667', MA: '339 351 413 508 617 774 781 857 978', MI: '231 248 269 313 517 586 616 679 734 810 906 947 989',
  MN: '218 320 507 612 651 763 924 952', MS: '228 601 662 769', MO: '235 314 417 557 573 636 660 816 975', MT: '406',
  NE: '308 402 531', NV: '702 725 775', NH: '603', NJ: '201 551 609 640 732 848 856 862 908 973', NM: '505 575',
  NY: '212 315 329 332 347 363 516 518 585 607 624 631 646 680 716 718 838 845 914 917 929 934',
  NC: '252 336 472 704 743 828 910 919 980 984', ND: '701', OH: '216 220 234 283 326 330 380 419 436 440 513 567 614 740 937',
  OK: '405 539 572 580 918', OR: '458 503 541 971', PA: '215 223 267 272 412 445 484 570 582 610 717 724 814 835 878', RI: '401',
  SC: '803 821 839 843 854 864', SD: '605', TN: '423 615 629 731 865 901 931',
  TX: '210 214 254 281 325 346 361 409 430 432 469 512 621 682 713 726 737 806 817 830 832 903 915 936 940 945 956 972 979',
  UT: '385 435 801', VT: '802', VA: '276 434 540 571 686 703 757 804 826 948', WA: '206 253 360 425 509 564', WV: '304 681',
  WI: '262 274 353 414 534 608 715 920', WY: '307', PR: '787 939',
  ON: '226 249 289 343 365 382 416 437 519 548 613 647 683 705 742 753 807 905 942', QC: '263 354 367 418 438 450 468 514 579 581 819 873',
  BC: '236 250 257 604 672 778', AB: '368 403 587 780 825', MB: '204 431 584', SK: '306 474 639', NS: '782 902', NB: '428 506', NL: '709 879',
}
const AREA_REGION = Object.fromEntries(Object.entries(AREA_CODES).flatMap(([st, list]) => list.split(' ').map(c => [c, st])))

async function searchNumbers(countryCode, numberType, areaCode, limit = 5) {
  const cc = String(countryCode || 'US').toUpperCase()
  if (!enabled() || !['US', 'CA'].includes(cc) || isFull()) return []
  const type = numberType === 'toll_free' || numberType === 'toll-free' ? 'toll-free' : 'local'
  const run = async (extra) => {
    try {
      const list = (await http().get('/api/relay/rest/phone_numbers/search', { params: { max_results: limit, number_type: type, ...extra } })).data?.data || []
      return list.filter(n => (type === 'toll-free' || n.country_code === cc || !n.country_code) && !owned.has(n.e164)).map(n => {
        const caps = [...new Set([...(n.capabilities || []), 'sms', 'mms'])]
        searched.add(n.e164)
        return { record_type: 'available_phone_number', phone_number: n.e164, features: caps.map(name => ({ name })),
          region_information: [...(n.region ? [{ region_type: 'state', region_name: n.region }] : []), ...(n.rate_center ? [{ region_type: 'rate_center', region_name: n.rate_center }] : []), { region_type: 'country_code', region_name: type === 'toll-free' ? cc : (n.country_code || cc) }],
          cost_information: { currency: 'USD', monthly_cost: '0', upfront_cost: '0' },
          _capabilities: { voice: caps.includes('voice'), sms: caps.includes('sms'), mms: caps.includes('mms'), fax: caps.includes('fax') }, _provider: 'signalwire', _signalwire: true }
      }).filter(n => n._capabilities.voice)
    } catch (e) { log('search:', errOf(e)); return [] }
  }
  // A plain search returns US numbers only, so Canada is searched province by province.
  const anyIn = async () => {
    if (cc !== 'CA' || type === 'toll-free') return run({})
    for (const region of ['ON', 'QC', 'BC', 'AB']) { const r = await run({ region }); if (r.length) return r }
    return []
  }
  // Exact area code first; if empty, offer other numbers in the same state; finally any available US/CA number.
  if (areaCode) {
    const exact = await run({ areacode: areaCode })
    if (exact.length) return exact
    const region = AREA_REGION[Number(areaCode)]
    const inState = region ? await run({ region }) : []
    const rows = inState.length ? inState : await anyIn()
    rows.forEach(r => { r._areaFallback = true; r._requestedAreaCode = String(areaCode); r._fallbackRegion = inState.length ? region : null })
    return rows
  }
  return anyIn()
}

const handlerBody = () => ({
  call_handler: 'relay_topic', call_relay_topic: liveTopic(),
  message_handler: 'laml_webhooks', message_request_url: smsWebhook(), message_request_method: 'POST',
})

async function configureNumber(id) {
  try { await http().put(`/api/relay/rest/phone_numbers/${id}`, handlerBody()); return true } catch (e) { log('configure number:', errOf(e)); return false }
}

// → Telnyx-shaped number order, or null
async function buyNumber(phoneNumber) {
  try {
    const n = (await http().post('/api/relay/rest/phone_numbers', { number: phoneNumber })).data
    searched.delete(phoneNumber)
    owned.set(n.number || phoneNumber, n.id)
    setFull(false)
    await configureNumber(n.id)
    log(`Bought ${phoneNumber} (${n.id}) → topic ${liveTopic()}`)
    return { id: 'sw:' + n.id, status: 'success', requirements_met: true, phone_numbers: [{ id: 'sw:' + n.id, phone_number: n.number || phoneNumber, status: 'success', requirements_status: 'requirements-met' }], _provider: 'signalwire' }
  } catch (e) {
    const why = errOf(e)
    log(`buy ${phoneNumber}:`, why)
    if (AT_LIMIT.test(why)) { await refreshOwned(true); setFull(true); try { onFull(owned.size, phoneNumber) } catch (_) { /* alert only */ } }
    return null
  }
}

async function assignNumber(phoneNumber) {
  await refreshOwned()
  const id = owned.get(phoneNumber)
  return id ? configureNumber(id) : false
}

async function releaseById(id) {
  const raw = String(id || '').replace(/^sw:/, '')
  try {
    await http().delete(`/api/relay/rest/phone_numbers/${raw}`)
    for (const [k, v] of owned) if (v === raw) owned.delete(k)
    return true
  } catch (e) { log('release:', errOf(e)); return false }
}

async function releaseByPhoneNumber(phoneNumber) {
  await refreshOwned()
  const id = owned.get(phoneNumber)
  return id ? releaseById(id) : null
}

async function listNumbers() {
  await refreshOwned(true)
  return [...owned].map(([phone_number, id]) => ({ id: 'sw:' + id, phone_number, status: 'active', _provider: 'signalwire' }))
}

// ── Number lookup: { valid, country, carrier, type: 'mobile'|'fixed line'|'voip'|'unknown' } or null when unreachable ──
const LINE = { wireless: 'mobile', mobile: 'mobile', landline: 'fixed line', voip: 'voip', 'non-fixed voip': 'voip', 'fixed voip': 'voip', tollfree: 'toll free', 'toll-free': 'toll free' }
async function lookup(e164) {
  if (!enabled()) return null
  try {
    const d = (await http().get(`/api/relay/rest/lookup/phone_number/${encodeURIComponent(e164)}`, { params: { include: 'carrier' } })).data || {}
    const lt = String(d.carrier?.linetype || d.carrier?.line_type || '').toLowerCase()
    return { valid: d.valid_number !== false, country: d.country_code || 'unknown', carrier: String(d.carrier?.lec || d.carrier?.name || 'unknown').replace(/\s+/g, ' ').trim(), type: LINE[lt] || (lt || 'unknown') }
  } catch (e) {
    if (e.response?.status === 404 || e.response?.status === 422) return { valid: false, reason: 'Number not found or invalid format' }
    log(`lookup ${e164}:`, errOf(e))
    return null
  }
}

// ── SIP endpoints (one per number, like Telnyx credentials) ──
const sipUsers = new Set()
async function loadSipUsers() {
  if (!enabled()) return
  try {
    let url = '/api/relay/rest/endpoints/sip?page_size=1000'
    while (url) {
      const r = (await http().get(url)).data
      for (const s of r.data || []) sipUsers.add(s.username)
      url = r.links?.next ? String(r.links.next).replace(/^https?:\/\/[^/]+/, '') : null
    }
  } catch (e) { log('list sip:', errOf(e)) }
}
const isSipUser = (u) => sipUsers.has(String(u || ''))

async function createSipEndpoint(username, password, phoneNumber) {
  try {
    const s = (await http().post('/api/relay/rest/endpoints/sip', {
      username, password, ...(phoneNumber ? { send_as: phoneNumber, caller_id: phoneNumber } : {}),
      encryption: 'optional', codecs: ['PCMU', 'PCMA', 'OPUS', 'G722'],
      call_handler: 'relay_topic', call_relay_topic: liveTopic(),
    })).data
    sipUsers.add(s.username || username)
    return { id: 'sw:' + s.id, sip_username: s.username || username, sip_password: password, kind: 'signalwire', sip_domain: await sipDomain() }
  } catch (e) { log(`create sip ${username}:`, errOf(e)); return null }
}

async function deleteSipEndpoint(id) {
  try {
    const raw = String(id || '').replace(/^sw:/, '')
    const s = (await http().get(`/api/relay/rest/endpoints/sip/${raw}`).catch(() => ({ data: null }))).data
    await http().delete(`/api/relay/rest/endpoints/sip/${raw}`)
    if (s?.username) sipUsers.delete(s.username)
    return true
  } catch (e) { log('delete sip:', errOf(e)); return false }
}

// ── Texts (compatibility API) → { id } | { error, code } ──
async function sendSms(from, to, text, mediaUrls = []) {
  const form = new URLSearchParams({ From: from, To: to })
  if (text) form.append('Body', text)
  for (const m of mediaUrls) form.append('MediaUrl', m)
  if (selfUrl()) form.append('StatusCallback', `${selfUrl()}/signalwire/sms-status`)
  try {
    const r = (await http().post(`/api/laml/2010-04-01/Accounts/${process.env.SIGNALWIRE_PROJECT_ID}/Messages.json`, form.toString(), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } })).data
    return { id: r.sid || null }
  } catch (e) {
    return { error: errOf(e), code: e.response?.data?.code || null, status: e.response?.status || null }
  }
}

// Inbound text webhook (LaML form) → Telnyx message.received shape for handleInboundSms
function inboundToTelnyx(b = {}) {
  const media = []
  for (let i = 0; i < Number(b.NumMedia || 0); i++) if (b[`MediaUrl${i}`]) media.push({ url: b[`MediaUrl${i}`], content_type: b[`MediaContentType${i}`] || null })
  return { data: { event_type: 'message.received', id: b.MessageSid, payload: { id: b.MessageSid, from: { phone_number: b.From }, to: [{ phone_number: b.To }], text: b.Body || '', media, direction: 'inbound', _provider: 'signalwire' } } }
}

// LaML webhook signature (X-SignalWire-Signature / X-Twilio-Signature: HMAC-SHA1 of url + sorted params, base64)
function validSignature(req) {
  const key = process.env.SIGNALWIRE_SIGNING_KEY
  if (!key) return true
  const sig = req.get('X-SignalWire-Signature') || req.get('X-Twilio-Signature')
  if (!sig) return false
  const crypto = require('crypto')
  const url = `${selfUrl().replace(/\/api$/, '')}${req.originalUrl}`
  const candidates = [url, `${selfUrl()}${req.path}`, `${selfUrl()}${req.originalUrl.replace(/^\/api/, '')}`]
  const params = req.body && typeof req.body === 'object' ? Object.keys(req.body).sort().map(k => k + req.body[k]).join('') : ''
  return candidates.some(u => crypto.createHmac('sha1', key).update(u + params).digest('base64') === sig)
}

// ── Outbound call via LaML Compatibility API (REST fallback when RELAY is offline) ──
// Returns { sid } on success or { error, code, status } on failure.
async function createRestCall(from, to, url, statusCallbackUrl) {
  if (!enabled()) return { error: 'SignalWire REST not enabled', status: 503 }
  const form = new URLSearchParams({ From: from, To: to, Url: url, Method: 'POST' })
  if (statusCallbackUrl) {
    form.append('StatusCallback', statusCallbackUrl)
    form.append('StatusCallbackEvent', 'initiated ringing answered completed')
    form.append('StatusCallbackMethod', 'POST')
  }
  try {
    const r = (await http().post(`/api/laml/2010-04-01/Accounts/${process.env.SIGNALWIRE_PROJECT_ID}/Calls.json`, form.toString(), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } })).data
    log(`REST call created: ${r.sid} from=${from} to=${to}`)
    return { sid: r.sid, _provider: 'signalwire-rest' }
  } catch (e) {
    log(`REST call failed: ${errOf(e)}`)
    return { error: errOf(e), code: e.response?.data?.code || null, status: e.response?.status || null }
  }
}

module.exports = {
  enabled, host, topic, liveTopic, liveUrl, handlerBody, brandSlug, sipDomain, http, errOf, AREA_REGION,
  searchNumbers, buyNumber, assignNumber, releaseById, releaseByPhoneNumber, listNumbers, refreshOwned, ownsNumber, ownedNumbers: () => [...owned.keys()], isSwSearched, configureNumber,
  isFull, setFull, setOnFull: (fn) => { onFull = fn },
  lookup, loadSipUsers, isSipUser, createSipEndpoint, deleteSipEndpoint,
  sendSms, inboundToTelnyx, validSignature, createRestCall,
}
