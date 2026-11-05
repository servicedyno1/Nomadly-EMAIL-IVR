// Iter225 review: carrier invalid-number mapping (Telnyx mock), custom caller-ID + invalid destination, test-ring edge cases.
process.env.WEB_CLOUDIVR_DRY_RUN = 'true'
const assert = require('assert')
let pass = 0, fail = 0
const t = async (name, fn) => { try { await fn(); pass++; console.log('PASS', name) } catch (e) { fail++; console.log('FAIL', name, '-', e.message) } }

;(async () => {
  const vs = require('../voice-service')
  const sent = []
  const created = []
  let nextErr = null
  const telnyxApi = {
    createOutboundCall: async (from, to) => { created.push([from, to]); return nextErr ? { error: nextErr } : { callControlId: 'cc' + created.length } },
    isLineLimitError: (r) => /channel limit/i.test(String(r.error || '')),
    hangupCall: async () => {},
  }
  vs.initVoiceService({ bot: { sendMessage: async (c, m) => { sent.push([c, m]); return {} } }, telnyxApi, selfUrl: 'http://x' })

  // Carrier rejection messages (Telnyx 'detail' strings) → invalidNumber
  for (const detail of ['D50: Number has no valid LRN', 'The destination number is invalid', 'Unallocated number']) {
    nextErr = detail
    const r = await vs.initiateOutboundIvrCall({ chatId: 'TEST_1', callerId: '+18885550100', targetNumber: '+14155550100', greetingText: 'hi', activeKeys: ['1'], isTrial: true, provider: 'telnyx' })
    await t(`invalid mapping: "${detail}" → invalidNumber`, () => { assert.strictEqual(r.invalidNumber, true); assert.ok(/isn’t an in-service number/.test(r.error)) })
  }
  nextErr = 'Some other failure'
  const other = await vs.initiateOutboundIvrCall({ chatId: 'TEST_1', callerId: '+18885550100', targetNumber: '+14155550100', greetingText: 'hi', activeKeys: ['1'], isTrial: true, provider: 'telnyx' })
  await t('invalid mapping: unrelated error not flagged', () => assert.strictEqual(other.invalidNumber, false))

  // Custom caller ID + invalid destination: should NOT tell the user their caller ID was rejected / retry
  nextErr = 'D50: Number has no valid LRN'
  created.length = 0; sent.length = 0
  const cid = await vs.initiateOutboundIvrCall({ chatId: 'TEST_2', callerId: '+18885550100', displayCallerId: '+12125550199', targetNumber: '+14155550100', greetingText: 'hi', activeKeys: ['1'], isTrial: true, provider: 'telnyx' })
  await new Promise(r => setTimeout(r, 200))
  await t('custom CID + invalid dest: invalidNumber returned', () => assert.strictEqual(cid.invalidNumber, true))
  await t('custom CID + invalid dest: only one dial attempt (no CID retry)', () => assert.strictEqual(created.length, 1, `attempts=${created.length}`))
  await t('custom CID + invalid dest: no false "caller ID rejected" notice', () => assert.strictEqual(sent.length, 0, `messages=${sent.length}`))

  // Test ring: createOutboundCall throwing leaves the free window open
  const tmn = require('../test-my-number')
  tmn.initTestMyNumber({ post: () => {} }, { bot: { sendMessage: async () => {} }, telnyxApi: { createOutboundCall: async () => { throw new Error('network') } }, log: () => {}, getTxt: () => null })
  let threw = false
  try { await tmn.placeTestCall(1, { phoneNumber: '+14155550222', status: 'active' }, 'en') } catch (_) { threw = true }
  await t('test ring: throw from Telnyx does not leave target marked free', () => assert.strictEqual(tmn.isFreeTestRing(tmn.TRIAL_CALLER_ID, '+14155550222'), false))
  await t('test ring: throw is handled (no exception to caller)', () => assert.strictEqual(threw, false))

  // Concurrent taps: throttle must still cap at 3
  let n = 0
  tmn.initTestMyNumber({ post: () => {} }, { bot: { sendMessage: async () => {} }, telnyxApi: { createOutboundCall: async () => { n++; await new Promise(r => setTimeout(r, 20)); return { callControlId: 'p' + n } } }, log: () => {}, getTxt: () => null })
  await Promise.all([1, 2, 3, 4, 5].map(() => tmn.placeTestCall(1, { phoneNumber: '+14155550333', status: 'active' }, 'en')))
  await t('test ring: 5 concurrent taps place at most 3 calls', () => assert.ok(n <= 3, `placed=${n}`))

  console.log(`\n${pass}/${pass + fail} passed`)
  process.exit(fail ? 1 : 0)
})()
