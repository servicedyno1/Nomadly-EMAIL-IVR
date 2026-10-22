// READ-ONLY verification of migrated numbers (Telnyx + DB + SIP lookup order)
const { MongoClient } = require('mongodb')
const axios = require('axios')
const { loadBrandEnv, maskPhone } = require('./_brand_env')
const ONLY = (process.argv.find(a => a.startsWith('--only=')) || '').split('=')[1]
;(async () => {
  const env = loadBrandEnv('app-main')
  const H = { Authorization: `Bearer ${env.TELNYX_API_KEY}` }
  const c = new MongoClient(env.MONGO_URL, { serverSelectionTimeoutMS: 20000 }); await c.connect()
  const db = c.db(env.DB_NAME)
  const q = ONLY ? { _id: { $in: [ONLY, +ONLY] } } : { 'val.numbers.migratedFromProvider': 'twilio' }
  const docs = await db.collection('phoneNumbersOf').find(q).toArray()
  const all = await db.collection('phoneNumbersOf').find({}).toArray()
  let ok = 0, bad = 0
  const chk = (cond, msg) => { if (cond) ok++; else { bad++; console.log('   ❌', msg) } }
  for (const d of docs) {
    for (const n of (d.val.numbers || []).filter(x => x.migratedFromProvider === 'twilio')) {
      const old = (d.val.numbers || []).filter(x => x.phoneNumber === n.migratedFrom)
      console.log(`chat=${d._id} ${maskPhone(n.migratedFrom)} → ${maskPhone(n.phoneNumber)}`)
      const t = (await axios.get('https://api.telnyx.com/v2/phone_numbers', { headers: H, params: { 'filter[phone_number]': n.phoneNumber } })).data.data[0]
      chk(t && t.status === 'active', `Telnyx status ${t?.status}`)
      chk(t && t.connection_id === env.TELNYX_CALL_CONTROL_APP_ID, `connection is not the brand Call Control App (${t?.connection_id})`)
      chk(t && t.messaging_profile_id === env.TELNYX_MESSAGING_PROFILE_ID, 'messaging profile not set')
      chk(n.status === 'active' && n.provider === 'telnyx', 'new record not active telnyx')
      chk(old.length > 0 && old.every(o => o.status === 'released' && o._releasedReason === 'migrated_to_telnyx' && o.migratedTo === n.phoneNumber && o.autoRenew === false), 'old record(s) not retired correctly')
      const o = old.sort((a, b) => new Date(b.expiresAt) - new Date(a.expiresAt))[0] || {}
      chk(String(n.expiresAt) === String(o.expiresAt), `expiry changed ${n.expiresAt} vs ${o.expiresAt}`)
      chk(n.plan === o.plan && n.planPrice === o.planPrice, 'plan/price changed')
      chk(JSON.stringify(n.features) === JSON.stringify(o.features), 'features differ')
      chk(n.telnyxSipUsername === o.telnyxSipUsername && n.sipPassword === o.telnyxSipPassword, 'SIP login not reused')
      chk(!!o.isSubNumber === !!n.isSubNumber, 'sub-number flag differs')
      // replicate voice-service findNumberBySipUser ordering
      let hit = null
      outer: for (const u of all) for (const x of u.val?.numbers || []) {
        if (x.status !== 'active' && x.status !== 'suspended') continue
        if ((x.telnyxSipUsername && x.telnyxSipUsername === n.telnyxSipUsername) || (x.sipUsername && x.sipUsername === n.telnyxSipUsername)) { hit = x; break outer }
      }
      chk(hit && hit.phoneNumber === n.phoneNumber, `SIP lookup resolves to ${hit ? maskPhone(hit.phoneNumber) + '/' + hit.provider + '/' + hit.status : 'nothing'} instead of the new number`)
      console.log(`   plan=${n.plan} exp=${String(n.expiresAt).slice(0, 10)} autoRenew=${n.autoRenew} vm=${!!n.features?.voicemail?.enabled} fwd=${n.features?.callForwarding?.enabled ? n.features.callForwarding.mode : 'off'} sub=${!!n.isSubNumber}`)
    }
  }
  console.log(`\nCHECKS: ${ok} passed, ${bad} failed`)
  await c.close()
  process.exit(bad ? 1 : 0)
})().catch(e => { console.error('ERR', e.message); process.exit(1) })
