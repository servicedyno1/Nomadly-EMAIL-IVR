'use strict'
// Bird-only outbound: every failure alerts the admin by email and on the admin bot (same problem at most once per 10 min).
const log = (...a) => console.log('[BirdAlert]', ...a)
let telegram = () => {}
const setTelegram = (fn) => { if (typeof fn === 'function') telegram = fn }
const last = new Map()

function birdAlert(key, text) {
  if (Date.now() - (last.get(key) || 0) < 10 * 60000) return
  last.set(key, Date.now())
  log(text)
  try { telegram(`🚨 [Bird outbound] ${text}`) } catch (_) {}
  require('./admin-mail').adminMail('CloudIVR: outbound call failed on Bird', `<p><b>An outbound call could not go through Bird.</b></p><p>${String(text).replace(/</g, '&lt;')}</p>`)
}

module.exports = { birdAlert, setTelegram }
