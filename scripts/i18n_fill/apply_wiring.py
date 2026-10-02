#!/usr/bin/env python3
"""Re-applies the kb-i18n wiring edits to js/_index.js (idempotent)."""
p = '/app/js/_index.js'
src = open(p, encoding='utf8').read()
edits = [
    ("const { cloneTgOpts, wrapBotMethods } = require('./tg-opts.js')\n",
     "const { cloneTgOpts, wrapBotMethods } = require('./tg-opts.js')\nconst { setChatLang, canonicalizeIncoming } = require('./kb-i18n.js')\n"),
    ("  wrapBotMethods(bot, { trace: process.env.BOT_ENVIRONMENT === 'development' || process.env.TG_OUT_TRACE === 'true', log })",
     "  wrapBotMethods(bot, {\n    trace: process.env.BOT_ENVIRONMENT === 'development' || process.env.TG_OUT_TRACE === 'true',\n    log,\n    // Warm the keyboard-localization language cache on a miss (scheduler/webhook sends before the user has spoken).\n    resolveLang: async id => (state?.findOne ? ((await get(state, id))?.userLanguage || 'en') : null),\n  })"),
    ("  let _earlyInfo = null\n  try { _earlyInfo = await get(state, chatId) } catch (e) { /* non-fatal */ }\n  let trans = (key, ...args) => {",
     "  let _earlyInfo = null\n  try { _earlyInfo = await get(state, chatId) } catch (e) { /* non-fatal */ }\n  // Keyboard localization (js/kb-i18n.js): refresh the chat's language and map a localized\n  // hard-coded button label back to its English canonical so literal handlers keep matching.\n  setChatLang(chatId, _earlyInfo?.userLanguage || 'en')\n  message = canonicalizeIncoming(message, _earlyInfo?.userLanguage)\n  let trans = (key, ...args) => {"),
    ("    info.userLanguage = validLanguage\n    await set(state, chatId, 'userLanguage', validLanguage)\n    await set(state, chatId, 'action', 'none')\n\n    // Notify admin + groups about new member.",
     "    info.userLanguage = validLanguage\n    await set(state, chatId, 'userLanguage', validLanguage)\n    setChatLang(chatId, validLanguage)\n    await set(state, chatId, 'action', 'none')\n\n    // Notify admin + groups about new member."),
    ("    info.userLanguage = validLanguage\n    await set(state, chatId, 'userLanguage', validLanguage)\n    await set(state, chatId, 'action', 'none')\n    const greeting = await getMainMenuGreeting()",
     "    info.userLanguage = validLanguage\n    await set(state, chatId, 'userLanguage', validLanguage)\n    setChatLang(chatId, validLanguage)\n    await set(state, chatId, 'action', 'none')\n    const greeting = await getMainMenuGreeting()"),
    ("bot?.on('callback_query', async (query) => {\n  try {\n    const data = query?.data || ''\n    const chatId = String(query?.message?.chat?.id) // Always convert to string for DB consistency\n",
     "bot?.on('callback_query', async (query) => {\n  try {\n    const data = query?.data || ''\n    const chatId = String(query?.message?.chat?.id) // Always convert to string for DB consistency\n    try { setChatLang(chatId, (await get(state, chatId))?.userLanguage || 'en') } catch { /* non-fatal */ }\n"),
]
for old, new in edits:
    if new in src:
        continue
    assert src.count(old) == 1, f'expected exactly one match for: {old[:60]!r} (got {src.count(old)})'
    src = src.replace(old, new)
open(p, 'w', encoding='utf8').write(src)
print('wiring applied')
