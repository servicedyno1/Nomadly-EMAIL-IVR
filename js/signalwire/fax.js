'use strict'
// SignalWire fax: fax-only numbers (USA/Canada), sending through the Compatibility Faxes API, receiving via LaML <Receive>.
const crypto = require('crypto')
const rest = require('./rest')

const log = (...a) => console.log('[SignalWire Fax]', ...a)
const enabled = () => rest.enabled() && String(process.env.FAX_PROVIDER || 'signalwire').toLowerCase() === 'signalwire'
const isSwFax = (id) => /^FX[0-9a-f]{32}$/i.test(String(id || '')) || String(id || '').startsWith('swfax:')
const laml = () => `/api/laml/2010-04-01/Accounts/${process.env.SIGNALWIRE_PROJECT_ID}`
const form = (o) => new URLSearchParams(Object.entries(o).filter(([, v]) => v != null && v !== ''))
const fhdr = { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }

// Signed, short-lived link SignalWire fetches the PDF from.
const sign = (s) => crypto.createHmac('sha256', String(process.env.SIGNALWIRE_SIGNING_KEY || process.env.SIGNALWIRE_API_TOKEN || '')).update(String(s)).digest('hex').slice(0, 32)
const mediaUrl = (fileId, ttlMs = 2 * 3600000) => { const exp = Date.now() + ttlMs; return `${rest.liveUrl()}/signalwire/fax-media/${fileId}?e=${exp}&k=${sign(`${fileId}.${exp}`)}` }
const mediaOk = (fileId, e, k) => Number(e) > Date.now() && typeof k === 'string' && k.length === 32 && crypto.timingSafeEqual(Buffer.from(k), Buffer.from(sign(`${fileId}.${e}`)))

async function searchFax(country, areaCode, limit = 12) {
  const rows = await rest.searchNumbers(country, 'local', areaCode, limit)
  return rows.filter(n => n._capabilities?.fax).map(n => ({
    phoneNumber: n.phone_number,
    nearby: !!areaCode && (n._areaFallback || String(n.phone_number).slice(2, 5) !== areaCode),
    region: (n.region_information || []).filter(r => r.region_type !== 'country_code').map(r => r.region_name).filter(Boolean).join(', '),
  }))
}

const faxHandler = () => ({
  call_handler: 'laml_webhooks', call_receive_mode: 'fax',
  call_request_url: `${rest.liveUrl()}/signalwire/fax-inbound`, call_request_method: 'POST',
})
// Buys the number and points it at fax receiving only — no calls, no texts.
async function orderFax(phoneNumber) {
  const n = (await rest.http().post('/api/relay/rest/phone_numbers', { number: phoneNumber })).data
  await rest.http().put(`/api/relay/rest/phone_numbers/${n.id}`, faxHandler())
  log(`bought fax number ${phoneNumber} (${n.id})`)
  return { id: `sw:${n.id}` }
}
const releaseFax = (phoneNumber) => rest.releaseByPhoneNumber(phoneNumber)

async function sendFax({ from, to, fileId }) {
  const r = (await rest.http().post(`${laml()}/Faxes`, form({ From: from, To: to, MediaUrl: mediaUrl(fileId), Quality: 'fine', StatusCallback: `${rest.liveUrl()}/signalwire/fax-status` }), fhdr)).data
  return r.sid
}
const getFax = async (sid) => (await rest.http().get(`${laml()}/Faxes/${sid}`)).data

// LaML status → Telnyx-shaped event for fax-service.handleEvent
const FAIL = { busy: 'user_busy', 'no-answer': 'no_answer', canceled: 'service_unavailable' }
function statusEvent(b = {}) {
  const st = String(b.FaxStatus || b.Status || '').toLowerCase()
  const payload = { fax_id: b.FaxSid, from: b.From, to: b.To, page_count: Number(b.NumPages) || undefined }
  if (st === 'delivered') return { event_type: 'fax.delivered', payload }
  if (['failed', 'busy', 'no-answer', 'canceled'].includes(st)) return { event_type: 'fax.failed', payload: { ...payload, failure_reason: FAIL[st] || String(b.ErrorMessage || b.ErrorCode || 'fax_communication_error').toLowerCase().replace(/\s+/g, '_') } }
  return { event_type: `fax.${st || 'queued'}`, payload }
}
const receivedEvent = (b = {}) => ({ event_type: 'fax.received', payload: { fax_id: b.FaxSid, from: b.From, to: b.To, media_url: b.MediaUrl, page_count: Number(b.NumPages) || undefined, status: b.FaxStatus } })
const receiveLaml = () => `<?xml version="1.0" encoding="UTF-8"?><Response><Receive action="${rest.liveUrl()}/signalwire/fax-received" method="POST" mediaType="application/pdf"/></Response>`
const isSwMedia = (url) => !!rest.host() && String(url || '').includes(rest.host())
const download = async (url) => Buffer.from((await rest.http().get(url, { responseType: 'arraybuffer', timeout: 30000 })).data)

module.exports = { enabled, isSwFax, searchFax, orderFax, releaseFax, sendFax, getFax, statusEvent, receivedEvent, receiveLaml, mediaUrl, mediaOk, isSwMedia, download, faxHandler }
