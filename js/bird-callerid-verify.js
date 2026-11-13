'use strict'
// Automated Bird caller-ID verification. Bird verifies a caller ID by CALLING the number and reading a 6-digit code
// aloud (no SMS). This module: arms a number (starts Bird's call), turns the recorded audio of that call into the code
// (Whisper transcription), and submits it to Bird. Deps are injected so it can be unit-tested without live services.
const WORDS = { zero: '0', oh: '0', o: '0', one: '1', two: '2', to: '2', too: '2', three: '3', four: '4', for: '4', five: '5', six: '6', seven: '7', eight: '8', ate: '8', nine: '9' }

// Pull a 6-digit code out of a spoken transcript ("one two three four five six", "1 2 3-4 5 6", "code is 123456").
function extractCode(text, len = 6) {
  if (!text) return null
  const joined = String(text).toLowerCase().replace(/[^\w]+/g, ' ')
  const run = joined.match(new RegExp(`\\d{${len}}`))
  if (run) return run[0]
  const digits = joined.split(' ').map(w => (/^\d+$/.test(w) ? w : WORDS[w] ?? '')).join('')
  if (digits.length === len) return digits
  const m = digits.length > len ? digits.match(new RegExp(`\\d{${len}}`)) : null
  return m ? m[0] : null
}

function createBirdVerify({ bird, transcribe, db, log = console.log, maxAttempts = 3 }) {
  const col = () => db.collection('birdCallerIdVerify')
  const e164 = (p) => `+${String(p || '').replace(/[^\d]/g, '')}`

  // Start Bird's verification call to `number` and remember it so the recording can be matched back.
  async function arm(number, { name } = {}) {
    if (!bird.enabled()) return { error: 'Bird is not enabled (BIRD_API_KEY not loaded).' }
    const n = e164(number)
    // A pending/failed registration can't get a fresh call — drop it so registering again places a new one.
    for (const v of await bird.listCallerIds().catch(() => [])) if (e164(v.phone_number) === n && !v.outbound_enabled && bird.deleteCallerId) await bird.deleteCallerId(v.id)
    const r = await bird.startCallerIdVerification(n, name)
    if (r.error) return { error: `Bird couldn't start verification: ${r.error}` }
    await col().updateOne({ _id: n }, { $set: { _id: n, verifiedNumberId: r.id, status: 'calling', attempts: 0, armedAt: new Date(), expiresAt: new Date(Date.now() + 10 * 60000), lastCode: null, error: null } }, { upsert: true })
    log(`[BirdVerify] armed ${n} (verified-number ${r.id}) — Bird is calling it with a spoken code`)
    return { number: n, verifiedNumberId: r.id, status: r.status || 'calling' }
  }

  const isArmed = async (number) => { const d = await col().findOne({ _id: e164(number) }); return !!d && d.status !== 'verified' && d.expiresAt > new Date() }

  // Feed the recording of Bird's inbound verification call here; returns the outcome.
  async function captureFromRecording(number, audioBuffer) {
    const n = e164(number)
    const d = await col().findOne({ _id: n })
    if (!d || d.status === 'verified' || d.expiresAt <= new Date()) return { handled: false }
    const t = await transcribe(audioBuffer, { filename: 'bird-code.mp3', mimeType: 'audio/mpeg' })
    const code = extractCode(t?.text)
    const attempts = (d.attempts || 0) + 1
    if (!code) {
      await col().updateOne({ _id: n }, { $set: { attempts, status: attempts >= maxAttempts ? 'failed' : 'calling', error: `couldn't read code from "${(t?.text || '').slice(0, 60)}"` } })
      log(`[BirdVerify] ${n}: no code in transcript (attempt ${attempts}/${maxAttempts})`)
      return { handled: true, code: null, status: attempts >= maxAttempts ? 'failed' : 'retry' }
    }
    const r = await bird.submitCallerIdCode(d.verifiedNumberId, code)
    const ok = !r.error && (r.outbound_enabled || r.status === 'verified')
    await col().updateOne({ _id: n }, { $set: { attempts, lastCode: code, status: ok ? 'verified' : (attempts >= maxAttempts ? 'failed' : 'calling'), verifiedAt: ok ? new Date() : null, outboundEnabled: !!r.outbound_enabled, error: r.error || null } })
    log(`[BirdVerify] ${n}: submitted ${code} → ${ok ? 'VERIFIED' : `not yet (${r.error || r.status})`}`)
    return { handled: true, code, status: ok ? 'verified' : 'retry', outbound_enabled: !!r.outbound_enabled }
  }

  // Numbers Bird will present on outbound calls right now.
  async function verifiedPresenters() {
    if (!bird.enabled()) return []
    return (await bird.listCallerIds().catch(() => [])).filter(x => x.outbound_enabled).map(x => e164(x.phone_number))
  }

  return { arm, isArmed, captureFromRecording, verifiedPresenters, extractCode }
}

module.exports = { createBirdVerify, extractCode }
