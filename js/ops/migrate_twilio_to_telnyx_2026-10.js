// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Twilio → Telnyx number migration (Twilio account suspended 2026-10-22)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// For every ACTIVE Twilio number in each production brand DB:
//   1. pick a replacement Telnyx number (same type; toll-free tries the same prefix, e.g. 888)
//   2. buy it on the brand's Telnyx SIP connection + messaging profile, assign it to the brand's
//      Call Control App (inbound voice → existing Telnyx IVR / forwarding / voicemail engine)
//   3. REUSE the user's existing Telnyx SIP credential (softphones keep working, no re-login);
//      create a new one only if it no longer exists on Telnyx
//   4. write the new Telnyx number with the SAME plan, planPrice, expiresAt (unchanged), features
//      (forwarding / voicemail / SMS forwarding / recording), sub-number links and usage counters;
//      autoRenew = the value saved before the pause (js/ops/twilio_autorenew_pause_2026-10.js)
//   5. copy IVR audio (ivrAudioStore "<number>:greeting|submenu…") to the new number
//   6. mark the old Twilio entry status='released' (_releasedReason='migrated_to_telnyx',
//      migratedTo=<new>) — hidden from "My Numbers" and from the renewal scheduler
//   7. message the user from their brand bot (en/fr/zh/hi)
//
// USAGE (runs from the sandbox; brand env is loaded over SSH into memory only):
//   node js/ops/migrate_twilio_to_telnyx_2026-10.js                       # DRY RUN (default)
//   node js/ops/migrate_twilio_to_telnyx_2026-10.js --apply               # do it
//   options: --brands=app-main  --only=<chatId>  --limit=N  --include-suspended  --no-notify
//            --keep-autorenew-off   (leave autoRenew OFF on the new numbers)
//
// SAFETY: idempotent + resumable. Before buying, the old entry gets _migrationState='buying';
// right after a successful order it gets migratedTo=<new number>. A re-run reuses that number
// instead of buying another one. No wallet charges are made to users.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const path = require('path')
const { spawnSync } = require('child_process')

const ARGS = process.argv.slice(2)
const APPLY = ARGS.includes('--apply')
const argVal = (k) => { const a = ARGS.find(x => x.startsWith(`--${k}=`)); return a ? a.split('=').slice(1).join('=') : null }

// ── PARENT: spawn one child per brand (telnyx-service reads TELNYX_API_KEY at load) ──
if (!ARGS.includes('--child')) {
  const { loadBrandEnv, parseBrandsArg } = require('./_brand_env')
  const PICK = ['MONGO_URL', 'DB_NAME', 'TELNYX_API_KEY', 'TELNYX_SIP_CONNECTION_ID', 'TELNYX_CALL_CONTROL_APP_ID',
    'TELNYX_MESSAGING_PROFILE_ID', 'SIP_DOMAIN', 'TELEGRAM_BOT_TOKEN_PROD', 'TELEGRAM_ADMIN_CHAT_ID', 'BRAND_PHONE_NAME', 'CHAT_BOT_BRAND']
  console.log(`MODE: ${APPLY ? 'APPLY — ' : 'DRY RUN — no purchases, no writes, no messages — '}${ARGS.includes('--apologize-migrated') ? 'apology follow-up to already-migrated users' : 'buying numbers + writing production DB'}`)
  let failed = false
  for (const brand of parseBrandsArg(ARGS)) {
    const env = loadBrandEnv(brand)
    const childEnv = { PATH: process.env.PATH, HOME: process.env.HOME, NODE_PATH: process.env.NODE_PATH || '', MIG_BRAND: brand }
    for (const k of PICK) if (env[k] !== undefined) childEnv[k] = env[k]
    const r = spawnSync(process.execPath, [__filename, '--child', ...ARGS], { env: childEnv, stdio: 'inherit', cwd: path.join(__dirname, '..', '..') })
    if (r.status !== 0) failed = true
  }
  process.exit(failed ? 1 : 0)
}

// ── CHILD: one brand ──
const { MongoClient } = require('mongodb')
const axios = require('axios')
const telnyxApi = require('../telnyx-service.js')

const BRAND = process.env.MIG_BRAND
const ONLY = argVal('only')
const LIMIT = Number(argVal('limit')) || Infinity
const INCLUDE_SUSPENDED = ARGS.includes('--include-suspended')
const NOTIFY = !ARGS.includes('--no-notify')
const KEEP_AR_OFF = ARGS.includes('--keep-autorenew-off')
const SIP_CONN = process.env.TELNYX_SIP_CONNECTION_ID
const CCA = process.env.TELNYX_CALL_CONTROL_APP_ID
const MSG_PROFILE = process.env.TELNYX_MESSAGING_PROFILE_ID
const mask = p => String(p || '').replace(/(\+\d{4})\d+(\d{2})$/, '$1xxxx$2')
const fmt = p => { const d = String(p || '').replace(/\D/g, ''); return d.length === 11 && d[0] === '1' ? `+1 (${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}` : p }
const sleep = ms => new Promise(r => setTimeout(r, ms))
const randStr = (n, abc) => Array.from({ length: n }, () => abc[Math.floor(Math.random() * abc.length)]).join('')

const BRAND_NAME = process.env.BRAND_PHONE_NAME || process.env.CHAT_BOT_BRAND || 'Cloud IVR'
// User messages must never name the carriers.
const assertClean = (t) => { if (/twilio|telnyx/i.test(t)) throw new Error('user message mentions a carrier name — not sent'); return t }

function notifyText(lang, oldNum, newNum, n, sipUser, sipDomain) {
  const exp = String(n.expiresAt).slice(0, 10)
  const plan = n.plan.charAt(0).toUpperCase() + n.plan.slice(1)
  const T = {
    en: `🙏 <b>We're sorry for the interruption to your ${BRAND_NAME} line</b>\n\nYour number ${fmt(oldNum)} stopped working for a while, and we apologise for the trouble this caused. To get you back up and running, we've moved your line to our new, more reliable calling network.\n\n📞 <b>Your new number:</b> <code>${fmt(newNum)}</code>\n(replaces ${fmt(oldNum)}, which can no longer take calls — please share the new number with your contacts)\n📦 Plan: <b>${plan}</b> — same expiry date: <b>${exp}</b>\n🔑 SIP login: <b>unchanged</b> (<code>${sipUser}</code> @ ${sipDomain}) — your softphone keeps working\n⚙️ Your forwarding, voicemail and IVR settings were carried over.\n\nNo charge was made, and we've added nothing to your bill. Questions? Tap 💬 Support.`,
    fr: `🙏 <b>Toutes nos excuses pour l'interruption de votre ligne ${BRAND_NAME}</b>\n\nVotre numéro ${fmt(oldNum)} a cessé de fonctionner pendant un moment, et nous sommes désolés pour la gêne occasionnée. Pour vous remettre en service, nous avons transféré votre ligne vers notre nouveau réseau d'appels, plus fiable.\n\n📞 <b>Votre nouveau numéro :</b> <code>${fmt(newNum)}</code>\n(remplace ${fmt(oldNum)}, qui ne peut plus recevoir d'appels — merci de communiquer le nouveau numéro à vos contacts)\n📦 Forfait : <b>${plan}</b> — même date d'expiration : <b>${exp}</b>\n🔑 Identifiant SIP : <b>inchangé</b> (<code>${sipUser}</code> @ ${sipDomain}) — votre softphone continue de fonctionner\n⚙️ Vos réglages de transfert, messagerie vocale et SVI ont été conservés.\n\nAucun débit, rien n'a été ajouté à votre facture. Des questions ? Appuyez sur 💬 Support.`,
    zh: `🙏 <b>很抱歉，您的 ${BRAND_NAME} 线路出现了中断</b>\n\n您的号码 ${fmt(oldNum)} 曾有一段时间无法使用，给您带来不便，我们深表歉意。为尽快恢复服务，我们已将您的线路迁移到更可靠的新通话网络。\n\n📞 <b>您的新号码：</b><code>${fmt(newNum)}</code>\n（替换 ${fmt(oldNum)}，旧号码已无法接听来电 — 请将新号码告知您的联系人）\n📦 套餐：<b>${plan}</b> — 到期日不变：<b>${exp}</b>\n🔑 SIP 登录：<b>不变</b>（<code>${sipUser}</code> @ ${sipDomain}）— 软电话可继续使用\n⚙️ 您的转接、语音信箱和 IVR 设置已保留。\n\n未产生任何费用，账单也没有任何增加。有疑问？请点击 💬 Support。`,
    hi: `🙏 <b>आपकी ${BRAND_NAME} लाइन में आई रुकावट के लिए हमें खेद है</b>\n\nआपका नंबर ${fmt(oldNum)} कुछ समय के लिए काम नहीं कर रहा था, इस परेशानी के लिए हम क्षमा चाहते हैं। सेवा जल्द बहाल करने के लिए हमने आपकी लाइन को हमारे नए, अधिक विश्वसनीय कॉलिंग नेटवर्क पर ले जाया है।\n\n📞 <b>आपका नया नंबर:</b> <code>${fmt(newNum)}</code>\n(${fmt(oldNum)} की जगह, जिस पर अब कॉल नहीं आ सकतीं — कृपया नया नंबर अपने संपर्कों के साथ साझा करें)\n📦 प्लान: <b>${plan}</b> — वही समाप्ति तिथि: <b>${exp}</b>\n🔑 SIP लॉगिन: <b>अपरिवर्तित</b> (<code>${sipUser}</code> @ ${sipDomain}) — आपका सॉफ्टफ़ोन चलता रहेगा\n⚙️ आपकी फ़ॉरवर्डिंग, वॉइसमेल और IVR सेटिंग्स बनी रहीं।\n\nकोई शुल्क नहीं लिया गया और आपके बिल में कुछ नहीं जोड़ा गया। सवाल? 💬 Support दबाएँ।`,
  }
  return assertClean(T[lang] || T.en)
}

// Short follow-up for users migrated before the apology wording existed.
function apologyText(lang, oldNum, newNum) {
  const T = {
    en: `🙏 <b>Sorry for the interruption</b>\n\nYour ${BRAND_NAME} line was down for a while before we moved it to our new calling network, and we apologise for the trouble this caused.\n\nEverything is working again on your new number: <code>${fmt(newNum)}</code> (it replaced ${fmt(oldNum)}). Please share it with your contacts. Your plan, expiry date and settings are unchanged, and no charge was made.\n\nQuestions? Tap 💬 Support.`,
    fr: `🙏 <b>Désolés pour l'interruption</b>\n\nVotre ligne ${BRAND_NAME} a été indisponible un moment avant son transfert vers notre nouveau réseau d'appels, et nous nous excusons pour la gêne occasionnée.\n\nTout fonctionne à nouveau sur votre nouveau numéro : <code>${fmt(newNum)}</code> (il remplace ${fmt(oldNum)}). Merci de le communiquer à vos contacts. Votre forfait, votre date d'expiration et vos réglages sont inchangés, et aucun débit n'a été effectué.\n\nDes questions ? Appuyez sur 💬 Support.`,
    zh: `🙏 <b>很抱歉给您带来中断</b>\n\n在迁移到新通话网络之前，您的 ${BRAND_NAME} 线路曾中断一段时间，给您带来不便，我们深表歉意。\n\n您的新号码现已恢复正常使用：<code>${fmt(newNum)}</code>（替换 ${fmt(oldNum)}）。请将新号码告知您的联系人。您的套餐、到期日和设置均保持不变，且未产生任何费用。\n\n有疑问？请点击 💬 Support。`,
    hi: `🙏 <b>रुकावट के लिए क्षमा करें</b>\n\nहमारे नए कॉलिंग नेटवर्क पर ले जाने से पहले आपकी ${BRAND_NAME} लाइन कुछ समय के लिए बंद रही, इस परेशानी के लिए हम क्षमा चाहते हैं।\n\nआपके नए नंबर पर सब कुछ फिर से काम कर रहा है: <code>${fmt(newNum)}</code> (${fmt(oldNum)} की जगह)। कृपया इसे अपने संपर्कों के साथ साझा करें। आपका प्लान, समाप्ति तिथि और सेटिंग्स नहीं बदलीं, और कोई शुल्क नहीं लिया गया।\n\nसवाल? 💬 Support दबाएँ।`,
  }
  return assertClean(T[lang] || T.en)
}

async function tg(chatId, text) {
  const tok = process.env.TELEGRAM_BOT_TOKEN_PROD
  if (!tok) return { ok: false, description: 'no bot token' }
  try {
    const r = await axios.post(`https://api.telegram.org/bot${tok}/sendMessage`, { chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true }, { timeout: 20000 })
    return r.data
  } catch (e) { return { ok: false, description: e.response?.data?.description || e.message } }
}

async function pickNumber(old, taken) {
  const type = old.type === 'toll_free' ? 'toll_free' : 'local'
  const digits = String(old.phoneNumber).replace(/\D/g, '')
  const ndc = digits.length === 11 ? digits.slice(1, 4) : null
  const tries = [ndc, null]
  for (const t of tries) {
    const res = await telnyxApi.searchNumbers(old.country || 'US', type, t, 10)
    const pick = res.find(r => !taken.has(r.phone_number))
    if (pick) return { phone: pick.phone_number, type, ndcMatched: !!t && pick.phone_number.slice(2, 5) === t, cost: pick.cost_information || null, features: pick._capabilities }
  }
  return null
}

async function waitOnAccount(phone, tries = 12) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await axios.get('https://api.telnyx.com/v2/phone_numbers', { headers: { Authorization: `Bearer ${process.env.TELNYX_API_KEY}` }, params: { 'filter[phone_number]': phone, 'page[size]': 1 } })
      const f = r.data?.data?.[0]
      if (f && f.status === 'active') return f
    } catch (_) { /* retry */ }
    await sleep(5000)
  }
  return null
}

;(async () => {
  console.log(`\n━━━━━━━━ ${BRAND} (db=${process.env.DB_NAME}) ━━━━━━━━`)
  const client = new MongoClient(process.env.MONGO_URL, { serverSelectionTimeoutMS: 20000 })
  await client.connect()
  const db = client.db(process.env.DB_NAME)
  const col = db.collection('phoneNumbersOf')
  if (ARGS.includes('--apologize-migrated')) {
    const ds = await col.find({ 'val.numbers.migratedFromProvider': 'twilio' }).toArray()
    let sent = 0
    for (const d of ds) {
      for (const n of (d.val?.numbers || []).filter(x => x.migratedFromProvider === 'twilio' && x.status === 'active' && !x._apologySentAt)) {
        const st = await db.collection('state').findOne({ _id: String(d._id) }).catch(() => null)
        const lang = st?.userLanguage || 'en'
        const text = apologyText(lang, n.migratedFrom, n.phoneNumber)
        console.log(`  chat=${d._id} ${mask(n.migratedFrom)} → ${mask(n.phoneNumber)} lang=${lang}${APPLY ? '' : ' (would send apology)'}`)
        if (!APPLY) continue
        const r = await tg(d._id, text)
        console.log(`     📨 ${r.ok ? 'sent' : 'NOT sent — ' + r.description}`)
        if (r.ok) { sent++; await col.updateOne({ _id: d._id }, { $set: { 'val.numbers.$[n]._apologySentAt': new Date().toISOString() } }, { arrayFilters: [{ 'n.phoneNumber': n.phoneNumber, 'n.provider': 'telnyx' }] }) }
      }
    }
    console.log(`  APOLOGY: ${APPLY ? `sent=${sent}` : 'dry run'}`)
    await client.close(); return
  }
  const statuses = INCLUDE_SUSPENDED ? ['active', 'suspended'] : ['active']
  const docs = await col.find(ONLY ? { _id: isNaN(+ONLY) ? ONLY : { $in: [ONLY, +ONLY] } } : { 'val.numbers.provider': 'twilio' }).toArray()

  const jobs = []
  for (const d of docs) {
    // group by phone number; on duplicate entries keep the one with the LATEST expiresAt
    const byPhone = new Map()
    for (const n of d.val?.numbers || []) {
      if (n.provider !== 'twilio' || !statuses.includes(n.status) || n._released) continue
      if (new Date(n.expiresAt) <= new Date()) { console.log(`  ⏭ chat=${d._id} ${mask(n.phoneNumber)} skipped — plan already expired ${String(n.expiresAt).slice(0, 10)}`); continue }
      const prev = byPhone.get(n.phoneNumber)
      if (prev) console.log(`  ⚠️ chat=${d._id} duplicate entry for ${mask(n.phoneNumber)} — migrating once (keeping the later expiry)`)
      if (!prev || new Date(n.expiresAt) > new Date(prev.expiresAt)) byPhone.set(n.phoneNumber, n)
    }
    for (const n of byPhone.values()) jobs.push({ chatId: d._id, old: n, nums: d.val?.numbers || [] })
  }
  if (!jobs.length) { console.log('  no Twilio numbers to migrate'); await client.close(); return }

  let bal = null
  try { bal = (await axios.get('https://api.telnyx.com/v2/balance', { headers: { Authorization: `Bearer ${process.env.TELNYX_API_KEY}` } })).data?.data } catch (_) { /* ignore */ }
  // Look up each user's existing Telnyx SIP credential directly (the account has >250 creds,
  // so a single list page is not enough): by telnyxCredentialId, else filter[sip_username].
  const TH = { Authorization: `Bearer ${process.env.TELNYX_API_KEY}` }
  async function findCred(n) {
    const user = n.telnyxSipUsername || n.sipUsername
    if (n.telnyxCredentialId) {
      try { const r = await axios.get(`https://api.telnyx.com/v2/telephony_credentials/${n.telnyxCredentialId}`, { headers: TH }); const c = r.data?.data; if (c && (!user || c.sip_username === user)) return { id: c.id, sipUsername: c.sip_username } } catch (_) { /* fall through */ }
    }
    if (user) {
      try { const r = await axios.get('https://api.telnyx.com/v2/telephony_credentials', { headers: TH, params: { 'filter[sip_username]': user } }); const c = (r.data?.data || []).find(x => x.sip_username === user); if (c) return { id: c.id, sipUsername: c.sip_username } } catch (_) { /* none */ }
    }
    return null
  }
  console.log(`  Telnyx balance: $${bal?.balance ?? '?'} (available credit $${bal?.available_credit ?? '?'}) | jobs: ${jobs.length}`)

  const taken = new Set()
  let estUpfront = 0, estMonthly = 0, done = 0, failed = 0
  for (const job of jobs.slice(0, LIMIT)) {
    const { chatId, old } = job
    const tag = `  chat=${chatId} ${mask(old.phoneNumber)} (${old.type}, ${old.plan}, exp ${String(old.expiresAt).slice(0, 10)}${old.isSubNumber ? ', sub-number' : ''})`
    try {
      // ── Resume: number already bought on a previous run ──
      let newPhone = old.migratedTo || null
      let pick = null
      if (!newPhone) {
        pick = await pickNumber(old, taken)
        if (!pick) { console.log(`${tag}\n     ❌ no Telnyx ${old.type} number available`); failed++; continue }
        newPhone = pick.phone
        taken.add(newPhone)
        estUpfront += Number(pick.cost?.upfront_cost || 0); estMonthly += Number(pick.cost?.monthly_cost || 0)
      }
      const sipUser = old.telnyxSipUsername || old.sipUsername
      const existingCred = await findCred(old)
      const sipPlan = existingCred ? `reuse SIP login ${sipUser}` : 'create NEW SIP login (old one not found on Telnyx)'
      const fwd = old.features?.callForwarding?.enabled ? `fwd=${old.features.callForwarding.mode}` : 'fwd=off'
      const vm = old.features?.voicemail?.enabled ? 'vm=on' : 'vm=off'
      const audio = await db.collection('ivrAudioStore').countDocuments({ _id: { $regex: `^${old.phoneNumber.replace('+', '\\+')}:` } }).catch(() => 0)
      const ar = KEEP_AR_OFF ? false : (old._autoRenewPausedForMigration ? old._autoRenewBeforePause === true : old.autoRenew !== false)
      // A sub-number keeps its parent only if that parent is (or was migrated to) an active number; else it becomes standalone.
      let parentNow = null
      if (old.isSubNumber) {
        const par = job.nums.find(x => x.phoneNumber === old.parentNumber)
        if (par?.status === 'active') parentNow = par.phoneNumber
        else if (par?.migratedTo && job.nums.some(x => x.phoneNumber === par.migratedTo && x.status === 'active')) parentNow = par.migratedTo
      }
      const subPlan = old.isSubNumber ? (parentNow ? `sub of ${mask(parentNow)}` : 'sub → STANDALONE (parent line expired)') : ''
      console.log(`${tag}\n     → ${old.migratedTo ? 'RESUME with' : 'buy'} ${mask(newPhone)}${pick ? ` (${pick.ndcMatched ? 'same prefix' : 'different prefix'}, $${pick.cost?.upfront_cost ?? '?'} upfront / $${pick.cost?.monthly_cost ?? '?'}/mo)` : ''} | ${sipPlan} | ${fwd} ${vm} | IVR audio docs: ${audio} | autoRenew on new: ${ar}${subPlan ? ' | ' + subPlan : ''}`)
      if (!APPLY) continue

      // ── 1. Buy (idempotent) ──
      if (!old.migratedTo) {
        await col.updateOne({ _id: chatId }, { $set: { 'val.numbers.$[n]._migrationState': 'buying', 'val.numbers.$[n]._migrationStartedAt': new Date().toISOString() } }, { arrayFilters: [{ 'n.phoneNumber': old.phoneNumber, 'n.provider': 'twilio' }] })
        const order = await telnyxApi.buyNumber(newPhone, SIP_CONN, MSG_PROFILE, { countryCode: old.country || 'US', numberType: pick.type, areaCode: null })
        if (!order) throw new Error('Telnyx number order failed (balance / availability)')
        if (order._retriedNumber) newPhone = order._retriedNumber
        job.orderId = order.id
        await col.updateOne({ _id: chatId }, { $set: { 'val.numbers.$[n].migratedTo': newPhone, 'val.numbers.$[n]._migrationState': 'bought', 'val.numbers.$[n]._migrationOrderId': order.id } }, { arrayFilters: [{ 'n.phoneNumber': old.phoneNumber, 'n.provider': 'twilio' }] })
      }
      // ── 2. Wait until active, route inbound voice to the Call Control App ──
      const acct = await waitOnAccount(newPhone)
      if (!acct) throw new Error(`number ${mask(newPhone)} not active on Telnyx yet — re-run later to resume`)
      if (CCA) await telnyxApi.assignNumberToCallControlApp(newPhone, CCA)
      // ── 3. SIP credential (reuse) ──
      let sipUsername = sipUser, sipPassword = old.telnyxSipPassword || old.sipPassword, credId = existingCred?.id || old.telnyxCredentialId || null
      if (!existingCred) {
        const u = 'sip' + randStr(10, 'abcdefghijklmnopqrstuvwxyz0123456789'), p = randStr(16, 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789')
        const c = await telnyxApi.createSIPCredential(SIP_CONN, u, p)
        if (!c) throw new Error('could not create SIP credential')
        sipUsername = c.sip_username || u; sipPassword = c.sip_password || p; credId = c.id
      }
      // ── 4. New number record (same plan + expiry + features) ──
      const fresh = (await col.findOne({ _id: chatId }))?.val?.numbers || []
      if (!fresh.some(x => x.phoneNumber === newPhone && x.provider === 'telnyx')) {
        const numberDoc = {
          phoneNumber: newPhone, provider: 'telnyx', status: 'active',
          country: old.country || 'US', countryName: old.countryName, type: old.type,
          plan: old.plan, planPrice: old.planPrice, expiresAt: old.expiresAt, autoRenew: ar,
          purchaseDate: new Date().toISOString(), originalPurchaseDate: old.purchaseDate || null,
          telnyxOrderId: job.orderId || old._migrationOrderId || null, connectionId: SIP_CONN, messagingProfileId: MSG_PROFILE,
          sipUsername, sipPassword, telnyxSipUsername: sipUsername, telnyxSipPassword: sipPassword, telnyxCredentialId: credId,
          sipDomain: old.sipDomain || process.env.SIP_DOMAIN || 'sip.speechcue.com',
          capabilities: { voice: true, sms: true, ...(old.capabilities || {}) },
          smsUsed: old.smsUsed || 0, minutesUsed: old.minutesUsed || 0,
          features: JSON.parse(JSON.stringify(old.features || {})),
          migratedFrom: old.phoneNumber, migratedFromProvider: 'twilio', migratedAt: new Date().toISOString(),
        }
        if (old.isSubNumber && parentNow) { numberDoc.isSubNumber = true; numberDoc.parentNumber = parentNow }
        else if (old.isSubNumber) numberDoc.formerSubNumberOf = old.parentNumber
        if (old.numberSurcharge !== undefined) numberDoc.numberSurcharge = old.numberSurcharge
        if (old.grandfathered) numberDoc.grandfathered = old.grandfathered
        // $position:0 → the new active Telnyx record is matched FIRST by findNumberBySipUser
        // (a still-'suspended' Twilio parent may share the same SIP login).
        await col.updateOne({ _id: chatId }, { $push: { 'val.numbers': { $each: [numberDoc], $position: 0 } } })
      }
      // ── 5. Copy IVR audio ──
      const aud = await db.collection('ivrAudioStore').find({ _id: { $regex: `^${old.phoneNumber.replace('+', '\\+')}:` } }).toArray().catch(() => [])
      for (const a of aud) {
        const newId = newPhone + a._id.slice(old.phoneNumber.length)
        const { _id, ...rest } = a
        await db.collection('ivrAudioStore').updateOne({ _id: newId }, { $setOnInsert: { ...rest, migratedFrom: _id } }, { upsert: true })
      }
      // ── 6. Retire the Twilio entry ──
      await col.updateOne({ _id: chatId }, { $set: {
        'val.numbers.$[n].status': 'released', 'val.numbers.$[n]._released': true, 'val.numbers.$[n]._releasedReason': 'migrated_to_telnyx',
        'val.numbers.$[n].migratedTo': newPhone, 'val.numbers.$[n]._migrationState': 'done', 'val.numbers.$[n].migratedAt': new Date().toISOString(),
        'val.numbers.$[n].autoRenew': false,
      } }, { arrayFilters: [{ 'n.phoneNumber': old.phoneNumber, 'n.provider': 'twilio' }] })
      // sub-numbers that pointed at the old number now point at the new one
      await col.updateOne({ _id: chatId }, { $set: { 'val.numbers.$[s].parentNumber': newPhone } }, { arrayFilters: [{ 's.parentNumber': old.phoneNumber, 's.status': 'active' }] }).catch(() => {})
      await db.collection('phoneTransactions').insertOne({ chatId, phoneNumber: newPhone, action: 'migrate_twilio_to_telnyx', fromNumber: old.phoneNumber, plan: old.plan, amount: 0, timestamp: new Date().toISOString() }).catch(() => {})
      // ── 7. Notify user ──
      if (NOTIFY) {
        const st = await db.collection('state').findOne({ _id: String(chatId) }).catch(() => null)
        const r = await tg(chatId, notifyText(st?.userLanguage || 'en', old.phoneNumber, newPhone, old, sipUsername, old.sipDomain || process.env.SIP_DOMAIN))
        console.log(`     📨 user notified: ${r.ok ? 'yes' : 'NO — ' + r.description}`)
        if (r.ok) await col.updateOne({ _id: chatId }, { $set: { 'val.numbers.$[n]._apologySentAt': new Date().toISOString() } }, { arrayFilters: [{ 'n.phoneNumber': newPhone, 'n.provider': 'telnyx' }] })
      }
      console.log(`     ✅ migrated → ${mask(newPhone)}`)
      done++
    } catch (e) {
      failed++
      console.log(`     ❌ ${e.message}`)
    }
  }
  if (!APPLY) console.log(`  ESTIMATE: ${jobs.length} number(s) ≈ $${estUpfront.toFixed(2)} upfront + $${estMonthly.toFixed(2)}/mo on Telnyx (balance $${bal?.balance ?? '?'})`)
  else console.log(`  RESULT: migrated=${done} failed=${failed}`)
  await client.close()
  process.exit(failed && APPLY ? 1 : 0)
})().catch(e => { console.error('ERR', e.message); process.exit(1) })
