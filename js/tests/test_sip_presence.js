// node js/tests/test_sip_presence.js — "softphone isn't signed in" note: only when offline, once per 6 h per number
const assert = require('assert')
const sp = require('../sip-presence')
function fakeDb() {
  const m = { sipPresence: new Map(), appSettings: new Map(), sipOfflineNotices: new Map() }
  const ok = (d, f) => Object.entries(f).every(([k, v]) => k === '_id' ? (v?.$in ? v.$in.includes(d._id) : d._id === v) : v?.$gt ? d[k] > v.$gt : v?.$lt ? d[k] < v.$lt : d[k] === v)
  return { collection: (n) => ({
    findOne: async (f) => [...m[n].values()].find(d => ok(d, f)) || null,
    updateOne: async (f, u, o) => {
      const d = [...m[n].values()].find(x => ok(x, f))
      if (d) { Object.assign(d, u.$set || {}); return { modifiedCount: 1 } }
      if (!o?.upsert) return { modifiedCount: 0 }
      if (m[n].has(f._id)) { const e = new Error('dup'); e.code = 11000; throw e }
      m[n].set(f._id, { _id: f._id, ...(u.$setOnInsert || {}), ...(u.$set || {}) }); return { upsertedCount: 1 }
    },
  }) }
}
;(async () => {
  const db = fakeDb(), sent = []
  const bot = { sendMessage: async (c, t) => sent.push([c, t]) }
  const num = { phoneNumber: '+15550001111', sipUsername: 'cvabc', extraSip: [{ username: 'cvdev2' }] }
  const t0 = new Date('2026-11-16T00:00:00Z'), h = (x) => new Date(t0.getTime() + x * 3600000)
  await sp.record(db, 'someoneelse', 600, 'x', t0)
  assert.strictEqual(await sp.noteIfOffline({ db, bot, chatId: 1, num, from: 'A', log: () => {}, now: h(0.5) }), false, 'warm-up: no note')
  assert.strictEqual(await sp.noteIfOffline({ db, bot, chatId: 1, num, from: 'A', log: () => {}, now: h(2) }), true, 'offline → note')
  assert.strictEqual(await sp.noteIfOffline({ db, bot, chatId: 1, num, from: 'A', log: () => {}, now: h(4) }), false, 'within 6 h → no repeat')
  assert.strictEqual(await sp.noteIfOffline({ db, bot, chatId: 1, num, from: 'A', log: () => {}, now: h(8.5) }), true, 'after 6 h → note again')
  await sp.record(db, 'cvdev2', 600, 'Linphone', h(20))
  assert.strictEqual(await sp.noteIfOffline({ db, bot, chatId: 1, num, from: 'A', log: () => {}, now: h(20.1) }), false, 'extra login online → no note')
  await sp.record(db, 'cvdev2', 0, 'Linphone', h(20.2))
  assert.strictEqual(await sp.noteIfOffline({ db, bot, chatId: 1, num, from: 'A', log: () => {}, now: h(20.3) }), true, 'signed out → note')
  assert.strictEqual(sent.length, 3); assert.ok(/didn't ring/.test(sent[0][1]))
  assert.ok(/SIP tab/.test(sp.offlineText(num, 'A', true)) && /QR Setup/.test(sp.offlineText(num, 'A', false)))
  console.log('test_sip_presence: all passed')
})().catch(e => { console.error(e); process.exit(1) })
