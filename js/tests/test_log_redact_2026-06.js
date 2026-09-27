/**
 * Domain log-redaction guard (2026-06).
 * Ensures customer domains are masked in logs while infra/code tokens are not.
 * Run: node js/tests/test_log_redact_2026-06.js   (exit 0 = pass)
 */
process.env.SELF_URL = 'https://store.mynomadly.app'
process.env.LOG_REDACT_KEEP = 'keepme.com'
const { redactDomains } = require('../log-redact.js')

const cases = [
  // customer domains → masked
  ['Zone not found on CF for accesd-securite.ca — removed', 'Zone not found on CF for *** — removed'],
  ['[Domain] crashed foo-bar.io for chat 123', '[Domain] crashed *** for chat 123'],
  ["reply: What's next with mshop.store? to: 55", "reply: What's next with ***? to: 55"],
  ['visit https://secret-site.xyz/path now', 'visit https://***/path now'],
  ['email user@gmail.com bounced', 'email user@*** bounced'],
  ['multi a.com and b.net here', 'multi *** and *** here'],
  // infra / own domains → kept
  ['POST api.telegram.org/bot/sendMessage', 'POST api.telegram.org/bot/sendMessage'],
  ['CF via cloudflareapi.com created', 'CF via cloudflareapi.com created'],
  ['dynopay.com webhook received', 'dynopay.com webhook received'],
  ['panel.1.hostbay.io provisioned', 'panel.1.hostbay.io provisioned'],
  ['deploy myapp.up.railway.app done', 'deploy myapp.up.railway.app done'],
  ['mongo cluster0.abcde.mongodb.net', 'mongo cluster0.abcde.mongodb.net'],
  ['self store.mynomadly.app healthy', 'self store.mynomadly.app healthy'],
  ['operator keepme.com stays', 'operator keepme.com stays'],
  // code tokens / non-domains → untouched
  ['[Store] err in store-routes.js:220', '[Store] err in store-routes.js:220'],
  ['failed: e.message undefined', 'failed: e.message undefined'],
  ['at Object.assign (node:internal)', 'at Object.assign (node:internal)'],
  ['calling process.exit now', 'calling process.exit now'],
  ['Node.js runtime v20.11.1', 'Node.js runtime v20.11.1'],
  ['JSON.stringify(result) ok', 'JSON.stringify(result) ok'],
  ['config.completed and progress.done', 'config.completed and progress.done'],
  ['draft.message queued, err.stack trimmed', 'draft.message queued, err.stack trimmed'],
  ['ip 10.0.0.1 and 192.168.1.5 kept', 'ip 10.0.0.1 and 192.168.1.5 kept'],
  ['no dots here at all', 'no dots here at all'],
  [42, 42], // non-strings pass through
]

let pass = 0, fail = 0
for (const [inp, exp] of cases) {
  const got = redactDomains(inp)
  if (got === exp) pass++
  else { fail++; console.log(`❌ in:${JSON.stringify(inp)}\n   exp:${JSON.stringify(exp)}\n   got:${JSON.stringify(got)}`) }
}
console.log(`\nlog-redact: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
