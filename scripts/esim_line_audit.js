#!/usr/bin/env node
'use strict'
/**
 * Production eSIM line health audit.
 * Queries every known line through the Spenza API: SIM status, service state,
 * subscription, and optionally sends a two-way test between owned lines.
 *
 * Usage: node scripts/esim_line_audit.js
 */
const P = require('../js/bulk-esim/provider-spenza.js')

// Known production line IDs from earlier audits
const KNOWN_LINES = [
  { id: 'ESIM-0002', role: 'tester',  note: 'Original tester line' },
  { id: 'ESIM-0003', role: 'monitor', note: 'Original monitor line' },
  { id: 'ESIM-0004', role: 'dead',    note: 'Known dead — inactive/no subscription' },
  { id: 'ESIM-0005', role: 'dead',    note: 'Known dead — pending/no subscription' },
  { id: 'ESIM-0006', role: 'service', note: 'Reliable — 5-star customer reviews' },
  { id: 'ESIM-0007', role: 'service', note: 'Reliable — 5-star customer reviews' },
  { id: 'ESIM-0008', role: 'service', note: 'Suspect — 1-star delivery complaints' },
  { id: 'ESIM-0009', role: 'service', note: 'Suspect — 1-star delivery complaints' },
]

async function run() {
  console.log('═══════════════════════════════════════════════════')
  console.log('         eSIM Line Health Audit')
  console.log('═══════════════════════════════════════════════════')

  const accts = P.accounts()
  console.log(`\nSpenza accounts configured: ${accts.length}`)
  if (!accts.length) { console.log('❌ No Spenza accounts — cannot query.'); return }

  // 1. Get credit balance
  for (const a of accts) {
    try {
      const bal = await P.credit(a.id)
      console.log(`  ${a.id}: $${bal.toFixed(2)} credit`)
    } catch (e) { console.log(`  ${a.id}: ❌ credit check failed — ${e.message}`) }
  }

  // 2. List all SIMs from provider
  console.log('\n─── Provider SIM inventory ───')
  let allSims = []
  for (const a of accts) {
    try {
      const sims = await P.listSims(a.id)
      if (!sims) { console.log(`  ${a.id}: null response`); continue }
      console.log(`  ${a.id}: ${sims.length} SIM(s)`)
      for (const s of sims) {
        allSims.push({ ...s, account: a.id })
        const msisdn = P.norm(s.mdn || s.phoneNumber || s.msisdn || '')
        console.log(`    ICCID: ${s.iccid || '?'}  MSISDN: ${msisdn || '?'}  Status: ${s.status || '?'}`)
      }
    } catch (e) { console.log(`  ${a.id}: ❌ listSims failed — ${e.message}`) }
  }

  // 3. Deep check each SIM: service state + subscription
  console.log('\n─── Per-SIM deep check ───')
  const results = []
  for (const sim of allSims) {
    const iccid = sim.iccid
    if (!iccid) continue
    const msisdn = P.norm(sim.mdn || sim.phoneNumber || sim.msisdn || '')
    console.log(`\n  [${iccid}] ${msisdn || 'no number'} (${sim.status || '?'}) acct=${sim.account}`)

    // Service state
    let svc = null
    try {
      svc = await P.serviceState(iccid, sim.account)
      console.log(`    Service: SMS=${svc?.sms ?? '?'} Voice=${svc?.voice ?? '?'} Data=${svc?.data ?? '?'}`)
    } catch (e) { console.log(`    Service: ❌ ${e.message}`) }

    // Subscription
    let sub = null
    try {
      sub = await P.subscription(iccid, sim.account)
      const endDate = sub?.endDate ? new Date(sub.endDate) : null
      const daysLeft = endDate ? Math.round((endDate - Date.now()) / 86400000) : null
      console.log(`    Subscription: ${sub?.status || '?'}${endDate ? ` — expires ${endDate.toISOString().slice(0,10)} (${daysLeft}d)` : ''}`)
    } catch (e) { console.log(`    Subscription: ❌ ${e.message}`) }

    // Determine health
    const simStatus = String(sim.status || '').toUpperCase()
    const smsEnabled = svc?.sms === true
    const subActive = String(sub?.status || '').toUpperCase() === 'ACTIVE'
    const subExpired = sub?.endDate ? new Date(sub.endDate) < new Date() : false

    let health = '✅ HEALTHY'
    const issues = []
    if (simStatus !== 'ACTIVE') issues.push(`SIM status: ${simStatus}`)
    if (!smsEnabled) issues.push('SMS disabled')
    if (!subActive) issues.push(`Subscription: ${sub?.status || 'unknown'}`)
    if (subExpired) issues.push('Subscription EXPIRED')
    if (issues.length) health = `⚠️ ISSUES: ${issues.join(', ')}`

    console.log(`    Health: ${health}`)
    results.push({ iccid, msisdn, simStatus, smsEnabled, subActive, subExpired, health, account: sim.account, subStatus: sub?.status, endDate: sub?.endDate })
  }

  // 4. Cross-reference with known lines
  console.log('\n─── Known line cross-reference ───')
  for (const known of KNOWN_LINES) {
    const match = results.find(r => r.msisdn && r.iccid) // Can't match by ID without DB
    console.log(`  ${known.id} (${known.role}): ${known.note}`)
  }

  // 5. Summary
  console.log('\n═══════════════════════════════════════════════════')
  console.log('         SUMMARY')
  console.log('═══════════════════════════════════════════════════')
  const healthy = results.filter(r => r.simStatus === 'ACTIVE' && r.smsEnabled && r.subActive && !r.subExpired)
  const sick = results.filter(r => !(r.simStatus === 'ACTIVE' && r.smsEnabled && r.subActive && !r.subExpired))
  console.log(`  Total SIMs: ${results.length}`)
  console.log(`  Healthy:    ${healthy.length}`)
  console.log(`  Issues:     ${sick.length}`)
  if (sick.length) {
    console.log('\n  Problem SIMs:')
    for (const s of sick) console.log(`    ${s.iccid} ${s.msisdn || '?'}: SIM=${s.simStatus} SMS=${s.smsEnabled} Sub=${s.subStatus}${s.subExpired ? ' EXPIRED' : ''}`)
  }
  if (healthy.length) {
    console.log('\n  Healthy SIMs:')
    for (const s of healthy) console.log(`    ${s.iccid} ${s.msisdn || '?'}: OK (expires ${s.endDate ? new Date(s.endDate).toISOString().slice(0,10) : '?'})`)
  }

  // 6. Two-way send test between first two healthy SIMs
  const testPair = healthy.filter(s => s.msisdn).slice(0, 2)
  if (testPair.length >= 2) {
    console.log(`\n─── Two-way test: ${testPair[0].msisdn} ↔ ${testPair[1].msisdn} ───`)
    const ts = Date.now()
    // A → B
    try {
      const r1 = await P.sendSms({ from: testPair[0].msisdn, to: testPair[1].msisdn, text: `Health check ${ts} A→B`, key: `hc-${ts}-ab`, account: testPair[0].account })
      console.log(`  ${testPair[0].msisdn} → ${testPair[1].msisdn}: ${r1.ok ? '✅ accepted' : '❌ rejected'}${r1.providerId ? ` (id: ${r1.providerId})` : ''}`)
    } catch (e) { console.log(`  ${testPair[0].msisdn} → ${testPair[1].msisdn}: ❌ ${e.message}`) }
    // B → A
    try {
      const r2 = await P.sendSms({ from: testPair[1].msisdn, to: testPair[0].msisdn, text: `Health check ${ts} B→A`, key: `hc-${ts}-ba`, account: testPair[1].account })
      console.log(`  ${testPair[1].msisdn} → ${testPair[0].msisdn}: ${r2.ok ? '✅ accepted' : '❌ rejected'}${r2.providerId ? ` (id: ${r2.providerId})` : ''}`)
    } catch (e) { console.log(`  ${testPair[1].msisdn} → ${testPair[0].msisdn}: ❌ ${e.message}`) }
    console.log('  (Note: "accepted" = Spenza took the message, does NOT confirm handset delivery)')
  } else {
    console.log('\n  ⚠️ Not enough healthy SIMs for a two-way test.')
  }

  console.log('\n═══════════════════════════════════════════════════')
  console.log('  Audit complete.')
  console.log('═══════════════════════════════════════════════════')
}

run().catch(e => { console.error('Audit failed:', e.message); process.exit(1) })
