'use strict'
// One SMS = 160 characters in the standard GSM-7 alphabet, or 70 when the text needs Unicode (emoji, most non-Latin
// scripts). The GSM extension characters (^{}\[~]|€) count as 2.
const GSM = new Set('@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà')
const EXT = new Set('^{}\\[~]|€')

function smsInfo(text) {
  const s = String(text || '')
  let units = 0, gsm = true
  for (const ch of s) {
    if (GSM.has(ch)) units += 1
    else if (EXT.has(ch)) units += 2
    else { gsm = false; break }
  }
  if (gsm) return { limit: 160, used: units, unicode: false }
  return { limit: 70, used: [...s].reduce((n, ch) => n + (ch.codePointAt(0) > 0xffff ? 2 : 1), 0), unicode: true }
}
// null when it fits one text, else the message to show.
function smsTooLong(text) {
  const i = smsInfo(text)
  if (i.used <= i.limit) return null
  return i.unicode ? `Keep it to 70 characters: texts with emoji or special characters fit 70 in one message (this has ${i.used}).` : `Keep it to 160 characters, one text (this has ${i.used}).`
}
// Cut to one text (used for AI-suggested replies).
function fitSms(text) {
  let s = String(text || '').trim()
  while (s && smsTooLong(s)) s = [...s].slice(0, -1).join('')
  return s
}

module.exports = { smsInfo, smsTooLong, fitSms }
