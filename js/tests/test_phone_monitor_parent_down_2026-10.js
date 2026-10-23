// PhoneMonitor: Twilio parent account down → no sub-account polls, one admin alert/day; a sub that 401s is not re-polled that day.
process.env.TWILIO_ACCOUNT_SID = 'ACparent'; process.env.TWILIO_AUTH_TOKEN = 'tok'; process.env.TELEGRAM_ADMIN_CHAT_ID = '1'
const path = require('path')
const axiosPath = require.resolve('axios', { paths: [path.join(__dirname, '..')] })
let parentActive = false, calls = []
require.cache[axiosPath] = { id: axiosPath, filename: axiosPath, loaded: true, exports: { get: async (url) => {
  calls.push(url)
  const e401 = () => { const e = new Error('401'); e.response = { status: 401, data: { message: 'account ACparent with status 4 is not active' } }; return e }
  if (url.endsWith('/Accounts/ACparent.json')) { if (!parentActive) throw e401(); return { data: { status: 'active' } } }
  if (url.endsWith('/Accounts/ACbad.json')) throw e401()
  if (/\/Accounts\/AC\w+\.json$/.test(url)) return { data: { sid: 'x', status: 'active' } }
  return { data: {} }
} } }
const { runHealthCheck } = require('../phone-monitor')

function coll(docs = []) {
  return {
    docs,
    find: () => ({ toArray: async () => docs }),
    findOne: async (q) => docs.find(d => Object.entries(q).every(([k, v]) => d[k] === v)) || null,
    insertOne: async (d) => { docs.push(d) },
    updateOne: async () => {},
  }
}
let pass = 0, fail = 0
const ok = (n, c, x) => { if (c) { pass++; console.log(`  ✅ ${n}`) } else { fail++; console.log(`  ❌ ${n}`, x !== undefined ? JSON.stringify(x) : '') } }

;(async () => {
  const phones = coll([{ _id: 11, val: { numbers: [
    { provider: 'twilio', twilioSubAccountSid: 'ACgood', phoneNumber: '+1', status: 'active', twilioNumberSid: 'PN1', subAccountAuthToken: 't' },
    { provider: 'twilio', twilioSubAccountSid: 'ACbad', phoneNumber: '+2', status: 'active', twilioNumberSid: 'PN2', subAccountAuthToken: 't' },
  ] } }])
  const cols = { phoneNumbersOf: phones, suspensionEvents: coll(), phoneMonitorAuthFailed: coll(), state: coll() }
  const db = { collection: (n) => cols[n] || (cols[n] = coll()) }
  const sent = []
  const bot = { sendMessage: async (chat, m) => { sent.push(m) } }

  await runHealthCheck(bot, db)
  ok('parent down → only the parent is called (no sub-account polls)', calls.length === 1 && calls[0].endsWith('/Accounts/ACparent.json'), calls)
  ok('parent down → one admin alert naming the main account', sent.length === 1 && /main account is not active/.test(sent[0]), sent)
  calls = []; sent.length = 0
  await runHealthCheck(bot, db)
  ok('second run same day → no repeat alert, still no sub polls', sent.length === 0 && calls.length === 1)

  parentActive = true; calls = []; sent.length = 0
  await runHealthCheck(bot, db)
  ok('parent active → subs polled again; ACbad reported once', calls.some(u => u.endsWith('/ACgood.json')) && calls.some(u => u.endsWith('/ACbad.json')) && sent.length === 1 && /ACbad/.test(sent[0]), { calls, sent })
  ok('ACbad numbers are not SID-checked in the same run', !calls.some(u => /ACbad\/IncomingPhoneNumbers/.test(u)), calls)
  calls = []; sent.length = 0
  await runHealthCheck(bot, db)
  ok('next run same day → ACbad not polled again, ACgood still polled', !calls.some(u => /ACbad/.test(u)) && calls.some(u => u.endsWith('/ACgood.json')) && sent.length === 0, calls)

  console.log(`\n${fail ? '❌' : '✅'} phone-monitor parent-down suite: ${pass} passed / ${fail} failed`)
  process.exit(fail ? 1 : 0)
})()
