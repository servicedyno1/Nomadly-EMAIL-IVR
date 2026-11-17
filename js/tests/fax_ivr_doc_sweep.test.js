// Keypad fax documents: a key's replaced document goes on save; unsaved uploads go after 6 hours. Local Mongo only.
require('dotenv').config({ path: require('path').join(__dirname, '../../backend/.env') })
const { MongoClient, GridFSBucket } = require('mongodb')
const fax = require('../../js/fax-service')
const ok = (c, m) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) process.exitCode = 1 }
;(async () => {
  const cli = await MongoClient.connect(process.env.MONGO_URL), db = cli.db(process.env.DB_NAME)
  fax.init({ db, log: () => {} })
  const b = new GridFSBucket(db, { bucketName: 'faxFiles' }), chatId = 'sweep_test_chat'
  const put = (age) => new Promise((res, rej) => { const w = b.openUploadStream('d.pdf', { metadata: { chatId, kind: 'ivr' } }); w.on('finish', async () => { await db.collection('faxFiles.files').updateOne({ _id: w.id }, { $set: { uploadDate: new Date(Date.now() - age) } }); res(String(w.id)) }).on('error', rej); w.end(Buffer.from('%PDF-1.4')) })
  const exists = async (id) => !!(await db.collection('faxFiles.files').findOne({ _id: new (require('mongodb').ObjectId)(id) }))
  const used = await put(10 * 3600000), oldUnsaved = await put(7 * 3600000), freshUnsaved = await put(60000), replaced = await put(60000)
  await db.collection('phoneNumbersOf').updateOne({ _id: chatId }, { $set: { val: { numbers: [{ phoneNumber: '+1', features: { ivr: { options: { 1: { action: 'submenu', subMenu: { options: { 2: { action: 'fax', fileId: used } } } } } } } }] } } }, { upsert: true })
  await fax.sweepIvrDocs(chatId, [used], [replaced])
  ok(!(await exists(replaced)), 'the document a saved key no longer uses is removed right away')
  ok(await exists(freshUnsaved), 'a fresh upload that is not saved yet is kept for now')
  await fax.sweepAllIvrDocs()
  ok(!(await exists(oldUnsaved)), 'an upload never saved is removed after 6 hours by the hourly check')
  ok(await exists(used), 'a document a sub-menu key still uses is kept')
  for (const id of [used, freshUnsaved]) await b.delete(new (require('mongodb').ObjectId)(id)).catch(() => {})
  await db.collection('phoneNumbersOf').deleteOne({ _id: chatId })
  await cli.close(); console.log('DONE'); process.exit(process.exitCode || 0)
})().catch(e => { console.error(e); process.exit(1) })
