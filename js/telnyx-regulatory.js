/* global require, module, process */
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Telnyx regulatory flow for international Cloud IVR numbers (2026-10).
//
//  1. getRequirements(cc, type)  — LIVE list from Telnyx (cached 6h). Empty ⇒
//     instant purchase (e.g. PR, CO). Never hard-codes requirement ids.
//  2. startSession / handleInput — AFTER payment (same as the Twilio flow) the bot
//     collects contact details, address and (when required) ID / proof-of-address
//     files. Session carries the payment so cancel / 48h abandonment refunds it.
//     Files are kept as Telegram file_ids and only uploaded to Telnyx at order
//     time (Telnyx deletes unlinked documents after ~30 min).
//  3. placeRegulatedOrder        — on submit: create address, upload docs,
//     POST /number_orders with per-number regulatory_requirements (or a
//     requirement group for countries that mandate one, e.g. IE).
//  4. classifyOrder              — 'active' | 'pending' | 'failed' (used by the
//     review poller in _index.js which activates / refunds).
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const axios = require('axios')

const BASE = process.env.TELNYX_REG_API_BASE || 'https://api.telnyx.com/v2' // override = sandbox tests only (js/tests/mock_telnyx_reg_api.js)
const CACHE_MS = 6 * 60 * 60 * 1000
const MAX_FILE_BYTES = 10 * 1024 * 1024
// Countries where Telnyx requires a fulfilled requirement GROUP (not per-number values)
const REQUIREMENT_GROUP_COUNTRIES = new Set(['IE', 'IT', 'CH', 'DK', 'NO', 'PT', 'SE'])
const NO_REQ_COUNTRIES = new Set(['US', 'CA'])

let deps = { db: null, bot: null, log: (...a) => console.log(...a), http: null }
let sessions = null
const reqCache = new Map()

function init(d = {}) {
  deps = { ...deps, ...d }
  if (deps.db) {
    sessions = deps.db.collection('telnyxRegSessions')
    sessions.createIndex({ status: 1, updatedAt: 1 }).catch(() => {})
    sessions.createIndex({ chatId: 1, status: 1 }).catch(() => {})
  }
  return module.exports
}

function http() {
  if (deps.http) return deps.http
  return axios.create({
    baseURL: BASE,
    timeout: 45000,
    headers: { Authorization: `Bearer ${process.env.TELNYX_API_KEY}`, 'Content-Type': 'application/json', Accept: 'application/json' },
  })
}
const errDetail = e => e?.response?.data?.errors?.map(x => x.detail || x.title).join('; ') || e?.message || String(e)

// ── Country name → ISO2 (Node's built-in ICU, no extra dependency) ──
const ISO2 = ('AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ ' +
  'CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF ' +
  'GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW ' +
  'KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL ' +
  'NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST ' +
  'SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS XK YE YT ZA ZM ZW').split(' ')
const REGION_BY_NAME = (() => {
  const map = new Map()
  const add = (k, v) => { const key = String(k).toLowerCase().trim(); if (key && !map.has(key)) map.set(key, v) }
  try {
    const dn = new Intl.DisplayNames(['en'], { type: 'region' })
    for (const code of ISO2) {
      map.set(code.toLowerCase(), code)
      let name
      try { name = dn.of(code) } catch (_) { continue }
      if (!name || name === code) continue
      add(name, code)
      add(name.replace(/\s*\(.*\)\s*/g, ''), code) // "Myanmar (Burma)" → "Myanmar"
      add(name.replace(/ & /g, ' and '), code)
    }
  } catch (_) { ISO2.forEach(c => map.set(c.toLowerCase(), c)) }
  ;[['uk', 'GB'], ['england', 'GB'], ['great britain', 'GB'], ['britain', 'GB'], ['usa', 'US'], ['u.s.a', 'US'], ['america', 'US'],
    ['united states of america', 'US'], ['uae', 'AE'], ['holland', 'NL'], ['the netherlands', 'NL'], ['south korea', 'KR'],
    ['russia', 'RU'], ['ivory coast', 'CI'], ['czechia', 'CZ'], ['czech republic', 'CZ'], ['burma', 'MM'], ['dr congo', 'CD'],
    ['drc', 'CD'], ['congo', 'CG'], ['vietnam', 'VN'], ['viet nam', 'VN'], ['turkey', 'TR'], ['swaziland', 'SZ'], ['hong kong', 'HK'], ['macau', 'MO'], ['macao', 'MO'], ['palestine', 'PS'], ['taiwan', 'TW']].forEach(([k, v]) => map.set(k, v))
  return map
})()
function parseCountry(input) {
  const s = String(input || '').trim().toLowerCase().replace(/[.]/g, '').replace(/\s+/g, ' ')
  if (!s) return null
  return REGION_BY_NAME.get(s) || REGION_BY_NAME.get(s.replace(/^the /, '')) || null
}
function countryLabel(code) {
  try { return new Intl.DisplayNames(['en'], { type: 'region' }).of(code) || code } catch (_) { return code }
}

// ── Requirements ──
async function getRequirements(countryCode, numberType) {
  const cc = String(countryCode || '').toUpperCase()
  if (NO_REQ_COUNTRIES.has(cc)) return { ok: true, reqs: [] }
  const key = `${cc}:${numberType}`
  const hit = reqCache.get(key)
  if (hit && Date.now() - hit.at < CACHE_MS) return { ok: true, reqs: hit.reqs }
  try {
    const r = await http().get('/regulatory_requirements', {
      params: { 'filter[country_code]': cc, 'filter[phone_number_type]': numberType, 'filter[action]': 'ordering' },
    })
    const reqs = (r.data?.data || []).flatMap(d => d.regulatory_requirements || []).map(x => ({
      id: x.id,
      name: x.name || 'Requirement',
      field_type: x.field_type === 'address_id' ? 'address' : x.field_type,
      description: x.description || '',
      example: x.example || '',
      acceptance_criteria: x.acceptance_criteria || {},
    }))
    reqCache.set(key, { at: Date.now(), reqs })
    return { ok: true, reqs }
  } catch (e) {
    deps.log(`[TelnyxReg] requirements lookup failed ${key}: ${errDetail(e)}`)
    return { ok: false, error: errDetail(e) }
  }
}

const isBusinessOnly = r => /business use only/i.test(r.name)
function analyze(reqs = []) {
  const address = reqs.find(r => r.field_type === 'address') || null
  let addressScope = 'worldwide'
  if (address) {
    if (/geographic match|area code/i.test(address.name)) addressScope = 'geo'
    else if (/within the country|\(national\)/i.test(address.name)) addressScope = 'national'
  }
  return {
    supported: reqs.length > 0 && !reqs.some(r => !['textual', 'address', 'document'].includes(r.field_type)),
    address, addressScope,
    docs: reqs.filter(r => r.field_type === 'document'),
    textual: reqs.filter(r => r.field_type === 'textual'),
    needsEmail: reqs.some(r => r.field_type === 'textual' && /e-?mail/i.test(r.name)),
    localOnly: addressScope !== 'worldwide' || reqs.some(r => /local government|south african|local company/i.test(r.name)),
  }
}

// Values we can derive from the profile instead of asking again
function autoValue(req, s) {
  const p = s.profile || {}
  const n = req.name
  if (/contact information/i.test(n) && p.fullName && p.phone) return `${p.fullName}, ${p.business || 'Individual'}, ${p.phone}`
  if (/e-?mail/i.test(n) && p.email) return p.email
  if (/end user name/i.test(n) && p.fullName) return p.business || p.fullName
  if (/end user type/i.test(n) && p.fullName) {
    const want = p.business ? 'company' : 'individual'
    const vals = req.acceptance_criteria?.acceptable_values || []
    return vals.find(v => String(v).toLowerCase().includes(want)) || (p.business ? 'Company' : 'Individual')
  }
  if (isBusinessOnly(req) && p.isIndividual) return 'N/A - individual end user'
  return null
}
function suggestedValue(req) {
  if (/use case|usage description/i.test(req.name)) return 'Voice calls and IVR for my own use only. The number is not sub-allocated, shared or resold to third parties.'
  return null
}
function validateText(req, text) {
  const ac = req.acceptance_criteria || {}
  const v = String(text || '').trim()
  if (!v || !/[\p{L}\p{N}]/u.test(v)) return false
  if (ac.min_length && v.length < ac.min_length) return false
  if (ac.max_length && v.length > ac.max_length) return false
  if (Array.isArray(ac.acceptable_values) && ac.acceptable_values.length &&
      !ac.acceptable_values.some(x => String(x).toLowerCase() === v.toLowerCase())) return false
  if (ac.regex) { try { if (!new RegExp(ac.regex).test(v)) return false } catch (_) { /* non-JS regex — ignore */ } }
  return true
}

// ── i18n ──
const L = {
  en: {
    btnCancel: '❌ Cancel', btnBack: '⬅️ Back', btnSkip: '⏭ Skip', btnIndividual: '👤 Individual (no company)',
    btnContinue: '✅ Submit for verification', btnRestart: '🔄 Start over', btnUseSuggested: '✅ Use suggested answer',
    btnUseSuggestedAddr: '✅ Use suggested address', btnKeepAddr: '➡️ Keep my address', btnReenterAddr: '✏️ Re-enter address',
    intro: (country, type, localOnly, paid) => `✅ <b>Payment received${paid ? `: ${paid}` : ''}</b>\n\n🛂 <b>Step 2 of 2 — verification.</b> ${country} ${type} numbers need your details (telecom regulation). It takes about 2 minutes.${localOnly ? `\n\n⚠️ <b>Local presence required:</b> ${country} only approves these numbers for people or companies with an address in ${country}.` : ''}\n\n⏱ After you submit, the carrier reviews your details (usually a few hours, up to 3 business days). <b>Your plan starts when the number is active.</b>\n💰 Full refund if it isn't approved — or if you cancel now.`,
    askName: '👤 Your <b>full name</b> (first and last name, as on your ID):',
    badName: '❌ Please send your first <b>and</b> last name, e.g. <i>Maria Jansen</i>.',
    askBusiness: '🏢 <b>Company name</b>? If you are buying for yourself, tap <b>Individual</b>.',
    askPhone: '📞 A <b>contact phone number</b> with country code, e.g. <i>+31612345678</i>:',
    badPhone: '❌ That doesn\'t look like a phone number. Use the international format, e.g. <i>+31612345678</i>.',
    askEmail: '📧 Your <b>email address</b>:',
    badEmail: '❌ Please send a valid email address, e.g. <i>name@example.com</i>.',
    addrNote: (scope, country) => scope === 'worldwide' ? 'Your address can be in <b>any country</b>.' : scope === 'geo' ? `The address must be in <b>${country}</b>, in the <b>same area</b> as the number.` : `The address must be in <b>${country}</b>.`,
    askStreet: note => `🏠 <b>Street address</b> (house number and street).\n${note}`,
    askCity: '🏙 <b>City</b>:',
    askRegion: '🗺 <b>State / province / region</b> (tap Skip if none):',
    askPostal: '📮 <b>Postal / ZIP code</b> (tap Skip if none):',
    askCountry: '🌍 <b>Country</b> of this address (name or 2-letter code, e.g. <i>Germany</i> or <i>DE</i>):',
    badCountry: '❌ I couldn\'t recognise that country. Send the name in English or the 2-letter code (e.g. <i>NG</i>).',
    addrInvalid: (errs, sug) => `⚠️ <b>The carrier couldn't verify this address.</b>${errs ? `\n${errs}` : ''}${sug ? `\n\n💡 Suggested:\n<code>${sug}</code>` : ''}\n\nWhat would you like to do?`,
    askText: (name, example) => `✍️ <b>${name}</b>${example ? `\n<i>e.g. ${example}</i>` : ''}`,
    badText: '❌ That answer doesn\'t meet the carrier\'s format. Please try again.',
    askDoc: (name, hint) => `📎 <b>${name}</b>${hint ? `\n<i>${hint}</i>` : ''}\n\nSend a clear <b>photo</b> or a <b>PDF / JPG / PNG</b> file (max 10 MB). All 4 corners visible, no glare.`,
    needFile: '📎 Please send this as a <b>photo</b> or a <b>PDF / JPG / PNG</b> file.',
    fileTooBig: '❌ That file is larger than 10 MB. Please send a smaller photo or PDF.',
    badFileType: '❌ Only PDF, JPG or PNG files are accepted.',
    docOk: '✅ Received.',
    review: (s) => `📋 <b>Please review your details</b>\n\n${s}\n\nIf everything is correct, tap <b>Submit</b>.`,
    cancelled: amt => `❌ Verification cancelled.\n💰 <b>${amt}</b> has been refunded to your wallet.`,
    submitting: '⏳ Sending your details to the carrier…',
    orderFailed: amt => `❌ <b>The carrier couldn't accept this order.</b>\n💰 <b>${amt}</b> has been refunded to your wallet.\n\nPlease try another number or country.`,
    reminder: (country, amt) => `⏳ <b>Your ${country} number is waiting for your verification details</b> (paid ${amt}).\n\nOpen 📞 Cloud IVR + SIP to continue, or send /cancel for a full refund. Unfinished verifications are refunded automatically after 48 hours.`,
    expired: (country, amt) => `⌛ <b>Verification not completed</b>\n\nYour ${country} number order was cancelled because the details weren't sent within 48 hours.\n💰 <b>${amt}</b> has been refunded to your wallet.`,
    resumeHead: country => `📋 <b>Resuming verification</b> — ${country} number. Send /cancel any time for a full refund.`,
    prePay: items => `🛂 <b>Verification after payment:</b> ${items}.\n⏱ Carrier review: usually a few hours, up to 3 business days. Full refund if not approved.`,
    itemContact: 'contact details', itemAddress: 'address', itemAddressIn: c => `address in ${c}`, itemDocs: n => `${n} document${n > 1 ? 's' : ''} (ID / proof of address)`,
    unsupported: country => `🚫 ${country} numbers of this type need an in-person identity check that we can't do in Telegram. Please choose another country or number type.`,
    lookupFailed: '⚠️ Couldn\'t load this country\'s verification rules right now. Please try again in a minute.',
    underReview: (num, country) => `📋 <b>Order placed — verification in progress</b>\n\nYour ${country} number <code>${num}</code> was ordered and your details were sent to the carrier for review. This usually takes a few hours, up to 3 business days.\n\n✅ We'll message you the moment it's active — your plan starts then.\n💰 If it isn't approved, the full amount is refunded to your wallet automatically.`,
    rejected: (num, amount) => `❌ <b>Verification not approved</b>\n\nThe carrier didn't approve the details for <code>${num}</code>.\n💰 <b>${amount}</b> has been refunded to your wallet.\n\nYou can try again with clearer documents, or choose another country.`,
    subNotSupported: '🛂 This country needs identity verification, so it can\'t be added as an extra number. Buy it as a main number from 🛒 Buy Number instead.',
    sumName: 'Name', sumBusiness: 'Company', sumIndividual: 'Individual', sumPhone: 'Phone', sumEmail: 'Email', sumAddress: 'Address', sumDocs: 'Documents', sumDocsN: n => `${n} file(s) received`,
  },
  fr: {
    btnCancel: '❌ Annuler', btnBack: '⬅️ Retour', btnSkip: '⏭ Passer', btnIndividual: '👤 Particulier (pas de société)',
    btnContinue: '✅ Envoyer pour vérification', btnRestart: '🔄 Recommencer', btnUseSuggested: '✅ Utiliser la réponse suggérée',
    btnUseSuggestedAddr: '✅ Utiliser l\'adresse suggérée', btnKeepAddr: '➡️ Garder mon adresse', btnReenterAddr: '✏️ Ressaisir l\'adresse',
    intro: (country, type, localOnly, paid) => `✅ <b>Paiement reçu${paid ? ` : ${paid}` : ''}</b>\n\n🛂 <b>Étape 2 sur 2 — vérification.</b> Les numéros ${type} ${country} nécessitent vos informations (réglementation télécom). Environ 2 minutes.${localOnly ? `\n\n⚠️ <b>Présence locale requise :</b> ${country} n'approuve ces numéros que pour des personnes ou sociétés ayant une adresse en ${country}.` : ''}\n\n⏱ Après envoi, l'opérateur vérifie vos informations (quelques heures, jusqu'à 3 jours ouvrés). <b>Votre forfait démarre à l'activation du numéro.</b>\n💰 Remboursement intégral en cas de refus — ou si vous annulez maintenant.`,
    askName: '👤 Votre <b>nom complet</b> (prénom et nom, comme sur votre pièce d\'identité) :',
    badName: '❌ Envoyez votre prénom <b>et</b> votre nom, ex. <i>Maria Jansen</i>.',
    askBusiness: '🏢 <b>Nom de la société</b> ? Si vous achetez pour vous-même, touchez <b>Particulier</b>.',
    askPhone: '📞 Un <b>numéro de contact</b> avec indicatif, ex. <i>+31612345678</i> :',
    badPhone: '❌ Numéro invalide. Utilisez le format international, ex. <i>+31612345678</i>.',
    askEmail: '📧 Votre <b>adresse e-mail</b> :',
    badEmail: '❌ Envoyez une adresse e-mail valide, ex. <i>nom@exemple.com</i>.',
    addrNote: (scope, country) => scope === 'worldwide' ? 'Votre adresse peut être dans <b>n\'importe quel pays</b>.' : scope === 'geo' ? `L'adresse doit être en <b>${country}</b>, dans la <b>même zone</b> que le numéro.` : `L'adresse doit être en <b>${country}</b>.`,
    askStreet: note => `🏠 <b>Adresse</b> (numéro et rue).\n${note}`,
    askCity: '🏙 <b>Ville</b> :',
    askRegion: '🗺 <b>État / province / région</b> (touchez Passer si aucun) :',
    askPostal: '📮 <b>Code postal</b> (touchez Passer si aucun) :',
    askCountry: '🌍 <b>Pays</b> de cette adresse (nom en anglais ou code à 2 lettres, ex. <i>France</i> ou <i>FR</i>) :',
    badCountry: '❌ Pays non reconnu. Envoyez le nom en anglais ou le code à 2 lettres (ex. <i>FR</i>).',
    addrInvalid: (errs, sug) => `⚠️ <b>L'opérateur n'a pas pu vérifier cette adresse.</b>${errs ? `\n${errs}` : ''}${sug ? `\n\n💡 Suggestion :\n<code>${sug}</code>` : ''}\n\nQue souhaitez-vous faire ?`,
    askText: (name, example) => `✍️ <b>${name}</b>${example ? `\n<i>ex. ${example}</i>` : ''}`,
    badText: '❌ Cette réponse ne respecte pas le format demandé. Réessayez.',
    askDoc: (name, hint) => `📎 <b>${name}</b>${hint ? `\n<i>${hint}</i>` : ''}\n\nEnvoyez une <b>photo</b> nette ou un fichier <b>PDF / JPG / PNG</b> (10 Mo max). 4 coins visibles, sans reflet.`,
    needFile: '📎 Envoyez ceci sous forme de <b>photo</b> ou de fichier <b>PDF / JPG / PNG</b>.',
    fileTooBig: '❌ Fichier supérieur à 10 Mo. Envoyez une photo ou un PDF plus léger.',
    badFileType: '❌ Seuls les fichiers PDF, JPG ou PNG sont acceptés.',
    docOk: '✅ Reçu.',
    review: (s) => `📋 <b>Vérifiez vos informations</b>\n\n${s}\n\nSi tout est correct, touchez <b>Envoyer</b>.`,
    cancelled: amt => `❌ Vérification annulée.\n💰 <b>${amt}</b> a été remboursé sur votre portefeuille.`,
    submitting: '⏳ Envoi de vos informations à l\'opérateur…',
    orderFailed: amt => `❌ <b>L'opérateur n'a pas pu accepter cette commande.</b>\n💰 <b>${amt}</b> a été remboursé sur votre portefeuille.\n\nEssayez un autre numéro ou pays.`,
    reminder: (country, amt) => `⏳ <b>Votre numéro ${country} attend vos informations de vérification</b> (payé ${amt}).\n\nOuvrez 📞 Cloud IVR + SIP pour continuer, ou envoyez /cancel pour un remboursement intégral. Les vérifications non terminées sont remboursées automatiquement après 48 heures.`,
    expired: (country, amt) => `⌛ <b>Vérification non terminée</b>\n\nVotre commande de numéro ${country} a été annulée car les informations n'ont pas été envoyées sous 48 heures.\n💰 <b>${amt}</b> a été remboursé sur votre portefeuille.`,
    resumeHead: country => `📋 <b>Reprise de la vérification</b> — numéro ${country}. Envoyez /cancel à tout moment pour un remboursement intégral.`,
    prePay: items => `🛂 <b>Vérification après paiement :</b> ${items}.\n⏱ Examen par l'opérateur : quelques heures, jusqu'à 3 jours ouvrés. Remboursement intégral en cas de refus.`,
    itemContact: 'coordonnées', itemAddress: 'adresse', itemAddressIn: c => `adresse en ${c}`, itemDocs: n => `${n} document${n > 1 ? 's' : ''} (pièce d'identité / justificatif de domicile)`,
    unsupported: country => `🚫 Les numéros ${country} de ce type exigent une vérification d'identité en direct impossible sur Telegram. Choisissez un autre pays ou type.`,
    lookupFailed: '⚠️ Impossible de charger les règles de vérification de ce pays. Réessayez dans une minute.',
    underReview: (num, country) => `📋 <b>Commande passée — vérification en cours</b>\n\nVotre numéro ${country} <code>${num}</code> est commandé et vos informations ont été envoyées à l'opérateur. Comptez quelques heures, jusqu'à 3 jours ouvrés.\n\n✅ Nous vous prévenons dès qu'il est actif — votre forfait démarre alors.\n💰 En cas de refus, le montant total est remboursé automatiquement sur votre portefeuille.`,
    rejected: (num, amount) => `❌ <b>Vérification refusée</b>\n\nL'opérateur n'a pas approuvé les informations pour <code>${num}</code>.\n💰 <b>${amount}</b> a été remboursé sur votre portefeuille.\n\nRéessayez avec des documents plus nets, ou choisissez un autre pays.`,
    subNotSupported: '🛂 Ce pays exige une vérification d\'identité : il ne peut pas être ajouté comme numéro supplémentaire. Achetez-le comme numéro principal via 🛒 Acheter un numéro.',
    sumName: 'Nom', sumBusiness: 'Société', sumIndividual: 'Particulier', sumPhone: 'Téléphone', sumEmail: 'E-mail', sumAddress: 'Adresse', sumDocs: 'Documents', sumDocsN: n => `${n} fichier(s) reçu(s)`,
  },
  zh: {
    btnCancel: '❌ 取消', btnBack: '⬅️ 返回', btnSkip: '⏭ 跳过', btnIndividual: '👤 个人（无公司）',
    btnContinue: '✅ 提交验证', btnRestart: '🔄 重新开始', btnUseSuggested: '✅ 使用建议答案',
    btnUseSuggestedAddr: '✅ 使用建议地址', btnKeepAddr: '➡️ 保留我的地址', btnReenterAddr: '✏️ 重新输入地址',
    intro: (country, type, localOnly, paid) => `✅ <b>已收到付款${paid ? `：${paid}` : ''}</b>\n\n🛂 <b>第 2 步（共 2 步）— 验证。</b>${country} ${type}号码需要您的资料（电信法规），大约需要 2 分钟。${localOnly ? `\n\n⚠️ <b>需要本地地址：</b>${country} 仅批准在 ${country} 有地址的个人或公司。` : ''}\n\n⏱ 提交后，运营商将审核您的资料（通常几小时，最长 3 个工作日）。<b>号码激活后套餐才开始计算。</b>\n💰 未获批准或现在取消，均可全额退款。`,
    askName: '👤 您的<b>全名</b>（名和姓，与证件一致）：',
    badName: '❌ 请发送您的名<b>和</b>姓，例如 <i>Maria Jansen</i>。',
    askBusiness: '🏢 <b>公司名称</b>？如果是个人购买，请点击<b>个人</b>。',
    askPhone: '📞 带国家区号的<b>联系电话</b>，例如 <i>+31612345678</i>：',
    badPhone: '❌ 电话号码格式不正确。请使用国际格式，例如 <i>+31612345678</i>。',
    askEmail: '📧 您的<b>电子邮箱</b>：',
    badEmail: '❌ 请发送有效的电子邮箱，例如 <i>name@example.com</i>。',
    addrNote: (scope, country) => scope === 'worldwide' ? '地址可以在<b>任何国家</b>。' : scope === 'geo' ? `地址必须在 <b>${country}</b>，且与号码在<b>同一地区</b>。` : `地址必须在 <b>${country}</b>。`,
    askStreet: note => `🏠 <b>街道地址</b>（门牌号和街道）。\n${note}`,
    askCity: '🏙 <b>城市</b>：',
    askRegion: '🗺 <b>州 / 省 / 地区</b>（没有请点击跳过）：',
    askPostal: '📮 <b>邮政编码</b>（没有请点击跳过）：',
    askCountry: '🌍 该地址所在<b>国家</b>（英文名称或两位代码，例如 <i>Germany</i> 或 <i>DE</i>）：',
    badCountry: '❌ 无法识别该国家。请发送英文名称或两位代码（例如 <i>NG</i>）。',
    addrInvalid: (errs, sug) => `⚠️ <b>运营商无法验证此地址。</b>${errs ? `\n${errs}` : ''}${sug ? `\n\n💡 建议地址：\n<code>${sug}</code>` : ''}\n\n您想怎么做？`,
    askText: (name, example) => `✍️ <b>${name}</b>${example ? `\n<i>例如：${example}</i>` : ''}`,
    badText: '❌ 该回答不符合运营商要求的格式，请重试。',
    askDoc: (name, hint) => `📎 <b>${name}</b>${hint ? `\n<i>${hint}</i>` : ''}\n\n请发送清晰的<b>照片</b>或 <b>PDF / JPG / PNG</b> 文件（最大 10 MB），四角可见，无反光。`,
    needFile: '📎 请以<b>照片</b>或 <b>PDF / JPG / PNG</b> 文件发送。',
    fileTooBig: '❌ 文件超过 10 MB，请发送更小的照片或 PDF。',
    badFileType: '❌ 仅接受 PDF、JPG 或 PNG 文件。',
    docOk: '✅ 已收到。',
    review: (s) => `📋 <b>请核对您的信息</b>\n\n${s}\n\n确认无误后请点击<b>提交</b>。`,
    cancelled: amt => `❌ 验证已取消。\n💰 <b>${amt}</b> 已退回您的钱包。`,
    submitting: '⏳ 正在将您的资料提交给运营商…',
    orderFailed: amt => `❌ <b>运营商暂时无法接受此订单。</b>\n💰 <b>${amt}</b> 已退回您的钱包。\n\n请尝试其他号码或国家。`,
    reminder: (country, amt) => `⏳ <b>您的 ${country} 号码正在等待验证资料</b>（已付 ${amt}）。\n\n打开 📞 Cloud IVR + SIP 继续，或发送 /cancel 全额退款。未完成的验证将在 48 小时后自动退款。`,
    expired: (country, amt) => `⌛ <b>验证未完成</b>\n\n由于 48 小时内未提交资料，您的 ${country} 号码订单已取消。\n💰 <b>${amt}</b> 已退回您的钱包。`,
    resumeHead: country => `📋 <b>继续验证</b> — ${country} 号码。随时发送 /cancel 可全额退款。`,
    prePay: items => `🛂 <b>付款后需验证：</b>${items}。\n⏱ 运营商审核：通常几小时，最长 3 个工作日。未获批准全额退款。`,
    itemContact: '联系方式', itemAddress: '地址', itemAddressIn: c => `${c} 境内地址`, itemDocs: n => `${n} 份文件（身份证件 / 地址证明）`,
    unsupported: country => `🚫 ${country} 此类号码需要现场身份验证，无法在 Telegram 中完成。请选择其他国家或号码类型。`,
    lookupFailed: '⚠️ 暂时无法加载该国家的验证要求，请稍后重试。',
    underReview: (num, country) => `📋 <b>订单已提交 — 正在验证</b>\n\n您的 ${country} 号码 <code>${num}</code> 已下单，信息已提交运营商审核。通常需要几小时，最长 3 个工作日。\n\n✅ 号码激活后我们会立即通知您，套餐从激活时开始。\n💰 如未获批准，全部款项将自动退回您的钱包。`,
    rejected: (num, amount) => `❌ <b>验证未通过</b>\n\n运营商未批准 <code>${num}</code> 的资料。\n💰 <b>${amount}</b> 已退回您的钱包。\n\n您可以使用更清晰的文件重试，或选择其他国家。`,
    subNotSupported: '🛂 该国家需要身份验证，无法添加为附加号码。请通过 🛒 购买号码 将其作为主号码购买。',
    sumName: '姓名', sumBusiness: '公司', sumIndividual: '个人', sumPhone: '电话', sumEmail: '邮箱', sumAddress: '地址', sumDocs: '文件', sumDocsN: n => `已收到 ${n} 个文件`,
  },
  hi: {
    btnCancel: '❌ रद्द करें', btnBack: '⬅️ वापस', btnSkip: '⏭ छोड़ें', btnIndividual: '👤 व्यक्तिगत (कोई कंपनी नहीं)',
    btnContinue: '✅ सत्यापन के लिए भेजें', btnRestart: '🔄 फिर से शुरू करें', btnUseSuggested: '✅ सुझाया गया उत्तर उपयोग करें',
    btnUseSuggestedAddr: '✅ सुझाया गया पता उपयोग करें', btnKeepAddr: '➡️ मेरा पता रखें', btnReenterAddr: '✏️ पता दोबारा दर्ज करें',
    intro: (country, type, localOnly, paid) => `✅ <b>भुगतान प्राप्त${paid ? `: ${paid}` : ''}</b>\n\n🛂 <b>चरण 2 में से 2 — सत्यापन।</b> ${country} ${type} नंबरों के लिए आपकी जानकारी ज़रूरी है (टेलीकॉम नियम)। लगभग 2 मिनट लगते हैं।${localOnly ? `\n\n⚠️ <b>स्थानीय पता ज़रूरी:</b> ${country} ये नंबर केवल ${country} में पते वाले लोगों या कंपनियों को देता है।` : ''}\n\n⏱ सबमिट करने के बाद कैरियर आपकी जानकारी की समीक्षा करता है (आमतौर पर कुछ घंटे, अधिकतम 3 कार्य दिवस)। <b>नंबर सक्रिय होने पर ही प्लान शुरू होता है।</b>\n💰 स्वीकृत न होने पर — या अभी रद्द करने पर — पूरा रिफंड।`,
    askName: '👤 आपका <b>पूरा नाम</b> (पहला और अंतिम नाम, ID के अनुसार):',
    badName: '❌ कृपया पहला <b>और</b> अंतिम नाम भेजें, जैसे <i>Maria Jansen</i>।',
    askBusiness: '🏢 <b>कंपनी का नाम</b>? अपने लिए खरीद रहे हैं तो <b>व्यक्तिगत</b> दबाएँ।',
    askPhone: '📞 देश कोड सहित <b>संपर्क फ़ोन नंबर</b>, जैसे <i>+31612345678</i>:',
    badPhone: '❌ यह फ़ोन नंबर सही नहीं लगता। अंतरराष्ट्रीय प्रारूप उपयोग करें, जैसे <i>+31612345678</i>।',
    askEmail: '📧 आपका <b>ईमेल पता</b>:',
    badEmail: '❌ कृपया मान्य ईमेल भेजें, जैसे <i>name@example.com</i>।',
    addrNote: (scope, country) => scope === 'worldwide' ? 'आपका पता <b>किसी भी देश</b> में हो सकता है।' : scope === 'geo' ? `पता <b>${country}</b> में, नंबर वाले <b>उसी क्षेत्र</b> में होना चाहिए।` : `पता <b>${country}</b> में होना चाहिए।`,
    askStreet: note => `🏠 <b>सड़क का पता</b> (मकान नंबर और सड़क)।\n${note}`,
    askCity: '🏙 <b>शहर</b>:',
    askRegion: '🗺 <b>राज्य / प्रांत / क्षेत्र</b> (न हो तो छोड़ें दबाएँ):',
    askPostal: '📮 <b>पिन / ZIP कोड</b> (न हो तो छोड़ें दबाएँ):',
    askCountry: '🌍 इस पते का <b>देश</b> (अंग्रेज़ी नाम या 2-अक्षर कोड, जैसे <i>India</i> या <i>IN</i>):',
    badCountry: '❌ देश पहचाना नहीं गया। अंग्रेज़ी नाम या 2-अक्षर कोड भेजें (जैसे <i>IN</i>)।',
    addrInvalid: (errs, sug) => `⚠️ <b>कैरियर इस पते को सत्यापित नहीं कर सका।</b>${errs ? `\n${errs}` : ''}${sug ? `\n\n💡 सुझाव:\n<code>${sug}</code>` : ''}\n\nआप क्या करना चाहेंगे?`,
    askText: (name, example) => `✍️ <b>${name}</b>${example ? `\n<i>उदाहरण: ${example}</i>` : ''}`,
    badText: '❌ यह उत्तर कैरियर के प्रारूप से मेल नहीं खाता। फिर से प्रयास करें।',
    askDoc: (name, hint) => `📎 <b>${name}</b>${hint ? `\n<i>${hint}</i>` : ''}\n\nएक साफ़ <b>फ़ोटो</b> या <b>PDF / JPG / PNG</b> फ़ाइल भेजें (अधिकतम 10 MB)। चारों कोने दिखें, कोई चमक न हो।`,
    needFile: '📎 कृपया इसे <b>फ़ोटो</b> या <b>PDF / JPG / PNG</b> फ़ाइल के रूप में भेजें।',
    fileTooBig: '❌ फ़ाइल 10 MB से बड़ी है। छोटी फ़ोटो या PDF भेजें।',
    badFileType: '❌ केवल PDF, JPG या PNG फ़ाइलें स्वीकार हैं।',
    docOk: '✅ प्राप्त हुआ।',
    review: (s) => `📋 <b>कृपया अपनी जानकारी जाँचें</b>\n\n${s}\n\nसब सही है तो <b>भेजें</b> दबाएँ।`,
    cancelled: amt => `❌ सत्यापन रद्द।\n💰 <b>${amt}</b> आपके वॉलेट में वापस कर दिए गए हैं।`,
    submitting: '⏳ आपकी जानकारी कैरियर को भेजी जा रही है…',
    orderFailed: amt => `❌ <b>कैरियर यह ऑर्डर स्वीकार नहीं कर सका।</b>\n💰 <b>${amt}</b> आपके वॉलेट में वापस कर दिए गए हैं।\n\nकृपया दूसरा नंबर या देश आज़माएँ।`,
    reminder: (country, amt) => `⏳ <b>आपका ${country} नंबर आपकी सत्यापन जानकारी का इंतज़ार कर रहा है</b> (भुगतान ${amt})।\n\nजारी रखने के लिए 📞 Cloud IVR + SIP खोलें, या पूरे रिफंड के लिए /cancel भेजें। अधूरे सत्यापन 48 घंटे बाद अपने आप रिफंड हो जाते हैं।`,
    expired: (country, amt) => `⌛ <b>सत्यापन पूरा नहीं हुआ</b>\n\n48 घंटे में जानकारी न मिलने से आपका ${country} नंबर ऑर्डर रद्द कर दिया गया।\n💰 <b>${amt}</b> आपके वॉलेट में वापस कर दिए गए हैं।`,
    resumeHead: country => `📋 <b>सत्यापन जारी</b> — ${country} नंबर। पूरे रिफंड के लिए कभी भी /cancel भेजें।`,
    prePay: items => `🛂 <b>भुगतान के बाद सत्यापन:</b> ${items}।\n⏱ कैरियर समीक्षा: आमतौर पर कुछ घंटे, अधिकतम 3 कार्य दिवस। स्वीकृत न होने पर पूरा रिफंड।`,
    itemContact: 'संपर्क विवरण', itemAddress: 'पता', itemAddressIn: c => `${c} में पता`, itemDocs: n => `${n} दस्तावेज़ (ID / पते का प्रमाण)`,
    unsupported: country => `🚫 ${country} के इस प्रकार के नंबरों के लिए लाइव पहचान जाँच चाहिए जो Telegram में संभव नहीं। कृपया दूसरा देश या प्रकार चुनें।`,
    lookupFailed: '⚠️ इस देश के सत्यापन नियम अभी लोड नहीं हो सके। एक मिनट बाद फिर प्रयास करें।',
    underReview: (num, country) => `📋 <b>ऑर्डर हो गया — सत्यापन जारी है</b>\n\nआपका ${country} नंबर <code>${num}</code> ऑर्डर हो गया है और आपकी जानकारी कैरियर को समीक्षा के लिए भेज दी गई है। आमतौर पर कुछ घंटे, अधिकतम 3 कार्य दिवस।\n\n✅ सक्रिय होते ही हम आपको बताएँगे — तभी प्लान शुरू होगा।\n💰 स्वीकृत न होने पर पूरी राशि अपने आप वॉलेट में वापस आ जाएगी।`,
    rejected: (num, amount) => `❌ <b>सत्यापन स्वीकृत नहीं हुआ</b>\n\nकैरियर ने <code>${num}</code> की जानकारी स्वीकृत नहीं की।\n💰 <b>${amount}</b> आपके वॉलेट में वापस कर दिए गए हैं।\n\nसाफ़ दस्तावेज़ों के साथ फिर प्रयास करें, या दूसरा देश चुनें।`,
    subNotSupported: '🛂 इस देश के लिए पहचान सत्यापन ज़रूरी है, इसलिए इसे अतिरिक्त नंबर के रूप में नहीं जोड़ा जा सकता। इसे 🛒 नंबर खरीदें से मुख्य नंबर के रूप में खरीदें।',
    sumName: 'नाम', sumBusiness: 'कंपनी', sumIndividual: 'व्यक्तिगत', sumPhone: 'फ़ोन', sumEmail: 'ईमेल', sumAddress: 'पता', sumDocs: 'दस्तावेज़', sumDocsN: n => `${n} फ़ाइल प्राप्त`,
  },
}
const T = lang => ({ ...L.en, ...(L[lang] || {}) })
const isBtn = (text, key) => Object.values(L).some(l => l[key] === text)
const TYPE_LABEL = { local: 'local', mobile: 'mobile', toll_free: 'toll-free', national: 'national' }
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const stripFlag = s => String(s || '').replace(/^[\u{1F1E6}-\u{1F1FF}]{2}\s*/u, '')
const shortHint = d => { const s = String(d || '').replace(/\s+/g, ' ').trim(); return s.length > 220 ? s.slice(0, 217) + '…' : s }

// ── Steps ──
function buildSteps(reqs) {
  const a = analyze(reqs)
  const steps = []
  if (a.address || a.textual.length) {
    steps.push('name', 'business', 'phone')
    if (a.needsEmail) steps.push('email')
  }
  if (a.address) {
    steps.push('street', 'city', 'region', 'postal')
    if (a.addressScope === 'worldwide') steps.push('country')
    steps.push('addr_check')
  }
  a.textual.forEach(r => steps.push(`text:${r.id}`))
  a.docs.forEach(r => steps.push(`doc:${r.id}`))
  steps.push('review')
  return steps
}
const reqById = (s, id) => (s.reqs || []).find(r => r.id === id)

const fmtAmount = r => (r?.currency === 'ngn' ? `₦${Number(r.amount || 0).toLocaleString()}` : `$${Number(r?.amount || 0).toFixed(2)}`)

// payment: { planKey, price, refund:{currency,amount}, paymentMethod, capabilities, areaCode }
async function startSession(chatId, { countryCode, numberType, countryName, selectedNumber, reqs, lang = 'en', payment = null }) {
  const t = T(lang)
  const a = analyze(reqs)
  const cname = countryName || countryLabel(countryCode)
  if (!a.supported) return { ok: false, text: t.unsupported(esc(cname)) }
  const now = new Date()
  const session = {
    _id: `${chatId}:${now.getTime()}`, chatId: String(chatId), countryCode, numberType, countryName: cname, selectedNumber,
    status: 'collecting', reqs, steps: buildSteps(reqs), idx: 0, profile: {}, address: {}, values: {}, docs: {},
    addressScope: a.addressScope, lang, payment, price: Number(payment?.price) || 0, createdAt: now, updatedAt: now,
  }
  if (a.addressScope !== 'worldwide') session.address.country = countryCode
  await advance(session)
  await sessions.insertOne(session)
  return {
    ok: true,
    session,
    intro: t.intro(esc(stripFlag(cname)), TYPE_LABEL[numberType] || numberType, a.localOnly, payment ? fmtAmount(payment.refund) : ''),
    prompt: prompt(session, lang),
  }
}

async function getSession(chatId) {
  return sessions ? sessions.findOne({ chatId: String(chatId), status: 'collecting' }, { sort: { updatedAt: -1 } }) : null
}
const getIncompleteSession = getSession
async function getSessionById(id) { return sessions ? sessions.findOne({ _id: id }) : null }

// Atomic collecting → <status>. Returns the session when THIS call made the transition (refund exactly once).
async function closeSession(id, status, extra = {}) {
  const r = await sessions.findOneAndUpdate({ _id: id, status: 'collecting' }, { $set: { status, ...extra, updatedAt: new Date() } }, { returnDocument: 'after' })
  return r?.value !== undefined ? r.value : r
}
async function cancelSession(chatId) {
  const s = await getSession(chatId)
  return s ? closeSession(s._id, 'cancelled', { cancelledAt: new Date() }) : null
}
async function setStatus(id, status, extra = {}) {
  await sessions.updateOne({ _id: id }, { $set: { status, ...extra, updatedAt: new Date() } })
}

async function resumePrompt(chatId, lang) {
  const s = await getSession(chatId)
  if (!s) return null
  const l = lang || s.lang
  const p = prompt(s, l)
  return { session: s, text: `${T(l).resumeHead(esc(stripFlag(s.countryName)))}\n\n${p.text}`, keyboard: p.keyboard }
}
async function restartSession(chatId, lang) {
  const s = await getSession(chatId)
  if (!s) return null
  s.idx = 0; s.profile = {}; s.values = {}; s.docs = {}; s.addrCheck = null
  s.address = s.addressScope !== 'worldwide' ? { country: s.countryCode } : {}
  await advance(s)
  s.updatedAt = new Date()
  await sessions.replaceOne({ _id: s._id, status: 'collecting' }, s)
  const p = prompt(s, lang || s.lang)
  return { session: s, text: p.text, keyboard: p.keyboard }
}

// Paid sessions left unfinished: remind once after remindMs idle, expire (caller refunds) after expireMs idle.
async function findAbandoned({ remindMs = 6 * 3600e3, expireMs = 48 * 3600e3 } = {}) {
  if (!sessions) return { remind: [], expire: [] }
  const now = Date.now()
  const base = { status: 'collecting', payment: { $ne: null } }
  const expire = await sessions.find({ ...base, updatedAt: { $lt: new Date(now - expireMs) } }).limit(25).toArray()
  const remind = await sessions.find({ ...base, reminded: { $ne: true }, updatedAt: { $lt: new Date(now - remindMs), $gte: new Date(now - expireMs) } }).limit(25).toArray()
  const stuck = await sessions.find({ status: 'submitting', stuckAlerted: { $ne: true }, updatedAt: { $lt: new Date(now - 30 * 60e3) } }).limit(25).toArray()
  return { remind, expire, stuck }
}
async function markReminded(id) { await sessions.updateOne({ _id: id }, { $set: { reminded: true } }) }
async function markStuckAlerted(id) { await sessions.updateOne({ _id: id }, { $set: { stuckAlerted: true } }) }

// Pre-payment summary line: what the user will be asked for after paying.
function prePayNote(reqs, countryName, lang = 'en') {
  const t = T(lang)
  const a = analyze(reqs)
  const items = []
  if (a.address || a.textual.length) items.push(t.itemContact)
  if (a.address) items.push(a.addressScope === 'worldwide' ? t.itemAddress : t.itemAddressIn(esc(stripFlag(countryName))))
  if (a.docs.length) items.push(t.itemDocs(a.docs.length))
  return items.length ? t.prePay(items.join(', ')) : ''
}

// Auto-complete steps that need no user input. Returns true when the step was completed.
async function tryAuto(s, step) {
  if (step.startsWith('text:')) {
    const r = reqById(s, step.slice(5))
    if (!r) return true
    const v = autoValue(r, s)
    if (v != null) { s.values[r.id] = v; return true }
    return false
  }
  if (step.startsWith('doc:')) {
    const r = reqById(s, step.slice(4))
    if (!r) return true
    if (isBusinessOnly(r) && s.profile.isIndividual) { s.docs[r.id] = { skipped: true }; return true }
    return false
  }
  if (step === 'addr_check') {
    if (s.addrCheck?.done) return true
    const v = await validateAddress(s)
    s.addrCheck = v
    if (v.result !== 'invalid') { s.addrCheck.done = true; return true }
    return false
  }
  return false
}
async function advance(s) {
  while (s.idx < s.steps.length && await tryAuto(s, s.steps[s.idx])) s.idx++
}

function addressLine(a) {
  return [a.street, a.city, a.region, a.postal, a.country ? countryLabel(a.country) : null].filter(Boolean).join(', ')
}

function prompt(s, lang) {
  const t = T(lang)
  const step = s.steps[s.idx]
  const nav = s.idx > 0 ? [t.btnBack, t.btnCancel] : [t.btnCancel]
  const cname = stripFlag(s.countryName)
  switch (step) {
    case 'name': return { text: t.askName, keyboard: [nav] }
    case 'business': return { text: t.askBusiness, keyboard: [[t.btnIndividual], nav] }
    case 'phone': return { text: t.askPhone, keyboard: [nav] }
    case 'email': return { text: t.askEmail, keyboard: [nav] }
    case 'street': return { text: t.askStreet(t.addrNote(s.addressScope, esc(cname))), keyboard: [nav] }
    case 'city': return { text: t.askCity, keyboard: [nav] }
    case 'region': return { text: t.askRegion, keyboard: [[t.btnSkip], nav] }
    case 'postal': return { text: t.askPostal, keyboard: [[t.btnSkip], nav] }
    case 'country': return { text: t.askCountry, keyboard: [nav] }
    case 'addr_check': {
      const sug = s.addrCheck?.suggested ? addressLine(s.addrCheck.suggested) : ''
      const rows = []
      if (sug) rows.push([t.btnUseSuggestedAddr])
      rows.push([t.btnKeepAddr], [t.btnReenterAddr], nav)
      return { text: t.addrInvalid(esc(s.addrCheck?.errors || ''), esc(sug)), keyboard: rows }
    }
    case 'review': return { text: t.review(summary(s, lang)), keyboard: [[t.btnContinue], [t.btnRestart], [t.btnCancel]] }
    default: break
  }
  if (step?.startsWith('text:')) {
    const r = reqById(s, step.slice(5))
    const rows = []
    if (suggestedValue(r)) rows.push([t.btnUseSuggested])
    const vals = r?.acceptance_criteria?.acceptable_values || []
    if (vals.length && vals.length <= 6) vals.forEach(v => rows.push([String(v)]))
    rows.push(nav)
    const sug = suggestedValue(r)
    return { text: t.askText(esc(r?.name), esc(sug || shortHint(r?.example))), keyboard: rows }
  }
  if (step?.startsWith('doc:')) {
    const r = reqById(s, step.slice(4))
    return { text: t.askDoc(esc(r?.name), esc(shortHint(r?.description))), keyboard: [nav] }
  }
  return { text: t.review(summary(s, lang)), keyboard: [[t.btnContinue], [t.btnCancel]] }
}

function summary(s, lang) {
  const t = T(lang)
  const p = s.profile || {}
  const lines = []
  if (p.fullName) lines.push(`👤 ${t.sumName}: <b>${esc(p.fullName)}</b>`)
  if (p.fullName) lines.push(`🏢 ${t.sumBusiness}: <b>${esc(p.business || t.sumIndividual)}</b>`)
  if (p.phone) lines.push(`📞 ${t.sumPhone}: <code>${esc(p.phone)}</code>`)
  if (p.email) lines.push(`📧 ${t.sumEmail}: <code>${esc(p.email)}</code>`)
  if (s.address?.street) lines.push(`🏠 ${t.sumAddress}: ${esc(addressLine(s.address))}`)
  for (const r of (s.reqs || []).filter(x => x.field_type === 'textual')) {
    const v = s.values?.[r.id]
    if (v && !/contact information|e-?mail|end user name|end user type/i.test(r.name)) lines.push(`✍️ ${esc(r.name)}: <i>${esc(String(v).slice(0, 120))}</i>`)
  }
  const nDocs = Object.values(s.docs || {}).filter(d => d && d.file_id).length
  if (nDocs) lines.push(`📎 ${t.sumDocs}: ${t.sumDocsN(nDocs)}`)
  return lines.join('\n')
}

// Previous step that actually needs user input (used by ⬅️ Back)
function backIdx(s) {
  let i = s.idx - 1
  while (i > 0) {
    const st = s.steps[i]
    const auto = (st.startsWith('text:') && autoValue(reqById(s, st.slice(5)) || { name: '' }, s) != null) ||
      (st.startsWith('doc:') && s.docs?.[st.slice(4)]?.skipped) || (st === 'addr_check')
    if (!auto) break
    i--
  }
  return Math.max(0, i)
}

const normPhone = v => { const d = String(v || '').replace(/[\s\-().]/g, ''); return /^\+?[1-9]\d{6,14}$/.test(d) ? (d.startsWith('+') ? d : '+' + d) : null }

/**
 * Handle one user message for the active session.
 * input: { text } | { photo: [...] } | { document: {...} }
 * Returns null when no collecting session exists, else
 * { text, keyboard, done?, cancelled? }
 */
async function handleInput(chatId, input = {}, lang = 'en') {
  const s = await getSession(chatId)
  if (!s || s.status !== 'collecting') return null
  const t = T(lang)
  const text = typeof input.text === 'string' ? input.text.trim() : ''
  const step = s.steps[s.idx]
  const reply = async (extra = {}) => {
    s.updatedAt = new Date()
    const w = await sessions.replaceOne({ _id: s._id, status: 'collecting' }, s)
    if (!w.matchedCount) return { text: '', closed: true }
    const p = prompt(s, lang)
    return { text: (extra.prefix ? extra.prefix + '\n\n' : '') + p.text, keyboard: p.keyboard, ...extra }
  }
  const retry = msg => { const p = prompt(s, lang); return { text: (msg ? msg + '\n\n' : '') + p.text, keyboard: p.keyboard } }

  if (text && isBtn(text, 'btnCancel')) {
    const closed = await closeSession(s._id, 'cancelled', { cancelledAt: new Date() })
    if (!closed) return { text: '', closed: true }
    return { text: t.cancelled(fmtAmount(s.payment?.refund)), cancelled: true, session: closed, refundable: true }
  }
  if (text && isBtn(text, 'btnBack')) {
    s.idx = backIdx(s)
    if (s.steps[s.idx] === 'addr_check' || ['street', 'city', 'region', 'postal', 'country'].includes(s.steps[s.idx])) s.addrCheck = null
    return reply()
  }

  if (step?.startsWith('doc:')) {
    const r = reqById(s, step.slice(4))
    let file = null
    if (Array.isArray(input.photo) && input.photo.length) {
      const ph = input.photo[input.photo.length - 1]
      file = { file_id: ph.file_id, file_name: `${r.id.slice(0, 8)}-${s.chatId}.jpg`, mime_type: 'image/jpeg', size: ph.file_size || 0 }
    } else if (input.document?.file_id) {
      const d = input.document
      const mime = String(d.mime_type || '').toLowerCase()
      const ext = (String(d.file_name || '').split('.').pop() || '').toLowerCase()
      const ok = ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png'].includes(mime) || ['pdf', 'jpg', 'jpeg', 'png'].includes(ext)
      if (!ok) return retry(t.badFileType)
      file = { file_id: d.file_id, file_name: d.file_name || `${r.id.slice(0, 8)}-${s.chatId}.${ext || 'pdf'}`, mime_type: mime || 'application/pdf', size: d.file_size || 0 }
    }
    if (!file) return retry(t.needFile)
    if (file.size && file.size > MAX_FILE_BYTES) return retry(t.fileTooBig)
    s.docs[r.id] = file
    s.idx++
    await advance(s)
    return reply({ prefix: t.docOk })
  }

  if (!text) return retry(t.badText)

  switch (step) {
    case 'name': {
      const parts = text.replace(/\s+/g, ' ').split(' ').filter(Boolean)
      if (parts.length < 2 || text.length > 80 || /\d/.test(text)) return retry(t.badName)
      s.profile.fullName = parts.join(' ')
      s.profile.firstName = parts[0]
      s.profile.lastName = parts.slice(1).join(' ')
      break
    }
    case 'business':
      if (isBtn(text, 'btnIndividual')) { s.profile.business = null; s.profile.isIndividual = true } else {
        if (text.length < 2 || text.length > 120) return retry(t.badText)
        s.profile.business = text; s.profile.isIndividual = false
      }
      break
    case 'phone': {
      const ph = normPhone(text)
      if (!ph) return retry(t.badPhone)
      s.profile.phone = ph
      break
    }
    case 'email':
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(text)) return retry(t.badEmail)
      s.profile.email = text.toLowerCase()
      break
    case 'street': if (text.length < 3) return retry(t.badText); s.address.street = text; s.addrCheck = null; break
    case 'city': if (text.length < 2) return retry(t.badText); s.address.city = text; s.addrCheck = null; break
    case 'region': s.address.region = isBtn(text, 'btnSkip') ? '' : text; s.addrCheck = null; break
    case 'postal': s.address.postal = isBtn(text, 'btnSkip') ? '' : text.toUpperCase(); s.addrCheck = null; break
    case 'country': {
      const cc = parseCountry(text)
      if (!cc) return retry(t.badCountry)
      s.address.country = cc; s.addrCheck = null
      break
    }
    case 'addr_check':
      if (isBtn(text, 'btnUseSuggestedAddr') && s.addrCheck?.suggested) {
        const g = s.addrCheck.suggested
        s.address = { ...s.address, street: g.street || s.address.street, city: g.city || s.address.city, region: g.region ?? s.address.region, postal: g.postal ?? s.address.postal }
        s.addrCheck = { result: 'accepted', done: true }
      } else if (isBtn(text, 'btnKeepAddr')) {
        s.addrCheck = { ...(s.addrCheck || {}), done: true, keptInvalid: true }
      } else if (isBtn(text, 'btnReenterAddr')) {
        s.idx = s.steps.indexOf('street'); s.addrCheck = null
        return reply()
      } else return retry(t.badText)
      break
    case 'review':
      if (isBtn(text, 'btnContinue')) {
        const closed = await closeSession(s._id, 'submitting', { submittedAt: new Date() })
        if (!closed) return null
        return { text: t.submitting, done: true, session: closed }
      }
      if (isBtn(text, 'btnRestart')) {
        s.idx = 0; s.profile = {}; s.values = {}; s.docs = {}; s.addrCheck = null
        s.address = s.addressScope !== 'worldwide' ? { country: s.countryCode } : {}
        return reply()
      }
      return retry('')
    default: {
      if (step?.startsWith('text:')) {
        const r = reqById(s, step.slice(5))
        const val = isBtn(text, 'btnUseSuggested') && suggestedValue(r) ? suggestedValue(r) : text
        if (!validateText(r, val)) return retry(t.badText)
        s.values[r.id] = val
      }
    }
  }
  s.idx++
  await advance(s)
  return reply()
}

// ── Telnyx calls ──
async function validateAddress(s) {
  const a = s.address || {}
  try {
    const r = await http().post('/addresses/actions/validate', {
      street_address: a.street, locality: a.city, administrative_area: a.region || a.city,
      postal_code: a.postal || undefined, country_code: a.country,
    }, { validateStatus: st => st < 500 })
    const d = r.data?.data || {}
    const g = d.suggested || {}
    const sug = (g.street_address || g.locality || g.postal_code) ? {
      street: g.street_address, city: g.locality, region: g.administrative_area, postal: g.postal_code, country: a.country,
    } : null
    const errs = [...(d.errors || []), ...(r.data?.errors || [])]
    const errors = errs.map(e => `• ${e.detail || e.title || e.code || ''}`).filter(x => x.length > 2).join('\n')
    const invalid = d.result === 'invalid' || r.status === 422
    if (r.status >= 400 && !invalid) throw new Error(errors || `HTTP ${r.status}`)
    return { result: invalid ? 'invalid' : 'valid', suggested: invalid ? sug : null, errors }
  } catch (e) {
    deps.log(`[TelnyxReg] address validate unavailable (${a.country}): ${errDetail(e)}`)
    return { result: 'unavailable' }
  }
}

async function createAddress(s) {
  const p = s.profile || {}
  const a = s.address || {}
  const body = {
    first_name: p.firstName, last_name: p.lastName,
    business_name: p.business || p.fullName,
    phone_number: p.phone || undefined,
    street_address: a.street, locality: a.city,
    administrative_area: a.region || a.city,
    postal_code: a.postal || '00000',
    country_code: a.country,
    customer_reference: `tg-${s.chatId}`,
    address_book: false,
    validate_address: !s.addrCheck?.keptInvalid,
  }
  const r = await http().post('/addresses', body)
  return r.data?.data?.id
}

async function downloadTelegramFile(fileId) {
  if (deps.downloadFile) return deps.downloadFile(fileId)
  const link = await deps.bot.getFileLink(fileId)
  const r = await axios.get(link, { responseType: 'arraybuffer', timeout: 60000 })
  return Buffer.from(r.data)
}

async function uploadDocument(s, file) {
  const buf = await downloadTelegramFile(file.file_id)
  if (buf.length > MAX_FILE_BYTES) throw new Error('document larger than 10 MB')
  const r = await http().post('/documents', {
    file: buf.toString('base64'),
    filename: file.file_name,
    customer_reference: `tg-${s.chatId}`,
  })
  return r.data?.data?.id
}

/**
 * Place the Telnyx order for a READY session.
 * Returns { ok:true, order, state:'active'|'pending'|'failed' } or { ok:false, error }
 */
async function placeRegulatedOrder(session, { connectionId, messagingProfileId, customerReference } = {}) {
  const s = session
  try {
    const a = analyze(s.reqs)
    const values = []
    let addressId = null
    if (a.address) {
      addressId = s._addressId || await createAddress(s)
      if (!addressId) throw new Error('address creation returned no id')
      s._addressId = addressId
      values.push({ requirement_id: a.address.id, field_value: addressId })
    }
    for (const r of a.textual) {
      const v = s.values?.[r.id] ?? autoValue(r, s)
      if (v != null && String(v).trim()) values.push({ requirement_id: r.id, field_value: String(v) })
    }
    const docIds = {}
    for (const r of a.docs) {
      const f = s.docs?.[r.id]
      if (!f || f.skipped || !f.file_id) continue
      const id = s._docIds?.[r.id] || await uploadDocument(s, f)
      if (!id) throw new Error(`document upload returned no id (${r.name})`)
      docIds[r.id] = id
      s._docIds = { ...(s._docIds || {}), [r.id]: id }
      values.push({ requirement_id: r.id, field_value: id })
    }
    const phoneEntry = { phone_number: s.selectedNumber }
    let requirementGroupId = null
    if (REQUIREMENT_GROUP_COUNTRIES.has(s.countryCode)) {
      requirementGroupId = s._requirementGroupId || (await http().post('/requirement_groups', {
        country_code: s.countryCode, phone_number_type: s.numberType, action: 'ordering',
        customer_reference: customerReference || `tg-${s.chatId}`, regulatory_requirements: values,
      })).data?.data?.id
      if (!requirementGroupId) throw new Error('requirement group creation returned no id')
      s._requirementGroupId = requirementGroupId
      phoneEntry.requirement_group_id = requirementGroupId
    } else {
      phoneEntry.regulatory_requirements = values
    }
    const body = { phone_numbers: [phoneEntry], customer_reference: customerReference || `tg-${s.chatId}` }
    if (connectionId) body.connection_id = connectionId
    if (messagingProfileId) body.messaging_profile_id = messagingProfileId
    const r = await http().post('/number_orders', body)
    const order = r.data?.data
    if (!order?.id) throw new Error('number order returned no id')
    // Order exists at Telnyx now — a DB blip here must not turn into a refund
    if (sessions) {
      await sessions.updateOne({ _id: s._id }, { $set: {
        status: 'ordered', orderId: order.id, addressId, documentIds: docIds, requirementGroupId, orderedAt: new Date(), updatedAt: new Date(),
      } }).catch(e => deps.log(`[TelnyxReg] order ${order.id} placed but session update failed: ${e.message}`))
    }
    return { ok: true, order, state: classifyOrder(order) }
  } catch (e) {
    const error = errDetail(e)
    deps.log(`[TelnyxReg] regulated order failed for ${s.chatId} ${s.selectedNumber}: ${error}`)
    if (sessions) await sessions.updateOne({ _id: s._id }, { $set: { lastError: error, updatedAt: new Date() } }).catch(() => {})
    return { ok: false, error }
  }
}

async function getOrder(orderId) {
  const r = await http().get(`/number_orders/${encodeURIComponent(orderId)}`)
  return r.data?.data
}

const FAIL_REQ = new Set(['requirement-info-exception', 'cancelled', 'deleted', 'failure', 'failed', 'rejected'])
const FAIL_PHONE = new Set(['failure', 'failed', 'cancelled', 'deleted'])
function classifyOrder(order) {
  if (!order) return 'pending'
  const phones = order.phone_numbers || []
  if (order.status === 'failure' || phones.some(p => FAIL_PHONE.has(p.status) || FAIL_REQ.has(p.requirements_status))) return 'failed'
  const ok = order.status === 'success' && phones.length > 0 && phones.every(p =>
    p.status === 'success' && p.requirements_met !== false && (!p.requirements_status || p.requirements_status === 'approved'))
  return ok ? 'active' : 'pending'
}
// Order stuck waiting for info we never got (Telnyx auto-cancels these)
function isMissingInfo(order) {
  return (order?.phone_numbers || []).some(p => p.requirements_status === 'requirement-info-pending')
}

module.exports = {
  init, getRequirements, analyze, buildSteps, startSession, handleInput, getSession, getIncompleteSession, getSessionById,
  cancelSession, closeSession, setStatus, resumePrompt, restartSession, findAbandoned, markReminded, markStuckAlerted, prePayNote, fmtAmount,
  placeRegulatedOrder, getOrder, classifyOrder, isMissingInfo, parseCountry, autoValue, T, isBtn,
  REQUIREMENT_GROUP_COUNTRIES, _reqCache: reqCache,
}
