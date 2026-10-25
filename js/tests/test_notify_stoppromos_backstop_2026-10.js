// Backstop: notify.push() drops '/stoppromos' promo texts for web ids, keeps real alerts (fake collection + fake bot)
const notify = require('../cloudivr-web/notify')
const rows = []
notify.setDb({ collection: () => ({ createIndex: async () => {}, insertOne: async (d) => { rows.push(d) } }) })
const tgSent = []
const bot = {
  sendMessage: async (id, t) => { tgSent.push([id, t]) },
  sendPhoto: async (id, f, o) => { tgSent.push([id, o && o.caption]) },
}
notify.attach(bot)
const WEB = 5000000000000123, TG = 123456789
let fail = 0
const ok = (n, c) => { console.log((c ? 'PASS ' : 'FAIL ') + n); if (!c) fail++ }
;(async () => {
  await bot.sendMessage(WEB, '🔥 TODAY 10% OFF cloud phones!\n\nUnsubscribe: /stoppromos')
  await bot.sendPhoto(WEB, 'https://example.com/a.png', { caption: '<b>Promo</b> 50% off — <i>/stoppromos</i> to opt out' })
  await bot.sendMessage(WEB, 'Promo &amp; deal <code>/stoppromos</code>')
  await new Promise(r => setTimeout(r, 50))
  ok('promo sendMessage/sendPhoto/HTML to web id -> 0 rows', rows.length === 0)
  await bot.sendMessage(WEB, '📞 Missed Call from +15551234567')
  await bot.sendPhoto(WEB, 'https://example.com/v.png', { caption: 'New voicemail from +1555' })
  await new Promise(r => setTimeout(r, 50))
  ok('real alerts still create rows (2)', rows.length === 2 && rows[0].kind === 'call' && rows[1].kind === 'voicemail')
  await bot.sendMessage(TG, 'TODAY 10% OFF Unsubscribe: /stoppromos')
  ok('telegram id untouched (still sent to Telegram, no row)', tgSent.length === 1 && rows.length === 2)
  console.log(fail ? 'SOME FAILED' : 'ALL PASS'); process.exit(fail ? 1 : 0)
})()
