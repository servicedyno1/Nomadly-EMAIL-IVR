#!/usr/bin/env node
// SignalWire (suspended) + old blocked-Telnyx numbers → new Telnyx numbers on our SIP trunk (2026-11). Run ON the prod droplet,
// one brand at a time, from the brand's release dir:
//   node js/ops/migrate_to_telnyx_sip_2026-11.js --env /opt/nomadly/shared/<app>/backend.env            # DRY RUN
//   ... --apply    buy + write records (same SIP login, plan, expiry, features) + brand routing + campaigns + drop old from Bird
//   ... --link     Bird caller-ID verification for the new numbers, one at a time (the brand app answers Bird's call)
//   ... --notify   message each customer once
//   options: --only=<chatId> --limit=N
// Old records are marked released (hidden in bot + web); the numbers themselves stay at SignalWire (owner's choice).
'use strict'
const fs = require('fs'), path = require('path'), { spawnSync } = require('child_process')
const ARGS = process.argv.slice(2)
const argVal = (k) => { const a = ARGS.find(x => x.startsWith(`--${k}=`)); return a ? a.split('=').slice(1).join('=') : (ARGS.includes(`--${k}`) ? ARGS[ARGS.indexOf(`--${k}`) + 1] : null) }
for (const l of fs.readFileSync(argVal('env'), 'utf8').split('\n')) { const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) process.env[m[1]] = m[2].replace(/^"|"$/g, '') }
const APPLY = ARGS.includes('--apply'), LINK = ARGS.includes('--link'), NOTIFY = ARGS.includes('--notify'), ONLY = argVal('only'), LIMIT = Number(argVal('limit')) || Infinity
const { MongoClient } = require('mongodb')
const axios = require('axios')
const txs = require('../telnyx-sip')
const ce = require('../callengine')
const bird = require('../bird')
const { AREA_REGION } = require('../signalwire/rest')
const webNotify = require('../cloudivr-web/notify')
const mask = p => String(p || '').replace(/(\+\d{4})\d+(\d{2})$/, '$1xxxx$2')
const fmt = p => { const d = String(p || '').replace(/\D/g, ''); return d.length === 11 && d[0] === '1' ? `+1 (${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}` : p }
const BRAND_NAME = process.env.BRAND_PHONE_NAME || process.env.CHAT_BOT_BRAND || 'Cloud IVR'
const DOMAIN = process.env.SIP_DOMAIN, SIP_IP = '188.166.34.29'
const REASON = 'replaced_by_telnyx_sip'
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
// SignalWire numbers (provider signalwire, or bought on SignalWire under the telnyx label) and old blocked-Telnyx numbers.
const isOld = (n) => ['signalwire', 'telnyx'].includes(n.provider || 'telnyx') && ['active', 'suspended'].includes(n.status) && !n._released && !n.faxOnly && !n.qaTest && !String(n.telnyxOrderId || '').startsWith('tx:')
const assertClean = (t) => { if (/twilio|telnyx|signalwire|bird/i.test(t.split(DOMAIN).join(''))) throw new Error('user message names a carrier — not sent'); return t }

function notifyText(lang, n) {
  const exp = String(n.expiresAt).slice(0, 10), plan = String(n.plan || '').replace(/^./, c => c.toUpperCase())
  const sip = n.sipUsername ? (lang === 'fr' ? `\n🔑 Votre identifiant SIP ne change pas : <code>${n.sipUsername}</code> sur <code>${DOMAIN}</code>` : `\n🔑 Your SIP login stays the same: <code>${n.sipUsername}</code> on <code>${DOMAIN}</code>`) : ''
  const T = {
    en: `🙏 <b>Sorry — your ${BRAND_NAME} number was moved</b>\n\nYour number ${fmt(n.migratedFrom)} stopped receiving calls because of an outage at our phone network. We've moved your line to a new number at no cost to you.\n\n📞 <b>Your new number:</b> <code>${fmt(n.phoneNumber)}</code>\n(replaces ${fmt(n.migratedFrom)} — please share it with your contacts)\n📦 Plan: <b>${plan}</b> — same expiry date: <b>${exp}</b>\n⚙️ Forwarding, voicemail, IVR, AI agent and campaigns now use the new number.${sip}\n\nNo charge was made. Questions? Tap 💬 Support.`,
    fr: `🙏 <b>Désolés — votre numéro ${BRAND_NAME} a changé</b>\n\nVotre numéro ${fmt(n.migratedFrom)} ne recevait plus d'appels à cause d'une panne chez notre réseau téléphonique. Nous avons transféré votre ligne vers un nouveau numéro, sans frais.\n\n📞 <b>Votre nouveau numéro :</b> <code>${fmt(n.phoneNumber)}</code>\n(remplace ${fmt(n.migratedFrom)} — merci de le communiquer à vos contacts)\n📦 Forfait : <b>${plan}</b> — même date d'expiration : <b>${exp}</b>\n⚙️ Transfert, messagerie vocale, SVI, agent IA et campagnes utilisent maintenant le nouveau numéro.${sip}\n\nAucun débit. Des questions ? Appuyez sur 💬 Support.`,
  }
  return assertClean(T[lang] || T.en)
}
async function tg(chatId, text) {
  try { return (await axios.post(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN_PROD}/sendMessage`, { chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true }, { timeout: 20000 })).data } catch (e) { return { ok: false, description: e.response?.data?.description || e.message } }
}
// Real REGISTER on our SIP server with the (unchanged) login → true only on 200 OK.
function sipWorks(user, pass) {
  const r = spawnSync('python3', [path.join(__dirname, '../../scripts/sw_sip_register_check.py'), DOMAIN, user, pass, SIP_IP], { encoding: 'utf8', timeout: 30000 })
  return /2nd:\s*SIP\/2\.0 200/.test(r.stdout || '')
}
async function pick(old, taken) {
  const type = old.type === 'toll_free' ? 'toll_free' : 'local'
  const d = String(old.phoneNumber).replace(/\D/g, ''), ac = type === 'local' && d.length === 11 ? d.slice(1, 4) : null
  const rows = await txs.searchNumbers(old.country || 'US', type, ac, type === 'toll_free' ? 50 : 10, AREA_REGION[Number(ac)] || null)
  const r = rows.find(x => !taken.has(x.phone_number) && (type === 'toll_free' || !x._areaFallback || x._fallbackRegion))
  return r ? { phone: r.phone_number, match: type === 'toll_free' ? 'toll-free' : r._areaFallback ? `same state ${r._fallbackRegion}` : 'same area code' } : null
}
async function dropFromBird(phone) {
  for (const v of await bird.listCallerIds().catch(() => [])) if (v.phone_number === phone) { await bird.deleteCallerId(v.id); return true }
  return false
}
// Arms Bird's verification call and waits for the brand app to capture the code (status in birdCallerIdVerify).
async function birdLink(db, phone) {
  const { createBirdVerify } = require('../bird-callerid-verify')
  const v = createBirdVerify({ bird, transcribe: async () => ({}), db, log: () => {} })
  if ((await v.verifiedPresenters()).includes(phone)) return 'already linked'
  const r = await v.arm(phone)
  if (r.error) return `not started — ${r.error}`
  for (let i = 0; i < 40; i++) { await sleep(3000); const d = await db.collection('birdCallerIdVerify').findOne({ _id: phone }); if (d && d.status !== 'calling') return d.status === 'verified' ? 'linked' : `${d.status} ${d.error || ''}` }
  return 'timed out'
}

;(async () => {
  const cl = await MongoClient.connect(process.env.MONGO_URL), db = cl.db(process.env.DB_NAME), col = db.collection('phoneNumbersOf')
  webNotify.setDb(db)
  console.log(`${APPLY ? 'APPLY' : LINK ? 'LINK' : NOTIFY ? 'NOTIFY' : 'DRY RUN'} — brand ${process.env.CHAT_BOT_BRAND} db=${process.env.DB_NAME} app=${ce.app()} SIP ${DOMAIN}`)
  const docs = await col.find(ONLY ? { _id: isNaN(+ONLY) ? ONLY : { $in: [ONLY, +ONLY] } } : {}).toArray()
  const taken = new Set(), skipped = []
  let n = 0, done = 0, failed = 0
  for (const d of docs) {
    const chatId = d._id
    if (LINK || NOTIFY) {
      for (const x of (d.val?.numbers || []).filter(x => x._migrationReason === REASON && ['active', 'suspended'].includes(x.status))) {
        if (n++ >= LIMIT) break
        if (LINK) { console.log(`  chat=${chatId} ${mask(x.phoneNumber)} Bird: ${await birdLink(db, x.phoneNumber)}`); continue }
        if (x._swapNotifiedAt) continue
        const st = await db.collection('state').findOne({ _id: String(chatId) }).catch(() => null)
        const text = notifyText(st?.userLanguage || 'en', x)
        const r = webNotify.isWebChatId(chatId) ? await webNotify.push(chatId, text, null, { kind: 'number', meta: { link: '/app/numbers' } }).then(() => ({ ok: true }), e => ({ ok: false, description: e.message })) : await tg(chatId, text)
        console.log(`  chat=${chatId} ${mask(x.migratedFrom)} → ${mask(x.phoneNumber)} 📨 ${r.ok ? 'sent' : 'NOT sent — ' + r.description}`)
        if (r.ok) await col.updateOne({ _id: chatId }, { $set: { 'val.numbers.$[n]._swapNotifiedAt': new Date().toISOString() } }, { arrayFilters: [{ 'n.phoneNumber': x.phoneNumber }] })
      }
      continue
    }
    for (const old of (d.val?.numbers || []).filter(isOld)) {
      if (n++ >= LIMIT) break
      const tag = `  chat=${chatId} ${mask(old.phoneNumber)} (${old.provider}/${old.status}, ${old.type}, ${old.plan}, exp ${String(old.expiresAt).slice(0, 10)}${old.isSubNumber ? ', sub' : ''}${old.sipUsername ? ', SIP' : ''})`
      try {
        let newPhone = old.migratedTo || null, how = 'resume'
        if (!newPhone) {
          const p = await pick(old, taken)
          if (!p) { console.log(`${tag}\n     ⏭ no matching number — skipped`); skipped.push(`${chatId} ${old.phoneNumber}`); continue }
          newPhone = p.phone; how = p.match; taken.add(newPhone)
        }
        console.log(`${tag}\n     → ${mask(newPhone)} (${how})`)
        if (!APPLY) continue
        const AF = { arrayFilters: [{ 'n.phoneNumber': old.phoneNumber, 'n._released': { $ne: true } }] }
        if (!old.migratedTo) {
          const order = await txs.buyNumber(newPhone)
          if (!order) throw new Error('Telnyx purchase failed')
          await col.updateOne({ _id: chatId }, { $set: { 'val.numbers.$[n].migratedTo': newPhone } }, AF)
        }
        await ce.setDidApps([newPhone])
        const fresh = (await col.findOne({ _id: chatId }))?.val?.numbers || []
        if (!fresh.some(x => x.phoneNumber === newPhone)) {
          const parent = old.isSubNumber ? fresh.find(x => x.phoneNumber === old.parentNumber) : null
          const doc = {
            phoneNumber: newPhone, provider: 'telnyx', status: old.status, country: old.country || 'US', countryName: old.countryName, type: old.type,
            plan: old.plan, planPrice: old.planPrice, expiresAt: old.expiresAt, autoRenew: old.autoRenew !== false,
            purchaseDate: new Date().toISOString(), originalPurchaseDate: old.originalPurchaseDate || old.purchaseDate || null, telnyxOrderId: `tx:${newPhone}`,
            ...(old.sipUsername ? { sipUsername: old.sipUsername, sipPassword: old.sipPassword, telnyxSipUsername: old.telnyxSipUsername || old.sipUsername, telnyxSipPassword: old.telnyxSipPassword || old.sipPassword, telnyxCredentialId: `kam:${old.sipUsername}`, sipDomain: DOMAIN } : {}),
            capabilities: { voice: true, sms: false, fax: false }, smsUsed: old.smsUsed || 0, minutesUsed: old.minutesUsed || 0,
            features: JSON.parse(JSON.stringify(old.features || {})), migratedFrom: old.phoneNumber, migratedFromProvider: old.provider || 'telnyx', migratedAt: new Date().toISOString(), _migrationReason: REASON,
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
        // Old line off the account (bot + web hide released numbers); kept at SignalWire, dropped from Bird.
        await col.updateOne({ _id: chatId }, { $set: { 'val.numbers.$[n].status': 'released', 'val.numbers.$[n]._released': true, 'val.numbers.$[n]._releasedReason': REASON, 'val.numbers.$[n].migratedTo': newPhone, 'val.numbers.$[n].autoRenew': false } }, AF)
        await col.updateOne({ _id: chatId }, { $set: { 'val.numbers.$[s].parentNumber': newPhone } }, { arrayFilters: [{ 's.parentNumber': old.phoneNumber, 's.status': { $in: ['active', 'suspended'] } }] }).catch(() => {})
        const camps = await db.collection('bulkCallCampaigns').updateMany({ chatId: { $in: [chatId, String(chatId)] }, callerId: old.phoneNumber, status: { $ne: 'completed' } }, { $set: { callerId: newPhone, callerIdMigratedFrom: old.phoneNumber } })
        const birdDropped = await dropFromBird(old.phoneNumber)
        await db.collection('phoneTransactions').insertOne({ chatId, phoneNumber: newPhone, action: 'migrate_to_telnyx_sip', fromNumber: old.phoneNumber, plan: old.plan, amount: 0, timestamp: new Date().toISOString() }).catch(() => {})
        const sipOk = old.sipUsername ? sipWorks(old.sipUsername, old.sipPassword) : null
        if (sipOk !== null) await col.updateOne({ _id: chatId }, { $set: { 'val.numbers.$[n]._sipCheckOk': sipOk } }, { arrayFilters: [{ 'n.phoneNumber': newPhone }] })
        console.log(`     ✅ swapped · campaigns moved: ${camps.modifiedCount} · Bird old caller ID removed: ${birdDropped}${sipOk === null ? '' : ` · SIP login ${sipOk ? 'REGISTER 200 OK' : 'REGISTER FAILED'}`}`)
        done++
      } catch (e) { failed++; console.log(`     ❌ ${e.message}`) }
    }
  }
  if (skipped.length) console.log(`SKIPPED (no match): ${skipped.join(', ')}`)
  if (!LINK && !NOTIFY) console.log(`RESULT: ${APPLY ? `swapped=${done} failed=${failed}` : 'dry run'} skipped=${skipped.length}`)
  await cl.close()
  process.exit(0)
})().catch(e => { console.error('ERR', e.message); process.exit(1) })
