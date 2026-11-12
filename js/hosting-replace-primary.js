'use strict'
// A hosting plan whose main domain Cloudflare refuses (abuse block, code 1097) gets a free swap to a new main domain.
// Shared by the bot and the web HostPanel. Flag: cpanelAccounts.primaryCfBlocked (set at provisioning).
const { log } = require('console')

const DOMAIN_RE = /^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/

async function ownedDomains(db, chatId) {
  const doc = await db.collection('domainsOf').findOne({ _id: String(chatId) }).catch(() => null)
  return doc ? Object.keys(doc).filter(k => k !== '_id' && doc[k]).map(k => k.replace(/@/g, '.').toLowerCase()) : []
}

// Domains the user owns that are free to become this plan's main domain.
async function eligibleReplacements(db, account) {
  const owned = (await ownedDomains(db, account.chatId)).filter(d => d !== String(account.domain).toLowerCase())
  if (!owned.length) return []
  const used = new Set()
  for (const r of await db.collection('cpanelAccounts').find({ $or: [{ domain: { $in: owned } }, { addonDomains: { $in: owned } }], deleted: { $ne: true }, _id: { $ne: account._id } }, { projection: { domain: 1, addonDomains: 1 } }).toArray()) {
    used.add(String(r.domain).toLowerCase()); for (const a of r.addonDomains || []) used.add(String(a).toLowerCase())
  }
  return owned.filter(d => !used.has(d))
}

// Returns { ok, newDomain, oldDomain, nameservers, external } or { ok: false, kind, error }.
async function replaceBlockedPrimary({ db, account, newDomain, cpPass = null, bot = null, lang = 'en', notifyAdmin = null, by = 'bot' }) {
  const cfService = require('./cf-service'), whmService = require('./whm-service')
  const d = String(newDomain || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '')
  const oldDomain = String(account.domain || '').toLowerCase()
  if (!account.primaryCfBlocked) return { ok: false, kind: 'not_blocked', error: 'This plan\'s main domain is not flagged.' }
  if (!DOMAIN_RE.test(d)) return { ok: false, kind: 'invalid', error: 'Enter a valid domain, e.g. example.com' }
  if (d === oldDomain) return { ok: false, kind: 'same', error: `${d} is the flagged domain — pick a different one.` }
  if (await db.collection('blockedDomains').findOne({ domain: d })) return { ok: false, kind: 'blocked', error: `${d} is blocked and cannot be used.` }
  const other = await db.collection('cpanelAccounts').findOne({ $or: [{ domain: d }, { addonDomains: d }], deleted: { $ne: true }, _id: { $ne: account._id } })
  if (other) return { ok: false, kind: 'on_other_plan', error: `${d} is already on another hosting plan — remove it there first.` }
  const zr = await cfService.ensureZoneReady(d)
  if (!zr.ok) return { ok: false, kind: zr.blocked ? 'cf_blocked' : 'dns_not_ready', error: cfService.zoneNotReadyText(d, zr) }

  if ((account.addonDomains || []).map(x => String(x).toLowerCase()).includes(d) && cpPass) {
    await require('./cpanel-proxy').removeAddonDomain(account.cpUser, cpPass, d, undefined, oldDomain, account.whmHost).catch(e => log(`[ReplacePrimary] removeAddon warning: ${e.message}`))
  }
  let swap
  try { swap = await whmService.changePrimaryDomain(account.cpUser, d) } catch (e) { swap = { success: false, error: e.message } }
  if (!swap?.success) return { ok: false, kind: 'whm_failed', error: swap?.error || 'Could not switch the main domain. Please try again.' }

  await db.collection('cpanelAccounts').updateOne({ _id: account._id }, {
    $set: { domain: d, primaryReplacedFrom: oldDomain, primaryReplacedAt: new Date(), primaryReplacedBy: by },
    $unset: { primaryCfBlocked: '', primaryCfBlockedAt: '', [`docrootModes.${d}`]: '', [`docrootModes.${oldDomain}`]: '' },
    $pull: { addonDomains: d },
  })
  const external = !(await ownedDomains(db, account.chatId)).includes(d)
  const fresh = await db.collection('cpanelAccounts').findOne({ _id: account._id })
  require('./addon-domain-flow').runDnsAndProtection({ domain: d, cpUser: account.cpUser, whmHost: account.whmHost || process.env.WHM_HOST, account: fresh, db, bot, lang })
    .catch(e => log(`[ReplacePrimary] DNS/protection pipeline error for ${d}: ${e.message}`))
  try { require('./hosting-health-check').scheduleHealthCheck(d, account.cpUser, account.chatId || '') } catch (_) {}
  try { notifyAdmin?.(`🔁 <b>Flagged main domain replaced</b> (${by})\nUser: ${account.chatId}\ncPanel: <code>${account.cpUser}</code>\nOld (Cloudflare-blocked): <b>${oldDomain}</b>\nNew: <b>${d}</b>${external ? ' (external — user must set nameservers)' : ''}`) } catch (_) {}
  log(`[ReplacePrimary] ${account.cpUser}: ${oldDomain} → ${d} (${by}, external=${external})`)
  return { ok: true, newDomain: d, oldDomain, nameservers: zr.nameservers || [], external }
}

module.exports = { replaceBlockedPrimary, eligibleReplacements, DOMAIN_RE }
