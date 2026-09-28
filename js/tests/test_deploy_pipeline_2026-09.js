// Static guards for the droplet auto-deploy pipeline (2026-09 review fixes).
// Run: node js/tests/test_deploy_pipeline_2026-09.js
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const root = path.resolve(__dirname, '..', '..')
const read = f => fs.readFileSync(path.join(root, f), 'utf8')
let pass = 0, fail = 0
const check = (name, ok) => { ok ? pass++ : fail++; console.log(`${ok ? '✅' : '❌'} ${name}`) }

// ── App: webhook + health readiness ──
const idx = read('js/_index.js')
const routeStart = idx.indexOf("app.post('/telegram/webhook'")
const route = idx.slice(routeStart, idx.indexOf('\n})\n', routeStart))
check('webhook: DB guard precedes bot.processUpdate', route.indexOf('if (!db)') > -1 && route.indexOf('if (!db)') < route.indexOf('bot.processUpdate'))
check('webhook: returns 503 while DB not ready', /sendStatus\(503\)/.test(route))
const healthStart = idx.indexOf("earlyApp.get('/health'")
const health = idx.slice(healthStart, idx.indexOf('\n})\n', healthStart))
check('/health reports real DB readiness (db + isDbHealthy)', /!!db/.test(health) && /isDbHealthy\(\)/.test(health))
check('/health still always HTTP 200', /status\(200\)/.test(health))

// ── deploy.sh ──
const shPath = path.join(root, 'scripts/droplet_deploy.sh')
const sh = read('scripts/droplet_deploy.sh')
let syntaxOk = true
try { execFileSync('bash', ['-n', shPath]) } catch { syntaxOk = false }
check('deploy.sh: bash -n ok', syntaxOk)
for (const [n, re] of [
  ['survives SSH drop (trap HUP) + on-box log', /trap '' HUP/.test(sh) && /tee -a -p/.test(sh)],
  ['single-flight lock per app', /flock -w/.test(sh)],
  ['atomic frontend build (BUILD_PATH=build.next, swap on success)', /BUILD_PATH=build\.next/.test(sh) && /mv frontend\/build\.next frontend\/build/.test(sh)],
  ['waits for /health "healthy"', /"status": \*"healthy"/.test(sh)],
  ['detects pm2 crash loop', /crash loop/.test(sh)],
  ['rolls back to previous commit on failure', /git reset --hard "\$BEFORE"/.test(sh)],
  ['self-updates installed copy from the app-main checkout only', /\[ "\$APP" = "app-main" \] && \[ -f scripts\/droplet_deploy\.sh \] && ! cmp -s scripts\/droplet_deploy\.sh "\$SELF"/.test(sh)],
  ['prunes backups older than 30 days', /-mtime \+30 -delete/.test(sh)],
  ['ignores lockfile noise in backups', /:\(exclude\)yarn\.lock/.test(sh) && /:\(exclude\)package-lock\.json/.test(sh)],
  ['never auto-starts a new pm2 app', /pm2 describe "\$APP"/.test(sh)],
  ['Telegram admin notice on success + failure', /notify "✅/.test(sh) && /notify "❌/.test(sh)],
  ['smart deps still keyed on package.json', /PKG_BEFORE.*!=.*PKG_AFTER/.test(sh)],
]) check(`deploy.sh: ${n}`, re)

// ── workflow ──
const wf = read('.github/workflows/deploy.yml')
for (const [n, ok] of [
  ['paths-ignore skips docs-only pushes', /paths-ignore:[\s\S]*'memory\/\*\*'[\s\S]*'\*\*\.md'/.test(wf)],
  ['timeout-minutes set', /timeout-minutes: \d+/.test(wf)],
  ['secrets only via env (never inline in shell)', !/["'][^\n]*\$\{\{ secrets\./.test(wf) && /SSH_KEY: \$\{\{ secrets\.DROPLET_SSH_KEY \}\}/.test(wf)],
  ['ssh keepalive', /ServerAliveInterval=30/.test(wf)],
  ['strict host key checking', /StrictHostKeyChecking=yes/.test(wf)],
  ['no GITHUB_TOKEN permissions', /^permissions: \{\}/m.test(wf)],
  ['serialised deploys', /concurrency:[\s\S]*cancel-in-progress: false/.test(wf)],
  ['still targets app-main on main', /branches: \[main\]/.test(wf) && /deploy\.sh app-main/.test(wf)],
]) check(`workflow: ${n}`, ok)

check('frontend/.gitignore ignores build.next/build.prev', /\/build\.next/.test(read('frontend/.gitignore')) && /\/build\.prev/.test(read('frontend/.gitignore')))

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
