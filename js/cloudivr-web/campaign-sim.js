// Preview (WEB_CLOUDIVR_DRY_RUN) campaign simulator: walks a dry-run campaign through running -> completed with made-up
// per-lead outcomes so Live, results, CSV, scheduling and repeat runs can be tested. It never dials or bills anything.
const log = (...a) => console.log(...a)

const STEP_MS = Number(process.env.CLOUDIVR_SIM_STEP_MS) || 1500
const active = new Set()
const OUTCOMES = [
  { status: 'completed', answered: true, key: true, duration: 34 },
  { status: 'voicemail', answered: true, duration: 22 },
  { status: 'no_answer', duration: 0 },
  { status: 'completed', answered: true, duration: 18 },
  { status: 'busy', duration: 0 },
]

function outcomeFor(c, lead) {
  const o = OUTCOMES[lead.index % OUTCOMES.length]
  const digit = o.key && c.mode !== 'ai' ? ((c.activeKeys || [])[0] || '1') : null
  const transferred = !!digit && c.mode === 'transfer' && !!c.transferNumber && (!c.menu || c.menu[digit]?.action === 'forward')
  return { ...o, digit, transferred, voicemailLeft: o.status === 'voicemail' && !!c.voicemailAudioUrl }
}

async function step(col, id) {
  const c = await col.findOne({ id, dryRun: true })
  if (!c || c.status !== 'running') { active.delete(id); return }
  const lead = (c.leads || []).find(l => l.status === 'pending')
  if (!lead) {
    await col.updateOne({ id, status: 'running' }, { $set: { status: 'completed', completedAt: new Date() } })
    active.delete(id)
    log(`[CampaignSim] ${id} completed (preview, nothing dialed)`)
    return
  }
  const o = outcomeFor(c, lead), p = `leads.${lead.index}`, now = new Date()
  const inc = { 'stats.completed': 1 }
  if (o.answered) inc['stats.answered'] = 1
  if (o.digit) inc['stats.keyPressed'] = 1
  if (o.transferred) inc['stats.transferred'] = 1
  if (o.status === 'no_answer') inc['stats.noAnswer'] = 1
  if (o.status === 'busy') inc['stats.busy'] = 1
  if (o.status === 'voicemail') inc['stats.voicemail'] = 1
  if (o.voicemailLeft) inc['stats.voicemailLeft'] = 1
  await col.updateOne({ id, status: 'running', [`${p}.status`]: 'pending' }, {
    $set: {
      [`${p}.status`]: o.status, [`${p}.digitPressed`]: o.digit, [`${p}.transferred`]: o.transferred, [`${p}.transferConnected`]: o.transferred,
      [`${p}.duration`]: o.duration, [`${p}.startedAt`]: now, [`${p}.answeredAt`]: o.answered ? now : null, [`${p}.completedAt`]: now,
      [`${p}.answeredBy`]: o.status === 'voicemail' ? 'machine' : (o.answered ? 'human' : null), [`${p}.voicemailDropped`]: o.voicemailLeft,
      [`${p}.hangupCause`]: o.status === 'busy' ? 'user_busy' : o.status === 'no_answer' ? 'timeout' : 'normal_clearing', [`${p}.simulated`]: true,
    },
    $inc: inc,
  })
  setTimeout(() => step(col, id).catch(e => { active.delete(id); log(`[CampaignSim] ${id} step error: ${e.message}`) }), STEP_MS)
}

async function run(col, id) {
  if (active.has(id)) return false
  const r = await col.updateOne({ id, dryRun: true, status: { $in: ['created', 'scheduled', 'paused', 'running'] } }, { $set: { status: 'running', startedAt: new Date(), simulated: true } })
  if (!r.matchedCount) return false
  active.add(id)
  log(`[CampaignSim] ${id} simulating (preview, nothing dialed)`)
  setTimeout(() => step(col, id).catch(e => { active.delete(id); log(`[CampaignSim] ${id} step error: ${e.message}`) }), STEP_MS)
  return true
}

// Preview-only minute tick: launch due scheduled dry-run campaigns (creating the next repeat run) and resume ones cut off by a restart.
async function tick(col, bulkCallService) {
  const due = await col.find({ dryRun: true, status: 'scheduled', scheduledFor: { $lte: new Date() } }).limit(20).toArray()
  for (const c of due) {
    const claim = await col.updateOne({ id: c.id, status: 'scheduled' }, { $set: { status: 'created', claimedAt: new Date() } })
    if (claim.modifiedCount !== 1) continue
    if (c.repeat) await bulkCallService.spawnNextRun(c).then(nid => nid && col.updateOne({ id: nid }, { $set: { dryRun: true } })).catch(e => log(`[CampaignSim] next run for ${c.id} failed: ${e.message}`))
    await run(col, c.id)
  }
  const stale = await col.find({ dryRun: true, status: 'running' }, { projection: { id: 1 } }).limit(20).toArray()
  for (const c of stale) if (!active.has(c.id)) { active.add(c.id); step(col, c.id).catch(() => active.delete(c.id)) }
}

module.exports = { run, tick }
