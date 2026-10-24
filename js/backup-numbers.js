'use strict'
// Backup numbers for the Telegram bot — same rules as the CloudIVR web app (js/cloudivr-web/numbers.js
// parseBackups): up to 4 numbers, rung in order when the main forward / transfer number is busy or doesn't
// answer. Used by Call Forwarding, Quick IVR transfer and Bulk IVR transfer. The call engine (voice-service)
// already dials them: features.callForwarding.backups and the transferBackups call/campaign param.
const phoneConfig = require('./phone-config')
const dialGuard = require('./dial-rate-guard')

const MAX = 4
const E164 = /^\+[1-9]\d{7,14}$/
const L = (lang, m) => m[lang] || m.en

const BTN = {
  manage: { en: '🔁 Backup Numbers', fr: '🔁 Numéros de secours', zh: '🔁 备用号码', hi: '🔁 बैकअप नंबर' },
  clear: { en: '🗑 Remove Backups', fr: '🗑 Retirer les secours', zh: '🗑 删除备用号码', hi: '🗑 बैकअप हटाएँ' },
  skip: { en: '⏭ Skip', fr: '⏭ Passer', zh: '⏭ 跳过', hi: '⏭ छोड़ें' },
}
const btn = (key, lang) => L(lang, BTN[key])
const isBtn = (key, message) => Object.values(BTN[key]).includes(String(message || '').trim())

// Same auto-correct the bot uses for forward numbers: 10-digit US → +1, bare 11–15 digits → +.
function norm(raw) {
  let n = String(raw || '').replace(/[^+\d]/g, '')
  if (/^\d{10}$/.test(n)) n = '+1' + n
  else if (/^1\d{10}$/.test(n)) n = '+' + n
  else if (/^\d{11,15}$/.test(n)) n = '+' + n
  return n
}

// raw text (comma / space / newline separated) → { list } | { error } (localized). `exclude` = main number(s).
function parse(raw, exclude = [], lang = 'en') {
  const tokens = String(raw || '').split(/[,;\n]+|\s+(?=\+)/).map(t => t.trim()).filter(Boolean)
  const junk = tokens.find(t => !/^\+?[\d\s().-]+$/.test(t))
  if (junk) return { error: L(lang, {
    en: `❌ "${junk.slice(0, 20)}" is not a phone number. Use the country code, e.g. +14155550100.`,
    fr: `❌ « ${junk.slice(0, 20)} » n'est pas un numéro. Utilisez l'indicatif pays, ex. +14155550100.`,
    zh: `❌ "${junk.slice(0, 20)}" 不是电话号码。请带国家代码，例如 +14155550100。`,
    hi: `❌ "${junk.slice(0, 20)}" फ़ोन नंबर नहीं है। देश कोड के साथ लिखें, जैसे +14155550100।`,
  }) }
  const ex = exclude.map(norm).filter(Boolean)
  const list = [...new Set(tokens.map(norm).filter(Boolean))].filter(n => !ex.includes(n))
  if (!list.length) return { error: L(lang, {
    en: '❌ Send at least one backup number that is different from the main number.',
    fr: '❌ Envoyez au moins un numéro de secours différent du numéro principal.',
    zh: '❌ 请至少发送一个与主号码不同的备用号码。',
    hi: '❌ मुख्य नंबर से अलग कम से कम एक बैकअप नंबर भेजें।',
  }) }
  if (list.length > MAX) return { error: L(lang, {
    en: `❌ Add up to ${MAX} backup numbers.`, fr: `❌ ${MAX} numéros de secours maximum.`, zh: `❌ 最多添加 ${MAX} 个备用号码。`, hi: `❌ अधिकतम ${MAX} बैकअप नंबर जोड़ें।`,
  }) }
  for (const n of list) {
    if (!E164.test(n)) return { error: L(lang, {
      en: `❌ Backup ${n}: use the country code, e.g. +14155550100.`, fr: `❌ Secours ${n} : utilisez l'indicatif pays, ex. +14155550100.`,
      zh: `❌ 备用号码 ${n}：请带国家代码，例如 +14155550100。`, hi: `❌ बैकअप ${n}: देश कोड के साथ लिखें, जैसे +14155550100।`,
    }) }
    if (phoneConfig.isBlockedPrefix(n) || dialGuard.classifyDial(n).blocked) return { error: L(lang, {
      en: `🚫 Backup ${n} is a blocked premium/satellite destination.`, fr: `🚫 Le secours ${n} est une destination premium/satellite bloquée.`,
      zh: `🚫 备用号码 ${n} 是被屏蔽的高价/卫星号码。`, hi: `🚫 बैकअप ${n} एक ब्लॉक किया गया प्रीमियम/सैटेलाइट नंबर है।`,
    }) }
  }
  return { list }
}

const fmtList = (list) => (list || []).map(n => `<b>${phoneConfig.formatPhone(n)}</b>`).join(', ')

// Call Forwarding → "🔁 Backup Numbers" screen.
const forwardingPrompt = (lang, forwardTo, current = []) => L(lang, {
  en: `🔁 <b>Backup numbers</b>\n\nIf ${phoneConfig.formatPhone(forwardTo)} is busy or doesn't answer, these ring next, one after another.\n\nSend up to ${MAX} numbers with the country code, separated by commas:\n<i>+14155550100, +447700900123</i>\n\nNow: ${current.length ? fmtList(current) : 'none'}`,
  fr: `🔁 <b>Numéros de secours</b>\n\nSi ${phoneConfig.formatPhone(forwardTo)} est occupé ou ne répond pas, ces numéros sonnent ensuite, l'un après l'autre.\n\nEnvoyez jusqu'à ${MAX} numéros avec l'indicatif pays, séparés par des virgules :\n<i>+14155550100, +447700900123</i>\n\nActuellement : ${current.length ? fmtList(current) : 'aucun'}`,
  zh: `🔁 <b>备用号码</b>\n\n如果 ${phoneConfig.formatPhone(forwardTo)} 占线或无人接听，将依次拨打这些号码。\n\n发送最多 ${MAX} 个带国家代码的号码，用逗号分隔：\n<i>+14155550100, +447700900123</i>\n\n当前：${current.length ? fmtList(current) : '无'}`,
  hi: `🔁 <b>बैकअप नंबर</b>\n\nअगर ${phoneConfig.formatPhone(forwardTo)} व्यस्त है या जवाब नहीं देता, तो ये नंबर एक-एक करके बजेंगे।\n\nदेश कोड के साथ अधिकतम ${MAX} नंबर भेजें, कॉमा से अलग करें:\n<i>+14155550100, +447700900123</i>\n\nअभी: ${current.length ? fmtList(current) : 'कोई नहीं'}`,
})

// Quick IVR / Bulk IVR transfer → optional step right after the transfer number.
const transferPrompt = (lang, transferTo) => L(lang, {
  en: `🔁 <b>Backup numbers (optional)</b>\n\nIf ${phoneConfig.formatPhone(transferTo)} is busy or doesn't answer when someone presses the key, these ring next, one after another.\n\nSend up to ${MAX} numbers with the country code, separated by commas — or tap ${BTN.skip.en}.`,
  fr: `🔁 <b>Numéros de secours (facultatif)</b>\n\nSi ${phoneConfig.formatPhone(transferTo)} est occupé ou ne répond pas lors du transfert, ces numéros sonnent ensuite, l'un après l'autre.\n\nEnvoyez jusqu'à ${MAX} numéros avec l'indicatif pays, séparés par des virgules — ou touchez ${BTN.skip.fr}.`,
  zh: `🔁 <b>备用号码（可选）</b>\n\n转接时如果 ${phoneConfig.formatPhone(transferTo)} 占线或无人接听，将依次拨打这些号码。\n\n发送最多 ${MAX} 个带国家代码的号码，用逗号分隔 — 或点击 ${BTN.skip.zh}。`,
  hi: `🔁 <b>बैकअप नंबर (वैकल्पिक)</b>\n\nट्रांसफर के समय अगर ${phoneConfig.formatPhone(transferTo)} व्यस्त है या जवाब नहीं देता, तो ये नंबर एक-एक करके बजेंगे।\n\nदेश कोड के साथ अधिकतम ${MAX} नंबर भेजें, कॉमा से अलग करें — या ${BTN.skip.hi} टैप करें।`,
})

const saved = (lang, list) => list.length ? L(lang, {
  en: `✅ Backup numbers saved: ${fmtList(list)}`, fr: `✅ Numéros de secours enregistrés : ${fmtList(list)}`,
  zh: `✅ 备用号码已保存：${fmtList(list)}`, hi: `✅ बैकअप नंबर सेव हुए: ${fmtList(list)}`,
}) : L(lang, { en: '✅ Backup numbers removed.', fr: '✅ Numéros de secours retirés.', zh: '✅ 备用号码已删除。', hi: '✅ बैकअप नंबर हटा दिए गए।' })

const needsForwarding = (lang) => L(lang, {
  en: '⚠️ Turn on call forwarding first (pick a mode and a forward-to number), then add backup numbers.',
  fr: '⚠️ Activez d\'abord le transfert d\'appels (mode + numéro), puis ajoutez des numéros de secours.',
  zh: '⚠️ 请先开启呼叫转移（选择模式和转接号码），再添加备用号码。',
  hi: '⚠️ पहले कॉल फ़ॉरवर्डिंग चालू करें (मोड और नंबर चुनें), फिर बैकअप नंबर जोड़ें।',
})

// One summary line for previews ("🔁 Backups: …"), or null when there are none.
const summaryLine = (lang, list) => (list && list.length) ? `${L(lang, { en: '🔁 Backups', fr: '🔁 Secours', zh: '🔁 备用号码', hi: '🔁 बैकअप' })}: ${fmtList(list)}` : null

module.exports = { MAX, BTN, btn, isBtn, norm, parse, forwardingPrompt, transferPrompt, saved, needsForwarding, summaryLine }
