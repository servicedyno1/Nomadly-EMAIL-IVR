// Cloud IVR plan lifecycle: a main line and its extra lines (isSubNumber + parentNumber) are suspended,
// held, restored and released together. Pure helpers return patches; callers apply them locally or to Mongo.
const phoneConfig = require('./phone-config.js')

const { formatPhone, shortDate } = phoneConfig
const HOLD_DAYS = 7
const DAY_MS = 24 * 60 * 60 * 1000
const round2 = (x) => Math.round(Number(x) * 100) / 100
const live = (n) => !!n && (n.status === 'active' || n.status === 'suspended')
const planName = (n) => phoneConfig.plans[n.plan]?.name || n.plan || ''
// Our own live-call test lines: free, never expire, never flagged by the pricing check.
const isInternalTest = (n) => n?.internalTest === true || n?.e2eTest === true

// Plan price plus any per-number surcharge: what a main line costs per month.
function canonicalPrice(n) {
  const p = phoneConfig.plans?.[String(n?.plan || '').toLowerCase()]?.price
  return Number.isFinite(p) ? round2(p + (Number(n.numberSurcharge) || 0)) : null
}

// What renewing or restoring this line charges (null = unknown, don't charge).
function renewalPrice(n) {
  const stored = Number(n.planPrice)
  if (isInternalTest(n)) return 0
  if (n.isSubNumber) return round2(Math.max(Number.isFinite(stored) ? stored : 0, phoneConfig.SUB_NUMBER_BASE_PRICE))
  if (n.grandfathered === true && stored > 0) return round2(stored)
  return canonicalPrice(n) ?? (stored > 0 ? round2(stored) : null)
}

const mainOf = (numbers, n) => (n.isSubNumber ? numbers.find(x => x.phoneNumber === n.parentNumber && live(x)) || null : null)
const extrasOf = (numbers, main) => numbers.filter(x => x.isSubNumber && x.parentNumber === main.phoneNumber && live(x))

// An active line whose main line is gone (or that the Oct-2026 migration left standalone at the extra-line price).
function isOrphan(numbers, n) {
  if (n.status !== 'active' || isInternalTest(n)) return false
  if (n.isSubNumber) return !mainOf(numbers, n)
  return !!n.formerSubNumberOf && !n._orphanHandledAt
}

// ── Shared allowance: a main line and its extra lines draw on ONE pool of the main line's plan minutes / SMS ──
const lineGroup = (numbers, n) => {
  const main = n.isSubNumber ? (numbers || []).find(x => x.phoneNumber === n.parentNumber && !x.isSubNumber && x.status !== 'released') : n
  if (!main) return { main: n, lines: [n] }
  return { main, lines: [main, ...(numbers || []).filter(x => x.isSubNumber && x.parentNumber === main.phoneNumber && x.status !== 'released' && x !== main)] }
}
// Unknown plan → 0 (overage billing applies); 'Unlimited' → Infinity.
function planLimit(planKey, field) {
  const p = phoneConfig.plans[planKey]
  if (!p) return 0
  const v = p[field]
  if (v === 'Unlimited' || v == null) return Infinity
  const x = Number(v)
  return Number.isFinite(x) ? x : Infinity
}
function poolUsage(numbers, n) {
  const { main, lines } = lineGroup(numbers, n)
  const sum = (f) => lines.reduce((s, x) => s + (Number(x[f]) || 0), 0)
  return { main, lines, minutesUsed: sum('minutesUsed'), smsUsed: sum('smsUsed'), minuteLimit: planLimit(main.plan, 'minutes'), smsLimit: planLimit(main.plan, 'sms') }
}

// ── Usage cycle = the month that ends at the main line's expiresAt. Counters (and 80/100% alert flags) of the
// whole group reset once per cycle, whatever day of the month the plan was bought or renewed. ──
const USAGE_RESET = { smsUsed: 0, minutesUsed: 0, _smsAlert80: false, _smsAlert100: false, _minAlert80: false, _minAlert100: false, _smsLimitNotified: false, _minLimitNotified: false }
function usageResetPatches(numbers, main, now = new Date()) {
  if (!main || main.isSubNumber || main.status !== 'active') return []
  const start = new Date(main.expiresAt)
  if (isNaN(start.getTime())) return []
  start.setMonth(start.getMonth() - 1)
  if (start > now) return []
  const last = main._usageResetAt ? new Date(main._usageResetAt) : null
  // First sight of a line (pre-existing data): start tracking from now without wiping the current counters.
  if (!last) return [{ phoneNumber: main.phoneNumber, set: { _usageResetAt: now.toISOString() } }]
  if (last >= start) return []
  return lineGroup(numbers, main).lines.map(x => ({ phoneNumber: x.phoneNumber, set: x === main ? { ...USAGE_RESET, _usageResetAt: now.toISOString() } : { ...USAGE_RESET } }))
}

// Monthly price of `n` moved to `newPlan`, keeping its per-number surcharge (same rule as the web app).
function priceOnPlan(n, newPlan) {
  const cur = phoneConfig.plans[n.plan], next = phoneConfig.plans[newPlan]
  if (!next) return null
  const surcharge = cur ? Math.max(0, round2((Number(n.planPrice) || cur.price) - cur.price)) : (Number(n.numberSurcharge) || 0)
  return round2(next.price + surcharge)
}

// Extra lines always carry their main line's plan.
const syncExtrasPlan = (col, chatId, parentNumber, plan) => col.updateOne(
  { _id: chatId }, { $set: { 'val.numbers.$[s].plan': plan } }, { arrayFilters: [{ 's.isSubNumber': true, 's.parentNumber': parentNumber }] },
).catch(() => {})

const onHold = (n) => n.status === 'suspended' && !!n._holdUntil
const holdOver = (n, now = new Date()) => onHold(n) && new Date(n._holdUntil) <= now
const hold = (now, reason) => ({
  status: 'suspended', _suspendedAt: now.toISOString(), _holdUntil: new Date(now.getTime() + HOLD_DAYS * DAY_MS).toISOString(),
  _suspendReason: reason, _graceUntil: null, _reminder3Sent: false, _reminder1Sent: false,
})

// Main line's plan ended → the main line and every active extra line are suspended and held together.
function suspendPlan(numbers, main, now = new Date()) {
  const patches = [{ phoneNumber: main.phoneNumber, set: hold(now, 'plan_expired') }]
  for (const x of extrasOf(numbers, main)) if (x.status === 'active') patches.push({ phoneNumber: x.phoneNumber, set: hold(now, 'main_line_expired') })
  return patches
}

// Orphan → becomes a main line on its own plan, suspended until the plan price is paid.
function orphanToMain(n, now = new Date()) {
  const plan = phoneConfig.plans[n.plan] ? n.plan : 'pro'
  const set = {
    ...hold(now, 'plan_expired'), isSubNumber: false, parentNumber: null, plan,
    formerSubNumberOf: n.formerSubNumberOf || n.parentNumber || null, _orphanHandledAt: now.toISOString(), _orphanPriceFrom: n.planPrice ?? null,
  }
  set.planPrice = canonicalPrice({ ...n, plan }) ?? n.planPrice
  return [{ phoneNumber: n.phoneNumber, set }]
}

const releasePatch = (n) => ({ phoneNumber: n.phoneNumber, set: { status: 'released', _released: true, _releasedAfterHold: true, _holdUntil: null, _reminder3Sent: false, _reminder1Sent: false } })

// Why `n` can't be renewed right now (null when it can).
function renewBlock(numbers, n) {
  if (n.status === 'released' || n._released) return 'released'
  if (n.isSubNumber && mainOf(numbers, n)?.status !== 'active') return 'main_line_suspended'
  if (renewalPrice(n) == null) return 'no_price'
  return null
}

// Paid renewal / restore of `n`. Restoring a main line also brings back extras whose own paid month hasn't ended;
// the others stay suspended (on the same hold) until each is renewed at the extra-line price.
function renewPatches(numbers, n, now = new Date()) {
  const exp = new Date(n.expiresAt || 0)
  const lapsed = !(exp > now)
  const until = new Date(Math.max(now.getTime(), exp.getTime() || 0))
  until.setMonth(until.getMonth() + 1)
  const clear = { _suspendedAt: null, _holdUntil: null, _suspendReason: null, _graceUntil: null, _reminder3Sent: false, _reminder1Sent: false }
  // A lapsed main line starts a fresh usage cycle now for its whole group; an extra line rides its main line's cycle.
  const freshCycle = lapsed && !n.isSubNumber
  const set = { ...clear, status: 'active', expiresAt: until.toISOString(), ...(freshCycle ? { ...USAGE_RESET, _usageResetAt: now.toISOString() } : {}) }
  const price = renewalPrice(n)
  if (!n.isSubNumber && price > 0 && Number(n.planPrice) !== price) set.planPrice = price
  const patches = [{ phoneNumber: n.phoneNumber, set }]
  const restored = [], waiting = []
  if (!n.isSubNumber && n.status === 'suspended') {
    for (const x of extrasOf(numbers, n)) {
      if (x.status !== 'suspended' || x._suspendReason !== 'main_line_expired') continue
      if (new Date(x.expiresAt) > now) { patches.push({ phoneNumber: x.phoneNumber, set: { ...clear, status: 'active' } }); restored.push(x.phoneNumber) }
      else waiting.push({ phoneNumber: x.phoneNumber, price: renewalPrice(x), holdUntil: x._holdUntil })
    }
  }
  if (freshCycle) for (const x of extrasOf(numbers, n)) patches.push({ phoneNumber: x.phoneNumber, set: { ...USAGE_RESET } })
  return { patches, price, restored, waiting, expiresAt: set.expiresAt, wasSuspended: n.status === 'suspended' }
}

function applyLocal(numbers, patches) {
  for (const p of patches) {
    const n = numbers.find(x => x.phoneNumber === p.phoneNumber && x.status !== 'released')
    if (n) Object.assign(n, p.set)
  }
}

async function applyDb(col, chatId, patches) {
  for (const p of patches) {
    const set = Object.fromEntries(Object.entries(p.set).map(([k, v]) => [`val.numbers.$.${k}`, v]))
    await col.updateOne({ _id: chatId, 'val.numbers': { $elemMatch: { phoneNumber: p.phoneNumber, status: { $ne: 'released' } } } }, { $set: set })
  }
}

// ── Customer messages (en / fr / zh / hi) ──
const pick = (m, lang) => m[lang] || m.en
const list = (phones) => phones.map(formatPhone).join(', ')

function planSuspendedMsg(main, extras, price, lang) {
  const p = formatPhone(main.phoneNumber), d = shortDate(main._holdUntil), x = extras.map(e => e.phoneNumber)
  return pick({
    en: `⏸️ <b>Plan expired — line suspended</b>\n\n📞 ${p} (${planName(main)} plan)${x.length ? `\n➕ Extra lines also suspended: ${list(x)}` : ''}\n\nCalls and SMS are stopped. Renew for <b>$${price}</b> by <b>${d}</b> to restore ${x.length ? 'everything' : 'it'}. After that ${x.length ? 'the lines are' : 'the number is'} released for good and can't be recovered.\n\n👉 Open the number → 🔄 Renew / Change Plan → Renew Now`,
    fr: `⏸️ <b>Forfait expiré — ligne suspendue</b>\n\n📞 ${p} (forfait ${planName(main)})${x.length ? `\n➕ Lignes supplémentaires aussi suspendues : ${list(x)}` : ''}\n\nLes appels et SMS sont coupés. Renouvelez pour <b>$${price}</b> avant le <b>${d}</b> pour tout rétablir. Ensuite, ${x.length ? 'les lignes sont libérées' : 'le numéro est libéré'} définitivement.\n\n👉 Ouvrez le numéro → 🔄 Renouveler / Changer de forfait → Renouveler`,
    zh: `⏸️ <b>套餐已到期 — 号码已暂停</b>\n\n📞 ${p}（${planName(main)} 套餐）${x.length ? `\n➕ 附加号码也已暂停：${list(x)}` : ''}\n\n通话和短信已停止。请在 <b>${d}</b> 前支付 <b>$${price}</b> 续费以恢复。逾期号码将被永久释放，无法恢复。\n\n👉 打开号码 → 🔄 续费 / 更改套餐 → 立即续费`,
    hi: `⏸️ <b>प्लान समाप्त — नंबर निलंबित</b>\n\n📞 ${p} (${planName(main)} प्लान)${x.length ? `\n➕ अतिरिक्त नंबर भी निलंबित: ${list(x)}` : ''}\n\nकॉल और SMS बंद हैं। बहाल करने के लिए <b>${d}</b> तक <b>$${price}</b> में रिन्यू करें। उसके बाद नंबर स्थायी रूप से रिलीज़ हो जाएगा।\n\n👉 नंबर खोलें → 🔄 रिन्यू / प्लान बदलें → अभी रिन्यू करें`,
  }, lang)
}

function orphanSuspendedMsg(n, price, lang) {
  const p = formatPhone(n.phoneNumber), d = shortDate(n._holdUntil), pl = planName(n)
  return pick({
    en: `⏸️ <b>Main line ended — number suspended</b>\n\n📞 ${p} was an extra line on a plan that has ended, so it is now suspended. Calls and SMS are stopped.\n\nPay <b>$${price}</b> by <b>${d}</b> to restore it as your main ${pl} line. After that it is released for good.\n\n👉 Open the number → 🔄 Renew / Change Plan → Renew Now`,
    fr: `⏸️ <b>Ligne principale terminée — numéro suspendu</b>\n\n📞 ${p} était une ligne supplémentaire d'un forfait terminé ; il est donc suspendu. Les appels et SMS sont coupés.\n\nPayez <b>$${price}</b> avant le <b>${d}</b> pour le rétablir comme ligne principale ${pl}. Ensuite, il est libéré définitivement.\n\n👉 Ouvrez le numéro → 🔄 Renouveler / Changer de forfait → Renouveler`,
    zh: `⏸️ <b>主号码已结束 — 号码已暂停</b>\n\n📞 ${p} 是一个已结束套餐的附加号码，现已暂停。通话和短信已停止。\n\n请在 <b>${d}</b> 前支付 <b>$${price}</b>，将其恢复为您的 ${pl} 主号码。逾期将被永久释放。\n\n👉 打开号码 → 🔄 续费 / 更改套餐 → 立即续费`,
    hi: `⏸️ <b>मुख्य लाइन समाप्त — नंबर निलंबित</b>\n\n📞 ${p} एक समाप्त प्लान की अतिरिक्त लाइन थी, इसलिए अब निलंबित है। कॉल और SMS बंद हैं।\n\nइसे अपनी मुख्य ${pl} लाइन के रूप में बहाल करने के लिए <b>${d}</b> तक <b>$${price}</b> दें। उसके बाद यह स्थायी रूप से रिलीज़ हो जाएगा।\n\n👉 नंबर खोलें → 🔄 रिन्यू / प्लान बदलें → अभी रिन्यू करें`,
  }, lang)
}

function releasedAfterHoldMsg(n, lang) {
  const p = formatPhone(n.phoneNumber)
  return pick({
    en: `📤 <b>Number released</b>\n\n📞 ${p} was not restored within ${HOLD_DAYS} days, so it has been released and can't be recovered. You can buy a new number anytime from the Cloud IVR menu.`,
    fr: `📤 <b>Numéro libéré</b>\n\n📞 ${p} n'a pas été rétabli sous ${HOLD_DAYS} jours ; il a été libéré définitivement. Vous pouvez acheter un nouveau numéro depuis le menu Cloud IVR.`,
    zh: `📤 <b>号码已释放</b>\n\n📞 ${p} 未在 ${HOLD_DAYS} 天内恢复，已被永久释放。您可以随时从 Cloud IVR 菜单购买新号码。`,
    hi: `📤 <b>नंबर रिलीज़ किया गया</b>\n\n📞 ${p} ${HOLD_DAYS} दिनों में बहाल नहीं हुआ, इसलिए स्थायी रूप से रिलीज़ कर दिया गया। आप Cloud IVR मेनू से कभी भी नया नंबर खरीद सकते हैं।`,
  }, lang)
}

function renewBlockMsg(code, lang) {
  const m = {
    main_line_suspended: { en: '⏸️ This extra line comes back when its main line is restored. Renew the main line first.', fr: '⏸️ Cette ligne supplémentaire revient quand sa ligne principale est rétablie. Renouvelez d\'abord la ligne principale.', zh: '⏸️ 主号码恢复后，此附加号码才会恢复。请先为主号码续费。', hi: '⏸️ मुख्य लाइन बहाल होने पर यह अतिरिक्त लाइन वापस आती है। पहले मुख्य लाइन रिन्यू करें।' },
    released: { en: '📤 This number has been released and can no longer be renewed.', fr: '📤 Ce numéro a été libéré et ne peut plus être renouvelé.', zh: '📤 此号码已被释放，无法续费。', hi: '📤 यह नंबर रिलीज़ हो चुका है और रिन्यू नहीं हो सकता।' },
    no_price: { en: '⚠️ We could not work out the renewal price for this line. Please contact support.', fr: '⚠️ Impossible de calculer le prix de renouvellement. Contactez le support.', zh: '⚠️ 无法计算此号码的续费价格，请联系客服。', hi: '⚠️ इस लाइन की रिन्यू कीमत तय नहीं हो सकी। कृपया सपोर्ट से संपर्क करें।' },
  }
  return pick(m[code] || m.no_price, lang)
}

// One-line notice shown above the renew menu while a line is suspended.
function holdNotice(n, price, lang) {
  if (!onHold(n)) return ''
  const d = shortDate(n._holdUntil)
  if (n.isSubNumber) return pick({ en: `⏸️ <b>Suspended</b> — comes back when the main line is restored (by ${d}).`, fr: `⏸️ <b>Suspendu</b> — revient quand la ligne principale est rétablie (avant le ${d}).`, zh: `⏸️ <b>已暂停</b> — 主号码恢复后即恢复（截止 ${d}）。`, hi: `⏸️ <b>निलंबित</b> — मुख्य लाइन बहाल होने पर वापस आएगा (${d} तक)।` }, lang)
  return pick({ en: `⏸️ <b>Suspended</b> — renew for $${price} by ${d} to restore it, or it is released for good.`, fr: `⏸️ <b>Suspendu</b> — renouvelez pour $${price} avant le ${d}, sinon il est libéré définitivement.`, zh: `⏸️ <b>已暂停</b> — 请在 ${d} 前支付 $${price} 续费恢复，否则将被永久释放。`, hi: `⏸️ <b>निलंबित</b> — ${d} तक $${price} में रिन्यू करें, वरना यह स्थायी रूप से रिलीज़ हो जाएगा।` }, lang)
}

function renewedMsg(n, r, lang) {
  const p = formatPhone(n.phoneNumber), d = shortDate(r.expiresAt)
  const back = r.restored.length ? list(r.restored) : ''
  const wait = r.waiting.map(w => `${formatPhone(w.phoneNumber)} ($${w.price})`).join(', ')
  const waitBy = r.waiting[0] ? shortDate(r.waiting[0].holdUntil) : ''
  return pick({
    en: `✅ <b>${r.wasSuspended ? 'Line restored' : 'Renewed'}</b>\n\n📞 ${p} — paid until <b>${d}</b>\n💰 Charged $${r.price} from your wallet${back ? `\n➕ Back on: ${back}` : ''}${wait ? `\n⏸️ Still suspended (their paid month ended): ${wait} — renew each by ${waitBy}.` : ''}`,
    fr: `✅ <b>${r.wasSuspended ? 'Ligne rétablie' : 'Renouvelé'}</b>\n\n📞 ${p} — payé jusqu'au <b>${d}</b>\n💰 $${r.price} débités de votre portefeuille${back ? `\n➕ Réactivées : ${back}` : ''}${wait ? `\n⏸️ Toujours suspendues (mois payé terminé) : ${wait} — renouvelez-les avant le ${waitBy}.` : ''}`,
    zh: `✅ <b>${r.wasSuspended ? '号码已恢复' : '续费成功'}</b>\n\n📞 ${p} — 有效期至 <b>${d}</b>\n💰 已从钱包扣除 $${r.price}${back ? `\n➕ 已恢复：${back}` : ''}${wait ? `\n⏸️ 仍暂停（已付月份已结束）：${wait} — 请在 ${waitBy} 前分别续费。` : ''}`,
    hi: `✅ <b>${r.wasSuspended ? 'लाइन बहाल' : 'रिन्यू हुआ'}</b>\n\n📞 ${p} — <b>${d}</b> तक भुगतान\n💰 वॉलेट से $${r.price} कटे${back ? `\n➕ वापस चालू: ${back}` : ''}${wait ? `\n⏸️ अभी भी निलंबित (भुगतान माह समाप्त): ${wait} — ${waitBy} तक हर एक रिन्यू करें।` : ''}`,
  }, lang)
}

module.exports = {
  HOLD_DAYS, isInternalTest, canonicalPrice, renewalPrice, mainOf, extrasOf, isOrphan, onHold, holdOver,
  lineGroup, planLimit, poolUsage, USAGE_RESET, usageResetPatches, priceOnPlan, syncExtrasPlan,
  suspendPlan, orphanToMain, releasePatch, renewBlock, renewPatches, applyLocal, applyDb,
  planSuspendedMsg, orphanSuspendedMsg, releasedAfterHoldMsg, renewBlockMsg, holdNotice, renewedMsg,
}
