/* ============================================================================
 * Ops: gift/comp-register supportcex.io for @dNvxc (chatId 8723341075)
 * "as if ordered from the bot" — Cloudflare NS, OpenProvider registrar,
 * NO wallet charge (gift/comp), DM the user from the production bot.
 *
 * Reuses the app's own domainService.registerDomain so the Cloudflare zone,
 * OpenProvider registration and DB records (domainsOf metadata +
 * registeredDomains) are byte-for-byte what a real bot purchase creates.
 *
 * Usage (on droplet, from the active app-main release dir):
 *   node ops_gift_domain_supportcex.js /opt/nomadly/shared/app-main/backend.env            # DRY RUN
 *   node ops_gift_domain_supportcex.js /opt/nomadly/shared/app-main/backend.env --commit   # EXECUTE
 * ==========================================================================*/
/* global process, require, console */
const fs = require('fs')
const path = require('path')
const https = require('https')

const RELEASE = '/opt/nomadly/releases/app-main/20261020T115630Z-4da335c'
const envPath = process.argv[2]
const COMMIT = process.argv.includes('--commit')

const CHAT_STR = '8723341075'
const USERNAME = 'dNvxc'
const DOMAIN = 'supportcex.io'
const LANG = 'en'
const SHOWN_PRICE = 244 // real current bot price; recorded for audit only, NOT charged

// ── load env ──
const env = {}
for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m) { let v = m[2].trim(); if (v.length >= 2 && (v[0] === '"' || v[0] === "'") && v[v.length - 1] === v[0]) v = v.slice(1, -1); env[m[1]] = v; process.env[m[1]] = v }
}
process.chdir(RELEASE)

const { MongoClient } = require(path.join(RELEASE, 'node_modules', 'mongodb'))
const domainService = require(path.join(RELEASE, 'js', 'domain-service'))
const opService = require(path.join(RELEASE, 'js', 'op-service'))
const { generateTransactionId, logTransaction } = require(path.join(RELEASE, 'js', 'transaction-id'))
const { translation } = require(path.join(RELEASE, 'js', 'translation'))

const sanitized = DOMAIN.replaceAll('.', '@')

function tgSendMessage(token, chatId, text) {
  return new Promise((resolve) => {
    const body = JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true })
    const req = https.request({
      hostname: 'api.telegram.org', path: `/bot${token}/sendMessage`, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, (res) => { let d = ''; res.on('data', c => d += c); res.on('end', () => { try { resolve(JSON.parse(d)) } catch (e) { resolve({ ok: false, raw: d }) } }) })
    req.on('error', e => resolve({ ok: false, error: e.message }))
    req.write(body); req.end()
  })
}

;(async () => {
  const c = new MongoClient(env.MONGO_URL); await c.connect(); const db = c.db(env.DB_NAME)
  console.log(`\n=== GIFT/COMP domain registration ===`)
  console.log(`mode        : ${COMMIT ? 'COMMIT (will mutate production)' : 'DRY RUN (no changes)'}`)
  console.log(`db          : ${env.DB_NAME}`)
  console.log(`user        : @${USERNAME}  chatId=${CHAT_STR}`)
  console.log(`domain      : ${DOMAIN}`)
  console.log(`registrar   : OpenProvider   nameservers: Cloudflare`)
  console.log(`charge      : NONE (gift/comp)   recorded shown price: $${SHOWN_PRICE}`)

  // ── verify user exists ──
  const nameDoc = await db.collection('nameOf').findOne({ _id: CHAT_STR })
  console.log(`\nuser check  : nameOf[${CHAT_STR}].val = ${nameDoc ? JSON.stringify(nameDoc.val) : 'NOT FOUND'}`)
  if (!nameDoc) { console.log('ABORT: user not found'); await c.close(); return }

  // ── idempotency guards ──
  const existReg = await db.collection('registeredDomains').findOne({ _id: DOMAIN })
  const existMeta = await db.collection('domainsOf').findOne({ domainName: DOMAIN })
  const ownDoc = await db.collection('domainsOf').findOne({ _id: CHAT_STR })
  const ownsAlready = ownDoc && Object.prototype.hasOwnProperty.call(ownDoc, sanitized)
  let inOpAccount = null
  try { inOpAccount = await opService.isDomainInAccount(DOMAIN) } catch (e) { inOpAccount = `err:${e.message}` }
  console.log(`\nidempotency :`)
  console.log(`  registeredDomains[${DOMAIN}] : ${existReg ? 'EXISTS' : 'none'}`)
  console.log(`  domainsOf meta {domainName}  : ${existMeta ? 'EXISTS (owner ' + existMeta.chatId + ')' : 'none'}`)
  console.log(`  ownership map field          : ${ownsAlready ? 'EXISTS' : 'none'}`)
  console.log(`  OpenProvider isDomainInAccount: ${inOpAccount}`)
  if (existReg || existMeta || ownsAlready || inOpAccount === true) {
    console.log('\nABORT: domain already registered/recorded — nothing to do (idempotent).')
    await c.close(); return
  }

  if (!COMMIT) {
    console.log('\nDRY RUN complete. Re-run with --commit to register + record + DM.')
    await c.close(); return
  }

  // ── 1) register (Cloudflare zone + OpenProvider), writes domainsOf meta + registeredDomains ──
  console.log('\n[1/4] Registering via domainService.registerDomain (OpenProvider + Cloudflare NS)...')
  const result = await domainService.registerDomain(DOMAIN, 'OpenProvider', 'cloudflare', db, CHAT_STR, null, async () => {})
  if (!result || result.error || !result.success) {
    console.log('REGISTRATION FAILED (no charge, no records):', result && (result.error || JSON.stringify(result)))
    await c.close(); process.exit(2)
  }
  console.log(`      OK registrar=${result.registrar} opDomainId=${result.opDomainId} cfZoneId=${result.cfZoneId}`)
  console.log(`      nameservers=${(result.nameservers || []).join(', ')}`)

  // ── 2) ownership map (so it shows in "My Domains") ──
  console.log('[2/4] Writing ownership map domainsOf[' + CHAT_STR + '].' + sanitized + ' = true ...')
  await db.collection('domainsOf').updateOne({ _id: CHAT_STR }, { $set: { [sanitized]: true } }, { upsert: true })

  // ── 3) transaction record (comp, amount 0) ──
  const txnId = generateTransactionId()
  await logTransaction(db, {
    transactionId: txnId, chatId: CHAT_STR, type: 'domain', amount: 0, currency: 'USD', status: 'completed',
    metadata: {
      domain: DOMAIN, registrar: result.registrar, nameservers: result.nameservers,
      cfZoneId: result.cfZoneId, opDomainId: result.opDomainId,
      comp: true, charged: false, shownPrice: SHOWN_PRICE,
      note: 'Manual gift/comp — registered as a bot order, no wallet charge', grantedBy: 'ops',
    },
  })
  console.log('[3/4] Transaction logged:', txnId, '(amount $0, comp)')

  // ── 4) DM the user from the production bot (exactly like buyDomainFullProcess) ──
  const dm = translation('t.domainBoughtSuccess', LANG, DOMAIN) +
    `\n\n<b>Transaction ID:</b> <code>${txnId}</code>\n<i>Quote this ID when contacting support</i>`
  const tg = await tgSendMessage(env.TELEGRAM_BOT_TOKEN_PROD, CHAT_STR, dm)
  console.log('[4/4] Telegram DM ok=', tg.ok, 'message_id=', tg.result && tg.result.message_id, tg.ok ? '' : JSON.stringify(tg).slice(0, 300))

  console.log('\n✅ DONE — supportcex.io registered (gift/comp) for @dNvxc, recorded, and user notified.')
  await c.close()
})().catch(e => { console.error('ERR', e); process.exit(1) })
