#!/usr/bin/env node
// Offline unit test for js/linkly-usage-monitor.js (no network, no real Telegram/Mongo).
//   node js/tests/linkly_usage_monitor_2026-10.js
process.env.LINKLY_API_KEY = 'test-key'
process.env.LINKLY_WORKSPACE_ID = '414714'
process.env.LINKLY_USAGE_ALERTS = 'true'
process.env.LINKLY_TRASH_READ_DELAY_MS = '0'
process.env.LINKLY_LINK_LIMIT = '100'
process.env.LINKLY_LINK_ALERT_AT = '80'
process.env.LINKLY_CLICK_LIMIT = '500'
process.env.LINKLY_CLICK_ALERT_AT = '400'

const axios = require('axios')
const m = require('../linkly-usage-monitor.js')

let failures = 0
const ok = (cond, name) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`); if (!cond) failures++ }

// ── fake Linkly: N active links created "now", clicks spread on them; trash separate ──
let ACTIVE = [], TRASH = [], calls = 0
const mk = (n, startId, clicksEach = 0, iso = new Date().toISOString().slice(0, 19)) =>
  Array.from({ length: n }, (_, i) => ({ id: startId + i, inserted_at: iso, clicks_thirty_days: clicksEach }))
axios.get = async (url, cfg) => {
  calls++
  if (!/list_links/.test(url)) throw new Error('unexpected url ' + url)
  const deleted = !!(cfg && cfg.params && cfg.params.deleted)
  const links = deleted ? TRASH : ACTIVE
  return { status: 200, data: { links, total_pages: 1, workspace_link_count: links.length } }
}

// ── fake Mongo + bot ──
const store = {}
const db = { collection: () => ({
  findOne: async q => store[q._id] || null,
  updateOne: async (q, u) => { store[q._id] = { ...(store[q._id] || {}), ...u.$set } },
}) }
const sent = []
let failSend = false
const bot = { sendMessage: async (chat, text) => { if (failSend) throw new Error('tg down'); sent.push({ chat, text }) } }

;(async () => {
  // pure helpers
  const now = Date.parse('2026-10-22T21:00:00Z')
  const u = m.computeUsage([
    { id: 1, inserted_at: '2026-10-22T20:00:00', clicks_thirty_days: 3 },
    { id: 2, inserted_at: '2026-09-01T00:00:00', clicks_thirty_days: 5 }, // older than 30d: no link credit, clicks still count
    { id: 1, inserted_at: '2026-10-22T20:00:00', clicks_thirty_days: 3 }, // duplicate id ignored
  ], now)
  ok(u.linksCreated === 1 && u.clicks === 8, 'computeUsage: 30-day window + dedupe by id')
  ok(m.levelFor(79, 80, 100) === null && m.levelFor(80, 80, 100) === 'warn' && m.levelFor(100, 80, 100) === 'full', 'levelFor thresholds (80 → warn, 100 → full)')

  ok(m.initLinklyUsageMonitor({ bot, db, adminChatId: '999' }) === true, 'monitor enabled with LINKLY_USAGE_ALERTS=true')

  // 1) below threshold → no alert
  ACTIVE = mk(70, 1); TRASH = mk(9, 1000)
  let r = await m.checkLinklyUsage({ force: true, reason: 't1' })
  ok(r.ok && r.usage.linksCreated === 79 && sent.length === 0, '79 links (70 active + 9 trashed) → no alert')

  // 2) cross 80 → exactly one WARN alert to the admin chat
  ACTIVE = mk(71, 1)
  r = await m.checkLinklyUsage({ force: true, reason: 't2' })
  ok(r.outcome.links.action === 'alerted' && sent.length === 1 && sent[0].chat === '999', '80 links → warn alert sent to admin')
  ok(/Linkly links almost used up/.test(sent[0].text) && /80 \/ 100/.test(sent[0].text), 'warn text shows 80 / 100')

  // 3) still ≥80 → no repeat
  ACTIVE = mk(75, 1)
  r = await m.checkLinklyUsage({ force: true, reason: 't3' })
  ok(r.outcome.links.action === 'already-alerted' && sent.length === 1, '84 links → no duplicate alert')

  // 4) reach 100 → one FULL alert
  ACTIVE = mk(91, 1)
  r = await m.checkLinklyUsage({ force: true, reason: 't4' })
  ok(r.outcome.links.action === 'alerted' && sent.length === 2 && /link limit reached/.test(sent[1].text), '100 links → limit-reached alert')

  // 5) drops below 80 (new month) → re-armed silently, then crossing again alerts again
  ACTIVE = mk(10, 1); TRASH = []
  // trash cache is 6h — force a refresh by re-requiring is overkill; trash is cached, so use active only
  r = await m.checkLinklyUsage({ force: true, reason: 't5' })
  const usedNow = r.usage.linksCreated
  ok(usedNow < 80 && r.outcome.links.action === 're-armed' && sent.length === 2, `back to ${usedNow} links → re-armed, no message`)
  ACTIVE = mk(80, 1)
  r = await m.checkLinklyUsage({ force: true, reason: 't6' })
  ok(r.outcome.links.action === 'alerted' && sent.length === 3, 'crossing 80 again after re-arm → alerts again')

  // 6) clicks threshold (400/500) alerts independently
  ACTIVE = mk(10, 5000, 41) // 410 clicks
  r = await m.checkLinklyUsage({ force: true, reason: 't7' })
  ok(r.outcome.clicks.action === 'alerted' && /clicks almost used up/.test(sent[sent.length - 1].text), '410 clicks → click warning')

  // 7) Telegram send failure → not recorded → retried next check
  ACTIVE = mk(10, 5000, 50) // 500 clicks → full
  failSend = true
  r = await m.checkLinklyUsage({ force: true, reason: 't8' })
  ok(r.outcome.clicks.action === 'send-failed', 'send failure reported')
  failSend = false
  r = await m.checkLinklyUsage({ force: true, reason: 't9' })
  ok(r.outcome.clicks.action === 'alerted' && /click limit reached/.test(sent[sent.length - 1].text), 'failed alert retried on next check')

  // 8) dry run never sends or persists
  const before = sent.length
  ACTIVE = mk(99, 1)
  r = await m.checkLinklyUsage({ force: true, dryRun: true, reason: 't10' })
  ok(sent.length === before && r.outcome.links.action !== 'alerted', 'dryRun → no message')

  // 9) 429 → no alert, back-off
  axios.get = async () => { const e = new Error('Request failed with status code 429'); e.response = { status: 429 }; throw e }
  r = await m.checkLinklyUsage({ force: true, reason: 't11' })
  ok(r.ok === false && r.status === 429 && sent.length === before, '429 → check fails quietly, no alert')
  r = await m.checkLinklyUsage({ force: true, reason: 't12' })
  ok(r.skipped === 'rate-limited-backoff', 'after 429 → backs off')

  console.log(`\n${failures ? 'FAILED' : 'ALL PASSED'} (${failures} failure(s)), fake API calls: ${calls}`)
  process.exit(failures ? 1 : 0)
})().catch(e => { console.error('CRASH', e); process.exit(1) })
