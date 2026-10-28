'use strict'
// Where a number can text, as what sender, and at what price — checked before every web-app text.
// US mobiles: needs 10DLC (business numbers) or the number on Telnyx's person-to-person (P2P) product.
// Brand-name countries: the customer's own sender name, only where no pre-registration is needed.
const axios = require('axios')

const API = 'https://api.telnyx.com/v2'
const hdr = () => ({ Authorization: `Bearer ${process.env.TELNYX_API_KEY}` })
const dry = () => process.env.WEB_CLOUDIVR_DRY_RUN === 'true'
const E164 = /^\+[1-9]\d{7,14}$/

// [dial prefix, ISO, name, mode, price]. mode: number = from your number (two-way) · brand = shows your sender name
// (no replies) · blocked = needs sender registration that takes weeks.
const COUNTRIES = [
  ['1', 'US', 'United States', 'number', 0.05], ['1', 'CA', 'Canada', 'number', 0.05],
  ['44', 'GB', 'United Kingdom', 'brand', 0.08], ['49', 'DE', 'Germany', 'brand', 0.12], ['33', 'FR', 'France', 'brand', 0.10],
  ['351', 'PT', 'Portugal', 'brand', 0.06], ['55', 'BR', 'Brazil', 'number', 0.06], ['52', 'MX', 'Mexico', 'number', 0.06],
  ['27', 'ZA', 'South Africa', 'number', 0.05], ['61', 'AU', 'Australia', 'blocked', 0.08], ['91', 'IN', 'India', 'blocked', 0.05],
  ['234', 'NG', 'Nigeria', 'blocked', 0.10], ['233', 'GH', 'Ghana', 'blocked', 0.10], ['254', 'KE', 'Kenya', 'blocked', 0.10],
  ['63', 'PH', 'Philippines', 'blocked', 0.08],
]
const BLOCKED_WHY = 'needs its sender name registered with local carriers first (takes weeks)'
const CA_AREA = new Set('204 226 236 249 250 257 263 289 306 343 354 365 367 368 382 403 416 418 428 431 437 438 450 468 474 506 514 519 548 579 581 584 587 600 604 613 639 647 672 683 705 709 742 753 778 780 782 807 819 825 867 873 879 902 905'.split(' '))
// +1 numbers outside the US and Canada (Caribbean, US territories): not offered.
const NANP_OTHER = new Set('242 246 264 268 284 340 345 441 473 649 658 664 670 671 684 721 758 767 784 787 809 829 849 868 869 876 939'.split(' '))
const TOLL_FREE = /^\+18(00|33|44|55|66|77|88)\d{7}$/
const DEFAULT_ALLOWED = ['AU', 'BR', 'CA', 'DE', 'FR', 'GB', 'GH', 'IN', 'KE', 'MX', 'NG', 'PH', 'PT', 'US', 'ZA']

function countryOf(phone) {
  const p = String(phone || '')
  if (!E164.test(p)) return null
  if (p.startsWith('+1') && NANP_OTHER.has(p.slice(2, 5))) return ['', '', 'that country', 'unknown', 0]
  if (p.startsWith('+1')) return COUNTRIES.find(c => c[1] === (CA_AREA.has(p.slice(2, 5)) ? 'CA' : 'US'))
  return COUNTRIES.filter(c => c[0] !== '1' && p.startsWith(`+${c[0]}`)).sort((a, b) => b[0].length - a[0].length)[0] || ['', '', 'that country', 'unknown', 0]
}

// Telnyx facts for one sender number, cached 10 min.
const cache = new Map()
async function facts(phone, isHosted) {
  const hit = cache.get(phone)
  if (hit && Date.now() - hit.at < 600000) return hit.v
  let v = { allowed: DEFAULT_ALLOWED, product: 'A2P', p2pEligible: false, tenDlc: false, tollFreeOk: false }
  if (!dry() && process.env.TELNYX_API_KEY) {
    const get = (u) => axios.get(`${API}/${u}`, { headers: hdr(), timeout: 10000 }).then(r => r.data).catch(() => null)
    const n = (await get(`messaging_phone_numbers/${encodeURIComponent(phone)}`))?.data
    const prof = n?.messaging_profile_id ? (await get(`messaging_profiles/${n.messaging_profile_id}`))?.data : null
    const dlc = TOLL_FREE.test(phone) ? null : await get(`10dlc/phoneNumberCampaign/${encodeURIComponent(phone)}`)
    const tf = TOLL_FREE.test(phone) ? await get(`messaging_tollfree/verification/requests?page=1&page_size=50&phone_number=${encodeURIComponent(phone)}`) : null
    v = {
      allowed: prof?.whitelisted_destinations || DEFAULT_ALLOWED,
      product: n?.messaging_product || 'A2P',
      p2pEligible: (n?.eligible_messaging_products || []).includes('P2P'),
      tenDlc: !!(dlc && (dlc.campaignId || dlc.data?.campaignId)),
      tollFreeOk: !!(tf?.records || []).some(r => /verified/i.test(r.verificationStatus || r.status || '')),
    }
    // Hosted landlines are person-to-person texting: move them to P2P as soon as Telnyx allows (no 10DLC needed then).
    if (v.product !== 'P2P' && v.p2pEligible && isHosted) {
      const ok = await axios.patch(`${API}/messaging_phone_numbers/${encodeURIComponent(phone)}`, { messaging_product: 'P2P' }, { headers: { ...hdr(), 'Content-Type': 'application/json' }, timeout: 10000 }).then(() => true).catch(() => false)
      if (ok) v.product = 'P2P'
    }
  }
  cache.set(phone, { at: Date.now(), v })
  return v
}

// One destination country for one sender → { ok, mode, price, why }
function rule(phone, f, c, senderName, isHosted) {
  const [, iso, name, mode, price] = c
  if (!iso) return { ok: false, mode: 'blocked', price: 0, why: 'Texts to this country aren’t available yet.' }
  if (!f.allowed.includes('*') && !f.allowed.includes(iso)) return { ok: false, mode: 'blocked', price, why: `Texts to ${name} aren’t switched on for this number.` }
  if (TOLL_FREE.test(phone)) {
    if (iso !== 'US' && iso !== 'CA') return { ok: false, mode: 'blocked', price, why: 'Toll-free numbers can only text the US and Canada.' }
    return f.tollFreeOk ? { ok: true, mode: 'number', price } : { ok: false, mode: 'approval', price, why: 'This toll-free number needs texting approval before it can send.' }
  }
  if (iso === 'US' && !(f.tenDlc || f.product === 'P2P')) return { ok: false, mode: 'approval', price, why: isHosted ? 'Texts to US mobiles open once the carrier clears this number for person-to-person texting — we switch it on automatically. Receiving works now.' : 'US mobile carriers need business texting approval (10DLC) for this number first. Receiving works now.' }
  if (mode === 'blocked') return { ok: false, mode, price, why: `${name} ${BLOCKED_WHY}.` }
  if (mode === 'brand' && f.product !== 'P2P') {
    if (!senderName) return { ok: false, mode: 'brand', price, why: `${name} shows a sender name instead of a number — add your sender name in Settings first.` }
    return { ok: true, mode: 'brand', price, from: senderName, why: `Shows as “${senderName}” — they can’t reply to it.` }
  }
  return { ok: true, mode: 'number', price }
}

// Overall status for a number + each country it could text.
async function reach(phone, senderName, isHosted = false) {
  const f = await facts(phone, isHosted)
  const seen = new Set()
  const countries = COUNTRIES.filter(c => !seen.has(c[1]) && seen.add(c[1])).map(c => ({ iso: c[1], name: c[2], ...rule(phone, f, c, senderName, isHosted) }))
  const okList = countries.filter(c => c.ok)
  const us = countries.find(c => c.iso === 'US')
  const status = !okList.length ? 'approval' : us.ok ? 'ready' : 'limited'
  const note = status === 'ready' ? 'Can text the US and other countries below.' : status === 'limited' ? us.why : (us.why || 'This number can’t send texts yet.')
  return { phone, status, note, receive: true, countries }
}

// Before a send: is this destination allowed, as what sender, at what price?
async function check(phone, to, senderName, isHosted = false) {
  const c = countryOf(to)
  if (!c) return { ok: false, why: 'Enter the full number with its country code, e.g. +1 312 555 0100.' }
  const r = rule(phone, await facts(phone, isHosted), c, senderName, isHosted)
  return { ...r, iso: c[1], country: c[2] }
}

module.exports = { reach, check, countryOf, COUNTRIES, TOLL_FREE, _cache: cache }
