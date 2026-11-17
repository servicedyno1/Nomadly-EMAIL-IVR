'use strict'
// Connections an account uses in its keypad menu: its own database (lookups) and payment providers (payment links).
const live = require('../ivr-live-data')
const bad = (res, status, error, message) => res.status(status).json({ error, message })
const fail = (res, e) => (e.friendly ? bad(res, 400, 'connection_failed', e.message) : (() => { throw e })())
const page = (title, text) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${title}</title></head><body style="margin:0;font-family:system-ui,sans-serif;background:#0e0e16;color:#f4f4f5;display:grid;place-items:center;min-height:100vh"><div style="max-width:420px;padding:32px;text-align:center"><h1 style="font-size:24px;margin:0 0 12px">${title}</h1><p style="color:#a1a1aa;line-height:1.5;margin:0">${text}</p></div></body></html>`

// Public: the short link texted to a caller, and the page they land on after paying.
function publicRoutes(r, { h }) {
  r.get('/public/pay/:token', h(async (req, res) => {
    const url = await live.paymentUrl(req.params.token)
    if (!url) return res.status(404).type('html').send(page('Link not found', 'This payment link is no longer available.'))
    res.redirect(302, url)
  }))
  r.get('/public/pay-done', h(async (req, res) => {
    const p = await live.checkPayment(String(req.query.p || '')).catch(() => null)
    res.type('html').send(p?.status === 'paid' ? page('Payment received', `Thank you. Your payment of ${p.amount} ${p.currency} went through. You can close this page.`) : page('Thank you', 'If you completed the payment it will be confirmed shortly. You can close this page.'))
  }))
}

// "Show me the pop-up": an example Accept / Decline banner for this account only (no call involved).
const HOLD_MS = 45000, previews = new Map(), OUT = ['message', 'forward', 'menu', 'voicemail', 'end']
function previewList(chatId) {
  for (const [id, p] of previews) if (Date.now() - p.at > HOLD_MS) previews.delete(id)
  return [...previews.values()].filter(p => p.chatId === String(chatId)).map(p => p.view)
}
function previewResolve(chatId, id) { const p = previews.get(id); if (!p || p.chatId !== String(chatId)) return false; previews.delete(id); return true }

function routes(r, { h }) {
  r.post('/ivr-connections/confirm-preview', h(async (req, res) => {
    const b = req.body || {}, kind = ['webhook', 'collect', 'pin'].includes(b.kind) ? b.kind : 'collect'
    const id = `pv_${Date.now().toString(36)}`
    for (const [k, p] of previews) if (p.chatId === String(req.webChatId)) previews.delete(k)
    const view = { id, kind: 'ivr', ivrKind: kind, state: 'code', to: '+14155550123', number: String(b.number || ''), code: kind === 'webhook' ? `Key ${String(b.digit || '1').slice(0, 1)}` : kind === 'pin' ? '4821' : '123456', label: String(b.label || '').slice(0, 60), title: kind === 'pin' ? 'Code entered' : kind === 'collect' ? 'Number entered' : 'Caller is waiting', checked: 'Example only', found: true, say: '', attempt: 1, maxAttempts: kind === 'pin' ? 3 : 1, holdEndsAt: new Date(Date.now() + HOLD_MS), connectTo: /^\+\d{8,15}$/.test(String(b.connectTo || '')) ? String(b.connectTo) : null, preview: true, onAccept: OUT.includes(b.onAccept) ? b.onAccept : null, onDecline: OUT.includes(b.onDecline) ? b.onDecline : null, declineTo: b.onDecline === 'forward' && /^\+\d{8,15}$/.test(String(b.declineTo || '')) ? String(b.declineTo) : null, canReplay: kind !== 'webhook', replayMessage: String(b.replayMessage || '').slice(0, 300), declineMessage: String(b.declineMessage || '').slice(0, 300) }
    previews.set(id, { chatId: String(req.webChatId), at: Date.now(), view })
    res.json({ shown: true, id })
  }))
  r.get('/ivr-connections', h(async (req, res) => res.json({ items: await live.list(req.webChatId), payFields: live.PAY_FIELDS })))
  r.post('/ivr-connections', h(async (req, res) => {
    try { res.json({ connection: await live.create(req.webChatId, req.body || {}) }) } catch (e) { fail(res, e) }
  }))
  r.delete('/ivr-connections/:id', h(async (req, res) => ((await live.remove(req.webChatId, req.params.id)) ? res.json({ deleted: true }) : bad(res, 404, 'not_found', 'That connection was already removed.'))))
  r.get('/ivr-connections/:id/tables', h(async (req, res) => {
    try { res.json({ tables: await live.tables(req.webChatId, req.params.id) }) } catch (e) { fail(res, e) }
  }))
  r.get('/ivr-connections/:id/columns', h(async (req, res) => {
    try { res.json({ columns: await live.columns(req.webChatId, req.params.id, String(req.query.table || '')) }) } catch (e) { fail(res, e) }
  }))
  // Try a lookup from the menu builder: what would a caller who types this value hear?
  r.post('/ivr-connections/:id/lookup', h(async (req, res) => {
    const { table, match, value, say } = req.body || {}
    if (!table || !match || !String(value || '').trim()) return bad(res, 400, 'missing', 'Pick the table and column, and type a value to try.')
    try {
      const row = await live.find(req.webChatId, req.params.id, { table: String(table), match: String(match), value: String(value) })
      res.json({ found: !!row, row, say: row && say ? live.fill(say, row) : '' })
    } catch (e) { fail(res, e) }
  }))
}

module.exports = { routes, publicRoutes, previewList, previewResolve }
