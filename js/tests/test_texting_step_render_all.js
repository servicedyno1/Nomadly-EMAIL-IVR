// Renders the textingStep email for every step in en/fr/es and checks no undefined/NaN and step-specific content.
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', 'backend', '.env') })
const { MongoClient } = require('mongodb')
const { createEmails } = require('../cloudivr-web/emails.js')

async function main() {
  const client = await MongoClient.connect(process.env.MONGO_URL)
  const db = client.db('TEST_texting_render_' + Date.now())
  const e = createEmails(db, { log: () => {} })
  let bad = [], subjects = {}
  const steps = ['verify', 'loa', 'documents', 'admin_docs', 'review', 'active', 'failed']
  for (const step of steps) for (const lang of ['en', 'fr', 'es']) {
    const base = await e.sample('textingStep', 'x')
    const d = { ...base, step, id: 'abc123', refund: step === 'failed' ? 25 : 0, note: step === 'failed' ? 'Carrier refused' : null }
    try {
      const r = e.render('textingStep', d, { acc: { _id: 'x', email: 'a@example.com', name: 'A' }, lang, email: {} })
      if (!r.subject || /undefined|NaN|\[object/.test(r.subject + r.html)) bad.push(`${step}/${lang}: bad content`)
      if (!r.html.includes('texting?id=abc123')) bad.push(`${step}/${lang}: no link`)
      subjects[`${step}/${lang}`] = r.subject
      if (step === 'failed' && lang === 'en' && !/25/.test(r.html)) bad.push('failed/en: refund missing')
      if (step === 'failed' && lang === 'en' && !/Carrier refused/.test(r.html)) bad.push('failed/en: note missing')
    } catch (err) { bad.push(`${step}/${lang}: ${err.message}`) }
  }
  console.log(subjects)
  console.log(bad.length ? 'FAIL ' + bad.join(' | ') : 'PASS all steps x langs')
  await db.dropDatabase(); await client.close()
}
main().catch(e => { console.error(e); process.exit(1) })
