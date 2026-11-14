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
    const wav = audioBuffer.slice(0, 4).toString('latin1') === 'RIFF' // Infobip recordings are WAV
    const t = await transcribe(audioBuffer, wav ? { filename: 'bird-code.wav', mimeType: 'audio/wav' } : { filename: 'bird-code.mp3', mimeType: 'audio/mpeg' })
    const code = extractCode(t?.text)
    const attempts = (d.attempts || 0) + 1
    if (!code) {
      await col().updateOne({ _id: n, status: { $ne: 'verified' } }, { $set: { attempts, status: attempts >= maxAttempts ? 'failed' : 'calling', error: `couldn't read code from "${(t?.text || '').slice(0, 60)}"` } })
      log(`[BirdVerify] ${n}: no code in transcript (attempt ${attempts}/${maxAttempts})`)
      return { handled: true, code: null, status: attempts >= maxAttempts ? 'failed' : 'retry' }
    }
    const r = await bird.submitCallerIdCode(d.verifiedNumberId, code)
    const ok = !r.error && (r.outbound_enabled || r.status === 'verified')
    await col().updateOne({ _id: n, status: { $ne: 'verified' } }, { $set: { attempts, lastCode: code, status: ok ? 'verified' : (attempts >= maxAttempts ? 'failed' : 'calling'), verifiedAt: ok ? new Date() : null, outboundEnabled: !!r.outbound_enabled, error: r.error || null } })
    log(`[BirdVerify] ${n}: submitted ${code} → ${ok ? 'VERIFIED' : `not yet (${r.error || r.status})`}`)
    if (ok) bird.forgetCallerIds?.()
    return { handled: true, code, status: ok ? 'verified' : 'retry', outbound_enabled: !!r.outbound_enabled }
  }

  // Numbers Bird will present on outbound calls right now.
  async function verifiedPresenters() {
    if (!bird.enabled()) return []
    return (await bird.listCallerIds().catch(() => [])).filter(x => x.outbound_enabled).map(x => e164(x.phone_number))
  }

  // One number at a time: arm the next customer SignalWire number that Bird can't present yet.
  // A number that didn't verify is retried after 6 h, at most 3 rounds.
  async function autoLinkTick({ numbers }) {
    if (!bird.enabled() || !numbers.length) return { skipped: 'nothing to link' }
    const now = new Date()
    if (await col().findOne({ status: 'calling', expiresAt: { $gt: now } })) return { skipped: 'verification in progress' }
    await col().updateMany({ status: 'calling', expiresAt: { $lte: now } }, { $set: { status: 'failed', error: 'no code captured before expiry' } })
    const ready = new Set(await verifiedPresenters())
    const docs = new Map((await col().find({ _id: { $in: numbers.map(e164) } }).toArray()).map(d => [d._id, d]))
    for (const n of numbers.map(e164)) {
      if (ready.has(n)) { if (docs.get(n)?.status !== 'verified') await col().updateOne({ _id: n }, { $set: { status: 'verified', verifiedAt: now } }, { upsert: true }); continue }
      const d = docs.get(n)
      if (d && ((d.rounds || 0) >= 3 || d.armedAt > new Date(now - 6 * 3600000))) continue
      const r = await arm(n)
      await col().updateOne({ _id: n }, { $inc: { rounds: 1 }, ...(r.error ? { $set: { status: 'failed', armedAt: now, error: r.error } } : {}) }, { upsert: true })
      return r.error ? { number: n, error: r.error } : { armed: n }
    }
    return { skipped: 'all linked' }
  }

  return { arm, isArmed, captureFromRecording, verifiedPresenters, extractCode, autoLinkTick }
}

module.exports = { createBirdVerify, extractCode }
