'use strict'
// Builds the landing page "Hear it" sample call from the platform's own voice engine (OpenAI TTS — the same
// engine behind IVR greetings — and the AI agent's default 'marin' voice), a real DTMF "1" tone and a US ringback,
// stitched with ffmpeg. Writes:
//   frontend/public/civr/sample/sample-call.mp3
//   frontend/src/cloudivr/pages/landing/sampleCall.js   (segments + per-word timings for the synced transcript)
// Run from /app:  node scripts/sample-call/make.js
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')
const axios = require('axios')
require('dotenv').config({ path: path.join(__dirname, '../../backend/.env') })

const KEY = process.env.APP_OPEN_API_KEY
if (!KEY) { console.error('APP_OPEN_API_KEY missing'); process.exit(1) }
const OUT_DIR = path.join(__dirname, '../../frontend/public/civr/sample')
const JS_OUT = path.join(__dirname, '../../frontend/src/cloudivr/pages/landing/sampleCall.js')
const TMP = path.join(__dirname, 'tmp')
fs.mkdirSync(OUT_DIR, { recursive: true }); fs.mkdirSync(TMP, { recursive: true })

// speaker: menu (IVR greeting), tone (DTMF), agent (AI voice agent), caller, ring (ringback), human (front desk)
const SCRIPT = [
  { speaker: 'menu', voice: 'nova', text: 'Thanks for calling Northwind Dental. Press 1 to book, 2 for billing, or 3 to leave a message.', gap: 0.45 },
  { speaker: 'tone', text: '1', gap: 0.45 },
  { speaker: 'agent', voice: 'marin', text: 'Hi, this is Northwind’s booking assistant. New visit, or changing one?', gap: 0.3 },
  { speaker: 'caller', voice: 'echo', text: 'A new one — a cleaning next Tuesday afternoon, if you have it.', gap: 0.3 },
  { speaker: 'agent', voice: 'marin', text: 'Tuesday at 2:30 is free. Shall I book it?', gap: 0.25 },
  { speaker: 'caller', voice: 'echo', text: 'Yes, please.', gap: 0.25 },
  { speaker: 'agent', voice: 'marin', text: 'Done — Tuesday at 2:30. I’ll pass you to the front desk to confirm your details.', gap: 0.35 },
  { speaker: 'ring', text: '', gap: 0.15 },
  { speaker: 'human', voice: 'shimmer', text: 'Front desk, this is Maya — I have your booking right here.', gap: 0.5 },
]

const sh = (args) => execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...args], { stdio: 'inherit' })
const dur = (f) => Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', f]).toString().trim())

async function tts(text, voice, file) {
  const call = (model, v) => axios.post('https://api.openai.com/v1/audio/speech', { model, voice: v, input: text, response_format: 'mp3', speed: 1.08 },
    { headers: { Authorization: `Bearer ${KEY}` }, responseType: 'arraybuffer', timeout: 60000 })
  let res
  try { res = await call('gpt-4o-mini-tts', voice) } catch (e) {
    console.log(`  gpt-4o-mini-tts/${voice} failed (${e.response?.status || e.message}) → tts-1/${voice === 'marin' ? 'coral' : voice}`)
    res = await call('tts-1', voice === 'marin' ? 'coral' : voice)
  }
  fs.writeFileSync(file, Buffer.from(res.data))
}

// Every piece becomes 24 kHz mono WAV, with the TTS engine's leading/trailing silence trimmed, so the concat is sample-exact.
const wav = (src, out) => sh(['-i', src, '-ac', '1', '-ar', '24000', '-af', 'silenceremove=start_periods=1:start_threshold=-40dB:start_silence=0.04,areverse,silenceremove=start_periods=1:start_threshold=-40dB:start_silence=0.06,areverse,loudnorm=I=-16:TP=-1.5:LRA=11', out])
const silence = (sec, out) => sh(['-f', 'lavfi', '-i', 'anullsrc=r=24000:cl=mono', '-t', String(sec), out])
// DTMF "1" = 697 Hz + 1209 Hz, 180 ms, played through a phone-like band-pass.
const dtmf = (out) => sh(['-f', 'lavfi', '-i', 'sine=frequency=697:sample_rate=24000:duration=0.18', '-f', 'lavfi', '-i', 'sine=frequency=1209:sample_rate=24000:duration=0.18',
  '-filter_complex', '[0:a][1:a]amix=inputs=2:normalize=0,volume=0.35,highpass=f=300,lowpass=f=3400,afade=t=out:st=0.14:d=0.04[a]', '-map', '[a]', out])
// US ringback = 440 Hz + 480 Hz, 1.2 s on, heard faintly as if through the line.
const ring = (out) => sh(['-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=24000:duration=1.2', '-f', 'lavfi', '-i', 'sine=frequency=480:sample_rate=24000:duration=1.2',
  '-filter_complex', '[0:a][1:a]amix=inputs=2:normalize=0,volume=0.22,highpass=f=300,lowpass=f=3400,afade=t=in:st=0:d=0.05,afade=t=out:st=1.1:d=0.1[a]', '-map', '[a]', out])

// Word timings: a segment's measured length spread over its words by letter count (TTS speech is close to even).
function words(text, start, end) {
  const ws = text.split(/\s+/).filter(Boolean)
  const weight = ws.map(w => Math.max(2, w.replace(/[^\p{L}\p{N}]/gu, '').length) + 1.2)
  const total = weight.reduce((a, b) => a + b, 0)
  let t = start
  return ws.map((w, i) => { const d = (end - start) * (weight[i] / total); const o = { w, s: +t.toFixed(2), e: +(t + d).toFixed(2) }; t += d; return o })
}

async function main() {
  const pieces = []
  const segs = []
  let t = 0.4
  pieces.push(silence(0.4, path.join(TMP, 'lead.wav')) || path.join(TMP, 'lead.wav'))
  for (let i = 0; i < SCRIPT.length; i++) {
    const s = SCRIPT[i]
    const raw = path.join(TMP, `${i}-raw.mp3`), out = path.join(TMP, `${i}.wav`)
    if (s.speaker === 'tone') dtmf(out)
    else if (s.speaker === 'ring') ring(out)
    else { console.log(`TTS ${s.speaker}/${s.voice}: ${s.text}`); await tts(s.text, s.voice, raw); wav(raw, out) }
    const d = dur(out)
    const seg = { speaker: s.speaker, text: s.speaker === 'tone' ? 'Caller presses 1' : s.speaker === 'ring' ? 'Ringing the front desk…' : s.text, start: +t.toFixed(2), end: +(t + d).toFixed(2) }
    if (!['tone', 'ring'].includes(s.speaker)) seg.words = words(s.text, t, t + d)
    segs.push(seg)
    pieces.push(out)
    t += d
    const gap = path.join(TMP, `${i}-gap.wav`); silence(s.gap, gap); pieces.push(gap); t += s.gap
  }
  const list = path.join(TMP, 'list.txt')
  fs.writeFileSync(list, pieces.map(p => `file '${p.replace(/'/g, "'\\''")}'`).join('\n'))
  const mix = path.join(TMP, 'mix.wav')
  sh(['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', mix])
  const mp3 = path.join(OUT_DIR, 'sample-call.mp3')
  sh(['-i', mix, '-codec:a', 'libmp3lame', '-b:a', '64k', '-ac', '1', mp3])
  const total = dur(mp3)
  const js = `// Generated by scripts/sample-call/make.js — do not edit by hand. Audio: /civr/sample/sample-call.mp3\n` +
    `export const SAMPLE_DURATION = ${total.toFixed(2)};\n` +
    `export const SAMPLE_SEGMENTS = ${JSON.stringify(segs, null, 1).replace(/\n\s*/g, ' ').replace(/\{ "speaker"/g, '\n  { "speaker"').replace(/ \]$/, '\n]')};\n`
  fs.writeFileSync(JS_OUT, js)
  console.log(`\nWrote ${mp3} (${(fs.statSync(mp3).size / 1024).toFixed(0)} KB, ${total.toFixed(1)} s) and ${JS_OUT}`)
  fs.rmSync(TMP, { recursive: true, force: true })
}
main().catch(e => { console.error(e.response?.data ? Buffer.from(e.response.data).toString() : e); process.exit(1) })
