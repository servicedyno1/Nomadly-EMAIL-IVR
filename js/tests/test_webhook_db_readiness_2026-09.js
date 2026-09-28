// Static guards for the ported app-level reliability fix (main fba3a5df, WhiteLabel port).
// Only the app-code portion is ported here (the droplet deploy.sh pipeline from that
// commit is Nomadly-specific and intentionally NOT on the Railway-based WhiteLabel branch).
// Run: node js/tests/test_webhook_db_readiness_2026-09.js
const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '..', '..')
const read = f => fs.readFileSync(path.join(root, f), 'utf8')
let pass = 0, fail = 0
const check = (name, ok) => { ok ? pass++ : fail++; console.log(`${ok ? '✅' : '❌'} ${name}`) }

const idx = read('js/_index.js')

// ── Telegram webhook: DB-readiness guard so updates are re-delivered, not dropped ──
const routeStart = idx.indexOf("app.post('/telegram/webhook'")
const route = idx.slice(routeStart, idx.indexOf('\n})\n', routeStart))
check('webhook: DB guard precedes bot.processUpdate',
  route.indexOf('if (!db)') > -1 && route.indexOf('if (!db)') < route.indexOf('bot.processUpdate'))
check('webhook: returns 503 while DB not ready', /sendStatus\(503\)/.test(route))

// ── /health: reports REAL DB readiness (still always HTTP 200) ──
const healthStart = idx.indexOf("earlyApp.get('/health'")
const health = idx.slice(healthStart, idx.indexOf('\n})\n', healthStart))
check('/health reports real DB readiness (db + isDbHealthy)', /!!db/.test(health) && /isDbHealthy\(\)/.test(health))
check('/health still always HTTP 200', /status\(200\)/.test(health))

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
