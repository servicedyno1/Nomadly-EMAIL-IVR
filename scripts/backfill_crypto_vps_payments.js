/* Backfill missing `payments` ledger rows for DIRECT-CRYPTO VPS purchases.
 *
 * Root cause (fixed forward in js/_index.js): crypto VPS buys wrote to
 * `transactions`/`vpsTransactions` but NOT to `payments`. This reconstructs the
 * missing `Crypto,VPSPlan/VPSUpgrade,...` rows from the authoritative crypto
 * transactions (those carry metadata.psp + ref/coin/value).
 *
 * Idempotent: upsert keyed on _id=ref with $setOnInsert, so it NEVER overwrites
 * a row the live code (or a prior run) already wrote. DRY-RUN unless RUN=1.
 */
require('dotenv').config({ path: '/app/backend/.env' })
const { MongoClient } = require('mongodb')
const RUN = process.env.RUN === '1'

function fmtDate(d) { return new Date(d).toString() } // matches `${new Date()}` format used by the live code

;(async () => {
  const c = new MongoClient(process.env.MONGO_URL); await c.connect()
  const db = c.db(process.env.DB_NAME || 'test')
  const transactions = db.collection('transactions')
  const payments = db.collection('payments')
  const nameOf = db.collection('nameOf')

  // Crypto VPS purchases/upgrades = VPS-type transactions that carry a psp tag.
  const txs = await transactions.find({
    type: { $in: ['vps', 'vps-upgrade-plan', 'vps-upgrade-disk'] },
    'metadata.psp': { $exists: true, $ne: null },
  }).toArray()

  // Dedupe by ref (a single purchase can emit >1 transaction row)
  const byRef = new Map()
  const noRef = []
  for (const t of txs) {
    const ref = t.metadata?.ref
    if (!ref) { noRef.push(t); continue }
    if (!byRef.has(ref)) byRef.set(ref, t)
  }

  console.log(`Crypto VPS transactions found: ${txs.length} | unique refs: ${byRef.size} | missing-ref: ${noRef.length}`)
  console.log(`Mode: ${RUN ? '*** RUN (writing) ***' : 'DRY-RUN (no writes)'}\n`)

  let willInsert = 0, skipExisting = 0, inserted = 0
  const rows = []
  for (const [ref, t] of byRef) {
    const chatId = String(t.chatId)
    const price = Number(t.amount) || 0
    const md = t.metadata || {}
    const coin = md.coin || '?'
    const value = md.value != null ? md.value : '?'
    const isUpgrade = t.type !== 'vps'
    const nameDoc = await nameOf.findOne({ _id: chatId }) || await nameOf.findOne({ _id: Number(chatId) })
    const name = (nameDoc && (nameDoc.val || nameDoc.value || nameDoc.name)) || 'unknown'
    const date = fmtDate(t.createdAt || t.updatedAt || Date.now())

    const val = isUpgrade
      ? `Crypto,VPSUpgrade,${md.upgradeType || (t.type === 'vps-upgrade-disk' ? 'disk' : 'plan')},$${price},${chatId},${name},${date},${value} ${coin}`
      : `Crypto,VPSPlan,${md.plan || 'Monthly'},$${price},${chatId},${name},${date},${value} ${coin}`

    const exists = await payments.findOne({ _id: ref })
    const status = exists ? 'SKIP(exists)' : 'INSERT'
    if (exists) skipExisting++; else willInsert++
    rows.push({ ref, chatId, price, coin, date, status, val })

    if (RUN && !exists) {
      await payments.updateOne(
        { _id: ref },
        { $setOnInsert: { val, _backfilledAt: new Date(), _backfillSource: 'crypto-vps-ledger-2026-08-31', _origTxId: t._id } },
        { upsert: true }
      )
      inserted++
    }
  }

  rows.sort((a, b) => new Date(a.date) - new Date(b.date))
  for (const r of rows) console.log(`[${r.status}] ref=${r.ref} chat=${r.chatId} $${r.price} ${r.coin} ${r.date}\n         ${r.val}`)

  console.log(`\nSUMMARY: unique=${byRef.size}  toInsert=${willInsert}  alreadyPresent=${skipExisting}  actuallyInserted=${inserted}`)
  if (!RUN) console.log('DRY-RUN only. Re-run with RUN=1 to write.')
  await c.close()
})().catch(e => { console.error('FATAL', e); process.exit(1) })
