// T1: auth.sendMail routing with stubbed axios (MailerSend when verified, Brevo when not)
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', 'backend', '.env') })
process.env.CLOUDIVR_MAIL_SENDER = 'hi@cloudivr.net'
delete process.env.MAIL_PROVIDER; delete process.env.MAIL_FALLBACK
const axios = require('axios')
let verified = true
const posts = []
axios.get = async (url) => {
  if (url.includes('api.mailersend.com/v1/domains')) return { data: { data: [{ name: 'cloudivr.net', is_verified: verified }, { name: 'test-x.mlsender.net', is_verified: true }] } }
  throw new Error('unexpected GET ' + url)
}
axios.post = async (url, body) => { posts.push({ url, body }); return { status: 202, headers: { 'x-message-id': 'm1' }, data: { messageId: 'b1' } } }
const mailer = require('../mailer')
const auth = require('../cloudivr-web/auth')
;(async () => {
  let ok = 0, bad = 0
  const chk = (c, n) => { c ? ok++ : bad++; console.log(c ? 'PASS' : 'FAIL', n) }
  console.log('sendMail type:', typeof auth.sendMail, 'exports:', Object.keys(auth).filter(k => /mail/i.test(k)))
  const mp3 = Buffer.from('ID3fakeMP3data')
  const b64 = mp3.toString('base64')
  // (a) verified
  mailer.resetDomainCache(); verified = true; posts.length = 0
  let r = await auth.sendMail('rcpt@example.com', 'VM', '<p>hi</p>', [{ filename: 'voicemail.mp3', content: mp3 }])
  console.log('a result:', JSON.stringify(r), 'posts:', posts.map(p => p.url))
  const a = posts.find(p => p.url === 'https://api.mailersend.com/v1/email')
  chk(!!a && posts.length === 1, '(a) posted to MailerSend only')
  chk(a?.body.from.email === 'hi@cloudivr.net', '(a) from.email')
  chk(a?.body.from.name === 'CloudIVR', '(a) from.name CloudIVR (got ' + a?.body.from.name + ')')
  chk(a?.body.attachments?.[0]?.content === b64 && a?.body.attachments[0].filename === 'voicemail.mp3', '(a) base64 attachment')
  chk(a?.body.to?.[0]?.email === 'rcpt@example.com', '(a) to')
  // (b) not verified
  mailer.resetDomainCache(); verified = false; posts.length = 0
  r = await auth.sendMail('rcpt@example.com', 'VM', '<p>hi</p>', [{ filename: 'voicemail.mp3', content: mp3 }])
  console.log('b result:', JSON.stringify(r), 'posts:', posts.map(p => p.url))
  const b = posts.find(p => p.url === 'https://api.brevo.com/v3/smtp/email')
  chk(!!b && posts.length === 1, '(b) posted to Brevo only')
  chk(b?.body.sender?.email === 'hi@cloudivr.net', '(b) sender.email')
  console.log('(b) sender.name:', b?.body.sender?.name)
  chk(b?.body.attachment?.[0]?.content === b64 && b?.body.attachment[0].name === 'voicemail.mp3', '(b) attachment base64')
  console.log(`RESULT pass=${ok} fail=${bad}`)
  process.exit(0)
})().catch(e => { console.error('ERR', e.message); process.exit(1) })
