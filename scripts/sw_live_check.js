// Live SignalWire check (costs a little): buys 2 numbers if needed, A calls B through the adapter, B runs answer → speak →
// gather (A presses 1) → record → hangup. Prints every Telnyx-shaped event. Usage: node scripts/sw_live_check.js
require('dotenv').config({ path: require('path').join(__dirname, '../backend/.env') })
const sw = require('../js/signalwire')
const { rest, voice } = sw
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const seen = []

;(async () => {
  let nums = (await rest.listNumbers()).map(n => n.phone_number)
  while (nums.length < 2) {
    const found = await rest.searchNumbers('US', 'local', process.argv[2] || '646', 3)
    if (!found.length) throw new Error('no numbers found')
    const o = await rest.buyNumber(found[0].phone_number)
    if (!o) throw new Error('buy failed')
    nums.push(o.phone_numbers[0].phone_number)
  }
  for (const n of nums.slice(0, 2)) await rest.assignNumber(n)
  const [A, B] = nums
  console.log('numbers', A, B, 'topic', rest.topic())

  await voice.start(async (evt) => {
    const { event_type: t, payload: p } = evt.data
    seen.push(t + (p.direction === 'incoming' ? ':in' : ':out'))
    console.log('EVENT', t, p.direction, p.call_control_id.slice(0, 14), JSON.stringify({ digits: p.digits, status: p.status, result: p.result, cause: p.hangup_cause, rec: p.recording_urls?.mp3 ? 'yes' : undefined }))
    if (t === 'call.initiated' && p.direction === 'incoming') await sw.wrap({}).answerCall(p.call_control_id)
    if (process.env.TRANSFER && t === 'call.answered' && p.direction === 'incoming') {
      if (!global._tx) { global._tx = 1; await voice.transferCall(p.call_control_id, A, B, { targetLegClientState: 'nomadly_pstn_leg' }) } else await voice.speakOnCall(p.call_control_id, 'Transfer works. Goodbye.', 'male')
      return
    }
    if (t === 'call.recording.saved') { const ax = require('axios'); const r = await ax.get(p.recording_urls.mp3, { responseType: 'arraybuffer', validateStatus: () => true }); console.log('recording fetch without auth:', r.status, r.data?.length, p.recording_urls.mp3.split('/')[2]) }
    if (t === 'call.answered' && p.direction === 'incoming') {
      await voice.startRecording(p.call_control_id, 'single', 'mp3')
      await voice.gatherDTMFWithSpeak(p.call_control_id, 'Hello. Press 1 to continue.', 'female', { maxDigits: 1, timeout: 10000 })
    }
    if (t === 'call.answered' && p.direction === 'outgoing') setTimeout(() => { const l = voice._legs.get(p.call_control_id); l?.call?.sendDigits('1').catch(e => console.log('sendDigits', e.message)) }, 6000)
    if (t === 'call.gather.ended') await voice.speakOnCall(p.call_control_id, `You pressed ${p.digits || 'nothing'}. Goodbye.`, 'Polly.Joanna')
    if (t === 'call.speak.ended') await voice.hangupCall(p.call_control_id)
  })
  const r = await sw.wrap({ createOutboundCall: async () => ({ error: 'telnyx off' }) }).createOutboundCall(A, B, null, null, { answering_machine_detection: false })
  console.log('dial', JSON.stringify(r))
  for (let i = 0; i < (process.env.TRANSFER ? 40 : 60) && !(seen.filter(s => s.startsWith('call.hangup')).length >= 2 && seen.some(s => s.startsWith('call.recording.saved'))); i++) await sleep(1000)
  console.log('SEEN', seen.join(' '))
  const sms = await rest.sendSms(A, B, 'SignalWire test text')
  console.log('sms', JSON.stringify(sms))
  await sleep(3000)
  process.exit(0)
})().catch(e => { console.log('ERR', e.message); process.exit(1) })
