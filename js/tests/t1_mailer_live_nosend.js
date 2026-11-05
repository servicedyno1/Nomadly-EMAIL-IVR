// T1: live no-send check — MailerSend must reject unverified cloudivr.net with 422 MS42207
process.env.MAIL_PROVIDER = 'mailersend'; process.env.MAIL_FALLBACK = 'off'
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', 'backend', '.env') })
process.env.MAIL_PROVIDER = 'mailersend'; process.env.MAIL_FALLBACK = 'off'
const mailer = require('../mailer')
;(async () => {
  let ok = 0, bad = 0
  const chk = (c, n) => { c ? ok++ : bad++; console.log(c ? 'PASS' : 'FAIL', n) }
  const set = await mailer.verifiedDomains()
  console.log('verified domains:', [...set])
  chk(set instanceof Set && set.size === 1 && /^test-.*\.mlsender\.net$/.test([...set][0]), 'only trial domain verified')
  chk(!set.has('cloudivr.net'), 'cloudivr.net not verified')
  try {
    const r = await mailer.send({ from: { name: 'CloudIVR', email: 'hi@cloudivr.net' }, to: 'test@example.com', subject: 'x', html: '<p>x</p>' })
    chk(false, 'should reject, got ' + JSON.stringify(r))
  } catch (e) {
    console.log('err:', e.provider, e.status, e.code, e.message)
    chk(e.provider === 'mailersend', 'provider mailersend')
    chk(e.status === 422, 'status 422')
    chk(e.code === 'MS42207', 'code MS42207')
    chk(e instanceof mailer.MailError, 'MailError instance')
  }
  console.log(`RESULT pass=${ok} fail=${bad}`)
})()
