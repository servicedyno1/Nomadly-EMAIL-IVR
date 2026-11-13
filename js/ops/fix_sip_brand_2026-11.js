#!/usr/bin/env node
// Moves the SIP logins of customers swapped off Telnyx (2026-11) from SignalWire endpoints to our own SIP server
// (brand address), proves each with a real REGISTER through the SIP server, then sends a corrected message.
//   node js/ops/fix_sip_brand_2026-11.js --env /opt/nomadly/shared/<app>/backend.env [--apply] [--notify]
'use strict'
const fs = require('fs'), path = require('path'), { spawnSync } = require('child_process')
const ARGS = process.argv.slice(2), envf = ARGS[ARGS.indexOf('--env') + 1]
for (const l of fs.readFileSync(envf, 'utf8').split('\n')) { const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) process.env[m[1]] = m[2].replace(/^"|"$/g, '') }
const APPLY = ARGS.includes('--apply'), NOTIFY = ARGS.includes('--notify')
const SIP_IP = process.env.SIP_SERVER_IP || '188.166.34.29'
const { MongoClient } = require('mongodb'), axios = require('axios')
const rest = require('../signalwire/rest'), webNotify = require('../cloudivr-web/notify')
const BRAND_NAME = process.env.BRAND_PHONE_NAME || process.env.CHAT_BOT_BRAND || 'Cloud IVR'
const fmt = p => { const d = String(p || '').replace(/\D/g, ''); return d.length === 11 ? `+1 (${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}` : p }
const brandDomain = (chatId) => (webNotify.isWebChatId(chatId) ? process.env.CLOUDIVR_SIP_DOMAIN || 'sip.cloudivr.net' : process.env.SIP_DOMAIN)
const registers = (domain, user, pass) => {
  const r = spawnSync('python3', [path.join(__dirname, '../../scripts/sw_sip_register_check.py'), domain, user, pass, SIP_IP], { encoding: 'utf8', timeout: 30000 })
  return { ok: /2nd:\s*SIP\/2\.0 200/.test(r.stdout || ''), out: String(r.stdout || r.stderr).trim().replace(/\n/g, ' | ') }
}
const text = (lang, n) => {
  const fr = lang === 'fr'
  const t = fr
    ? `🔧 <b>Correction : votre identifiant SIP ${BRAND_NAME}</b>\n\nDésolés, notre message précédent indiquait une mauvaise adresse de serveur. Utilisez celle-ci dans votre softphone :\n\n📞 Numéro : <code>${fmt(n.phoneNumber)}</code>\nServeur : <code>${n.sipDomain}</code>\nIdentifiant : <code>${n.sipUsername}</code>\nMot de passe : <code>${n.sipPassword}</code>\n\nVotre identifiant et mot de passe ne changent pas — seule l'adresse du serveur change.`
    : `🔧 <b>Correction: your ${BRAND_NAME} SIP login</b>\n\nSorry — our last message showed the wrong server address. Please use this one in your softphone:\n\n📞 Number: <code>${fmt(n.phoneNumber)}</code>\nServer: <code>${n.sipDomain}</code>\nUsername: <code>${n.sipUsername}</code>\nPassword: <code>${n.sipPassword}</code>\n\nYour username and password stay the same — only the server address changed.`
  if (/twilio|telnyx|signalwire|bird/i.test(t)) throw new Error('message names a carrier — not sent')
  return t
}

;(async () => {
  const cl = await MongoClient.connect(process.env.MONGO_URL), db = cl.db(process.env.DB_NAME), col = db.collection('phoneNumbersOf')
  webNotify.setDb(db)
  console.log(`${APPLY ? 'APPLY' : NOTIFY ? 'NOTIFY' : 'DRY RUN'} — ${rest.brandSlug()} db=${process.env.DB_NAME} SIP server ${SIP_IP}`)
  let ok = 0, bad = 0, sent = 0
  for (const d of await col.find({ 'val.numbers.migratedFromProvider': 'telnyx' }).toArray()) for (const n of d.val.numbers) {
    if (n.migratedFromProvider !== 'telnyx' || n.status !== 'active' || !n.sipUsername) continue
    const chatId = d._id, domain = brandDomain(chatId), AF = { arrayFilters: [{ 'n.phoneNumber': n.phoneNumber, 'n.provider': 'signalwire' }] }
    if (NOTIFY) {
      if (!n._brandSipOk || n._brandSipNotifiedAt) continue
      const st = await db.collection('state').findOne({ _id: String(chatId) }).catch(() => null)
      const msg = text(st?.userLanguage, n)
      const r = webNotify.isWebChatId(chatId) ? await webNotify.push(chatId, msg, null, { kind: 'number', meta: { link: '/app/numbers' } }).then(() => ({ ok: true }), e => ({ ok: false, description: e.message }))
        : await axios.post(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN_PROD}/sendMessage`, { chat_id: chatId, text: msg, parse_mode: 'HTML' }, { timeout: 20000 }).then(x => x.data, e => ({ ok: false, description: e.response?.data?.description || e.message }))
      console.log(`  chat=${chatId} ${n.sipUsername}@${n.sipDomain} 📨 ${r.ok ? 'sent' : 'NOT sent — ' + r.description}`)
      if (r.ok) { sent++; await col.updateOne({ _id: chatId }, { $set: { 'val.numbers.$[n]._brandSipNotifiedAt': new Date().toISOString() } }, AF) }
      continue
    }
    console.log(`  chat=${chatId} ${n.sipUsername}: ${n.sipDomain} → ${domain}`)
    if (!APPLY) continue
    if (String(n.telnyxCredentialId || '').startsWith('sw:')) await rest.deleteSipEndpoint(n.telnyxCredentialId).catch(() => {})
    await col.updateOne({ _id: chatId }, { $set: { 'val.numbers.$[n].sipDomain': domain, 'val.numbers.$[n].telnyxCredentialId': `kam:${n.sipUsername}` } }, AF)
    const chk = registers(domain, n.sipUsername, n.sipPassword)
    await col.updateOne({ _id: chatId }, { $set: { 'val.numbers.$[n]._brandSipOk': chk.ok, 'val.numbers.$[n]._sipCheckOk': chk.ok } }, AF)
    chk.ok ? ok++ : bad++
    console.log(`     🔑 REGISTER via ${domain}: ${chk.ok ? '200 OK' : 'FAILED — ' + chk.out}`)
  }
  console.log(NOTIFY ? `RESULT: sent=${sent}` : `RESULT: ok=${ok} failed=${bad}`)
  await cl.close()
})().catch(e => { console.error('ERR', e.message); process.exit(1) })
