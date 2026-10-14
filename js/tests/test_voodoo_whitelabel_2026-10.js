// Voodoo Land white-label (2026-10-14): shared-Telnyx-account safety, brand-correct SMS-app links/accents,
// per-app frontend brand build in deploy.sh. No network — axios is stubbed.
//   node js/tests/test_voodoo_whitelabel_2026-10.js
const path = require('path')
const fs = require('fs')
const { execFileSync } = require('child_process')
const Module = require('module')

let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log('  ✓', m) } else { fail++; console.log('  ✗', m) } }

// ── Fake Telnyx (axios stub) ──
const patches = []
const posts = []
const NUMBERS = [
  { id: 'n1', phone_number: '+15550000001', connection_id: 'NOMADLY_CCA' },
  { id: 'n2', phone_number: '+15550000002', connection_id: 'NOMADLY_SIP' },
  { id: 'n3', phone_number: '+15550000003', connection_id: 'VOODOO_CCA' },
]
const fakeAxios = {
  get: async (url) => {
    if (url.endsWith('/phone_numbers')) return { data: { data: NUMBERS } }
    if (url.includes('/credential_connections/')) return { data: { data: { outbound: { outbound_voice_profile_id: 'ovp' } } } }
    if (url.endsWith('/call_control_applications')) return { data: { data: [{ id: 'NOMADLY_CCA', application_name: 'Nomadly Cloud Phone Voice' }] } }
    return { data: { data: [] } }
  },
  patch: async (url, body) => { patches.push({ url, body }); return { data: { data: { id: url.split('/').pop() } } } },
  post: async (url, body) => { posts.push({ url, body }); return { data: { data: null } } },
  delete: async () => ({ data: {} }),
}
const origLoad = Module._load
Module._load = function (req, parent, isMain) { return req === 'axios' ? fakeAxios : origLoad.apply(this, arguments) }
const telnyx = require('../telnyx-service.js')
Module._load = origLoad

;(async () => {
  console.log('\n[1] migrateNumbersToCallControlApp — a brand with NO numbers in its DB never grabs the shared account')
  patches.length = 0
  await telnyx.migrateNumbersToCallControlApp('VOODOO_CCA', [], 'VOODOO_SIP')
  ok(!patches.some(p => p.body.connection_id === 'VOODOO_CCA'), 'no Nomadly number re-pointed to Voodoo CCA')
  ok(!patches.some(p => /\/phone_numbers\/n1$|\/phone_numbers\/n2$/.test(p.url)), 'Nomadly numbers n1/n2 untouched')
  ok(patches.length === 1 && patches[0].url.endsWith('/phone_numbers/n3') && patches[0].body.connection_id === 'VOODOO_SIP', 'stray number on Voodoo CCA detached to Voodoo SIP (own resources only)')

  console.log('\n[2] migrate — bot-owned numbers still migrate as before')
  patches.length = 0
  await telnyx.migrateNumbersToCallControlApp('NOMADLY_CCA', ['+1 (555) 000-0002', '+15550000001'], 'NOMADLY_SIP')
  ok(patches.length === 1 && patches[0].url.endsWith('/phone_numbers/n2') && patches[0].body.connection_id === 'NOMADLY_CCA', 'owned n2 moved to own CCA; owned n1 already correct')
  ok(!patches.some(p => p.url.endsWith('/phone_numbers/n3')), 'other brand number n3 (not on own CCA) skipped')

  console.log('\n[3] initializeTelnyxResources — names are brand-scoped (never adopts Nomadly resources by name)')
  patches.length = 0; posts.length = 0
  process.env.CHAT_BOT_BRAND = 'Voodoo Land'
  delete process.env.TELNYX_SIP_CONNECTION_ID; delete process.env.TELNYX_MESSAGING_PROFILE_ID; delete process.env.TELNYX_CALL_CONTROL_APP_ID
  process.env.TELNYX_SIP_PASSWORD = 'x'
  await telnyx.initializeTelnyxResources('https://voodooivr.xyz')
  const names = posts.map(p => p.body.connection_name || p.body.name || p.body.application_name)
  ok(names.includes('Voodoo Land Cloud Phone SIP') && names.includes('Voodoo Land Cloud Phone SMS') && names.includes('Voodoo Land Cloud Phone Voice'), `creates Voodoo-named resources (${names.join(' | ')})`)
  ok(!patches.some(p => p.url.includes('NOMADLY_CCA')), 'does NOT patch the existing "Nomadly Cloud Phone Voice" app webhook')
  process.env.CHAT_BOT_BRAND = 'Nomadly'; posts.length = 0
  await telnyx.initializeTelnyxResources('https://2.speechcue.com')
  ok(posts.some(p => p.body.application_name === 'Nomadly Cloud Phone Voice'), 'Nomadly keeps its original resource names')

  console.log('\n[4] SMS-app brand registry + accents')
  const brands = require('../../sms-app/brands/brands.json')
  const sb = require('../sms-app-brand.js')
  for (const [env, slug, accent, bot] of [['Nomadly', 'nomadly', '#10d9a0', 'NomadlyBot'], ['Smadav', 'smadav', '#3b82f6', 'smadavv_bot'], ['Voodoo Land', 'voodooland', '#14B8A6', 'Voodoo_landbot']]) {
    process.env.CHAT_BOT_BRAND = env; delete process.env.TELEGRAM_BOT_USERNAME; delete process.env.BOT_USERNAME
    ok(sb.brandSlug() === slug && !!brands[slug], `${env} → slug ${slug} has a brands.json entry`)
    ok(sb.accent() === accent, `${env} accent ${sb.accent()}`)
    ok(sb.botUsername() === bot && sb.botUrl() === `https://t.me/${bot}`, `${env} bot link ${sb.botUrl()}`)
  }
  ok(brands.voodooland.appId === 'com.voodoo.sms' && brands.voodooland.apiBase === 'https://voodooivr.xyz' && brands.voodooland.apk === 'voodooland-sms.apk', 'Voodoo app id / api base / apk name')
  for (const f of ['mark.png', 'wordmark.png', 'logo.png']) ok(fs.existsSync(path.join(__dirname, '../assets/brand/voodooland', f)), `served brand asset voodooland/${f}`)
  process.env.CHAT_BOT_BRAND = 'Voodoo Land'
  ok(String(fs.readFileSync(path.join(__dirname, '../config.js'), 'utf8')).includes("require('./sms-app-brand.js').accent()"), 'payment page accent comes from the brand registry')

  console.log('\n[5] SMS app — every Subscribe/Upgrade link uses the brand bot (no hardcoded NomadlyBot)')
  const appJs = fs.readFileSync(path.join(__dirname, '../../sms-app/www/js/app.js'), 'utf8')
  const hard = appJs.split('\n').filter(l => /t\.me\/NomadlyBot/.test(l))
  ok(hard.length === 0, `no hardcoded t.me/NomadlyBot links in app.js (${hard.length})`)
  ok(/href="\$\{this\.brand\(\)\.botUrl\}" class="btn btn-subscribe"/.test(appJs), 'campaigns empty-state Subscribe → brand botUrl')
  const html = fs.readFileSync(path.join(__dirname, '../../sms-app/www/index.html'), 'utf8')
  const subs = html.split('\n').filter(l => /btn-subscribe|Open <span data-brand="botHandle">/.test(l))
  ok(subs.length >= 2 && subs.every(l => l.includes('data-brand-href="botUrl"')), 'index.html Subscribe/Open buttons are rewritten to the brand bot at runtime')
  // Run the app's brand() + applyBrand() logic against each brand.js
  for (const [bot] of [['NomadlyBot'], ['smadavv_bot'], ['Voodoo_landbot']]) {
    const win = { BRAND: { slug: 'x', name: 'X', botUsername: bot } }
    const brandFn = new Function('window', `return (${appJs.match(/brand\(\) \{[\s\S]*?\n  \},/)[0].replace(/^brand\(\) /, 'function () ').replace(/,$/, '')})`)(win)
    ok(brandFn().botUrl === `https://t.me/${bot}`, `brand() botUrl for ${bot}`)
  }
  for (const slug of ['voodooland']) {
    const apk = path.join(__dirname, '../../static', `${slug}-sms.apk`)
    if (fs.existsSync(apk)) {
      const bj = execFileSync('unzip', ['-p', apk, 'assets/public/js/brand.js']).toString()
      const aj = execFileSync('unzip', ['-p', apk, 'assets/public/js/app.js']).toString()
      ok(bj.includes("botUrl: 'https://t.me/Voodoo_landbot'") && bj.includes("apiBase: 'https://voodooivr.xyz'") && bj.includes("slug: 'voodooland'"), 'voodooland APK bakes Voodoo bot + api base')
      ok(!/t\.me\/NomadlyBot/.test(aj), 'voodooland APK app.js has no NomadlyBot link')
    } else ok(false, `${slug} APK present`)
  }

  console.log('\n[6] deploy.sh — REACT_APP_* from the app backend.env drive the frontend build')
  const sh = fs.readFileSync(path.join(__dirname, '../../scripts/droplet_deploy.sh'), 'utf8')
  const fns = sh.slice(sh.indexOf('fe_env_lines()'), sh.indexOf('prev_fe_tree()'))
  const tmp = fs.mkdtempSync('/tmp/feenv-')
  fs.writeFileSync(`${tmp}/backend.env`, 'PORT=5003\nREACT_APP_BRAND_NAME="Voodoo Land"\nREACT_APP_BRAND_COLOR="#14B8A6"\nREACT_APP_PANEL_DOMAIN=panel.voodoohost.xyz\n')
  fs.mkdirSync(`${tmp}/empty`); fs.writeFileSync(`${tmp}/empty/backend.env`, 'PORT=5000\n')
  const run = (shared, cmd) => execFileSync('bash', ['-c', `SHARED=${shared}; rel_field(){ sed -n "s/^$2=//p" "$1/RELEASE" 2>/dev/null | head -1; }; ${fns}\n${cmd}`]).toString().trim()
  ok(run(tmp, 'export_fe_env; echo "$REACT_APP_BRAND_NAME|$REACT_APP_BRAND_COLOR|$REACT_APP_PANEL_DOMAIN"') === 'Voodoo Land|#14B8A6|panel.voodoohost.xyz', 'quoted values exported unquoted')
  ok(run(`${tmp}/empty`, 'fe_env_sig') === 'none', 'app without REACT_APP_* (Nomadly) → signature "none" (build reuse unchanged)')
  ok(/^[0-9a-f]{40}$/.test(run(tmp, 'fe_env_sig')), 'branded app → sha signature')
  ok(run(tmp, 'prev_fe_env /nonexistent') === 'none', 'old release without fe_env reads as "none" → branded app rebuilds once')
  ok(sh.includes('[ "$(prev_fe_env "$prev")" = "$fe_env" ]') && sh.includes('export_fe_env && DISABLE_ESLINT_PLUGIN'), 'reuse check + build both use fe_env')
  execFileSync('bash', ['-n', path.join(__dirname, '../../scripts/droplet_deploy.sh')])
  ok(true, 'deploy.sh syntax OK')

  console.log('\n[7] workflows — app-voodoo deploys after app-wl from one dispatch')
  const yaml = require('js-yaml')
  const dep = yaml.load(fs.readFileSync(path.join(__dirname, '../../.github/workflows/deploy.yml'), 'utf8'))
  ok(dep.jobs['deploy-voodoo']?.needs === 'deploy-wl' && /app-voodoo/.test(JSON.stringify(dep.jobs['deploy-voodoo'].steps)), 'deploy-voodoo job runs deploy.sh app-voodoo after deploy-wl')
  ok(dep.on.workflow_dispatch.inputs.app.options.includes('whitelabel') && dep.on.workflow_dispatch.inputs.app.options.includes('app-voodoo'), 'dispatch options include app-voodoo + whitelabel')
  const sync = fs.readFileSync(path.join(__dirname, '../../.github/workflows/sync-whitelabel.yml'), 'utf8')
  ok(sync.includes('-f app=whitelabel') && !sync.includes('-f app=app-wl'), 'sync dispatches ONE whitelabel run (no queued run can cancel the other)')

  console.log(`\n${pass} passed / ${fail} failed`)
  process.exit(fail ? 1 : 0)
})().catch(e => { console.error('FATAL', e); process.exit(1) })
