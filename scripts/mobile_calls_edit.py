B = '/app/js/'
def rep(p, a, b):
    s = open(B + p).read(); assert a in s, (p, a[:60]); open(B + p, 'w').write(s.replace(a, b, 1))
p = 'spenza.js'
rep(p, """// Poll provisioning;""", """// Browser-phone login for a US mobile number: calls go out through Telnyx showing this number (wallet per minute).
async function mobileSip(chatId, phone) {
  const d = await S.col.findOne({ chatId: String(chatId), kind: 'mobile', phoneNumber: phone, status: 'active' })
  if (!d) return null
  if (d.sip?.username) return d.sip
  let sip
  if (d.simulated) sip = { username: 'mnsip' + d._id.slice(3), password: crypto.randomBytes(9).toString('hex'), live: false }
  else {
    const c = await require('./telnyx-service').createSIPCredential(process.env.TELNYX_SIP_CONNECTION_ID, 'mn' + crypto.randomBytes(6).toString('hex'), crypto.randomBytes(12).toString('hex'), phone)
    if (!c?.sip_username) return { error: 'We couldn’t set up calling for this number right now. Try again in a minute.' }
    sip = { username: c.sip_username, password: c.sip_password, credId: c.id || null, live: true }
  }
  await S.col.updateOne({ _id: d._id }, { $set: { sip, updatedAt: new Date() } })
  return sip
}
const dropSip = (d) => d.sip?.credId ? require('./telnyx-service').deleteSIPCredential(d.sip.credId).catch(() => {}) : null

// Poll provisioning;""")
rep(p, """  if (d.kind === 'mobile' && d.phoneNumber) await S.db.collection('webCallerIds').deleteOne({ _id: d.phoneNumber, method: 'auto' })
  return { ok: true }""", """  if (d.kind === 'mobile' && d.phoneNumber) { await S.db.collection('webCallerIds').deleteOne({ _id: d.phoneNumber, method: 'auto' }); dropSip(d) }
  return { ok: true }""")
rep(p, "const api = { init, MOBILE_PRICE, mobileOffer, buyMobile,", "const api = { init, MOBILE_PRICE, mobileOffer, buyMobile, mobileSip,")
p = 'cloudivr-web/numbers.js'
rep(p, """  router.get('/numbers/:phone/sip', withNumber(async (req, res) => {""", """  // US mobile numbers (esimLines kind 'mobile') get a browser-phone login too; calling numbers fall through.
  router.get('/numbers/:phone/sip', async (req, res, next) => {
    try {
      const sip = req.query.browser ? await require('../spenza').mobileSip(req.webChatId, req.params.phone) : null
      if (!sip) return next()
      if (sip.error) return bad(res, 424, 'sip_failed', sip.error)
      res.json({ username: sip.username, password: sip.password, live: !!sip.live, browserOnly: true, mobile: true, browserKey: browserCallKey.mint(req.params.phone) })
    } catch (e) { next(e) }
  })
  router.get('/numbers/:phone/sip', withNumber(async (req, res) => {""")
p = 'voice-service.js'
rep(p, """async function findNumberBySipUser(sipUsername, fromPhone, connectionPhoneNumber) {
  try {""", """async function findNumberBySipUser(sipUsername, fromPhone, connectionPhoneNumber) {
  try {
    // US mobile number browser login → outbound through Telnyx from that number, billed from the wallet like any SIP call.
    const ml = _db && sipUsername ? await _db.collection('esimLines').findOne({ 'sip.username': sipUsername, kind: 'mobile', status: 'active' }) : null
    if (ml) return { chatId: ml.chatId, num: { phoneNumber: ml.phoneNumber, status: 'active', plan: 'business', mobileLine: ml._id, features: {} } }""")
print('ok')
