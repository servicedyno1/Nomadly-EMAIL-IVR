// Unit check of the AI bridge call flow (no network): answer gating, hello wait, machine/beep, screener, idle nudge.
process.env.AI_AGENT_IDLE_MS = '50'
process.env.AI_AGENT_HELLO_WAIT_MS = '80'
const { Bridge } = require('../../js/ai-agent/bridge')
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const mk = (dir = 'outbound', agent = {}) => {
  const sent = []
  const b = new Bridge({ agent: { name: 'Ava', businessName: 'Acme', language: 'en', voice: 'marin', goal: 'Book a visit', ...agent }, ctx: { direction: dir }, media: { readyState: 1, send: () => {} }, log: () => {}, actions: { hangup: () => sent.push('HANGUP') } })
  b.send = (o) => sent.push(o.type)
  b.createResponse = (r) => { sent.push(`RESP:${r.instructions.slice(0, 40)}`); b.responding = false; b.creating = false }
  return { b, sent }
}
const ok = (c, m) => { if (!c) { console.log('FAIL', m); process.exitCode = 1 } else console.log('ok  ', m) }
;(async () => {
  let { b, sent } = mk()
  b.onAi({ type: 'session.updated' })
  ok(!sent.some(x => x.startsWith('RESP')), 'no speech before answer')
  b.onAi({ type: 'input_audio_buffer.speech_stopped' })
  ok(!sent.some(x => x.startsWith('RESP')), 'ringback speech ignored before answer')
  b.answered()
  b.onAi({ type: 'input_audio_buffer.speech_stopped' })
  ok(sent.some(x => x.startsWith('RESP:Start the call')), 'opens after Hello once answered')

  ;({ b, sent } = mk()); b.onAi({ type: 'session.updated' }); b.answered(); await sleep(120)
  ok(sent.some(x => x.startsWith('RESP:Start the call')), 'opens after hello-wait timeout')

  ;({ b, sent } = mk()); b.onAi({ type: 'session.updated' }); b.onMachine(); b.answered(); await sleep(120)
  ok(!sent.some(x => x.startsWith('RESP')), 'machine: silent until beep'); b.beep()
  ok(sent.some(x => x.startsWith('RESP:You reached voicemail')) && b.result.voicemail, 'beep → one voicemail')

  ;({ b, sent } = mk()); b.onAi({ type: 'session.updated' }); b.answered(); b.say('caller', 'Hi, the person you are calling is using a screening service. Please state your name and reason for calling.')
  ok(b.result.screened && sent.some(x => x.startsWith('RESP:An automated call-screening')), 'screener → introduce and wait')
  b.onMachine(); ok(!b.machine, 'screened call not treated as voicemail')

  ;({ b, sent } = mk()); b.onAi({ type: 'session.updated' }); b.answered(); b.say('caller', "Hi, you've reached John. I can't take your call, please leave a message after the tone.")
  ok(b.machine, 'voicemail greeting heard → machine mode')

  ;({ b, sent } = mk()); b.onAi({ type: 'session.updated' }); b.answered(); b.say('caller', "Hello, who's calling?"); b.say('caller', "Sorry, she's not available right now.")
  ok(!b.screened && !b.machine, 'normal human phrases are not screener/voicemail')

  ;({ b, sent } = mk()); b.onAi({ type: 'session.updated' }); b.answered(); b.open(); b.interruptible = true; b.armIdle(); await sleep(70)
  ok(sent.some(x => x.startsWith('RESP:Say only this, warmly: "Are you still')), 'silence → are you still there?')
  await sleep(70)
  ok(sent.some(x => x.startsWith('RESP:No response from the caller')), 'second silence → wrap up')

  ;({ b, sent } = mk('inbound')); b.onAi({ type: 'session.updated' })
  ok(sent.some(x => x.startsWith('RESP:Start the call')), 'inbound speaks right away')
  const marks = []; b.toPhone = (o) => marks.push(o.mark?.name); b.interruptible = true; b.markIdle()
  ok(marks.includes('idle') && !b.idleTimer, 'idle watch waits for playback mark'); b.onMark('idle')
  ok(!!b.idleTimer, 'playback mark arms the idle watch'); b.stop()
  ;({ b, sent } = mk('outbound', { waitForHello: false })); b.onAi({ type: 'session.updated' }); b.answered()
  ok(sent.some(x => x.startsWith('RESP:Start the call')), 'hello-wait off: speaks on answer (never before)')
  process.exit()
})()
