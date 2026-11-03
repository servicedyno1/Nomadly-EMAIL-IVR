'use strict'
// Outbound SIP calls over a user's simultaneous-call limit wait here (caller hears a queued message + hold music)
// instead of being hung up. A queued call connects as soon as one of the user's live calls ends.
const MAX_LIVE = Number(process.env.SIP_MAX_CONCURRENT_CALLS || 10)
const MAX_WAIT_MS = Number(process.env.SIP_QUEUE_MAX_WAIT_MS || 120000)
const POLL_MS = 2000

const waiting = new Map() // callControlId → { chatId, resolve, timer, poll }
const claimed = new Map() // callControlId → chatId: let through, session not created yet (counted as live for 15s)
const CLAIM_MS = 15000

const claim = (chatId, ccid) => { claimed.set(ccid, String(chatId)); setTimeout(() => claimed.delete(ccid), CLAIM_MS).unref?.() }
const liveCount = (calls, chatId) => {
  for (const id of claimed.keys()) if (calls[id]) claimed.delete(id) // its session now counts itself
  return Object.values(calls).filter(c => c && String(c.chatId) === String(chatId) && c.direction === 'outgoing' && !c.isTestCall).length +
    [...claimed.values()].filter(c => c === String(chatId)).length
}

const queuedAhead = (chatId, ccid) => {
  let n = 0
  for (const [id, w] of waiting) { if (id === ccid) break; if (w.chatId === String(chatId)) n++ }
  return n
}

const finish = (ccid, result) => {
  const w = waiting.get(ccid)
  if (!w) return
  clearTimeout(w.timer); clearInterval(w.poll)
  waiting.delete(ccid)
  w.resolve(result)
}

// Resolves 'go' when a slot frees, 'timeout' after MAX_WAIT_MS, 'gone' if the caller hangs up first.
function waitForSlot(calls, chatId, ccid) {
  return new Promise(resolve => {
    const w = { chatId: String(chatId), resolve }
    w.poll = setInterval(() => {
      if (liveCount(calls, chatId) + queuedAhead(chatId, ccid) < MAX_LIVE) { claim(chatId, ccid); finish(ccid, 'go') }
    }, POLL_MS)
    w.timer = setTimeout(() => finish(ccid, 'timeout'), MAX_WAIT_MS)
    waiting.set(ccid, w)
  })
}

const isFull = (calls, chatId) => liveCount(calls, chatId) + [...waiting.values()].filter(w => w.chatId === String(chatId)).length >= MAX_LIVE
// Checks the limit and, when there is room, holds a slot for this call right away (no burst can overshoot).
const admit = (calls, chatId, ccid) => { if (isFull(calls, chatId)) return false; claim(chatId, ccid); return true }
const drop = (ccid) => { claimed.delete(ccid); finish(ccid, 'gone') }
const settled = (ccid) => claimed.delete(ccid) // the call's own session now counts it
const isQueued = (ccid) => waiting.has(ccid)

module.exports = { MAX_LIVE, MAX_WAIT_MS, isFull, admit, settled, waitForSlot, drop, isQueued, liveCount }
