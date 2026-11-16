// Dead-number guard test: neutralises dead numbers (strip SIP + auto-renew off), stamps _deadSince, deletes past retention.
'use strict'
process.env.DEAD_NUMBER_RETENTION_DAYS = '30'
const guard = require('../dead-number-guard')

const DAY = 86400000
function fakeCol(docs) {
  const matchDead = (n) => ['released', 'expired', 'cancelled', 'canceled', 'deleted'].includes(String(n.status || '').toLowerCase())
  return {
    find() { return { toArray: async () => docs.filter(d => (d.val?.numbers || []).some(matchDead)) } },
    async updateOne(filter, update, opts) {
      const d = docs.find(x => x._id === filter._id); if (!d) return
      const af = opts?.arrayFilters?.[0]
      const targets = (d.val.numbers || []).filter(n => {
        if (update.$pull) { const p = update.$pull['val.numbers']; return p.phoneNumber.$in.includes(n.phoneNumber) && p.status.$in.includes(n.status) }
        if (af) return n.phoneNumber === af['n.phoneNumber'] && af['n.status'].$in.includes(n.status)
        return false
      })
      if (update.$pull) { d.val.numbers = d.val.numbers.filter(n => !targets.includes(n)); return }
      for (const n of targets) {
        for (const [k, v] of Object.entries(update.$set || {})) n[k.replace('val.numbers.$[n].', '')] = v
        for (const k of Object.keys(update.$unset || {})) delete n[k.replace('val.numbers.$[n].', '')]
      }
    },
  }
}

let pass = 0, fail = 0
const ok = (name, cond) => { cond ? (pass++, console.log('✓', name)) : (fail++, console.log('✗', name)) }

;(async () => {
  const docs = [
    { _id: 'a1', val: { numbers: [
      { phoneNumber: '+1001', status: 'active', sipUsername: 'cvactive11', sipPassword: 'p', autoRenew: true }, // active → untouched
      { phoneNumber: '+1002', status: 'released', sipUsername: 'cvdead0001', sipPassword: 'x', telnyxCredentialId: 'kam:cvdead0001', autoRenew: true }, // no date → neutralise + stamp
      { phoneNumber: '+1003', status: 'released', releasedAt: new Date(Date.now() - 40 * DAY).toISOString(), autoRenew: false }, // old → delete
    ] } },
  ]
  const col = fakeCol(docs)
  const r1 = await guard.runOnce(col, {})

  const nums = () => docs[0].val.numbers
  const active = nums().find(n => n.phoneNumber === '+1001')
  ok('active number untouched', active && active.sipUsername === 'cvactive11' && active.autoRenew === true)
  const d2 = nums().find(n => n.phoneNumber === '+1002')
  ok('dead number SIP login stripped', d2 && !d2.sipUsername && !d2.sipPassword && !d2.telnyxCredentialId)
  ok('dead number auto-renew turned off', d2 && d2.autoRenew === false)
  ok('dead number without date gets _deadSince stamp', d2 && !!d2._deadSince)
  ok('old dead number (40d) hard-deleted', !nums().some(n => n.phoneNumber === '+1003'))
  ok('counts: neutralised>=1, deleted=1, stamped=1', r1.neutralised >= 1 && r1.deleted === 1 && r1.stamped === 1)

  // second run: freshly stamped +1002 is < retention so NOT deleted; nothing left to neutralise
  const r2 = await guard.runOnce(col, {})
  ok('second run keeps the freshly-stamped dead number (within retention)', nums().some(n => n.phoneNumber === '+1002'))
  ok('second run deletes nothing new', r2.deleted === 0)

  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
})()
