'use strict'
// Outbound SIP calls over a user's simultaneous-call limit wait here (caller hears a queued message + hold music)
// instead of being hung up. A queued call connects as soon as one of the user's live calls ends.
const MAX_LIVE = Number(process.env.SIP_MAX_CONCURRENT_CALLS || 10)
const MAX_WAIT_MS = Number(process.env.SIP_QUEUE_MAX_WAIT_MS || 120000)
const POLL_MS = 2000

const waiting = new Map() // callControlId → { chatId, resolve, timer, poll }

const liveCount = (calls, chatId) =>
  Object.values(calls).filter(c => c && String(c.chatId) === String(chatId) && c.direction === 'outgoing' && !c.isTestCall).length

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
      if (liveCount(calls, chatId) + queuedAhead(chatId, ccid) < MAX_LIVE) finish(ccid, 'go')
    }, POLL_MS)
    w.timer = setTimeout(() => finish(ccid, 'timeout'), MAX_WAIT_MS)
    waiting.set(ccid, w)
  })
}

const isFull = (calls, chatId) => liveCount(calls, chatId) + [...waiting.values()].filter(w => w.chatId === String(chatId)).length >= MAX_LIVE
const drop = (ccid) => finish(ccid, 'gone')
const isQueued = (ccid) => waiting.has(ccid)

module.exports = { MAX_LIVE, MAX_WAIT_MS, isFull, waitForSlot, drop, isQueued, liveCount }
