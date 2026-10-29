'use strict'
// One place for the app's own outgoing email (sign-in codes, voicemail/SMS forwarding, hosting & VPS details,
// order notices, email-blast test sends). Provider per sender domain:
//   MAIL_PROVIDER=auto (default)  → MailerSend when the sender's domain is verified in MailerSend, else Brevo.
//   MAIL_PROVIDER=mailersend      → always MailerSend (Brevo only as fallback).
//   MAIL_PROVIDER=brevo           → never MailerSend (rollback switch).
//   MAIL_PROVIDER=zoho            → always Zoho CPaaS (ZOHO_CPAAS_API_KEY + ZOHO_CPAAS_EMAIL_URL), no fallback.
//   MAIL_PROVIDER=telnyx          → always Telnyx Email (TELNYX_API_KEY), no fallback.
// MAIL_FALLBACK=brevo (default) | off — when MailerSend refuses or fails a message, send it through Brevo instead.
// Customer mailboxes / cPanel SMTP tests and the bulk email-blast servers are NOT handled here.
const axios = require('axios')
const fs = require('fs')

const MS_API = 'https://api.mailersend.com/v1'
const BREVO_API = 'https://api.brevo.com/v3/smtp/email'
const DOMAIN_TTL_MS = 10 * 60 * 1000
const log = (...a) => console.log('[Mailer]', ...a)

const provider = () => String(process.env.MAIL_PROVIDER || 'auto').toLowerCase()
const fallbackOn = () => String(process.env.MAIL_FALLBACK || 'brevo').toLowerCase() !== 'off'
const msToken = () => process.env.MAILERSEND_API_TOKEN
const brevoKey = () => process.env.BREVO_API_KEY
const zohoOn = () => provider() === 'zoho'
const telnyxOn = () => provider() === 'telnyx'

// ── address helpers ──
// '"Name" <a@b.c>' | 'a@b.c' | { name, address|email } → { email, name }
function parseAddress(v) {
  if (!v) return null
  if (typeof v === 'object') return { email: String(v.address || v.email || '').trim(), name: v.name || undefined }
  const s = String(v).trim()
  const m = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(s)
  return m ? { email: m[2].trim(), name: m[1].trim() || undefined } : { email: s }
}
const parseList = (v) => (Array.isArray(v) ? v : String(v || '').split(',')).map(parseAddress).filter(a => a && a.email)
const domainOf = (email) => String(email || '').split('@')[1]?.toLowerCase() || ''

// ── verified MailerSend sending domains (cached) ──
let domainCache = { at: 0, set: new Set(), pending: null }
async function verifiedDomains() {
  if (!msToken()) return new Set()
  if (Date.now() - domainCache.at < DOMAIN_TTL_MS) return domainCache.set
  if (domainCache.pending) return domainCache.pending
  domainCache.pending = axios.get(`${MS_API}/domains?limit=100`, { headers: { Authorization: `Bearer ${msToken()}` }, timeout: 10000 })
    .then(r => {
      const set = new Set((r.data?.data || []).filter(d => d.is_verified).map(d => String(d.name).toLowerCase()))
      domainCache = { at: Date.now(), set, pending: null }
      return set
    })
    .catch(e => {
      log(`could not read MailerSend domains: ${e.response?.status || e.message}`)
      domainCache = { at: Date.now() - DOMAIN_TTL_MS + 60000, set: domainCache.set, pending: null } // retry in 1 min
      return domainCache.set
    })
  return domainCache.pending
}
const resetDomainCache = () => { domainCache = { at: 0, set: new Set(), pending: null } }

async function routeToMailerSend(fromEmail) {
  if (!msToken()) return false
  const p = provider()
  if (p === 'brevo') return false
  if (p === 'mailersend') return true
  return (await verifiedDomains()).has(domainOf(fromEmail))
}

// ── attachments → { filename, content (base64) } ── (content | local path | http(s) path/href, like nodemailer)
async function readAttachment(a) {
  let buf
  const url = [a.path, a.href].find(u => /^https?:/i.test(String(u || '')))
  if (a.content != null) buf = Buffer.isBuffer(a.content) ? a.content : Buffer.from(String(a.content), a.encoding === 'base64' ? 'base64' : 'utf8')
  else if (url) buf = Buffer.from((await axios.get(url, { responseType: 'arraybuffer', timeout: 20000 })).data)
  else if (a.path) buf = fs.readFileSync(a.path)
  else return null
  const name = a.filename || (url || a.path ? require('path').basename(String(url || a.path).split('?')[0]) : 'attachment')
  return { filename: name, content: buf.toString('base64') }
}

// ── MailerSend ──
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
class MailError extends Error {
  constructor(provider, status, message, code) { super(message); this.provider = provider; this.status = status; this.code = code }
}
function msErrorText(e) {
  const d = e.response?.data
  if (!d) return e.message
  const first = d.errors ? Object.values(d.errors).flat()[0] : null
  return first || d.message || e.message
}
function msPayload(m) {
  const headers = []
  let listUnsub
  for (const [name, value] of Object.entries(m.headers || {})) {
    if (/^list-unsubscribe$/i.test(name)) listUnsub = String(value)
    else if (/^list-unsubscribe-post$/i.test(name)) continue // MailerSend adds it with list_unsubscribe
    else if (/^[A-Za-z0-9-]+$/.test(name)) headers.push({ name, value: String(value) })
  }
  const body = {
    from: { email: m.from.email, ...(m.from.name ? { name: m.from.name } : {}) },
    to: m.to.map(a => ({ email: a.email, ...(a.name ? { name: a.name } : {}) })),
    subject: m.subject,
    ...(m.html ? { html: m.html } : {}),
    ...(m.text ? { text: m.text } : {}),
    ...(m.cc?.length ? { cc: m.cc.map(a => ({ email: a.email })) } : {}),
    ...(m.bcc?.length ? { bcc: m.bcc.map(a => ({ email: a.email })) } : {}),
    ...(m.replyTo ? { reply_to: { email: m.replyTo.email, ...(m.replyTo.name ? { name: m.replyTo.name } : {}) } } : {}),
    ...(m.attachments?.length ? { attachments: m.attachments.map(a => ({ filename: a.filename, content: a.content, disposition: 'attachment' })) } : {}),
    ...(headers.length ? { headers } : {}),
    ...(listUnsub ? { list_unsubscribe: listUnsub.slice(0, 990) } : {}),
  }
  if (!body.html && !body.text) body.text = ' '
  return body
}
async function sendMailerSend(m) {
  const body = msPayload(m)
  for (let attempt = 0; ; attempt++) {
    try {
      const r = await axios.post(`${MS_API}/email`, body, { headers: { Authorization: `Bearer ${msToken()}`, 'Content-Type': 'application/json' }, timeout: 20000 })
      return { ok: true, provider: 'mailersend', id: r.headers?.['x-message-id'] || null }
    } catch (e) {
      const status = e.response?.status
      const retry = (status === 429 || (status >= 500 && status < 600)) && attempt < 2
      if (retry) { await sleep(Math.min(10000, (Number(e.response?.headers?.['retry-after']) || 2 ** attempt) * 1000)); continue }
      const text = msErrorText(e)
      throw new MailError('mailersend', status || 0, text, (/#(MS\d+)/.exec(text) || [])[1] || null)
    }
  }
}

// ── Zoho CPaaS (ZeptoMail engine) ──
const MIME = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', txt: 'text/plain', csv: 'text/csv', html: 'text/html', zip: 'application/zip', json: 'application/json', wav: 'audio/wav', mp3: 'audio/mpeg' }
const mimeOf = (name) => MIME[String(name).split('.').pop().toLowerCase()] || 'application/octet-stream'
const zAddr = (a) => ({ email_address: { address: a.email, ...(a.name ? { name: a.name } : {}) } })
function zohoPayload(m) {
  const mime = {}
  for (const [name, value] of Object.entries(m.headers || {})) if (/^[A-Za-z0-9-]+$/.test(name)) mime[name] = String(value)
  const body = {
    from: { address: m.from.email, ...(m.from.name ? { name: m.from.name } : {}) },
    to: m.to.map(zAddr),
    subject: m.subject,
    ...(m.html ? { htmlbody: m.html } : {}),
    ...(m.text ? { textbody: m.text } : {}),
    ...(m.cc?.length ? { cc: m.cc.map(zAddr) } : {}),
    ...(m.bcc?.length ? { bcc: m.bcc.map(zAddr) } : {}),
    ...(m.replyTo ? { reply_to: [{ address: m.replyTo.email, ...(m.replyTo.name ? { name: m.replyTo.name } : {}) }] } : {}),
    ...(m.attachments?.length ? { attachments: m.attachments.map(a => ({ name: a.filename, mime_type: mimeOf(a.filename), content: a.content })) } : {}),
    ...(Object.keys(mime).length ? { mime_headers: mime } : {}),
  }
  if (!body.htmlbody && !body.textbody) body.textbody = ' '
  return body
}
function zohoErrorText(e) {
  const err = e.response?.data?.error
  return err ? `${err.code || ''} ${err.details?.[0]?.message || err.message || ''}`.trim() : e.message
}
async function sendZoho(m) {
  if (!process.env.ZOHO_CPAAS_API_KEY || !process.env.ZOHO_CPAAS_EMAIL_URL) throw new MailError('zoho', 0, 'ZOHO_CPAAS_API_KEY / ZOHO_CPAAS_EMAIL_URL not set')
  const body = zohoPayload(m)
  for (let attempt = 0; ; attempt++) {
    try {
      const r = await axios.post(process.env.ZOHO_CPAAS_EMAIL_URL, body, { headers: { Authorization: process.env.ZOHO_CPAAS_API_KEY, 'Content-Type': 'application/json', Accept: 'application/json' }, timeout: 20000 })
      return { ok: true, provider: 'zoho', id: r.data?.request_id || null }
    } catch (e) {
      const status = e.response?.status
      if ((status === 429 || (status >= 500 && status < 600)) && attempt < 2) { await sleep(2 ** attempt * 1000); continue }
      throw new MailError('zoho', status || 0, zohoErrorText(e), e.response?.data?.error?.details?.[0]?.code || e.response?.data?.error?.code || null)
    }
  }
}

// ── Telnyx Email ──
// Telnyx Email policy: the word "crypto" (and cryptocurrency) must never appear in a message we send through it.
// Rewrites subject + text + the visible text of the HTML (tags/attributes/URLs are left as they are).
const POLICY = [
  [/\bcryptocurrencies\b/gi, 'digital currencies'], [/\bcryptocurrency\b/gi, 'digital currency'],
  [/\bcryptomonnaies\b/gi, 'monnaies numériques'], [/\bcryptomonnaie\b/gi, 'monnaie numérique'],
  [/\bcryptos\b/gi, 'digital currencies'], [/\bcrypto\b/gi, 'digital currency'],
]
const policyText = (s) => POLICY.reduce((t, [re, to]) => t.replace(re, to), String(s))
const policyHtml = (h) => String(h)
  .replace(/(^|>)([^<]+)/g, (_, a, txt) => a + policyText(txt))
  .replace(/\b(alt|title|aria-label)=("[^"]*"|'[^']*')/gi, (_, k, v) => `${k}=${policyText(v)}`)
function telnyxSafe(m) {
  return { ...m, subject: m.subject && policyText(m.subject), ...(m.text ? { text: policyText(m.text) } : {}), ...(m.html ? { html: policyHtml(m.html) } : {}), ...(m.from?.name ? { from: { ...m.from, name: policyText(m.from.name) } } : {}) }
}

function telnyxPayload(m) {
  m = telnyxSafe(m)
  const addr = (a) => ({ email: a.email, ...(a.name ? { name: a.name } : {}) })
  const headers = {}
  for (const [name, value] of Object.entries(m.headers || {})) if (/^[A-Za-z0-9-]+$/.test(name)) headers[name] = String(value)
  const body = {
    from: addr(m.from),
    to: m.to.map(addr),
    subject: m.subject,
    ...(m.html ? { html_body: m.html } : {}),
    ...(m.text ? { text_body: m.text } : {}),
    ...(m.cc?.length ? { cc: m.cc.map(addr) } : {}),
    ...(m.bcc?.length ? { bcc: m.bcc.map(addr) } : {}),
    ...(m.replyTo ? { reply_to: addr(m.replyTo) } : {}),
    ...(m.attachments?.length ? { attachments: m.attachments.map(a => ({ filename: a.filename, content_type: mimeOf(a.filename), content: a.content })) } : {}),
    ...(Object.keys(headers).length ? { headers } : {}),
  }
  if (!body.html_body && !body.text_body) body.text_body = ' '
  return body
}
async function sendTelnyx(m) {
  if (!process.env.TELNYX_API_KEY) throw new MailError('telnyx', 0, 'TELNYX_API_KEY is not set')
  const body = telnyxPayload(m)
  for (let attempt = 0; ; attempt++) {
    try {
      const r = await axios.post('https://api.telnyx.com/v2/email_messages', body, { headers: { Authorization: `Bearer ${process.env.TELNYX_API_KEY}`, 'Content-Type': 'application/json' }, timeout: 20000 })
      return { ok: true, provider: 'telnyx', id: r.data?.data?.id || null }
    } catch (e) {
      const status = e.response?.status
      if ((status === 429 || (status >= 500 && status < 600)) && attempt < 2) { await sleep(Math.min(10000, (Number(e.response?.headers?.['retry-after']) || 2 ** attempt) * 1000)); continue }
      const err = e.response?.data?.errors?.[0]
      throw new MailError('telnyx', status || 0, err ? `${err.title || ''}: ${err.detail || ''}`.trim() : e.message, err?.code || null)
    }
  }
}

// ── Brevo (API) ──
async function sendBrevo(m) {
  if (!brevoKey()) throw new MailError('brevo', 0, 'BREVO_API_KEY is not set')
  const body = {
    sender: { email: m.from.email, name: m.from.name || process.env.CHAT_BOT_BRAND || 'Nomadly' },
    to: m.to.map(a => ({ email: a.email, ...(a.name ? { name: a.name } : {}) })),
    subject: m.subject,
    ...(m.html ? { htmlContent: m.html } : {}),
    ...(m.text ? { textContent: m.text } : {}),
    ...(m.cc?.length ? { cc: m.cc.map(a => ({ email: a.email })) } : {}),
    ...(m.bcc?.length ? { bcc: m.bcc.map(a => ({ email: a.email })) } : {}),
    ...(m.replyTo ? { replyTo: { email: m.replyTo.email } } : {}),
    ...(m.attachments?.length ? { attachment: m.attachments.map(a => ({ name: a.filename, content: a.content })) } : {}),
    ...(m.headers && Object.keys(m.headers).length ? { headers: m.headers } : {}),
  }
  if (!body.htmlContent && !body.textContent) body.textContent = ' '
  try {
    const r = await axios.post(BREVO_API, body, { headers: { 'api-key': brevoKey() }, timeout: 20000 })
    return { ok: true, provider: 'brevo', id: r.data?.messageId || null }
  } catch (e) {
    throw new MailError('brevo', e.response?.status || 0, e.response?.data?.message || e.message)
  }
}

// Normalised message → { ok, provider, id }. Throws MailError when every provider failed.
// opts.smtpFallback(original) — used by the SMTP shim to keep the old SMTP relay as the Brevo route.
async function deliver(m, opts = {}) {
  if (telnyxOn()) {
    try { return await sendTelnyx(m) } catch (e) { log(`Telnyx refused "${m.subject}" → ${m.to.map(a => a.email).join(',')}: ${e.status} ${e.message}`); throw e }
  }
  if (zohoOn()) {
    try { return await sendZoho(m) } catch (e) { log(`Zoho refused "${m.subject}" → ${m.to.map(a => a.email).join(',')}: ${e.status} ${e.message}`); throw e }
  }
  const viaMs = await routeToMailerSend(m.from.email)
  const brevo = () => (opts.smtpFallback ? opts.smtpFallback() : sendBrevo(m))
  if (!viaMs) return brevo()
  try {
    return await sendMailerSend(m)
  } catch (e) {
    log(`MailerSend refused "${m.subject}" → ${m.to.map(a => a.email).join(',')}: ${e.status} ${e.message}`)
    if (!fallbackOn() || (!brevoKey() && !opts.smtpFallback)) throw e
    const r = await brevo()
    log(`sent through Brevo instead (${e.code || e.status})`)
    return r
  }
}

async function normalise({ from, to, cc, bcc, replyTo, subject, html, text, attachments, headers }) {
  const f = parseAddress(from)
  if (!f?.email) throw new MailError('none', 0, 'from address missing')
  const rcpt = parseList(to)
  if (!rcpt.length) throw new MailError('none', 0, 'recipient missing')
  return {
    from: f, to: rcpt, cc: parseList(cc), bcc: parseList(bcc), replyTo: parseAddress(replyTo),
    subject: String(subject || ''), html: html || '', text: text || '',
    attachments: (await Promise.all((attachments || []).map(readAttachment))).filter(Boolean), headers: headers || {},
  }
}

// send({ from, to, subject, html, text?, attachments?: [{ filename, content|path }], headers?, replyTo?, cc?, bcc? })
const send = async (msg) => deliver(await normalise(msg))

// Drop-in for nodemailer.createTransport(smtpOptions): same sendMail(), but routed through deliver().
// The original SMTP transport stays the "Brevo" route, so domains not on MailerSend behave exactly as before.
function transport(smtpOptions) {
  let smtp = null
  const smtpT = () => (smtp = smtp || require('nodemailer').createTransport(smtpOptions))
  const viaSmtp = (mail) => smtpT().sendMail(mail)
  return {
    sendMail: async (mail, cb) => {
      try {
        const r = await deliver(await normalise(mail), { smtpFallback: () => viaSmtp(mail) })
        const info = r.provider ? { messageId: r.id, provider: r.provider, accepted: parseList(mail.to).map(a => a.email), response: `250 queued via ${r.provider}` } : r
        if (cb) cb(null, info)
        return info
      } catch (e) { if (cb) return cb(e); throw e }
    },
    // MailerSend: the token answers; otherwise the real SMTP check.
    verify: async () => (telnyxOn() ? !!process.env.TELNYX_API_KEY : zohoOn() ? !!process.env.ZOHO_CPAAS_API_KEY : msToken() && provider() !== 'brevo' ? (await axios.get(`${MS_API}/api-quota`, { headers: { Authorization: `Bearer ${msToken()}` }, timeout: 10000 }), true) : smtpT().verify()),
  }
}

module.exports = { send, transport, deliver, normalise, msPayload, zohoPayload, telnyxPayload, parseAddress, parseList, verifiedDomains, resetDomainCache, MailError }
