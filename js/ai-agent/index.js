'use strict'
// AI phone agents: Telnyx media streams ⇄ OpenAI Realtime. WebSocket paths (FastAPI relays /api/* in preview):
//   /ai-agent/stream/<token>               Telnyx bidirectional media stream of a live call
//   /cloudivr-web/ai-agents/test/<token>   browser test talk
const WebSocket = require('ws')
const store = require('./store')
const hours = require('./hours')
const calls = require('./calls')
const gcal = require('./gcal')
const booking = require('./booking')
const recorder = require('./recorder')

const PATH = /^(?:\/api)?\/(ai-agent\/stream|cloudivr-web\/ai-agents\/test)\/([A-Za-z0-9_-]{16,64})(?:[/?]|$)/

function init({ db, server, ...deps }) {
  store.init(db)
  gcal.init(db)
  calls.init(deps)
  recorder.setDb(db)
  recorder.startSweep(db, deps.log || console.log)
  if (!server) return
  const wss = new WebSocket.Server({ noServer: true, perMessageDeflate: false })
  server.on('upgrade', (req, socket, head) => {
    const m = PATH.exec(req.url || '')
    if (!m) { if (server.listeners('upgrade').length === 1) socket.destroy(); return }
    wss.handleUpgrade(req, socket, head, (ws) => (m[1] === 'ai-agent/stream' ? calls.onStream(m[2], ws) : calls.onTest(m[2], ws)))
  })
}

module.exports = {
  init, store, hours, gcal, booking, recorder, RATE: calls.RATE, RECORD_RATE: calls.RECORD_RATE, leadRate: calls.leadRate, committed: calls.committed, owns: calls.owns, activeCount: calls.activeCount,
  onWebhook: calls.onWebhook, tryInbound: calls.tryInbound, dialLead: calls.dialLead, createTest: calls.createTest,
}
