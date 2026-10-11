/**
 * Hosting checkout UX helpers (2026-06).
 * Pure functions — copy + keyboard builders + button parsers for the
 * shortened Anti-Red hosting purchase flow. No DB / Telegram access here so
 * the whole module is unit-testable (see tests/test_hosting_checkout_ux_2026-06.js).
 */

const PLAN_KEYS = ['premiumWeekly', 'premiumCpanel', 'goldenCpanel']
const MAX_INLINE_OWNED = 3
const ALT_TIMEOUT_MS = 12000
const MAX_ALTS = 4

const money = n => Number(n || 0).toFixed(2)

const L = {
  en: {
    menu: ({ weekly, premium, golden, trialOn }) =>
      `🛡️ <b>Anti-Red Hosting — choose a plan</b>\n\n` +
      `⚡ <b>Premium Weekly</b> — $${weekly} · 7 days\n   10 GB SSD · up to 2 domains · IP cloaking + bot detection\n\n` +
      `🔷 <b>Premium HostPanel</b> — $${premium} · 30 days  ⭐ Most popular\n   50 GB SSD · up to 6 domains · + JS challenge & TLS blocking\n\n` +
      `👑 <b>Golden HostPanel</b> — $${golden} · 30 days\n   100 GB SSD · unlimited domains · full Anti-Red + Visitor Captcha + priority support\n\n` +
      (trialOn ? `💡 <b>Free Trial</b> — $0 · 12 hours · free .sbs domain\n\n` : '') +
      `✅ All plans: Free SSL · HostPanel · Cloudflare DNS · live in minutes\n👇 Tap a plan to see full details and start.`,
    chooseDomain: '👇 <b>Choose how to connect your domain to get started:</b>',
    chooseDomainOwned: '👇 <b>Tap one of your domains below to use it instantly, or add a new one:</b>',
    emailUse: email => `✅ Use ${email}`,
    walletCovers: (bal) => `👛 Wallet: <b>$${money(bal)}</b> ✅ covers this order — tap <b>Pay</b> below to finish.`,
    walletShort: (bal, short) => `👛 Wallet: <b>$${money(bal)}</b> — <b>$${money(short)} short</b>. Tap <b>💵 Deposit</b> and we'll bring you straight back to finish this order.`,
    loyalty: (badge, tier, pct, amt) => `${badge} ${tier} loyalty −${pct}% on wallet payments → <b>$${money(amt)}</b>`,
    payWallet: amt => `👛 Pay $${money(amt)} from Wallet`,
    altsSearching: base => `🔍 Searching alternatives for <b>${base}</b>…`,
    altsIntro: '✅ <b>Available right now</b> — tap one to use it, or type another name:',
    altsNone: base => `No alternatives found for <b>${base}</b>. Type a different name to check:`,
  },
  fr: {
    menu: ({ weekly, premium, golden, trialOn }) =>
      `🛡️ <b>Hébergement Anti-Red — choisissez un plan</b>\n\n` +
      `⚡ <b>Premium Hebdo</b> — $${weekly} · 7 jours\n   10 Go SSD · jusqu'à 2 domaines · cloaking IP + détection de bots\n\n` +
      `🔷 <b>Premium HostPanel</b> — $${premium} · 30 jours  ⭐ Le plus populaire\n   50 Go SSD · jusqu'à 6 domaines · + défi JS & blocage TLS\n\n` +
      `👑 <b>Golden HostPanel</b> — $${golden} · 30 jours\n   100 Go SSD · domaines illimités · Anti-Red complet + Captcha visiteurs + support prioritaire\n\n` +
      (trialOn ? `💡 <b>Essai gratuit</b> — $0 · 12 heures · domaine .sbs gratuit\n\n` : '') +
      `✅ Tous les plans : SSL gratuit · HostPanel · DNS Cloudflare · en ligne en quelques minutes\n👇 Appuyez sur un plan pour voir les détails et commencer.`,
    chooseDomain: '👇 <b>Choisissez comment connecter votre domaine pour commencer :</b>',
    chooseDomainOwned: '👇 <b>Appuyez sur un de vos domaines ci-dessous, ou ajoutez-en un nouveau :</b>',
    emailUse: email => `✅ Utiliser ${email}`,
    walletCovers: (bal) => `👛 Portefeuille : <b>$${money(bal)}</b> ✅ couvre cette commande — appuyez sur <b>Payer</b> ci-dessous.`,
    walletShort: (bal, short) => `👛 Portefeuille : <b>$${money(bal)}</b> — il manque <b>$${money(short)}</b>. Appuyez sur <b>💵 Deposit</b> et vous reviendrez directement terminer cette commande.`,
    loyalty: (badge, tier, pct, amt) => `${badge} Fidélité ${tier} −${pct}% sur les paiements portefeuille → <b>$${money(amt)}</b>`,
    payWallet: amt => `👛 Payer $${money(amt)} via Portefeuille`,
    altsSearching: base => `🔍 Recherche d'alternatives pour <b>${base}</b>…`,
    altsIntro: '✅ <b>Disponibles maintenant</b> — appuyez pour utiliser, ou tapez un autre nom :',
    altsNone: base => `Aucune alternative trouvée pour <b>${base}</b>. Tapez un autre nom :`,
  },
  zh: {
    menu: ({ weekly, premium, golden, trialOn }) =>
      `🛡️ <b>Anti-Red 托管 — 选择套餐</b>\n\n` +
      `⚡ <b>Premium 周付</b> — $${weekly} · 7 天\n   10 GB SSD · 最多 2 个域名 · IP 隐藏 + 机器人检测\n\n` +
      `🔷 <b>Premium HostPanel</b> — $${premium} · 30 天  ⭐ 最受欢迎\n   50 GB SSD · 最多 6 个域名 · + JS 挑战 & TLS 拦截\n\n` +
      `👑 <b>Golden HostPanel</b> — $${golden} · 30 天\n   100 GB SSD · 无限域名 · 完整 Anti-Red + 访客验证码 + 优先支持\n\n` +
      (trialOn ? `💡 <b>免费试用</b> — $0 · 12 小时 · 免费 .sbs 域名\n\n` : '') +
      `✅ 所有套餐：免费 SSL · HostPanel · Cloudflare DNS · 几分钟内上线\n👇 点击套餐查看详情并开始。`,
    chooseDomain: '👇 <b>选择连接域名的方式即可开始：</b>',
    chooseDomainOwned: '👇 <b>点击下方您的域名立即使用，或添加新域名：</b>',
    emailUse: email => `✅ 使用 ${email}`,
    walletCovers: (bal) => `👛 钱包：<b>$${money(bal)}</b> ✅ 足够支付本订单 — 点击下方 <b>支付</b> 完成。`,
    walletShort: (bal, short) => `👛 钱包：<b>$${money(bal)}</b> — 还差 <b>$${money(short)}</b>。点击 <b>💵 Deposit</b>，充值后将直接返回完成本订单。`,
    loyalty: (badge, tier, pct, amt) => `${badge} ${tier} 会员钱包支付立减 ${pct}% → <b>$${money(amt)}</b>`,
    payWallet: amt => `👛 用钱包支付 $${money(amt)}`,
    altsSearching: base => `🔍 正在搜索 <b>${base}</b> 的可用替代域名…`,
    altsIntro: '✅ <b>以下域名可立即注册</b> — 点击使用，或输入其他名称：',
    altsNone: base => `未找到 <b>${base}</b> 的替代域名。请输入其他名称：`,
  },
  hi: {
    menu: ({ weekly, premium, golden, trialOn }) =>
      `🛡️ <b>Anti-Red होस्टिंग — प्लान चुनें</b>\n\n` +
      `⚡ <b>Premium साप्ताहिक</b> — $${weekly} · 7 दिन\n   10 GB SSD · 2 डोमेन तक · IP क्लोकिंग + बॉट डिटेक्शन\n\n` +
      `🔷 <b>Premium HostPanel</b> — $${premium} · 30 दिन  ⭐ सबसे लोकप्रिय\n   50 GB SSD · 6 डोमेन तक · + JS चैलेंज और TLS ब्लॉकिंग\n\n` +
      `👑 <b>Golden HostPanel</b> — $${golden} · 30 दिन\n   100 GB SSD · असीमित डोमेन · पूर्ण Anti-Red + विज़िटर कैप्चा + प्राथमिकता सहायता\n\n` +
      (trialOn ? `💡 <b>फ्री ट्रायल</b> — $0 · 12 घंटे · मुफ्त .sbs डोमेन\n\n` : '') +
      `✅ सभी प्लान: फ्री SSL · HostPanel · Cloudflare DNS · मिनटों में लाइव\n👇 विवरण देखने और शुरू करने के लिए प्लान पर टैप करें।`,
    chooseDomain: '👇 <b>शुरू करने के लिए अपना डोमेन कनेक्ट करने का तरीका चुनें:</b>',
    chooseDomainOwned: '👇 <b>नीचे अपने किसी डोमेन पर टैप करें, या नया जोड़ें:</b>',
    emailUse: email => `✅ ${email} उपयोग करें`,
    walletCovers: (bal) => `👛 वॉलेट: <b>$${money(bal)}</b> ✅ इस ऑर्डर के लिए पर्याप्त — नीचे <b>भुगतान</b> टैप करें।`,
    walletShort: (bal, short) => `👛 वॉलेट: <b>$${money(bal)}</b> — <b>$${money(short)} कम</b>। <b>💵 Deposit</b> टैप करें, जमा के बाद आप सीधे इस ऑर्डर पर वापस आएंगे।`,
    loyalty: (badge, tier, pct, amt) => `${badge} ${tier} लॉयल्टी वॉलेट भुगतान पर −${pct}% → <b>$${money(amt)}</b>`,
    payWallet: amt => `👛 वॉलेट से $${money(amt)} भुगतान करें`,
    altsSearching: base => `🔍 <b>${base}</b> के विकल्प खोजे जा रहे हैं…`,
    altsIntro: '✅ <b>अभी उपलब्ध</b> — उपयोग के लिए टैप करें, या दूसरा नाम लिखें:',
    altsNone: base => `<b>${base}</b> के लिए कोई विकल्प नहीं मिला। दूसरा नाम लिखें:`,
  },
}
const strings = lang => L[lang] || L.en

// ── Plan identity ─────────────────────────────────────────────────────
function planKeyOfName(planName) {
  if (!planName || typeof planName !== 'string') return null
  const p = planName.toLowerCase()
  if (p.includes('golden')) return 'goldenCpanel'
  if (p.includes('week')) return 'premiumWeekly'
  if (p.includes('premium')) return 'premiumCpanel'
  return null
}

// ── Screen 1: plan menu comparison card ───────────────────────────────
function planMenuText(lang, prices) {
  return strings(lang).menu(prices)
}

// ── Screen 2: plan details + domain options (replaces the old Buy screen) ──
function chooseDomainLine(lang, ownedCount) {
  const s = strings(lang)
  return ownedCount > 0 ? s.chooseDomainOwned : s.chooseDomain
}

function planDetailRows({ user, planKey, ownedDomains = [] }) {
  const rows = [[user.registerANewDomain]]
  for (const d of ownedDomains.slice(0, MAX_INLINE_OWNED)) rows.push([`📂 ${d}`])
  if (ownedDomains.length > MAX_INLINE_OWNED) rows.push([user.useMyDomain])
  rows.push([user.connectExternalDomain])
  const others = {
    premiumWeekly: [user.viewPremiumCpanel, user.viewGoldenCpanel],
    premiumCpanel: [user.viewPremiumWeekly, user.viewGoldenCpanel],
    goldenCpanel: [user.viewPremiumWeekly, user.viewPremiumCpanel],
  }[planKey] || [user.viewPremiumCpanel, user.viewGoldenCpanel]
  rows.push(others)
  rows.push([user.backToHostingPlans])
  return rows
}

const DOMAIN_RE = /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/i
const isDomainLike = s => DOMAIN_RE.test(String(s || '').trim())
function parseOwnedDomainTap(message) {
  const m = /^📂 (\S+)$/.exec(String(message || '').trim())
  if (!m || !DOMAIN_RE.test(m[1])) return null
  return m[1].toLowerCase()
}

// ── Screen 3: email (no confirm screen; 1-tap reuse of last email) ────
function emailRows({ lang, skipLabel, lastEmail }) {
  const rows = []
  if (lastEmail) rows.push([strings(lang).emailUse(lastEmail)])
  rows.push([skipLabel])
  rows.push(['↩️ Back'])
  return rows
}

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/
function parseUseEmailTap(message) {
  const m = String(message || '').trim()
  if (!m.startsWith('✅ ')) return null
  const e = EMAIL_RE.exec(m)
  return e ? e[0] : null
}

// ── Screen 4: invoice with wallet balance + 1-tap pay / deposit ───────
function depositAmountFor(walletPrice, usdBal) {
  return Math.max(10, Math.ceil(Number(walletPrice) - Number(usdBal)))
}

function walletSummary({ lang, usdBal, walletPrice, loyaltyInfo = null }) {
  const s = strings(lang)
  const covers = Number(usdBal) + 1e-9 >= Number(walletPrice)
  let text = covers ? s.walletCovers(usdBal) : s.walletShort(usdBal, Number(walletPrice) - Number(usdBal))
  if (loyaltyInfo && loyaltyInfo.discount > 0) {
    const tier = loyaltyInfo.tier || {}
    text += '\n' + s.loyalty(tier.badge || '🏆', tier.name || '', Math.round((tier.discount || 0) * 100), walletPrice)
  }
  if (!covers) {
    const legend = {
      en: `\n\n<i>💵 Deposit tops up your wallet by the shortfall, then pays. ₿ Crypto pays the full amount directly.</i>`,
      fr: `\n\n<i>💵 Deposit recharge votre portefeuille du montant manquant, puis paie. ₿ Crypto paie le montant total directement.</i>`,
      zh: `\n\n<i>💵 Deposit 按差额充值钱包后再支付。₿ Crypto 直接支付全额。</i>`,
      hi: `\n\n<i>💵 Deposit वॉलेट में कमी जितनी राशि जोड़कर फिर भुगतान करता है। ₿ Crypto पूरी राशि सीधे भुगतान करता है।</i>`,
    }
    text += (legend[lang] || legend.en)
  }
  return text
}

function invoiceRows({ lang, payIn, applyCouponLabel, couponApplied, usdBal, walletPrice, extraRows = [], backLabel = '↩️ Back' }) {
  const rows = []
  const covers = Number(usdBal) + 1e-9 >= Number(walletPrice)
  rows.push([covers ? strings(lang).payWallet(walletPrice) : `💵 Deposit $${depositAmountFor(walletPrice, usdBal)}`])
  const others = [payIn.crypto, payIn.bank].filter(Boolean)
  if (others.length) rows.push(others)
  if (!couponApplied && applyCouponLabel) rows.push([applyCouponLabel])
  for (const r of extraRows) if (Array.isArray(r) && r.length) rows.push(r)
  rows.push([backLabel])
  return rows
}

function parseWalletPayTap(message) {
  const m = String(message || '').trim()
  if (!m.startsWith('👛 ')) return null
  const amt = /\$(\d+(?:\.\d+)?)/.exec(m)
  return amt ? Number(amt[1]) : null
}

function parseDepositTap(message) {
  const m = /^💵 Deposit \$(\d+(?:\.\d+)?)$/.exec(String(message || '').trim())
  return m ? Math.max(10, Math.ceil(Number(m[1]))) : null
}

// One parser for both 1-tap invoice buttons → { type: 'wallet'|'deposit', amount } | null
function parseCheckoutTap(message) {
  const w = parseWalletPayTap(message)
  if (w !== null) return { type: 'wallet', amount: w }
  const d = parseDepositTap(message)
  if (d !== null) return { type: 'deposit', amount: d }
  return null
}

// ── Domain-not-available alternatives ─────────────────────────────────
function baseNameOf(query) {
  const clean = String(query || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '')
  const base = clean.split('.')[0]
  return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(base) && base.length >= 2 ? base : null
}

// Hosting-friendly TLDs first; ccTLDs (de/fr/it) last. Stable within equal rank (keeps price order).
const TLD_RANK = ['com', 'net', 'org', 'xyz', 'sbs', 'co', 'io', 'app', 'dev']
function sortAlts(alts) {
  const rank = d => { const i = TLD_RANK.indexOf(String(d.domain || '').split('.').pop()); return i === -1 ? TLD_RANK.length : i }
  return [...(alts || [])].sort((a, b) => rank(a) - rank(b))
}

function altRows(alts) {
  return sortAlts(alts).slice(0, MAX_ALTS).map(a => [`🌐 ${a.domain} — $${a.price}`])
}

function parseAltDomainTap(message) {
  const m = /^🌐 (\S+) — \$/.exec(String(message || '').trim())
  if (!m || !DOMAIN_RE.test(m[1])) return null
  return m[1].toLowerCase()
}

module.exports = {
  PLAN_KEYS,
  MAX_INLINE_OWNED,
  ALT_TIMEOUT_MS,
  MAX_ALTS,
  strings,
  planKeyOfName,
  planMenuText,
  chooseDomainLine,
  planDetailRows,
  isDomainLike,
  parseOwnedDomainTap,
  emailRows,
  parseUseEmailTap,
  depositAmountFor,
  walletSummary,
  invoiceRows,
  parseWalletPayTap,
  parseDepositTap,
  parseCheckoutTap,
  baseNameOf,
  sortAlts,
  altRows,
  parseAltDomainTap,
}
