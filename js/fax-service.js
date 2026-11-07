'use strict'
// Fax (send + receive) on Business-plan Telnyx numbers, shared by every bot and the CloudIVR web app.
// Sending uses the brand's Telnyx Fax Application; receiving needs the number switched to "Fax line"
// (its connection moves to the Fax Application, so it stops taking voice calls until switched back).
// Billing: 50 free pages (sent + received) per number per plan month, then $2 a page from the wallet.
const axios = require('axios')
const crypto = require('crypto')
const FormData = require('form-data')
const { PDFDocument } = require('pdf-lib')
const { GridFSBucket, ObjectId } = require('mongodb')
const { getBalance, forceWalletDebit } = require('./utils')
const phoneConfig = require('./phone-config')
const notify = require('./cloudivr-web/notify')

const BASE = 'https://api.telnyx.com/v2'
const FREE_PAGES = 50
const PAGE_PRICE = 2
const MAX_PAGES = 50
const MAX_BYTES = 10 * 1024 * 1024
const E164 = /^\+[1-9]\d{7,14}$/
const brand = () => String(process.env.CHAT_BOT_BRAND || 'Nomadly').trim() || 'Nomadly'
const dryRun = () => process.env.WEB_CLOUDIVR_DRY_RUN === 'true'
const hdrs = () => ({ Authorization: `Bearer ${process.env.TELNYX_API_KEY}` })
const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const fmt = (p) => phoneConfig.formatPhone(p)

let _sweep = null, _db = null, _bot = null, _walletOf = null, _log = console.log, _ccApp = () => process.env.TELNYX_CALL_CONTROL_APP_ID, _appId = null
const col = (n) => _db.collection(n)
const bucket = () => new GridFSBucket(_db, { bucketName: 'faxFiles' })

class FaxError extends Error { constructor(code, message) { super(message); this.code = code } }

const TXT = {
  en: {
    btnFax: '📠 Fax', btnSend: '📤 Send a fax', btnLineOn: '📥 Fax line: ON — switch back to voice', btnLineOff: '📥 Turn on fax line (receive faxes)', btnRecent: '🗂 Recent faxes', btnConfirm: '✅ Send fax', btnCancel: '❌ Cancel',
    menu: (n, u, line) => `📠 <b>Fax</b> — ${fmt(n)}\n\n🆓 Free pages left this plan month: <b>${u.left}/${u.free}</b>\n💵 After that: <b>$${PAGE_PRICE}/page</b> (sent or received) from your wallet\n\n📥 Fax line: <b>${line ? 'ON' : 'OFF'}</b>\n${line ? '<i>This number is receiving faxes now and does not take voice calls.</i>' : '<i>Turn it on to receive faxes. While on, voice calls to this number stop.</i>'}`,
    askTo: '📤 Enter the fax number to send to, with country code (e.g. +14155550100):',
    badTo: (m) => `⚠️ ${m}`,
    askDoc: (to) => `📎 Now send the PDF or a photo to fax to <b>${fmt(to)}</b>.`,
    needDoc: '📎 Please send a PDF file or a photo.',
    quote: (to, q) => `📠 Ready to fax <b>${q.pages}</b> page${q.pages === 1 ? '' : 's'} to <b>${fmt(to)}</b>.\n\n🆓 Free: ${q.freePages} · 💵 Paid: ${q.paidPages} × $${PAGE_PRICE} = <b>$${q.cost.toFixed(2)}</b>\n<i>You're only charged once the fax is delivered.</i>`,
    queued: (to) => `📤 Fax to ${fmt(to)} is on its way. You'll get a message when it's delivered.`,
    delivered: (to, pages, cost) => `✅ <b>Fax delivered</b> to ${fmt(to)} — ${pages} page${pages === 1 ? '' : 's'}${cost > 0 ? ` · $${cost.toFixed(2)} charged` : ' · free'}`,
    failed: (to, why) => `❌ <b>Fax to ${fmt(to)} failed</b>${why ? `\nReason: ${esc(why)}` : ''}\nNo charge.`,
    received: (from, to, pages, cost) => `📠 <b>Fax received</b>\nFrom: ${fmt(from)}\nTo: ${fmt(to)}\nPages: ${pages}${cost > 0 ? ` · $${cost.toFixed(2)} charged` : ' · free'}`,
    lineOn: (n) => `📥 Fax line is ON for ${fmt(n)}. Faxes sent to it arrive here as PDF. Voice calls to it are paused.`,
    lineOff: (n) => `📞 ${fmt(n)} is back on voice. It no longer receives faxes.`,
    none: '🗂 No faxes yet.',
    cancelled: '❌ Fax cancelled.',
    btnBulk: '📤 Bulk fax (up to 500 numbers)',
    askBulk: '📤 <b>Bulk fax</b>\n\nPaste up to 500 fax numbers (one per line, with country code) or send a .csv / .txt file with the numbers.',
    bulkList: (n, bad) => `✅ ${n} fax number${n === 1 ? '' : 's'} added${bad ? ` · ${bad} skipped (not valid)` : ''}.`,
    bulkQuote: (q) => `📠 Ready to fax <b>${q.pagesEach}</b> page${q.pagesEach === 1 ? '' : 's'} to <b>${q.recipients}</b> numbers (${q.pages} pages total).\n\n🆓 Free: ${q.freePages} · 💵 Paid: ${q.paidPages} × $${PAGE_PRICE} = <b>$${q.cost.toFixed(2)}</b>\n<i>Free pages are used first. Failed faxes are not charged.</i>`,
    bulkStarted: (n) => `📤 Bulk fax started to ${n} numbers. You'll get one summary when it's done.`,
    bulkDone: (b) => `📠 <b>Bulk fax ${b.status === 'cancelled' ? 'stopped' : 'finished'}</b> — ${fmt(b.phoneNumber)}\n✅ Delivered: ${b.delivered}\n❌ Failed: ${b.failed + b.startFailed}${b.status === 'cancelled' ? `\n⏹ Not sent: ${b.total - b.cursor}` : ''}\n💵 Charged: $${Number(b.cost || 0).toFixed(2)}`,
  },
  fr: {
    btnFax: '📠 Fax', btnSend: '📤 Envoyer un fax', btnLineOn: '📥 Ligne fax : OUI — revenir à la voix', btnLineOff: '📥 Activer la ligne fax (recevoir)', btnRecent: '🗂 Fax récents', btnConfirm: '✅ Envoyer le fax', btnCancel: '❌ Annuler',
    menu: (n, u, line) => `📠 <b>Fax</b> — ${fmt(n)}\n\n🆓 Pages gratuites restantes ce mois du forfait : <b>${u.left}/${u.free}</b>\n💵 Ensuite : <b>${PAGE_PRICE} $/page</b> (envoyée ou reçue) depuis votre portefeuille\n\n📥 Ligne fax : <b>${line ? 'OUI' : 'NON'}</b>\n${line ? '<i>Ce numéro reçoit les fax et ne prend plus les appels vocaux.</i>' : '<i>Activez-la pour recevoir des fax. Les appels vocaux sont alors suspendus.</i>'}`,
    askTo: '📤 Entrez le numéro de fax avec l’indicatif pays (ex. +14155550100) :',
    badTo: (m) => `⚠️ ${m}`,
    askDoc: (to) => `📎 Envoyez maintenant le PDF ou une photo à faxer vers <b>${fmt(to)}</b>.`,
    needDoc: '📎 Envoyez un fichier PDF ou une photo.',
    quote: (to, q) => `📠 Prêt à faxer <b>${q.pages}</b> page(s) vers <b>${fmt(to)}</b>.\n\n🆓 Gratuites : ${q.freePages} · 💵 Payantes : ${q.paidPages} × ${PAGE_PRICE} $ = <b>${q.cost.toFixed(2)} $</b>\n<i>Débit uniquement après la livraison du fax.</i>`,
    queued: (to) => `📤 Le fax vers ${fmt(to)} est en route. Vous serez prévenu à la livraison.`,
    delivered: (to, pages, cost) => `✅ <b>Fax livré</b> à ${fmt(to)} — ${pages} page(s)${cost > 0 ? ` · ${cost.toFixed(2)} $ débités` : ' · gratuit'}`,
    failed: (to, why) => `❌ <b>Échec du fax vers ${fmt(to)}</b>${why ? `\nRaison : ${esc(why)}` : ''}\nAucun débit.`,
    received: (from, to, pages, cost) => `📠 <b>Fax reçu</b>\nDe : ${fmt(from)}\nÀ : ${fmt(to)}\nPages : ${pages}${cost > 0 ? ` · ${cost.toFixed(2)} $ débités` : ' · gratuit'}`,
    lineOn: (n) => `📥 Ligne fax activée pour ${fmt(n)}. Les fax arrivent ici en PDF. Appels vocaux suspendus.`,
    lineOff: (n) => `📞 ${fmt(n)} est revenu en mode voix. Il ne reçoit plus de fax.`,
    none: '🗂 Aucun fax pour l’instant.',
    cancelled: '❌ Fax annulé.',
    btnBulk: '📤 Fax groupé (jusqu’à 500 numéros)',
    askBulk: '📤 <b>Fax groupé</b>\n\nCollez jusqu’à 500 numéros de fax (un par ligne, avec indicatif) ou envoyez un fichier .csv / .txt.',
    bulkList: (n, bad) => `✅ ${n} numéro(s) ajouté(s)${bad ? ` · ${bad} ignoré(s) (invalides)` : ''}.`,
    bulkQuote: (q) => `📠 Prêt à faxer <b>${q.pagesEach}</b> page(s) vers <b>${q.recipients}</b> numéros (${q.pages} pages au total).\n\n🆓 Gratuites : ${q.freePages} · 💵 Payantes : ${q.paidPages} × ${PAGE_PRICE} $ = <b>${q.cost.toFixed(2)} $</b>\n<i>Les pages gratuites passent en premier. Les fax échoués ne sont pas facturés.</i>`,
    bulkStarted: (n) => `📤 Fax groupé lancé vers ${n} numéros. Un résumé suivra à la fin.`,
    bulkDone: (b) => `📠 <b>Fax groupé ${b.status === 'cancelled' ? 'arrêté' : 'terminé'}</b> — ${fmt(b.phoneNumber)}\n✅ Livrés : ${b.delivered}\n❌ Échecs : ${b.failed + b.startFailed}${b.status === 'cancelled' ? `\n⏹ Non envoyés : ${b.total - b.cursor}` : ''}\n💵 Débité : ${Number(b.cost || 0).toFixed(2)} $`,
  },
  zh: {
    btnFax: '📠 传真', btnSend: '📤 发送传真', btnLineOn: '📥 传真线路：开 — 切回语音', btnLineOff: '📥 开启传真线路（接收传真）', btnRecent: '🗂 最近传真', btnConfirm: '✅ 发送传真', btnCancel: '❌ 取消',
    menu: (n, u, line) => `📠 <b>传真</b> — ${fmt(n)}\n\n🆓 本套餐月剩余免费页数：<b>${u.left}/${u.free}</b>\n💵 超出后：每页 <b>$${PAGE_PRICE}</b>（发送或接收），从钱包扣除\n\n📥 传真线路：<b>${line ? '开' : '关'}</b>\n${line ? '<i>此号码正在接收传真，暂停语音来电。</i>' : '<i>开启后可接收传真，期间语音来电暂停。</i>'}`,
    askTo: '📤 请输入带国家代码的传真号码（如 +14155550100）：',
    badTo: (m) => `⚠️ ${m}`,
    askDoc: (to) => `📎 请发送要传真到 <b>${fmt(to)}</b> 的 PDF 或照片。`,
    needDoc: '📎 请发送 PDF 文件或照片。',
    quote: (to, q) => `📠 准备向 <b>${fmt(to)}</b> 发送 <b>${q.pages}</b> 页。\n\n🆓 免费：${q.freePages} · 💵 付费：${q.paidPages} × $${PAGE_PRICE} = <b>$${q.cost.toFixed(2)}</b>\n<i>传真送达后才扣费。</i>`,
    queued: (to) => `📤 发往 ${fmt(to)} 的传真已发出，送达后会通知您。`,
    delivered: (to, pages, cost) => `✅ <b>传真已送达</b> ${fmt(to)} — ${pages} 页${cost > 0 ? ` · 扣费 $${cost.toFixed(2)}` : ' · 免费'}`,
    failed: (to, why) => `❌ <b>发往 ${fmt(to)} 的传真失败</b>${why ? `\n原因：${esc(why)}` : ''}\n未扣费。`,
    received: (from, to, pages, cost) => `📠 <b>收到传真</b>\n发件人：${fmt(from)}\n收件人：${fmt(to)}\n页数：${pages}${cost > 0 ? ` · 扣费 $${cost.toFixed(2)}` : ' · 免费'}`,
    lineOn: (n) => `📥 ${fmt(n)} 传真线路已开启，传真将以 PDF 发到这里，语音来电暂停。`,
    lineOff: (n) => `📞 ${fmt(n)} 已切回语音，不再接收传真。`,
    none: '🗂 暂无传真。',
    cancelled: '❌ 已取消传真。',
    btnBulk: '📤 群发传真（最多 500 个号码）',
    askBulk: '📤 <b>群发传真</b>\n\n粘贴最多 500 个传真号码（每行一个，带国家代码），或发送包含号码的 .csv / .txt 文件。',
    bulkList: (n, bad) => `✅ 已添加 ${n} 个号码${bad ? ` · 跳过 ${bad} 个无效号码` : ''}。`,
    bulkQuote: (q) => `📠 准备向 <b>${q.recipients}</b> 个号码各发送 <b>${q.pagesEach}</b> 页（共 ${q.pages} 页）。\n\n🆓 免费：${q.freePages} · 💵 付费：${q.paidPages} × $${PAGE_PRICE} = <b>$${q.cost.toFixed(2)}</b>\n<i>优先使用免费页数，失败的传真不收费。</i>`,
    bulkStarted: (n) => `📤 已开始向 ${n} 个号码群发传真，完成后会发送汇总。`,
    bulkDone: (b) => `📠 <b>群发传真${b.status === 'cancelled' ? '已停止' : '已完成'}</b> — ${fmt(b.phoneNumber)}\n✅ 送达：${b.delivered}\n❌ 失败：${b.failed + b.startFailed}${b.status === 'cancelled' ? `\n⏹ 未发送：${b.total - b.cursor}` : ''}\n💵 扣费：$${Number(b.cost || 0).toFixed(2)}`,
  },
  hi: {
    btnFax: '📠 फैक्स', btnSend: '📤 फैक्स भेजें', btnLineOn: '📥 फैक्स लाइन: चालू — वॉइस पर लौटें', btnLineOff: '📥 फैक्स लाइन चालू करें (फैक्स पाएँ)', btnRecent: '🗂 हाल के फैक्स', btnConfirm: '✅ फैक्स भेजें', btnCancel: '❌ रद्द करें',
    menu: (n, u, line) => `📠 <b>फैक्स</b> — ${fmt(n)}\n\n🆓 इस प्लान माह बचे मुफ़्त पेज: <b>${u.left}/${u.free}</b>\n💵 उसके बाद: <b>$${PAGE_PRICE}/पेज</b> (भेजा या पाया) वॉलेट से\n\n📥 फैक्स लाइन: <b>${line ? 'चालू' : 'बंद'}</b>\n${line ? '<i>यह नंबर अभी फैक्स पा रहा है, वॉइस कॉल रुकी हैं।</i>' : '<i>फैक्स पाने के लिए चालू करें। चालू रहने तक वॉइस कॉल रुकेंगी।</i>'}`,
    askTo: '📤 देश कोड के साथ फैक्स नंबर दर्ज करें (जैसे +14155550100):',
    badTo: (m) => `⚠️ ${m}`,
    askDoc: (to) => `📎 अब <b>${fmt(to)}</b> पर भेजने के लिए PDF या फ़ोटो भेजें।`,
    needDoc: '📎 कृपया PDF फ़ाइल या फ़ोटो भेजें।',
    quote: (to, q) => `📠 <b>${fmt(to)}</b> पर <b>${q.pages}</b> पेज भेजने के लिए तैयार।\n\n🆓 मुफ़्त: ${q.freePages} · 💵 सशुल्क: ${q.paidPages} × $${PAGE_PRICE} = <b>$${q.cost.toFixed(2)}</b>\n<i>फैक्स पहुँचने के बाद ही शुल्क लगेगा।</i>`,
    queued: (to) => `📤 ${fmt(to)} पर फैक्स भेजा जा रहा है। पहुँचने पर सूचना मिलेगी।`,
    delivered: (to, pages, cost) => `✅ <b>फैक्स पहुँचा</b> ${fmt(to)} — ${pages} पेज${cost > 0 ? ` · $${cost.toFixed(2)} शुल्क` : ' · मुफ़्त'}`,
    failed: (to, why) => `❌ <b>${fmt(to)} पर फैक्स विफल</b>${why ? `\nकारण: ${esc(why)}` : ''}\nकोई शुल्क नहीं।`,
    received: (from, to, pages, cost) => `📠 <b>फैक्स प्राप्त</b>\nप्रेषक: ${fmt(from)}\nप्राप्तकर्ता: ${fmt(to)}\nपेज: ${pages}${cost > 0 ? ` · $${cost.toFixed(2)} शुल्क` : ' · मुफ़्त'}`,
    lineOn: (n) => `📥 ${fmt(n)} की फैक्स लाइन चालू। फैक्स यहाँ PDF में आएँगे। वॉइस कॉल रुकी हैं।`,
    lineOff: (n) => `📞 ${fmt(n)} वापस वॉइस पर है। अब फैक्स नहीं आएँगे।`,
    none: '🗂 अभी कोई फैक्स नहीं।',
    cancelled: '❌ फैक्स रद्द।',
    btnBulk: '📤 बल्क फैक्स (500 नंबर तक)',
    askBulk: '📤 <b>बल्क फैक्स</b>\n\n500 तक फैक्स नंबर पेस्ट करें (हर लाइन में एक, देश कोड सहित) या नंबरों वाली .csv / .txt फ़ाइल भेजें।',
    bulkList: (n, bad) => `✅ ${n} नंबर जोड़े गए${bad ? ` · ${bad} छोड़े (अमान्य)` : ''}।`,
    bulkQuote: (q) => `📠 <b>${q.recipients}</b> नंबरों पर <b>${q.pagesEach}</b> पेज भेजने के लिए तैयार (कुल ${q.pages} पेज)।\n\n🆓 मुफ़्त: ${q.freePages} · 💵 सशुल्क: ${q.paidPages} × $${PAGE_PRICE} = <b>$${q.cost.toFixed(2)}</b>\n<i>पहले मुफ़्त पेज लगेंगे। विफल फैक्स का शुल्क नहीं।</i>`,
    bulkStarted: (n) => `📤 ${n} नंबरों पर बल्क फैक्स शुरू। पूरा होने पर सारांश मिलेगा।`,
    bulkDone: (b) => `📠 <b>बल्क फैक्स ${b.status === 'cancelled' ? 'रोका गया' : 'पूरा'}</b> — ${fmt(b.phoneNumber)}\n✅ पहुँचे: ${b.delivered}\n❌ विफल: ${b.failed + b.startFailed}${b.status === 'cancelled' ? `\n⏹ नहीं भेजे: ${b.total - b.cursor}` : ''}\n💵 शुल्क: $${Number(b.cost || 0).toFixed(2)}`,
  },
}
const t = (lang) => TXT[lang] || TXT.en

function init({ db, bot, walletOf, log, callControlAppId }) {
  _db = db; if (bot) _bot = bot; _walletOf = walletOf || db.collection('walletOf')
  if (log) _log = log
  if (callControlAppId) _ccApp = callControlAppId
  if (!_sweep) {
    const run = () => resumeBatches().catch(e => _log(`[Fax] resume bulk failed: ${e.message}`))
    setTimeout(run, 15000).unref?.()
    _sweep = setInterval(run, 2 * 60000)
    _sweep.unref?.()
  }
}

const eligible = (num) => !!num && phoneConfig.canAccessFeature(num.plan, 'fax') && (num.provider || 'telnyx') === 'telnyx' && num.status === 'active'
const lineOn = (num) => num?.features?.faxLine?.enabled === true

// ── Fax Application (one per brand, found by name; production creates it and keeps its webhook on SELF_URL) ──
async function ensureApp({ create = process.env.SKIP_WEBHOOK_SYNC !== 'true' } = {}) {
  if (_appId) return _appId
  const name = `${brand()} Fax`
  const saved = await col('faxConfig').findOne({ _id: name })
  if (saved?.appId) return (_appId = saved.appId)
  if (dryRun()) return null
  const list = await axios.get(`${BASE}/fax_applications`, { headers: hdrs(), params: { 'filter[application_name][contains]': name, 'page[size]': 50 } })
  let app = (list.data?.data || []).find(a => a.application_name === name)
  const webhook = `${process.env.SELF_URL}/telnyx/fax-webhook`
  if (!app && create) {
    const profiles = await axios.get(`${BASE}/outbound_voice_profiles`, { headers: hdrs() }).catch(() => null)
    const ovp = (profiles?.data?.data || []).find(p => p.enabled)
    const r = await axios.post(`${BASE}/fax_applications`, { application_name: name, webhook_event_url: webhook, active: true, ...(ovp ? { outbound: { outbound_voice_profile_id: ovp.id } } : {}) }, { headers: hdrs() })
    app = r.data?.data
    _log(`[Fax] Created Telnyx Fax Application ${app?.id} (${name}) → ${webhook}`)
  } else if (app && create && app.webhook_event_url !== webhook) {
    await axios.patch(`${BASE}/fax_applications/${app.id}`, { webhook_event_url: webhook }, { headers: hdrs() })
    _log(`[Fax] Fax Application webhook → ${webhook}`)
  }
  if (!app?.id) return null
  await col('faxConfig').updateOne({ _id: name }, { $set: { appId: app.id, updatedAt: new Date() } }, { upsert: true })
  return (_appId = app.id)
}

// ── Owner lookup + number record update ──
async function findOwner(phone) {
  const doc = await col('phoneNumbersOf').findOne({ 'val.numbers': { $elemMatch: { phoneNumber: phone, status: { $ne: 'released' } } } })
  const num = (doc?.val?.numbers || []).find(n => n.phoneNumber === phone && n.status !== 'released')
  return num ? { chatId: String(doc._id), num } : null
}
async function findMine(chatId, phone) {
  const doc = await col('phoneNumbersOf').findOne({ _id: chatId })
  return (doc?.val?.numbers || []).find(n => n.phoneNumber === phone && n.status !== 'released') || null
}

// ── Free-page allowance: 50 pages per number per plan month (the month ending at expiresAt) ──
const usageKey = (num) => `${num.phoneNumber}|${String(num.expiresAt || new Date().toISOString().slice(0, 7)).slice(0, 10)}`
async function usage(num) {
  const d = await col('faxUsage').findOne({ _id: usageKey(num) })
  const used = d?.pages || 0
  return { used, free: FREE_PAGES, left: Math.max(0, FREE_PAGES - used), pagePrice: PAGE_PRICE, resetsOn: num.expiresAt || null }
}
// Pages already sent/queued but not yet delivered (incl. unsent bulk recipients) — they will use the allowance first.
async function pendingPages(num) {
  const [a] = await col('faxes').aggregate([{ $match: { phoneNumber: num.phoneNumber, direction: 'outbound', settled: { $ne: true }, status: { $ne: 'failed' } } }, { $group: { _id: null, p: { $sum: '$pages' } } }]).toArray()
  const bs = await col('faxBatches').find({ phoneNumber: num.phoneNumber, status: 'running' }, { projection: { cursor: 1, total: 1, pages: 1 } }).toArray()
  return (a?.p || 0) + bs.reduce((s, b) => s + Math.max(0, b.total - b.cursor) * b.pages, 0)
}
async function quote(num, pages) {
  const { left } = await usage(num)
  const pending = await pendingPages(num)
  const freePages = Math.min(pages, Math.max(0, left - pending))
  const paidPages = pages - freePages
  return { pages, freePages, paidPages, cost: paidPages * PAGE_PRICE, pendingCost: Math.max(0, pending - left) * PAGE_PRICE }
}
async function consume(num, pages) {
  const after = await col('faxUsage').findOneAndUpdate({ _id: usageKey(num) }, { $inc: { pages }, $setOnInsert: { phoneNumber: num.phoneNumber, createdAt: new Date() } }, { upsert: true, returnDocument: 'after', includeResultMetadata: false })
  const before = (after?.pages || pages) - pages
  const freePages = Math.max(0, Math.min(pages, FREE_PAGES - before))
  return { freePages, paidPages: pages - freePages, cost: (pages - freePages) * PAGE_PRICE }
}

// Charges a fax exactly once (webhook retries are no-ops) → { freePages, paidPages, cost }.
async function settle(fax, num, pages) {
  const claimed = await col('faxes').findOneAndUpdate({ _id: fax._id, settled: { $ne: true } }, { $set: { settled: true } }, { includeResultMetadata: false })
  if (!claimed) return { freePages: fax.freePages || 0, paidPages: fax.paidPages || 0, cost: fax.cost || 0 }
  const q = await consume(num, pages)
  if (q.cost > 0) {
    await forceWalletDebit(_walletOf, fax.chatId, q.cost, {
      type: 'fax', callType: fax.direction === 'inbound' ? 'Fax_Received' : 'Fax_Sent', callRef: `fax:${fax._id}`,
      description: `Fax ${fax.direction === 'inbound' ? 'received from' : 'sent to'} ${fax.direction === 'inbound' ? fax.from : fax.to} — ${q.paidPages} paid page(s) × $${PAGE_PRICE}`,
      destination: fax.direction === 'inbound' ? fax.from : fax.to, phoneNumber: num.phoneNumber,
    })
  }
  await col('faxes').updateOne({ _id: fax._id }, { $set: { pages, ...q, settledAt: new Date() } })
  return q
}

// ── Documents: PDF as-is, JPG/PNG photo → one letter-size page ──
async function toPdf(buf) {
  if (!buf?.length) throw new FaxError('empty', 'The file is empty.')
  if (buf.length > MAX_BYTES) throw new FaxError('too_big', 'Files must be under 10 MB.')
  if (buf.slice(0, 4).toString() === '%PDF') {
    let doc
    try { doc = await PDFDocument.load(buf, { ignoreEncryption: true }) } catch (_) { throw new FaxError('bad_file', 'That PDF could not be read. Try saving it again or send a photo.') }
    const pages = doc.getPageCount()
    if (pages > MAX_PAGES) throw new FaxError('too_many_pages', `Faxes can have up to ${MAX_PAGES} pages.`)
    return { pdf: buf, pages }
  }
  const png = buf[0] === 0x89 && buf.slice(1, 4).toString() === 'PNG'
  const jpg = buf[0] === 0xff && buf[1] === 0xd8
  if (!png && !jpg) throw new FaxError('bad_type', 'Send a PDF, JPG or PNG file.')
  const doc = await PDFDocument.create()
  const img = png ? await doc.embedPng(buf) : await doc.embedJpg(buf)
  const W = 612, H = 792, M = 24
  const s = Math.min((W - 2 * M) / img.width, (H - 2 * M) / img.height)
  doc.addPage([W, H]).drawImage(img, { x: (W - img.width * s) / 2, y: (H - img.height * s) / 2, width: img.width * s, height: img.height * s })
  return { pdf: Buffer.from(await doc.save()), pages: 1 }
}

function saveFile(buf, meta) {
  return new Promise((resolve, reject) => {
    const up = bucket().openUploadStream(meta.filename || 'fax.pdf', { contentType: 'application/pdf', metadata: meta })
    up.on('error', reject).on('finish', () => resolve(up.id))
    up.end(buf)
  })
}
async function readFile(fileId) {
  const chunks = []
  for await (const c of bucket().openDownloadStream(new ObjectId(String(fileId)))) chunks.push(c)
  return Buffer.concat(chunks)
}

// Uploads never sent within a day are removed with their file.
async function sweepStages() {
  const old = await col('faxStaged').find({ createdAt: { $lt: new Date(Date.now() - 86400000) } }).limit(100).toArray()
  for (const st of old) {
    await bucket().delete(new ObjectId(String(st.fileId))).catch(() => {})
    await col('faxStaged').deleteOne({ _id: st._id })
  }
}

// Step 1 (bot + web): store the document and price it → { stageId, pages, quote }.
async function stage({ chatId, num, buffer }) {
  if (!eligible(num)) throw new FaxError('plan_upgrade_required', 'Fax is on the Business plan. Upgrade this number to use it.')
  const { pdf, pages } = await toPdf(buffer)
  sweepStages().catch(() => {})
  const fileId = await saveFile(pdf, { chatId, kind: 'staged' })
  const stageId = crypto.randomUUID()
  await col('faxStaged').insertOne({ _id: stageId, chatId, phoneNumber: num.phoneNumber, fileId, pages, createdAt: new Date() })
  return { stageId, pages, quote: await quote(num, pages) }
}

function checkTo(to, from) {
  const n = require('./backup-numbers').norm(String(to || '').trim())
  if (!n || !E164.test(n)) return { error: 'Use the full fax number with country code, e.g. +14155550100.' }
  if (n === from) return { error: 'You can’t fax your own number.' }
  const issue = require('./dial-check').dialIssue(n)
  if (issue) return { error: issue }
  if (phoneConfig.isBlockedPrefix(n)) return { error: `${n} is a blocked premium/satellite destination.` }
  return { to: n }
}

const planErr = () => new FaxError('plan_upgrade_required', 'Fax is on the Business plan. Upgrade this number to use it.')
const getStage = async (chatId, num, stageId) => {
  const st = await col('faxStaged').findOne({ _id: String(stageId || ''), chatId, phoneNumber: num.phoneNumber })
  if (!st) throw new FaxError('expired', 'That upload expired. Please upload the document again.')
  return st
}
// Wallet must cover the paid pages of this send plus paid pages still waiting on earlier sends.
async function coverCost(chatId, q) {
  const need = q.cost + (q.pendingCost || 0)
  if (need <= 0) return
  const { usdBal } = await getBalance(_walletOf, chatId)
  if ((usdBal || 0) < need) throw new FaxError('insufficient_balance', `This fax needs $${need.toFixed(2)} for paid pages${q.pendingCost ? ' (including faxes still sending)' : ''}. Your wallet has $${Number(usdBal || 0).toFixed(2)} — top up and try again.`)
}
const claimStage = async (st) => {
  if (!(await col('faxStaged').findOneAndDelete({ _id: st._id }, { includeResultMetadata: false }))) throw new FaxError('expired', 'That upload expired. Please upload the document again.')
}

// Sends one fax through Telnyx (or simulates it in preview) → fax record.
async function dispatch({ chatId, num, fileId, pages, to, batchId = null }) {
  let faxId
  if (dryRun()) faxId = `dry_${crypto.randomUUID()}`
  else {
    const appId = await ensureApp()
    if (!appId) throw new FaxError('unavailable', 'Fax is not available right now. Please try again later.')
    const form = new FormData()
    form.append('connection_id', appId)
    form.append('from', num.phoneNumber)
    form.append('to', to)
    form.append('contents', await readFile(fileId), { filename: 'fax.pdf', contentType: 'application/pdf' })
    try {
      const r = await axios.post(`${BASE}/faxes`, form, { headers: { ...hdrs(), ...form.getHeaders() }, maxBodyLength: Infinity, timeout: 60000 })
      faxId = r.data?.data?.id
    } catch (e) {
      _log(`[Fax] send ${num.phoneNumber} → ${to} failed: ${e.response?.data?.errors?.[0]?.detail || e.message}`)
      throw new FaxError('send_failed', 'The fax could not be sent. Check the number and try again.')
    }
  }
  const fax = { _id: faxId, chatId, phoneNumber: num.phoneNumber, direction: 'outbound', from: num.phoneNumber, to, pages, status: 'queued', fileId, ...(batchId ? { batchId } : {}), createdAt: new Date() }
  await col('faxes').insertOne(fax)
  _log(`[Fax] queued ${faxId}: ${num.phoneNumber} → ${to} (${pages} page(s), chatId=${chatId}${batchId ? `, batch=${batchId}` : ''})`)
  if (dryRun()) setTimeout(() => handleEvent({ event_type: 'fax.delivered', payload: { fax_id: faxId, page_count: pages, to, from: num.phoneNumber } }).catch(() => {}), 3000).unref?.()
  return fax
}

// Step 2: send a staged document to one number. Paid pages are charged on delivery.
async function sendStaged({ chatId, num, stageId, to }) {
  if (!eligible(num)) throw planErr()
  const chk = checkTo(to, num.phoneNumber)
  if (chk.error) throw new FaxError('bad_number', chk.error)
  const st = await getStage(chatId, num, stageId)
  await coverCost(chatId, await quote(num, st.pages))
  await claimStage(st)
  try { return publicFax(await dispatch({ chatId, num, fileId: st.fileId, pages: st.pages, to: chk.to })) } catch (e) {
    await col('faxStaged').insertOne(st).catch(() => {})
    throw e
  }
}

// ── Bulk: one document to up to 500 numbers (pasted list or CSV/TXT), sent one by one in the background ──
const BULK_MAX = 500
const gap = () => (dryRun() ? 100 : 1500)
function parseRecipients(text, from) {
  const list = [], invalid = [], seen = new Set()
  for (const raw of String(text || '').split(/[\r\n,;\t|]+|\s+(?=\+)/)) {
    const tk = raw.replace(/["']/g, '').trim()
    if (!tk || !/\d{3}/.test(tk)) continue
    const c = checkTo(tk, from)
    if (c.error) { invalid.push(tk.slice(0, 30)); continue }
    if (!seen.has(c.to)) { seen.add(c.to); list.push(c.to) }
  }
  return { list, invalid }
}
async function bulkQuote({ chatId, num, stageId, recipients }) {
  if (!eligible(num)) throw planErr()
  const { list, invalid } = parseRecipients(recipients, num.phoneNumber)
  if (!list.length) throw new FaxError('no_recipients', 'Add at least one valid fax number with country code, e.g. +14155550100.')
  if (list.length > BULK_MAX) throw new FaxError('too_many', `Bulk fax goes to up to ${BULK_MAX} numbers at a time — you added ${list.length}.`)
  const st = await getStage(chatId, num, stageId)
  return { st, list, invalid, quote: { ...(await quote(num, st.pages * list.length)), recipients: list.length, pagesEach: st.pages } }
}
async function sendBulk({ chatId, num, stageId, recipients }) {
  const { st, list, invalid, quote: q } = await bulkQuote({ chatId, num, stageId, recipients })
  await coverCost(chatId, q)
  await claimStage(st)
  const batch = { _id: crypto.randomUUID(), chatId, phoneNumber: num.phoneNumber, fileId: st.fileId, pages: st.pages, recipients: list, total: list.length, cursor: 0, started: 0, startFailed: 0, delivered: 0, failed: 0, status: 'running', createdAt: new Date() }
  await col('faxBatches').insertOne(batch)
  _log(`[Fax] bulk ${batch._id}: ${num.phoneNumber} → ${list.length} numbers × ${st.pages} page(s) (chatId=${chatId})`)
  runBatch(batch._id)
  return { batch: publicBatch(batch), invalid, quote: q }
}
const _running = new Set()
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
// Claims recipients one at a time ($inc cursor), so two app slots running the same batch never double-send.
async function runBatch(id) {
  if (_running.has(id)) return
  _running.add(id)
  try {
    for (;;) {
      const b = await col('faxBatches').findOneAndUpdate({ _id: id, status: 'running', $expr: { $lt: ['$cursor', '$total'] } }, { $inc: { cursor: 1 }, $set: { updatedAt: new Date() } }, { returnDocument: 'after', includeResultMetadata: false })
      if (!b) break
      const to = b.recipients[b.cursor - 1]
      const num = (await findMine(b.chatId, b.phoneNumber)) || { phoneNumber: b.phoneNumber }
      try {
        await dispatch({ chatId: b.chatId, num, fileId: b.fileId, pages: b.pages, to, batchId: id })
        await col('faxBatches').updateOne({ _id: id }, { $inc: { started: 1 } })
      } catch (e) {
        await col('faxBatches').updateOne({ _id: id }, { $inc: { startFailed: 1 }, $push: { errors: { $each: [{ to, error: e.message }], $slice: -50 } } })
      }
      await sleep(gap())
    }
    await finishBatch(id)
  } catch (e) { _log(`[Fax] bulk ${id} worker error: ${e.message}`) } finally { _running.delete(id) }
}
async function finishBatch(id) {
  const b = await col('faxBatches').findOne({ _id: id })
  if (!b || b.summarySent) return
  const dispatched = b.status === 'cancelled' ? b.cursor : b.total
  if (b.started + b.startFailed < dispatched || b.delivered + b.failed < b.started) return
  const done = await col('faxBatches').findOneAndUpdate({ _id: id, summarySent: { $ne: true } }, { $set: { summarySent: true, status: b.status === 'cancelled' ? 'cancelled' : 'done', finishedAt: new Date() } }, { returnDocument: 'after', includeResultMetadata: false })
  if (!done) return
  const [c] = await col('faxes').aggregate([{ $match: { batchId: id } }, { $group: { _id: null, cost: { $sum: { $ifNull: ['$cost', 0] } } } }]).toArray()
  await tell(b.chatId, t(await langOf(b.chatId)).bulkDone({ ...done, cost: c?.cost || 0 }), { batchId: id })
}
async function cancelBatch(chatId, id) {
  if (!(await col('faxBatches').findOne({ _id: String(id), chatId }, { projection: { _id: 1 } }))) throw new FaxError('not_found', 'Bulk fax not found.')
  const r = await col('faxBatches').findOneAndUpdate({ _id: String(id), chatId, status: 'running' }, { $set: { status: 'cancelled' } }, { returnDocument: 'after', includeResultMetadata: false })
  if (!r) throw new FaxError('not_running', 'This bulk fax has already finished.')
  setTimeout(() => finishBatch(r._id).catch(() => {}), 2000).unref?.()
  return publicBatch(r)
}
// Runs at boot and every 2 min: a recipient claimed but never recorded (process died mid-send) counts as failed once the
// batch has been idle 2 min, then the rest resumes and finished batches get their summary.
async function resumeBatches() {
  const idle = new Date(Date.now() - 2 * 60000)
  if (dryRun()) {
    for (const f of await col('faxes').find({ batchId: { $exists: true }, status: 'queued', createdAt: { $lt: idle } }).limit(500).toArray()) {
      await handleEvent({ event_type: 'fax.delivered', payload: { fax_id: f._id, page_count: f.pages } }).catch(() => {})
    }
  }
  for (const b of await col('faxBatches').find({ status: { $in: ['running', 'cancelled'] }, summarySent: { $ne: true } }, { projection: { recipients: 0 } }).toArray()) {
    if (!b.updatedAt || b.updatedAt < idle) {
      const started = await col('faxes').countDocuments({ batchId: b._id })
      const lost = Math.max(0, b.cursor - started - b.startFailed)
      if (lost || started !== b.started) await col('faxBatches').updateOne({ _id: b._id }, { $set: { started }, $inc: { startFailed: lost } })
    }
    if (b.status === 'running') runBatch(b._id)
    else finishBatch(b._id).catch(() => {})
  }
}
const publicBatch = (b) => ({ id: b._id, phoneNumber: b.phoneNumber, pages: b.pages, total: b.total, sent: b.started, startFailed: b.startFailed, delivered: b.delivered, failed: b.failed, status: b.status, createdAt: b.createdAt })
async function listBatches(chatId, limit = 20) {
  return (await col('faxBatches').find({ chatId }, { projection: { recipients: 0 } }).sort({ createdAt: -1 }).limit(limit).toArray()).map(publicBatch)
}

// ── Fax line: move the number's connection to the Fax Application (receive) or back to voice ──
async function setLine({ chatId, num, enabled }) {
  if (!eligible(num)) throw new FaxError('plan_upgrade_required', 'Fax is on the Business plan. Upgrade this number to use it.')
  if (!dryRun()) {
    const target = enabled ? await ensureApp() : _ccApp()
    if (!target) throw new FaxError('unavailable', 'Fax is not available right now. Please try again later.')
    const found = (await axios.get(`${BASE}/phone_numbers`, { headers: hdrs(), params: { 'filter[phone_number]': num.phoneNumber, 'page[size]': 1 } })).data?.data?.[0]
    if (!found) throw new FaxError('unavailable', 'This number could not be switched right now. Please message support.')
    if (found.connection_id !== target) await axios.patch(`${BASE}/phone_numbers/${found.id}`, { connection_id: target }, { headers: hdrs() })
  }
  const faxLine = { enabled: !!enabled, at: new Date().toISOString() }
  await col('phoneNumbersOf').updateOne({ _id: chatId }, { $set: { 'val.numbers.$[n].features.faxLine': faxLine } }, { arrayFilters: [{ 'n.phoneNumber': num.phoneNumber }] })
  _log(`[Fax] fax line ${enabled ? 'ON' : 'OFF'} for ${num.phoneNumber} (chatId=${chatId})`)
  return faxLine
}

// ── Delivery to the owner: bot PDF (web accounts → inbox item), plus email copy ──
async function langOf(chatId) { return (await col('state').findOne({ _id: chatId }, { projection: { userLanguage: 1 } }))?.userLanguage || 'en' }
async function emailOf(chatId) {
  if (notify.isWebChatId(chatId)) return (await col('webAccounts').findOne({ _id: { $in: [chatId, Number(chatId)] } }, { projection: { email: 1 } }))?.email || null
  const s = await col('state').findOne({ _id: chatId }, { projection: { accountEmail: 1, welcomeEmailSentTo: 1, email: 1 } })
  return s?.accountEmail || s?.welcomeEmailSentTo || s?.email || null
}
async function tell(chatId, text, meta) {
  if (notify.isWebChatId(chatId)) return notify.push(chatId, text, null, { kind: 'fax', meta: { ...meta, link: '/app/fax' } }).catch(() => {})
  return _bot?.sendMessage(chatId, text, { parse_mode: 'HTML' }).catch(() => {})
}
async function emailCopy(chatId, fax, pdf) {
  const to = await emailOf(chatId)
  if (!to) return false
  const subject = `Fax received from ${fmt(fax.from)} (${fax.pages} page${fax.pages === 1 ? '' : 's'})`
  const html = `<p><b>New fax</b> on ${esc(fmt(fax.to))}</p><p>From: ${esc(fmt(fax.from))}<br/>Pages: ${fax.pages}<br/>Received: ${new Date().toUTCString()}</p><p>The fax is attached as a PDF.</p>`
  const attachments = [{ filename: `fax_${String(fax.from).replace(/\D/g, '')}.pdf`, content: pdf, contentType: 'application/pdf' }]
  try {
    if (notify.isWebChatId(chatId)) return await require('./cloudivr-web/auth').sendMail(to, subject, html, attachments)
    await require('./mailer').send({ from: { name: process.env.MAIL_SENDER_NAME || brand(), address: process.env.MAIL_SENDER }, to, subject, html, attachments })
    return true
  } catch (e) { _log(`[Fax] email copy to ${to} failed: ${e.message}`); return false }
}
async function download(url) {
  try { return Buffer.from((await axios.get(url, { responseType: 'arraybuffer', timeout: 30000 })).data) } catch (_) {
    return Buffer.from((await axios.get(url, { responseType: 'arraybuffer', timeout: 30000, headers: hdrs() })).data)
  }
}

async function onReceived(p) {
  const faxId = p.fax_id || p.id
  if (!faxId || await col('faxes').findOne({ _id: faxId })) return
  const owner = await findOwner(p.to)
  if (!owner) return _log(`[Fax] received for unknown number ${p.to}`)
  const { chatId, num } = owner
  if (!eligible(num)) {
    _log(`[Fax] ${p.to} is no longer on Business — fax line switched back to voice, fax dropped`)
    return setLine({ chatId, num: { ...num, plan: 'business' }, enabled: false }).catch(e => _log(`[Fax] restore voice failed: ${e.message}`))
  }
  let media = p.media_url
  if (!media) media = (await axios.get(`${BASE}/faxes/${faxId}`, { headers: hdrs() }).catch(() => null))?.data?.data?.media_url
  let pdf = null
  if (media) { try { pdf = await download(media) } catch (e) { _log(`[Fax] media download failed for ${faxId}: ${e.message}`) } }
  let pages = Number(p.page_count) || 0
  if (!pages && pdf) pages = await PDFDocument.load(pdf, { ignoreEncryption: true }).then(d => d.getPageCount()).catch(() => 1)
  pages = pages || 1
  const fileId = pdf ? await saveFile(pdf, { chatId, kind: 'received', faxId }) : null
  const fax = { _id: faxId, chatId, phoneNumber: num.phoneNumber, direction: 'inbound', from: p.from, to: p.to, pages, status: pdf ? 'received' : 'received_no_media', fileId, createdAt: new Date() }
  try { await col('faxes').insertOne(fax) } catch (e) { if (e.code === 11000) return; throw e }
  const q = await settle(fax, num, pages)
  const lang = await langOf(chatId)
  const caption = t(lang).received(p.from, p.to, pages, q.cost)
  if (notify.isWebChatId(chatId)) await tell(chatId, caption, { faxId })
  else if (pdf) await _bot?.sendDocument(chatId, pdf, { caption, parse_mode: 'HTML' }, { filename: `fax_${String(p.from).replace(/\D/g, '')}.pdf`, contentType: 'application/pdf' }).catch(e => _log(`[Fax] bot PDF send failed: ${e.message}`))
  else await tell(chatId, caption)
  const emailed = pdf ? await emailCopy(chatId, fax, pdf) : false
  await col('faxes').updateOne({ _id: faxId }, { $set: { emailed } })
  _log(`[Fax] received ${faxId}: ${p.from} → ${p.to} (${pages} page(s), $${q.cost}, emailed=${emailed})`)
}

// Telnyx fax webhook (/telnyx/fax-webhook) — event = req.body.data.
async function handleEvent(event) {
  const type = event?.event_type
  const p = event?.payload || {}
  if (type === 'fax.received') return onReceived(p)
  const faxId = p.fax_id || p.id
  const fax = faxId && await col('faxes').findOne({ _id: faxId })
  if (!fax) { if (type === 'fax.failed') _log(`[Fax] failed (untracked) ${p.from} → ${p.to}: ${p.failure_reason || 'unknown'}`); return }
  if (fax.direction !== 'outbound') return
  const status = type.replace(/^fax\./, '')
  if (type === 'fax.delivered') {
    if (fax.status === 'delivered' || fax.status === 'failed') return
    await col('faxes').updateOne({ _id: faxId }, { $set: { status: 'delivered', deliveredAt: new Date() } })
    const num = (await findMine(fax.chatId, fax.phoneNumber)) || { phoneNumber: fax.phoneNumber, expiresAt: null }
    const q = await settle(fax, num, Number(p.page_count) || fax.pages)
    if (fax.batchId) { await col('faxBatches').updateOne({ _id: fax.batchId }, { $inc: { delivered: 1 } }); return finishBatch(fax.batchId) }
    return tell(fax.chatId, t(await langOf(fax.chatId)).delivered(fax.to, Number(p.page_count) || fax.pages, q.cost), { faxId })
  }
  if (type === 'fax.failed') {
    if (fax.status === 'failed' || fax.status === 'delivered') return
    await col('faxes').updateOne({ _id: faxId }, { $set: { status: 'failed', failureReason: p.failure_reason || null } })
    if (fax.batchId) { await col('faxBatches').updateOne({ _id: fax.batchId }, { $inc: { failed: 1 } }); return finishBatch(fax.batchId) }
    return tell(fax.chatId, t(await langOf(fax.chatId)).failed(fax.to, String(p.failure_reason || '').replace(/_/g, ' ')), { faxId })
  }
  if (!['delivered', 'failed'].includes(fax.status)) await col('faxes').updateOne({ _id: faxId }, { $set: { status } })
}

const publicFax = (f) => ({ id: f._id, direction: f.direction, phoneNumber: f.phoneNumber, from: f.from, to: f.to, pages: f.pages, status: f.status, failureReason: f.failureReason || null, cost: f.cost || 0, freePages: f.freePages ?? null, hasFile: !!f.fileId, createdAt: f.createdAt })
async function list(chatId, limit = 100) {
  return (await col('faxes').find({ chatId, batchId: { $exists: false } }).sort({ createdAt: -1 }).limit(limit).toArray()).map(publicFax)
}
async function fileOf(chatId, faxId) {
  const f = await col('faxes').findOne({ _id: String(faxId), chatId })
  return f?.fileId ? { buffer: await readFile(f.fileId), fax: f } : null
}

const isReady = () => !!_db

module.exports = { BULK_MAX, parseRecipients, bulkQuote, sendBulk, cancelBatch, resumeBatches, listBatches, init, isReady, t, TXT, FREE_PAGES, PAGE_PRICE, FaxError, eligible, lineOn, ensureApp, usage, quote, stage, sendStaged, setLine, handleEvent, list, fileOf, toPdf, checkTo, findMine }
