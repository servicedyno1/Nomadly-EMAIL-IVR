/**
 * Generalized heal for bifurcated domain metadata.
 *
 * Detects four divergence patterns across `domainsOf` ⇄ `registeredDomains` ⇄
 * Cloudflare ⇄ OpenProvider/ConnectReseller, then heals them with the same
 * recipe used in /app/scripts/heal_rsvpeviteopen_org.js.
 *
 * Categories:
 *   A. DB_DIVERGED      — domainsOf and registeredDomains disagree on
 *                         cfZoneId / nameserverType. CF zone may or may not
 *                         exist. Sync DB if a definitive zone exists.
 *   B. NS_NOT_AT_REG    — CF zone exists + DB indicates CF, but registrar
 *                         (OP / CR) still publishes non-CF nameservers.
 *                         This is the @HHR2009 rsvpeviteopen.org pattern.
 *                         Update registrar NS to CF NS, sync DB.
 *   C. ORPHAN_CF_ZONE   — DB says CF (or has cfZoneId) but no CF zone is
 *                         actually present. Flag only — needs human decision.
 *   D. OK               — Everything consistent.
 *
 * Usage:
 *   # Dry-run (default, READ-ONLY — does not mutate anything):
 *   node /app/scripts/heal_bifurcated_domains.js
 *
 *   # Limit to a single domain (handy for spot-fixing):
 *   node /app/scripts/heal_bifurcated_domains.js --domain example.com
 *
 *   # Apply category-A (DB-only sync). Safe — no provider calls beyond reads.
 *   node /app/scripts/heal_bifurcated_domains.js --apply=A
 *
 *   # Apply category-A + category-B. Category B calls OP/CR updateNameservers.
 *   node /app/scripts/heal_bifurcated_domains.js --apply=A,B
 *
 *   # Apply ALL safe categories (A + B). Same as above.
 *   node /app/scripts/heal_bifurcated_domains.js --apply=all
 *
 *   # Output JSON report (in addition to console):
 *   node /app/scripts/heal_bifurcated_domains.js --report=/app/memory/bifurcation_report.json
 *
 * Safety:
 *   - Default mode is dry-run. Never mutates anything without --apply.
 *   - Concurrency limited (BATCH_SIZE=4) so OP/CR/CF rate limits stay healthy.
 *   - Heals are idempotent — re-running converges, never diverges.
 *   - DNSSEC is auto-handled by opService.updateNameservers (already disables
 *     stale DNSKEY before re-trying NS update when moving NS off OP).
 *   - Records to be healed are first audited against the live CF zone DNS
 *     records — if the CF zone is empty (no A/CNAME for root), it's flagged
 *     instead of touched so the user isn't routed into a dead zone.
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', 'backend', '.env') })
const { MongoClient } = require('mongodb')
const { execSync } = require('child_process')
const cfService = require('../js/cf-service.js')
const opService = require('../js/op-service.js')

const CF_NS = ['anderson.ns.cloudflare.com', 'leanna.ns.cloudflare.com'] // CF will tell us the real pair per zone
const OP_DEFAULT_NS_PATTERNS = [/^ns\d?\.openprovider\.(nl|be|eu)$/i]
const CR_DEFAULT_NS_PATTERNS = [/connectreseller\.com$/i, /\.ns\.connectreseller\.com$/i]
const BATCH_SIZE = 4
const SLEEP_BETWEEN_BATCHES_MS = 800
const WHOIS_TIMEOUT_MS = 10000

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ─── DENIC whois helper (.de only) ──────────────────────
// Detects the "Nsentry trap" where OP shows CF nameservers but DENIC is
// still serving the parking A-record directly via TLD-level Nsentry.
// See @HHR2009/rsvpeviteopen.de incident (2026-02) — full root-cause in
// /app/memory/CHANGELOG.md.
function _denicWhois(domain) {
  if (!/\.de$/i.test(domain)) return null
  let out
  try {
    out = execSync(`whois ${domain}`, { timeout: WHOIS_TIMEOUT_MS, stdio: ['ignore', 'pipe', 'pipe'] }).toString('utf-8')
  } catch (e) {
    return { mode: 'ERROR', error: e.message }
  }
  const lines = out.split('\n')
  const nserverLines = lines.filter((l) => /^Nserver:/i.test(l)).map((l) => l.split(':').slice(1).join(':').trim().toLowerCase())
  const nsentryLines = lines.filter((l) => /^Nsentry:/i.test(l)).map((l) => l.split(':').slice(1).join(':').trim())
  const statusLine = lines.find((l) => /^Status:/i.test(l))
  const status = statusLine ? statusLine.split(':').slice(1).join(':').trim() : ''
  if (nsentryLines.length > 0 && nserverLines.length === 0) return { mode: 'NSENTRY', status, nsentry: nsentryLines }
  if (nserverLines.length > 0) return { mode: 'NSERVER', status, nserver: nserverLines }
  if (/free|invalid/i.test(status)) return { mode: 'UNREGISTERED', status }
  return { mode: 'UNKNOWN', status }
}

// ─── CLI flags ──────────────────────────────────────────
// (only consumed when invoked directly via `node`; skipped when require()d as a module)
const args = process.argv.slice(2)
const flag = (name) => {
  const idx = args.findIndex((a) => a === `--${name}` || a.startsWith(`--${name}=`))
  if (idx === -1) return null
  const eq = args[idx].indexOf('=')
  if (eq !== -1) return args[idx].slice(eq + 1)
  // Support `--name value` (space-separated) too, not just `--name=value`
  const next = args[idx + 1]
  if (next && !next.startsWith('--')) return next
  return true
}
const cliApply = flag('apply') // null, 'A', 'B', 'A,B', 'all'
const cliOnlyDomain = flag('domain') // single-domain mode
const cliReportPath = flag('report') // optional report file
let APPLY = cliApply
let ONLY_DOMAIN = cliOnlyDomain
let REPORT_PATH = cliReportPath
let APPLY_A = APPLY && (APPLY === 'all' || /\bA\b/i.test(APPLY))
let APPLY_B = APPLY && (APPLY === 'all' || /\bB\b/i.test(APPLY))
let APPLY_D = APPLY && (APPLY === 'all' || /\bD\b/i.test(APPLY))
let DRY_RUN = !APPLY

// ─── Helpers ────────────────────────────────────────────

function isOpDefaultNs(ns) {
  return OP_DEFAULT_NS_PATTERNS.some((re) => re.test(ns))
}
function isCrDefaultNs(ns) {
  return CR_DEFAULT_NS_PATTERNS.some((re) => re.test(ns))
}
function isCfNs(ns) {
  return /\.ns\.cloudflare\.com$/i.test(ns)
}

function detectCategory({ dofRec, regRec, cfZone, regNs, registrar, denic }) {
  const dofCfZ = dofRec?.cfZoneId || null
  const dofNsT = dofRec?.nameserverType || null
  const regCfZ = regRec?.val?.cfZoneId || null
  const regNsT = regRec?.val?.nameserverType || null

  const dbsAgreeOnCf = (dofCfZ === regCfZ) && (dofNsT === regNsT)
  const cfZoneExists = !!cfZone
  const intendsCloudflare = dofNsT === 'cloudflare' || regNsT === 'cloudflare' || !!dofCfZ || !!regCfZ

  // Category D: DENIC has the .de domain stuck in Nsentry mode (OP shows
  // CF nameservers but DENIC never received the chprov). Highest priority
  // because it makes the customer's site unreachable — checked BEFORE C
  // so a stuck domain isn't misreported as a missing CF zone.
  if (denic?.mode === 'NSENTRY') {
    return {
      category: 'D',
      reason: `DENIC stuck in Nsentry mode (${(denic.nsentry || []).join(', ')}) — registry chprov never fired`,
    }
  }

  // Category C: DB says CF (or cfZoneId stored) but no live CF zone — orphan tag
  if (intendsCloudflare && !cfZoneExists) {
    return { category: 'C', reason: 'CF flagged in DB but no live CF zone found' }
  }

  // Category B: CF zone exists, DB indicates CF, but registrar NS is NOT CF
  // (Requires a successful OP/CR NS probe — without it we cannot conclude
  // the NS lags, so we fall through to Category A or OK.)
  if (intendsCloudflare && cfZoneExists && Array.isArray(regNs) && regNs.length > 0) {
    const regNsLower = regNs.map((n) => String(n || '').toLowerCase())
    const allCf = regNsLower.length >= 2 && regNsLower.every(isCfNs)
    if (!allCf) {
      return {
        category: 'B',
        reason: `CF zone exists but ${registrar} NS still ${regNsLower.join(', ')}`,
      }
    }
  }

  // Category A: DB collections disagree (e.g. cfZoneId only on one side)
  if (!dbsAgreeOnCf) {
    return {
      category: 'A',
      reason: `DB diverged — domainsOf{cfZoneId=${dofCfZ}, nsT=${dofNsT}} vs registeredDomains{cfZoneId=${regCfZ}, nsT=${regNsT}}`,
    }
  }

  return { category: 'OK', reason: 'consistent' }
}

async function inspectDomain(domain, dof, reg) {
  const result = {
    domain,
    chatId: dof?.chatId || reg?.val?.ownerChatId || null,
    registrar: dof?.registrar || reg?.val?.registrar || reg?.val?.provider || null,
    domainsOf: dof ? { cfZoneId: dof.cfZoneId || null, nameserverType: dof.nameserverType, opDomainId: dof.opDomainId, registrar: dof.registrar, chatId: dof.chatId } : null,
    registeredDomains: reg ? { cfZoneId: reg.val?.cfZoneId || null, nameserverType: reg.val?.nameserverType, opDomainId: reg.val?.opDomainId, hasFullVal: !!(reg.val?.domain || reg.val?.provider), ownerChatId: reg.val?.ownerChatId || null } : null,
    cfZone: null,
    cfDnsRecordsCount: null,
    cfHasTunnelCname: null,
    registrarNs: null,
    category: null,
    reason: null,
    healActions: [],
    healResult: null,
  }

  // ── CF probe ──
  try {
    const z = await cfService.getZoneByName(domain)
    if (z) {
      result.cfZone = { id: z.id, status: z.status, nameservers: z.name_servers, originalNs: z.original_name_servers }
      const records = await cfService.listDNSRecords(z.id)
      result.cfDnsRecordsCount = records.length
      result.cfHasTunnelCname = records.some((r) => r.type === 'CNAME' && /\.cfargotunnel\.com$/i.test(r.content || ''))
    }
  } catch (e) {
    result.cfProbeError = e.message
  }

  // ── Registrar NS probe ──
  // Only probe OP for now (CR's NS read path is more involved + most NS
  // mismatches we see are OP-based — extending to CR can come if needed).
  const registrar = result.registrar || result.domainsOf?.registrar || result.registeredDomains?.registrar
  if (registrar === 'OpenProvider' || registrar === 'openprovider') {
    try {
      const opInfo = await opService.getDomainInfo(domain)
      if (opInfo?.domainData?.name_servers) {
        result.registrarNs = opInfo.domainData.name_servers.map((n) => String(n.name || '').toLowerCase())
        result.opDomainId = opInfo.domainId
        result.opStatus = opInfo.status
      } else if (!opInfo) {
        result.opLookupError = 'not_found_at_op'
      }
    } catch (e) {
      result.opLookupError = e.message
    }
  }

  // ── DENIC whois probe (.de only) ──
  // Detects Nsentry-stuck domains — a known OP↔DENIC race documented in
  // CHANGELOG.md. Cheap (single whois call) and only fires for .de.
  if (/\.de$/i.test(domain)) {
    result.denic = _denicWhois(domain)
  }

  // ── Categorize ──
  const { category, reason } = detectCategory({
    dofRec: dof,
    regRec: reg,
    cfZone: result.cfZone,
    regNs: result.registrarNs,
    registrar,
    denic: result.denic,
  })
  result.category = category
  result.reason = reason
  return result
}

// ─── Healers ────────────────────────────────────────────

async function healCategoryA(db, r) {
  // Refuse to heal Category A when:
  //   • domainsOf explicitly says nameserverType='custom' (user picked custom)
  //   • no live CF zone exists (could be stale zone ID — don't write garbage)
  const dofNsT = r.domainsOf?.nameserverType
  if (dofNsT === 'custom') {
    r.healActions.push("skipped: user explicitly chose nameserverType='custom' — preserving user intent")
    return { skipped: true }
  }
  if (!r.cfZone?.id) {
    r.healActions.push('skipped: no live CF zone — refusing to stamp a stale cfZoneId on either side')
    return { skipped: true }
  }

  // Live CF zone is the source of truth.
  const liveZoneId = r.cfZone.id
  const newNs = r.cfZone.nameservers || []
  // Find chatId from any available source (some legacy registeredDomains
  // records were imported without ownerChatId — those domainsOf creations
  // are skipped to avoid inventing a fake owner).
  const chatId = r.chatId || r.domainsOf?.chatId || r.registeredDomains?.ownerChatId || null

  if (DRY_RUN || !APPLY_A) {
    if (chatId || r.domainsOf) {
      r.healActions.push(`would: domainsOf.cfZoneId=${liveZoneId}, nameserverType='cloudflare'`)
    } else {
      r.healActions.push(`would: skip domainsOf (no chatId available — admin-imported zone?)`)
    }
    r.healActions.push(`would: registeredDomains.val.cfZoneId=${liveZoneId}, val.nameserverType='cloudflare', val.nameservers=[${newNs.join(', ')}]`)
    return { dryRun: true }
  }

  // Update / insert domainsOf only when we have a chatId to attribute to
  if (r.domainsOf) {
    await db.collection('domainsOf').updateOne(
      { domainName: r.domain },
      { $set: { cfZoneId: liveZoneId, nameserverType: 'cloudflare' } },
      { upsert: false },
    )
    r.healActions.push(`✓ domainsOf synced (cfZoneId=${liveZoneId})`)
  } else if (chatId) {
    await db.collection('domainsOf').updateOne(
      { domainName: r.domain, chatId: String(chatId) },
      {
        $set: { cfZoneId: liveZoneId, nameserverType: 'cloudflare' },
        $setOnInsert: {
          chatId: String(chatId),
          domainName: r.domain,
          registrar: r.registrar || 'OpenProvider',
          opDomainId: r.opDomainId || null,
          customNS: null,
          registeredAt: new Date(),
          healInserted: true,
          healReason: 'category_A_db_backfill',
        },
      },
      { upsert: true },
    )
    r.healActions.push(`✓ domainsOf inserted for chatId=${chatId} (cfZoneId=${liveZoneId})`)
  } else {
    r.healActions.push(`(skipped domainsOf — no chatId attribution possible)`)
  }

  // registeredDomains _id is the domain name — always safe to upsert
  await db.collection('registeredDomains').updateOne(
    { _id: r.domain },
    {
      $set: {
        'val.cfZoneId': liveZoneId,
        'val.nameserverType': 'cloudflare',
        ...(newNs.length ? { 'val.nameservers': newNs } : {}),
        'val.healedAt': new Date(),
        'val.healReason': 'category_A_db_sync',
      },
      $setOnInsert: {
        'val.domain': r.domain,
        ...(chatId ? { 'val.ownerChatId': String(chatId) } : {}),
        ...(r.registrar ? { 'val.registrar': r.registrar, 'val.provider': r.registrar } : {}),
        'val.linkedAt': new Date(),
      },
    },
    { upsert: true },
  )
  r.healActions.push(`✓ registeredDomains synced (cfZoneId=${liveZoneId})`)
  return { applied: true }
}

async function healCategoryB(db, r) {
  // 1. Update registrar NS to CF nameservers
  // 2. Sync DB metadata
  const cfNs = r.cfZone?.nameservers || []
  if (cfNs.length < 2) {
    r.healActions.push('skipped: CF zone returned <2 nameservers — cannot update registrar safely')
    return { skipped: true }
  }
  const registrar = r.registrar
  if (registrar !== 'OpenProvider' && registrar !== 'openprovider') {
    r.healActions.push(`skipped: registrar=${registrar} not yet supported by this auto-heal (OP only)`)
    return { skipped: true }
  }

  // Refuse to heal forward if CF zone is empty — sending the user to a dead zone is worse than the current state.
  if ((r.cfDnsRecordsCount || 0) === 0) {
    r.healActions.push('skipped: CF zone has zero DNS records — would route domain into a void')
    return { skipped: true }
  }

  if (DRY_RUN || !APPLY_B) {
    r.healActions.push(`would: opService.updateNameservers('${r.domain}', [${cfNs.join(', ')}])`)
    r.healActions.push(`would: domainsOf.cfZoneId=${r.cfZone.id}, nameserverType='cloudflare'`)
    r.healActions.push(`would: registeredDomains.val.{cfZoneId,nameserverType:'cloudflare',nameservers}`)
    return { dryRun: true }
  }

  // OP NS update (includes DNSSEC auto-clear)
  const nsResult = await opService.updateNameservers(r.domain, cfNs)
  if (!nsResult.success) {
    r.healActions.push(`✗ OP updateNameservers failed: ${nsResult.error || JSON.stringify(nsResult)}`)
    return { failed: true, error: nsResult.error }
  }
  r.healActions.push(`✓ OP NS updated to ${cfNs.join(', ')}`)

  // DB sync
  await db.collection('domainsOf').updateOne(
    { domainName: r.domain },
    { $set: { cfZoneId: r.cfZone.id, nameserverType: 'cloudflare' } },
    { upsert: false },
  )
  await db.collection('registeredDomains').updateOne(
    { _id: r.domain },
    {
      $set: {
        'val.cfZoneId': r.cfZone.id,
        'val.nameserverType': 'cloudflare',
        'val.nameservers': cfNs,
        'val.healedAt': new Date(),
        'val.healReason': 'category_B_registrar_ns_realigned',
      },
    },
    { upsert: false },
  )
  r.healActions.push(`✓ DB synced (domainsOf + registeredDomains)`)
  return { applied: true }
}

async function healCategoryD(db, r) {
  // .de stuck in DENIC Nsentry mode. Auto-heal by re-pushing NS via OP
  // (the upstream fix in op-service._sendNsUpdate now always sends
  // `ns_group: ''` which forces a registry chprov).
  const registrar = r.registrar
  if (registrar !== 'OpenProvider' && registrar !== 'openprovider') {
    r.healActions.push(`skipped: registrar=${registrar} — DENIC chprov only available via OP`)
    return { skipped: true }
  }

  // Prefer the NS that OP currently records (so we don't accidentally
  // overwrite a customer's custom NS). Fall back to CF zone NS if OP
  // returned nothing.
  let nsToPush = r.registrarNs && r.registrarNs.length >= 2 ? r.registrarNs : null
  if (!nsToPush && r.cfZone?.nameservers && r.cfZone.nameservers.length >= 2) {
    nsToPush = r.cfZone.nameservers
  }
  if (!nsToPush) {
    r.healActions.push('skipped: no NS source available (OP NS empty + no CF zone)')
    return { skipped: true }
  }

  if (DRY_RUN || !APPLY_D) {
    r.healActions.push(`would: opService.updateNameservers('${r.domain}', [${nsToPush.join(', ')}]) — force chprov via ns_group:''`)
    return { dryRun: true }
  }

  const nsResult = await opService.updateNameservers(r.domain, nsToPush)
  if (!nsResult?.success) {
    r.healActions.push(`✗ OP updateNameservers failed: ${nsResult?.error || JSON.stringify(nsResult)}`)
    return { failed: true, error: nsResult?.error }
  }
  r.healActions.push(`✓ OP NS re-pushed (${nsToPush.join(', ')}) — DENIC chprov triggered, expect Nsentry→Nserver flip in <5min`)
  return { applied: true }
}

// ─── Main ───────────────────────────────────────────────

/**
 * Programmatic entry point — can be called from a cron job inside the bot
 * process. Reuses the running bot's MongoDB client when one is provided,
 * otherwise opens its own connection.
 *
 * @param {Object} [opts]
 * @param {Object} [opts.db]              — an already-open MongoDB `Db` instance
 * @param {string} [opts.apply]           — null | 'A' | 'B' | 'A,B' | 'all'
 * @param {string} [opts.onlyDomain]      — single-domain mode
 * @param {string} [opts.reportPath]      — optional report file path
 * @param {Function} [opts.onAdminAlert]  — invoked with a human-readable
 *                                          summary line for admin DMs
 * @returns {Promise<{summary: Object, results: Array, startedAt: string, finishedAt: string}>}
 */
async function runHealSweep(opts = {}) {
  // Per-invocation flag overrides (preserves CLI semantics when called bare)
  if (Object.prototype.hasOwnProperty.call(opts, 'apply')) {
    APPLY = opts.apply || null
    APPLY_A = APPLY && (APPLY === 'all' || /\bA\b/i.test(APPLY))
    APPLY_B = APPLY && (APPLY === 'all' || /\bB\b/i.test(APPLY))
    APPLY_D = APPLY && (APPLY === 'all' || /\bD\b/i.test(APPLY))
    DRY_RUN = !APPLY
  }
  if (Object.prototype.hasOwnProperty.call(opts, 'onlyDomain')) ONLY_DOMAIN = opts.onlyDomain
  if (Object.prototype.hasOwnProperty.call(opts, 'reportPath')) REPORT_PATH = opts.reportPath

  const startedAt = new Date().toISOString()
  console.log(`\n=== Bifurcated-domain heal scan — ${DRY_RUN ? 'DRY-RUN' : `APPLY=${APPLY}`} ===\n`)

  // Reuse caller's db when provided, else open our own
  let client = null
  let db = opts.db
  if (!db) {
    client = new MongoClient(process.env.MONGO_URL)
    await client.connect()
    db = client.db(process.env.DB_NAME || 'test')
  }

  // Collect candidate domain names from both collections
  const candidateNames = new Set()
  if (ONLY_DOMAIN) {
    candidateNames.add(String(ONLY_DOMAIN).toLowerCase())
  } else {
    const dofs = await db.collection('domainsOf').find({}, { projection: { domainName: 1 } }).toArray()
    for (const d of dofs) if (d.domainName) candidateNames.add(String(d.domainName).toLowerCase())
    const regs = await db.collection('registeredDomains').find({}, { projection: { _id: 1 } }).toArray()
    for (const r of regs) if (r._id) candidateNames.add(String(r._id).toLowerCase())
  }
  const domains = Array.from(candidateNames).sort()
  console.log(`Scanning ${domains.length} unique domain name(s)...\n`)

  const results = []

  for (let i = 0; i < domains.length; i += BATCH_SIZE) {
    const batch = domains.slice(i, i + BATCH_SIZE)
    const batchResults = await Promise.allSettled(
      batch.map(async (domain) => {
        const dof = await db.collection('domainsOf').findOne({ domainName: domain })
        const reg = await db.collection('registeredDomains').findOne({ _id: domain })
        if (!dof && !reg) return { domain, category: 'OK', reason: 'no records — out of scope' }
        const r = await inspectDomain(domain, dof, reg)

        if (r.category === 'A') await healCategoryA(db, r)
        else if (r.category === 'B') await healCategoryB(db, r)
        else if (r.category === 'D') await healCategoryD(db, r)
        // C and OK don't auto-heal

        return r
      }),
    )

    for (const br of batchResults) {
      if (br.status === 'fulfilled') results.push(br.value)
      else results.push({ category: 'ERROR', reason: br.reason?.message || String(br.reason) })
    }

    const done = Math.min(i + BATCH_SIZE, domains.length)
    process.stdout.write(`  scanned ${done}/${domains.length}\r`)
    if (i + BATCH_SIZE < domains.length) await sleep(SLEEP_BETWEEN_BATCHES_MS)
  }

  // ── Report ──
  const summary = { OK: 0, A: 0, B: 0, C: 0, D: 0, ERROR: 0 }
  for (const r of results) summary[r.category] = (summary[r.category] || 0) + 1

  console.log(`\n=== Summary ===`)
  console.log(`  OK    (consistent)                : ${summary.OK}`)
  console.log(`  A     (DB diverged)               : ${summary.A}`)
  console.log(`  B     (registrar NS lagging)      : ${summary.B}`)
  console.log(`  C     (orphan CF in DB)           : ${summary.C}`)
  console.log(`  D     (.de DENIC Nsentry stuck)   : ${summary.D}`)
  console.log(`  ERROR                             : ${summary.ERROR}`)
  console.log(`  TOTAL                             : ${results.length}\n`)

  // Detail lines for anything non-OK
  for (const r of results) {
    if (r.category === 'OK' || r.category === 'ERROR' && !r.domain) continue
    if (r.category === 'OK') continue
    console.log(`[${r.category}] ${r.domain} (chatId=${r.chatId || '?'}, registrar=${r.registrar || '?'})`)
    console.log(`        reason: ${r.reason}`)
    if (r.cfZone) console.log(`        cf:     zone=${r.cfZone.id} status=${r.cfZone.status} dnsRecords=${r.cfDnsRecordsCount} tunnelCname=${r.cfHasTunnelCname}`)
    if (r.registrarNs) console.log(`        opNs:   ${r.registrarNs.join(', ')}`)
    for (const a of r.healActions) console.log(`        ${a}`)
    console.log()
  }

  const finishedAt = new Date().toISOString()
  if (REPORT_PATH) {
    const fs = require('fs')
    fs.writeFileSync(REPORT_PATH, JSON.stringify({ startedAt, finishedAt, summary, mode: DRY_RUN ? 'dry-run' : `apply=${APPLY}`, results }, null, 2))
    console.log(`Report written: ${REPORT_PATH}`)
  }

  if (client) await client.close()

  return { startedAt, finishedAt, summary, mode: DRY_RUN ? 'dry-run' : `apply=${APPLY}`, results }
}

// Run immediately when invoked as a CLI script; export when require()d
if (require.main === module) {
  runHealSweep().catch((e) => { console.error('FATAL', e); process.exit(1) })
}

module.exports = { runHealSweep, detectCategory, inspectDomain }
