#!/usr/bin/env node
/**
 * RCA fix verification (2026-10-11) — reseller hosting "duplicate protection" + anti-red fallback.
 *
 * Task 2 — inner idempotency guard (cr-register-domain-&-create-cpanel.js) must treat as a TRUE
 *          duplicate ONLY a still-live account for the domain. It must IGNORE:
 *            (a) provisionState:'failed' ghosts (refunded → domain free again), and
 *            (b) THIS order's own placeholder stub (_id === info.customUsername).
 *          Previously it matched any non-deleted row → self-collided with the reseller's own
 *          'provisioning' stub, refunded, and left a non-deleted failed ghost that then
 *          permanently blocked every future order (the namewords.sbs / nameb2b2 incident).
 *
 * Task 3 — the anti-red challenge must NOT dead-end a real visitor. Every visitor reaches the
 *          proof-of-interaction click (the human gate that has always been required).
 *
 * Functional part uses the LOCAL sandbox Mongo (backend/.env MONGO_URL) with a throwaway domain.
 */
const fs = require('fs')
const path = require('path')
const { MongoClient } = require('mongodb')

// Load MONGO_URL / DB_NAME from backend/.env without dotenv.
const envTxt = fs.readFileSync('/app/backend/.env', 'utf8')
const env = {}
for (const line of envTxt.split('\n')) { const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '') }

const crRegisterJs = fs.readFileSync(path.join(__dirname, '../cr-register-domain-&-create-cpanel.js'), 'utf8')
const resellerJs = fs.readFileSync(path.join(__dirname, '../reseller-api.js'), 'utf8')
const antiRedJs = fs.readFileSync(path.join(__dirname, '../anti-red-service.js'), 'utf8')

let passed = 0, failed = 0
function assert(cond, msg) { if (cond) { console.log(`✅ ${msg}`); passed++ } else { console.error(`❌ ${msg}`); failed++ } }

async function main() {
  console.log('═══ STATIC ASSERTIONS ═══\n')

  // Task 2 — inner guard now scopes the duplicate match
  const guardBlock = crRegisterJs.slice(crRegisterJs.indexOf("const existingAccount = await guardDb.collection('cpanelAccounts').findOne({"))
    .slice(0, 900)
  assert(/provisionState:\s*\{\s*\$ne:\s*'failed'\s*\}/.test(guardBlock), "G1: inner guard excludes provisionState:'failed' ghosts")
  assert(/_id:\s*\{\s*\$ne:\s*info\.customUsername/.test(guardBlock), "G2: inner guard excludes THIS order's own stub (_id !== info.customUsername)")

  // reseller outer dup check unchanged (still excludes failed)
  assert(resellerJs.includes("findOne({ domain, deleted: { $ne: true }, provisionState: { $ne: 'failed' } })"),
    'G3: reseller-api outer duplicate check still ignores failed')

  // Task 3 — challenge no longer dead-ends; button reveal is unconditional
  assert(!/if\(sc>=35\)\{\s*up\(100,'Verification failed'\)/.test(antiRedJs.replace(/\s+/g, ' ').replace(/ /g, '')) &&
         !antiRedJs.includes("up(100,'Verification failed');\n      fl.style.display='block'"),
    'A1: hard-fail dead-end (up(100,\'Verification failed\') + early return) removed')
  assert(antiRedJs.includes("var poiDelay=(sc>=35)?1200:0;"), 'A2: high-score clients get a delayed (not denied) proof-of-interaction button')
  assert(antiRedJs.includes("vb.classList.add('show');\n      poiReady=true;"), 'A3: proof-of-interaction button is revealed for every visitor')

  console.log('\n═══ FUNCTIONAL (local sandbox Mongo) ═══\n')
  const url = env.MONGO_URL, dbn = env.DB_NAME || 'test'
  const c = new MongoClient(url); await c.connect()
  const db = c.db(dbn)
  const col = db.collection('cpanelAccounts')
  const DOMAIN = `dupguardtest-${Date.now()}.example`
  const customUsername = 'dgtstub01' // this order's own placeholder stub id

  // The exact query the fixed inner guard runs:
  const guardQuery = () => col.findOne({
    domain: DOMAIN,
    deleted: { $ne: true },
    provisionState: { $ne: 'failed' },
    _id: { $ne: customUsername || '__no_self__' },
  })

  try {
    await col.deleteMany({ domain: DOMAIN })

    // Scenario 1: only this order's own provisioning stub exists → guard must NOT match (no self-collision)
    await col.insertOne({ _id: customUsername, domain: DOMAIN, provisionState: 'provisioning', chatId: 'owner1' })
    let m = await guardQuery()
    assert(m === null, 'F1: own provisioning stub is NOT treated as a duplicate (self-collision fixed)')

    // Scenario 2: add a prior FAILED ghost (refunded) → guard must still NOT match
    await col.insertOne({ _id: 'dgtfailed01', domain: DOMAIN, provisionState: 'failed', provisionFailedReason: 'duplicate_provisioning_prevented', chatId: 'owner1' })
    m = await guardQuery()
    assert(m === null, 'F2: a refunded failed ghost does NOT block a new order (permanent-block bug fixed)')

    // Scenario 3: add a REAL active account (different id, has cpUser, not failed, not deleted) → MUST match
    await col.insertOne({ _id: 'dgtactive01', domain: DOMAIN, cpUser: 'dgtactive01', provisionState: 'active', chatId: 'owner1' })
    m = await guardQuery()
    assert(m && m._id === 'dgtactive01', 'F3: a genuinely active account IS still detected as a true duplicate')

    // Scenario 4: active account soft-deleted → guard must NOT match (domain freed)
    await col.updateOne({ _id: 'dgtactive01' }, { $set: { deleted: true } })
    m = await guardQuery()
    assert(m === null, 'F4: a soft-deleted account frees the domain again')
  } finally {
    await col.deleteMany({ domain: DOMAIN })
    await c.close()
  }

  console.log(`\n═══ RESULT: ${passed} passed, ${failed} failed ═══`)
  process.exit(failed > 0 ? 1 : 0)
}
main().catch(e => { console.error('ERR', e.stack || e.message); process.exit(1) })
