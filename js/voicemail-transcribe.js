'use strict'
// Voicemail → text with OpenAI speech-to-text (model whisper-1), using the owner's own OpenAI key (APP_OPEN_API_KEY,
// the same key the TTS fallback and translations use). Language is auto-detected (EN/FR/PT/AR and more).
let OpenAI = null
let toFile = null
try { ({ OpenAI, toFile } = require('openai')) } catch (_) { /* sdk missing → transcription off */ }

const MODEL = 'whisper-1'
const MAX_BYTES = 25 * 1024 * 1024 // OpenAI upload limit
const MIN_BYTES = 2000             // shorter than ~0.1 s of MP3 = nothing said

let client = null
const enabled = () => !!(OpenAI && toFile && process.env.APP_OPEN_API_KEY)

// → { text, status: 'done' | 'empty' | 'too_large' | 'unavailable' | 'failed', error? }
async function transcribe(buffer, { filename = 'voicemail.mp3', mimeType = 'audio/mpeg', timeoutMs = 60000 } = {}) {
  if (!enabled()) return { text: null, status: 'unavailable' }
  if (!buffer || buffer.length < MIN_BYTES) return { text: null, status: 'empty' }
  if (buffer.length > MAX_BYTES) return { text: null, status: 'too_large' }
  if (!client) client = new OpenAI({ apiKey: process.env.APP_OPEN_API_KEY, timeout: timeoutMs, maxRetries: 1 })
  try {
    const file = await toFile(buffer, filename, { type: mimeType })
    const r = await client.audio.transcriptions.create({ file, model: MODEL, response_format: 'json', temperature: 0 })
    const text = String(r?.text || '').trim()
    return text ? { text, status: 'done' } : { text: null, status: 'empty' }
  } catch (e) {
    return { text: null, status: 'failed', error: `${e.status || ''} ${e.message || e}`.trim().slice(0, 200) }
  }
}

module.exports = { transcribe, enabled, MODEL }
