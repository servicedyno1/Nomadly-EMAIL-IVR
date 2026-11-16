'use strict'
// Bird-only outbound: every failure alerts the admin by email and on the admin bot (same problem at most once per 10 min).
const log = (...a) => console.log('[BirdAlert]', ...a)
let telegram = () => {}
const setTelegram = (fn) => { if (typeof fn === 'function') telegram = fn }
const last = new Map()

// Bird turning one call away (e.g. cause 38) is retried by itself — only alert when it keeps happening
// (3+ refusals within 5 minutes). Everything else alerts straight away.
const refusals = []
function birdAlert(key, text) {
  if (/refused the call/i.test(String(text))) {
    const now = Date.now()
    refusals.push(now)
    while (refusals.length && now - refusals[0] > 5 * 60000) refusals.shift()
    if (refusals.length < 3) { log(`${text} (retried automatically — alert only if it keeps happening)`); return }
    key = 'bird-refusals'
    text = `Bird refused ${refusals.length} calls in the last 5 minutes. Latest: ${text}`
  }
  if (Date.now() - (last.get(key) || 0) < 10 * 60000) return
  last.set(key, Date.now())
  log(text)
  try { telegram(`🚨 [Bird outbound] ${text}`) } catch (_) {}
  require('./admin-mail').adminMail('CloudIVR: outbound call failed on Bird', `<p><b>An outbound call could not go through Bird.</b></p><p>${String(text).replace(/</g, '&lt;')}</p>`)
}

module.exports = { birdAlert, setTelegram }
