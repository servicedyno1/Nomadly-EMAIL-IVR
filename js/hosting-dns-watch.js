'use strict'
// Hosting DNS watch: after a hosting order, follow the domain until it is live. Spots wrong/typo nameservers at the
// registrar (tells the user the exact fix), nudges Cloudflare to re-check, and messages the user once the site loads.
// State lives on cpanelAccounts.dnsWatch so the support AI can quote it in real time.
const axios = require('axios')

const WATCH_DAYS = Number(process.env.HOSTING_DNS_WATCH_DAYS || 7)
const WRONG_NS_REMIND_MS = 6 * 3600e3
const ACTIVATION_CHECK_MS = 61 * 60e3
const lc = (a) => (a || []).map(s => String(s).toLowerCase().replace(/\.$/, '')).sort()
const same = (a, b) => lc(a).join(',') === lc(b).join(',')

// Edit distance — flags "claudflare.com" style typos against the expected names.
function dist(a, b) {
  const m = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)])
  for (let j = 1; j <= b.length; j++) m[0][j] = j
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) m[i][j] = Math.min(m[i - 1][j] + 1, m[i][j - 1] + 1, m[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
  return m[a.length][b.length]
}
const typos = (current, expected) => lc(current).filter(c => !lc(expected).includes(c) && lc(expected).some(e => dist(c, e) <= 3))

async function registryNs(domain) {
  try {
    const r = await axios.get(`https://rdap.org/domain/${encodeURIComponent(domain)}`, { timeout: 15000, maxRedirects: 5 })
    return lc((r.data?.nameservers || []).map(n => n.ldhName))
  } catch (_) {
    try { return lc(await require('dns').promises.resolveNs(domain)) } catch (__) { return [] }
  }
}
const activationCheck = (zoneId) => axios.put(`https://api.cloudflare.com/client/v4/zones/${zoneId}/activation_check`, {}, {
  headers: { 'X-Auth-Email': process.env.CLOUDFLARE_EMAIL, 'X-Auth-Key': process.env.CLOUDFLARE_API_KEY }, timeout: 15000 }).catch(() => {})
async function siteUp(domain) {
  for (const host of [domain, `www.${domain}`]) {
    try {
      const r = await axios.get(`https://${host}/`, { timeout: 15000, maxRedirects: 3, validateStatus: () => true, headers: { 'User-Agent': 'Mozilla/5.0 (DNS watch)' } })
      if (r.status < 500) return true
    } catch (_) { /* not reachable yet */ }
  }
  return false
}

const MSG = {
  wrong: {
    en: (d, cur, exp, typo) => `⚠️ <b>${d} isn't live yet — the nameservers at your domain registrar need a fix.</b>\n\nRight now they are:\n${cur.map(n => `• <code>${n}</code>`).join('\n') || '• (none set)'}\n${typo.length ? `\n❗ ${typo.map(n => `<code>${n}</code>`).join(', ')} ${typo.length > 1 ? 'look' : 'looks'} like a typo.\n` : ''}\nSet them to exactly:\n${exp.map(n => `• <code>${n}</code>`).join('\n')}\n\nTap each name to copy it. Once saved, it usually goes live within 5–60 minutes, and we'll message you as soon as it does.`,
    fr: (d, cur, exp, typo) => `⚠️ <b>${d} n'est pas encore en ligne — les serveurs de noms chez votre registrar doivent être corrigés.</b>\n\nActuellement :\n${cur.map(n => `• <code>${n}</code>`).join('\n') || '• (aucun)'}\n${typo.length ? `\n❗ ${typo.map(n => `<code>${n}</code>`).join(', ')} : faute de frappe probable.\n` : ''}\nMettez exactement :\n${exp.map(n => `• <code>${n}</code>`).join('\n')}\n\nUne fois enregistré, c'est généralement en ligne en 5 à 60 minutes — nous vous préviendrons.`,
  },
  live: {
    en: (d) => `✅ <b>${d} is live!</b>\n\nYour domain's DNS has propagated and your site now loads at https://${d}. If it still doesn't open on your device, wait a few minutes or try another browser — some networks take a little longer to update.`,
    fr: (d) => `✅ <b>${d} est en ligne !</b>\n\nLe DNS de votre domaine s'est propagé et votre site s'ouvre sur https://${d}. S'il ne s'ouvre pas encore chez vous, patientez quelques minutes ou essayez un autre navigateur.`,
  },
}
const pick = (set, lang) => set[lang] || set.en

async function checkOne(db, acct, deps) {
  const { cf, sendMessage, log } = deps
  const col = db.collection('cpanelAccounts')
  const domain = String(acct.domain).toLowerCase()
  const w = acct.dnsWatch || {}
  const now = Date.now()
  const zone = await cf.getZoneByName(domain)
  if (!zone) return
  const expected = lc(zone.name_servers)
  const current = await registryNs(domain)
  const set = { 'dnsWatch.lastCheckAt': new Date(), 'dnsWatch.zoneStatus': zone.status, 'dnsWatch.expectedNs': expected, 'dnsWatch.currentNs': current }
  const lang = (await db.collection('state').findOne({ _id: String(acct.chatId) }).catch(() => null))?.userLanguage || 'en'

  if (zone.status === 'active') {
    const up = await siteUp(domain)
    set['dnsWatch.status'] = up ? 'live' : 'propagating'
    if (up) {
      set['dnsWatch.liveAt'] = new Date()
      // Plans that were already live before the watch existed are marked quietly.
      const wasWaiting = (w.status && w.status !== 'live') || Date.now() - new Date(acct.createdAt).getTime() < 2 * 3600e3
      if (wasWaiting) await sendMessage(acct.chatId, pick(MSG.live, lang)(domain), { parse_mode: 'HTML', disable_web_page_preview: true }).catch(e => log(`notify live ${domain}: ${e.message}`))
      log(`${domain}: live${wasWaiting ? ` — user ${acct.chatId} notified` : ' (quiet)'}`)
    }
    return col.updateOne({ _id: acct._id }, { $set: set })
  }

  const nsOk = current.length && same(current, expected)
  const typo = typos(current, expected)
  set['dnsWatch.status'] = nsOk ? 'propagating' : 'wrong_nameservers'
  set['dnsWatch.typoNs'] = typo
  if (nsOk && (!w.activationCheckAt || now - new Date(w.activationCheckAt).getTime() > ACTIVATION_CHECK_MS)) {
    await activationCheck(zone.id)
    set['dnsWatch.activationCheckAt'] = new Date()
  }
  const sig = current.join(',')
  const remind = !w.wrongNotifiedAt || w.wrongNotifiedSig !== sig || now - new Date(w.wrongNotifiedAt).getTime() > WRONG_NS_REMIND_MS
  const age = now - new Date(acct.createdAt).getTime()
  if (!nsOk && remind && age > 15 * 60e3 && await deps.isExternal(acct)) {
    await sendMessage(acct.chatId, pick(MSG.wrong, lang)(domain, current, expected, typo), { parse_mode: 'HTML' }).catch(e => log(`notify ns ${domain}: ${e.message}`))
    set['dnsWatch.wrongNotifiedAt'] = new Date()
    set['dnsWatch.wrongNotifiedSig'] = sig
    log(`${domain}: wrong NS [${sig}] (expected ${expected.join(',')}) — user ${acct.chatId} told${typo.length ? ' (typo)' : ''}`)
  }
  return col.updateOne({ _id: acct._id }, { $set: set })
}

async function tick(db, deps) {
  const since = new Date(Date.now() - WATCH_DAYS * 86400e3)
  const accts = await db.collection('cpanelAccounts').find({
    domain: { $exists: true }, deleted: { $ne: true }, terminatedOnWhm: { $ne: true },
    'dnsWatch.liveAt': { $exists: false }, $or: [{ createdAt: { $gte: since } }, { createdAt: { $gte: since.toISOString() } }],
  }).limit(200).toArray()
  for (const a of accts) {
    // One pod at a time per account (blue/green deploys share the DB).
    const lock = await db.collection('cpanelAccounts').updateOne({ _id: a._id, $or: [{ 'dnsWatch.lockUntil': { $exists: false } }, { 'dnsWatch.lockUntil': { $lt: new Date() } }] }, { $set: { 'dnsWatch.lockUntil': new Date(Date.now() + 4 * 60e3) } })
    if (!lock.modifiedCount) continue
    await checkOne(db, a, deps).catch(e => deps.log(`${a.domain}: ${e.message}`))
  }
}

// Plain-language line for the support AI.
function describe(w, domain) {
  if (!w?.status) return null
  const when = w.lastCheckAt ? ` (checked ${new Date(w.lastCheckAt).toISOString().slice(11, 16)} UTC)` : ''
  if (w.status === 'live') return `DNS: ✅ live since ${new Date(w.liveAt).toISOString().slice(0, 16).replace('T', ' ')} UTC — site loads at https://${domain}`
  if (w.status === 'wrong_nameservers') return `DNS: ❌ NOT live — nameservers at the user's registrar are wrong${when}. Currently: ${(w.currentNs || []).join(', ') || 'none'}. Must be exactly: ${(w.expectedNs || []).join(', ')}.${w.typoNs?.length ? ` TYPO detected: ${w.typoNs.join(', ')}.` : ''} Tell the user exactly which names to fix at their registrar; the bot messages them automatically once it is live.`
  return `DNS: ⏳ nameservers are correct, waiting for propagation/activation${when}. Usually 5–60 min (max 24h). The bot will message the user automatically when the site is live.`
}

function startScheduler(db, deps) {
  if (String(process.env.SKIP_WEBHOOK_SYNC || '').toLowerCase() === 'true') return deps.log('SKIP_WEBHOOK_SYNC=true → hosting DNS watch DISABLED on this pod')
  const ms = Number(process.env.HOSTING_DNS_WATCH_MS || 5 * 60e3)
  setInterval(() => tick(db, deps).catch(e => deps.log(`tick: ${e.message}`)), ms)
  setTimeout(() => tick(db, deps).catch(e => deps.log(`tick: ${e.message}`)), 30e3)
  deps.log(`started (every ${Math.round(ms / 60e3)} min)`)
}

module.exports = { tick, checkOne, startScheduler, describe, typos, registryNs, MSG }
