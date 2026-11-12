'use strict'
// AWS number validation (AWS End User Messaging / Pinpoint) → { valid, type, carrier, country } | null
const { PinpointClient, PhoneNumberValidateCommand } = require('@aws-sdk/client-pinpoint')

const region = () => (/^[a-z]{2}-[a-z]+-\d$/.test(process.env.AWS_REGION || '') ? process.env.AWS_REGION : 'us-east-1')
const enabled = () => !!(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) && String(process.env.AWS_LOOKUP_ENABLED || 'true') !== 'false'
let client = null
const pp = () => (client ||= new PinpointClient({ region: region() }))
const TYPE = { MOBILE: 'mobile', LANDLINE: 'landline', VOIP: 'voip', PREPAID: 'mobile', TOLLFREE: 'toll_free', INVALID: 'invalid', OTHER: 'unknown' }

async function lookup(number) {
  if (!enabled()) return null
  const n = `+${String(number || '').replace(/[^\d]/g, '')}`
  try {
    const r = (await module.exports._send(new PhoneNumberValidateCommand({ NumberValidateRequest: { PhoneNumber: n } }))).NumberValidateResponse || {}
    const type = TYPE[r.PhoneType] || 'unknown'
    return { valid: type !== 'invalid', type, carrier: r.Carrier || 'unknown', country: r.CountryCodeIso2 || 'unknown', _provider: 'aws' }
  } catch (e) { console.log('[AWS] lookup:', e.name, e.message); return null }
}

module.exports = { enabled, lookup, region, _send: (cmd) => pp().send(cmd) }
