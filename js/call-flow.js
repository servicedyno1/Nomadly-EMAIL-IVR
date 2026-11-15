'use strict'
// One plain line: what happens when someone calls this number (mirrors voice-service's inbound order).
const fmt = (p) => require('./phone-config').formatPhone?.(p) || p

function callFlow(n) {
  const f = n?.features || {}, cf = f.callForwarding || {}
  const fwd = cf.enabled && cf.forwardTo && cf.mode && cf.mode !== 'disabled' ? cf : null
  const vm = f.voicemail?.enabled ? ', then voicemail' : ''
  let line
  if (fwd?.mode === 'always') line = `rings your phone ${fmt(fwd.forwardTo)}`
  else if (f.aiAgent?.enabled) line = 'your AI agent answers'
  else if (f.ivr?.enabled) line = 'your keypad menu answers'
  else if (f.ringGroup?.enabled && (f.ringGroup.members || []).length) line = `rings ${f.ringGroup.members.length} phones at once${vm}`
  else if (fwd) line = `rings your app, then ${fmt(fwd.forwardTo)} if ${fwd.mode === 'busy' ? 'busy' : 'not answered'}${vm}`
  else line = f.voicemail?.enabled ? 'rings your app, then voicemail' : 'rings your app / softphone'
  return `When someone calls: ${line}${f.hours?.enabled ? ' (during your open hours)' : ''}.`
}

module.exports = { callFlow }
