// AI-support suspended-number scenarios (2026-10). LOCAL Mongo only — never the live DB.
// Usage: node js/tests/ai_support_suspended_2026-10.js [path-to-ai-support-module]
require('../config-setup')
const { MongoClient } = require('mongodb')
const LOCAL = 'mongodb://localhost:27017'
const DB = 'aisupport_scenarios'
const mod = process.argv[2] || '../ai-support.js'
const ai = require(mod)

const day = 86400000
const iso = (d) => new Date(Date.now() + d * day).toISOString()
const num = (phoneNumber, plan, status, expDays, extra = {}) => ({ phoneNumber, plan, planPrice: { starter: 50, pro: 75, business: 120 }[plan], status, provider: 'twilio', purchaseDate: iso(-10), expiresAt: iso(expDays), ...extra })

const USERS = {
  // Active Pro plan, its primary number suspended by the carrier, 0/15 extra numbers used.
  pro_free_slot: [num('+18885550101', 'pro', 'suspended', 20)],
  // Active Starter plan, all 3 extra-number slots used, one extra number suspended (slot still counted).
  starter_full: [num('+18885550201', 'starter', 'active', 20),
    num('+18885550202', 'starter', 'active', 20, { isSubNumber: true, parentNumber: '+18885550201' }),
    num('+18885550203', 'starter', 'active', 20, { isSubNumber: true, parentNumber: '+18885550201' }),
    num('+18885550204', 'starter', 'suspended', 20, { isSubNumber: true, parentNumber: '+18885550201' })],
  // Phone plan expired.
  expired: [num('+18885550301', 'pro', 'expired', -5)],
  // Shape of @draggadem876 on 2026-10-20 (numbers replaced): Pro number released by carrier, another active Pro plan with 1/15 extras.
  original: [num('+18445550401', 'pro', 'released', 30),
    num('+18885550402', 'pro', 'active', 31),
    num('+18885550403', 'pro', 'active', 31, { isSubNumber: true, parentNumber: '+18885550402' })],
}
const IDS = { pro_free_slot: 900000001, starter_full: 900000002, expired: 900000003, original: 900000004 }
const PHRASES = ['my number got suspended, what do I do?', 'Why was my phone number suspended? Do I need to buy another plan?', 'number not working anymore, says sub-account suspended. how do i get a working number again']
const ORIGINAL = ['I think my number is suspended', 'I barely used the number']

const grade = (kind, t) => {
  const s = t.toLowerCase().replace(/(do not|don't|dont|no need to|not need to)[^.]{0,40}/g, '')
  const add = s.includes('add number to plan')
  const buyOnly = /only (solution|option|way) is to (buy|purchase)|must (buy|purchase)|need to (buy|purchase) (a |another )?(new )?plan/.test(s)
  if (kind === 'pro_free_slot' || kind === 'original') return add && !buyOnly && (kind === 'original' || /15/.test(s))
  if (kind === 'starter_full') return /limit|full|all 3|3\/3|3 of 3|maximum/.test(s) && /upgrade/.test(s) && /(free|release|remove)/.test(s) && !buyOnly && (!/tap ➕ add number to plan/.test(s) || /free (a|up a) slot|once a slot is free/.test(s))
  if (kind === 'expired') return /(renew|choose a plan|buy|purchase)/.test(s) && !add
}

;(async () => {
  const c = new MongoClient(LOCAL); await c.connect(); const db = c.db(DB)
  await db.dropDatabase()
  for (const [k, numbers] of Object.entries(USERS)) await db.collection('phoneNumbersOf').insertOne({ _id: IDS[k], val: { numbers } })
  for (const id of Object.values(IDS)) await db.collection('walletOf').insertOne({ _id: id, usdIn: 50, usdOut: 0 })
  ai.initAiSupport(db)
  let pass = 0, total = 0
  const run = async (kind, msg) => {
    const r = await ai.getAiResponse(IDS[kind], msg, 'en')
    const ok = grade(kind, r.response || '')
    total++; if (ok) pass++
    console.log(`\n### [${ok ? 'PASS' : 'FAIL'}] ${kind} — "${msg}"\n${(r.response || r.error || '').replace(/<[^>]+>/g, '')}`)
  }
  if (!process.env.ORIGINAL_ONLY) for (const kind of ['pro_free_slot', 'starter_full', 'expired']) for (const p of PHRASES) await run(kind, p)
  for (const m of ORIGINAL) await run('original', m)
  console.log(`\nRESULT ${pass}/${total}`)
  await db.dropDatabase(); await c.close(); process.exit(0)
})().catch(e => { console.error(e); process.exit(1) })
