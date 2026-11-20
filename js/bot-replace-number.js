'use strict'
// Telegram bot: Replace number — same search, price, rules and provisioning as the web app (cloudivr-web/numbers.js replaceNumber).
// Steps: intro (+ area code for US/CA local) → pick one of the found numbers → review → pay from wallet.
const setupStatus = require('./setup-status')

const L = {
  en: {
    btn: '🔁 Replace Number', same: (a) => `📍 Same area code (${a})`, any: '🌎 Any area code', pay: (p) => `✅ Pay $${p} & replace`,
    intro: (n, p, d) => `🔁 <b>Replace ${n}</b>\n\nYou get a new number of the same kind for <b>$${p}</b>. Your plan, renewal date, settings and SIP login move over. The old number keeps working for ${d} days, then it's released.`,
    askArea: '🏙️ Type a 3-digit area code, or tap a button below.', searching: '🔍 Searching numbers…', none: 'No numbers found there right now. Try another area code.',
    pick: 'Tap the number you want:', tapOne: 'Tap one of the numbers above, or Back.',
    review: (o, n, p, b) => `🧾 <b>Review</b>\n\n${o} → <b>${n}</b>\n💰 <b>$${p}</b> from your wallet (balance $${b})`,
    working: '⏳ Replacing your number…', unavailable: 'Replacing a number is not available right now. Please try again later.',
    done: (o, n, d) => `✅ <b>${n}</b> replaces ${o}.\nYour plan, renewal date and settings moved over. ${o} keeps working until ${d}.`,
    fail: (m) => `⚠️ ${m}`,
  },
  fr: {
    btn: '🔁 Remplacer le numéro', same: (a) => `📍 Même indicatif (${a})`, any: '🌎 N’importe quel indicatif', pay: (p) => `✅ Payer ${p} $ et remplacer`,
    intro: (n, p, d) => `🔁 <b>Remplacer ${n}</b>\n\nVous obtenez un nouveau numéro du même type pour <b>${p} $</b>. Votre forfait, date de renouvellement, réglages et identifiant SIP sont transférés. L’ancien numéro fonctionne encore ${d} jours, puis il est libéré.`,
    askArea: '🏙️ Tapez un indicatif à 3 chiffres, ou touchez un bouton ci-dessous.', searching: '🔍 Recherche de numéros…', none: 'Aucun numéro disponible ici pour le moment. Essayez un autre indicatif.',
    pick: 'Touchez le numéro souhaité :', tapOne: 'Touchez un des numéros ci-dessus, ou Retour.',
    review: (o, n, p, b) => `🧾 <b>Vérification</b>\n\n${o} → <b>${n}</b>\n💰 <b>${p} $</b> depuis votre portefeuille (solde ${b} $)`,
    working: '⏳ Remplacement en cours…', unavailable: 'Le remplacement de numéro n’est pas disponible pour le moment. Réessayez plus tard.',
    done: (o, n, d) => `✅ <b>${n}</b> remplace ${o}.\nVotre forfait, date de renouvellement et réglages sont transférés. ${o} fonctionne jusqu’au ${d}.`,
    fail: (m) => `⚠️ ${m}`,
  },
  zh: {
    btn: '🔁 更换号码', same: (a) => `📍 相同区号 (${a})`, any: '🌎 任意区号', pay: (p) => `✅ 支付 $${p} 并更换`,
    intro: (n, p, d) => `🔁 <b>更换 ${n}</b>\n\n只需 <b>$${p}</b> 即可获得同类型的新号码。套餐、续费日期、设置和 SIP 登录都会转移。旧号码继续可用 ${d} 天，之后释放。`,
    askArea: '🏙️ 输入 3 位区号，或点击下方按钮。', searching: '🔍 正在搜索号码…', none: '该地区暂无可用号码，请换个区号。',
    pick: '点击您想要的号码：', tapOne: '点击上方的号码，或返回。',
    review: (o, n, p, b) => `🧾 <b>确认</b>\n\n${o} → <b>${n}</b>\n💰 从钱包扣除 <b>$${p}</b>（余额 $${b}）`,
    working: '⏳ 正在更换号码…', unavailable: '暂时无法更换号码，请稍后再试。',
    done: (o, n, d) => `✅ <b>${n}</b> 已替换 ${o}。\n套餐、续费日期和设置已转移。${o} 可用至 ${d}。`,
    fail: (m) => `⚠️ ${m}`,
  },
  hi: {
    btn: '🔁 नंबर बदलें', same: (a) => `📍 वही एरिया कोड (${a})`, any: '🌎 कोई भी एरिया कोड', pay: (p) => `✅ $${p} दें और बदलें`,
    intro: (n, p, d) => `🔁 <b>${n} बदलें</b>\n\n<b>$${p}</b> में उसी तरह का नया नंबर मिलेगा। आपका प्लान, रिन्यूअल तारीख, सेटिंग्स और SIP लॉगिन साथ जाएंगे। पुराना नंबर ${d} दिन और चलेगा, फिर हटा दिया जाएगा।`,
    askArea: '🏙️ 3 अंकों का एरिया कोड लिखें, या नीचे बटन दबाएं।', searching: '🔍 नंबर खोजे जा रहे हैं…', none: 'अभी वहां कोई नंबर नहीं मिला। दूसरा एरिया कोड आज़माएं।',
    pick: 'अपना नंबर चुनें:', tapOne: 'ऊपर दिए नंबरों में से एक चुनें, या Back दबाएं।',
    review: (o, n, p, b) => `🧾 <b>जांचें</b>\n\n${o} → <b>${n}</b>\n💰 वॉलेट से <b>$${p}</b> (बैलेंस $${b})`,
    working: '⏳ नंबर बदला जा रहा है…', unavailable: 'नंबर बदलना अभी उपलब्ध नहीं है। बाद में कोशिश करें।',
    done: (o, n, d) => `✅ <b>${n}</b> ने ${o} की जगह ले ली।\nप्लान, रिन्यूअल तारीख और सेटिंग्स साथ आ गईं। ${o} ${d} तक चलेगा।`,
    fail: (m) => `⚠️ ${m}`,
  },
}
const T = (lang) => L[lang] || L.en
const ALL = (k) => Object.values(L).map(l => l[k])
const isMenu = (m) => ALL('btn').includes(m)
const isAny = (m) => ALL('any').includes(m)
const head = (f) => f('\u0000').split('\u0000')[0]
const isSame = (m) => Object.values(L).some(l => String(m || '').startsWith(head(l.same))) && /\(\d{3}\)$/.test(String(m))
const isPay = (m) => Object.values(L).some(l => String(m || '').startsWith(head(l.pay)))
const api = () => require('./cloudivr-web').numbersApi
const areaOf = (n) => (/^\+1\d{10}$/.test(n.phoneNumber) ? n.phoneNumber.slice(2, 5) : null)
const usesArea = (n) => ['US', 'CA'].includes(n.country) && n.type === 'local'
const MAX_SHOWN = 6

// Show Replace number on the manage menu?
const offered = (num) => !!api()?.replaceNumber && num?.status === 'active' && !num.replacedBy && !num.dryRun

async function search(c, num, areaCode) {
  const t = T(c.lang)
  await c.send(t.searching)
  const found = (await api().searchForReplace(c.chatId, num, areaCode).catch(e => { c.log?.(`[BotReplace] search: ${e.message}`); return [] })).slice(0, MAX_SHOWN)
  if (!found.length) {
    await c.setAction('rpnArea')
    return c.send(t.none, c.kb(usesArea(num) ? [[t.any]] : []))
  }
  await c.save('rpnList', found.map(r => r.phoneNumber))
  await c.setAction('rpnPick')
  return c.send(`${t.pick}\n\n${found.map(r => `• <code>${r.phoneNumber}</code>${r.region ? ` — ${r.region}` : ''}`).join('\n')}`, c.kb([...found.map(r => [r.phoneNumber]), ...(usesArea(num) ? [[t.any]] : [])]))
}

async function start(c, num) {
  const t = T(c.lang), A = api()
  if (!offered(num)) return c.send(num?.replacedBy ? t.fail(`This number was already replaced by ${num.replacedBy}.`) : t.unavailable)
  await c.save('rpnFor', num.phoneNumber)
  await c.send(t.intro(num.phoneNumber, A.REPLACE_PRICE, A.OVERLAP_DAYS))
  if (!usesArea(num)) return search(c, num, null)
  await c.setAction('rpnArea')
  return c.send(t.askArea, c.kb([[t.same(areaOf(num))], [t.any]]))
}

async function finish(c, num) {
  const t = T(c.lang), A = api(), phone = c.info?.rpnChoice
  await c.send(t.working)
  const r = await A.replaceNumber(c.chatId, num, await A.pickFromSearch(c.chatId, phone), { channel: 'bot' })
    .catch(e => ({ status: 500, body: { message: e.message } }))
  await c.save('rpnChoice', null); await c.save('rpnList', null)
  if (r.status !== 201) { await c.send(t.fail(r.body?.message || 'The number could not be replaced.')); return c.back() }
  const fresh = r.body.number.phoneNumber
  await c.send(t.done(num.phoneNumber, fresh, String(r.body.releaseAt).slice(0, 10)) + (await setupStatus.botBlock(c.db, c.chatId, c.lang, fresh)))
  return c.open(fresh)
}

// ctx: { chatId, message, action, info, lang, num, db, setAction, save, send, kb, back, open, wallet, log }
async function handle(c) {
  const t = T(c.lang), num = c.num, m = c.message
  if (!api()?.replaceNumber) { await c.send(t.unavailable); return c.back() }
  if (!num || num.phoneNumber !== c.info?.rpnFor) return c.back()
  if (c.action === 'rpnArea') {
    if (isSame(m)) return search(c, num, areaOf(num))
    if (isAny(m)) return search(c, num, null)
    if (/^\d{3}$/.test(String(m).trim())) return search(c, num, String(m).trim())
    return c.send(t.askArea, c.kb([[t.same(areaOf(num))], [t.any]]))
  }
  if (c.action === 'rpnPick') {
    if (isAny(m)) return search(c, num, null)
    if (!(c.info?.rpnList || []).includes(m)) return c.send(t.tapOne)
    await c.save('rpnChoice', m)
    await c.setAction('rpnConfirm')
    const bal = Number(await c.wallet().catch(() => 0)).toFixed(2)
    return c.send(t.review(num.phoneNumber, m, api().REPLACE_PRICE, bal), c.kb([[t.pay(api().REPLACE_PRICE)]]))
  }
  if (c.action === 'rpnConfirm' && isPay(m)) return finish(c, num)
  return c.back()
}

module.exports = { isMenu, offered, start, handle, T }
