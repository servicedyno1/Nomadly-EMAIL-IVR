// Unit test: js/multitel/fax.js pollInbox / pollOutbox / sendFax / searchFax with stubbed mt.api + axios,
// using record shapes from the MultiTEL v3 docs (fax_inbox: hash/from_number/to_number/pages/status; fax_outbox: uuid/from_number/to_number/status/pages_sent/result_text/sent_at)
const path = require('path')
const Module = require('module')
const stub = (file, exports) => { const id = require.resolve(file); const m = new Module(id); m.filename = id; m.loaded = true; m.exports = exports; require.cache[id] = m; return exports }
let pass = 0, fail = 0
const ok = (c, msg) => { if (c) { pass++; console.log('PASS', msg) } else { fail++; console.log('FAIL', msg) } }

const S = { inbox: [], outbox: [], posts: [], gets: [] }
stub('/app/js/multitel/index.js', {
  enabled: () => true, isBlocked: () => false,
  api: async (m, p) => { S.gets.push(p); if (p.startsWith('fax_inbox')) return { status: { code: 200 }, response: { faxes: S.inbox } }; if (p.startsWith('fax_outbox')) return { status: { code: 200 }, response: { faxes: S.outbox } }; return { status: { code: 200 } } },
  searchNumbers: async () => [{ phone_number: '+13475550001', region_information: [{ region_name: 'New York, ' }] }, { phone_number: '+12125550002', region_information: [] }],
  buyNumber: async () => ({ ok: 1 }), releaseNumber: async () => true,
})
stub(require.resolve('axios', { paths: ['/app/js/multitel'] }), {
  post: async (url, form) => { S.posts.push(url); return { status: 200, data: { status: { code: 200 }, response: { job_id: 'abcdef0123456789abcdef0123456789' } } } },
  get: async () => ({ data: Buffer.from('%PDF-1.4 test') }),
})
const f = require('/app/js/multitel/fax.js')

;(async () => {
  // search
  const s = await f.searchFax('US', '212', 5)
  ok(s.length === 2 && s[0].phoneNumber === '+13475550001' && s[0].nearby === true && s[0].region === 'New York', 'searchFax maps rows (nearby flag, trimmed region)')
  ok(s[1].nearby === false, 'searchFax: 212 number not nearby')

  // send
  const id = await f.sendFax({ from: '+13475550001', to: '+12125550124', pdf: Buffer.from('x') })
  ok(id === 'mtfax:abcdef0123456789abcdef0123456789' && S.posts[0] === 'https://api.multitel.net/v3/send_fax', 'sendFax posts to /v3/send_fax and returns mtfax:<job_id>')

  // inbox with doc-shaped record
  S.inbox = [{ id: 12, hash: 'c20ad4d76fe97759aa27a0c99bff6710', from_number: '+12125550123', to_number: '+13475550001', pages: 2, received_at: '2026-10-01 12:00:00', status: 'success' },
    { id: 13, hash: 'deadbeef', from_number: '+12125550999', to_number: '+13475550001', pages: 0, status: 'failed' }]
  const evs = []
  await f.pollInbox(async (e) => evs.push(e), async () => false)
  ok(evs.length >= 1 && evs[0].event_type === 'fax.received' && evs[0].payload.fax_id === 'mtin:c20ad4d76fe97759aa27a0c99bff6710', 'pollInbox emits fax.received with mtin:<hash>')
  ok(evs[0]?.payload.to === '+13475550001', `pollInbox payload.to = receiving number (got "${evs[0]?.payload.to}")`)
  ok(evs[0]?.payload.from === '+12125550123', `pollInbox payload.from = sender (got "${evs[0]?.payload.from}")`)
  ok(Buffer.isBuffer(evs[0]?.payload.pdf), 'pollInbox attaches downloaded PDF')
  ok(!evs.some(e => e.payload.fax_id === 'mtin:deadbeef'), 'pollInbox skips failed inbox records')
  const evs2 = []; await f.pollInbox(async (e) => evs2.push(e), async () => true)
  ok(evs2.length === 0, 'pollInbox skips known faxes')

  // outbox: doc-shaped rows matched to pending faxes
  const created = new Date(Date.now() - 60000)
  const pending = [{ _id: 'mtfax:abcdef0123456789abcdef0123456789', from: '+13475550001', to: '+12125550124', pages: 3, createdAt: created }]
  const sentAt = new Date(Date.now() - 30000).toISOString().replace('T', ' ').slice(0, 19)
  for (const st of ['sent', 'completed', 'success']) {
    S.outbox = [{ id: 13, uuid: 'abcdef0123456789abcdef0123456789', from_number: '+13475550001', to_number: '+12125550124', status: st, pages_requested: 3, pages_sent: 3, result_text: '', created_at: sentAt, sent_at: sentAt }]
    const oe = []; await f.pollOutbox(pending, async (e) => oe.push(e))
    ok(oe.length === 1 && oe[0].event_type === 'fax.delivered', `pollOutbox status "${st}" -> fax.delivered (got ${oe.map(e => e.event_type).join(',') || 'nothing'})`)
  }
  S.outbox = [{ id: 14, uuid: 'abcdef0123456789abcdef0123456789', from_number: '+13475550001', to_number: '+12125550124', status: 'failed', pages_sent: 0, result_text: 'No answer', sent_at: sentAt }]
  const fe = []; await f.pollOutbox(pending, async (e) => fe.push(e))
  ok(fe.length === 1 && fe[0].event_type === 'fax.failed', 'pollOutbox failed -> fax.failed')
  ok(fe[0]?.payload.failure_reason === 'no_answer', `pollOutbox failure_reason from result_text (got "${fe[0]?.payload.failure_reason}")`)
  // Two pending faxes to same recipient: second must not take the first one's result
  S.outbox = [{ id: 15, uuid: 'aaaa0000aaaa0000aaaa0000aaaa0000', from_number: '+13475550001', to_number: '+12125550124', status: 'success', sent_at: sentAt }]
  const qe = []; await f.pollOutbox(pending, async (e) => qe.push(e))
  ok(qe.length === 0, 'pollOutbox does not mark a fax delivered from another job (uuid mismatch)')
  const queued = []; S.outbox = [{ uuid: 'abcdef0123456789abcdef0123456789', from_number: '+13475550001', to_number: '+12125550124', status: 'queued', sent_at: null }]
  await f.pollOutbox(pending, async (e) => queued.push(e))
  ok(queued.length === 0, 'pollOutbox ignores queued rows')
  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
})().catch(e => { console.error(e); process.exit(2) })
