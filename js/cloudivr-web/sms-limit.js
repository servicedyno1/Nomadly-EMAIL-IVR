'use strict'
// One SMS = 160 characters in the standard GSM-7 alphabet, or 70 when the text needs Unicode (emoji, most non-Latin
// scripts). The GSM extension characters (^{}\[~]|€) count as 2.
const GSM = new Set('@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà')
const EXT = new Set('^{}\\[~]|€')
// Phones insert smart punctuation; swap it for the plain GSM version so the text still fits 160.
const SMART = { '‘': "'", '’': "'", '‚': "'", '′': "'", '“': '"', '”': '"', '„': '"', '″': '"', '–': '-', '—': '-', '−': '-', '…': '...', '\u00a0': ' ', '\u2009': ' ', '\u200b': '' }
const gsmText = (t) => String(t || '').replace(/[‘’‚′“”„″–—−…\u00a0\u2009\u200b]/g, (c) => SMART[c])

function smsInfo(text) {
  const s = gsmText(text)
  let units = 0, gsm = true
  for (const ch of s) {
    if (GSM.has(ch)) units += 1
    else if (EXT.has(ch)) units += 2
    else { gsm = false; break }
  }
  if (gsm) return { limit: 160, used: units, unicode: false }
  return { limit: 70, used: [...s].reduce((n, ch) => n + (ch.codePointAt(0) > 0xffff ? 2 : 1), 0), unicode: true }
}
// Long texts go as joined parts: 153 characters per part (67 with emoji/Unicode), at most 3 parts.
const MAX_PARTS = 3
const smsParts = (text) => { const i = smsInfo(text); return i.used <= i.limit ? 1 : Math.ceil(i.used / (i.unicode ? 67 : 153)) }
// null when it fits (up to 3 joined parts), else the message to show.
function smsTooLong(text, maxParts = MAX_PARTS) {
  const i = smsInfo(text)
  const cap = maxParts === 1 ? i.limit : (i.unicode ? 67 : 153) * maxParts
  if (i.used <= cap) return null
  return i.unicode ? `Keep it to ${cap} characters: with emoji or special characters a text fits ${cap} in ${maxParts === 1 ? 'one message' : `${maxParts} parts`} (this has ${i.used}).` : `Keep it to ${cap} characters${maxParts === 1 ? ', one text' : ` (${maxParts} joined texts)`} (this has ${i.used}).`
}
// Cut to one text (used for AI-suggested replies).
function fitSms(text) {
  let s = String(text || '').trim()
  while (s && smsTooLong(s, 1)) s = [...s].slice(0, -1).join('')
  return s
}

module.exports = { smsInfo, smsTooLong, smsParts, fitSms, gsmText, MAX_PARTS }
