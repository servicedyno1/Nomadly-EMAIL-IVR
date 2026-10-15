// "🌐 Use on Web" — hosta.sh entry point for bot users (2026-10-14).
//   node js/tests/test_web_access_2026-10.js
const path = require('path')
const fs = require('fs')
let pass = 0, fail = 0
const ok = (name, cond, extra) => { if (cond) { pass++; console.log(`  ✅ ${name}`) } else { fail++; console.log(`  ❌ ${name}${extra ? ' — ' + extra : ''}`) } }
const LANGS = ['en', 'fr', 'zh', 'hi']
const fresh = (m) => { delete require.cache[require.resolve(m)]; return require(m) }
const langKeyboard = (l) => fresh(`../lang/${l}.js`)[l].o.reply_markup.keyboard

console.log('\n── unset (Smadav / Voodoo) ──')
process.env.WEBSITE_URL = ''
let web = fresh('../web-access.js')
ok('no menu row', web.webMenuRows('en').length === 0)
ok('no welcome line', web.webWelcomeLine('fr') === '')
ok('button text not intercepted', web.isWebButton('🌐 Use on Web') === false)
for (const l of LANGS) ok(`${l}: main menu unchanged (no web row)`, !langKeyboard(l).flat().some(b => Object.values(web.LABELS).includes(b)))

console.log('\n── WEBSITE_URL=https://hosta.sh (Nomadly) ──')
process.env.WEBSITE_URL = 'https://hosta.sh'
web = fresh('../web-access.js')
for (const l of LANGS) {
  const kb = langKeyboard(l)
  ok(`${l}: web button alone on the TOP row`, kb[0].length === 1 && kb[0][0] === web.LABELS[l], JSON.stringify(kb[0]))
  ok(`${l}: rest of the menu intact`, kb.flat().length > 10 && kb.slice(1).flat().every(b => typeof b === 'string' && b.length))
  ok(`${l}: label recognised`, web.isWebButton(web.LABELS[l]))
  const m = web.webAccessMessage(l)
  const btn = m.opts.reply_markup.inline_keyboard[0][0]
  ok(`${l}: reply has inline button → https://hosta.sh`, btn.url === 'https://hosta.sh' && btn.text.includes('hosta.sh'), JSON.stringify(btn))
  ok(`${l}: reply mentions hosta.sh, HTML, no preview`, m.text.includes('<b>hosta.sh</b>') && m.opts.parse_mode === 'HTML' && m.opts.disable_web_page_preview === true)
  ok(`${l}: reply does not replace the main keyboard`, !m.opts.reply_markup.keyboard && !m.opts.reply_markup.remove_keyboard)
  const w = web.webWelcomeLine(l)
  ok(`${l}: welcome line links hosta.sh`, w.startsWith('\n\n🌐 ') && w.includes('<a href="https://hosta.sh">hosta.sh</a>'), w)
}
ok('unknown language falls back to English', web.webAccessMessage('xx').text.startsWith('🌐 <b>Prefer the web?</b>') && web.webMenuRows('xx')[0][0] === '🌐 Use on Web')
ok('other menu labels not intercepted', !web.isWebButton('🌐 Domain Names') && !web.isWebButton('🌍 Change Language') && !web.isWebButton('use on web'))
process.env.WEBSITE_URL = 'https://hosta.sh/'
ok('trailing slash trimmed from the shown host', fresh('../web-access.js').webWelcomeLine('en').includes('>hosta.sh</a>'))

console.log('\n── labels unique vs every existing button ──')
const allLabels = new Set()
for (const l of LANGS) { const u = fresh(`../lang/${l}.js`)[l].user || {}; Object.values(u).forEach(v => typeof v === 'string' && allLabels.add(v)) }
ok('no existing user.* button shares a web label', !Object.values(web.LABELS).some(x => allLabels.has(x)))

console.log('\n── _index.js wiring ──')
const src = fs.readFileSync(path.join(__dirname, '../_index.js'), 'utf8')
const iWeb = src.indexOf('if (webAccess.isWebButton(message))')
ok('button handler present', iWeb > 0 && /isWebButton\(message\)\) \{\s*const \{ text: webText, opts: webOpts \} = webAccess\.webAccessMessage\(info\?\.userLanguage \|\| 'en'\)\s*return send\(chatId, webText, webOpts\)/.test(src))
ok('handler runs before the Settings-menu action block', iWeb > 0 && iWeb < src.indexOf('// ━━━ Settings Menu ━━━'))
ok('handler runs after /start + language pick', iWeb > src.indexOf("if (message === '/start' ||") && iWeb > src.indexOf('showFirstSessionIntent(validLanguage)'))
ok('first-start welcome carries the web line', /const qWeb = q \+ webAccess\.webWelcomeLine\(_l\)/.test(src) && /bot\.sendMessage\(chatId, qWeb, \{ parse_mode: 'HTML', disable_web_page_preview: true/.test(src))

console.log(`\n${fail === 0 ? '✅' : '❌'} web access: ${pass} passed / ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
