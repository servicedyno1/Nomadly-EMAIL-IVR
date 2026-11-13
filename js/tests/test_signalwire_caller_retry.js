// SignalWire caller-ID retry: when SignalWire refuses the From ("must be a purchased or verified phone number"),
// the call retries automatically from an owned SignalWire number instead of failing. Run from /app.
const Module = require('module')
const owned = ['+12074892004', '+13125550000', '+14155550000']
let reserved = new Set()
const relayCalls = [], restCalls = []
const rest = {
  enabled: () => true, refreshOwned: async () => {}, ownsNumber: (n) => owned.includes(n), ownedNumbers: () => owned,
  createRestCall: async (from, to) => { restCalls.push(from); return owned.includes(from) ? { sid: `s_${restCalls.length}` } : { error: 'The From phone number +1xxx must be a purchased or verified phone number or match the parent call.', code: 13224 } },
}
const voice = {
  isSw: () => false, connected: () => true,
  createOutboundCall: async (from, to) => { relayCalls.push(from); return owned.includes(from) ? { callControlId: `sw:o-${relayCalls.length}`, _provider: 'signalwire' } : { error: 'must be a purchased or verified phone number or match the parent call', status: 422 } },
}
const stub = { './rest': rest, './voice': voice, '../infobip': { enabled: () => false, isIb: () => false, voice: {} }, '../callengine': { enabled: () => false, connected: () => false, isAe: () => false }, '../bird': {}, '../aws': {} }
const load = Module._load
Module._load = function (req, ...a) { return stub[req] ? stub[req] : load.call(this, req, ...a) }
const sw = require('../signalwire/index')
Module._load = load

const telnyx = { createOutboundCall: async () => ({ error: 'This user has been marked as blocked.', status: 401 }), isLineLimitError: () => false }
process.env.TELNYX_FALLBACK = 'true'
const w = sw.wrap(telnyx)
let pass = 0, fail = 0
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log(`${c ? '✅' : '❌'} ${n}${x ? ` — ${x}` : ''}`) }
;(async () => {
  // 1) custom (unowned) caller ID → swapped to an owned number straight away (poolCaller)
  relayCalls.length = 0
  let r = await w.createOutboundCall('+18084939799', '+17145551111', 'http://cb')
  ok('unowned caller ID swapped to owned, call succeeds', !r.error && r.callerSwapped?.used && owned.includes(r.callerSwapped.used), JSON.stringify(r).slice(0, 160))

  // 2) all owned numbers reserved → poolCaller() returns null → first leg uses the unowned From → SW rejects → retry forced succeeds
  reserved = new Set(owned)
  sw.setReservedCallers(async () => reserved)
  relayCalls.length = 0
  r = await w.createOutboundCall('+18084939799', '+17145552222', 'http://cb')
  ok('rejection triggers forced retry from owned number', !r.error && owned.includes(r.callerSwapped?.used), `legs tried: ${relayCalls.join(',')}`)
  ok('it actually retried (2 relay attempts)', relayCalls.length === 2 && !owned.includes(relayCalls[0]) && owned.includes(relayCalls[1]))
  reserved = new Set()

  // 3) owned caller ID passes through unchanged, no swap
  relayCalls.length = 0
  r = await w.createOutboundCall('+12074892004', '+17145553333', 'http://cb')
  ok('owned caller ID used as-is', !r.error && !r.callerSwapped && relayCalls[0] === '+12074892004')

  // 4) REST path (RELAY offline) retries on rejection too
  voice.connected = () => false
  restCalls.length = 0
  reserved = new Set(owned)
  sw.setReservedCallers(async () => reserved)
  r = await w.createOutboundCall('+18084939799', '+17145554444', 'http://cb', undefined, { _swRestCallbackUrl: 'http://cb', _swRestStatusUrl: 'http://cb' })
  ok('REST path retries from owned number', !r.error && String(r.callControlId).startsWith('sw:rest:') && owned.includes(r.callerSwapped?.used), `rest tried: ${restCalls.join(',')}`)
  voice.connected = () => true; reserved = new Set()

  // 5) no owned SignalWire numbers at all → SignalWire can't place it, router falls through (here Telnyx, which errors)
  const saved = owned.splice(0, owned.length)
  relayCalls.length = 0
  r = await w.createOutboundCall('+18084939799', '+17145555555', 'http://cb')
  ok('no owned numbers → falls through to backup (no crash)', !!r.error)
  owned.push(...saved)

  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0)
})()
