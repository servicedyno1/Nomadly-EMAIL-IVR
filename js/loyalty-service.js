// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Loyalty Tier System
// Tracks total spend, assigns tier, applies discounts
// Tiers: Bronze → Silver → Gold → Platinum
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const { get, set } = require('./db.js')

const TIERS = {
  bronze:   { name: 'Bronze',   badge: '🥉', minSpend: 0,    discount: 0,    next: 'silver' },
  silver:   { name: 'Silver',   badge: '🥈', minSpend: 100,  discount: 0.05, next: 'gold' },
  gold:     { name: 'Gold',     badge: '🥇', minSpend: 500,  discount: 0.10, next: 'platinum' },
  platinum: { name: 'Platinum', badge: '💎', minSpend: 1000, discount: 0.15, next: null },
}

const TIER_ORDER = ['bronze', 'silver', 'gold', 'platinum']

// ━━━ Translations ━━━
const i18n = {
  en: {
    tierNames: { bronze: 'Bronze', silver: 'Silver', gold: 'Gold', platinum: 'Platinum' },
    tier: 'Tier',
    totalSpent: 'Total Spent',
    yourDiscount: 'Your Discount',
    off: 'off',
    allPurchases: 'all purchases',
    next: 'Next',
    moreToGo: 'more to go',
    highestTier: "You've reached the highest tier! Maximum savings on every purchase.",
    tierLevels: 'Tier Levels',
    tierUpgrade: 'Tier Upgrade!',
    youNowGet: 'You now get',
    autoApply: 'This discount applies automatically at checkout.',
    discount: 'Discount',
    finalPrice: 'Final price',
    spend: 'Spend',
    moreToUnlock: 'more to unlock',
  },
  fr: {
    tierNames: { bronze: 'Bronze', silver: 'Argent', gold: 'Or', platinum: 'Platine' },
    tier: 'Niveau',
    totalSpent: 'Total dépensé',
    yourDiscount: 'Votre réduction',
    off: 'de réduction',
    allPurchases: 'tous les achats',
    next: 'Suivant',
    moreToGo: 'restant',
    highestTier: 'Vous avez atteint le niveau le plus élevé ! Économies maximales sur chaque achat.',
    tierLevels: 'Niveaux de fidélité',
    tierUpgrade: 'Niveau supérieur !',
    youNowGet: 'Vous bénéficiez maintenant de',
    autoApply: 'Cette réduction s\'applique automatiquement au paiement.',
    discount: 'Réduction',
    finalPrice: 'Prix final',
    spend: 'Dépensez',
    moreToUnlock: 'de plus pour débloquer',
  },
  hi: {
    tierNames: { bronze: 'कांस्य', silver: 'रजत', gold: 'स्वर्ण', platinum: 'प्लैटिनम' },
    tier: 'स्तर',
    totalSpent: 'कुल खर्च',
    yourDiscount: 'आपकी छूट',
    off: 'की छूट',
    allPurchases: 'सभी खरीदारी पर',
    next: 'अगला',
    moreToGo: 'और खर्च करना बाकी',
    highestTier: 'आप सबसे ऊंचे स्तर पर पहुंच गए हैं! हर खरीदारी पर अधिकतम बचत।',
    tierLevels: 'स्तर सूची',
    tierUpgrade: 'स्तर उन्नयन!',
    youNowGet: 'अब आपको मिलेगा',
    autoApply: 'यह छूट चेकआउट पर स्वचालित रूप से लागू होती है।',
    discount: 'छूट',
    finalPrice: 'अंतिम मूल्य',
    spend: '',
    moreToUnlock: 'और खर्च करके पाएं',
  },
  zh: {
    tierNames: { bronze: '青铜', silver: '白银', gold: '黄金', platinum: '铂金' },
    tier: '等级',
    totalSpent: '总消费',
    yourDiscount: '您的折扣',
    off: '折扣',
    allPurchases: '所有购买',
    next: '下一级',
    moreToGo: '即可升级',
    highestTier: '您已达到最高等级！每次购买均享最大优惠。',
    tierLevels: '等级列表',
    tierUpgrade: '等级提升！',
    youNowGet: '您现在享有',
    autoApply: '此折扣在结账时自动应用。',
    discount: '折扣',
    finalPrice: '最终价格',
    spend: '再消费',
    moreToUnlock: '即可解锁',
  },
}

function getStrings(lang) {
  return i18n[lang] || i18n.en
}

/**
 * Get user's total USD spend from wallet
 */
async function getTotalSpend(walletOf, chatId) {
  const wallet = await get(walletOf, chatId)
  const usdOut = (wallet?.usdOut || 0) - (wallet?.usdHeld || 0)
  // Convert NGN to USD (rough rate, used only for tier calculation)
  const ngnOut = wallet?.ngnOut || 0
  const ngnToUsd = ngnOut / 1500 // approximate rate
  return usdOut + ngnToUsd
}

/**
 * Calculate tier from total spend
 */
function getTierFromSpend(totalSpend) {
  if (totalSpend >= TIERS.platinum.minSpend) return 'platinum'
  if (totalSpend >= TIERS.gold.minSpend) return 'gold'
  if (totalSpend >= TIERS.silver.minSpend) return 'silver'
  return 'bronze'
}

/**
 * Get user's current loyalty tier info
 */
async function getUserTier(walletOf, chatId) {
  const totalSpend = await getTotalSpend(walletOf, chatId)
  const tierKey = getTierFromSpend(totalSpend)
  const tier = TIERS[tierKey]
  const nextTier = tier.next ? TIERS[tier.next] : null
  const spendToNext = nextTier ? Math.max(0, nextTier.minSpend - totalSpend) : 0

  return {
    key: tierKey,
    ...tier,
    totalSpend,
    spendToNext,
    nextTier: nextTier ? { key: tier.next, ...nextTier } : null,
    discountPercent: Math.round(tier.discount * 100),
  }
}

/**
 * Apply loyalty discount to a price
 * Returns { originalPrice, discount, finalPrice, tier }
 */
async function applyDiscount(walletOf, chatId, price) {
  const tier = await getUserTier(walletOf, chatId)
  if (tier.discount <= 0) return { originalPrice: price, discount: 0, finalPrice: price, tier }

  const discount = Math.round(price * tier.discount * 100) / 100
  const finalPrice = Math.round((price - discount) * 100) / 100

  return { originalPrice: price, discount, finalPrice, tier }
}

/**
 * Check if a purchase caused a tier upgrade and return upgrade info
 */
async function checkTierUpgrade(walletOf, chatId, previousTotalSpend) {
  const newTotalSpend = await getTotalSpend(walletOf, chatId)
  const oldTier = getTierFromSpend(previousTotalSpend)
  const newTier = getTierFromSpend(newTotalSpend)

  if (TIER_ORDER.indexOf(newTier) > TIER_ORDER.indexOf(oldTier)) {
    return {
      upgraded: true,
      oldTier: TIERS[oldTier],
      oldTierKey: oldTier,
      newTier: TIERS[newTier],
      newTierKey: newTier,
    }
  }
  return { upgraded: false }
}

/**
 * Format tier status message for display (translated)
 */
function formatTierStatus(tierInfo, lang) {
  const s = getStrings(lang)
  const tierName = s.tierNames[tierInfo.key] || tierInfo.name

  let msg = `${tierInfo.badge} <b>${tierName} ${s.tier}</b>\n\n`
  msg += `${s.totalSpent}: <b>$${tierInfo.totalSpend.toFixed(2)}</b>\n`
  msg += `${s.yourDiscount}: <b>${tierInfo.discountPercent}% ${s.off}</b> ${s.allPurchases}\n\n`

  if (tierInfo.nextTier) {
    const nextName = s.tierNames[tierInfo.nextTier.key] || tierInfo.nextTier.name
    const nextDiscountPercent = Math.round(tierInfo.nextTier.discount * 100)
    const progress = tierInfo.totalSpend / tierInfo.nextTier.minSpend
    const barLength = 10
    const filled = Math.min(barLength, Math.round(progress * barLength))
    const bar = '\u25CF'.repeat(filled) + '\u25CB'.repeat(barLength - filled)
    msg += `${s.next}: ${tierInfo.nextTier.badge} <b>${nextName}</b> (${nextDiscountPercent}% ${s.off})\n`
    msg += `[${bar}] $${tierInfo.spendToNext.toFixed(2)} ${s.moreToGo}\n\n`
  } else {
    msg += `${s.highestTier}\n\n`
  }

  const bn = s.tierNames.bronze
  const sn = s.tierNames.silver
  const gn = s.tierNames.gold
  const pn = s.tierNames.platinum
  msg += `<b>${s.tierLevels}:</b>\n`
  msg += `🥉 ${bn}: $0+ (0% ${s.off})\n`
  msg += `🥈 ${sn}: $100+ (5% ${s.off})\n`
  msg += `🥇 ${gn}: $500+ (10% ${s.off})\n`
  msg += `💎 ${pn}: $1,000+ (15% ${s.off})`

  return msg
}

/**
 * Format tier upgrade notification (translated)
 */
function formatUpgradeMessage(upgrade, lang) {
  const s = getStrings(lang)
  const oldName = s.tierNames[upgrade.oldTierKey] || upgrade.oldTier.name
  const newName = s.tierNames[upgrade.newTierKey] || upgrade.newTier.name
  const pct = Math.round(upgrade.newTier.discount * 100)

  return `🎉 <b>${s.tierUpgrade}</b>\n\n` +
    `${upgrade.oldTier.badge} ${oldName} → ${upgrade.newTier.badge} <b>${newName}</b>\n\n` +
    `${s.youNowGet} <b>${pct}% ${s.off}</b> ${s.allPurchases}!\n` +
    `${s.autoApply}`
}

/**
 * Format discount applied line for checkout (translated)
 */

/**
 * Get translated tier line for wallet display
 */
function formatWalletTierLine(tierInfo, lang) {
  const s = getStrings(lang)
  const tierName = s.tierNames[tierInfo.key] || tierInfo.name
  if (tierInfo.discountPercent > 0) {
    return `\n${tierInfo.badge} ${tierName} — <b>${tierInfo.discountPercent}% ${s.off}</b> ${s.allPurchases}`
  }
  const nextPct = tierInfo.nextTier ? Math.round(tierInfo.nextTier.discount * 100) : 5
  return `\n${tierInfo.badge} ${tierName} — ${s.spend} $${tierInfo.spendToNext.toFixed(0)} ${s.moreToUnlock} <b>${nextPct}% ${s.off}</b>`
}

/**
 * Get translated discount checkout message
 */
function formatCheckoutDiscount(discountInfo, discountedPrice, lang) {
  const s = getStrings(lang)
  const tierName = s.tierNames[discountInfo.tier.key] || discountInfo.tier.name
  return `${discountInfo.tier.badge} <b>${tierName} ${s.discount} (${discountInfo.tier.discountPercent}%)</b>: -$${discountInfo.discount.toFixed(2)}\n${s.finalPrice}: <b>$${discountedPrice.toFixed(2)}</b>`
}

module.exports = {
  TIERS,
  TIER_ORDER,
  getUserTier,
  applyDiscount,
  checkTierUpgrade,
  getTotalSpend,
  formatTierStatus,
  formatUpgradeMessage,
  
  formatWalletTierLine,
  formatCheckoutDiscount,
}
