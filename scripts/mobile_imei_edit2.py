p = '/app/js/spenza.js'
s = open(p).read()
def rep(a, b):
    global s
    assert a in s, a[:70]; s = s.replace(a, b, 1)
rep("""// No customer phone for a virtual number: reuse a device IMEI already on file (env override → last real eSIM order → Spenza line device).
async function mobileImei() {""", """// No customer phone for a virtual number: use the IMEI of the owner's own line (env override → the owner's prelinked line on Spenza).
// Never a customer's device. A miss is cached for 10 minutes so the public offer endpoint doesn't hit Spenza each time.
let imeiMiss = 0
async function mobileImei() {""")
rep("""  const last = await S.col.find({ kind: { $ne: 'mobile' }, simulated: { $ne: true }, imei: { $regex: '^\\\\d{15}$' } }).sort({ createdAt: -1 }).limit(1).toArray()
  let imei = ok(last[0]?.imei)
  if (!imei) {
    const r = await call('get', '/api/v1.1/sims?page=1&pageSize=100').catch(() => null)
    const sims = r?.data?.items || r?.data || []
    imei = sims.map(x => ok(x.device?.imei || x.imei)).find(Boolean) || null
  }
  if (imei) await S.db.collection('spenzaConfig').updateOne({ _id: 'mobileImei' }, { $set: { imei, at: new Date() } }, { upsert: true })
  return imei || ''""", """  if (Date.now() - imeiMiss < 10 * 60000) return ''
  const r = await call('get', '/api/v1.1/sims?page=1&pageSize=100').catch(() => null)
  const own = new Set(PRELINK.map(x => x.phone))
  const imei = (r?.data?.items || r?.data || []).filter(x => own.has(x.phoneNumber) && x.status === 'ACTIVE').map(x => ok(x.device?.imei || x.imei)).find(Boolean) || null
  if (!imei) { imeiMiss = Date.now(); return '' }
  await S.db.collection('spenzaConfig').updateOne({ _id: 'mobileImei' }, { $set: { imei, at: new Date() } }, { upsert: true })
  return imei""")
rep("""    S.log(`[mobile] create ${_id}: ${e.message}`)""", """    S.log(`[mobile] create ${_id}: ${e.message}`)
    if (/imei/i.test(e.message)) await S.db.collection('spenzaConfig').deleteOne({ _id: 'mobileImei' })""")
open(p, 'w').write(s)
print('ok')
