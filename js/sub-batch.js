'use strict'
// Bot: tick several extra numbers for one plan, then pay for all of them in one go.
const fmt = (n) => `$${Number(n || 0).toFixed(2)}`
const room = (left) => (Number.isFinite(left) ? left : '∞')

const S = {
  en: {
    continueBtn: (n) => `➡️ Continue with ${n} number${n === 1 ? '' : 's'}`,
    picked: (n, left) => `✅ ${n} selected · room for ${room(left)} on this plan.\nTap more numbers to add them, tap a ✅ number to remove it, or tap <b>Continue</b>.`,
    full: (left) => `⚠️ This plan has room for ${room(left)} more extra number${left === 1 ? '' : 's'}. Remove one first, or upgrade the plan.`,
    none: 'Tap at least one number first.',
    summary: (parent, picks, total, plan) => `🧾 <b>Add ${picks.length} extra numbers to ${parent}</b> (${plan} plan)\n\n${picks.map(p => `📞 ${p.phone_number} — ${fmt(p.price)}${p.monthly > p.price ? ` → ${fmt(p.monthly)}/mo` : `/mo`}`).join('\n')}\n\n<b>Total: ${fmt(total)}</b> · one payment. Each number renews monthly with your plan.`,
    done: (parent, added, failed) => [
      added.length ? `🎉 <b>${added.length} extra number${added.length === 1 ? '' : 's'} added to ${parent}</b>\n${added.map(x => `✅ ${x}`).join('\n')}` : `⚠️ None of the extra numbers could be added to ${parent}.`,
      failed.length ? `\n<b>Not added — nothing charged for ${failed.length === 1 ? 'it' : 'these'}, the money stays in your wallet:</b>\n${failed.map(f => `❌ ${f.phone} — ${f.why}`).join('\n')}` : '',
    ].filter(Boolean).join('\n'),
    whyFull: 'the plan has no free slot left',
    whySeparate: 'needs an address — add it on its own',
    whyFailed: 'could not be activated',
  },
  fr: {
    continueBtn: (n) => `➡️ Continuer avec ${n} numéro${n === 1 ? '' : 's'}`,
    picked: (n, left) => `✅ ${n} sélectionné(s) · place pour ${room(left)} sur ce forfait.\nTouchez d'autres numéros pour les ajouter, un numéro ✅ pour le retirer, ou <b>Continuer</b>.`,
    full: (left) => `⚠️ Ce forfait a de la place pour ${room(left)} numéro(s) supplémentaire(s). Retirez-en un, ou passez à un forfait supérieur.`,
    none: "Touchez d'abord au moins un numéro.",
    summary: (parent, picks, total, plan) => `🧾 <b>Ajouter ${picks.length} numéros à ${parent}</b> (forfait ${plan})\n\n${picks.map(p => `📞 ${p.phone_number} — ${fmt(p.price)}${p.monthly > p.price ? ` → ${fmt(p.monthly)}/mois` : `/mois`}`).join('\n')}\n\n<b>Total : ${fmt(total)}</b> · un seul paiement. Chaque numéro se renouvelle avec votre forfait.`,
    done: (parent, added, failed) => [
      added.length ? `🎉 <b>${added.length} numéro(s) ajouté(s) à ${parent}</b>\n${added.map(x => `✅ ${x}`).join('\n')}` : `⚠️ Aucun numéro n'a pu être ajouté à ${parent}.`,
      failed.length ? `\n<b>Non ajoutés — rien n'a été débité, l'argent reste dans votre portefeuille :</b>\n${failed.map(f => `❌ ${f.phone} — ${f.why}`).join('\n')}` : '',
    ].filter(Boolean).join('\n'),
    whyFull: "plus de place sur le forfait",
    whySeparate: 'adresse requise — ajoutez-le seul',
    whyFailed: "n'a pas pu être activé",
  },
  zh: {
    continueBtn: (n) => `➡️ 继续（${n} 个号码）`,
    picked: (n, left) => `✅ 已选 ${n} 个 · 此套餐还可添加 ${room(left)} 个。\n点击更多号码添加，点击 ✅ 号码移除，或点击<b>继续</b>。`,
    full: (left) => `⚠️ 此套餐只能再添加 ${room(left)} 个号码。请先移除一个，或升级套餐。`,
    none: '请先点击至少一个号码。',
    summary: (parent, picks, total, plan) => `🧾 <b>为 ${parent} 添加 ${picks.length} 个号码</b>（${plan} 套餐）\n\n${picks.map(p => `📞 ${p.phone_number} — ${fmt(p.price)}${p.monthly > p.price ? ` → ${fmt(p.monthly)}/月` : `/月`}`).join('\n')}\n\n<b>合计：${fmt(total)}</b> · 一次付款。每个号码随套餐按月续费。`,
    done: (parent, added, failed) => [
      added.length ? `🎉 <b>已为 ${parent} 添加 ${added.length} 个号码</b>\n${added.map(x => `✅ ${x}`).join('\n')}` : `⚠️ 没有号码能添加到 ${parent}。`,
      failed.length ? `\n<b>未添加 — 未扣费，款项留在钱包中：</b>\n${failed.map(f => `❌ ${f.phone} — ${f.why}`).join('\n')}` : '',
    ].filter(Boolean).join('\n'),
    whyFull: '套餐已无空位',
    whySeparate: '需要地址 — 请单独添加',
    whyFailed: '无法激活',
  },
  hi: {
    continueBtn: (n) => `➡️ ${n} नंबर के साथ आगे बढ़ें`,
    picked: (n, left) => `✅ ${n} चुने गए · इस प्लान पर ${room(left)} की जगह।\nऔर नंबर जोड़ने के लिए टैप करें, हटाने के लिए ✅ नंबर टैप करें, या <b>आगे बढ़ें</b>।`,
    full: (left) => `⚠️ इस प्लान पर केवल ${room(left)} और अतिरिक्त नंबर की जगह है। पहले एक हटाएँ, या प्लान अपग्रेड करें।`,
    none: 'पहले कम से कम एक नंबर टैप करें।',
    summary: (parent, picks, total, plan) => `🧾 <b>${parent} में ${picks.length} अतिरिक्त नंबर जोड़ें</b> (${plan} प्लान)\n\n${picks.map(p => `📞 ${p.phone_number} — ${fmt(p.price)}${p.monthly > p.price ? ` → ${fmt(p.monthly)}/माह` : `/माह`}`).join('\n')}\n\n<b>कुल: ${fmt(total)}</b> · एक ही भुगतान। हर नंबर प्लान के साथ मासिक रिन्यू होगा।`,
    done: (parent, added, failed) => [
      added.length ? `🎉 <b>${parent} में ${added.length} अतिरिक्त नंबर जोड़े गए</b>\n${added.map(x => `✅ ${x}`).join('\n')}` : `⚠️ ${parent} में कोई नंबर नहीं जुड़ सका।`,
      failed.length ? `\n<b>नहीं जुड़े — इनका कोई शुल्क नहीं लगा, पैसा वॉलेट में है:</b>\n${failed.map(f => `❌ ${f.phone} — ${f.why}`).join('\n')}` : '',
    ].filter(Boolean).join('\n'),
    whyFull: 'प्लान में जगह नहीं बची',
    whySeparate: 'पता चाहिए — इसे अलग से जोड़ें',
    whyFailed: 'सक्रिय नहीं हो सका',
  },
  fa: {
    continueBtn: (n) => `➡️ ادامه با ${n} شماره`,
    picked: (n, left) => `✅ ${n} انتخاب شد · جا برای ${room(left)} در این طرح.\nبرای افزودن شماره‌های بیشتر بزنید، برای حذف روی شماره ✅ بزنید، یا <b>ادامه</b> را بزنید.`,
    full: (left) => `⚠️ این طرح فقط برای ${room(left)} شماره اضافه دیگر جا دارد. ابتدا یکی را حذف کنید یا طرح را ارتقا دهید.`,
    none: 'ابتدا حداقل یک شماره را بزنید.',
    summary: (parent, picks, total, plan) => `🧾 <b>افزودن ${picks.length} شماره به ${parent}</b> (طرح ${plan})\n\n${picks.map(p => `📞 ${p.phone_number} — ${fmt(p.price)}${p.monthly > p.price ? ` → ${fmt(p.monthly)}/ماه` : `/ماه`}`).join('\n')}\n\n<b>جمع: ${fmt(total)}</b> · یک پرداخت. هر شماره همراه طرح ماهانه تمدید می‌شود.`,
    done: (parent, added, failed) => [
      added.length ? `🎉 <b>${added.length} شماره به ${parent} اضافه شد</b>\n${added.map(x => `✅ ${x}`).join('\n')}` : `⚠️ هیچ شماره‌ای به ${parent} اضافه نشد.`,
      failed.length ? `\n<b>اضافه نشد — هزینه‌ای کسر نشد، پول در کیف پول ماند:</b>\n${failed.map(f => `❌ ${f.phone} — ${f.why}`).join('\n')}` : '',
    ].filter(Boolean).join('\n'),
    whyFull: 'جای خالی در طرح نمانده',
    whySeparate: 'آدرس لازم است — جداگانه اضافه کنید',
    whyFailed: 'فعال نشد',
  },
}
const T = (lang) => S[lang] || S.en
const isContinue = (msg) => String(msg || '').startsWith('➡️ ') && Object.values(S).some(s => String(msg).startsWith(s.continueBtn(2).split(/\d/)[0]))

// Tick / untick one search result → { picks, error }.
function toggle(picks, hit, left) {
  const list = Array.isArray(picks) ? picks : []
  if (list.some(p => p.phone_number === hit.phone_number)) return { picks: list.filter(p => p.phone_number !== hit.phone_number) }
  if (list.length >= left) return { picks: list, error: 'full' }
  return { picks: [...list, hit] }
}

// Result keyboard rows: ✅ on ticked numbers, a Continue row once anything is ticked.
function rows(results, picks, lang, showMore, formatPhone) {
  const on = new Set((picks || []).map(p => p.phone_number))
  const out = results.map(r => [`${on.has(r.phone_number) ? '✅' : '📞'} ${formatPhone(r.phone_number)}`])
  if (on.size) out.push([T(lang).continueBtn(on.size)])
  out.push([showMore])
  return out
}

const total = (picks) => Math.round(picks.reduce((t, p) => t + Number(p.price || 0), 0) * 100) / 100

module.exports = { T, isContinue, toggle, rows, total }
