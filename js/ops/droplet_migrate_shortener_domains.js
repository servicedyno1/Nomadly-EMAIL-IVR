#!/usr/bin/env node
/* Re-home completed shortener activations from Railway to this droplet.
   Usage (on the droplet, from repo root):
     node js/ops/droplet_migrate_shortener_domains.js --dry
     node js/ops/droplet_migrate_shortener_domains.js --domain example.com
     node js/ops/droplet_migrate_shortener_domains.js --all            */
require('../config-setup.js')
const { MongoClient } = require('mongodb')
const { log } = require('console')

const args = process.argv.slice(2)
const DRY = args.includes('--dry')
const ALL = args.includes('--all')
const ONE = args.includes('--domain') ? args[args.indexOf('--domain') + 1] : null

;(async () => {
  if (process.env.HOSTED_ON !== 'droplet') throw new Error('HOSTED_ON must be droplet')
  const ip = process.env.DROPLET_PUBLIC_IP
  if (!ip) throw new Error('DROPLET_PUBLIC_IP missing')
  const client = await MongoClient.connect(process.env.MONGO_URL)
  const db = client.db(process.env.DB_NAME)
  const domainService = require('../domain-service.js')
  const cfService = require('../cf-service.js')
  const { saveDomainInServerRailway, isShortenerDnsRecord } = require('../rl-save-domain-in-server.js')

  const q = ONE ? { domain: ONE } : { status: 'completed' }
  const tasks = await db.collection('shortenerActivations').find(q).sort({ updatedAt: -1 }).toArray()
  log(`Found ${tasks.length} activation(s) ${ONE ? `for ${ONE}` : 'with status=completed'}${DRY ? ' (DRY RUN)' : ''}`)
  if (!ONE && !ALL && !DRY) throw new Error('Pass --all, --domain <d> or --dry')

  const summary = { migrated: 0, already: 0, failed: 0, skipped: 0 }
  for (const task of tasks) {
    const domain = String(task.domain || task._id).toLowerCase()
    try {
      const dns = await domainService.viewDNSRecords(domain, db)
      const recs = (dns?.records || []).filter(r => !r.isNameserver)
      const apex = recs.filter(r => r.recordName === domain && ['A', 'AAAA', 'CNAME'].includes(r.recordType))
      const apexA = apex.find(r => r.recordType === 'A' && r.recordContent === ip)
      const railway = apex.filter(isShortenerDnsRecord).filter(r => r.recordType === 'CNAME')
      const foreign = apex.filter(r => !isShortenerDnsRecord(r))
      const meta = await domainService.getDomainMeta(domain, db)
      log(`\n▶ ${domain}  cf=${meta?.cfZoneId ? 'yes' : 'no'}  apexA→droplet=${!!apexA}  railwayCNAME=${railway.length}  foreignApex=${foreign.map(r => `${r.recordType}:${r.recordContent}`).join(',') || '-'}  dnsErr=${dns?.error || '-'}`)
      if (!meta?.cfZoneId) { summary.skipped++; log('  skipped: not on Cloudflare'); continue }
      if (dns?.error) { summary.skipped++; log(`  skipped: DNS read error ${dns.error}`); continue }
      if (foreign.length) { summary.skipped++; log('  skipped: apex points elsewhere (customer repurposed) — not touching'); continue }
      // listDNSRecords returns [] for zones that no longer exist in the CF account → verify the zone is live.
      const zone = await cfService.getZoneByName(domain)
      if (!zone?.id) { summary.skipped++; log('  skipped: Cloudflare zone no longer exists in our account (domain moved/suspended)'); continue }
      if (DRY) continue

      // DNS first (so the reconciler never sees "nginx claims it but CF has no A record"), then nginx.
      const d = await domainService.addShortenerCNAME(domain, ip, db)
      if (d.error || !d.success) { summary.failed++; log(`  ✗ dns: ${d.error || 'unknown'}`); continue }
      const s = await saveDomainInServerRailway(domain)
      if (s.error) { summary.failed++; log(`  ✗ nginx/origin: ${s.error}`); continue }
      await db.collection('shortenerActivations').updateOne(
        { _id: task._id },
        { $set: { server: ip, recordType: 'A', migratedToDroplet: new Date(), updatedAt: new Date() } }
      )
      if (apexA && railway.length === 0) summary.already++; else summary.migrated++
      log(`  ✓ ${domain} → A ${ip} (proxied), nginx block live`)
    } catch (e) {
      summary.failed++
      log(`  ✗ ${domain}: ${e.message}`)
    }
  }
  log('\nSummary:', JSON.stringify(summary))
  await client.close()
  process.exit(0)
})().catch(e => { console.error(e.message); process.exit(1) })
