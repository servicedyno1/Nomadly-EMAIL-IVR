'use strict'
// Answering-machine detection on the call audio itself (8 kHz μ-law frames from the far end), for carriers that
// give no machine-detection events (Bird / own call engine):
//  • machine: right after answering, the far end talks for MACHINE_SPEECH_MS out of the first WINDOW_MS of speech
//    (a recorded greeting), where a person says "Hello?" and waits for an answer;
//  • beep: a steady single tone (400–2000 Hz) for ≥ BEEP_MS once a machine was detected → leave the message now.
const RATE = 8000
const FRAME_MS = 20
const MACHINE_SPEECH_MS = 3200 // talk time that marks a recorded greeting…
const WINDOW_MS = 6000 // …within this long after the first word
const HUMAN_SILENCE_MS = 2000 // a person stops and waits after "Hello?"; greetings pause shorter
const START_WITHIN_MS = 3500 // greeting must start this soon after answer
const GIVE_UP_MS = 12000 // no verdict after this → treat as a person
const BEEP_MS = 180
const SPEECH_RMS = 150
const BEEP_RMS = 700

const ULAW = new Int16Array(256)
for (let i = 0; i < 256; i++) {
  const u = ~i & 0xff, sign = u & 0x80, exp = (u >> 4) & 0x07, man = u & 0x0f
  const s = (((man << 3) + 0x84) << exp) - 0x84
  ULAW[i] = sign ? -s : s
}
const FREQS = []; for (let f = 400; f <= 2000; f += 50) FREQS.push(f)
const COEF = FREQS.map(f => 2 * Math.cos(2 * Math.PI * f / RATE))

// Strongest single frequency and how much of the frame's energy it holds (1 = pure tone).
function tone(pcm) {
  let energy = 0
  for (const v of pcm) energy += v * v
  if (!energy) return { freq: 0, purity: 0 }
  let best = 0, bi = 0
  for (let k = 0; k < COEF.length; k++) {
    let s1 = 0, s2 = 0
    const c = COEF[k]
    for (const v of pcm) { const s0 = v + c * s1 - s2; s2 = s1; s1 = s0 }
    const p = s1 * s1 + s2 * s2 - c * s1 * s2
    if (p > best) { best = p; bi = k }
  }
  return { freq: FREQS[bi], purity: Math.min(1, (2 * best) / (pcm.length * energy)) }
}

function createAmd({ onMachine, onBeep, onHuman } = {}) {
  let t = 0, speechStart = null, lastSpeech = null, talked = 0, verdict = null
  let beepFrames = 0, beepFreq = 0, beeped = false
  const feed = (ulaw) => {
    const pcm = new Int16Array(ulaw.length)
    let sq = 0
    for (let i = 0; i < ulaw.length; i++) { pcm[i] = ULAW[ulaw[i]]; sq += pcm[i] * pcm[i] }
    const rms = Math.sqrt(sq / Math.max(1, ulaw.length))
    const ms = (ulaw.length / RATE) * 1000 || FRAME_MS
    t += ms
    if (verdict === 'machine' && !beeped) {
      const tn = rms > BEEP_RMS ? tone(pcm) : { purity: 0 }
      if (tn.purity > 0.7 && (!beepFrames || Math.abs(tn.freq - beepFreq) <= 50)) { beepFrames++; beepFreq = tn.freq } else beepFrames = 0
      if (beepFrames * ms >= BEEP_MS) { beeped = true; onBeep?.(beepFreq) }
      return
    }
    if (verdict) return
    if (rms > SPEECH_RMS) {
      if (speechStart === null) speechStart = t - ms
      lastSpeech = t
      if (t - speechStart <= WINDOW_MS) talked += ms
      if (speechStart <= START_WITHIN_MS && talked >= MACHINE_SPEECH_MS) { verdict = 'machine'; onMachine?.({ greetingMs: Math.round(t - speechStart), talkMs: Math.round(talked) }) }
    }
    if (!verdict && (t >= GIVE_UP_MS || (speechStart !== null && (t - lastSpeech > HUMAN_SILENCE_MS || t - speechStart > WINDOW_MS)))) { verdict = 'human'; onHuman?.() }
  }
  return { feed, verdict: () => verdict, beeped: () => beeped }
}

module.exports = { createAmd, tone, ULAW, MACHINE_SPEECH_MS, BEEP_MS }
