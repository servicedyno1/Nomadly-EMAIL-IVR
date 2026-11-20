'use strict'
// What CloudIVR can and can't do right now, built from the live sales/provider switches. Read by every Emily prompt, the web UI and the bot.
const callerPassthrough = () => process.env.CALLER_ID_PASSTHROUGH_LIVE === 'true'
const TYPE = { local: 'local', toll_free: 'toll-free', mobile: 'mobile', national: 'national' }

function numbersSold() {
  try {
    return require('./cloudivr-web/numbers').countries().filter(c => c.types?.length).map(c => `${c.name} (${c.types.map(t => TYPE[t] || t).join(', ')})`)
  } catch (_) { return [] }
}
function fax() {
  try {
    const f = require('./fax-numbers')
    return { on: f.selling(), countries: f.COUNTRIES.map(c => c.name) }
  } catch (_) { return { on: false, countries: [] } }
}

function flags() {
  const fx = fax()
  return {
    forwardShowsCaller: callerPassthrough(),
    showAnyNumber: callerPassthrough(),
    fax: fx.on,
    hostedTexting: (() => { try { return require('./hosted-sms.js').AVAILABLE } catch (_) { return false } })(),
    numbersSold: numbersSold(),
    faxCountries: fx.on ? fx.countries : [],
  }
}

let cached = null
let at = 0
function statusText() {
  if (cached && Date.now() - at < 60000) return cached
  const f = flags()
  const yes = [], no = []
  ;(f.numbersSold.length ? yes : no).push(f.numbersSold.length ? `New phone numbers sold in: ${f.numbersSold.join('; ')}. Anywhere else is not available right now.` : 'Buying new phone numbers')
  if (Number(process.env.TELEPHONY_SURCHARGE_PER_MIN || '0.05') > 0) yes.push(`Pricing note: newer US/Canada numbers add a $${Number(process.env.TELEPHONY_SURCHARGE_PER_MIN || '0.05')}/min telephony infrastructure surcharge to minutes paid from the wallet (outgoing, forwarded, and incoming minutes after the plan's minutes run out); plan minutes themselves have no surcharge; a call is blocked if the wallet can't cover the rate plus surcharge`)
  ;(f.fax ? yes : no).push(f.fax ? `Fax numbers (order, send and receive faxes, web and Telegram bot) in: ${f.faxCountries.join(', ') || 'the listed countries'}` : 'Ordering new fax numbers')
  if (!f.forwardShowsCaller) no.push("Forwarded calls showing the original caller's number — the phone you forward to always sees the business number")
  if (!f.showAnyNumber) no.push("Showing a number the owner doesn't have on CloudIVR (custom caller ID / \"call from any number\") — calls show the owner's CloudIVR number instead")
  if (!f.hostedTexting) no.push("Texting on the owner's own landline or office number (hosted texting)")
  cached = `LIVE STATUS (updated automatically — this overrides anything else you were told):
AVAILABLE NOW: ${yes.join(' | ') || 'see the product facts'}
NOT AVAILABLE RIGHT NOW: ${no.join(' | ') || 'nothing'}
When asked about something NOT AVAILABLE, say plainly it is not available right now, offer the closest thing that works, and never promise when it comes back. Never name the carriers or suppliers behind the service.`
  at = Date.now()
  return cached
}

module.exports = { flags, statusText, callerPassthrough }
