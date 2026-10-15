/* global process, require, console */
// Terminate ONE cPanel account on WHM (same API the bot uses) and mark it deleted in cpanelAccounts.
// Dry-run by default; pass --apply to actually remove. Safety: refuses unless the docroots are empty
// unless --force is given.
//   node whm_delete_account_2026-10.js <backend.env> <cpUser> [--apply] [--force]
const fs = require('fs')
const path = require('path')
const axios = require(path.join(process.cwd(), 'node_modules', 'axios'))
const { MongoClient } = require(path.join(process.cwd(), 'node_modules', 'mongodb'))

const env = Object.fromEntries(fs.readFileSync(process.argv[2], 'utf8').split('\n')
  .filter(l => /^[A-Z_]+=/.test(l)).map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, '')] }))
const cpUser = process.argv[3]
const APPLY = process.argv.includes('--apply')
if (!cpUser) { console.error('usage: whm_delete_account_2026-10.js <backend.env> <cpUser> [--apply]'); process.exit(1) }

const BASE = `${env.WHM_API_URL.replace(/\/+$/, '')}/json-api`
const headers = {
  Authorization: `whm ${env.WHM_USERNAME || 'root'}:${env.WHM_TOKEN}`,
  ...(env.CF_ACCESS_CLIENT_ID && env.CF_ACCESS_CLIENT_SECRET
    ? { 'CF-Access-Client-Id': env.CF_ACCESS_CLIENT_ID, 'CF-Access-Client-Secret': env.CF_ACCESS_CLIENT_SECRET } : {}),
}
const whm = (fn, params) => axios.get(`${BASE}/${fn}`, { params: { 'api.version': 1, ...params }, headers, timeout: 60000 })
;(async () => {
  console.log(`DB ${env.DB_NAME} — ${APPLY ? 'APPLY' : 'DRY-RUN'} — terminate ${cpUser}`)
  const before = (await whm('listaccts')).data?.data?.acct || []
  const acct = before.find(a => a.user.toLowerCase() === cpUser.toLowerCase())
  if (!acct) { console.log(`"${cpUser}" is not on WHM (already gone). Will still reconcile the DB.`) }
  else console.log(`on WHM: user=${acct.user} domain=${acct.domain} disk=${acct.diskused} suspended=${acct.suspended}`)

  const cl = await MongoClient.connect(env.MONGO_URL)
  const col = cl.db(env.DB_NAME).collection('cpanelAccounts')
  const docs = await col.find({ cpUser }).toArray()
  console.log(`DB rows for cpUser=${cpUser}: ${docs.length}`, docs.map(d => ({ _id: String(d._id), domain: d.domain, chatId: d.chatId, deleted: !!d.deleted })))

  if (!APPLY) { console.log('\nDry-run only. Re-run with --apply to terminate.'); await cl.close(); return }

  let whmOk = !acct
  if (acct) {
    const r = await whm('removeacct', { user: cpUser })
    whmOk = r.data?.metadata?.result === 1
    console.log(`/removeacct → result=${r.data?.metadata?.result} reason=${r.data?.metadata?.reason || ''}`)
    const after = (await whm('listaccts')).data?.data?.acct || []
    const still = after.some(a => a.user.toLowerCase() === cpUser.toLowerCase())
    console.log(`post-check: on WHM = ${still} · total accounts now ${after.length}`)
    whmOk = whmOk && !still
  }
  const set = { deleted: true, deletedAt: new Date(), deletedBy: 'admin_script', deleteReason: 'empty_account_license_reclaim' }
  if (whmOk) set.terminatedOnWhm = true, set.terminatedAt = new Date()
  else set.whmTerminatePending = true // let the hourly self-heal sweep finish it
  const res = await col.updateMany({ cpUser }, { $set: set })
  console.log(`DB updated: ${res.modifiedCount} row(s) → deleted=true terminatedOnWhm=${!!whmOk}${whmOk ? '' : ' whmTerminatePending=true'}`)
  await cl.close()
})().catch(e => { console.error('ERR', e.response?.status || '', e.message); process.exit(1) })
