// Nomadly-only web entry points (2026-10-27): CloudIVR web button/welcome line, hosta.sh + cloudivr.net promo ads,
// admin alert on every new CloudIVR web sign-up.   node js/tests/test_web_promos_signup_alert_2026-10.js
const path = require('path')
const fs = require('fs')
let pass = 0, fail = 0
const ok = (name, cond, extra) => { if (cond) { pass++; console.log(`  ✅ ${name}`) } else { fail++; console.log(`  ❌ ${name}${extra ? ' — ' + extra : ''}`) } }
const LANGS = ['en', 'fr', 'zh', 'hi']
const fresh = (m) => { delete require.cache[require.resolve(m)]; return require(m) }
const NOMADLY = { WEBSITE_URL: 'https://hosta.sh', CLOUDIVR_WEB_ON: 'true', CLOUDIVR_WEB_DOMAIN: 'cloudivr.net' }
const setEnv = (e) => { for (const k of Object.keys(NOMADLY)) delete process.env[k]; Object.assign(process.env, e) }

;(async () => {
  console.log('\n── other brands (no WEBSITE_URL / no CloudIVR domain) ──')
  setEnv({ CLOUDIVR_WEB_ON: 'true' })
  let web = fresh('../web-access.js'); let pc = fresh('../promo-copy')
  ok('no CloudIVR menu row', web.cloudivrMenuRows('en').length === 0)
  ok('no CloudIVR welcome line', web.cloudivrWelcomeLine('en') === '')
  ok('CloudIVR button not intercepted', web.isCloudivrWebButton(web.CIVR_LABELS.en) === false)
  ok('web ads disabled', !pc.themeEnabled('web_hosta') && !pc.themeEnabled('web_cloudivr'))
  ok('disabled web ad falls back to the in-bot callback button', pc.inlineKeyboard('web_cloudivr', 'en', 'x').inline_keyboard[0][0].callback_data === 'promo_open:web_cloudivr')
  const ap0 = fresh('../auto-promo.js')
  ok('pickTheme never picks a disabled web ad (day schedule → rotation)', ap0.pickTheme({ dayTheme: 'web_cloudivr', hash: 1, dayIndex: 0, env: process.env }).theme !== 'web_cloudivr')

  console.log('\n── Nomadly (hosta.sh + cloudivr.net) ──')
  setEnv(NOMADLY)
  web = fresh('../web-access.js'); pc = fresh('../promo-copy')
  for (const l of LANGS) {
    ok(`${l}: CloudIVR menu row = one button`, web.cloudivrMenuRows(l).length === 1 && web.cloudivrMenuRows(l)[0][0] === web.CIVR_LABELS[l])
    ok(`${l}: button recognised`, web.isCloudivrWebButton(web.CIVR_LABELS[l]))
    const m = web.cloudivrWebMessage(l)
    const b = m.opts.reply_markup.inline_keyboard[0][0]
    ok(`${l}: CTA opens https://cloudivr.net`, b.url === 'https://cloudivr.net' && b.text.includes('cloudivr.net'), JSON.stringify(b))
    ok(`${l}: CTA text HTML, no preview, keyboard kept`, m.text.includes('<b>cloudivr.net</b>') && m.opts.parse_mode === 'HTML' && m.opts.disable_web_page_preview && !m.opts.reply_markup.keyboard)
    const w = web.cloudivrWelcomeLine(l)
    ok(`${l}: welcome line links cloudivr.net`, w.startsWith('\n\n📞 ') && w.includes('<a href="https://cloudivr.net">cloudivr.net</a>'), w)
  }
  process.env.CLOUDIVR_WEB_DOMAIN = 'https://cloudivr.net/'
  ok('domain with scheme / slash normalised', fresh('../web-access.js').cloudivrUrl() === 'https://cloudivr.net')
  process.env.CLOUDIVR_WEB_DOMAIN = 'cloudivr.net'
  process.env.CLOUDIVR_WEB_ON = 'false'
  ok('web app off → hidden', fresh('../web-access.js').cloudivrUrl() === '')
  setEnv(NOMADLY)
  web = fresh('../web-access.js'); pc = fresh('../promo-copy')
  const allLabels = new Set()
  for (const l of LANGS) { const u = fresh(`../lang/${l}.js`)[l].user || {}; Object.values(u).forEach(v => typeof v === 'string' && allLabels.add(v)) }
  ok('CloudIVR web labels clash with no existing button', !Object.values(web.CIVR_LABELS).some(x => allLabels.has(x) || Object.values(web.LABELS).includes(x)))

  console.log('\n── promo ads ──')
  const { getPromoPrices } = require('../promo-prices.js')
  const prices = getPromoPrices()
  ok('both web ads enabled on Nomadly', pc.themeEnabled('web_hosta') && pc.themeEnabled('web_cloudivr'))
  for (const [theme, url, host] of [['web_hosta', 'https://hosta.sh', 'hosta.sh'], ['web_cloudivr', 'https://cloudivr.net', 'cloudivr.net']]) {
    for (const l of LANGS) for (const mode of ['hero', 'cross']) {
      const r = pc.renderPromo({ theme, lang: l, mode, prices })
      ok(`${theme}/${l}/${mode}: names ${host}, ≤ 380 chars, ≤ 4 emoji`, r.text.includes(host) && pc.visibleLength(r.text) <= 380 && pc.emojiCount(r.text) <= 4, `${pc.visibleLength(r.text)} chars`)
    }
    const kb = pc.inlineKeyboard(theme, 'en', 'Open →')
    ok(`${theme}: in-bot button opens ${url} + mute row`, kb.inline_keyboard[0][0].url === url && kb.inline_keyboard[1][0].callback_data === 'promo_optout')
    const post = pc.renderChannelPost({ theme, lang: 'en', prices, botUsername: 'Nomadlybot' })
    ok(`${theme}: channel post button opens ${url}`, post.url === url && post.reply_markup.inline_keyboard[0][0].url === url)
  }
  const ap = fresh('../auto-promo.js')
  for (const [theme, logo] of [['web_hosta', 'hosta'], ['web_cloudivr', 'CloudIVR']]) {
    const bn = ap.bannerFor(theme)
    ok(`${theme}: Nomadly banner with the ${logo} logo exists`, !!bn && /nomadly/.test(bn) && fs.statSync(bn).size > 50000, bn)
  }
  const pick = ap.pickTheme({ owned: new Set(['cloudphone']), hash: 0, dayIndex: 0, env: process.env })
  ok('Cloud IVR owners can be offered CloudIVR web (cross-sell list)', pc.CROSS_SELL.cloudphone.includes('web_cloudivr') && !!pick)
  const src = fs.readFileSync(path.join(__dirname, '../auto-promo.js'), 'utf8')
  ok('day schedule: Thu evening cloudivr.net, Fri morning hosta.sh', /4: \[3, 13\]/.test(src) && /5: \[12, 4\]/.test(src) && pc.THEMES[12] === 'web_hosta' && pc.THEMES[13] === 'web_cloudivr')

  console.log('\n── _index.js wiring ──')
  const idx = fs.readFileSync(path.join(__dirname, '../_index.js'), 'utf8')
  ok('Cloud IVR + SIP hub + How it works show the CloudIVR web row', (idx.match(/\.\.\.webAccess\.cloudivrMenuRows\(info\?\.userLanguage \|\| 'en'\)/g) || []).length === 2)
  const iBtn = idx.indexOf('if (webAccess.isCloudivrWebButton(message))')
  ok('button handler before the Settings block and the Cloud IVR action handlers', iBtn > 0 && iBtn < idx.indexOf('// ━━━ Settings Menu ━━━') && iBtn < idx.indexOf('if (action === a.submenu5 && phoneConfig.isBtnMatch(message, \'howItWorks\'))'))
  ok('/start greeting + first-start welcome carry the cloudivr.net line', /send\(chatId, greeting \+ webAccess\.cloudivrWelcomeLine\(/.test(idx) && /webWelcomeLine\(_l\) \+ webAccess\.cloudivrWelcomeLine\(_l\)/.test(idx))
  ok('deep links open_web_hosta / open_web_cloudivr handled', /web_hosta: \(\) =>/.test(idx) && /web_cloudivr: \(\) =>/.test(idx))

  console.log('\n── admin alert on new web sign-up ──')
  const { MongoClient } = require('mongodb')
  const client = new MongoClient(process.env.MONGO_URL || 'mongodb://127.0.0.1:27017'); await client.connect()
  const db = client.db('test_civr_signup_alert'); await db.dropDatabase()
  process.env.WEB_SESSION_SECRET = process.env.WEB_SESSION_SECRET || 'x'.repeat(48)
  const alerts = []
  const { createAuth } = fresh('../cloudivr-web/auth.js')
  const express = require('express')
  const app = express(); app.use(express.json())
  const r = express.Router()
  const h = (fn) => (req, res, next) => fn(req, res, next).catch(next)
  createAuth(db, { log: () => {}, notifyAdmin: (m) => alerts.push(m) }).routes(r, h)
  app.use(r)
  const srv = app.listen(0); const port = srv.address().port
  const post = (p, body, headers = {}) => fetch(`http://127.0.0.1:${port}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) })
  const res = await post('/auth/register', { email: 'New.User@Example.com', password: 'Passw0rd!x', name: 'Dana <b>&</b> Co' }, { 'cf-ipcountry': 'ng' })
  ok('sign-up succeeds', res.status === 201, String(res.status))
  ok('exactly one admin alert', alerts.length === 1, JSON.stringify(alerts))
  const a = alerts[0] || ''
  ok('alert: title, email, escaped name, method, country, account id', /New CloudIVR web sign-up/.test(a) && a.includes('email: new.user@example.com') && a.includes('name: Dana &lt;b&gt;&amp;&lt;/b&gt; Co') && a.includes('method: Email + password') && a.includes('country: NG') && /web account: 5\d{15}/.test(a), a)
  const dup = await post('/auth/register', { email: 'new.user@example.com', password: 'Passw0rd!x' })
  await post('/auth/login', { email: 'new.user@example.com', password: 'Passw0rd!x' })
  ok('no alert for a duplicate sign-up or a login', dup.status === 409 && alerts.length === 1)
  srv.close(); await db.dropDatabase(); await client.close()

  console.log(`\n${fail === 0 ? '✅' : '❌'} web promos + sign-up alert: ${pass} passed / ${fail} failed`)
  process.exit(fail === 0 ? 0 : 1)
})().catch((e) => { console.error('FATAL', e); process.exit(1) })
