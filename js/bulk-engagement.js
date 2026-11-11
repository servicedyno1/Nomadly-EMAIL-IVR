'use strict'
// Campaign engagement: people reached, listened, voicemails left, hot leads, cost per result, best hour / area,
// mid-run digests and one-tap follow-up campaigns. Shared by the bots, CloudIVR web and the final report.
const { DateTime } = require('luxon')
const { areaOf } = require('./cloudivr-web/areas')

const LISTEN_S = 30
const isHot = (l) => !!(l.digitPressed || l.transferred)
const reachedHuman = (l) => l.duration > 0 && !['failed', 'voicemail', 'skipped'].includes(l.status)

function engagementOf(c, spent = null) {
  const leads = c.leads || [], tz = c.tz || 'America/New_York'
  const done = leads.filter(l => l.completedAt && l.status !== 'skipped')
  const reached = done.filter(reachedHuman), vm = done.filter(l => l.voicemailDropped)
  const hot = done.filter(isHot), listened = reached.filter(l => l.duration >= LISTEN_S)
  const hours = {}, areas = {}
  for (const l of done) {
    const a = (areas[areaOf(l.number)] ||= { area: areaOf(l.number), called: 0, reached: 0 })
    a.called++
    if (!reachedHuman(l)) continue
    a.reached++
    const h = DateTime.fromJSDate(new Date(l.completedAt)).setZone(tz).hour
    hours[h] = (hours[h] || 0) + 1
  }
  const bestHour = Object.entries(hours).sort((a, b) => b[1] - a[1])[0]
  const bestArea = Object.values(areas).filter(a => a.called >= 10).sort((a, b) => b.reached / b.called - a.reached / a.called)[0]
  const people = reached.length + vm.length
  return {
    called: done.length, total: leads.filter(l => l.status !== 'skipped').length,
    reached: reached.length, listened: listened.length, voicemails: vm.length, hot: hot.length, people,
    listenPct: reached.length ? Math.round((listened.length / reached.length) * 100) : 0,
    unanswered: done.filter(l => ['no_answer', 'busy'].includes(l.status)).length,
    listenersNoKey: listened.filter(l => !isHot(l)).length,
    spent, perPerson: spent != null && people ? +(spent / people).toFixed(2) : null, perHot: spent != null && hot.length ? +(spent / hot.length).toFixed(2) : null,
    bestHour: bestHour ? { hour: +bestHour[0], reached: bestHour[1], tz } : null,
    bestArea: bestArea ? { area: bestArea.area, pct: Math.round((bestArea.reached / bestArea.called) * 100) } : null,
  }
}

const hourLabel = (h) => DateTime.fromObject({ hour: h }).toFormat('h a')

function digestText(c, e) {
  const pct = e.total ? Math.round((e.called / e.total) * 100) : 0
  return `📊 <b>${c.name || 'Campaign'}</b> — ${pct}% done\n\n` +
    `📞 ${e.called} of ${e.total} called\n👂 <b>${e.people}</b> people reached your message (${e.reached} live · ${e.voicemails} voicemails left)\n` +
    `🎧 ${e.listened} listened ${LISTEN_S}s or more${e.reached ? ` (${e.listenPct}%)` : ''}\n🔥 <b>${e.hot}</b> hot lead${e.hot === 1 ? '' : 's'}`
}

function finalBlock(c, e) {
  const lines = [`\n👂 <b>${e.people}</b> people reached your message — ${e.reached} live, ${e.voicemails} voicemails left`,
    `🎧 ${e.listened} listened ${LISTEN_S}s or more${e.reached ? ` (${e.listenPct}% of live answers)` : ''}`,
    `🔥 <b>${e.hot}</b> hot lead${e.hot === 1 ? '' : 's'}`]
  if (e.perPerson != null) lines.push(`💵 $${e.spent.toFixed(2)} spent · $${e.perPerson.toFixed(2)} per person reached${e.perHot != null ? ` · $${e.perHot.toFixed(2)} per hot lead` : ''}`)
  if (e.bestHour) lines.push(`⏰ Best hour: <b>${hourLabel(e.bestHour.hour)}</b> (${e.bestHour.reached} reached)`)
  if (e.bestArea) lines.push(`📍 Best area: <b>${e.bestArea.area}</b> (${e.bestArea.pct}% answered)`)
  return lines.join('\n')
}

// Numbers for a follow-up campaign. kind: 'unanswered' (no answer / busy) · 'listeners' (listened 30s+, no key pressed)
function followupLeads(c, kind) {
  const pick = kind === 'listeners' ? (l) => reachedHuman(l) && l.duration >= LISTEN_S && !isHot(l) : (l) => ['no_answer', 'busy'].includes(l.status)
  return (c.leads || []).filter(l => l.completedAt && pick(l)).map(l => ({ number: l.number, ...(l.name ? { name: l.name } : {}) }))
}

// Tomorrow at the campaign's best hour (or null).
function bestTimeTomorrow(e) {
  if (!e.bestHour) return null
  return DateTime.now().setZone(e.bestHour.tz).plus({ days: 1 }).set({ hour: e.bestHour.hour, minute: 0, second: 0, millisecond: 0 }).toJSDate()
}

// Hot-lead alert (sent right away, the only per-call message).
function hotText(c, l, r) {
  const who = `<code>${l?.number || '?'}</code>${l?.name ? ` (${l.name})` : ''}`
  const what = r.transferred ? (r.transferConnected ? `pressed ${r.digitPressed || '1'} and was connected to you` : `pressed ${r.digitPressed || '1'} — transfer attempted`) : `pressed ${r.digitPressed}`
  return `🔥 <b>Hot lead!</b> ${who} ${what}.\n${c.name || 'Campaign'} · call them back while they’re interested.`
}

module.exports = { engagementOf, digestText, finalBlock, followupLeads, bestTimeTomorrow, hotText, isHot, LISTEN_S }
