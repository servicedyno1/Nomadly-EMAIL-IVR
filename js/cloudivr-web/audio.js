'use strict'
// Audio library for web accounts: uploads + text-to-speech, stored by the bot's audio-library service
// (same files the IVR engine plays to callers).
const fs = require('fs')

const MAX_BYTES = 10 * 1024 * 1024
const AUDIO_TYPES = /^audio\/(mpeg|mp3|wav|x-wav|wave|ogg|webm|mp4|x-m4a|aac|flac|opus)$/i

const publicAudio = (a) => ({ id: a.id, name: a.name, audioUrl: a.audioUrl, duration: a.duration || 0, size: a.size || 0, mimeType: a.mimeType, createdAt: a.createdAt, source: a.source || 'upload' })

function routes(router, { db, h, upload, audioLibraryService, ttsService, log = console.log }) {
  const phoneNumbersOf = db.collection('phoneNumbersOf')
  const bad = (res, status, error, message) => res.status(status).json({ error, message })

  router.get('/audio', h(async (req, res) => {
    res.json({ audios: (await audioLibraryService.listAudios(req.webChatId)).map(publicAudio) })
  }))

  router.get('/audio/voices', (req, res) => {
    const voices = Object.entries(ttsService.ALL_VOICES).map(([key, v]) => ({ key, name: v.name, desc: v.desc, gender: v.gender, provider: v.provider }))
    res.json({ voices, speeds: [0.75, 0.9, 1, 1.1, 1.25] })
  })

  router.post('/audio/upload', upload.single('file'), h(async (req, res) => {
    const f = req.file
    if (!f) return bad(res, 400, 'no_file', 'Choose an audio file to upload.')
    if (f.size > MAX_BYTES) return bad(res, 400, 'too_big', 'Audio files must be under 10 MB.')
    if (!AUDIO_TYPES.test(f.mimetype || '') && !/\.(mp3|wav|ogg|m4a|aac|flac|opus|webm)$/i.test(f.originalname || '')) return bad(res, 400, 'bad_type', 'Upload an MP3, WAV, OGG, M4A or similar audio file.')
    const saved = await audioLibraryService.saveBuffer(f.buffer, req.webChatId, f.originalname, f.mimetype)
    const name = String(req.body.name || f.originalname || 'Audio').trim().slice(0, 60)
    const doc = await audioLibraryService.saveAudio({ chatId: req.webChatId, name, filename: saved.filename, originalName: f.originalname, mimeType: 'audio/mpeg', size: saved.size, audioUrl: saved.audioUrl, localPath: saved.localPath })
    res.status(201).json({ audio: publicAudio(doc) })
  }))

  router.post('/audio/tts', h(async (req, res) => {
    const text = String(req.body.text || '').trim()
    const voiceKey = String(req.body.voice || 'rachel')
    const speed = Math.min(1.5, Math.max(0.5, Number(req.body.speed) || 1))
    if (text.length < 3 || text.length > 1500) return bad(res, 400, 'invalid_text', 'Write 3–1500 characters for the voice to read.')
    if (!ttsService.ALL_VOICES[voiceKey]) return bad(res, 400, 'invalid_voice', 'Pick a voice from the list.')
    let tts
    try { tts = await ttsService.generateTTS(text, voiceKey, null, speed) } catch (e) {
      log(`[CloudIVR-Web] TTS failed for ${req.webChatId}: ${e.message}`)
      return bad(res, 424, 'tts_failed', 'The voice service could not create this audio. Try again or pick another voice.')
    }
    const buf = fs.readFileSync(tts.audioPath)
    const saved = await audioLibraryService.saveBuffer(buf, req.webChatId, 'tts.mp3', 'audio/mpeg')
    try { fs.unlinkSync(tts.audioPath) } catch (_) { /* temp file */ }
    const name = String(req.body.name || text.slice(0, 40)).trim().slice(0, 60)
    const doc = await audioLibraryService.saveAudio({ chatId: req.webChatId, name, filename: saved.filename, originalName: `tts-${voiceKey}.mp3`, mimeType: 'audio/mpeg', size: saved.size, audioUrl: saved.audioUrl, localPath: saved.localPath })
    res.status(201).json({ audio: publicAudio(doc) })
  }))

  router.patch('/audio/:id', h(async (req, res) => {
    const r = await audioLibraryService.renameAudio(req.params.id, req.webChatId, String(req.body.name || ''))
    if (!r.renamed) return bad(res, r.reason === 'empty' ? 400 : 404, 'rename_failed', r.reason === 'empty' ? 'Enter a name.' : 'Audio not found.')
    res.json({ name: r.name })
  }))

  router.delete('/audio/:id', h(async (req, res) => {
    const r = await audioLibraryService.deleteAudio(req.params.id, req.webChatId, phoneNumbersOf)
    if (!r) return bad(res, 404, 'not_found', 'Audio not found.')
    res.json({ deleted: true })
  }))
}

module.exports = { routes, publicAudio }
