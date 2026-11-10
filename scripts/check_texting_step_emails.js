// Local check for Landline-to-Texting setup emails. Usage: node scripts/check_texting_step_emails.js
require('dotenv').config({ path: require('path').join(__dirname, '../backend/.env') })
const { MongoClient } = require('mongodb')
const ALICE = '5000000000000001'
;(async () => {
  const c = await MongoClient.connect(process.env.MONGO_URL), db = c.db(process.env.DB_NAME)
  const hs = db.collection('hostedSms'), log = db.collection('webEmailLog')
  const E = require('../js/cloudivr-web/emails.js').createEmails(db, { log: () => {} })
  const clean = async () => { await hs.deleteMany({ _id: /^STEPCHK-/ }); await log.deleteMany({ _id: /^texting:STEPCHK-/ }) }
  await clean()
  const base = { chatId: ALICE, plan: 'texting', planNumber: null, paid: 200, createdAt: new Date() }
  await hs.insertMany([
    { ...base, _id: 'STEPCHK-1', phoneNumber: '+12125550201', status: 'verify', updatedAt: new Date() },
    { ...base, _id: 'STEPCHK-2', phoneNumber: '+12125550202', status: 'review', docsAt: new Date(), updatedAt: new Date() },
    { ...base, _id: 'STEPCHK-3', phoneNumber: '+12125550203', status: 'active', nextBillAt: new Date(Date.now() + 30 * 86400000), updatedAt: new Date() },
    { ...base, _id: 'STEPCHK-4', phoneNumber: '+12125550204', status: 'rejected', updatedAt: new Date() },
    { ...base, _id: 'STEPCHK-5', phoneNumber: '+12125550205', status: 'active', updatedAt: new Date(Date.now() - 2 * 86400000) },
    { ...base, _id: 'STEPCHK-6', phoneNumber: '+12125550206', status: 'cancelled', updatedAt: new Date() },
  ])
  await E.tick()
  const show = async (label) => console.log(label, (await log.find({ _id: /^texting:STEPCHK-/ }).sort({ _id: 1 }).toArray()).map(x => `${x._id.split(':')[1]}/${x._id.split(':')[2]} → ${x.subject}`))
  await show('round1')
  await hs.updateOne({ _id: 'STEPCHK-1' }, { $set: { status: 'loa', updatedAt: new Date() } })
  await E.tick(); await E.tick()
  await show('round2')
  const old = await hs.findOne({ _id: 'STEPCHK-5' })
  console.log('old marked only:', old.emailedStatus)
  const html = (await log.findOne({ _id: /^texting:STEPCHK-3/ }))?.html || ''
  console.log('active html has bill + link:', /Next monthly fee/.test(html), /app\/texting\?id=STEPCHK-3/.test(html))
  if (process.argv[2] !== 'keep') await clean()
  await c.close(); process.exit(0)
})()
