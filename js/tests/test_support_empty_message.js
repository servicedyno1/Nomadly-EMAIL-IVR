// Support chat: a non-text message (empty text) must not reach the AI; it is copied to admin and the user is asked to type.
// Language detection must not use the deprecated gpt-4.1-nano. Run: node js/tests/test_support_empty_message.js
const fs = require('fs'), path = require('path')
const src = fs.readFileSync(path.join(__dirname, '../_index.js'), 'utf8')
let pass = 0, fail = 0
const ok = (n, c) => { c ? pass++ : fail++; console.log(`${c ? '✅' : '❌'} ${n}`) }
const g = src.indexOf("if (!String(message || '').trim()) {\n      const kinds"), ai = src.indexOf("[Support] ${chatId} -> admin: ${message}")
ok('empty-text guard exists in the support branch, before the admin relay + AI call', g > 0 && ai > g)
const blk = src.slice(g, g + 1800)
ok('guard copies the original message to admin', /bot\.copyMessage\(TELEGRAM_ADMIN_CHAT_ID, chatId, msg\.message_id\)/.test(blk))
ok('guard returns before AI (asks user to type)', /return send\(chatId,[\s\S]*Please type your question/.test(blk))
for (const f of ['translation-service.js', 'ai-support.js']) ok(`${f}: no deprecated gpt-4.1-nano`, !fs.readFileSync(path.join(__dirname, '..', f), 'utf8').includes('gpt-4.1-nano'))
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0)
