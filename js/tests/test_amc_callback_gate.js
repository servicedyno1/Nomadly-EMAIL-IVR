// Admin "✅ Send to @user" (amcSend) / "❌ Cancel" (amcCancel) on the media-reply confirm must pass the admin
// callback gate — before 2026-11-12 they were dropped silently and the button just spun. Run: node js/tests/test_amc_callback_gate.js
const fs = require('fs'), path = require('path')
const src = fs.readFileSync(path.join(__dirname, '../_index.js'), 'utf8')
const line = src.split('\n').find(l => l.includes('const isAdminCallback ='))
const isAdminCallback = new Function('data', line.replace(/^\s*const isAdminCallback =/, 'return'))
let pass = 0, fail = 0
for (const [d, exp] of [['amcSend:tok123', true], ['amcCancel:tok123', true], ['amcSend', true], ['aR:123', true], ['eAck:x', true], ['aCANCEL', true], ['bse-rv:x', false], ['amazon', false], ['rsa:t:x', false]]) {
  const r = !!isAdminCallback(d); r === exp ? pass++ : fail++; console.log(`${r === exp ? '✅' : '❌'} ${d} → ${r}`)
}
const h = src.indexOf("if (data.startsWith('amcSend') || data.startsWith('amcCancel'))"), g = src.indexOf(line)
const ok = g > 0 && h > g; ok ? pass++ : fail++; console.log(`${ok ? '✅' : '❌'} amc handler sits after the gate in the admin callback handler`)
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0)
