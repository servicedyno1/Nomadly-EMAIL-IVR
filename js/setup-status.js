'use strict'
// "Setting up" progress for a new number, shared by the web app and the bot: carrier order → activation → outgoing caller-ID link.
// Returns null when the number is ready, else { stage, step, eta, note, nextTryMin, refundAt, callsIn, callsOut }.
const { LINK_RETRY_MS, LINK_ROUNDS } = require('./bird-callerid-verify')
const ORDER_MAX_MS = 24 * 3600000
const LINKED = ['retell', 'infobip', 'multitel', 'infobip_fax', '2chat']
const minsUntil = (d) => Math.max(1, Math.ceil((new Date(d).getTime() - Date.now()) / 60000))
const e164 = (p) => `+${String(p || '').replace(/[^\d]/g, '')}`

const T = {
  en: {
    head: '⏳ Setting up', order: 'Reserving your number with the carrier', activate: 'Activating your number', link: 'Linking your number for outgoing calls', linkFax: 'Linking your number for sending faxes', team: 'Our team is finishing the last step',
    soon: 'next try within a minute', next: (m) => `next try in about ${m} min`, about: (m) => `ready in about ${m} min`, few: 'usually a few minutes', hours: 'usually within a few hours',
    orderNote: (d) => `It finishes on its own. If it isn't ready by ${d}, you're refunded.`, inWorks: 'Incoming calls already work.', inFax: 'Receiving faxes already works.',
  },
  fr: {
    head: '⏳ En cours de configuration', order: 'Réservation de votre numéro auprès de l’opérateur', activate: 'Activation de votre numéro', link: 'Liaison de votre numéro pour les appels sortants', linkFax: 'Liaison de votre numéro pour l’envoi de fax', team: 'Notre équipe termine la dernière étape',
    soon: 'nouvel essai dans une minute', next: (m) => `nouvel essai dans environ ${m} min`, about: (m) => `prêt dans environ ${m} min`, few: 'en général quelques minutes', hours: 'en général sous quelques heures',
    orderNote: (d) => `Cela se termine tout seul. S’il n’est pas prêt le ${d}, vous êtes remboursé.`, inWorks: 'Les appels entrants fonctionnent déjà.', inFax: 'La réception de fax fonctionne déjà.',
  },
  zh: {
    head: '⏳ 正在设置', order: '正在向运营商预订您的号码', activate: '正在激活您的号码', link: '正在为外呼关联您的号码', linkFax: '正在为发送传真关联您的号码', team: '我们的团队正在完成最后一步',
    soon: '1 分钟内重试', next: (m) => `约 ${m} 分钟后重试`, about: (m) => `约 ${m} 分钟后就绪`, few: '通常几分钟', hours: '通常几小时内',
    orderNote: (d) => `会自动完成。如果到 ${d} 仍未就绪，将为您退款。`, inWorks: '来电已可使用。', inFax: '接收传真已可使用。',
  },
  hi: {
    head: '⏳ सेट हो रहा है', order: 'कैरियर के साथ आपका नंबर रिज़र्व हो रहा है', activate: 'आपका नंबर चालू हो रहा है', link: 'आउटगोइंग कॉल के लिए आपका नंबर जोड़ा जा रहा है', linkFax: 'फ़ैक्स भेजने के लिए आपका नंबर जोड़ा जा रहा है', team: 'हमारी टीम आख़िरी चरण पूरा कर रही है',
    soon: 'एक मिनट में फिर कोशिश', next: (m) => `लगभग ${m} मिनट में फिर कोशिश`, about: (m) => `लगभग ${m} मिनट में तैयार`, few: 'आमतौर पर कुछ मिनट', hours: 'आमतौर पर कुछ घंटों में',
    orderNote: (d) => `यह अपने आप पूरा होगा। ${d} तक तैयार न हो तो पैसे वापस।`, inWorks: 'इनकमिंग कॉल अभी से काम करती हैं।', inFax: 'फ़ैक्स पाना अभी से काम करता है।',
  },
}
const tr = (lang) => T[lang] || T.en
const when = (iso) => new Date(iso).toISOString().replace('T', ' ').slice(0, 16) + ' UTC'

// Words for a status in the customer's language.
function words(s, lang = 'en') {
  const t = tr(lang)
  const step = s.stage === 'order' ? t.order : s.stage === 'activate' ? t.activate : s.stage === 'team' ? t.team : s.fax ? t.linkFax : t.link
  const eta = s.stage === 'activate' ? t.few : s.stage === 'team' ? t.hours : s.nextTryMin === 0 ? t.soon : s.nextTryMin ? t.next(s.nextTryMin) : t.about(s.etaMin)
  const note = s.stage === 'order' ? t.orderNote(when(s.refundAt)) : s.stage === 'activate' ? '' : s.fax ? t.inFax : t.inWorks
  return { step, eta, note }
}

async function compute(db, n, fax) {
  const phone = e164(n.phoneNumber || n._id)
  if (n.status === 'provisioning') {
    const o = await db.collection('pendingNumberOrders').findOne({ phoneNumber: n.phoneNumber || n._id, status: 'waiting' })
    if (!o) return { stage: 'activate', fax }
    const nextTryMin = o.nextTryAt && new Date(o.nextTryAt) > new Date() ? minsUntil(o.nextTryAt) : 0
    return { stage: 'order', fax, nextTryMin, refundAt: new Date(new Date(o.createdAt).getTime() + ORDER_MAX_MS).toISOString() }
  }
  if (n.status !== 'active' || n.dryRun || !LINKED.includes(n.provider) || (!fax && n.capabilities?.voice === false)) return null
  const bird = require('./bird')
  if (!bird.enabled()) return null
  const v = await db.collection('birdCallerIdVerify').findOne({ _id: phone })
  if (v?.status === 'verified' || await bird.presentable(phone).catch(() => true)) return null
  if (v?.gaveUpAt || (v?.rounds || 0) >= LINK_ROUNDS) return { stage: 'team', fax }
  if (v?.status === 'calling' && v.expiresAt > new Date()) return { stage: 'link', fax, etaMin: minsUntil(v.expiresAt) }
  if (v?.armedAt) return { stage: 'link', fax, nextTryMin: minsUntil(new Date(new Date(v.armedAt).getTime() + LINK_RETRY_MS)) }
  return { stage: 'link', fax, etaMin: Math.round(LINK_RETRY_MS / 60000) + 2 }
}

// For the web app: English words included.
async function of(db, n, { fax = false } = {}) {
  if (!n) return null
  const s = await compute(db, n, fax).catch(() => null)
  return s && { ...s, ...words(s), callsIn: s.stage === 'link' || s.stage === 'team', callsOut: false }
}

// For the bot: one block listing every number of the account that is still setting up ('' when none).
async function botBlock(db, chatId, lang = 'en', only = null) {
  const id = String(chatId)
  const lines = ((await db.collection('phoneNumbersOf').findOne({ _id: id }))?.val?.numbers || []).filter(n => !/released|expired|cancel/i.test(String(n.status || '')))
  const faxes = await db.collection('faxNumbers').find({ chatId: id, status: { $in: ['active', 'provisioning'] } }).toArray()
  const out = []
  for (const [n, fax] of [...lines.map(n => [n, false]), ...faxes.map(n => [n, true])]) {
    const phone = n.phoneNumber || n._id
    if (only && phone !== only) continue
    const s = await compute(db, n, fax).catch(() => null)
    if (!s) continue
    const w = words(s, lang)
    out.push(`<b>${phone}</b>${fax ? ' 📠' : ''}\n    ${w.step} · <i>${w.eta}</i>${w.note ? `\n    <i>${w.note}</i>` : ''}`)
  }
  return out.length ? `\n${tr(lang).head}\n${out.join('\n')}\n` : ''
}

// Line for a "number is ready" message when outgoing calls still need the caller-ID link.
const linkNote = (order) => (['retell', 'infobip', 'multitel'].includes(order?._provider) || /^(rt|ib|mt):/.test(String(order?.id || ''))
  ? `\n\n⏳ <b>Setting up</b> · ${T.en.link} — ${T.en.about(Math.round(LINK_RETRY_MS / 60000) + 2)}. ${T.en.inWorks}` : '')

module.exports = { of, botBlock, words, linkNote }
