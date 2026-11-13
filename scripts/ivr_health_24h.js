// Read-only: Quick IVR + OTP + caller-ID health across the 4 brand DBs for the last 24h. Run on the prod droplet.
const { MongoClient } = require('mongodb')
const fs = require('fs')
const BRANDS = { 'app-main': 'Nomadly', 'app-wl': 'Smadav', 'app-voodoo': 'VoodooLand', 'app-proshop': 'ProShop' }
const envVal = (t, k) => (t.match(new RegExp(`^${k}=("?)(.*?)\\1\\s*$`, 'm')) || [])[2]
const since = new Date(Date.now() - 24 * 3600 * 1000)
;(async () => {
  for (const [dir, name] of Object.entries(BRANDS)) {
    const env = fs.readFileSync(`/opt/nomadly/shared/${dir}/backend.env`, 'utf8')
    const url = envVal(env, 'MONGO_URL'), db = envVal(env, 'DB_NAME')
    const cl = await MongoClient.connect(url, { serverSelectionTimeoutMS: 15000 })
    const d = cl.db(db)
    const names = (await d.listCollections().toArray()).map(c => c.name)
    const col = (n) => (names.includes(n) ? d.collection(n) : null)
    const out = { brand: name, db }
    const ivr = col('ivrAnalytics')
    if (ivr) {
      const recent = await ivr.find({ createdAt: { $gte: since } }).toArray().catch(() => [])
      const byProv = {}
      let otp = 0, otpConfirmed = 0, answered = 0, cidRejected = 0
      for (const r of recent) {
        byProv[r.provider || r.carrier || '?'] = (byProv[r.provider || r.carrier || '?'] || 0) + 1
        if (r.ivrMode === 'otp_collect') { otp++; if (r.otpStatus === 'confirmed' || r.otpDigits) otpConfirmed++ }
        if (r.answered || r.callStatus === 'completed' || r.duration > 0) answered++
        if (/caller.?id|rejected|603|607/i.test(`${r.failReason || ''} ${r.hangupCause || ''} ${r.error || ''}`)) cidRejected++
      }
      out.ivr24h = recent.length; out.answered = answered; out.otpCalls = otp; out.otpWithDigits = otpConfirmed; out.providers = byProv; out.callerIdRejected = cidRejected
      const last = await ivr.find({}).sort({ createdAt: -1 }).limit(1).toArray().catch(() => [])
      out.lastIvrAt = last[0]?.createdAt || null
    } else out.ivr24h = 'no ivrAnalytics collection'
    const cidUse = col('callerIdUses'), cidDec = col('callerIdDeclines')
    out.callerIdUses24h = cidUse ? await cidUse.countDocuments({ createdAt: { $gte: since } }).catch(() => '?') : '—'
    out.callerIdDeclines24h = cidDec ? await cidDec.countDocuments({ createdAt: { $gte: since } }).catch(() => '?') : '—'
    console.log(JSON.stringify(out))
    await cl.close()
  }
})().catch(e => { console.error('ERR', e.message); process.exit(1) })
