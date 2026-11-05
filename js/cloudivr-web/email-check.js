'use strict'
// Sign-up email check: the domain must be able to receive mail (MX, or an A/AAAA record as the fallback) and not be
// a throwaway inbox or a common typo of a big provider. Results are cached per domain for a day.
const dns = require('dns').promises

const DISPOSABLE = new Set(['mailinator.com', 'guerrillamail.com', 'guerrillamail.net', 'sharklasers.com', '10minutemail.com', '10minutemail.net', 'tempmail.com', 'temp-mail.org', 'temp-mail.io', 'tempmailo.com', 'throwawaymail.com', 'yopmail.com', 'yopmail.net', 'getnada.com', 'nada.email', 'trashmail.com', 'dispostable.com', 'maildrop.cc', 'mailnesia.com', 'fakeinbox.com', 'mintemail.com', 'emailondeck.com', 'mohmal.com', 'moakt.com', 'tempinbox.com', 'burnermail.io', 'spamgourmet.com', 'mailcatch.com', 'mytemp.email', 'tmpmail.org', 'tmpmail.net', 'emailfake.com', 'minuteinbox.com', 'inboxkitten.com', 'dropmail.me', 'fakemail.net', 'mail.tm', 'byom.de', 'trash-mail.com', 'discard.email', 'spambox.us', 'mailpoof.com', 'tempail.com', 'getairmail.com', 'linshiyouxiang.net', 'mvrht.net'])
const TYPOS = { 'gmial.com': 'gmail.com', 'gmai.com': 'gmail.com', 'gamil.com': 'gmail.com', 'gmail.co': 'gmail.com', 'gmail.con': 'gmail.com', 'gmaill.com': 'gmail.com', 'gnail.com': 'gmail.com', 'yahooo.com': 'yahoo.com', 'yaho.com': 'yahoo.com', 'yahoo.co': 'yahoo.com', 'hotmial.com': 'hotmail.com', 'hotmai.com': 'hotmail.com', 'hotmail.co': 'hotmail.com', 'outlok.com': 'outlook.com', 'outlook.co': 'outlook.com', 'iclod.com': 'icloud.com', 'icloud.co': 'icloud.com' }
const cache = new Map()

async function receivesMail(domain) {
  const hit = cache.get(domain)
  if (hit && Date.now() - hit.at < 86400000) return hit.ok
  const t = (p) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error('timeout')), 5000))])
  let ok
  try { ok = (await t(dns.resolveMx(domain))).some(m => m.exchange && m.exchange !== '.') } catch (e) { ok = null }
  if (!ok) {
    try { ok = (await t(dns.resolve4(domain))).length > 0 } catch (e) {
      try { ok = (await t(dns.resolve6(domain))).length > 0 } catch (e2) { ok = ['ENOTFOUND', 'ENODATA', 'ENOTIMP'].includes(e2.code) ? false : null }
    }
  }
  if (ok === null) return true // DNS hiccup: don't block a real person
  cache.set(domain, { ok, at: Date.now() })
  return ok
}

// null when fine, else a message to show.
async function emailProblem(email) {
  const domain = String(email || '').split('@')[1]?.toLowerCase()
  if (!domain) return 'Enter a valid email address.'
  if (process.env.WEB_CLOUDIVR_DRY_RUN === 'true' && /^example\.(com|org|net)$/.test(domain)) return null
  if (TYPOS[domain]) return `Did you mean @${TYPOS[domain]}? Check the spelling of your email.`
  if (DISPOSABLE.has(domain)) return 'Throwaway email addresses can’t be used. Enter an email you check.'
  if (!(await receivesMail(domain))) return `We can’t deliver email to @${domain}. Check the address and try again.`
  return null
}

module.exports = { emailProblem }
