'use strict'
// READ-ONLY: inspect @user_uu0 (chatId 6277663071) VPS + wallet records.
require('dotenv').config({ path: '/app/backend/.env' })
const { MongoClient } = require('mongodb')

;(async () => {
  const uri = process.env.MONGO_URL
  const dbName = process.env.DB_NAME || 'test'
  const client = new MongoClient(uri)
  try {
    await client.connect()
    const db = client.db(dbName)
    const chatId = '6277663071'

    const vps = await db.collection('vpsPlansOf').find({ chatId }).toArray()
    console.log('=== vpsPlansOf for', chatId, '(count=' + vps.length + ') ===')
    for (const v of vps) {
      console.log(JSON.stringify({
        _id: v._id, chatId: v.chatId, name: v.name, label: v.label,
        vpsId: v.vpsId, contaboInstanceId: v.contaboInstanceId, host: v.host,
        region: v.region, productId: v.productId, imageId: v.imageId,
        osType: v.osType, isRDP: v.isRDP, defaultUser: v.defaultUser,
        plan: v.plan, planPrice: v.planPrice, status: v.status,
        provider: v.provider, autoRenewable: v.autoRenewable,
        rootPasswordSecretId: v.rootPasswordSecretId, sshKeySecretId: v.sshKeySecretId,
        start_time: v.start_time, end_time: v.end_time,
      }, null, 0))
    }

    const wallet = await db.collection('walletOf').findOne({ chatId })
    console.log('=== walletOf ===')
    console.log(JSON.stringify(wallet ? { chatId: wallet.chatId, usdIn: wallet.usdIn, usdOut: wallet.usdOut } : null))

    const keys = await db.collection('sshKeysOf').find({ telegramId: chatId }).toArray()
    console.log('=== sshKeysOf (count=' + keys.length + ') ===')
    for (const k of keys) console.log(JSON.stringify({ contaboSecretId: k.contaboSecretId, sshKeyName: k.sshKeyName, provider: k.provider, managed: k.managed, hasPriv: !!k.privateKey }))
  } catch (e) {
    console.error('ERR', e.message)
  } finally {
    await client.close()
  }
})()
