// read-only: live/engagement signals for one web account's campaigns today
const { MongoClient } = require('mongodb')
;(async () => {
  const cl = await MongoClient.connect(process.env.MONGO_URL), db = cl.db(process.env.DB_NAME)
  const cid = process.argv[2] || '5000000000000143', since = new Date(Date.now() - 12 * 3600e3)
  const notes = await db.collection('webNotifications').find({ chatId: cid, createdAt: { $gte: since } }).toArray()
  const kinds = {}; for (const n of notes) kinds[n.kind] = (kinds[n.kind] || 0) + 1
  console.log('web notifications 12h:', notes.length, JSON.stringify(kinds), 'unread', notes.filter(n => !n.read).length)
  const sample = {}; for (const n of notes) { const k = n.text.split('\n')[0].replace(/[0-9+()]/g, '#').slice(0, 60); sample[k] = (sample[k] || 0) + 1 }
  console.log(Object.entries(sample).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, v]) => `  ${v}× ${k}`).join('\n'))
  const camps = await db.collection('bulkCallCampaigns').find({ chatId: { $in: [Number(cid), cid] }, createdAt: { $gte: since } }).toArray()
  for (const c of camps) {
    const L = c.leads, f = (p) => L.filter(p).length
    console.log(`\n${c.name}: mode=${c.mode} transferTo=${c.transferNumber || c.forwardTo || '-'} keys=${JSON.stringify(c.activeKeys || c.keys || null)} vm=${!!c.voicemailAudioUrl}`)
    console.log(`  pressed=${f(l => l.digitPressed)} transferred=${f(l => l.transferred)} connected=${f(l => l.transferConnected)} answered(dur>0)=${f(l => l.duration > 0)} avgDur=${Math.round(L.filter(l => l.duration > 0).reduce((a, l) => a + l.duration, 0) / Math.max(1, f(l => l.duration > 0)))}s vmLeft=${f(l => l.voicemailDropped)} listened10s+=${f(l => l.duration >= 10)}`)
    const keys = {}; for (const l of L) if (l.digitPressed) keys[l.digitPressed] = (keys[l.digitPressed] || 0) + 1
    console.log('  digits', JSON.stringify(keys), 'answeredAt set:', f(l => l.answeredAt), 'ringing status ever:', f(l => l.status === 'ringing'))
  }
  const acc = await db.collection('webAccounts').findOne({ email: 'businessintelusa@gmail.com' }, { projection: { pushSubs: 1, push: 1, notifyPrefs: 1, telegramLinked: 1, linkedChatId: 1 } })
  console.log('\naccount push/telegram:', JSON.stringify(acc).slice(0, 300))
  await cl.close()
})().catch(e => { console.error(e.message); process.exit(1) })
