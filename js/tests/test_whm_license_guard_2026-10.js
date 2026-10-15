// WHM license-limit safeguard (2026-10-15): the 6-hourly disk monitor now warns at 27/30 accounts.
//   node js/tests/test_whm_license_guard_2026-10.js
const path = require('path')
require('dotenv').config({ path: path.resolve(__dirname, '../../backend/.env') })
const { MongoClient } = require('mongodb')
let pass = 0, fail = 0
const ok = (n, c, e) => { if (c) { pass++; console.log(`  ✅ ${n}`) } else { fail++; console.log(`  ❌ ${n}${e ? ' — ' + e : ''}`) } }

delete process.env.WHM_LICENSE_LIMIT; delete process.env.WHM_LICENSE_WARN_AT
process.env.TELEGRAM_ADMIN_CHAT_ID = '99999'
process.env.WHM_HOST = 'test-whm'
const mon = require('../whm-disk-monitor.js')

function stubBot() { const b = { sent: [] }; b.sendMessage = (id, msg, o) => { b.sent.push({ id, msg, o }); return Promise.resolve() }; return b }

async function main() {
  console.log('\n── licenseStats thresholds (default 30, warn 27) ──')
  ok('26/30 → not near', !mon.licenseStats(26).nearLimit)
  const s27 = mon.licenseStats(27)
  ok('27/30 → nearLimit, 3 left, not atLimit', s27.nearLimit && s27.remaining === 3 && !s27.atLimit, JSON.stringify(s27))
  ok('28/30 → nearLimit', mon.licenseStats(28).nearLimit && !mon.licenseStats(28).atLimit)
  ok('30/30 → atLimit', mon.licenseStats(30).atLimit && mon.licenseStats(30).nearLimit)
  ok('31/30 → atLimit', mon.licenseStats(31).atLimit)
  process.env.WHM_LICENSE_LIMIT = '50'; process.env.WHM_LICENSE_WARN_AT = '45'
  ok('env override: 45/50 near, 44 not', mon.licenseStats(45).nearLimit && !mon.licenseStats(44).nearLimit && mon.licenseStats(50).atLimit)
  delete process.env.WHM_LICENSE_LIMIT; delete process.env.WHM_LICENSE_WARN_AT

  const client = new MongoClient(process.env.MONGO_URL || 'mongodb://localhost:27017')
  await client.connect()
  const db = client.db('whm_license_guard_test')
  await db.dropDatabase()
  try {
    console.log('\n── sendLicenseAlert: message + dedupe ──')
    let bot = stubBot()
    await mon.sendLicenseAlert(bot, db, mon.licenseStats(27))
    ok('27 → one admin DM to the admin chat', bot.sent.length === 1 && bot.sent[0].id === '99999')
    ok('message says Near limit with 27/30 and slots left', /Near cPanel license limit/.test(bot.sent[0].msg) && /27 \/ 30/.test(bot.sent[0].msg) && /3<\/b> slot/.test(bot.sent[0].msg), bot.sent[0].msg)
    ok('message is HTML, no link preview', bot.sent[0].o.parse_mode === 'HTML' && bot.sent[0].o.disable_web_page_preview === true)

    await mon.sendLicenseAlert(bot, db, mon.licenseStats(28))
    ok('28 same "near" level within 24h → deduped (still 1 DM)', bot.sent.length === 1)

    await mon.sendLicenseAlert(bot, db, mon.licenseStats(30))
    ok('escalation to "at limit" fires immediately despite dedupe', bot.sent.length === 2 && /license full/i.test(bot.sent[1].msg) && /New hosting orders will FAIL/.test(bot.sent[1].msg))

    await mon.sendLicenseAlert(bot, db, mon.licenseStats(30))
    ok('repeat "at limit" within 24h → deduped', bot.sent.length === 2)

    // simulate a day passing on the stored alert
    await db.collection('whmDiskMonitorAlerts').updateOne({ _id: 'lastLicenseAlert' }, { $set: { at: new Date(Date.now() - 25 * 3600 * 1000) } })
    await mon.sendLicenseAlert(bot, db, mon.licenseStats(30))
    ok('same level re-fires after 24h', bot.sent.length === 3)

    console.log('\n── no admin chat / no bot → silent ──')
    const saved = process.env.TELEGRAM_ADMIN_CHAT_ID; delete process.env.TELEGRAM_ADMIN_CHAT_ID
    const b2 = stubBot(); await mon.sendLicenseAlert(b2, db, mon.licenseStats(30))
    ok('no TELEGRAM_ADMIN_CHAT_ID → no DM', b2.sent.length === 0)
    process.env.TELEGRAM_ADMIN_CHAT_ID = saved
    await mon.sendLicenseAlert(null, db, mon.licenseStats(30))
    ok('no bot → no throw', true)
  } catch (e) { fail++; console.log('  ❌ EXCEPTION:', e.stack || e.message) } finally {
    await db.dropDatabase().catch(() => {}); await client.close()
  }
  console.log(`\n${fail === 0 ? '✅' : '❌'} WHM license guard: ${pass} passed / ${fail} failed`)
  process.exit(fail === 0 ? 0 : 1)
}
main()
