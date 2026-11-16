// Bird ⇄ MultiTEL failover. Run: cd /app && node js/tests/test_callengine_failover.js
process.env.ASTERISK_ARI_URL = 'https://x:8089'; process.env.ASTERISK_ARI_PASSWORD = 'p'; process.env.BIRD_API_KEY = 'k'; process.env.CALLER_ID_PASSTHROUGH_TRUNK = 'multitel-out'
process.env.FAILOVER_PROBE_MS = '30000'; process.env.BIRD_MAX_CPS = '1000'; delete process.env.CALL_ENGINE_TRUNK; delete process.env.CALL_ENGINE_BACKUP_TRUNK
const ce = require('/app/js/callengine')
const FO = ce.failover
let pass = 0, fail = 0
const ok = (n, c) => { c ? pass++ : fail++; console.log(`${c ? '✅' : '❌'} ${n}`) }
const wait = (ms = 20) => new Promise(r => setTimeout(r, ms))
const alerts = []; FO.setAlert((s, t) => alerts.push(s))
const posts = []
ce.ari = () => ({ request: async () => ({ data: {} }), post: async (u, b, o) => { posts.push({ u, b, o }); return { data: {} } }, get: async () => ({ data: [] }), delete: async () => ({}) })
const E = (type, extra) => ce._onEvent({ type, ...extra })
const ep = () => posts[posts.length - 1].o.params
const cid = () => posts[posts.length - 1].o.params.callerId
const refuse = async (cause = 21) => { const id = posts[posts.length - 1].u.split('/').pop(); E('ChannelHangupRequest', { channel: { id }, cause }); E('ChannelDestroyed', { channel: { id } }); await wait() }
const ring = async () => { const id = posts[posts.length - 1].u.split('/').pop(); E('ChannelStateChange', { channel: { id, state: 'Ringing' } }); E('ChannelHangupRequest', { channel: { id }, cause: 16 }); E('ChannelDestroyed', { channel: { id } }); await wait() }
;(async () => {
  ce._setConnected(true)
  await ce.originate({}, '+18665794299', '+15551230001'); ok('default call goes to Bird', /@bird$/.test(ep().endpoint))
  await refuse(17); await ce.originate({}, '+18665794299', '+15551230001'); await refuse(1)
  for (let i = 0; i < 6; i++) { await ce.originate({}, '+18665794299', '+15551230001'); await refuse(88) }
  ok('busy / bad numbers / refused caller IDs (88) do not count', !FO.isDown('bird'))
  for (let i = 0; i < 4; i++) { await ce.originate({}, '+18665794299', '+15551230001'); await refuse(21) }
  ok('4 refusals: still on Bird', !FO.isDown('bird'))
  await ce.originate({}, '+18665794299', '+15551230001'); await refuse(21)
  ok('5th refusal in a row → Bird down + alert', FO.isDown('bird') && /Bird is refusing calls/.test(alerts[0] || ''))
  await ce.originate({}, '+18665794299', '+15551230002'); ok('new call moves to MultiTEL with same caller ID', /@multitel-out$/.test(ep().endpoint) && cid() === '18665794299')
  ok('moved count tracked', FO.status().find(s => s.trunk === 'bird').moved === 1)
  // MultiTEL custom caller ID while MultiTEL is down → Bird with the line's own number
  for (let i = 0; i < 5; i++) { await ce.originate({ ownFrom: '+18665794299' }, '+13025550111', '+15551230003', 30, 'multitel-out'); await refuse(21) }
  ok('MultiTEL down too: Bird down + MultiTEL down → calls stay on their trunk', FO.isDown('multitel-out'))
  FO.reset()
  for (let i = 0; i < 5; i++) { await ce.originate({ ownFrom: '+18665794299' }, '+13025550111', '+15551230003', 30, 'multitel-out'); await refuse(21) }
  ok('MultiTEL down (Bird fine)', FO.isDown('multitel-out') && !FO.isDown('bird'))
  await ce.originate({ ownFrom: '+18665794299' }, '+13025550111', '+15551230004', 30, 'multitel-out')
  ok('custom caller ID call moves to Bird showing the line’s own number', /@bird$/.test(ep().endpoint) && cid() === '18665794299')
  await ring()
  // probe after the interval: original trunk gets one call; it rings → restored + alert, custom caller ID resumes
  const s = FO.status().find(x => x.trunk === 'multitel-out'); ok('still down before probe time', s.down)
  const origNow = Date.now; Date.now = () => origNow() + 31000
  await ce.originate({ ownFrom: '+18665794299' }, '+13025550111', '+15551230005', 30, 'multitel-out')
  ok('probe call tries MultiTEL with the custom caller ID', /@multitel-out$/.test(ep().endpoint) && cid() === '13025550111')
  await ce.originate({ ownFrom: '+18665794299' }, '+13025550111', '+15551230006', 30, 'multitel-out')
  ok('only one probe per interval (next call still on Bird)', /@bird$/.test(ep().endpoint))
  const probeId = posts[posts.length - 2].u.split('/').pop()
  E('ChannelStateChange', { channel: { id: probeId, state: 'Ringing' } }); E('ChannelHangupRequest', { channel: { id: probeId }, cause: 16 }); E('ChannelDestroyed', { channel: { id: probeId } }); await wait()
  Date.now = origNow
  ok('probe rang → MultiTEL restored + "working again" alert', !FO.isDown('multitel-out') && alerts.some(a => /MultiTEL is working again/.test(a)))
  await ce.originate({ ownFrom: '+18665794299' }, '+13025550111', '+15551230007', 30, 'multitel-out')
  ok('custom caller ID continues on MultiTEL after recovery', /@multitel-out$/.test(ep().endpoint) && cid() === '13025550111')
  // softphone legs are never rerouted
  FO.reset(); for (let i = 0; i < 5; i++) { await ce.originate({}, '+1', '+15551230001'); await refuse(21) }
  await ce.originate({}, '+18665794299', 'sip:cvabc@sip.x'); ok('softphone (sip:) legs unaffected', /^PJSIP\/kamailio\//.test(ep().endpoint))
  // engine refuses to start a call (trunk error) counts as a refusal
  FO.reset(); ce.ari = () => ({ post: async () => { throw new Error('Allocation failed') }, get: async () => ({ data: [] }) })
  for (let i = 0; i < 5; i++) await ce.originate({}, '+18665794299', '+15551230001').catch(() => {})
  ok('originate errors count towards switching', FO.isDown('bird'))
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0)
})()
