// Admin "💸 Reseller Payouts": per white-label bot eligible payout + manual payout ledger (stored on each bot's sales API)
const crypto = require('crypto')

const usd = (n) => (Number(n) < 0 ? '−' : '') + '$' + Math.abs(Number(n) || 0).toFixed(2)
const day = (d) => new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' })
const esc = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))
const btn = (text, data) => ({ text, callback_data: `aPY:${data}` })
const back = [btn('⬅️ Back to payouts', 'list')]

// RESELLER_PAYOUT_BOTS="smadav|Smadav|https://1.smadavspeech.com;voodoo|Voodoo Land|https://voodooivr.xyz"
function bots() {
  return String(process.env.RESELLER_PAYOUT_BOTS || '').split(';').map((s) => s.split('|').map((x) => x.trim()))
    .map(([id, name, url]) => ({ id, name, url: String(url || '').replace(/\/+$/, '') }))
    .filter((b) => /^[a-z0-9_-]{1,16}$/.test(b.id || '') && b.name && /^https?:\/\//.test(b.url))
}
const enabled = () => String(process.env.PAYOUT_ADMIN_KEY || '').length >= 32 && bots().length > 0
const botById = (id) => bots().find((b) => b.id === id)

async function call(bot, method, path, body) {
  const res = await fetch(`${bot.url}/api/admin/sales${path}`, {
    method,
    headers: { 'X-Payout-Key': process.env.PAYOUT_ADMIN_KEY, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(45000),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
  return data
}
const getState = (bot) => call(bot, 'GET', '/payouts')
const record = (bot, { amount, note, requestId, admin }) => call(bot, 'POST', '/payouts', { amount, note, requestId, recordedBy: admin })
const undoLast = (bot, id, admin) => call(bot, 'POST', '/payouts/undo-last', { id, recordedBy: admin })

const lastLine = (st) => (st.lastPayout ? `last paid ${usd(st.lastPayout.amount)} on ${day(st.lastPayout.paidAt)}` : 'never paid')

async function overview() {
  const states = await Promise.all(bots().map((b) => getState(b).then((s) => ({ b, s }), (e) => ({ b, err: e.message }))))
  const lines = states.map(({ b, s, err }) => (err
    ? `<b>${esc(b.name)}</b> — ⚠️ couldn't load (${esc(err)})`
    : `<b>${esc(b.name)}</b> — ${usd(s.eligible)} eligible · ${lastLine(s)}`))
  return {
    text: `💸 <b>Reseller Payouts</b>\n\n${lines.join('\n')}\n\nTap a bot to record a payout you've sent.`,
    keyboard: [...states.map(({ b, s }) => [btn(`${b.name} · ${s ? usd(s.eligible) : '⚠️'}`, `o:${b.id}`)]), [btn('🔄 Refresh', 'list')]],
  }
}

function card(bot, st) {
  const lp = st.lastPayout
  const text = [
    `🤖 <b>${esc(bot.name)}</b>`, '',
    `Eligible now: <b>${usd(st.eligible)}</b>${st.eligible < 0 ? ' (paid more than earned)' : ''}`,
    `Earned to date: ${usd(st.earnedToDate)}`,
    `Paid to date: ${usd(st.paidToDate)}`,
    `Last payout: ${lp ? `${usd(lp.amount)} on ${day(lp.paidAt)}${lp.note ? ` — ${esc(lp.note)}` : ''}` : 'none'}`,
  ].join('\n')
  const rows = st.eligible > 0 ? [[btn(`✅ Mark all ${usd(st.eligible)} paid`, `all:${bot.id}`)], [btn('✏️ Enter amount', `amt:${bot.id}`)]] : []
  rows.push([btn('📜 History', `h:${bot.id}`), ...(lp ? [btn('↩️ Undo last', `u:${bot.id}`)] : [])], back)
  return { text, keyboard: rows }
}

function history(bot, st) {
  const lines = st.history.slice(0, 10).map((p) => {
    const by = p.recordedBy?.username ? ` · by @${esc(p.recordedBy.username)}` : ''
    const row = `${day(p.paidAt)} — ${usd(p.amount)}${p.note ? ` · ${esc(p.note)}` : ''}${by}`
    return p.voided ? `• <s>${row}</s> (undone ${day(p.voidedAt)})` : `• ${row}`
  })
  return {
    text: `📜 <b>${esc(bot.name)} — payout history</b>\n\n${lines.join('\n') || 'No payouts recorded yet.'}\n\nPaid to date: <b>${usd(st.paidToDate)}</b>`,
    keyboard: [[btn('⬅️ Back', `o:${bot.id}`)]],
  }
}

const amountPrompt = (bot, eligible) => ({
  text: `✏️ Type the amount you paid <b>${esc(bot.name)}</b> in USD (up to ${usd(eligible)}), e.g. <code>200</code> or <code>200.50</code>.\nSend /cancel to stop.`,
  keyboard: [[btn('✖️ Cancel', 'x')]],
})
const notePrompt = (bot, amount) => ({
  text: `📝 Paying <b>${usd(amount)}</b> to <b>${esc(bot.name)}</b>.\nType a note for the record — e.g. method or transaction ID — or tap Skip.`,
  keyboard: [[btn('⏭ Skip note', 'skip'), btn('✖️ Cancel', 'x')]],
})
const confirmView = (bot, p) => ({
  text: `Record <b>${usd(p.amount)}</b> as paid to <b>${esc(bot.name)}</b>?\n${p.note ? `Note: ${esc(p.note)}\n` : ''}Eligible goes from ${usd(p.eligible)} → ${usd(p.eligible - p.amount)}. The owner sees this payout on their dashboard.`,
  keyboard: [[btn('✅ Confirm', 'ok'), btn('✖️ Cancel', 'x')]],
})
const undoView = (bot, lp, eligible) => ({
  text: `Undo the last payout to <b>${esc(bot.name)}</b>: ${usd(lp.amount)} on ${day(lp.paidAt)}?\nEligible goes back from ${usd(eligible)} → ${usd(eligible + lp.amount)}. It stays in the history marked as undone.`,
  keyboard: [[btn('↩️ Yes, undo', 'uok'), btn('✖️ Cancel', 'x')]],
})
const doneView = (text) => ({ text, keyboard: [back] })

// Parses a typed USD amount; returns NaN when it isn't a positive number with at most 2 decimals.
function parseAmount(text) {
  const s = String(text || '').replace(/[$,\s]/g, '').replace(/usd$/i, '')
  return /^\d+(\.\d{1,2})?$/.test(s) && Number(s) > 0 ? Math.round(Number(s) * 100) / 100 : NaN
}

module.exports = {
  enabled, bots, botById, getState, record, undoLast, overview, card, history,
  amountPrompt, notePrompt, confirmView, undoView, doneView, parseAmount, usd, esc,
  newRequestId: () => crypto.randomUUID(),
}
