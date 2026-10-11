/**
 * Single source of truth for the "Choose Your Plan" bot copy.
 *
 * Previously this template was duplicated across:
 *   - js/lang/en.js, js/lang/fr.js, js/lang/hi.js, js/lang/zh.js
 *   - js/config.js (fallback)
 *
 * Keeping five copies in sync on every wording/pricing tweak was error-prone.
 * Edit the template or labels here once and every locale picks it up.
 */

/* global process */
require('dotenv').config()

// Per-language labels. Plan names, perks and units vary; the structural
// template (title → perks line → 3 plan rows) is shared.
const LABELS = {
  en: {
    title: 'Choose Your Plan',
    perksIntro: 'All plans: ',
    perkLinks: '🔗 Unlimited links',
    perkValidations: '📱 Validations w/ owner names',
    perkBulkSms: '📱 BulkSMS',
    daily: 'Daily',
    weekly: 'Weekly',
    monthly: 'Monthly',
    bestValue: 'best value',
    // isPlural: false for Daily slot, true for Weekly/Monthly — matches historical copy
    domain: (n, isPlural) => `${n} domain${isPlural ? 's' : ''}`,
    validations: n => `${n.toLocaleString()} validations`,
    smsDevices: n => (n === Infinity ? 'unlimited SMS devices' : `${n} SMS devices`),
  },
  fr: {
    title: 'Choisissez votre plan',
    perksIntro: 'Tous les plans : ',
    perkLinks: '🔗 Liens illimités',
    perkValidations: '📱 Validations avec noms',
    perkBulkSms: '📱 BulkSMS',
    daily: 'Quotidien',
    weekly: 'Hebdomadaire',
    monthly: 'Mensuel',
    bestValue: 'meilleure offre',
    domain: (n, isPlural) => `${n} domaine${isPlural ? 's' : ''}`,
    validations: n => `${n.toLocaleString()} validations`,
    smsDevices: n => (n === Infinity ? 'appareils SMS illimités' : `${n} appareils SMS`),
  },
  hi: {
    title: 'अपना प्लान चुनें',
    perksIntro: 'सभी प्लान में: ',
    perkLinks: '🔗 असीमित लिंक',
    perkValidations: '📱 मालिक के नाम सहित वैलिडेशन',
    perkBulkSms: '📱 BulkSMS',
    daily: 'दैनिक',
    weekly: 'साप्ताहिक',
    monthly: 'मासिक',
    bestValue: 'सर्वोत्तम मूल्य',
    domain: n => `${n} डोमेन`,
    validations: n => `${n.toLocaleString()} वैलिडेशन`,
    smsDevices: n => (n === Infinity ? 'असीमित SMS डिवाइस' : `${n} SMS डिवाइस`),
  },
  zh: {
    title: '选择您的计划',
    perksIntro: '所有计划包含：',
    perkLinks: '🔗 无限链接',
    perkValidations: '📱 含机主姓名验证',
    perkBulkSms: '📱 BulkSMS',
    daily: '每日',
    weekly: '每周',
    monthly: '每月',
    bestValue: '最超值',
    domain: n => `${n} 个域名`,
    validations: n => `${n.toLocaleString()} 次验证`,
    smsDevices: n => (n === Infinity ? '无限 SMS 设备' : `${n} 台 SMS 设备`),
  },
}

// Build the "Choose Your Plan" message for a given language.
// Pricing + free-quota values come from process.env (same source all lang files
// previously read individually). Env vars are read at call time so any restart
// picks up updates.
function buildChooseSubscription(lang = 'en') {
  const L = LABELS[lang] || LABELS.en
  const hideSms = process.env.HIDE_SMS_APP === 'true'

  const PRICE_DAILY = Number(process.env.PRICE_DAILY_SUBSCRIPTION)
  const PRICE_WEEKLY = Number(process.env.PRICE_WEEKLY_SUBSCRIPTION)
  const PRICE_MONTHLY = Number(process.env.PRICE_MONTHLY_SUBSCRIPTION)

  const DAILY_DOMAINS = Number(process.env.DAILY_PLAN_FREE_DOMAINS)
  const WEEKLY_DOMAINS = Number(process.env.WEEKLY_PLAN_FREE_DOMAINS)
  const MONTHLY_DOMAINS = Number(process.env.MONTHLY_PLAN_FREE_DOMAINS)

  const DAILY_VALS = Number(process.env.DAILY_PLAN_FREE_VALIDATIONS)
  const WEEKLY_VALS = Number(process.env.WEEKLY_PLAN_FREE_VALIDATIONS)
  const MONTHLY_VALS = Number(process.env.MONTHLY_PLAN_FREE_VALIDATIONS)

  const perks = [L.perkLinks, L.perkValidations]
  if (!hideSms) perks.push(L.perkBulkSms)

  const deviceSuffix = count => (hideSms ? '' : ` · ${L.smsDevices(count)}`)

  return `<b>${L.title}</b>

${L.perksIntro}${perks.join(' · ')}

🟢 <b>${L.daily} — $${PRICE_DAILY}</b>
  ${L.domain(DAILY_DOMAINS, false)} · ${L.validations(DAILY_VALS)}${deviceSuffix(3)}

🔵 <b>${L.weekly} — $${PRICE_WEEKLY}</b>
  ${L.domain(WEEKLY_DOMAINS, true)} · ${L.validations(WEEKLY_VALS)}${deviceSuffix(10)}

⭐ <b>${L.monthly} — $${PRICE_MONTHLY}</b> · ${L.bestValue}
  ${L.domain(MONTHLY_DOMAINS, true)} · ${L.validations(MONTHLY_VALS)}${deviceSuffix(Infinity)}`
}

module.exports = { buildChooseSubscription }
