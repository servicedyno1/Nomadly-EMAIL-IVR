// Telegram-bot USA T-Mobile eSIM: same automatic Spenza order as the web (preview/simulated), email optional,
// QR photo + notices to the bot chat, auto-renew toggle, crypto-paid orders credited then charged, refund-safe.
require('dotenv').config({ path: '/app/backend/.env' })
process.env.WEB_CLOUDIVR_DRY_RUN = 'true'
const { MongoClient } = require('mongodb')
const EB = require('/app/js/esim-bot.js')
const ES = EB.ES
;(async () => {
  const c = await MongoClient.connect(process.env.MONGO_URL); const db = c.db(process.env.DB_NAME)
  const col = db.collection('esimLines'), rich = '700000001', poor = '700000002', cry = '700000003'
  const ids = [rich, poor, cry]
  const clean = () => Promise.all([col.deleteMany({ chatId: { $in: ids } }), db.collection('walletOf').deleteMany({ _id: { $in: ids } }), db.collection('transactions').deleteMany({ chatId: { $in: ids } })])
  await clean()
  await db.collection('walletOf').insertMany([{ _id: rich, usdIn: 100, usdOut: 0 }, { _id: poor, usdIn: 10, usdOut: 0 }, { _id: cry, usdIn: 0, usdOut: 0 }])
  const chat = [], photos = []
  const bot = { sendMessage: async (id, text) => { chat.push({ id: String(id), text }); return {} }, sendPhoto: async (id, png, opts) => { photos.push({ id: String(id), size: png.length, caption: opts.caption }); return {} } }
  ES.init({ db, log: () => {}, tell: async () => null })
  ES.setBot(bot)
  const p = await EB.plan()
  const r = {}
  r.planIs75 = !!p && p.price === 75
  r.imeiCheck = EB.parseImei('356938035643809') === '356938035643809' && EB.parseImei('356938035643808') === null
  r.zipEmailCheck = EB.parseZip('10001') === '10001' && EB.parseZip('1000') === null && EB.parseEmail('A@Gmail.com') === 'a@gmail.com' && EB.parseEmail('nope') === null
  const order = { planId: p.planId, imei: '356938035643809', zipcode: '10001', email: null, autoRenew: true }
  const ok = await EB.fulfill(db, rich, order, 'en')
  const line = await col.findOne({ _id: ok.lineId })
  const w = await db.collection('walletOf').findOne({ _id: rich })
  r.walletOrderNoEmail = ok.ok && line.source === 'telegram' && line.qrEmail === null && line.autoRenew === true && line.price === 75 && w.usdOut === 75
  const short = await EB.fulfill(db, poor, order, 'en')
  r.shortWalletRefused = !short.ok && /needs \$75/.test(short.text) && (await col.countDocuments({ chatId: poor })) === 0
  const paid = await EB.fulfillPaid(db, cry, { ...order, email: 'buyer@example.com', autoRenew: false }, 75, 'fr')
  const cl = await col.findOne({ _id: paid.lineId }), cw = await db.collection('walletOf').findOne({ _id: cry })
  r.cryptoOrder = paid.ok && cl.qrEmail === 'buyer@example.com' && cl.autoRenew === false && cw.usdIn === 75 && cw.usdOut === 75
  await col.updateMany({ chatId: { $in: [rich, cry] } }, { $set: { createdAt: new Date(Date.now() - 60000) } })
  await ES.tick()
  await new Promise(x => setTimeout(x, 1500))
  r.qrPhotoInChat = photos.some(x => x.id === rich && x.size > 500 && /Manual code/.test(x.caption)) && photos.some(x => x.id === cry)
  r.frenchNotices = photos.some(x => x.id === cry && /Code manuel/.test(x.caption)) && chat.some(x => x.id === cry && /est prête/.test(x.text))
  r.readyNoticeInChat = chat.some(x => x.id === rich && /eSIM is ready/.test(x.text))
  const lines = await EB.lines(rich)
  r.listed = lines.length === 1 && lines[0].status === 'active' && EB.lineFromLabel(lines, EB.lineLabel(lines[0], 'en'))?.id === lines[0].id
  const off = await ES.setAutoRenew(rich, lines[0].id, false)
  r.toggleOff = off.item?.autoRenew === false && (await col.findOne({ _id: lines[0].id })).autoRenew === false
  const on = await ES.setAutoRenew(rich, lines[0].id, true)
  r.toggleOn = on.item?.autoRenew === true
  photos.length = 0
  r.showQr = (await ES.sendBotQr({ chatId: rich, _id: lines[0].id, phoneNumber: lines[0].phoneNumber })) === true && photos.length === 1
  r.frStrings = EB.s('fr').buy(75).includes('75') && EB.s('zh').renewOn && EB.s('hi').askImei
  console.log(JSON.stringify(r, null, 1))
  await clean()
  await c.close()
  const fails = Object.entries(r).filter(([, v]) => !v).map(([k]) => k)
  console.log(fails.length ? `FAIL ${fails.join(', ')}` : 'PASS')
  process.exit(fails.length ? 1 : 0)
})().catch(e => { console.error(e); process.exit(1) })
