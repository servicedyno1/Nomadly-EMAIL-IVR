// Landline to Texting on the new Telnyx account (stubbed): eligibility + order + texts use the new key and its messaging
// profile; unfinished/active old-account setups are asked to start again and the paid setup carries over. Run from /app.
require('dotenv').config({ path: '/app/backend/.env' })
process.env.TELNYX_FAX_API_KEY = 'KEY_new_stub'
process.env.WEB_CLOUDIVR_DRY_RUN = 'false'
const Module = require('module'), realAxios = require('axios')
const calls = []
const fake = async (o) => {
  calls.push(o)
  if (o.url.includes('/messaging_profiles') && o.method === 'get') return { data: { data: [] } }
  if (o.url.includes('/messaging_profiles') && o.method === 'post') return { data: { data: { id: 'mp_new' } } }
  if (o.url.includes('eligibility_numbers_check')) return { data: { phone_numbers: [{ eligible: true }] } }
  if (o.url.endsWith('/messaging_hosted_number_orders')) return { data: { data: { id: 'hno_1' } } }
  throw new Error(`unexpected ${o.method} ${o.url}`)
}
for (const m of ['get', 'delete']) fake[m] = (url, o = {}) => fake({ ...o, method: m, url })
for (const m of ['post', 'patch']) fake[m] = (url, data, o = {}) => fake({ ...o, method: m, url, data })
fake.create = realAxios.create
const load = Module._load; Module._load = function (req, ...a) { return req === 'axios' ? fake : load.call(this, req, ...a) }
const { MongoClient } = require('mongodb')
const HS = require('../hosted-sms')
Module._load = load
let pass = 0, fail = 0
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log(`${c ? '✅' : '❌'} ${n}${x ? ` — ${x}` : ''}`) }
;(async () => {
  const cl = await MongoClient.connect(process.env.MONGO_URL), db = cl.db(process.env.DB_NAME)
  const CHAT = String(require('../cloudivr-web/notify.js').WEB_ID_BASE + 987654), OLD = '+13125550111', NEW = '+13125550122'
  const col = db.collection('hostedSms'), tells = [], admin = []
  const clean = async () => { await col.deleteMany({ chatId: CHAT }); await db.collection('walletOf').deleteOne({ _id: CHAT }); await db.collection('transactions').deleteMany({ chatId: CHAT }); await db.collection('faxConfig').deleteOne({ _id: 'QA Texting|fax-account' }) }
  await clean()
  await col.insertOne({ _id: 'hs_qa_old', chatId: CHAT, phoneNumber: OLD, status: 'loa', live: true, paid: 20, telnyxOrderId: 'old_1', createdAt: new Date() })
  await db.collection('walletOf').updateOne({ _id: CHAT }, { $set: { usdIn: 250, usdOut: 0 } }, { upsert: true })
  HS.init({ db, log: () => {}, tell: async (id, t) => tells.push(t), brand: 'QA', notifyAdmin: (t) => admin.push(t) })
  await new Promise(r => setTimeout(r, 1500))
  const bal = async () => { const w = await db.collection('walletOf').findOne({ _id: CHAT }); return (w?.usdIn || 0) - (w?.usdOut || 0) }
  try {
    let old = await col.findOne({ _id: 'hs_qa_old' })
    ok('old-account setup asked to start again', old.status === 'restart' && !old.live && tells.some(t => t.includes('start again')) && admin.some(t => t.includes(OLD)))
    let r = await HS.start(CHAT, OLD)
    ok('restart opens order, no charge', r.item && r.item.status === 'verify' && await bal() === 250, JSON.stringify(r).slice(0, 200))
    const order = calls.find(c => c.url.endsWith('/messaging_hosted_number_orders'))
    ok('order on new account + its messaging profile', order.headers.Authorization === 'Bearer KEY_new_stub' && order.data.messaging_profile_id === 'mp_new')
    ok('profile created with SMS webhook', calls.some(c => c.method === 'post' && c.url.includes('/messaging_profiles') && String(c.data.webhook_url).endsWith('/telnyx/sms-webhook')))
    ok('carried-over setup hidden from list', !(await HS.list(CHAT)).some(i => i.id === 'hs_qa_old'))
    r = await HS.start(CHAT, NEW)
    ok('fresh number pays setup', r.item && await bal() === 50, JSON.stringify(r).slice(0, 200) + ' bal ' + await bal())
    ok('new orders marked on new account', (await col.countDocuments({ chatId: CHAT, account: 'telnyx2' })) === 2)
  } finally { await clean(); await cl.close(); console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0) }
})()
