// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Audio Library Service — Upload, Store, Manage IVR audio files
// Users upload audio via Telegram, files are saved locally + metadata in MongoDB
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const fs = require('fs')
const path = require('path')
const axios = require('axios')
const crypto = require('crypto')
const { log } = require('console')
const { execSync } = require('child_process')

const AUDIO_DIR = path.join(__dirname, 'assets', 'user-audio')

// Ensure directory exists
if (!fs.existsSync(AUDIO_DIR)) {
  fs.mkdirSync(AUDIO_DIR, { recursive: true })
}

let _db = null
let _collection = null

/**
 * Initialize the audio library service
 * @param {object} db - MongoDB database instance
 */
async function initAudioLibrary(db) {
  _db = db
  _collection = db.collection('ivrAudioFiles')
  await _collection.createIndex({ chatId: 1 })
  await _collection.createIndex({ chatId: 1, name: 1 })
  log('[AudioLibrary] Initialized')
}

/**
 * Get the public URL for an audio file
 * @param {string} filename - The filename in the user-audio directory
 * @returns {string} Public URL accessible by Telnyx
 */
function getAudioUrl(filename) {
  const baseUrl = process.env.SELF_URL_PROD || process.env.SELF_URL || ''
  return `${baseUrl}/assets/user-audio/${filename}`
}

/**
 * Identify an audio container from its leading bytes (magic numbers). Uploaded
 * files are routinely MISLABELED by extension/MIME (e.g. Telegram delivers an
 * M4A/AAC file as "audio/mpeg" with a ".mp3" name), so we must trust the bytes.
 * Returns: 'mp3' | 'wav' | 'ogg' | 'flac' | 'mp4' (m4a/aac) | 'unknown'.
 */
function detectAudioFormat(buf) {
  if (!buf || buf.length < 12) return 'unknown'
  const ascii = (start, len) => buf.slice(start, start + len).toString('latin1')
  if (ascii(0, 3) === 'ID3') return 'mp3' // MP3 with ID3v2 tag
  if (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0) return 'mp3' // raw MP3 frame sync
  if (ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WAVE') return 'wav'
  if (ascii(0, 4) === 'OggS') return 'ogg'
  if (ascii(0, 4) === 'fLaC') return 'flac'
  if (ascii(4, 4) === 'ftyp') return 'mp4' // m4a / aac / mp4 container (NOT playable by Twilio)
  return 'unknown'
}

/**
 * Download audio from Telegram and save locally
 * @param {string} fileLink - Telegram file download URL
 * @param {string} chatId - User's chat ID
 * @param {string} originalName - Original filename
 * @param {string} mimeType - MIME type
 * @returns {{ filename, localPath, audioUrl, size }}
 */
async function downloadAndSave(fileLink, chatId, originalName, mimeType) {
  const response = await axios.get(fileLink, { responseType: 'arraybuffer', timeout: 30000 })
  return saveBuffer(Buffer.from(response.data), chatId, originalName, mimeType)
}

// Same pipeline for bytes already in memory (web uploads, generated TTS).
async function saveBuffer(downloadedBuf, chatId, originalName, mimeType) {
  // Determine file extension
  let ext = 'mp3'
  if (mimeType) {
    if (mimeType.includes('ogg')) ext = 'ogg'
    else if (mimeType.includes('wav')) ext = 'wav'
    else if (mimeType.includes('mp4')) ext = 'mp4'
    else if (mimeType.includes('mpeg') || mimeType.includes('mp3')) ext = 'mp3'
  } else if (originalName) {
    const parts = originalName.split('.')
    if (parts.length > 1) ext = parts.pop().toLowerCase()
  }

  const id = crypto.randomUUID().slice(0, 12)
  const rawFilename = `${chatId}_${id}.${ext}`
  const rawPath = path.join(AUDIO_DIR, rawFilename)

  fs.writeFileSync(rawPath, downloadedBuf)

  let filename = rawFilename
  let localPath = rawPath
  let finalMimeType = mimeType || 'audio/mpeg'

  // ── Decide conversion from the REAL container (magic bytes), not the ext/MIME ──
  // Telephony <Play> (Twilio/Telnyx) only decodes MP3 reliably at any sample-rate.
  // WAV is technically supported BUT only 8-bit/16-bit PCM at 8 kHz or 16 kHz mono
  // — anything else (44.1 kHz stereo, 32-bit float, etc.) plays as SILENCE. Plus
  // /twilio/audio-proxy has historically served every file with Content-Type:
  // audio/mpeg (silence on WAV either way). So we normalize EVERYTHING to real
  // mono MP3. (Fix: @Spirits_Of_The_Ancesters 7898648919 — mislabeled ftypM4A =
  // static; and 2026-02 @blacknmilds — 1.67 MB 44.1k stereo WAV = silence.)
  const realFormat = detectAudioFormat(downloadedBuf)

  if (realFormat !== 'mp3') {
    const mp3Filename = `${chatId}_${id}.mp3`
    const mp3Path = path.join(AUDIO_DIR, mp3Filename)
    // ffmpeg can't edit a file in place; if the raw upload already ends in ".mp3"
    // (the mislabeled-M4A case) write to a temp path first, then move it over.
    const outPath = (mp3Path === rawPath) ? path.join(AUDIO_DIR, `${chatId}_${id}.conv.mp3`) : mp3Path
    try {
      // -vn drops any cover art/video; force mono 44.1k MP3 (telephony-safe).
      execSync(`ffmpeg -i "${rawPath}" -vn -codec:a libmp3lame -ac 1 -ar 44100 -b:a 128k -y "${outPath}"`, {
        timeout: 60000,
        stdio: 'pipe',
      })
      if (fs.existsSync(rawPath)) { try { fs.unlinkSync(rawPath) } catch (_e) { /* ignore */ } }
      if (outPath !== mp3Path) fs.renameSync(outPath, mp3Path)
      filename = mp3Filename
      localPath = mp3Path
      finalMimeType = 'audio/mpeg'
      log(`[AudioLibrary] Transcoded ${realFormat} → MP3 (mono 44.1k): ${mp3Filename}`)
    } catch (e) {
      // Never keep a non-playable file — that IS the "static" bug. Fail loudly so
      // the upload handler tells the user to try again (and a missing ffmpeg is
      // surfaced instead of silently serving garbage that plays as static).
      try { if (fs.existsSync(rawPath)) fs.unlinkSync(rawPath) } catch (_e) { /* ignore */ }
      try { if (fs.existsSync(outPath)) fs.unlinkSync(outPath) } catch (_e) { /* ignore */ }
      log(`[AudioLibrary] ffmpeg transcode FAILED (${realFormat} → MP3): ${e.message}`)
      throw new Error(`Could not process your audio (detected format: ${realFormat}). Please upload a standard MP3 or WAV file.`)
    }
  } else {
    finalMimeType = 'audio/mpeg'
  }

  const size = fs.statSync(localPath).size
  const audioUrl = getAudioUrl(filename)

  // ── Persist the binary to MongoDB (ivrAudioStore) so it SURVIVES Railway
  //    redeploys. Railway's filesystem is EPHEMERAL — a redeploy wipes
  //    /assets/user-audio, and without a DB backup the [AudioRestore]
  //    middleware (js/_index.js) can't restore the file. The URL then serves
  //    the 200 HTML landing page instead of audio, so Twilio <Play> receives
  //    HTML and speaks "an application error has occurred" then hangs up.
  //    Prod bug: @Spirits_Of_The_Ancesters (7898648919) 2026-07-24 — his
  //    imported "bill call" audio was lost on redeploy → every test call
  //    errored out. IVR greetings already back up here; library imports must too.
  try {
    if (_db) {
      const audioBuffer = fs.readFileSync(localPath)
      await _db.collection('ivrAudioStore').updateOne(
        { filename },
        { $set: { filename, buffer: audioBuffer.toString('base64'), audioUrl, mimeType: finalMimeType, source: 'audioLibrary', chatId: String(chatId), updatedAt: new Date() }, $setOnInsert: { createdAt: new Date() } },
        { upsert: true }
      )
      log(`[AudioLibrary] Persisted ${filename} to ivrAudioStore (${(size / 1024).toFixed(1)} KB) — survives redeploys`)
    } else {
      log(`[AudioLibrary] WARN: _db not initialized — ${filename} NOT backed up to ivrAudioStore`)
    }
  } catch (e) {
    log(`[AudioLibrary] ivrAudioStore persist FAILED for ${filename} (non-blocking): ${e.message}`)
  }

  log(`[AudioLibrary] Saved: ${filename} (${(size / 1024).toFixed(1)} KB) for chatId ${chatId}`)
  return { filename, localPath, audioUrl, size }
}

/**
 * Save audio metadata to MongoDB
 * @param {object} params
 * @returns {object} The saved audio document
 */
async function saveAudio({ chatId, name, filename, originalName, duration, mimeType, size, audioUrl, localPath }) {
  const doc = {
    id: crypto.randomUUID(),
    chatId: String(chatId),
    name: name || originalName || filename,
    filename,
    originalName: originalName || filename,
    duration: duration || 0,
    mimeType: mimeType || 'audio/mpeg',
    size: size || 0,
    audioUrl,
    localPath,
    createdAt: new Date(),
  }
  await _collection.insertOne(doc)
  log(`[AudioLibrary] Saved metadata: ${doc.name} (id: ${doc.id}) for chatId ${chatId}`)
  return doc
}

/**
 * List all audio files for a user
 * @param {number|string} chatId
 * @returns {Array} List of audio documents
 */
async function listAudios(chatId) {
  return _collection.find({ chatId: String(chatId) }).sort({ createdAt: -1 }).toArray()
}

/**
 * Get a specific audio by ID
 * @param {string} audioId
 * @returns {object|null}
 */
async function getAudio(audioId) {
  return _collection.findOne({ id: audioId })
}

/**
 * Delete an audio file (both filesystem and MongoDB).
 * Also cleans up the ivrAudioStore backup and resets any phone-number IVR/voicemail
 * greetings that still point to this audio (prevents dangling 404 references that
 * make callers hear "an application error has occurred" — see 2026-08-02 fix,
 * @Padrino_voodoo IVR auto-attendant needs work).
 * @param {string} audioId
 * @param {number|string} chatId - For ownership verification
 * @param {object} [phoneNumbersOf] - Optional collection handle for cascade cleanup
 * @returns {boolean|object}
 */
async function deleteAudio(audioId, chatId, phoneNumbersOf) {
  const audio = await _collection.findOne({ id: audioId, chatId: String(chatId) })
  if (!audio) return false

  // Delete file from filesystem
  try {
    if (audio.localPath && fs.existsSync(audio.localPath)) {
      fs.unlinkSync(audio.localPath)
    } else if (audio.filename) {
      const fp = path.join(AUDIO_DIR, audio.filename)
      if (fs.existsSync(fp)) fs.unlinkSync(fp)
    }
  } catch (e) {
    log(`[AudioLibrary] File delete error: ${e.message}`)
  }

  // ── Clean up ivrAudioStore backup (Railway redeploy-survival cache) ──
  // Without this, the deleted audio would come back to life on the next
  // redeploy via the /assets/user-audio restore middleware.
  if (_db && audio.filename) {
    try {
      await _db.collection('ivrAudioStore').deleteMany({ filename: audio.filename })
    } catch (e) {
      log(`[AudioLibrary] ivrAudioStore cleanup for ${audio.filename} failed (non-blocking): ${e.message}`)
    }
  }

  // ── Cascade: reset any phone whose IVR greeting / voicemail greeting still
  //    points to this audio (by library id, filename, or audioUrl). Without
  //    this reset, callers to that number would hit a 404 for the deleted
  //    audio and hear "an application error has occurred" from the telephony
  //    provider (Telnyx <Play> / Twilio <Play>).
  if (phoneNumbersOf && audio.filename) {
    try {
      const cursor = phoneNumbersOf.find({ _id: { $in: [String(chatId), Number(chatId)] } })
      const docs = await cursor.toArray()
      for (const doc of docs) {
        const nums = doc?.val?.numbers || []
        let anyChanged = false
        for (const n of nums) {
          const ivr = n?.features?.ivr
          if (ivr && (ivr.greetingFromLibrary === audioId ||
                     (typeof ivr.greetingAudioPath === 'string' && ivr.greetingAudioPath.includes(audio.filename)) ||
                     (typeof ivr.greetingAudioUrl === 'string' && ivr.greetingAudioUrl.includes(audio.filename)))) {
            ivr.greetingType = 'default'
            ivr.greeting = 'Thank you for calling. Please listen to the following options.'
            delete ivr.greetingAudioPath
            delete ivr.greetingAudioUrl
            delete ivr.greetingFromLibrary
            delete ivr.greetingVoice
            anyChanged = true
            log(`[AudioLibrary] Cascade: reset IVR greeting on ${n.phoneNumber} (was pointing to deleted audio ${audio.filename})`)
          }
          const vm = n?.features?.voicemail
          if (vm && (vm.customGreetingFromLibrary === audioId ||
                    (typeof vm.customAudioGreetingUrl === 'string' && vm.customAudioGreetingUrl.includes(audio.filename)) ||
                    (typeof vm.customGreetingUrl === 'string' && vm.customGreetingUrl.includes(audio.filename)))) {
            vm.greetingType = 'default'
            delete vm.customAudioGreetingUrl
            delete vm.customGreetingUrl
            delete vm.customGreetingText
            delete vm.customGreetingFromLibrary
            delete vm.greetingVoice
            anyChanged = true
            log(`[AudioLibrary] Cascade: reset Voicemail greeting on ${n.phoneNumber} (was pointing to deleted audio ${audio.filename})`)
          }
        }
        if (anyChanged) {
          await phoneNumbersOf.updateOne(
            { _id: doc._id },
            { $set: { 'val.numbers': nums } }
          )
        }
      }
    } catch (e) {
      log(`[AudioLibrary] Cascade phone-greeting cleanup failed (non-blocking): ${e.message}`)
    }
  }

  await _collection.deleteOne({ id: audioId, chatId: String(chatId) })
  log(`[AudioLibrary] Deleted: ${audio.name} (id: ${audioId}, file: ${audio.filename}) for chatId ${chatId}`)
  return { deleted: true, name: audio.name, filename: audio.filename }
}

/**
 * Rename an audio file (metadata only — filename/URL are preserved so any
 * phone numbers / campaigns that reference this audio keep working).
 * @param {string} audioId
 * @param {string|number} chatId - owner (verified)
 * @param {string} newName - trimmed, max 60 chars
 * @returns {{renamed:boolean, name?:string}}
 */
async function renameAudio(audioId, chatId, newName) {
  const clean = String(newName || '').trim().substring(0, 60)
  if (!clean) return { renamed: false, reason: 'empty' }
  const result = await _collection.updateOne(
    { id: audioId, chatId: String(chatId) },
    { $set: { name: clean, renamedAt: new Date() } }
  )
  if (result.modifiedCount > 0) {
    log(`[AudioLibrary] Renamed ${audioId} → "${clean}" for chatId ${chatId}`)
    return { renamed: true, name: clean }
  }
  return { renamed: false }
}

/**
 * Generate a short preview snippet (default 5s) from a library audio.
 * Uses ffmpeg to trim + normalize to mono 128kbps MP3 so it's small and
 * consistent across containers (M4A/OGG/etc all become playable MP3).
 * Falls back to the original file if ffmpeg is unavailable.
 * Caller MUST clean up the returned path when done (unless it equals the source).
 *
 * @param {string} audioId
 * @param {string|number} chatId - ownership check
 * @param {number} [seconds=5]
 * @returns {Promise<{path:string, ephemeral:boolean, name:string, size:number} | null>}
 */
async function generatePreview(audioId, chatId, seconds = 5) {
  const audio = await _collection.findOne({ id: audioId, chatId: String(chatId) })
  if (!audio) return null

  // Resolve source path — prefer localPath, else derive from filename + AUDIO_DIR
  let srcPath = audio.localPath
  if (!srcPath || !fs.existsSync(srcPath)) {
    if (audio.filename) {
      const p = path.join(AUDIO_DIR, audio.filename)
      if (fs.existsSync(p)) srcPath = p
    }
  }

  // If still missing on disk, try to restore from ivrAudioStore (Railway
  // redeploy-survival cache) — same pattern as the [AudioRestore] middleware.
  if ((!srcPath || !fs.existsSync(srcPath)) && _db && audio.filename) {
    try {
      const rec = await _db.collection('ivrAudioStore').findOne({ filename: audio.filename })
      if (rec && rec.buffer) {
        const restored = path.join(AUDIO_DIR, audio.filename)
        fs.writeFileSync(restored, Buffer.from(rec.buffer, 'base64'))
        srcPath = restored
        log(`[AudioLibrary] Preview: restored ${audio.filename} from ivrAudioStore`)
      }
    } catch (e) {
      log(`[AudioLibrary] Preview: ivrAudioStore restore failed for ${audio.filename}: ${e.message}`)
    }
  }

  if (!srcPath || !fs.existsSync(srcPath)) {
    log(`[AudioLibrary] Preview: source file missing for ${audioId} (${audio.filename})`)
    return null
  }

  const clamped = Math.max(1, Math.min(15, Number(seconds) || 5))
  const previewFilename = `${chatId}_preview_${audio.id.slice(0, 8)}_${Date.now()}.mp3`
  const previewPath = path.join(AUDIO_DIR, previewFilename)

  try {
    // -ss 0 -t N   = trim to first N seconds
    // -vn          = drop any cover art
    // mono 44.1k   = telephony-safe, small, universally playable in Telegram
    execSync(`ffmpeg -ss 0 -t ${clamped} -i "${srcPath}" -vn -codec:a libmp3lame -ac 1 -ar 44100 -b:a 128k -y "${previewPath}"`, {
      timeout: 15000,
      stdio: 'pipe',
    })
    if (!fs.existsSync(previewPath) || fs.statSync(previewPath).size === 0) {
      throw new Error('ffmpeg produced empty output')
    }
    const size = fs.statSync(previewPath).size
    log(`[AudioLibrary] Preview generated: ${previewFilename} (${(size / 1024).toFixed(1)} KB, ${clamped}s)`)
    return { path: previewPath, ephemeral: true, name: audio.name, size }
  } catch (e) {
    // Clean up any partial output
    try { if (fs.existsSync(previewPath)) fs.unlinkSync(previewPath) } catch (_e) { /* ignore */ }
    log(`[AudioLibrary] Preview ffmpeg failed for ${audioId} (falling back to full file): ${e.message}`)
    // Fallback: send the original file as-is. Ephemeral=false so caller doesn't delete the source.
    const size = fs.statSync(srcPath).size
    return { path: srcPath, ephemeral: false, name: audio.name, size }
  }
}

module.exports = {
  initAudioLibrary,
  downloadAndSave,
  saveBuffer,
  saveAudio,
  listAudios,
  getAudio,
  deleteAudio,
  renameAudio,
  generatePreview,
  getAudioUrl,
  detectAudioFormat,
  AUDIO_DIR,
}
