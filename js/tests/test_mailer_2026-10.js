// node js/tests/test_mailer_2026-10.js — js/mailer.js routing (MailerSend ↔ Brevo ↔ SMTP) with stubbed HTTP/SMTP.
'use strict'
const path = require('path')
const axios = require('axios')
const Module = require('module')

let pass = 0, fail = 0
const ok = (c, name, extra = '') => { if (c) { pass++; console.log('PASS', name) } else { fail++; console.log('FAIL', name, extra) } }

// ── stubs ──
const calls = []
let msDomains = [{ name: 'cloudivr.net', is_verified: true }, { name: 'priv.host', is_verified: false }]
let msPlan = [] // queue of responses for POST /email: { status, data?, headers? }
axios.get = async (url) => {
  calls.push({ m: 'GET', url })
  if (url.startsWith('https://files.example')) return { data: Buffer.from('REMOTE') }
  if (url.includes('api-quota')) return { data: { quota: 100 } }
  return { data: { data: msDomains } }
}
axios.post = async (url, body, cfg) => {
  calls.push({ m: 'POST', url, body, cfg })
  if (url.includes('mailersend')) {
    const r = msPlan.shift() || { status: 202, headers: { 'x-message-id': 'ms-1' } }
    if (r.status >= 400) { const e = new Error(`HTTP ${r.status}`); e.response = { status: r.status, data: r.data || {}, headers: r.headers || {} }; throw e }
    return { status: r.status, headers: r.headers || {}, data: '' }
  }
  return { status: 201, data: { messageId: 'brevo-1' } }
}
const smtpSent = []
const origLoad = Module._load
Module._load = function (req, ...rest) {
  if (req === 'nodemailer') return { createTransport: () => ({ sendMail: async (m) => { smtpSent.push(m); return { messageId: 'smtp-1' } }, verify: async () => 'smtp-verified' }) }
  return origLoad.call(this, req, ...rest)
}

process.env.MAILERSEND_API_TOKEN = 'ms_test'
process.env.BREVO_API_KEY = 'brevo_test'
delete process.env.MAIL_PROVIDER; delete process.env.MAIL_FALLBACK
const mailer = require(path.join(__dirname, '..', 'mailer'))
const reset = () => { calls.length = 0; smtpSent.length = 0; msPlan = []; mailer.resetDomainCache() }
const lastPost = (host) => calls.filter(c => c.m === 'POST' && c.url.includes(host)).pop()

;(async () => {
  // 1. verified domain → MailerSend with the right payload
  reset()
  let r = await mailer.send({ from: { name: 'CloudIVR', email: 'hi@cloudivr.net' }, to: 'a@x.com', subject: 'Voicemail', html: '<p>hi</p>',
    attachments: [{ filename: 'voicemail.mp3', content: Buffer.from('ID3abc') }],
    headers: { 'List-Unsubscribe': '<mailto:u@cloudivr.net>', 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click', 'X-Ref': '42' } })
  const ms = lastPost('mailersend')
  ok(r.provider === 'mailersend' && r.id === 'ms-1', 'verified domain → MailerSend')
  ok(ms.cfg.headers.Authorization === 'Bearer ms_test', 'bearer token')
  ok(ms.body.from.email === 'hi@cloudivr.net' && ms.body.from.name === 'CloudIVR' && ms.body.to[0].email === 'a@x.com', 'from/to mapped')
  ok(ms.body.attachments[0].content === Buffer.from('ID3abc').toString('base64') && ms.body.attachments[0].filename === 'voicemail.mp3', 'attachment base64')
  ok(ms.body.list_unsubscribe === '<mailto:u@cloudivr.net>' && ms.body.headers.length === 1 && ms.body.headers[0].name === 'X-Ref', 'list_unsubscribe + custom headers')
  ok(!lastPost('brevo'), 'Brevo not called')

  // 2. unverified domain → Brevo API (as before)
  reset()
  r = await mailer.send({ from: 'Nomadly <hosting@priv.host>', to: 'b@x.com', subject: 'Hosting', html: '<b>x</b>' })
  ok(r.provider === 'brevo' && !lastPost('mailersend') && lastPost('brevo').body.sender.email === 'hosting@priv.host', 'unverified domain → Brevo API')

  // 3. MailerSend 422 (unverified sender) → Brevo fallback
  reset(); msPlan = [{ status: 422, data: { message: 'invalid', errors: { 'from.email': ['The from.email domain must be verified in your account to send emails. #MS42207'] } } }]
  r = await mailer.send({ from: 'hi@cloudivr.net', to: 'c@x.com', subject: 's', text: 't' })
  ok(r.provider === 'brevo', '422 → falls back to Brevo')

  // 4. fallback off → error surfaces with MailerSend code
  reset(); process.env.MAIL_FALLBACK = 'off'; msPlan = [{ status: 422, data: { errors: { x: ['bad #MS42207'] } } }]
  let err = null
  try { await mailer.send({ from: 'hi@cloudivr.net', to: 'c@x.com', subject: 's', text: 't' }) } catch (e) { err = e }
  ok(err && err.provider === 'mailersend' && err.code === 'MS42207' && err.status === 422, 'MAIL_FALLBACK=off → MailError(MS42207)')
  delete process.env.MAIL_FALLBACK

  // 5. 429 then 202 → retried once, no fallback
  reset(); msPlan = [{ status: 429, headers: { 'retry-after': '0' } }, { status: 202, headers: { 'x-message-id': 'ms-2' } }]
  r = await mailer.send({ from: 'hi@cloudivr.net', to: 'd@x.com', subject: 's', html: 'h' })
  ok(r.provider === 'mailersend' && r.id === 'ms-2' && calls.filter(c => c.m === 'POST' && c.url.includes('mailersend')).length === 2, '429 retried')

  // 6. MAIL_PROVIDER=brevo → never MailerSend
  reset(); process.env.MAIL_PROVIDER = 'brevo'
  r = await mailer.send({ from: 'hi@cloudivr.net', to: 'e@x.com', subject: 's', html: 'h' })
  ok(r.provider === 'brevo' && !lastPost('mailersend'), 'MAIL_PROVIDER=brevo rollback')
  delete process.env.MAIL_PROVIDER

  // 7. SMTP shim: unverified → original SMTP relay; verified → MailerSend; MailerSend failure → SMTP
  reset()
  const t = mailer.transport({ host: 'smtp-relay.brevo.com', port: 2525 })
  let info = await t.sendMail({ from: '"Nomadly" <hosting@priv.host>', to: 'f@x.com', subject: 'VPS', html: 'h' })
  ok(info.messageId === 'smtp-1' && smtpSent.length === 1 && !lastPost('mailersend'), 'shim: unverified → SMTP relay unchanged')
  reset()
  info = await t.sendMail({ from: 'Nomadly <hosting@cloudivr.net>', to: 'g@x.com, h@x.com', subject: 'VPS', text: 'x' })
  ok(info.provider === 'mailersend' && lastPost('mailersend').body.to.length === 2 && smtpSent.length === 0, 'shim: verified → MailerSend (2 recipients)')
  reset(); msPlan = [{ status: 500 }, { status: 500 }, { status: 500 }]
  info = await t.sendMail({ from: 'hosting@cloudivr.net', to: 'i@x.com', subject: 'VPS', text: 'x' })
  ok(info.messageId === 'smtp-1' && smtpSent.length === 1, 'shim: MailerSend 5xx (after retries) → SMTP fallback')

  // 8. domain list cached between sends
  reset()
  await mailer.send({ from: 'hi@cloudivr.net', to: 'j@x.com', subject: 's', text: 't' })
  await mailer.send({ from: 'hi@cloudivr.net', to: 'k@x.com', subject: 's', text: 't' })
  ok(calls.filter(c => c.m === 'GET').length === 1, 'verified domains cached')

  // 9. no token → Brevo only
  reset(); delete process.env.MAILERSEND_API_TOKEN
  r = await mailer.send({ from: 'hi@cloudivr.net', to: 'l@x.com', subject: 's', text: 't' })
  ok(r.provider === 'brevo' && calls.filter(c => c.url.includes('mailersend')).length === 0, 'no MailerSend token → Brevo')

  // 10. http(s) attachment is downloaded (like nodemailer), verify() checks the real transport
  process.env.MAILERSEND_API_TOKEN = 'ms_test'
  reset()
  await mailer.send({ from: 'hi@cloudivr.net', to: 'm@x.com', subject: 's', text: 't', attachments: [{ path: 'https://files.example/a/voicemail.mp3?x=1' }] })
  const att = lastPost('mailersend').body.attachments[0]
  ok(att && att.filename === 'voicemail.mp3' && att.content === Buffer.from('REMOTE').toString('base64'), 'remote attachment fetched')
  ok((await mailer.transport({}).verify()) === true, 'verify() with MailerSend token checks the API')
  process.env.MAIL_PROVIDER = 'brevo'
  ok((await mailer.transport({}).verify()) === 'smtp-verified', 'verify() on Brevo route checks SMTP')
  delete process.env.MAIL_PROVIDER

  console.log(`RESULT pass=${pass} fail=${fail}`)
  process.exit(fail ? 1 : 0)
})().catch(e => { console.error(e); process.exit(1) })
