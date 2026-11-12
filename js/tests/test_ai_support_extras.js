// AI support: Bulk IVR quotes, shared contacts/locations read, missed-question catch after admin close.
// Run: node js/tests/test_ai_support_extras.js
const fs = require('fs'), path = require('path')
let pass = 0, fail = 0
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log(`${c ? '✅' : '❌'} ${n}${x ? ` — ${x}` : ''}`) }
;(async () => {
  const q = require('../bulk-ivr-quote')
  ok('count: "50,000 leads"', q.parseCount('dial 50,000 leads batch') === 50000)
  ok('count: "50k numbers"', q.parseCount('cost for 50k numbers?') === 50000)
  ok('country: USA / UK / Nigeria', q.parseCountry('to USA') === 'US' && q.parseCountry('campaign in UK') === 'GB' && q.parseCountry('2000 calls to Nigeria') === 'NG')
  ok('asks cost detection', q.asksIvrCost('how much in total to dial 50000 leads') && !q.asksIvrCost('hello there'))
  const db = { collection: () => ({ aggregate: () => ({ toArray: async () => [{ avg: 1.4, n: 500 }] }) }) }
  const r = await q.quote(50000, 'US', db)
  ok('US quote: $0.15/min, likely 6,750–10,500, max 15,000', r.rate === 0.15 && Math.round(r.low) === 6750 && Math.round(r.likely) === 10500 && Math.round(r.max) === 15000, JSON.stringify({ l: r.low, k: r.likely, m: r.max }))
  const k = await q.bulkIvrKnowledge(db, 'How much in total to dial 50,000 leads?')
  ok('prompt block: rules + computed quote, assumed USA when no country', /BULK IVR PRICING/.test(k) && /COMPUTED QUOTE/.test(k) && /assumed USA/.test(k))
  ok('no computed quote for unrelated text', !/COMPUTED QUOTE for this message/.test(await q.bulkIvrKnowledge(db, 'my domain is down')))
  const ais = fs.readFileSync(path.join(__dirname, '../ai-support.js'), 'utf8')
  ok('AI prompt includes Bulk IVR pricing + shared-items rule', /bulkIvrKnowledge\(_db, userMessage\)/.test(ais) && /promptBase\(\) \+ bulkSms \+ bulkIvr \+ SHARED_RULE/.test(ais))
  const idx = fs.readFileSync(path.join(__dirname, '../_index.js'), 'utf8')
  ok('shared contact / location / venue / poll → text for AI', /\[Shared contact\]/.test(idx) && /\[Shared location\]/.test(idx) && /\[Shared place\]/.test(idx) && /if \(!String\(message \|\| ''\)\.trim\(\) && _shared\) \{ message = _shared/.test(idx))
  ok('both admin close paths record supportClosedAt', (idx.match(/'supportClosedAt', Date\.now\(\)\)/g) || []).length === 2)
  const c = idx.indexOf('// Missed-question catch'), sb = idx.indexOf("  if (action === a.supportChat) {\n    // Bug fix: main-menu buttons")
  ok('catch: 10 min window, skips menu buttons + commands, runs before support branch', c > 0 && c < sb && /Date\.now\(\) - info\.supportClosedAt < 10 \* 60e3/.test(idx) && /!Object\.values\(user\)\.includes\(message\)/.test(idx.slice(c, c + 600)))
  ok('catch reopens session + alerts admin', /set\(supportSessions, chatId, Date\.now\(\)\)[\s\S]{0,120}set\(state, chatId, 'action', a\.supportChat\)[\s\S]{0,200}Support reopened automatically/.test(idx.slice(c, c + 1400)))
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0)
})().catch(e => { console.error(e); process.exit(1) })
