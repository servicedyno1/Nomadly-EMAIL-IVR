'use strict'
// MultiTEL fax: fax-only numbers (USA/Canada). Bought like any MultiTEL DID, then fax detection is switched on so
// received faxes land in the MultiTEL fax inbox (polled every 2 min). Sending goes through POST /v3/send_fax;
// delivery comes from the fax outbox (polled). Both are fed to fax-service as Telnyx-shaped events.
const axios = require('axios')
const FormData = require('form-data')
const mt = require('./index')

const log = (...a) => console.log('[Multitel Fax]', ...a)
const enabled = () => mt.enabled() && !mt.isBlocked() && String(process.env.FAX_PROVIDER || 'multitel').toLowerCase() === 'multitel'
const digits = (n) => String(n || '').replace(/\D/g, '')
const e164 = (n) => `+${digits(n)}`
const isMtFax = (id) => /^mtfax:|^mtin:/.test(String(id || ''))
const auth = () => ({ username: process.env.MULTITEL_USERNAME, password: process.env.MULTITEL_PASSWORD })
const day = (ms) => new Date(Date.now() - ms).toISOString().slice(0, 10)

async function searchFax(country, areaCode, limit = 12) {
  const rows = await mt.searchNumbers(country, 'local', areaCode, limit)
  return rows.filter(n => !n._assigned).map(n => ({ phoneNumber: n.phone_number, nearby: !!areaCode && String(n.phone_number).slice(2, 5) !== areaCode, region: String(n.region_information?.[0]?.region_name || '').replace(/[,\s]+$/, '') }))
}

// Buy, then fax detection on (listens 4 s for fax tones; the line is fax-only, so every call is a fax).
async function orderFax(phoneNumber) {
  const r = await mt.buyNumber(phoneNumber)
  if (!r) throw new Error('MultiTEL purchase failed')
  const d = await mt.api('post', `modifynumber/${digits(phoneNumber)}`, { faxdetect: '1', faxring: '4', description: 'CloudIVR fax' })
  if (String(d?.status?.code) !== '200') log(`fax detect on ${phoneNumber}: ${JSON.stringify(d?.status || d).slice(0, 160)}`)
  log(`bought fax number ${phoneNumber}`)
  return { id: `mt:${digits(phoneNumber)}` }
}
const releaseFax = (phoneNumber) => mt.releaseNumber(`mt:${digits(phoneNumber)}`)

async function sendFax({ from, to, pdf }) {
  const form = new FormData()
  form.append('from_number', e164(from))
  form.append('to_number', e164(to))
  form.append('fax_file', pdf, { filename: 'fax.pdf', contentType: 'application/pdf' })
  const r = await axios.post('https://api.multitel.net/v3/send_fax', form, { auth: auth(), httpsAgent: mt.ipv4, headers: form.getHeaders(), maxBodyLength: Infinity, timeout: 90000, validateStatus: () => true })
  const id = r.data?.response?.job_id
  if (String(r.data?.status?.code) !== '200' || !id) throw new Error(`send_fax ${r.status}: ${JSON.stringify(r.data?.status || r.data).slice(0, 200)}`)
  return `mtfax:${id}`
}

const list = async (box, q) => (await mt.api('get', `${box}?limit=100&date_from=${q}`))?.response?.faxes || []
const file = async (type, id) => Buffer.from((await axios.get(`https://api.multitel.net/v3/fax_file/${type}/${id}`, { auth: auth(), httpsAgent: mt.ipv4, responseType: 'arraybuffer', timeout: 60000 })).data)

// Received faxes → fax.received events (with the PDF). fax-service drops ones it already has.
async function pollInbox(onEvent, known) {
  for (const f of await list('fax_inbox', day(2 * 86400000))) {
    const id = `mtin:${f.hash}`
    if ((f.status && !/success|received|completed/i.test(f.status)) || await known(id)) continue
    const pdf = await file('inbound', f.hash).catch(e => { log(`download ${f.hash}: ${e.message}`); return null })
    if (!pdf) continue // try again on the next poll
    await onEvent({ event_type: 'fax.received', payload: { fax_id: id, from: e164(f.from_number || f.from), to: e164(f.to_number || f.to), page_count: Number(f.pages) || undefined, pdf } })
  }
}

// Sent faxes still queued → delivered / failed, matched on the outbox uuid (= send_fax job_id).
const DONE = /^(success|sent|completed|delivered)$/i, FAILED = /^(failed|error|cancel+ed|busy|no.?answer)$/i
async function pollOutbox(pending, onEvent) {
  if (!pending.length) return
  const rows = await list('fax_outbox', day(3 * 86400000))
  for (const p of pending) {
    const hit = rows.find(r => String(r.uuid || '') === String(p._id).replace(/^mtfax:/, ''))
    const st = String(hit?.status || '').trim()
    if (!hit || !(DONE.test(st) || FAILED.test(st))) continue
    const payload = { fax_id: p._id, from: p.from, to: p.to, page_count: Number(hit.pages_sent ?? hit.pages) || p.pages }
    await onEvent(DONE.test(st) ? { event_type: 'fax.delivered', payload } : { event_type: 'fax.failed', payload: { ...payload, failure_reason: String(hit.result_text || hit.status_text || 'fax_communication_error').toLowerCase().replace(/\s+/g, '_').slice(0, 60) } })
  }
}

module.exports = { enabled, isMtFax, searchFax, orderFax, releaseFax, sendFax, pollInbox, pollOutbox }
