// Reconciler unit test: active SIP numbers with missing login / wrong domain get fixed; good ones untouched; idempotent.
'use strict'
process.env.SIP_SERVER_SECRET = process.env.SIP_SERVER_SECRET || 'test-secret'
const pc = require('../phone-config')
const notify = require('../cloudivr-web/notify')
const recon = require('../sip-reconciler')

const WEB = (k) => String(notify.WEB_ID_BASE + k) // real web chat ids are numeric >= WEB_ID_BASE

function fakeCol(docs) {
  return {
    find() { return { toArray: async () => docs.filter(d => (d.val?.numbers || []).some(n => n.status === 'active')) } },
    async updateOne(filter, update) {
      const d = docs.find(x => x._id === filter._id)
      const n = d?.val?.numbers?.find(x => x.phoneNumber === filter['val.numbers.phoneNumber'])
      if (!n) return { matchedCount: 0 }
      for (const [k, v] of Object.entries(update.$set || {})) n[k.replace('val.numbers.$.', '')] = v
      return { matchedCount: 1 }
    },
  }
}

let pass = 0, fail = 0
const ok = (name, cond) => { cond ? (pass++, console.log('✓', name)) : (fail++, console.log('✗', name)) }

;(async () => {
  const webDomain = pc.WEB_SIP_DOMAIN
  const docs = [
    { _id: WEB(1), val: { numbers: [ // business, NO login, NO domain → fixed
      { phoneNumber: '+13025550001', status: 'active', plan: 'business', capabilities: { voice: true } },
    ] } },
    { _id: WEB(2), val: { numbers: [ // pro, has login but WRONG domain → domain fixed, login kept
      { phoneNumber: '+13025550002', status: 'active', plan: 'pro', sipUsername: 'cvabcd1234', sipPassword: 'Keep1Pass2xy', sipDomain: 'sip.speechcue.com', capabilities: { voice: true } },
    ] } },
    { _id: WEB(3), val: { numbers: [ // already correct → untouched
      { phoneNumber: '+13025550003', status: 'active', plan: 'business', sipUsername: 'cvzzzz9999', sipPassword: 'Good1Pass2zz', telnyxSipUsername: 'cvzzzz9999', telnyxSipPassword: 'Good1Pass2zz', telnyxCredentialId: 'kam:cvzzzz9999', sipDomain: webDomain, capabilities: { voice: true } },
    ] } },
    { _id: WEB(4), val: { numbers: [
      { phoneNumber: '+13025550006', status: 'active', plan: 'business', kind: 'fax', faxOnly: true, capabilities: { voice: false, fax: true } }, // fax-only → skip
      { phoneNumber: '+13025550005', status: 'released', plan: 'business', capabilities: { voice: true } }, // inactive → skip
    ] } },
    { _id: WEB(5), val: { numbers: [ // starter, NO login → must NOT be granted SIP (only Pro+ get a fresh login)
      { phoneNumber: '+13025550007', status: 'active', plan: 'starter', capabilities: { voice: true } },
    ] } },
    { _id: WEB(6), val: { numbers: [ // grandfathered $75 (standard) WITH an existing login but wrong domain → repaired, kept
      { phoneNumber: '+13025550008', status: 'active', plan: 'standard', sipUsername: 'cvgrand123', sipPassword: 'Gr4nd1Pass2z', sipDomain: 'sip.speechcue.com', capabilities: { voice: true } },
    ] } },
  ]
  const col = fakeCol(docs)
  const r1 = await recon.runOnce(col, {})

  const n1 = docs[0].val.numbers[0]
  ok('missing login minted (short cv username + password)', /^cv[a-z0-9]{8}$/.test(n1.telnyxSipUsername || n1.sipUsername) && !!(n1.telnyxSipPassword || n1.sipPassword))
  ok('missing login gets brand web domain', n1.sipDomain === webDomain)
  ok('missing login gets kam credential', String(n1.telnyxCredentialId).startsWith('kam:'))

  const n2 = docs[1].val.numbers[0]
  ok('wrong domain corrected to brand domain', n2.sipDomain === webDomain)
  ok('existing working username kept (never rotated)', n2.sipUsername === 'cvabcd1234' && n2.sipPassword === 'Keep1Pass2xy')

  const n3 = docs[2].val.numbers[0]
  ok('already-correct number untouched', n3.sipDomain === webDomain && n3.telnyxSipUsername === 'cvzzzz9999')

  ok('fax-only / inactive skipped', !docs[3].val.numbers[0].sipUsername && !docs[3].val.numbers[1].sipUsername)

  const starter = docs[4].val.numbers[0]
  ok('starter with no login is NOT granted SIP (not Pro+)', !starter.sipUsername && !starter.telnyxSipUsername)

  const grand = docs[5].val.numbers[0]
  ok('grandfathered $75 (standard) existing login kept', grand.sipUsername === 'cvgrand123' && grand.sipPassword === 'Gr4nd1Pass2z')
  ok('grandfathered $75 wrong domain corrected', grand.sipDomain === webDomain)

  ok('scanned active SIP-capable numbers (5)', r1.scanned === 5)
  ok('repaired the three fixable ones', r1.repaired === 3)
  ok('starter-with-no-login counted as skippedNoGrant', r1.skippedNoGrant === 1)

  const r2 = await recon.runOnce(col, {})
  ok('second run is a no-op (idempotent)', r2.repaired === 0)

  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
})()
