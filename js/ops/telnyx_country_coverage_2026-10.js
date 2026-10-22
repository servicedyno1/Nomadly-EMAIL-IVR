#!/usr/bin/env node
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// READ-ONLY Telnyx coverage audit for the countries the bot used to sell via
// Twilio (phone-config.js twilioCountries + "More Countries").
// For every country × number type it reports:
//   • Telnyx coverage (country_coverage)         — does Telnyx list this type?
//   • Live inventory (available_phone_numbers)    — count, voice / sms, price
//   • Ordering requirements (regulatory_requirements, action=ordering)
// No purchases, reservations or writes of any kind.
//
// Usage: node js/ops/telnyx_country_coverage_2026-10.js [--out=/path.json] [--only=GB,IE]
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const path = require('path')
require('dotenv').config({ path: path.resolve(__dirname, '../../backend/.env') })
const axios = require('axios')

const KEY = process.env.TELNYX_API_KEY
if (!KEY) { console.error('TELNYX_API_KEY missing'); process.exit(1) }
const B = 'https://api.telnyx.com/v2'
const H = { Authorization: `Bearer ${KEY}` }
const TYPES = ['local', 'mobile', 'toll_free', 'national']

// Twilio catalog as it was shown in the bot (code → { name, types, prices, addrReq })
const { NO_COMPLIANCE_COUNTRIES } = require('../twilio-service.js')
const TWILIO_CODES = ['GB', 'IE', 'IL', 'AU', 'NZ', 'HK', 'NL', 'IT',
  'PR', 'TN', 'FI', 'MX', 'CO', 'BG', 'CZ', 'EE', 'ID', 'KE', 'MY', 'PL', 'RO', 'SK', 'ZA', 'TH']

const args = Object.fromEntries(process.argv.slice(2).map(a => a.replace(/^--/, '').split('=')))
const only = args.only ? args.only.split(',').map(s => s.trim().toUpperCase()) : null
const OUT = args.out || path.resolve(__dirname, '../../memory/telnyx_country_coverage_2026-10-22.json')

const sleep = ms => new Promise(r => setTimeout(r, ms))
async function get(url, params, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await axios.get(`${B}${url}`, { headers: H, params, timeout: 30000 })
      await sleep(200)
      return { ok: true, data: r.data }
    } catch (e) {
      const st = e.response?.status
      if (st === 429 || st >= 500) { await sleep(1500 * (i + 1)); continue }
      return { ok: false, status: st, err: e.response?.data?.errors?.[0]?.detail || e.message }
    }
  }
  return { ok: false, status: 429, err: 'rate limited' }
}

const reqCategory = (ft) => ({ address: 'Address', document: 'Document', textual: 'Text' }[ft] || ft || '?')

async function auditCountry(code) {
  const tw = NO_COMPLIANCE_COUNTRIES.find(c => c.code === code) || { name: code, types: [], prices: {} }
  const cov = await get(`/country_coverage/countries/${code}`)
  const covData = cov.ok ? Object.values(cov.data?.data || {})[0] || {} : {}
  const covTypes = Array.isArray(covData.phone_number_type) ? [...new Set(covData.phone_number_type)] : []
  const rows = []
  for (const type of TYPES) {
    const isTwilioType = tw.types.includes(type)
    const listed = covTypes.includes(type)
    if (!isTwilioType && !listed) continue // nothing to compare
    const av = await get('/available_phone_numbers', {
      'filter[country_code]': code, 'filter[phone_number_type]': type, 'filter[limit]': 10,
    })
    const nums = av.ok ? (av.data?.data || []) : []
    const has = (n, f) => (n.features || []).some(x => x.name === f)
    const voice = nums.filter(n => has(n, 'voice'))
    const voiceSms = nums.filter(n => has(n, 'voice') && has(n, 'sms'))
    const monthly = voice.map(n => parseFloat(n.cost_information?.monthly_cost)).filter(x => !isNaN(x))
    const upfront = voice.map(n => parseFloat(n.cost_information?.upfront_cost)).filter(x => !isNaN(x))
    const rq = await get('/regulatory_requirements', {
      'filter[country_code]': code, 'filter[phone_number_type]': type, 'filter[action]': 'ordering',
    })
    const reqs = rq.ok
      ? (rq.data?.data || []).flatMap(d => d.regulatory_requirements || []).map(r => ({ name: r.name, field_type: r.field_type }))
      : null
    rows.push({
      type,
      twilioSoldThisType: isTwilioType,
      twilioMonthlyPrice: tw.prices?.[type] ?? null,
      telnyxCoverageListsType: listed,
      telnyxCoverageFeatures: covData?.[type]?.features || [],
      searchOk: av.ok, searchErr: av.ok ? null : `${av.status} ${av.err}`,
      availableCount: nums.length,
      voiceCapable: voice.length,
      voiceAndSms: voiceSms.length,
      sampleNumber: (voice[0] || nums[0])?.phone_number || null,
      telnyxMonthlyUSD: monthly.length ? Math.min(...monthly) : null,
      telnyxUpfrontUSD: upfront.length ? Math.min(...upfront) : null,
      quickship: voice.some(n => n.quickship),
      reservable: voice.some(n => n.reservable),
      requirements: reqs,
      requirementCategories: reqs ? [...new Set(reqs.map(r => reqCategory(r.field_type)))] : null,
      reqErr: rq.ok ? null : `${rq.status} ${rq.err}`,
    })
  }
  return { code, name: tw.name, twilioTypes: tw.types, twilioAddrReq: tw.addrReq || ['none'],
    telnyxCoverage: cov.ok ? { numbers: covData.numbers, types: covTypes, region: covData.region } : { error: `${cov.status} ${cov.err}` },
    rows }
}

;(async () => {
  const codes = only || TWILIO_CODES
  const report = { generatedAt: new Date().toISOString(), note: 'READ-ONLY Telnyx coverage audit vs former Twilio catalog', countries: [] }
  for (const c of codes) {
    process.stderr.write(`… ${c}\n`)
    report.countries.push(await auditCountry(c))
  }
  require('fs').writeFileSync(OUT, JSON.stringify(report, null, 2))
  // Compact table
  const pad = (s, n) => String(s ?? '').padEnd(n)
  console.log(pad('CC', 4) + pad('type', 10) + pad('TW', 4) + pad('TW$/mo', 8) + pad('TX stock', 9) + pad('voice', 6) + pad('v+sms', 6) + pad('TX$/mo', 8) + pad('TX$ up', 8) + 'ordering requirements')
  for (const c of report.countries) {
    for (const r of c.rows) {
      const req = r.requirements == null ? `ERR ${r.reqErr}` : (r.requirements.length ? r.requirements.map(x => `${x.name} [${reqCategory(x.field_type)}]`).join('; ') : 'NONE')
      console.log(pad(c.code, 4) + pad(r.type, 10) + pad(r.twilioSoldThisType ? 'Y' : '-', 4) + pad(r.twilioMonthlyPrice ?? '', 8) +
        pad(r.searchOk ? r.availableCount : 'ERR', 9) + pad(r.voiceCapable, 6) + pad(r.voiceAndSms, 6) +
        pad(r.telnyxMonthlyUSD ?? '', 8) + pad(r.telnyxUpfrontUSD ?? '', 8) + req.slice(0, 260))
    }
  }
  console.log(`\nSaved → ${OUT}`)
})().catch(e => { console.error(e); process.exit(1) })
