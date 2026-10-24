// E2E check of the AI agent bridge: speaks a caller question (μ-law 8 kHz) into the browser-test WebSocket
// (same media protocol as Telnyx) and prints transcripts + how much agent audio came back.
// Usage: node scripts/ai_agent_ws_test.js <wss-url> <caller.ulaw> [seconds]
const fs = require('fs')
const WebSocket = require('ws')
const [url, file, secs = '35'] = process.argv.slice(2)
const audio = fs.readFileSync(file)
const ws = new WebSocket(url)
let agentBytes = 0, marks = []
const t0 = Date.now()
const send = (o) => ws.readyState === 1 && ws.send(JSON.stringify(o))
ws.on('open', () => {
  console.log('OPEN')
  let i = 0
  const silence = Buffer.alloc(160, 0xff)
  // 6 s of silence (greeting plays), then the question, then silence.
  const frames = [...Array(300).fill(silence), ...Array.from({ length: Math.ceil(audio.length / 160) }, (_, k) => audio.subarray(k * 160, k * 160 + 160)), ...Array(2000).fill(silence)]
  const timer = setInterval(() => { if (i >= frames.length || ws.readyState !== 1) return clearInterval(timer); send({ event: 'media', media: { track: 'inbound', payload: frames[i++].toString('base64') } }) }, 20)
})
ws.on('message', (m) => {
  const e = JSON.parse(m)
  if (e.event === 'media') agentBytes += Buffer.byteLength(e.media.payload, 'base64')
  else if (e.event === 'mark') { marks.push(e.mark.name); setTimeout(() => send({ event: 'mark', mark: { name: e.mark.name } }), 50) }
  else console.log(((Date.now() - t0) / 1000).toFixed(1), JSON.stringify(e))
})
ws.on('close', (c, r) => { console.log('CLOSE', c, String(r), 'agentAudioSec', (agentBytes / 8000).toFixed(1), 'marks', marks.join(',')); process.exit(0) })
ws.on('error', (e) => console.log('ERR', e.message))
setTimeout(() => { send({ event: 'stop' }); ws.close() }, parseInt(secs, 10) * 1000)
