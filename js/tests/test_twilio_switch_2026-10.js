// Tests for Phase 0 reversible TWILIO_ENABLED switch + lint/ReferenceError fixes (2026-10)
// Run: node /app/js/tests/test_twilio_switch_2026-10.js
// Spawns child node processes per env mode so module-load-time flags are evaluated fresh.
const { execFileSync } = require('child_process')
const fs = require('fs')
const path = require('path')

let pass = 0, fail = 0
const ok = (cond, name, extra = '') => { if (cond) { pass++; console.log('PASS', name) } else { fail++; console.log('FAIL', name, extra) } }

function runChild(code, envVal) {
  const env = { ...process.env }
  delete env.TWILIO_ENABLED
  if (envVal !== undefined) env.TWILIO_ENABLED = envVal
  // dummy creds so twilio-service module loads without network
  env.TWILIO_ACCOUNT_SID = env.TWILIO_ACCOUNT_SID || 'ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'
  env.TWILIO_AUTH_TOKEN = env.TWILIO_AUTH_TOKEN || 'dummy'
  const out = execFileSync(process.execPath, ['-e', code], { env, cwd: '/app/js', encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 60000 })
  const line = out.trim().split('\n').filter(l => l.startsWith('JSON:')).pop()
  return JSON.parse(line.slice(5))
}

// ── phone-config country catalog + UI text ──
const pcCode = `
const pc = require('/app/js/phone-config.js')
const future = new Date(Date.now() + 20*86400000).toISOString()
const tw = { provider:'twilio', status:'active', phoneNumber:'+18885551234', plan:'pro', expiresAt: future, features:{}, capabilities:{} }
const tx = { ...tw, provider:'telnyx', phoneNumber:'+18885550000' }
let list = '', manage = '', listTx = '', manageTx = '', err = null
try {
  list = pc.txt.myNumbersList([tw]); listTx = pc.txt.myNumbersList([tx])
  manage = pc.txt.manageNumber(tw, 0, 3, [tw]); manageTx = pc.txt.manageNumber(tx, 0, 3, [tx])
} catch (e) { err = e.message }
const fr = pc.getTxt('fr'); let frList = '', frManage=''
try { frList = fr.myNumbersList([tw]); frManage = fr.manageNumber(tw,0,3,[tw]) } catch(e) {}
console.log('JSON:' + JSON.stringify({
  enabled: pc.isTwilioEnabled(),
  codes: pc.allCountries.map(c => c.code),
  more: pc.moreCountries.length,
  uk: !!pc.countryByName['🇬🇧 United Kingdom'],
  list, manage, listTx, manageTx, err,
  frBanner: /🔧/.test(frList) || /🔧/.test(frManage),
})); process.exit(0)`

for (const mode of [undefined, 'true']) {
  const r = runChild(pcCode, mode)
  const label = `TWILIO_ENABLED=${mode === undefined ? 'unset' : mode}`
  ok(r.enabled === true, `${label}: isTwilioEnabled()===true`)
  ok(['US','CA','GB','IE','IL','AU','NZ','HK','NL','IT'].every(c => r.codes.includes(c)), `${label}: allCountries has full Twilio list`, r.codes.join(','))
  ok(r.more === 16, `${label}: moreCountries.length===16`, r.more)
  ok(r.uk, `${label}: countryByName UK defined`)
  ok(!r.list.includes('Being upgraded') && !r.manage.includes('being upgraded'), `${label}: no upgrade banner for twilio number`)
}

const off = runChild(pcCode, 'false')
ok(off.enabled === false, 'false: isTwilioEnabled()===false')
ok(JSON.stringify(off.codes) === '["US","CA"]', 'false: allCountries === [US,CA]', off.codes.join(','))
ok(off.more === 0, 'false: moreCountries.length===0', off.more)
ok(!off.uk, 'false: countryByName has no UK')
ok(!off.err, 'false: myNumbersList/manageNumber render without throwing', off.err)
ok(off.list.includes('Being upgraded'), 'false: myNumbersList twilio -> "Being upgraded"')
ok(off.manage.includes('This number is being upgraded'), 'false: manageNumber twilio -> "This number is being upgraded"')
ok(!off.listTx.includes('Being upgraded'), 'false: myNumbersList telnyx has no banner')
ok(!off.manageTx.includes('being upgraded'), 'false: manageNumber telnyx has no banner')
console.log('INFO non-EN (fr) banner present when disabled:', off.frBanner)

// ── FIX F: 🔧 banner in ALL languages (en/fr/zh/hi) ──
const langCode = `
const pc = require('/app/js/phone-config.js')
const future = new Date(Date.now() + 20*86400000).toISOString()
const tw = { provider:'twilio', status:'active', phoneNumber:'+18885551234', plan:'pro', expiresAt: future, features:{}, capabilities:{}, planPrice:75 }
const tx = { ...tw, provider:'telnyx', phoneNumber:'+18885550000' }
const out = {}
for (const lang of ['en','fr','zh','hi']) {
  const t = pc.getTxt(lang)
  try {
    out[lang] = { tl: /🔧/.test(t.myNumbersList([tw])), tm: /🔧/.test(t.manageNumber(tw,0,3,[tw])),
                  xl: /🔧/.test(t.myNumbersList([tx])), xm: /🔧/.test(t.manageNumber(tx,0,3,[tx])) }
  } catch (e) { out[lang] = { err: e.message } }
}
console.log('JSON:' + JSON.stringify(out)); process.exit(0)`
const lOff = runChild(langCode, 'false')
for (const lang of ['en','fr','zh','hi']) {
  const r = lOff[lang]
  ok(!r.err && r.tl && r.tm, `false: ${lang} twilio list+manage show 🔧 banner`, JSON.stringify(r))
  ok(!r.err && !r.xl && !r.xm, `false: ${lang} telnyx list+manage have NO banner`, JSON.stringify(r))
}
for (const mode of [undefined, 'true']) {
  const lOn = runChild(langCode, mode)
  const label = `TWILIO_ENABLED=${mode === undefined ? 'unset' : mode}`
  ok(['en','fr','zh','hi'].every(l => !lOn[l].err && !lOn[l].tl && !lOn[l].tm), `${label}: no 🔧 banner for twilio in any lang`, JSON.stringify(lOn))
}

// ── FIX D: dedup'd fr/zh/hi enterEmail keep previously-effective (later) values ──
const dCode = `const pc = require('/app/js/phone-config.js'); console.log('JSON:' + JSON.stringify({
  fr: pc.getTxt('fr').enterEmail, zh: pc.getTxt('zh').enterEmail, hi: pc.getTxt('hi').enterEmail,
  unk: pc.getTxt('fr').__nope__ === undefined })); process.exit(0)`
const d = runChild(dCode, 'false')
ok(d.fr === "Entrez l'adresse email pour transférer les SMS :" && d.zh === '输入用于转发短信的电子邮件地址：' && d.hi === 'SMS फ़ॉरवर्ड करने के लिए ईमेल पता दर्ज करें:' && d.unk, 'fr/zh/hi enterEmail values unchanged + unknown key fallback', JSON.stringify(d))

// ── FIX E: unicode regex for SOLD prefix strip ──
{
  const isrc0 = fs.readFileSync('/app/js/_index.js', 'utf8')
  ok(isrc0.includes("message.replace(/^[✅🟡]+ ?(SOLD:?)?\\s*/u, '')"), '_index.js SOLD regex uses u flag')
  const re = /^[✅🟡]+ ?(SOLD:?)?\s*/u
  ok('🟡 SOLD: Item'.replace(re, '') === 'Item' && '✅ Item'.replace(re, '') === 'Item' && '🚀 Item'.replace(re, '') === '🚀 Item', 'SOLD regex strips ✅/🟡 only, leaves 🚀 intact')
}

// ── twilio-service boundary guards (disabled mode only; no network) ──
const twCode = `
const t = require('/app/js/twilio-service.js')
;(async () => {
  const s = await t.searchNumbers('US','toll_free',5)
  const b = await t.buyNumber('+18885551234')
  console.log('JSON:' + JSON.stringify({ s, b }))
  process.exit(0)
})()`
const tw = runChild(twCode, 'false')
ok(Array.isArray(tw.s) && tw.s.length === 0, 'false: twilio searchNumbers -> []')
ok(tw.b && typeof tw.b.error === 'string' && tw.b.error.includes('temporarily unavailable'), 'false: twilio buyNumber -> error temporarily unavailable', JSON.stringify(tw.b))

// ── static code checks ──
const tsrc = fs.readFileSync('/app/js/twilio-service.js', 'utf8')
ok(/async function searchNumbers[\s\S]{0,600}if \(!isTwilioEnabled\(\)\)/.test(tsrc), 'searchNumbers guard conditional on isTwilioEnabled()')
ok(/async function buyNumber[\s\S]{0,400}if \(!isTwilioEnabled\(\)\)/.test(tsrc), 'buyNumber guard conditional on isTwilioEnabled()')
const vsrc = fs.readFileSync('/app/js/voice-service.js', 'utf8')
ok(/provider === 'twilio' && _twilioService\) \{[\s\S]{0,300}if \(!isTwilioEnabled\(\)\) \{[\s\S]{0,200}return \{ error: '⚠️ This number is being upgraded/.test(vsrc), 'initiateOutboundIvrCall twilio-branch guard')
ok(/isTwilioEnabled \} = require\('\.\/phone-config\.js'\)/.test(vsrc.split('\n').slice(0, 10).join('\n')), 'voice-service imports isTwilioEnabled')
const isrc = fs.readFileSync('/app/js/_index.js', 'utf8')
ok(isrc.includes("const isBulkCapable = (n) => n.provider === 'twilio' ? phoneConfig.isTwilioEnabled() : true"), 'bulkCapableNumbers respects switch (Twilio gated, Telnyx always — Phase 2)')
ok((isrc.match(/\(nativeProvider === 'telnyx'\) && phoneConfig\.isTwilioEnabled\(\)/g) || []).length === 2, 'both canSearchBoth lines respect switch')
ok(/message === '📊 Menu Stats'\) \{\s*\n\s*const voiceService = require\('\.\/voice-service\.js'\)/.test(isrc), 'Menu Stats block requires voiceService')
ok((isrc.match(/catch\s*(\([^)]*\))?\s*\{\}/g) || []).length === 0 && (vsrc.match(/catch\s*(\([^)]*\))?\s*\{\}/g) || []).length === 0, 'zero empty catch blocks')

const ga = runChild(`console.log('JSON:' + JSON.stringify(typeof require('/app/js/voice-service.js').getOutboundMenuAnalytics)); process.exit(0)`, 'false')
ok(ga === 'function', 'voice-service exports getOutboundMenuAnalytics function', ga)

console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
