// Bird caller-ID auto-verify: spoken/numeric code extraction + arm → capture-from-recording → submit, with Bird and
// Whisper stubbed. Run from /app.
require('dotenv').config({ path: '/app/backend/.env' })
const { MongoClient } = require('mongodb')
const { createBirdVerify, extractCode } = require('../bird-callerid-verify')
let pass = 0, fail = 0
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log(`${c ? '✅' : '❌'} ${n}${x ? ` — ${x}` : ''}`) }

// Stubbed Bird: accepts code 123456 as correct.
const birdState = { started: [], submitted: [] }
const bird = {
  enabled: () => true,
  startCallerIdVerification: async (n) => { birdState.started.push(n); return { id: `vn_${birdState.started.length}`, status: 'calling' } },
  submitCallerIdCode: async (id, code) => { birdState.submitted.push({ id, code }); return code === '123456' ? { id, status: 'verified', outbound_enabled: true } : { error: 'invalid code', status: 'calling' } },
  listCallerIds: async () => [{ phone_number: '+12074892004', outbound_enabled: true }, { phone_number: '+13125550000', outbound_enabled: false }],
}
let transcript = 'one two three four five six'
const transcribe = async () => ({ text: transcript, status: 'done' })

;(async () => {
  // extractCode variants
  ok('extract spoken digits', extractCode('your code is one two three four five six') === '123456')
  ok('extract plain 6-digit', extractCode('Code: 482913.') === '482913')
  ok('extract spaced digits', extractCode('4 8 2 9 1 3') === '482913')
  ok('extract with homophones', extractCode('for ate two nine oh six') === '482906')
  ok('no code → null', extractCode('welcome to the system') === null)

  const cl = await MongoClient.connect(process.env.MONGO_URL), db = cl.db(process.env.DB_NAME)
  const N = '+14155550133'
  await db.collection('birdCallerIdVerify').deleteOne({ _id: N })
  const V = createBirdVerify({ bird, transcribe, db, log: () => {}, maxAttempts: 3 })
  try {
    const a = await V.arm(N)
    ok('arm starts Bird call + stores record', a.verifiedNumberId === 'vn_1' && await V.isArmed(N), JSON.stringify(a))

    // wrong code first (bad transcript) → retry, not verified
    transcript = 'nine nine nine nine nine nine'
    let r = await V.captureFromRecording(N, Buffer.from('x'))
    ok('wrong code → retry, submitted to Bird', r.status === 'retry' && birdState.submitted.at(-1).code === '999999')

    // correct code → verified
    transcript = 'the code is 1 2 3 4 5 6'
    r = await V.captureFromRecording(N, Buffer.from('x'))
    ok('correct code → verified + outbound enabled', r.status === 'verified' && r.outbound_enabled)
    ok('no longer armed once verified', !(await V.isArmed(N)))

    // unreadable transcript counts as an attempt, fails after max
    await db.collection('birdCallerIdVerify').updateOne({ _id: N }, { $set: { status: 'calling', attempts: 2, expiresAt: new Date(Date.now() + 60000) } })
    transcript = 'sorry we could not reach you'
    r = await V.captureFromRecording(N, Buffer.from('x'))
    ok('unreadable at max attempts → failed', r.status === 'failed')

    ok('verifiedPresenters lists only outbound-enabled', JSON.stringify(await V.verifiedPresenters()) === JSON.stringify(['+12074892004']))
  } finally {
    await db.collection('birdCallerIdVerify').deleteOne({ _id: N })
    await cl.close()
    console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0)
  }
})()
