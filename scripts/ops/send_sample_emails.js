// Sends every CloudIVR web email, filled with an account's sample data, to one inbox (owner review).
// Usage (from the app dir): NODE_PATH=js/node_modules node scripts/ops/send_sample_emails.js you@example.com [chatId] [--langs=en,fr,es] [--extra=fr:topup,es:weekly]
require('dotenv').config({ path: 'backend/.env' })
const { MongoClient } = require('mongodb')
const { createEmails, DEFAULTS } = require('../../js/cloudivr-web/emails')
const { sendMail } = require('../../js/cloudivr-web/auth')
const T = require('../../js/cloudivr-web/email-templates')

const args = process.argv.slice(2)
const opt = (k) => (args.find(a => a.startsWith(`--${k}=`)) || '').split('=')[1]
const [to, chatId = '5000000000000001'] = args.filter(a => !a.startsWith('--'))
const jobs = [
  ...(opt('langs') || 'en').split(',').flatMap(lang => T.TYPES.map(type => [lang, type])),
  ...(opt('extra') || '').split(',').filter(Boolean).map(x => x.split(':')),
]

;(async () => {
  if (!/^\S+@\S+\.\S+$/.test(to || '')) throw new Error('Give the inbox to send to.')
  const c = await MongoClient.connect(process.env.MONGO_URL)
  const db = c.db(process.env.DB_NAME)
  const acc = await db.collection('webAccounts').findOne({ _id: Number(chatId) })
  if (!acc) throw new Error(`No web account ${chatId}`)
  const e = createEmails(db, { log: () => {} })
  let ok = 0
  for (const [lang, type] of jobs) {
    const { subject, html } = e.render(type, await e.sample(type, chatId), { acc: { ...acc, email: to }, lang, email: DEFAULTS })
    const sent = await sendMail(to, subject, html).catch(x => { console.log(`FAIL ${lang} ${type}: ${x.message}`); return false })
    if (sent) ok++
    console.log(`${sent ? 'SENT' : 'NOT SENT'} ${lang} ${type} — ${subject}`)
    await new Promise(r => setTimeout(r, 1500))
  }
  console.log(JSON.stringify({ to, sent: ok, total: jobs.length }))
  await c.close()
  process.exit(0)
})().catch(x => { console.error('ERROR', x.message); process.exit(1) })
