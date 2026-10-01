/**
 * Regression: node-telegram-bot-api's _fixReplyMarkup() stringifies opts.reply_markup IN PLACE.
 * Shared option objects (lang-dict keyboards reused across sends) therefore lost their keyboard
 * after the first send — the "couldn't pick a plan" dead-end seen in production (2026-10-01).
 * js/tg-opts.js clones options at the bot boundary so the caller's object is never mutated.
 */
const TelegramBot = require('node-telegram-bot-api')
const { cloneTgOpts, wrapBotMethods, traceLine } = require('../js/tg-opts')

function fakeBot() {
  const bot = new TelegramBot('123:TEST', { webHook: false, polling: false })
  bot.sent = []
  // Stub the HTTP layer only; keep upstream's in-place _fixReplyMarkup() (what _request() runs first).
  bot._request = function (path, opts = {}) {
    if (opts.form) this._fixReplyMarkup(opts.form)
    bot.sent.push({ path, form: { ...(opts.form || {}) } }); return Promise.resolve({ message_id: bot.sent.length })
  }
  return bot
}
const sharedOpts = () => ({ reply_markup: { keyboard: [['Daily', 'Weekly', 'Monthly'], ['Back', 'Cancel']] } })

describe('tg-opts: shared reply_markup survives repeated sends', () => {
  test('raw node-telegram-bot-api mutates the caller object (documents the upstream behaviour)', async () => {
    const bot = fakeBot()
    const opts = sharedOpts()
    await bot.sendMessage(1, 'hi', opts)
    expect(typeof opts.reply_markup).toBe('string')
  })

  test('wrapped bot leaves the caller object intact and still sends the keyboard every time', async () => {
    const bot = wrapBotMethods(fakeBot())
    const opts = sharedOpts()
    await bot.sendMessage(1, 'first', opts)
    await bot.sendMessage(2, 'second', opts)
    expect(Array.isArray(opts.reply_markup.keyboard)).toBe(true)
    for (const s of bot.sent) expect(JSON.parse(s.form.reply_markup).keyboard[0]).toEqual(['Daily', 'Weekly', 'Monthly'])
  })

  test('editMessageText / editMessageReplyMarkup (options at index 1) are covered too', async () => {
    const bot = wrapBotMethods(fakeBot())
    const o1 = { chat_id: 1, message_id: 5, reply_markup: { inline_keyboard: [[{ text: 'Go', callback_data: 'go' }]] } }
    await bot.editMessageText('x', o1)
    await bot.editMessageReplyMarkup(o1.reply_markup, { chat_id: 1, message_id: 5 })
    expect(Array.isArray(o1.reply_markup.inline_keyboard)).toBe(true)
  })

  test('cloneTgOpts re-hydrates an already-stringified reply_markup so resize_keyboard injection works', () => {
    const poisoned = { reply_markup: JSON.stringify({ keyboard: [['A']] }) }
    const c = cloneTgOpts(poisoned)
    expect(c.reply_markup.keyboard).toEqual([['A']])
    c.reply_markup.resize_keyboard = true
    expect(poisoned.reply_markup).toBe(JSON.stringify({ keyboard: [['A']] }))
  })

  test('trace line lists reply buttons, inline buttons with callback_data, and remove_keyboard', () => {
    const t1 = JSON.parse(traceLine('sendMessage', [42, 'Pick', { reply_markup: { keyboard: [['Daily'], [{ text: 'Share', request_contact: true }]] } }], 2).slice(9))
    expect(t1).toMatchObject({ chat: '42', text: 'Pick', kb: ['Daily'], inline: [], remove: false })
    const t2 = JSON.parse(traceLine('sendMessage', [7, 'Hi', { reply_markup: { inline_keyboard: [[{ text: 'Buy', callback_data: 'buy:1' }, { text: 'Site', url: 'https://x' }]] } }], 2).slice(9))
    expect(t2.inline).toEqual([{ t: 'Buy', d: 'buy:1', u: 0 }, { t: 'Site', d: null, u: 1 }])
    const t3 = JSON.parse(traceLine('sendMessage', [7, 'Bye', { reply_markup: { remove_keyboard: true } }], 2).slice(9))
    expect(t3.remove).toBe(true)
  })

  test('trace is opt-in and never breaks a send', async () => {
    const lines = []
    const bot = wrapBotMethods(fakeBot(), { trace: true, log: l => lines.push(l) })
    await bot.sendMessage(9, 'yo', sharedOpts())
    expect(lines).toHaveLength(1)
    expect(lines[0].startsWith('[tg-out] ')).toBe(true)
    const quiet = wrapBotMethods(fakeBot(), { trace: false, log: () => { throw new Error('must not be called') } })
    await expect(quiet.sendMessage(9, 'yo', sharedOpts())).resolves.toBeTruthy()
  })
})
