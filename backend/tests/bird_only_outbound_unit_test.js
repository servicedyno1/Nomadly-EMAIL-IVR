// Unit test: signalwire wrap.createOutboundCall Bird-only routing + bird-alert throttle/email/telegram (all deps stubbed, no real calls/emails)
const path = require('path')
const Module = require('module')
const J = (p) => path.join('/app/js', p)
const stub = (file, exports) => {
  const id = require.resolve(file)
  const m = new Module(id); m.filename = id; m.loaded = true; m.exports = exports
  require.cache[id] = m
  return exports
}
let pass = 0, fail = 0
const ok = (c, msg) => { if (c) { pass++; console.log('PASS', msg) } else { fail++; console.log('FAIL', msg) } }

// ---- stubs
const S = { enabled: true, connected: true, presentable: new Set(['+15550001111', '+18648308599', '+16479457172']), spend: 100, active: 0, ceCalls: [], ceResult: { id: 'ae-1' }, alerts: [], swCalls: 0, ibCalls: 0, txCalls: 0, picks: [] }
stub(J('bird/index.js'), { enabled: () => S.enabled, presentable: async (n) => S.presentable.has(n), spendLeft: async () => S.spend, isBirdSearched: () => false, lookup: async () => null })
stub(J('callengine/index.js'), { enabled: () => S.enabled, connected: () => S.connected, activeBird: () => S.active, isAe: () => false, createOutboundCall: async (f, t) => { S.ceCalls.push([f, t]); return S.ceResult } })
stub(J('bird-alert.js'), { birdAlert: (k, t) => S.alerts.push([k, t]), setTelegram: () => {} })
let rot = 0
const SYS = ['+18648308599', '+16479457172']
stub(J('ivr-outbound.js'), { getTrialCaller: async (meta) => { S.picks.push(meta); return { callerId: SYS[rot++ % 2], callerProvider: 'telnyx' } } })
stub(J('signalwire/rest.js'), { enabled: () => true, ownedNumbers: () => ['+18005550100'], createRestCall: async () => { S.swCalls++; return { id: 'swr' } }, refreshOwned: async () => {}, ownsNumber: () => true, lookup: async () => null })
stub(J('signalwire/voice.js'), { isSw: () => false, connected: () => true, createOutboundCall: async () => { S.swCalls++; return { id: 'sw' } } })
stub(J('infobip/index.js'), { enabled: () => true, isIb: () => false, refreshOwned: async () => [], voice: { createOutboundCall: async () => { S.ibCalls++; return { id: 'ib' } } }, lookup: async () => null })
stub(J('multitel/index.js'), {})
stub(J('aws/index.js'), { lookup: async () => null })
stub(J('telnyx-sip.js'), {})

const sw = require(J('signalwire/index.js'))
const t = { createOutboundCall: async () => { S.txCalls++; return { id: 'tx' } } }
const w = sw.wrap(t)
const reset = () => { S.enabled = true; S.connected = true; S.spend = 100; S.active = 0; S.ceCalls = []; S.alerts = []; S.swCalls = 0; S.ibCalls = 0; S.txCalls = 0; S.picks = []; S.ceResult = { id: 'ae-1' } }

;(async () => {
  delete process.env.OUTBOUND_BIRD_ONLY
  process.env.BIRD_WAIT_MS = '300'
  // 1 verified caller → Bird only
  reset()
  let r = await w.createOutboundCall('+15550001111', '+12125550000', 'http://x', 'c', {})
  ok(r.id === 'ae-1' && S.ceCalls.length === 1 && S.swCalls + S.ibCalls + S.txCalls === 0, 'verified caller → only Bird used')
  // 2 international destination accepted
  reset()
  r = await w.createOutboundCall('+15550001111', '+447700900123', 'http://x', 'c', {})
  ok(r.id === 'ae-1' && S.ceCalls[0][1] === '+447700900123' && S.swCalls + S.ibCalls + S.txCalls === 0, 'UK destination goes via Bird (anyDest)')
  // 3 unlinked → swapped
  reset()
  r = await w.createOutboundCall('+19998887777', '+12125550000', 'http://x', 'c', { chatId: 42 })
  ok(r.id === 'ae-1' && SYS.includes(S.ceCalls[0]?.[0]) && S.picks[0]?.purpose === 'unverified_caller_swap' && S.picks[0]?.chatId === 42, `unlinked caller swapped → ${S.ceCalls[0]?.[0]} purpose=${S.picks[0]?.purpose}`)
  // 4 off
  reset(); S.connected = false
  r = await w.createOutboundCall('+15550001111', '+12125550000', 'http://x', 'c', {})
  ok(r.status === 503 && r.error && S.alerts[0]?.[0] === 'state-off' && S.swCalls + S.ibCalls + S.txCalls + S.ceCalls.length === 0, `off → 503 + alert (${r.error})`)
  // 5 spend
  reset(); S.spend = 0
  r = await w.createOutboundCall('+15550001111', '+12125550000', 'http://x', 'c', {})
  ok(r.status === 503 && S.alerts[0]?.[0] === 'state-spend' && S.swCalls + S.txCalls === 0, 'spend → 503 + alert')
  // 6 full after wait
  reset(); S.active = 999
  const t0 = Date.now()
  r = await w.createOutboundCall('+15550001111', '+12125550000', 'http://x', 'c', {})
  ok(r.status === 503 && S.alerts[0]?.[0] === 'state-full' && Date.now() - t0 >= 250, `full → waited ${Date.now() - t0}ms → 503 + alert`)
  // 6b campaign full → 429 no alert
  reset(); S.active = 999
  r = await w.createOutboundCall('+15550001111', '+12125550000', 'http://x', 'c', { _campaign: true })
  ok(r.status === 429 && S.alerts.length === 0, 'campaign full → 429 requeue, no alert')
  // 7 unlinked even after swap (system nums not presentable)
  reset(); S.presentable.delete('+18648308599'); S.presentable.delete('+16479457172')
  r = await w.createOutboundCall('+19998887777', '+12125550000', 'http://x', 'c', {})
  ok(r.status === 503 && S.alerts[0]?.[0] === 'state-unlinked', 'swap target not on Bird → 503 + unlinked alert')
  S.presentable.add('+18648308599'); S.presentable.add('+16479457172')
  // 8 dial error → alert
  reset(); S.ceResult = { error: 'SIP 486 busy' }
  r = await w.createOutboundCall('+15550001111', '+12125550000', 'http://x', 'c', {})
  ok(r.error === 'SIP 486 busy' && S.alerts[0]?.[0].startsWith('dial-') && S.swCalls + S.txCalls === 0, 'Bird dial error → alert, no fallback')
  // 9 sip destination not Bird-only path
  reset(); S.connected = false
  r = await w.createOutboundCall('+15550001111', 'sip:abc@x.com', 'http://x', 'c', {})
  ok(S.alerts.length === 0 && !(r.status === 503 && /Bird/.test(r.error || '')), `sip destination bypasses Bird-only (result ${JSON.stringify(r)})`)
  // 10 OUTBOUND_BIRD_ONLY=false restores fallback
  reset(); S.connected = false; process.env.OUTBOUND_BIRD_ONLY = 'false'
  r = await w.createOutboundCall('+15550001111', '+12125550000', 'http://x', 'c', {})
  ok(S.alerts.length === 0 && S.swCalls + S.ibCalls + S.txCalls > 0, 'OUTBOUND_BIRD_ONLY=false → fallback providers used')
  delete process.env.OUTBOUND_BIRD_ONLY
  // 11 getTrialCaller throws → does createOutboundCall reject?
  reset()
  require.cache[require.resolve(J('ivr-outbound.js'))].exports.getTrialCaller = async () => { throw new Error('db down') }
  try { r = await w.createOutboundCall('+19998887777', '+12125550000', 'http://x', 'c', {}); ok(r.status === 503 && S.alerts.length === 1, 'swap lookup failure → 503 + alert') } catch (e) { ok(false, `swap lookup failure throws uncaught (${e.message}) and no admin alert`) }
  // 12 ce.createOutboundCall throws
  reset()
  require.cache[require.resolve(J('callengine/index.js'))].exports.createOutboundCall = async () => { throw new Error('socket closed') }
  try { r = await w.createOutboundCall('+15550001111', '+12125550000', 'http://x', 'c', {}); ok(S.alerts.length === 1, 'Bird dial throw → alert') } catch (e) { ok(S.alerts.length === 1, `Bird dial throw propagates (${e.message}); alerts=${S.alerts.length}`) }

  // ---- bird-alert real module with stubbed mailer + telegram
  delete require.cache[require.resolve(J('bird-alert.js'))]
  const mails = []
  stub(J('mailer.js'), { send: async (m) => { mails.push(m); return true } })
  const ba = require(J('bird-alert.js'))
  const tg = []
  ba.setTelegram((m) => tg.push(m))
  delete process.env.BIRD_ALERT_EMAIL
  ba.birdAlert('k1', 'Bird is <down>')
  ba.birdAlert('k1', 'again')
  ba.birdAlert('k2', 'other')
  ok(tg.length === 2 && /Bird outbound/.test(tg[0]), `telegram called per key, throttled (${tg.length})`)
  ok(mails.length === 2 && mails[0].to === 'moxxcompany@gmail.com' && /&lt;down>/.test(mails[0].html), `email to ${mails[0]?.to}, html escaped`)
  const realNow = Date.now
  Date.now = () => realNow() + 11 * 60000
  ba.birdAlert('k1', 'after 11 min')
  ok(tg.length === 3 && mails.length === 3, 'after 10 min the same key alerts again')
  process.env.BIRD_ALERT_EMAIL = 'ops@example.com'
  ba.birdAlert('k3', 'x')
  ok(mails[3]?.to === 'ops@example.com', 'BIRD_ALERT_EMAIL override')
  Date.now = realNow
  ba.setTelegram(() => { throw new Error('tg fail') })
  try { ba.birdAlert('k4', 'y'); ok(mails.length === 5, 'telegram throw does not block email') } catch (e) { ok(false, 'telegram throw propagates') }
  console.log(`\nRESULT pass=${pass} fail=${fail}`)
  process.exit(0)
})()
