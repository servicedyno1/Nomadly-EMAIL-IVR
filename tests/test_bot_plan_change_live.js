// Live DO plan-change E2E — drives sandbox bot (chat 777000555) through
// Upgrade → Keep disk → Confirm (real DO resize on droplet 607047995) then Downgrade back,
// then Low-balance, then Navigation. Reads droplet via tests/_live_droplet.js.
// Droplet 607047995 was destroyed after the 2026-10 run: create a new throwaway one with
// `node js/tests/_live_droplet.js create`, set DROPLET below and seed the vpsPlansOf record for chat 777000555.
const { makeSim, inlineOf, strip, sleep } = require('/app/scripts/lib/tg_sim.js')
const { kbOf, openVpsDetails } = require('/app/tests/_plan_change_helpers.js')
const { MongoClient } = require('/app/node_modules/mongodb')
const { execSync } = require('child_process')
const fs = require('fs')

const MONGO = process.env.MONGO_URL || 'mongodb://localhost:27017'
const DB = process.env.DB_NAME || 'test'
const CHAT = '777000555'
const DROPLET = '607047995'
const LOG = '/var/log/supervisor/nodejs.out.log'

function liveDroplet() {
  const out = execSync(`node /app/js/tests/_live_droplet.js get ${DROPLET}`, { encoding: 'utf8' })
  return JSON.parse(out.trim().split('\n').pop())
}

function dump(screen, label) {
  const text = (screen.msgs || []).map(m => strip(m.text || "")).join('\n--\n')
  const inlines = inlineOf(screen.msgs || []).map(b => b.t).join(' | ')
  const kbs = kbOf(screen.msgs || []).join(' | ')
  console.log(`\n==== ${label} ====\n${text.slice(0, 1500)}\nINLINE: ${inlines}\nKB: ${kbs}`)
  if (screen.errors && screen.errors.length) console.log('ERR seen:', screen.errors.join(' ; '))
}

// Press a button that may be reply-kb OR inline. Returns new screen.
async function press(sim, scr, matcher) {
  const il = inlineOf(scr.msgs).find(b => matcher.test(b.t))
  if (il) return sim.step({ kind: 'cb', data: il.d })
  const kb = kbOf(scr.msgs).find(k => matcher.test(k))
  if (kb) return sim.step({ kind: 'text', v: kb })
  throw new Error(`button not found matching ${matcher}; inline=${inlineOf(scr.msgs).map(b => b.t).join(' | ')} kb=${kbOf(scr.msgs).join(' | ')}`)
}

async function waitForMessage(sim, since, regex, maxMs = 7 * 60 * 1000, pollMs = 10000) {
  const t0 = Date.now()
  while (Date.now() - t0 < maxMs) {
    await sleep(pollMs)
    const parsed = sim.parseOut(sim.readFrom(since))
    const text = parsed.msgs.map(m => strip(m.text || "")).join('\n')
    if (regex.test(text)) return { text, parsed, elapsedMs: Date.now() - t0 }
  }
  return null
}

async function run() {
  const results = { passed: [], failed: [], notes: [] }
  const mongo = new MongoClient(MONGO); await mongo.connect()
  const db = mongo.db(DB)
  const pass = x => { console.log('✅', x); results.passed.push(x) }
  const fail = (x, extra) => { console.log('❌', x, extra || ''); results.failed.push(x + (extra ? ' | ' + String(extra).slice(0, 200) : '')) }

  // Reset wallet to $50 (undo any welcome-bonus side effects from earlier runs)
  await db.collection('walletOf').updateOne({ _id: CHAT }, { $set: { usdIn: 50, usdOut: 0 } })
  // Also clear planChange status / history on the record to make the test re-runnable
  await db.collection('vpsPlansOf').updateOne(
    { chatId: CHAT, vpsId: 'do-607047995' },
    { $set: { productId: 's-1vcpu-1gb', planPrice: 18, do_size_slug: 's-1vcpu-1gb' }, $unset: { planChange: '', planChangeHistory: '' } }
  )
  const walletBefore = await db.collection('walletOf').findOne({ _id: CHAT })
  const recBefore = await db.collection('vpsPlansOf').findOne({ chatId: CHAT, vpsId: 'do-607047995' })
  console.log('wallet before:', walletBefore)
  console.log('vps rec before productId/price/end:', recBefore.productId, recBefore.planPrice, recBefore.end_time)
  const dropBefore = liveDroplet()
  console.log('droplet before:', dropBefore)
  if (dropBefore.size !== 's-1vcpu-1gb' || dropBefore.disk !== 25) { fail('precheck droplet not baseline'); return results }

  const sim = makeSim(CHAT)
  let scr = await openVpsDetails(sim)
  dump(scr, 'VPS details')

  // Upgrade
  scr = await press(sim, scr, /Upgrade|⬆️/i)
  dump(scr, 'Plan options')
  const planText = scr.msgs.map(m => strip(m.text || "")).join('\n')
  if (/Choose upgrade type/i.test(planText)) fail('OLD "Choose upgrade type" screen shown')
  else pass('new plan-options screen (not legacy)')
  if (/🔄 Change plan|Change plan/i.test(planText)) pass('header "Change plan" present')
  else fail('header "Change plan" missing', planText.slice(0, 300))
  if (/Cloud VPS 10/i.test(planText) && /\$18/.test(planText)) pass('Current Cloud VPS 10 … $18')
  else fail('current line missing', planText.slice(0, 400))
  const daysMatch = planText.match(/Days left[^\n]*/i)
  if (daysMatch && /(19|20)/.test(daysMatch[0])) pass('Days left 19 or 20: ' + daysMatch[0])
  else fail('days-left line missing/wrong', daysMatch?.[0])

  const inlines = inlineOf(scr.msgs)
  const kbList = kbOf(scr.msgs)
  const planBtns = inlines.length ? inlines.map(b => b.t) : kbList
  console.log('Plan option buttons:', planBtns)
  if (planBtns.some(t => /Cloud VPS 20.*\$36/i.test(t))) pass('⬆️ Cloud VPS 20 · $36/mo button present')
  else fail('Cloud VPS 20 $36 button missing')
  if (planBtns.some(t => /NVMe.*1vCPU.*1GB.*25GB.*\$21/i.test(t))) pass('NVMe AMD 1vCPU/1GB/25GB $21 button present')
  else fail('NVMe starter button missing', planBtns.join(' | '))

  // Pick Cloud VPS 20
  scr = await press(sim, scr, /Cloud VPS 20.*\$36/i)
  dump(scr, 'Disk screen')
  const diskText = scr.msgs.map(m => strip(m.text || "")).join('\n')
  if (/💾 Disk size|Disk size/i.test(diskText)) pass('disk screen header present')
  else fail('disk screen header missing', diskText.slice(0, 400))
  const diskIl = inlineOf(scr.msgs)
  const diskKb = kbOf(scr.msgs)
  const diskBtns = diskIl.length ? diskIl.map(b => b.t) : diskKb
  const keepT = diskBtns.find(t => /Keep current disk/i.test(t))
  const growT = diskBtns.find(t => /Grow disk to 50 GB/i.test(t))
  if (keepT) pass('Keep current disk button present'); else fail('Keep current disk button missing', diskBtns.join(' | '))
  if (growT) pass('Grow disk to 50 GB button present'); else fail('Grow disk button missing')

  // Tap KEEP
  if (!keepT) { fail('cannot proceed without Keep button'); return results }
  scr = await press(sim, scr, /Keep current disk/i)
  dump(scr, 'Summary screen')
  const summaryText = scr.msgs.map(m => strip(m.text || "")).join('\n')
  if (/Plan change summary|📜/i.test(summaryText)) pass('summary header present')
  else fail('summary header missing')
  if (/From[^\n]*Cloud VPS 10[^\n]*\$18/i.test(summaryText)) pass('From: Cloud VPS 10 $18')
  else fail('From line wrong', summaryText.match(/From[^\n]*/i)?.[0])
  if (/To[^\n]*Cloud VPS 20[^\n]*\$36/i.test(summaryText)) pass('To: Cloud VPS 20 $36')
  else fail('To line wrong', summaryText.match(/To[^\n]*/i)?.[0])
  if (/Disk[^\n]*25 GB/i.test(summaryText)) pass('Disk 25 GB (unchanged)')
  else fail('Disk line wrong', summaryText.match(/Disk[^\n]*/i)?.[0])
  const payNow = summaryText.match(/Pay now:\s*\$([\d.]+)/i)
  if (payNow) {
    const amt = parseFloat(payNow[1]); results.pay_now_amount = amt
    if (amt >= 10 && amt <= 13) pass(`Pay now = $${amt} (10..13 expected)`)
    else fail(`Pay now out of range: $${amt}`)
  } else fail('Pay now line missing', summaryText.slice(0, 500))
  if (/Next renewal[^\n]*\$36/i.test(summaryText)) pass('Next renewal $36')
  else fail('Next renewal $36 missing', summaryText.match(/Next renewal[^\n]*/i)?.[0])
  if (/\$50/.test(summaryText)) pass('Wallet $50 shown in summary')
  else fail('Wallet $50 missing in summary')

  const confirmInline = inlineOf(scr.msgs).find(b => /Confirm|✅/i.test(b.t))
  const confirmKb = kbOf(scr.msgs).find(k => /Confirm|✅/i.test(k))
  if (!confirmInline && !confirmKb) { fail('Confirm button missing'); return results }

  const sinceOffset = fs.statSync(LOG).size
  scr = confirmInline ? await sim.step({ kind: 'cb', data: confirmInline.d }) : await sim.step({ kind: 'text', v: confirmKb })
  dump(scr, 'After Confirm')
  const startText = scr.msgs.map(m => strip(m.text || "")).join('\n')
  if (/Changing plantest-vps to Cloud VPS 20|⏳/i.test(startText)) pass('started message present')
  else fail('started message missing', startText.slice(0, 400))
  const chargedMatch = startText.match(/\$([\d.]+) was charged/i)
  if (chargedMatch) pass(`charged line: $${chargedMatch[1]}`)
  else fail('charged line missing in start')

  await sleep(1500)
  const walletAfterStart = await db.collection('walletOf').findOne({ _id: CHAT })
  const delta = (walletAfterStart.usdOut || 0) - (walletBefore.usdOut || 0)
  results.wallet_delta_upgrade = delta
  if (delta > 10 && delta < 13) pass(`wallet usdOut delta=$${delta.toFixed(2)}`)
  else fail(`wallet delta out of range: ${delta}`)

  console.log('waiting up to 7min for completion message…')
  const done = await waitForMessage(sim, sinceOffset, /plantest-vps is now on Cloud VPS 20/i)
  if (done) {
    pass(`completion in ${(done.elapsedMs / 1000).toFixed(0)}s`)
    results.upgrade_done_sample = done.text.slice(0, 400)
    if (/Disk[^\n]*25 GB/i.test(done.text)) pass('completion Disk 25 GB'); else fail('completion missing Disk 25 GB')
    if (/Next renewal[^\n]*\$36/i.test(done.text)) pass('completion Next renewal $36'); else fail('completion missing Next renewal $36')
  } else fail('no completion within 7min')

  const dropMid = liveDroplet()
  results.droplet_after_upgrade = dropMid
  if (dropMid.size === 's-1vcpu-2gb' && dropMid.disk === 25 && dropMid.status === 'active') pass('droplet s-1vcpu-2gb/25/active')
  else fail('droplet not resized correctly', JSON.stringify(dropMid))
  const recMid = await db.collection('vpsPlansOf').findOne({ chatId: CHAT, vpsId: 'do-607047995' })
  results.rec_after_upgrade = { productId: recMid.productId, planPrice: recMid.planPrice, do_size_slug: recMid.do_size_slug, planChangeStatus: recMid.planChange?.status, historyLen: (recMid.planChangeHistory || []).length }
  console.log('rec after upgrade:', results.rec_after_upgrade)
  if (recMid.productId === 's-1vcpu-2gb') pass('DB productId=s-1vcpu-2gb'); else fail('DB productId=' + recMid.productId)
  if (recMid.planPrice === 36) pass('DB planPrice=36'); else fail('DB planPrice=' + recMid.planPrice)
  if (recMid.do_size_slug === 's-1vcpu-2gb') pass('DB do_size_slug=s-1vcpu-2gb'); else fail('DB do_size_slug=' + recMid.do_size_slug)
  if (recMid.planChange?.status === 'completed') pass("planChange.status=completed"); else fail('planChange.status=' + recMid.planChange?.status)
  if ((recMid.planChangeHistory || []).length === 1) pass('planChangeHistory length=1'); else fail('history length=' + (recMid.planChangeHistory || []).length)
  if (new Date(recMid.end_time).getTime() === new Date(recBefore.end_time).getTime()) pass('end_time unchanged')
  else fail('end_time changed')

  // ===== DOWNGRADE =====
  console.log('\n===== DOWNGRADE =====')
  scr = await openVpsDetails(sim)
  scr = await press(sim, scr, /Upgrade|⬆️/i)
  dump(scr, 'Plan options (for downgrade)')
  const dnIl = inlineOf(scr.msgs)
  const dnKb = kbOf(scr.msgs)
  const dnBtns = dnIl.length ? dnIl.map(b => b.t) : dnKb
  const cv10Txt = dnBtns.find(t => /Cloud VPS 10.*\$18/i.test(t) && /⬇️/.test(t))
  const cv10 = dnIl.find(b => /Cloud VPS 10.*\$18/i.test(b.t) && /⬇️/.test(b.t))
  const cv10KbT = dnKb.find(t => /Cloud VPS 10.*\$18/i.test(t) && /⬇️/.test(t))
  if (cv10Txt) pass('⬇️ Cloud VPS 10 · $18/mo present')
  else { fail('⬇️ Cloud VPS 10 · $18/mo missing', dnBtns.join(' | ')); }
  if (cv10Txt) {
    scr = await press(sim, scr, /Cloud VPS 10.*\$18/i)
    dump(scr, 'After downgrade target tap')
    const dnText = scr.msgs.map(m => strip(m.text || "")).join('\n')
    if (/Disk size/i.test(dnText) && !/Plan change summary/i.test(dnText)) fail('Disk screen shown for downgrade (should skip)')
    else pass('disk screen skipped for downgrade')
    if (/Pay now[^\n]*\$0(\.00)?/i.test(dnText)) pass('Pay now $0.00')
    else fail('Pay now not $0', dnText.match(/Pay now[^\n]*/i)?.[0])
    if (/no refund/i.test(dnText)) pass('"no refund" note present')
    else fail('"no refund" note missing', dnText.slice(0, 300))
    if (/Next renewal[^\n]*\$18/i.test(dnText)) pass('Next renewal $18')
    else fail('Next renewal $18 missing')
    const conf2I = inlineOf(scr.msgs).find(b => /Confirm|✅/i.test(b.t))
    const conf2K = kbOf(scr.msgs).find(k => /Confirm|✅/i.test(k))
    const sinceOffset2 = fs.statSync(LOG).size
    scr = conf2I ? await sim.step({ kind: 'cb', data: conf2I.d }) : await sim.step({ kind: 'text', v: conf2K })
    dump(scr, 'After downgrade Confirm')
    const dnStart = scr.msgs.map(m => strip(m.text || "")).join('\n')
    if (/was charged/i.test(dnStart)) fail('downgrade shows charged line')
    else pass('downgrade no charge line')
    const walletAfterDgStart = await db.collection('walletOf').findOne({ _id: CHAT })
    if (walletAfterDgStart.usdOut === walletAfterStart.usdOut && (walletAfterDgStart.usdIn || 0) === (walletAfterStart.usdIn || 0)) pass('wallet unchanged by downgrade')
    else fail('wallet changed by downgrade', JSON.stringify(walletAfterDgStart))
    const done2 = await waitForMessage(sim, sinceOffset2, /plantest-vps is now on Cloud VPS 10/i)
    if (done2) pass(`downgrade completion in ${(done2.elapsedMs / 1000).toFixed(0)}s`); else fail('no downgrade completion in 7min')
    const dropEnd = liveDroplet()
    results.droplet_after_downgrade = dropEnd
    if (dropEnd.size === 's-1vcpu-1gb' && dropEnd.disk === 25 && dropEnd.status === 'active') pass('droplet s-1vcpu-1gb/25/active')
    else fail('droplet not downgraded', JSON.stringify(dropEnd))
    const recEnd = await db.collection('vpsPlansOf').findOne({ chatId: CHAT, vpsId: 'do-607047995' })
    results.rec_after_downgrade = { productId: recEnd.productId, planPrice: recEnd.planPrice, historyLen: (recEnd.planChangeHistory || []).length }
    if (recEnd.productId === 's-1vcpu-1gb' && recEnd.planPrice === 18 && (recEnd.planChangeHistory || []).length === 2) pass('DB downgraded correctly, history=2')
    else fail('DB not downgraded correctly', JSON.stringify(results.rec_after_downgrade))
  }

  // ===== LOW BALANCE =====
  console.log('\n===== LOW BALANCE =====')
  const walletBeforeLow = await db.collection('walletOf').findOne({ _id: CHAT })
  await db.collection('walletOf').updateOne({ _id: CHAT }, { $set: { usdIn: 1, usdOut: 0 } })
  const dropBeforeLow = liveDroplet()
  scr = await openVpsDetails(sim)
  scr = await press(sim, scr, /Upgrade|⬆️/i)
  scr = await press(sim, scr, /Cloud VPS 20.*\$36/i)
  scr = await press(sim, scr, /Keep current disk/i)
  scr = await press(sim, scr, /Confirm|✅/i)
  dump(scr, 'Low-balance after Confirm')
  const lowText = scr.msgs.map(m => strip(m.text || "")).join('\n')
  if (/wallet balance.*\$1\.00.*below/i.test(lowText) || /below the \$.*needed/i.test(lowText)) pass('low-balance warning shown')
  else fail('low-balance warning missing', lowText.slice(0, 400))
  const depBtn = inlineOf(scr.msgs).map(b => b.t).concat(kbOf(scr.msgs)).find(t => /deposit|💰|💵/i.test(t))
  if (depBtn) pass('deposit button present'); else fail('deposit button missing')
  const walletAfterLow = await db.collection('walletOf').findOne({ _id: CHAT })
  if (walletAfterLow.usdOut === 0 && walletAfterLow.usdIn === 1) pass('low-balance wallet unchanged')
  else fail('low-balance wallet changed', JSON.stringify(walletAfterLow))
  const dropAfterLow = liveDroplet()
  if (dropAfterLow.size === dropBeforeLow.size) pass('low-balance droplet unchanged')
  else fail('low-balance droplet changed', JSON.stringify(dropAfterLow))
  const recLow = await db.collection('vpsPlansOf').findOne({ chatId: CHAT, vpsId: 'do-607047995' })
  if (recLow.planChange?.status !== 'running') pass("low-balance planChange.status not 'running'")
  else fail('planChange.status=running after low balance')
  await db.collection('walletOf').updateOne({ _id: CHAT }, { $set: { usdIn: walletBeforeLow.usdIn, usdOut: walletBeforeLow.usdOut } })

  // ===== NAVIGATION =====
  console.log('\n===== NAVIGATION =====')
  scr = await openVpsDetails(sim)
  const detailsKb = kbOf(scr.msgs).join(' | ')
  scr = await press(sim, scr, /Upgrade|⬆️/i)
  // On plan-list screen, press Back
  try {
    const hasBack = inlineOf(scr.msgs).some(b => /Back|🔙/i.test(b.t)) || kbOf(scr.msgs).some(k => /Back|🔙/i.test(k))
    if (hasBack) {
      scr = await press(sim, scr, /Back|🔙/i)
      const kbNow = kbOf(scr.msgs).join(' | ')
      if (kbNow.includes('⬆️ Upgrade') || /Show Password/i.test(kbNow)) pass('Back from plan-list → VPS details (kb matches)')
      else fail('Back from plan-list did not return to VPS details', 'kb=' + kbNow)
    } else fail('no Back on plan-list screen')
  } catch (e) { fail('plan-list back error: ' + e.message) }

  // Disk-screen Back
  try {
    scr = await openVpsDetails(sim)
    scr = await press(sim, scr, /Upgrade|⬆️/i)
    scr = await press(sim, scr, /Cloud VPS 20.*\$36/i)
    const hasBack2 = inlineOf(scr.msgs).some(b => /Back|🔙/i.test(b.t)) || kbOf(scr.msgs).some(k => /Back|🔙/i.test(k))
    if (hasBack2) {
      scr = await press(sim, scr, /Back|🔙/i)
      const t = scr.msgs.map(m => strip(m.text || "")).join('\n')
      const kbNow2 = kbOf(scr.msgs).join(' | ')
      if (/Change plan|Cloud VPS 20/i.test(t) || /Cloud VPS 20/i.test(kbNow2)) pass('Back from disk → plan list')
      else fail('Back from disk did not return to plan list', t.slice(0, 300) + ' kb=' + kbNow2)
    } else fail('no Back on disk screen')
  } catch (e) { fail('disk back error: ' + e.message) }

  const logTail = execSync("tail -n 4000 /var/log/supervisor/nodejs.out.log /var/log/supervisor/nodejs.err.log 2>/dev/null | grep -E 'TypeError|ReferenceError' | grep -v voiceService || true", { encoding: 'utf8' })
  if (logTail.trim()) fail('JS errors in nodejs logs: ' + logTail.slice(0, 500))
  else pass('no JS errors (TypeError/ReferenceError) during flow')

  await mongo.close()
  console.log('\n==== SUMMARY ====')
  console.log(`passed=${results.passed.length} failed=${results.failed.length}`)
  if (results.failed.length) { console.log('FAILURES:'); results.failed.forEach(f => console.log('  -', f)) }
  fs.writeFileSync('/tmp/plan_change_live_results.json', JSON.stringify(results, null, 2))
  return results
}

run().then(r => process.exit(r.failed.length ? 1 : 0)).catch(e => { console.error('FATAL', e); process.exit(2) })
