#!/usr/bin/env node
// Telnyx → SignalWire number replacement (old Telnyx account blocked, 2026-11). Run ON the prod droplet, one brand at a time:
//   node js/ops/migrate_telnyx_to_signalwire_2026-11.js --env /opt/nomadly/shared/<app>/backend.env           # DRY RUN
//   ... --apply                 buy + new SIP login (checked by a real REGISTER) + write records, no messages
//   ... --notify                message customers whose new number + SIP login passed the check
//   options: --only=<chatId> --limit=N
// Active Telnyx numbers only. Same area code, else same state (toll-free → toll-free); otherwise skipped and listed.
// Free swap: same plan, planPrice, expiry, autoRenew, features, usage, sub-number links, IVR audio. Idempotent/resumable.
'use strict'
const fs = require('fs'), path = require('path'), { spawnSync } = require('child_process')
const ARGS = process.argv.slice(2)
const argVal = (k) => { const a = ARGS.find(x => x.startsWith(`--${k}=`)); return a ? a.split('=').slice(1).join('=') : (ARGS.includes(`--${k}`) ? ARGS[ARGS.indexOf(`--${k}`) + 1] : null) }
for (const l of fs.readFileSync(argVal('env'), 'utf8').split('\n')) { const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) process.env[m[1]] = m[2].replace(/^"|"$/g, '') }
const APPLY = ARGS.includes('--apply'), NOTIFY = ARGS.includes('--notify'), ONLY = argVal('only'), LIMIT = Number(argVal('limit')) || Infinity
const { MongoClient } = require('mongodb')
const axios = require('axios')
const rest = require('../signalwire/rest')
const sipLogins = require('../sip-logins')
const webNotify = require('../cloudivr-web/notify')
const mask = p => String(p || '').replace(/(\+\d{4})\d+(\d{2})$/, '$1xxxx$2')
const fmt = p => { const d = String(p || '').replace(/\D/g, ''); return d.length === 11 && d[0] === '1' ? `+1 (${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}` : p }
const BRAND_NAME = process.env.BRAND_PHONE_NAME || process.env.CHAT_BOT_BRAND || 'Cloud IVR'
// The SIP server address is the only place a carrier name may appear (softphones need the exact domain).
const assertClean = (t, domain = '') => { if (/twilio|telnyx|signalwire|bird/i.test(domain ? t.split(domain).join('') : t)) throw new Error('user message names a carrier — not sent'); return t }
const isOld = (n) => (n.provider || 'telnyx') === 'telnyx' && n.status === 'active' && !n._released && !n.faxOnly

function notifyText(lang, oldNum, newNum, n, user, pass, domain) {
  const exp = String(n.expiresAt).slice(0, 10), plan = String(n.plan || '').replace(/^./, c => c.toUpperCase())
  const sip = user ? `\n🔑 <b>New SIP login</b> (update your softphone):\nServer: <code>${domain}</code>\nUsername: <code>${user}</code>\nPassword: <code>${pass}</code>` : ''
  const T = {
    en: `🙏 <b>Sorry for the interruption to your ${BRAND_NAME} line</b>\n\nYour number ${fmt(oldNum)} stopped working because of a problem at our previous phone network. We've moved your line to our new network at no cost to you.\n\n📞 <b>Your new number:</b> <code>${fmt(newNum)}</code>\n(replaces ${fmt(oldNum)} — please share it with your contacts)\n📦 Plan: <b>${plan}</b> — same expiry date: <b>${exp}</b>\n⚙️ Your forwarding, voicemail and IVR settings were carried over.${sip}\n\nNo charge was made. Questions? Tap 💬 Support.`,
    fr: `🙏 <b>Désolés pour l'interruption de votre ligne ${BRAND_NAME}</b>\n\nVotre numéro ${fmt(oldNum)} a cessé de fonctionner à cause d'un problème chez notre ancien réseau téléphonique. Nous avons transféré votre ligne vers notre nouveau réseau, sans frais.\n\n📞 <b>Votre nouveau numéro :</b> <code>${fmt(newNum)}</code>\n(remplace ${fmt(oldNum)} — merci de le communiquer à vos contacts)\n📦 Forfait : <b>${plan}</b> — même date d'expiration : <b>${exp}</b>\n⚙️ Vos réglages de transfert, messagerie vocale et SVI ont été conservés.${sip.replace('New SIP login', 'Nouvel identifiant SIP').replace('update your softphone', 'à mettre dans votre softphone').replace('Server', 'Serveur').replace('Username', 'Identifiant').replace('Password', 'Mot de passe')}\n\nAucun débit. Des questions ? Appuyez sur 💬 Support.`,
  }
  return assertClean(T[lang] || T.en, domain)
}
async function tg(chatId, text) {
  try { return (await axios.post(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN_PROD}/sendMessage`, { chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true }, { timeout: 20000 })).data } catch (e) { return { ok: false, description: e.response?.data?.description || e.message } }
}
// Real REGISTER against SignalWire with the new login → true only on 200 OK.
function sipWorks(domain, user, pass) {
  const r = spawnSync('python3', [path.join(__dirname, '../../scripts/sw_sip_register_check.py'), domain, user, pass], { encoding: 'utf8', timeout: 30000 })
  return { ok: /2nd:\s*SIP\/2\.0 200/.test(r.stdout || ''), out: String(r.stdout || r.stderr || '').trim().replace(/\n/g, ' | ') }
}
async function pick(old, taken) {
  const type = old.type === 'toll_free' ? 'toll_free' : 'local'
  const d = String(old.phoneNumber).replace(/\D/g, ''), ac = type === 'local' && d.length === 11 ? d.slice(1, 4) : null
  const rows = await rest.searchNumbers(old.country || 'US', type, ac, 10)
  const r = rows.find(x => !taken.has(x.phone_number) && (type === 'toll_free' || !x._areaFallback || x._fallbackRegion))
  return r ? { phone: r.phone_number, match: type === 'toll_free' ? 'toll-free' : r._areaFallback ? `same state ${r._fallbackRegion}` : 'same area code' } : null
}

;(async () => {
  const cl = await MongoClient.connect(process.env.MONGO_URL), db = cl.db(process.env.DB_NAME), col = db.collection('phoneNumbersOf')
  webNotify.setDb(db)
  console.log(`${APPLY ? 'APPLY' : NOTIFY ? 'NOTIFY' : 'DRY RUN'} — brand ${rest.brandSlug()} db=${process.env.DB_NAME} | SIP domain ${await rest.sipDomain()}`)
  await rest.refreshOwned(true)
  const docs = await col.find(ONLY ? { _id: isNaN(+ONLY) ? ONLY : { $in: [ONLY, +ONLY] } } : { 'val.numbers.status': 'active' }).toArray()
  const taken = new Set(), skipped = []
  let n = 0, done = 0, failed = 0
  for (const d of docs) for (const old of (d.val?.numbers || []).filter(x => isOld(x) || (NOTIFY && x.migratedFromProvider === 'telnyx' && x.status === 'active'))) {
    if (n++ >= LIMIT) break
    const chatId = d._id
    // ── notify pass: only lines whose SIP check passed ──
    if (NOTIFY) {
      if (old.provider !== 'signalwire' || old._swapNotifiedAt) continue
      if (old.sipUsername && !old._sipCheckOk) { console.log(`  chat=${chatId} ${mask(old.phoneNumber)} ⏭ SIP check not passed — not messaged`); continue }
      const st = await db.collection('state').findOne({ _id: String(chatId) }).catch(() => null)
      const text = notifyText(st?.userLanguage || 'en', old.migratedFrom, old.phoneNumber, old, old.sipUsername, old.sipPassword, old.sipDomain)
      const r = webNotify.isWebChatId(chatId) ? await webNotify.push(chatId, text, null, { kind: 'number', meta: { link: '/app/numbers' } }).then(() => ({ ok: true }), e => ({ ok: false, description: e.message })) : await tg(chatId, text)
      console.log(`  chat=${chatId} ${mask(old.migratedFrom)} → ${mask(old.phoneNumber)} 📨 ${r.ok ? 'sent' : 'NOT sent — ' + r.description}`)
      if (r.ok) await col.updateOne({ _id: chatId }, { $set: { 'val.numbers.$[n]._swapNotifiedAt': new Date().toISOString() } }, { arrayFilters: [{ 'n.phoneNumber': old.phoneNumber, 'n.provider': 'signalwire' }] })
      continue
    }
    const tag = `  chat=${chatId} ${mask(old.phoneNumber)} (${old.type}, ${old.plan}, exp ${String(old.expiresAt).slice(0, 10)}${old.isSubNumber ? ', sub' : ''}${old.sipUsername ? ', SIP' : ''})`
    try {
      let newPhone = old.migratedTo || null, how = 'resume'
      if (!newPhone) {
        const p = await pick(old, taken)
        if (!p) { console.log(`${tag}\n     ⏭ no same-area-code or same-state number — skipped`); skipped.push(`${chatId} ${old.phoneNumber}`); continue }
        newPhone = p.phone; how = p.match; taken.add(newPhone)
      }
      console.log(`${tag}\n     → ${mask(newPhone)} (${how})`)
      if (!APPLY) continue
      const AF = { arrayFilters: [{ 'n.phoneNumber': old.phoneNumber, 'n.provider': old.provider || 'telnyx' }] }
      let order = null
      if (!old.migratedTo) {
        await col.updateOne({ _id: chatId }, { $set: { 'val.numbers.$[n]._migrationState': 'buying' } }, AF)
        order = await rest.buyNumber(newPhone)
        if (!order) throw new Error('SignalWire purchase failed')
        await col.updateOne({ _id: chatId }, { $set: { 'val.numbers.$[n].migratedTo': newPhone, 'val.numbers.$[n]._migrationState': 'bought', 'val.numbers.$[n]._migrationOrderId': order.id } }, AF)
      }
      // New SIP login on SignalWire, proven with a real REGISTER before it is saved as working.
      let sip = null, sipOk = false
      if (old.sipUsername && !old.sipDisabled) {
        for (let i = 0; i < 2 && !sipOk; i++) {
          sip = await rest.createSipEndpoint(sipLogins.shortUser(), sipLogins.shortPass(), newPhone)
          if (!sip) continue
          await new Promise(r => setTimeout(r, 3000))
          const chk = sipWorks(sip.sip_domain, sip.sip_username, sip.sip_password)
          sipOk = chk.ok
          console.log(`     🔑 SIP ${sip.sip_username}@${sip.sip_domain}: ${chk.ok ? 'REGISTER 200 OK' : 'FAILED — ' + chk.out}`)
          if (!sipOk) await rest.deleteSipEndpoint(sip.id).catch(() => {})
        }
      }
      const fresh = (await col.findOne({ _id: chatId }))?.val?.numbers || []
      if (!fresh.some(x => x.phoneNumber === newPhone && x.provider === 'signalwire')) {
        const parent = old.isSubNumber ? fresh.find(x => x.phoneNumber === old.parentNumber) : null
        const doc = {
          phoneNumber: newPhone, provider: 'signalwire', status: 'active', country: old.country || 'US', countryName: old.countryName, type: old.type,
          plan: old.plan, planPrice: old.planPrice, expiresAt: old.expiresAt, autoRenew: old.autoRenew !== false,
          purchaseDate: new Date().toISOString(), originalPurchaseDate: old.originalPurchaseDate || old.purchaseDate || null,
          telnyxOrderId: order?.id || old._migrationOrderId || null,
          ...(sipOk ? { sipUsername: sip.sip_username, sipPassword: sip.sip_password, telnyxSipUsername: sip.sip_username, telnyxSipPassword: sip.sip_password, telnyxCredentialId: sip.id, sipDomain: sip.sip_domain, _sipCheckOk: true } : old.sipUsername ? { _sipCheckOk: false } : {}),
          capabilities: { voice: true, sms: true, fax: false }, smsUsed: old.smsUsed || 0, minutesUsed: old.minutesUsed || 0,
          features: JSON.parse(JSON.stringify(old.features || {})), migratedFrom: old.phoneNumber, migratedFromProvider: 'telnyx', migratedAt: new Date().toISOString(),
        }
        if (doc.features.faxLine) delete doc.features.faxLine
        if (old.isSubNumber) { if (parent?.status === 'active' || parent?.migratedTo) { doc.isSubNumber = true; doc.parentNumber = parent.migratedTo || parent.phoneNumber } else doc.formerSubNumberOf = old.parentNumber }
        for (const k of ['numberSurcharge', 'grandfathered']) if (old[k] !== undefined) doc[k] = old[k]
        await col.updateOne({ _id: chatId }, { $push: { 'val.numbers': { $each: [doc], $position: 0 } } })
      }
      for (const a of await db.collection('ivrAudioStore').find({ _id: { $regex: `^${old.phoneNumber.replace('+', '\\+')}:` } }).toArray().catch(() => [])) {
        const { _id, ...restA } = a
        await db.collection('ivrAudioStore').updateOne({ _id: newPhone + _id.slice(old.phoneNumber.length) }, { $setOnInsert: { ...restA, migratedFrom: _id } }, { upsert: true })
      }
      await col.updateOne({ _id: chatId }, { $set: { 'val.numbers.$[n].status': 'released', 'val.numbers.$[n]._released': true, 'val.numbers.$[n]._releasedReason': 'migrated_to_signalwire', 'val.numbers.$[n].migratedTo': newPhone, 'val.numbers.$[n]._migrationState': 'done', 'val.numbers.$[n].autoRenew': false } }, AF)
      await col.updateOne({ _id: chatId }, { $set: { 'val.numbers.$[s].parentNumber': newPhone } }, { arrayFilters: [{ 's.parentNumber': old.phoneNumber, 's.status': 'active' }] }).catch(() => {})
      await db.collection('phoneTransactions').insertOne({ chatId, phoneNumber: newPhone, action: 'migrate_telnyx_to_signalwire', fromNumber: old.phoneNumber, plan: old.plan, amount: 0, timestamp: new Date().toISOString() }).catch(() => {})
      console.log(`     ✅ swapped${old.sipUsername ? (sipOk ? ' (SIP verified)' : ' (SIP NOT verified — customer will not be messaged)') : ''}`)
      done++
    } catch (e) { failed++; console.log(`     ❌ ${e.message}`) }
  }
  if (skipped.length) console.log(`SKIPPED (no match): ${skipped.join(', ')}`)
  if (!NOTIFY) console.log(`RESULT: ${APPLY ? `swapped=${done} failed=${failed}` : 'dry run'} skipped=${skipped.length}`)
  await cl.close()
})().catch(e => { console.error('ERR', e.message); process.exit(1) })
