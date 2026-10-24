'use strict'
// AI call recordings: both sides of the conversation on one 8 kHz timeline, mixed and encoded to MP3.
// The caller track is the phone's continuous μ-law stream (its byte count is the call clock); agent audio is
// placed where the phone plays it (right after what is already queued) and cut back on barge-in / clear.
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { spawn } = require('child_process')

const HZ = 8000 // μ-law: 1 byte per sample → 8 bytes per ms
const MAX_BYTES = 16 * 60 * HZ // never hold more than 16 minutes per track
const AUDIO_DIR = path.join(__dirname, '..', 'assets', 'user-audio')
const RECORD_RATE = () => parseFloat(process.env.AI_RECORDING_RATE_PER_MIN || '0.02')
const RETENTION_DAYS = () => Math.max(1, parseInt(process.env.AI_RECORDING_RETENTION_DAYS || '90', 10) || 90)

// G.711 μ-law byte → 16-bit linear sample.
const ULAW = new Int16Array(256)
for (let i = 0; i < 256; i++) {
  const u = ~i & 0xff, exp = (u >> 4) & 7
  const x = ((((u & 0x0f) << 3) + 0x84) << exp) - 0x84
  ULAW[i] = u & 0x80 ? -x : x
}

class Recorder {
  constructor() { this.caller = []; this.callerLen = 0; this.agent = []; this.agentEnd = 0 }

  addCaller(b64) {
    const b = Buffer.from(String(b64 || ''), 'base64')
    if (!b.length || this.callerLen + b.length > MAX_BYTES) return
    this.caller.push(b)
    this.callerLen += b.length
  }

  // OpenAI streams faster than real time; the phone plays each chunk after the previous one.
  addAgent(b64) {
    const b = Buffer.from(String(b64 || ''), 'base64')
    const at = Math.max(this.agentEnd, this.callerLen)
    if (!b.length || at + b.length > MAX_BYTES) return
    this.agent.push({ at, buf: b })
    this.agentEnd = at + b.length
  }

  // The phone dropped agent audio that had not played yet (caller talked over it, or a `clear`).
  cut() {
    const now = this.callerLen
    if (this.agentEnd <= now) return
    this.agent = this.agent.filter(s => s.at < now).map(s => (s.at + s.buf.length > now ? { at: s.at, buf: s.buf.subarray(0, now - s.at) } : s))
    this.agentEnd = now
  }

  get samples() { return Math.max(this.callerLen, this.agentEnd) }
  get seconds() { return Math.round(this.samples / HZ) }

  // → 16-bit little-endian PCM, mono 8 kHz, both sides summed (clipped).
  mix() {
    const n = this.samples, acc = new Int32Array(n)
    let p = 0
    for (const b of this.caller) for (let i = 0; i < b.length; i++) acc[p++] = ULAW[b[i]]
    for (const s of this.agent) for (let i = 0; i < s.buf.length; i++) acc[s.at + i] += ULAW[s.buf[i]]
    const out = Buffer.alloc(n * 2)
    for (let i = 0; i < n; i++) out.writeInt16LE(acc[i] > 32767 ? 32767 : acc[i] < -32768 ? -32768 : acc[i], i * 2)
    return out
  }

  // MP3 buffer, or null when there is less than a second of audio.
  async toMp3() { return this.samples < HZ ? null : encodeMp3(this.mix()) }
}

// 8 kHz PCM → 16 kHz mono MP3 at 32 kbps (16 kHz keeps it playable in every browser; ~240 KB per minute).
function encodeMp3(pcm) {
  return new Promise((resolve, reject) => {
    const p = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 's16le', '-ar', String(HZ), '-ac', '1', '-i', 'pipe:0',
      '-ar', '16000', '-codec:a', 'libmp3lame', '-b:a', '32k', '-f', 'mp3', 'pipe:1'])
    const chunks = []
    let err = ''
    const timer = setTimeout(() => p.kill('SIGKILL'), 60000)
    p.stdout.on('data', d => chunks.push(d))
    p.stderr.on('data', d => { err += d })
    p.on('error', (e) => { clearTimeout(timer); reject(e) })
    p.on('close', (code) => { clearTimeout(timer); code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error(`ffmpeg exited ${code}: ${err.slice(0, 200)}`)) })
    p.stdin.on('error', () => {})
    p.stdin.end(pcm)
  })
}

let _db = null
const setDb = (db) => { _db = db }

// The audio library names files <chatId>_<12 chars>; call recordings hold callers' voices, so they get a
// 128-bit random name (the link is as hard to guess as a signed URL) — on disk and in the redeploy backup.
function hardenName(saved, chatId) {
  const file = `${chatId}_aicall_${crypto.randomBytes(16).toString('hex')}.mp3`
  fs.renameSync(path.join(AUDIO_DIR, saved.filename), path.join(AUDIO_DIR, file))
  const url = String(saved.audioUrl).replace(saved.filename, file)
  return { file, url }
}

// Saves the call's MP3 in the audio storage voicemails use → { url, file, seconds, expiresAt } | null.
async function save(rec, chatId, saveBuffer) {
  if (!rec || !saveBuffer) return null
  const buf = await rec.toMp3()
  if (!buf?.length) return null
  const saved = await saveBuffer(buf, chatId, 'ai-call.mp3', 'audio/mpeg')
  let out = { file: saved.filename, url: saved.audioUrl }
  try {
    out = hardenName(saved, chatId)
    if (_db) await _db.collection('ivrAudioStore').updateOne({ filename: saved.filename }, { $set: { filename: out.file, audioUrl: out.url, source: 'aiCallRecording' } })
  } catch (e) { console.log(`[AIAgent] recording rename failed (kept ${saved.filename}): ${e.message}`) }
  return { url: out.url, file: out.file, seconds: rec.seconds, expiresAt: new Date(Date.now() + RETENTION_DAYS() * 86400000) }
}

// Deletes recordings past their keep date (file on disk + the redeploy backup copy), keeps the call record.
async function sweep(db, { now = new Date(), log = console.log } = {}) {
  const calls = db.collection('aiCalls')
  const due = await calls.find({ recordingUrl: { $type: 'string' }, recordingExpiresAt: { $lte: now } }, { projection: { id: 1, recordingFile: 1 } }).limit(500).toArray()
  for (const c of due) {
    const f = String(c.recordingFile || '')
    if (/^[\w-]+\.mp3$/.test(f)) {
      try { fs.unlinkSync(path.join(AUDIO_DIR, f)) } catch (_) { /* already gone */ }
      await db.collection('ivrAudioStore').deleteOne({ filename: f }).catch(() => {})
    }
    await calls.updateOne({ id: c.id }, { $set: { recordingUrl: null, recordingDeletedAt: now } })
  }
  if (due.length) log(`[AIAgent] deleted ${due.length} AI call recording(s) older than ${RETENTION_DAYS()} days`)
  return due.length
}

function startSweep(db, log) {
  const run = () => sweep(db, { log }).catch(e => log(`[AIAgent] recording cleanup failed: ${e.message}`))
  const t = setInterval(run, 6 * 3600000)
  if (t.unref) t.unref()
  const first = setTimeout(run, 90000)
  if (first.unref) first.unref()
}

module.exports = { Recorder, encodeMp3, save, sweep, startSweep, setDb, RECORD_RATE, RETENTION_DAYS, ULAW, AUDIO_DIR }
