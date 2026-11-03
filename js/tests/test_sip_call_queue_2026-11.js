// SIP simultaneous-call queue: calls over the limit wait, connect when a line frees, give up on timeout or hang-up.
process.env.SIP_MAX_CONCURRENT_CALLS = '2'
process.env.SIP_QUEUE_MAX_WAIT_MS = '5000'
const Q = require('/app/js/sip-call-queue')
;(async () => {
  const calls = { c1: { chatId: '1', direction: 'outgoing' }, c2: { chatId: '1', direction: 'outgoing' }, x: { chatId: '2', direction: 'outgoing' }, t: { chatId: '1', direction: 'outgoing', isTestCall: true } }
  const r = {}
  r.fullAtLimit = Q.isFull(calls, '1') && !Q.isFull(calls, '2')
  const w1 = Q.waitForSlot(calls, '1', 'q1')
  const w2 = Q.waitForSlot(calls, '1', 'q2')
  r.queuedCounts = Q.isQueued('q1') && Q.isQueued('q2')
  delete calls.c1
  const first = await Promise.race([w1, new Promise(x => setTimeout(() => x('slow'), 3500))])
  r.firstInFirstOut = first === 'go' && Q.isQueued('q2')
  calls.q1 = { chatId: '1', direction: 'outgoing' }
  Q.drop('q2')
  r.hangupLeavesQueue = (await w2) === 'gone' && !Q.isQueued('q2')
  const t0 = Date.now()
  const w3 = await Q.waitForSlot(calls, '1', 'q3')
  r.timeoutAfterMaxWait = w3 === 'timeout' && Date.now() - t0 >= 4900
  const fails = Object.entries(r).filter(([, v]) => !v)
  console.log(JSON.stringify(r, null, 1)); console.log(fails.length ? `FAIL ${fails.map(x => x[0])}` : `PASS ${Object.keys(r).length}/${Object.keys(r).length}`)
  process.exit(fails.length ? 1 : 0)
})()
