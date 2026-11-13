#!/usr/bin/env node
// Live check of the AI agent audio link: Bird call → externalMedia → RTP to this server and back. No AI, no customer.
// Run on the prod droplet:  node <dir>/ai_media_live_test.js --env <backend.env> --rel <release dir> --to +1NXXNXXXXXX --from +1NXXNXXXXXX
'use strict'
const fs = require('fs'), path = require('path')
const A = process.argv.slice(2), arg = (k) => A[A.indexOf(`--${k}`) + 1]
for (const l of fs.readFileSync(arg('env'), 'utf8').split('\n')) { const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) process.env[m[1]] = m[2].replace(/^"|"$/g, '') }
process.env.CALL_ENGINE_APP = 'aimediatest'
process.env.AI_RTP_PORT = '41900'
module.paths.unshift(path.join(arg('rel'), 'node_modules'))
const ce = require('./callengine/index.js')
const rtp = require('./ai-agent/rtp.js')
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

;(async () => {
  const events = []
  ce.start((e) => events.push(e.data.event_type))
  for (let i = 0; i < 50 && !ce.connected(); i++) await sleep(200)
  if (!ce.connected()) throw new Error('ARI not connected')
  const r = await ce.createOutboundCall(arg('from'), arg('to'), null, null, { timeout_secs: 30 })
  if (r.error) throw new Error(r.error)
  const id = r.callControlId
  console.log('placed', id)
  for (let i = 0; i < 300 && !events.includes('call.answered') && !events.includes('call.hangup'); i++) await sleep(100)
  if (!events.includes('call.answered')) throw new Error(`not answered: ${events.join(',')}`)
  const em = await ce.startExternalMedia(id, rtp.host())
  console.log('externalMedia', em)
  if (!em?.port) throw new Error('no externalMedia port')
  const m = rtp.open(em.port, em.address)
  let inFrames = 0
  m.on('message', (x) => { if (JSON.parse(x).event === 'media') inFrames++ })
  // 2 s of a 400 Hz tone back to the call (μ-law encoded)
  const mu = (s) => { const BIAS = 0x84; let sign = s < 0 ? 0x80 : 0; if (s < 0) s = -s; s = Math.min(s, 32635) + BIAS; let e = 7; for (let k = 0x4000; (s & k) === 0 && e > 0; k >>= 1) e--; return ~(sign | (e << 4) | ((s >> (e + 3)) & 0x0f)) & 0xff }
  const tone = Buffer.from(Array.from({ length: 16000 }, (_, i) => mu(Math.round(8000 * Math.sin(2 * Math.PI * 400 * i / 8000)))))
  m.send(JSON.stringify({ event: 'media', media: { payload: tone.toString('base64') } }))
  m.send(JSON.stringify({ event: 'mark', mark: { name: 'done' } }))
  let marked = false
  m.on('message', (x) => { if (JSON.parse(x).event === 'mark') marked = true })
  await sleep(6000)
  console.log(`RESULT frames from call: ${inFrames}, packets sent: ${m.tx}, tone finished: ${marked}`)
  m.close()
  await ce.hangupCall(id)
  await sleep(1500)
  console.log(inFrames > 50 && m.tx > 50 && marked ? 'RESULT ✅ audio flows both ways' : 'RESULT ❌ audio link problem')
  process.exit(0)
})().catch(e => { console.log('RESULT ❌', e.message); process.exit(1) })
