#!/usr/bin/env node
/**
 * Stale Cloudflare zone-ID sweep.
 * Finds registeredDomains.val.cfZoneId / domainsOf.cfZoneId values that are NOT zones in our
 * Cloudflare account. Per domain: if our account has a zone for that name under a new ID →
 * "repoint" to it; otherwise → "clear" the old ID.
 *
 * Default = REPORT ONLY (no writes). `--apply` performs the planned repoint/clear writes.
 * Usage: node scripts/stale_cf_zone_sweep.js [--apply] [--out /app/memory/STALE_CF_ZONES_REPORT.md]
 */
'use strict'
require('dotenv').config({ path: process.env.ENV_FILE || '/app/backend/.env' })
const fs = require('fs')
const axios = require('axios')
const { MongoClient } = require('mongodb')

const APPLY = process.argv.includes('--apply')
const outIdx = process.argv.indexOf('--out')
const OUT = outIdx > 0 ? process.argv[outIdx + 1] : '/app/memory/STALE_CF_ZONES_REPORT_2026-10.md'
const CF = 'https://api.cloudflare.com/client/v4'
const headers = { 'X-Auth-Email': process.env.CLOUDFLARE_EMAIL, 'X-Auth-Key': process.env.CLOUDFLARE_API_KEY }
const lc = (s) => String(s || '').trim().toLowerCase()

async function listAllZones() {
  const zones = []
  for (let page = 1; ; page++) {
    const r = await axios.get(`${CF}/zones`, { headers, params: { per_page: 50, page }, timeout: 30000 })
    if (!r.data || !r.data.success) throw new Error(`CF zone list failed on page ${page}`)
    zones.push(...r.data.result)
    const info = r.data.result_info || {}
    if (page >= (info.total_pages || 1)) {
      if (info.total_count != null && zones.length !== info.total_count) throw new Error(`CF zone list incomplete: ${zones.length}/${info.total_count}`)
      return zones
    }
  }
}

// Second opinion per stale ID: false = definitely not ours (400/403/404), null = unknown (network).
async function zoneIsOurs(id) {
  try { const r = await axios.get(`${CF}/zones/${id}`, { headers, timeout: 15000 }); return r.data && r.data.success ? true : false }
  catch (e) { return [400, 403, 404].includes(e.response && e.response.status) ? false : null }
}

;(async () => {
  const zones = await listAllZones()
  const byId = new Map(zones.map((z) => [z.id, z]))
  const byName = new Map(zones.map((z) => [lc(z.name), z]))
  const client = new MongoClient(process.env.MONGO_URL)
  await client.connect()
  const db = client.db(process.env.DB_NAME)

  const refs = []
  for (const d of await db.collection('registeredDomains').find({ 'val.cfZoneId': { $nin: [null, ''] } }, { projection: { 'val.cfZoneId': 1, 'val.chatId': 1, 'val.registrar': 1 } }).toArray()) {
    refs.push({ col: 'registeredDomains', filter: { _id: d._id }, field: 'val.cfZoneId', domain: lc(d._id), zoneId: d.val.cfZoneId, chatId: d.val.chatId || null, registrar: d.val.registrar || null })
  }
  for (const d of await db.collection('domainsOf').find({ cfZoneId: { $nin: [null, ''] }, domainName: { $exists: true } }, { projection: { cfZoneId: 1, domainName: 1, chatId: 1, registrar: 1 } }).toArray()) {
    refs.push({ col: 'domainsOf', filter: { _id: d._id }, field: 'cfZoneId', domain: lc(d.domainName), zoneId: d.cfZoneId, chatId: d.chatId || null, registrar: d.registrar || null })
  }

  const stale = refs.filter((r) => !byId.has(r.zoneId))
  const checked = new Map()
  for (const r of stale) if (!checked.has(r.zoneId)) checked.set(r.zoneId, await zoneIsOurs(r.zoneId))

  const domains = [...new Set(stale.map((r) => r.domain))]
  const hosted = new Set()
  for (const a of await db.collection('cpanelAccounts').find({ deleted: { $ne: true }, $or: [{ domain: { $in: domains } }, { addonDomains: { $in: domains } }] }, { projection: { domain: 1, addonDomains: 1 } }).toArray()) {
    hosted.add(lc(a.domain)); for (const x of a.addonDomains || []) hosted.add(lc(x.domain || x))
  }

  const rows = stale.map((r) => {
    const z = byName.get(r.domain)
    const verdict = checked.get(r.zoneId)
    let action = z ? 'repoint' : 'clear'
    if (verdict !== false) action = 'skip_unverified'
    return { ...r, action, newZoneId: z ? z.id : null, newZoneStatus: z ? z.status : null, activeHosting: domains.includes(r.domain) && hosted.has(r.domain) }
  })

  let applied = 0
  if (APPLY) {
    for (const r of rows) {
      if (r.action === 'repoint') {
        const u = await db.collection(r.col).updateOne({ ...r.filter, [r.field]: r.zoneId }, { $set: { [r.field]: r.newZoneId, cfZoneIdHealedAt: new Date(), cfZoneIdPrevious: r.zoneId } })
        applied += u.modifiedCount
      } else if (r.action === 'clear') {
        const u = await db.collection(r.col).updateOne({ ...r.filter, [r.field]: r.zoneId }, { $unset: { [r.field]: '' }, $set: { cfZoneIdHealedAt: new Date(), cfZoneIdPrevious: r.zoneId } })
        applied += u.modifiedCount
      }
    }
  }

  const count = (a) => rows.filter((r) => r.action === a).length
  const uniq = (a) => new Set(rows.filter((r) => r.action === a).map((r) => r.domain)).size
  const lines = [
    `# Stale Cloudflare zone IDs — ${APPLY ? 'APPLIED' : 'REPORT ONLY (nothing changed)'} — ${new Date().toISOString()}`,
    '',
    `- Zones in our Cloudflare account: ${zones.length}`,
    `- Stored zone-ID references checked: ${refs.length} (registeredDomains + domainsOf)`,
    `- Stale references: ${rows.length} across ${new Set(rows.map((r) => r.domain)).size} domains`,
    `- repoint (our account has a zone for the name under a new ID): ${count('repoint')} refs / ${uniq('repoint')} domains`,
    `- clear (no zone for the name in our account): ${count('clear')} refs / ${uniq('clear')} domains`,
    `- skip_unverified (Cloudflare did not confirm the old ID is gone): ${count('skip_unverified')}`,
    `- domains with active hosting among the stale: ${new Set(rows.filter((r) => r.activeHosting).map((r) => r.domain)).size}`,
    APPLY ? `- writes applied: ${applied}` : '- Run with --apply to perform the repoint/clear writes.',
    '',
    '| domain | collection | stored zone id | action | new zone id (status) | active hosting | registrar | chatId |',
    '|---|---|---|---|---|---|---|---|',
    ...rows.sort((a, b) => a.action.localeCompare(b.action) || a.domain.localeCompare(b.domain)).map((r) => `| ${r.domain} | ${r.col} | ${r.zoneId} | ${r.action} | ${r.newZoneId ? `${r.newZoneId} (${r.newZoneStatus})` : '-'} | ${r.activeHosting ? 'yes' : 'no'} | ${r.registrar || '-'} | ${r.chatId || '-'} |`),
  ]
  fs.writeFileSync(OUT, lines.join('\n') + '\n')
  console.log(lines.slice(0, 11).join('\n'))
  console.log(`\nReport: ${OUT}`)
  await client.close()
})().catch((e) => { console.error('ABORTED (nothing changed):', e.message); process.exit(1) })
