process.env.WEB_CLOUDIVR_DRY_RUN = 'false'
const { MongoClient } = require('mongodb')
;(async () => {
  const c = await MongoClient.connect(process.env.MONGO_URL); const db = c.db(process.env.DB_NAME)
  const { createSmsReply } = require('/app/js/cloudivr-web/sms-reply')
  const sr = createSmsReply({ db, voiceService: { incrementSmsUsed: async () => {} } })
  const chatId = '5000000000000077'
  const num = (await db.collection('phoneNumbersOf').findOne({ _id: chatId })).val.numbers.find(n => n.phoneNumber === '+3197010278502')
  const bal = async () => { const w = await db.collection('walletOf').findOne({ _id: chatId }); return JSON.stringify({ usdIn: w.usdIn, usdOut: w.usdOut }) }
  for (const to of process.argv.slice(2)) {
    const before = await bal()
    const r = await sr.send({ chatId, num, to, text: 'CloudIVR test: reply to this text to check incoming texts. ' + new Date().toISOString().slice(11, 16) })
    console.log(to, '→', JSON.stringify(r.error || { status: r.log.status, charge: r.charge, id: r.log.messageId }), '| wallet before', before, 'after', await bal())
  }
  await c.close(); process.exit(0)
})().catch(e => { console.error('ERR', e.message); process.exit(1) })
