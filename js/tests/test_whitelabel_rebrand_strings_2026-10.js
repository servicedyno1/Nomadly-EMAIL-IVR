#!/usr/bin/env node
// White-label rebrand regression: verifies user-facing strings render CHAT_BOT_BRAND / CHAT_BOT_NAME / BOT_USERNAME
// for every brand (Voodoo Land, Smadav, PROSHOP, Nomadly main) and that AST rewrite left no broken quoting.
// Each brand runs in a fresh child process (env must be set before require).
const { spawnSync } = require('child_process')
const path = require('path')
const fs = require('fs')
const acorn = require('acorn')

const ROOT = path.join(__dirname, '..', '..')
let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log('  ✅ ' + m) } else { fail++; console.log('  ❌ ' + m) } }

const BRANDS = [
  { CHAT_BOT_BRAND: 'Voodoo Land', CHAT_BOT_NAME: 'Voodoo Land Bot', BOT_USERNAME: 'Voodoo_landbot' },
  { CHAT_BOT_BRAND: 'Smadav', CHAT_BOT_NAME: 'Smadav Bot', BOT_USERNAME: 'smadavv_bot' },
  { CHAT_BOT_BRAND: 'PROSHOP', CHAT_BOT_NAME: 'PROSHOP Bot', BOT_USERNAME: 'ProshopHQ_bot' },
  { main: true },
  { main: true, CHAT_BOT_BRAND: 'Nomadly' },
]

// ── child mode: render everything and print JSON ──
if (process.argv[2] === '--child') {
  const out = { strings: [], errors: [] }
  const seen = new WeakSet()
  const dummy = ['123456', 'example.com', '5', 'Plan', 'x', 'y', 'z', 'w']
  const collect = (v, where, depth = 0) => {
    if (depth > 9 || v == null) return
    if (typeof v === 'string') return out.strings.push({ where, s: v })
    if (typeof v === 'function') {
      try { const r = v(...dummy); collect(r, where + '()', depth + 1) } catch (e) { /* dummy args may not fit */ }
      return
    }
    if (typeof v === 'object') {
      if (seen.has(v)) return; seen.add(v)
      if (Array.isArray(v)) return v.forEach((x, i) => collect(x, `${where}[${i}]`, depth + 1))
      for (const k of Object.keys(v)) collect(v[k], `${where}.${k}`, depth + 1)
    }
  }
  for (const l of ['en', 'fr', 'zh', 'hi']) {
    try { collect(require(path.join(ROOT, 'js/lang', l + '.js')), 'lang/' + l) } catch (e) { out.errors.push(l + ': ' + e.message) }
  }
  try {
    const sp = require(path.join(ROOT, 'js/sanitize-provider.js'))
    out.sanitizerExports = Object.keys(sp)
    const input = 'Registered via OpenProvider and ConnectReseller, hosted on Railway, VPS by Contabo, openprovider connectreseller'
    out.sanitized = {}
    for (const k of Object.keys(sp)) if (typeof sp[k] === 'function') { try { out.sanitized[k] = sp[k](input) } catch (e) { out.sanitized[k] = 'ERR ' + e.message } }
  } catch (e) { out.errors.push('sanitize: ' + e.message) }
  try {
    const pc = require(path.join(ROOT, 'js/phone-config.js'))
    collect(pc, 'phone-config')
    for (const l of ['en', 'fr', 'zh', 'hi']) { const t = pc.getTxt(l); collect(t.testMyNumber, 'phone-config.getTxt.' + l + '.testMyNumber') }
  } catch (e) { out.errors.push('phone-config: ' + e.message) }
  try {
    const tm = require(path.join(ROOT, 'js/test-my-number.js'))
    out.tmExports = Object.keys(tm)
    collect(tm, 'test-my-number')
  } catch (e) { out.errors.push('test-my-number: ' + e.message) }
  try {
    const me = require(path.join(ROOT, 'js/monetization-engine.js'))
    out.meExports = Object.keys(me)
    collect(me, 'monetization')
  } catch (e) { out.errors.push('monetization: ' + e.message) }
  // Evaluate Refer & Earn template from _index.js source with env
  const src = fs.readFileSync(path.join(ROOT, 'js/_index.js'), 'utf8')
  const start = src.indexOf("const botUsername = process.env.BOT_USERNAME || 'Nomadlybot'")
  const msgStart = src.indexOf('const msg = `🤝 <b>Refer & Earn', start)
  const msgEnd = src.indexOf('<i>Bonuses land in your wallet automatically.</i>`', msgStart)
  const snippet = src.slice(start, msgEnd + '<i>Bonuses land in your wallet automatically.</i>`'.length)
  try {
    const linkLine = src.slice(src.indexOf('const referralLink', start), src.indexOf('\n', src.indexOf('const referralLink', start)))
    const fn = new Function('chatId', 'totalReferred', 'qualified', 'totalEarned', 'pendingLines',
      "const botUsername = process.env.BOT_USERNAME || 'Nomadlybot'\n" + linkLine + '\n' + src.slice(msgStart, msgEnd + 51) + '\nreturn { referralLink, msg }')
    out.refer = fn(777, 0, 0, 0, '')
  } catch (e) { out.errors.push('refer eval: ' + e.message) }
  // Quick Tour
  const qt = src.indexOf("en: ('🎬 <b>Quick Tour</b>")
  const qtEnd = src.indexOf('}', src.indexOf("hi: ('🎬", qt))
  try { out.quickTour = new Function('return {' + src.slice(qt, qtEnd) + '}')() } catch (e) { out.errors.push('quickTour eval: ' + e.message) }
  // refLink occurrences
  out.refLinkLines = src.split('\n').map((l, i) => [i + 1, l]).filter(([, l]) => /const refLink = /.test(l)).map(([n, l]) => n + ': ' + l.trim())
  fs.writeFileSync(process.env.__OUT_FILE, JSON.stringify(out))
  process.exit(0)
  return
}

const BASE_ROOT = path.join(require('os').tmpdir(), 'wl_base_' + process.pid)
function prepBaseline() {
  const r = spawnSync('bash', ['-c', `mkdir -p ${BASE_ROOT} && cd ${ROOT} && git archive "$(git log --diff-filter=A --format=%H -1 -- scripts/rebrand_strings.js)^" js | tar -x -C ${BASE_ROOT} && ln -sfn ${ROOT}/node_modules ${BASE_ROOT}/node_modules && mkdir -p ${BASE_ROOT}/js/tests && cp ${__filename} ${BASE_ROOT}/js/tests/`], { encoding: 'utf8' })
  return r.status === 0
}
function runChild(env, scriptPath = __filename) {
  const e = { ...process.env }
  delete e.CHAT_BOT_BRAND; delete e.CHAT_BOT_NAME; delete e.BOT_USERNAME
  Object.assign(e, env); delete e.main
  e.__OUT_FILE = path.join(require('os').tmpdir(), 'wl_rebrand_' + process.pid + '_' + Math.random().toString(36).slice(2) + '.json')
  const r = spawnSync(process.execPath, [scriptPath, '--child'], { env: e, encoding: 'utf8', timeout: 90000, maxBuffer: 200 * 1024 * 1024 })
  if (!fs.existsSync(e.__OUT_FILE)) { console.log((r.stdout || '').slice(-2000), (r.stderr || '').slice(-2000)); return null }
  const o = JSON.parse(fs.readFileSync(e.__OUT_FILE, 'utf8')); fs.unlinkSync(e.__OUT_FILE); return o
}

// ── Static AST check: no "${(process.env" inside plain (non-template) string literals in modified files ──
console.log('\n[Static] AST quoting sanity')
const FILES = ['js/_index.js', 'js/ai-support.js', 'js/ivr-outbound.js', 'js/lang/en.js', 'js/lang/fr.js', 'js/lang/hi.js', 'js/lang/zh.js',
  'js/monetization-engine.js', 'js/phone-config.js', 'js/sanitize-provider.js', 'js/sms-service.js', 'js/test-my-number.js', 'js/vm-instance-setup.js']
for (const f of FILES) {
  const code = fs.readFileSync(path.join(ROOT, f), 'utf8')
  let ast
  try { ast = acorn.parse(code, { ecmaVersion: 'latest', sourceType: 'script', allowHashBang: true, allowReturnOutsideFunction: true }) } catch (e) { ok(false, `${f} parses: ${e.message}`); continue }
  const bad = []
  const walk = n => {
    if (!n || typeof n.type !== 'string') return
    if (n.type === 'Literal' && typeof n.value === 'string' && /\$\{\(process\.env|process\.env\.(CHAT_BOT|BOT_USERNAME)/.test(n.value)) bad.push(n.start)
    if (n.type === 'TemplateElement' && /\(process\.env\.(CHAT_BOT|BOT_USERNAME)/.test(n.value.cooked || '')) bad.push(n.start)
    for (const k of Object.keys(n)) { const v = n[k]; if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v.type === 'string') walk(v) }
  }
  walk(ast)
  const lines = bad.map(p => code.slice(0, p).split('\n').length)
  ok(bad.length === 0, `${f}: no env-expression text leaked into literal string text ${lines.length ? 'lines ' + lines.join(',') : ''}`)
}

// ── Grep sanity ──
console.log('\n[Static] Grep for remaining user-facing hardcoded Nomadly')
for (const f of ['js/lang/en.js', 'js/lang/fr.js', 'js/lang/zh.js', 'js/lang/hi.js', 'js/monetization-engine.js', 'js/phone-config.js']) {
  const hits = fs.readFileSync(path.join(ROOT, f), 'utf8').split('\n').map((l, i) => [i + 1, l])
    .filter(([, l]) => /Nomadly/.test(l.replace(/\|\|\s*'Nomadly( Bot|bot)?'/g, '')) && !/^\s*\/\//.test(l))
  ok(hits.length === 0, `${f}: ${hits.length} non-fallback 'Nomadly' lines ${hits.slice(0, 5).map(h => h[0]).join(',')}`)
}

const BASE = {}
if (prepBaseline()) {
  for (const env of BRANDS) BASE[JSON.stringify(env)] = runChild(env, path.join(BASE_ROOT, 'js/tests', path.basename(__filename)))
}
for (const env of BRANDS) {
  const brand = env.CHAT_BOT_BRAND || 'Nomadly'
  const name = env.CHAT_BOT_NAME || 'Nomadly Bot'
  const user = env.BOT_USERNAME || 'Nomadlybot'
  const isMain = !!env.main
  console.log(`\n[Runtime] brand=${brand} user=${user} main=${isMain}`)
  const o = runChild(env)
  if (!o) { ok(false, 'child produced output'); continue }
  ok(o.errors.length === 0, 'no require/eval errors ' + o.errors.join(' | '))
  const all = o.strings
  ok(all.length > 1000, `collected ${all.length} strings`)
  const nomadly = all.filter(x => /Nomadly/i.test(x.s))
  if (!isMain) ok(nomadly.length === 0, `no 'Nomadly' in rendered strings (${nomadly.length}) ${nomadly.slice(0, 5).map(x => x.where + ' => ' + x.s.slice(0, 120)).join(' || ')}`)
  // 'undefined' from unrelated unset env (SELF_URL etc.) is pre-existing: compare against baseline (pre-change files)
  const base = BASE[JSON.stringify(env)]
  const baseSet = new Set((base ? base.strings : []).filter(x => /\bundefined\b/.test(x.s)).map(x => x.where))
  const undefReal = all.filter(x => /\(process\.env/.test(x.s) || (/\bundefined\b/.test(x.s) && !baseSet.has(x.where)))
  ok(undefReal.length === 0, `[baseline ${baseSet.size} pre-existing] ` + `no 'undefined'/raw env expression (${undefReal.length}) ${undefReal.slice(0, 4).map(x => x.where + ' => ' + x.s.slice(0, 100)).join(' || ')}`)
  const strayPlus = all.filter(x => /' \+ \(|\) \+ '/.test(x.s))
  ok(strayPlus.length === 0, `no stray concatenation text (${strayPlus.length}) ${strayPlus.slice(0, 3).map(x => x.where).join(',')}`)
  const has = (re, label) => ok(all.some(x => re.test(x.s)), label)
  has(new RegExp('Start Now →</b> @' + user + '\\b'), `promo '@${user}' Start Now`)
  for (const l of ['en', 'fr', 'zh', 'hi']) {
    const c = all.find(x => x.where === `lang/${l}.u.continueAtHostbay` || x.where === `lang/${l}.continueAtHostbay` || /\.continueAtHostbay$/.test(x.where) && x.where.startsWith('lang/' + l))
    if (l === 'en') ok(c && c.s.includes(name), `en continueAtHostbay mentions '${name}': ${c && c.s.slice(0, 90)}`)
  }
  const rm = all.filter(x => /redirectMessage$/.test(x.where) && x.where.startsWith('lang/en'))
  ok(rm.length && rm.every(x => x.s.includes(name)), `en redirectMessage mentions '${name}'`)
  const qr = all.filter(x => /scanQrOrUseChat\(\)$/.test(x.where))
  ok(qr.length >= 1 && qr.every(x => new RegExp(brand + ' SMS (App|应用|ऐप)').test(x.s)), `scanQrOrUseChat says '${brand} SMS App' (${qr.length} langs)`)
  // Refer & Earn
  ok(o.refer && o.refer.referralLink === `https://t.me/${user}?start=ref_777`, `referralLink = ${o.refer && o.refer.referralLink}`)
  ok(o.refer && o.refer.msg.includes(`Invite friends to ${brand}.`), `Refer msg 'Invite friends to ${brand}.'`)
  ok(o.refer && !/\\n|undefined/.test(o.refer.msg), 'Refer msg has real newlines, no undefined')
  // Quick Tour
  ok(o.quickTour && ['en', 'fr', 'zh', 'hi'].every(l => o.quickTour[l].includes(brand) && !(o.quickTour[l].includes('Nomadly') && !isMain)), `Quick Tour 4 langs render '${brand}'`)
  ok(o.quickTour && o.quickTour.en.includes("Here's what " + brand + ' can do for you'), 'Quick Tour en apostrophe/escape intact')
  // Sanitizer
  const sv = Object.values(o.sanitized || {}).filter(v => typeof v === 'string')
  const fullSan = sv.filter(v => v.includes(`${brand} infrastructure`))
  ok(fullSan.length >= 1, `sanitizer: Railway -> '${brand} infrastructure' (${Object.keys(o.sanitized || {}).join(',')})`)
  ok(fullSan.every(v => v.includes(`${brand} VPS`) && !/OpenProvider|ConnectReseller|Contabo|Railway/i.test(v)), `sanitizer: Contabo -> '${brand} VPS' and providers scrubbed: ${fullSan[0]}`)
  // SIP test placing
  const placing = all.filter(x => /placing\(\)$/.test(x.where))
  ok(placing.length >= 4 && placing.every(x => x.s.includes(brand)), `SIP 'placing' messages show '${brand}' (${placing.length})`)
  const trunk = all.filter(x => /Main Trunk No/.test(x.s))
  ok(trunk.length >= 1 && trunk.every(x => x.s.includes(brand)), `trunk guide shows '${brand}' (${trunk.length})`)
  // monetization
  const wb = all.filter(x => x.where.startsWith('monetization') && x.s.includes(brand))
  console.log(`  ℹ monetization strings w/ brand via exports: ${wb.length} (exports: ${(o.meExports || []).join(',')})`)
  ok(o.refLinkLines.length >= 3 && o.refLinkLines.every(l => l.includes("process.env.BOT_USERNAME || 'Nomadlybot'") || l.includes('${botUsername}')), `refLink lines use BOT_USERNAME (${o.refLinkLines.length})`)
  if (isMain && base) {
    // byte-for-byte: main brand output must equal pre-change output
    const bm = new Map(base.strings.map(x => [x.where, x.s]))
    const diffs = all.filter(x => bm.has(x.where) && bm.get(x.where) !== x.s && !/generateSip/.test(x.where))
    ok(diffs.length === 0 && all.length === base.strings.length, `main brand renders identical to pre-change (${all.length} vs ${base.strings.length} strings, ${diffs.length} diffs) ${diffs.slice(0, 3).map(d => d.where + ': ' + d.s.slice(0, 80) + ' WAS ' + bm.get(d.where).slice(0, 80)).join(' || ')}`)
  }
  if (isMain) {
    ok(all.some(x => /@Nomadlybot\b/.test(x.s)), 'main: @Nomadlybot still rendered')
    ok(all.some(x => /Nomadly Bot/.test(x.s)), 'main: Nomadly Bot still rendered')
  }
}

// monetization-engine static: welcome/win-back templates
console.log('\n[Static] monetization-engine welcome / win-back')
const meSrc = fs.readFileSync(path.join(ROOT, 'js/monetization-engine.js'), 'utf8')
ok(/welcome gift from \$\{\(process\.env\.CHAT_BOT_BRAND \|\| 'Nomadly'\)\}!/.test(meSrc), 'welcome gift uses brand')
ok(/since you used \$\{\(process\.env\.CHAT_BOT_BRAND \|\| 'Nomadly'\)\}\./.test(meSrc), 'win-back uses brand')

console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
