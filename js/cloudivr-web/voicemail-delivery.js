'use strict'
// Voicemail delivery for CloudIVR web accounts. Telnyx recording links expire after ~10 minutes, so the MP3 is
// copied into our own audio storage (survives redeploys), transcribed, logged, and delivered as ONE inbox item
// (audio + transcript) plus an optional email with the MP3 attached.
const axios = require('axios')

const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const fmtDur = (s) => { const n = Math.round(Number(s) || 0); return n >= 60 ? `${Math.floor(n / 60)}m ${n % 60}s` : `${n}s` }

// deps: { saveBuffer(buf, chatId, name, mime) → {audioUrl}, transcribe(buf) → {text,status}, sendMail(to, subject, html, attachments),
//         phoneLogs, bot, formatPhone, log, download?(url) → Buffer }
function createVoicemailDelivery(deps) {
  const { saveBuffer, transcribe, sendMail, phoneLogs, bot, formatPhone = (p) => p, log = console.log } = deps
  const download = deps.download || (async (url) => Buffer.from((await axios.get(url, { responseType: 'arraybuffer', timeout: 30000, maxContentLength: 25 * 1024 * 1024 })).data))

  // → { audioUrl, transcript, transcriptStatus, emailed }
  return async function deliver({ chatId, num, from, to, recordingUrl, duration }) {
    const vm = num?.features?.voicemail || {}
    let buf = null
    try { buf = await download(recordingUrl) } catch (e) { log(`[VoicemailWeb] download failed for ${to}: ${e.message}`) }

    let audioUrl = recordingUrl
    if (buf) {
      try { audioUrl = (await saveBuffer(buf, chatId, 'voicemail.mp3', 'audio/mpeg')).audioUrl || recordingUrl } catch (e) { log(`[VoicemailWeb] keep-copy failed for ${to}: ${e.message}`) }
    }

    let tr = { text: null, status: vm.transcribe === false ? 'off' : 'failed' }
    if (vm.transcribe !== false && buf) {
      tr = await transcribe(buf)
      if (tr.status === 'failed' || tr.status === 'unavailable') log(`[VoicemailWeb] transcription ${tr.status} for ${to}${tr.error ? `: ${tr.error}` : ''}`)
    }

    const when = new Date()
    if (phoneLogs) {
      await phoneLogs.insertOne({ phoneNumber: to, from, type: 'voicemail', duration: duration || 0, recordingUrl: audioUrl, transcript: tr.text || null, transcriptStatus: tr.status, channel: 'web', timestamp: when.toISOString() })
        .catch(e => log(`[VoicemailWeb] log insert failed: ${e.message}`))
    }

    const caption = `🎙️ <b>New Voicemail</b>\n\n📞 To: ${formatPhone(to)}\n👤 From: ${formatPhone(from)}\n⏱️ Duration: ${fmtDur(duration)}`
      + (tr.text ? `\n\n📝 Transcript:\n“${esc(tr.text)}”` : tr.status === 'empty' ? '\n\n📝 No words detected in this message.' : '')
    try { await bot.sendAudio(chatId, audioUrl, { caption, parse_mode: 'HTML' }) } catch (e) { log(`[VoicemailWeb] inbox delivery failed: ${e.message}`) }

    let emailed = false
    if (vm.forwardToEmail && sendMail) {
      const html = `<p><b>New voicemail</b> on ${esc(formatPhone(to))}</p><p>From: ${esc(formatPhone(from))}<br/>Length: ${fmtDur(duration)}<br/>Received: ${when.toUTCString()}</p>`
        + (tr.text ? `<p><b>Transcript</b></p><blockquote style="border-left:3px solid #34d399;margin:0;padding-left:12px">${esc(tr.text)}</blockquote>` : '')
        + `<p>${buf ? 'The recording is attached.' : 'Listen in your CloudIVR inbox.'}</p>`
      try {
        emailed = await sendMail(vm.forwardToEmail, `New voicemail from ${formatPhone(from)}`, html, buf ? [{ filename: 'voicemail.mp3', content: buf, contentType: 'audio/mpeg' }] : undefined)
      } catch (e) { log(`[VoicemailWeb] email to ${vm.forwardToEmail} failed: ${e.message}`) }
    }
    log(`[VoicemailWeb] delivered voicemail ${from} → ${to} (${duration || 0}s, transcript=${tr.status}, emailed=${!!emailed})`)
    return { audioUrl, transcript: tr.text || null, transcriptStatus: tr.status, emailed: !!emailed }
  }
}

module.exports = { createVoicemailDelivery }
