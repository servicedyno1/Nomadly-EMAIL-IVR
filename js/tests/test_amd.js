// Answering-machine detection on the call itself: audio detector (AI agent calls) + Asterisk AMD trip (IVR voicemail drop).
// Run: cd /app && node js/tests/test_amd.js
process.env.ASTERISK_ARI_URL = 'https://x:8089'; process.env.ASTERISK_ARI_PASSWORD = 'p'; delete process.env.BIRD_API_KEY; delete process.env.CALL_ENGINE_TRUNK
const { createAmd, tone } = require('/app/js/ai-agent/amd')
const ce = require('/app/js/callengine')
let pass = 0, fail = 0
const ok = (n, c) => { c ? pass++ : fail++; console.log(`${c ? '✅' : '❌'} ${n}`) }
const wait = (ms = 20) => new Promise(r => setTimeout(r, ms))

// 16-bit linear → μ-law
function lin2ulaw(x) {
  const BIAS = 0x84, CLIP = 32635
  let sign = (x >> 8) & 0x80; if (sign) x = -x; if (x > CLIP) x = CLIP; x += BIAS
  let exp = 7; for (let m = 0x4000; (x & m) === 0 && exp > 0; m >>= 1) exp--
  const man = (x >> (exp + 3)) & 0x0f
  return ~(sign | (exp << 4) | man) & 0xff
}
let ph = 0
const frame = (gen) => Buffer.from(Array.from({ length: 160 }, (_, i) => lin2ulaw(Math.round(gen(i)))))
const speech = () => frame(() => (Math.random() * 2 - 1) * 4000 + 3000 * Math.sin((ph += 0.31)))
const silence = () => frame(() => (Math.random() * 2 - 1) * 40)
const beep = (hz) => frame(() => 8000 * Math.sin((ph += (2 * Math.PI * hz) / 8000)))
const feed = (amd, f, n) => { for (let i = 0; i < n; i++) amd.feed(f()) }

;(async () => {
  console.log('audio detector (AI agent)')
  ok('tone(): 1000 Hz beep is a pure tone, speech is not', (() => { const b = tone(new Int16Array(160).map((_, i) => 8000 * Math.sin(2 * Math.PI * 1000 * i / 8000))); return b.freq === 1000 && b.purity > 0.8 })())
  {
    let m = null, b = null
    const a = createAmd({ onMachine: (x) => { m = x }, onBeep: (hz) => { b = hz } })
    feed(a, silence, 25); feed(a, speech, 260) // 0.5 s silence, then 5.2 s of greeting
    ok("long recorded greeting → machine", a.verdict() === "machine" && m.talkMs >= 3200)
    feed(a, silence, 20); feed(a, () => beep(1000), 15)
    ok('beep after the greeting → onBeep (1000 Hz)', b === 1000 && a.beeped())
  }
  {
    let human = false, m = false
    const a = createAmd({ onMachine: () => { m = true }, onHuman: () => { human = true } })
    feed(a, silence, 30); feed(a, speech, 40); feed(a, silence, 120) // "Hello?" then waits
    ok('"Hello?" then silence → human, never machine', human && !m && a.verdict() === 'human')
  }
  {
    let m = false
    const a = createAmd({ onMachine: () => { m = true } })
    feed(a, silence, 200); feed(a, speech, 300) // talking starts only after 4 s
    ok('speech starting late is not treated as a greeting', !m)
  }
  {
    let b = false
    const a = createAmd({ onBeep: () => { b = true } })
    feed(a, silence, 10); feed(a, () => beep(1000), 20)
    ok('a tone before any machine verdict is ignored', !b)
  }
  {
    let b = false
    const a = createAmd({ onBeep: () => { b = true } })
    feed(a, speech, 260); feed(a, () => beep(1000), 5)
    ok('a 100 ms blip is not a beep', !b)
  }

  console.log('call engine AMD (voicemail drop on Bird)')
  const ev = []; ce._setSink((e) => ev.push(e.data)); const last = (t) => [...ev].reverse().find(e => e.event_type === t)?.payload
  const reqs = []; ce.ari = () => ({ request: async (o) => { reqs.push(o); return { data: {} } } })
  const E = (type, extra) => ce._onEvent({ type, ...extra })
  ce._setConnected(true)
  process.env.CALL_ENGINE_TRUNK = 'bird'
  const l = { id: 'ae:m1', session: 's', amd: true, from: '+18335550100', to: '+15015550100', direction: 'outgoing', state: 'parked', startedAt: new Date().toISOString() }
  ce._legs.set(l.id, l)
  E('ChannelStateChange', { channel: { id: 'm1', state: 'Up' } }); await wait(50)
  const cont = reqs.find(r => r.url === '/channels/m1/continue')
  ok('answered leg goes to dialplan ce-amd/detect (subscribed first, app name set)', cont?.params?.context === 'ce-amd' && cont.params.extension === 'detect' && reqs.some(r => /\/applications\/.+\/subscription/.test(r.url) && r.params.eventSource === 'channel:m1') && reqs.some(r => r.url === '/channels/m1/variable' && r.params.variable === 'CE_APP'))
  ok('call.answered held back until the verdict', !last('call.answered'))
  E('StasisEnd', { channel: { id: 'm1' } }); await wait(400)
  ok('leaving Stasis for AMD does not end the call', !last('call.hangup'))
  E('StasisStart', { channel: { id: 'm1', state: 'Up' }, args: ['amd', 'MACHINE', 'LONGGREETING-2000-1500'] }); await wait(30)
  ok('MACHINE → call.answered then machine.detection.ended machine', last('call.answered')?.call_control_id === 'ae:m1' && last('call.machine.detection.ended')?.result === 'machine' && ev.findIndex(e => e.event_type === 'call.answered') < ev.findIndex(e => e.event_type === 'call.machine.detection.ended'))
  await wait(450)
  ok('machine → waits for the end of the greeting (ce-amd/greeting)', reqs.filter(r => r.url === '/channels/m1/continue').pop()?.params.extension === 'greeting')
  E('StasisEnd', { channel: { id: 'm1' } })
  E('StasisStart', { channel: { id: 'm1', state: 'Up' }, args: ['amd', 'GREETING_END', 'SILENCE'] }); await wait(400)
  ok('greeting over → call.machine.greeting.ended (message plays now)', !!last('call.machine.greeting.ended') && !last('call.hangup'))
  E('ChannelDestroyed', { channel: { id: 'm1' }, cause: 16 }); await wait()
  ok('real hangup still reported', last('call.hangup')?.call_control_id === 'ae:m1')

  const h = { id: 'ae:h1', session: 's2', amd: true, from: '+18335550100', to: '+15015550101', direction: 'outgoing', state: 'parked', startedAt: new Date().toISOString() }
  ce._legs.set(h.id, h)
  E('ChannelStateChange', { channel: { id: 'h1', state: 'Up' } }); await wait(30)
  E('StasisStart', { channel: { id: 'h1', state: 'Up' }, args: ['amd', 'HUMAN', 'HUMAN-1-1'] }); await wait(500)
  ok('HUMAN → human verdict, no greeting wait', last('call.machine.detection.ended')?.result === 'human' && !reqs.some(r => r.url === '/channels/h1/continue' && r.params.extension === 'greeting'))

  const p = { id: 'ae:p1', session: 's3', from: '+18335550100', to: '+15015550102', direction: 'outgoing', state: 'parked', startedAt: new Date().toISOString() }
  ce._legs.set(p.id, p)
  E('ChannelStateChange', { channel: { id: 'p1', state: 'Up' } }); await wait(30)
  ok('calls without voicemail drop are answered at once, no AMD', last('call.answered')?.call_control_id === 'ae:p1' && !reqs.some(r => r.url === '/channels/p1/continue'))

  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0)
})()
