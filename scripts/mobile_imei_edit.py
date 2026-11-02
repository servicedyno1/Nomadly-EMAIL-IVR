p = '/app/js/spenza.js'
s = open(p).read()
def rep(a, b):
    global s
    assert a in s, a[:70]; s = s.replace(a, b, 1)
rep("""const mobileImei = () => (dry() ? '356938035643809' : String(process.env.SPENZA_TEXT_LINE_IMEI || '').replace(/\\D/g, ''))""",
"""// No customer phone for a virtual number: reuse a device IMEI already on file (env override → last real eSIM order → Spenza line device).
async function mobileImei() {
  if (dry()) return '356938035643809'
  const ok = (v) => { const x = String(v || '').replace(/\\D/g, ''); return x.length === 15 ? x : null }
  if (ok(process.env.SPENZA_TEXT_LINE_IMEI)) return ok(process.env.SPENZA_TEXT_LINE_IMEI)
  const cfg = await S.db.collection('spenzaConfig').findOne({ _id: 'mobileImei' })
  if (ok(cfg?.imei)) return cfg.imei
  const last = await S.col.find({ kind: { $ne: 'mobile' }, simulated: { $ne: true }, imei: { $regex: '^\\\\d{15}$' } }).sort({ createdAt: -1 }).limit(1).toArray()
  let imei = ok(last[0]?.imei)
  if (!imei) {
    const r = await call('get', '/api/v1.1/sims?page=1&pageSize=100').catch(() => null)
    const sims = r?.data?.items || r?.data || []
    imei = sims.map(x => ok(x.device?.imei || x.imei)).find(Boolean) || null
  }
  if (imei) await S.db.collection('spenzaConfig').updateOne({ _id: 'mobileImei' }, { $set: { imei, at: new Date() } }, { upsert: true })
  return imei || ''
}""")
rep("return { available: !!plan && mobileImei().length === 15, price: MOBILE_PRICE }", "return { available: !!plan && (await mobileImei()).length === 15, price: MOBILE_PRICE }")
rep("  const im = mobileImei()\n", "  const im = await mobileImei()\n")
open(p, 'w').write(s)
print('ok')
