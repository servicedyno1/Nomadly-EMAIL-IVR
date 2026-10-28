'use strict'
// One place for the app's own outgoing email (sign-in codes, voicemail/SMS forwarding, hosting & VPS details,
// order notices, email-blast test sends). Provider per sender domain:
//   MAIL_PROVIDER=auto (default)  → MailerSend when the sender's domain is verified in MailerSend, else Brevo.
//   MAIL_PROVIDER=mailersend      → always MailerSend (Brevo only as fallback).
//   MAIL_PROVIDER=brevo           → never MailerSend (rollback switch).
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

// ── attachments → { filename, contentBase64 } ──
function readAttachment(a) {
  let buf
  if (a.content != null) buf = Buffer.isBuffer(a.content) ? a.content : Buffer.from(String(a.content), a.encoding === 'base64' ? 'base64' : 'utf8')
  else if (a.path && !/^https?:/i.test(a.path)) buf = fs.readFileSync(a.path)
  else return null
  return { filename: a.filename || (a.path ? require('path').basename(a.path) : 'attachment'), content: buf.toString('base64') }
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

function normalise({ from, to, cc, bcc, replyTo, subject, html, text, attachments, headers }) {
  const f = parseAddress(from)
  if (!f?.email) throw new MailError('none', 0, 'from address missing')
  const rcpt = parseList(to)
  if (!rcpt.length) throw new MailError('none', 0, 'recipient missing')
  return {
    from: f, to: rcpt, cc: parseList(cc), bcc: parseList(bcc), replyTo: parseAddress(replyTo),
    subject: String(subject || ''), html: html || '', text: text || '',
    attachments: (attachments || []).map(readAttachment).filter(Boolean), headers: headers || {},
  }
}

// send({ from, to, subject, html, text?, attachments?: [{ filename, content|path }], headers?, replyTo?, cc?, bcc? })
const send = (msg) => deliver(normalise(msg))

// Drop-in for nodemailer.createTransport(smtpOptions): same sendMail(), but routed through deliver().
// The original SMTP transport stays the "Brevo" route, so domains not on MailerSend behave exactly as before.
function transport(smtpOptions) {
  let smtp = null
  const viaSmtp = (mail) => { smtp = smtp || require('nodemailer').createTransport(smtpOptions); return smtp.sendMail(mail) }
  return {
    sendMail: async (mail, cb) => {
      try {
        const r = await deliver(normalise(mail), { smtpFallback: () => viaSmtp(mail) })
        const info = r.provider ? { messageId: r.id, provider: r.provider, accepted: parseList(mail.to).map(a => a.email), response: `250 queued via ${r.provider}` } : r
        if (cb) cb(null, info)
        return info
      } catch (e) { if (cb) return cb(e); throw e }
    },
    verify: async () => true,
  }
}

module.exports = { send, transport, deliver, normalise, msPayload, parseAddress, parseList, verifiedDomains, resetDomainCache, MailError }
