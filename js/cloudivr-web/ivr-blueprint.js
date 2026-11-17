'use strict'
// Whole-flow IVR architect helpers for the inbound keypad menu (features.ivr).
// Pure logic, no DB — mirrors how js/voice-service.js actually runs a call so the
// blueprint, validation report and simulated test report match real call behaviour.
// Executor facts honoured here: leaf actions forward|message|sms|voicemail; one
// sub-menu level only (depth capped at 2); wrong/no key → "invalid option" once,
// then goodbye.

const LEAF = ['forward', 'message', 'sms', 'voicemail', 'webhook', 'collect', 'pin', 'pay', 'queue']
const ACTIONS = [...LEAF, 'submenu']
const MAX_SUB_DEPTH = 3 // sub-menus may nest up to 3 levels (paths like 1.2.3); the executor walks session.ivrPath as an array.
const isPhone = (v) => /^\+\d{8,15}$/.test(String(v || '').replace(/[^\d+]/g, ''))
const isUrl = (v) => /^https:\/\/[^\s]+$/i.test(String(v || '').trim())
const hasText = (v) => !!String(v ?? '').trim()
const fmt = (p) => { try { return require('../phone-config').formatPhone?.(p) || p } catch (_) { return p } }

// Accept either the stored object shape {digit:{...}} or the builder list shape [{digit,...}].
function optList(options) {
  if (Array.isArray(options)) return options.map(o => ({ ...o, digit: String(o.digit) }))
  return Object.entries(options || {}).map(([digit, o]) => ({ digit: String(digit), ...o }))
}
function subList(o) {
  const sub = o.subMenu || (o.action === 'submenu' ? o : null)
  return sub ? optList(sub.options) : []
}
function subGreeting(o) { return (o.subMenu || o).greeting }

const agentsOf = (o) => (Array.isArray(o.agents) ? o.agents : String(o.agents || '').split(/[\s,;]+/)).map(a => String(a).trim()).filter(Boolean)
function actionOutcome(o, ctx) {
  switch (o.action) {
    case 'forward': return o.forwardTo ? `connects the caller to ${fmt(o.forwardTo)}` : null
    case 'message': return (hasText(o.message) || o.audioUrl) ? 'reads your message, then hangs up' : null
    case 'sms': return hasText(o.smsText) || (Array.isArray(o.smsTexts) && o.smsTexts.length) ? 'sends the caller a text, then ' + (o.after === 'menu' ? 'replays the menu' : 'hangs up') : null
    case 'voicemail': return ctx?.voicemailAvailable === false ? null : 'takes a voicemail'
    case 'webhook': return isUrl(o.url) ? 'calls your system, then ' + (o.after === 'menu' ? 'replays the menu' : 'hangs up') : null
    case 'queue': { const a = agentsOf(o); const ov = o.overflow || {}; return a.length && a.every(isPhone) && (ov.action !== 'forward' || isPhone(ov.forwardTo)) ? `holds the caller with music while ${a.length} phone${a.length === 1 ? ' rings' : 's ring in turn'} for up to ${Math.round((Number(o.maxWait) || 180) / 60 * 10) / 10} min; if nobody answers, ${ov.action === 'voicemail' ? 'takes a voicemail' : ov.action === 'forward' ? `tries ${fmt(ov.forwardTo)}` : 'plays your closing message'}` : null }
    case 'pay': return isUrl(o.payUrl) ? 'texts the caller your payment link, then ' + (o.after === 'menu' ? 'replays the menu' : 'hangs up') : null
    case 'collect': return hasText(o.prompt) ? 'asks the caller to type a number, then ' + (isUrl(o.webhook) ? 'sends it to your system' : isPhone(o.forwardTo) ? 'connects them' : 'confirms it') : null
    case 'pin': return (String(o.pin || '').replace(/\D/g, '').length || (Array.isArray(o.pins) && o.pins.length)) ? 'asks for a code; if it matches, ' + (isPhone(o.onOk?.forwardTo) ? 'connects them' : 'continues') + '; otherwise retries' : null
    case 'submenu': return subList(o).length ? `opens the "${o.label || 'sub-menu'}" sub-menu` : null
    default: return null
  }
}

// ── Validation: plain-language errors (blocks a working menu) + warnings (advice) ──
function validate(ivr, ctx = {}) {
  const issues = []
  const err = (where, message) => issues.push({ level: 'error', where, message })
  const warn = (where, message) => issues.push({ level: 'warn', where, message })
  const lines = Array.isArray(ctx.textingNumbers) ? ctx.textingNumbers : null
  const root = optList(ivr?.options)

  if (!root.length) { err('menu', 'Add at least one key so callers can do something.') }
  if (root.length > 7) warn('menu', 'More than 7 keys is a lot to remember — consider grouping some under a sub-menu.')

  const seen = new Set()
  const checkKey = (o, where, depth) => {
    const k = `${where}Key ${o.digit}`
    const id = `${where}|${o.digit}`
    if (seen.has(id)) { err(k, 'Two keys use the same digit — each key needs a unique digit.'); return }
    seen.add(id)
    if (!ACTIONS.includes(o.action)) { err(k, 'Pick what this key does.'); return }
    if (o.action === 'forward' && !isPhone(o.forwardTo)) err(k, 'Add the phone number this key should ring (with country code).')
    if (o.action === 'message' && !hasText(o.message) && !o.audioUrl) err(k, 'Add the words this key should read out.')
    if (o.action === 'queue') {
      const a = agentsOf(o)
      if (!a.length) err(k, 'Add at least one phone for the queue to ring (up to 5).')
      else if (a.some(x => !isPhone(x))) err(k, 'One of the queue phones is not a full number with country code.')
      if (a.length > 5) err(k, 'A queue can ring up to 5 phones.')
      if (o.overflow?.action === 'forward' && !isPhone(o.overflow.forwardTo)) err(k, 'Add the phone to try when nobody in the queue answers.')
      if (o.overflow?.action === 'voicemail' && ctx.voicemailAvailable === false) err(k, 'Voicemail as the last resort needs the Starter plan or higher.')
      if (a.length === 1) warn(k, 'A queue with one phone works, but a caller only gets through when that phone is free.')
    }
    if (o.action === 'pay' && !isUrl(o.payUrl)) err(k, 'Add the https address of your own payment page (e.g. your Stripe or PayPal link).')
    if (o.action === 'sms' || o.action === 'pay') {
      if (o.action === 'sms' && !hasText(o.smsText) && !(Array.isArray(o.smsTexts) && o.smsTexts.length)) err(k, 'Add the text this key should send.')
      if (lines && !lines.length) err(k, 'This key texts the caller, but you have no Texting Number yet — order one, or change the key.')
      else if (lines && lines.length > 1 && !lines.some(l => l.id === o.smsFrom)) err(k, `Choose which Texting Number sends it (${lines.map(l => l.phone).join(' or ')}).`)
    }
    if (o.action === 'voicemail' && ctx.voicemailAvailable === false) err(k, 'Voicemail needs the Starter plan or higher.')
    if (o.action === 'webhook' && !isUrl(o.url)) err(k, 'Add the secure https web address (webhook URL) this key should call.')
    if (o.action === 'collect') {
      if (!hasText(o.prompt)) err(k, 'Say what the caller should type (e.g. "enter your order number").')
      if (!isUrl(o.webhook) && !isPhone(o.forwardTo) && !hasText(o.message)) err(k, 'Choose what happens with the digits — send to your system, connect the call, or confirm a message.')
    }
    if (o.action === 'pin') {
      const pins = (Array.isArray(o.pins) ? o.pins : [o.pin]).map(p => String(p || '').replace(/\D/g, '')).filter(Boolean)
      if (!pins.length) err(k, 'Add at least one PIN code (digits) callers can enter.')
    }
    if (o.action === 'submenu') {
      if (depth >= MAX_SUB_DEPTH) { err(k, `Sub-menus can only go ${MAX_SUB_DEPTH} levels deep — this key is too deep to work on a real call.`); return }
      const subs = subList(o)
      if (!subs.length) err(k, 'This sub-menu has no keys yet.')
      for (const so of subs) checkKey(so, `${k} → `, depth + 1)
    }
  }
  for (const o of root) checkKey(o, '', 0)

  // A way to reach a person: a queue counts.
  // Greeting must mention each key, or callers won't know to press it.
  const greeting = String(ivr?.greeting || '')
  if (!greeting.trim()) {
    if (root.length) warn('greeting', 'No greeting yet — the standard "please select an option" will be used, which does not list your keys.')
  } else {
    for (const o of root) if (!new RegExp(`\\b${o.digit}\\b`).test(greeting)) warn('greeting', `The greeting doesn't mention key ${o.digit} — callers won't know to press it.`)
  }

  // A way to reach a person is almost always wanted.
  if (root.length && !root.some(o => o.action === 'forward' || o.action === 'submenu' || o.action === 'queue')) warn('menu', 'No key reaches a person — consider a key that forwards to you (e.g. press 0 for an operator).')

  const errors = issues.filter(i => i.level === 'error').length
  return { ok: errors === 0, ready: errors === 0, errors, warnings: issues.length - errors, issues }
}

// ── Simulation: walk every branch a caller can take and say what happens ──
function simulate(ivr, ctx = {}) {
  const tests = []
  const add = (path, input, expect, ok) => tests.push({ path, input, expect, ok })
  const root = optList(ivr?.options)

  add('Start', 'call comes in', ivr?.greeting?.trim() ? 'plays your greeting and waits for a key' : 'plays the standard greeting and waits for a key', true)

  const walk = (opts, where, depth) => {
    for (const o of opts) {
      const out = actionOutcome(o, ctx)
      add(`${where}Key ${o.digit}${o.label ? ` (${o.label})` : ''}`, `press ${o.digit}`, out || `⚠ not set up yet — this key would fail on a real call`, !!out)
      if (o.action === 'queue' && out) {
        add(`${where}Key ${o.digit} → queue`, 'another caller is already waiting', o.announcePosition === false ? 'waits on hold music' : 'is told their place in the queue, then waits on hold music', true)
        add(`${where}Key ${o.digit} → queue`, 'caller hangs up while waiting', 'the ringing stops', true)
        if (o.callback === true) add(`${where}Key ${o.digit} → queue`, 'presses 1 when offered a call back', 'the call ends and you get a message with their number to call back yourself', true)
      }
      if (o.action === 'submenu' && depth < MAX_SUB_DEPTH) {
        const subs = subList(o)
        add(`${where}Key ${o.digit} → sub-menu`, 'enter sub-menu', subs.length ? 'plays the sub-menu greeting and waits for a key' : '⚠ empty sub-menu', subs.length > 0)
        if (subs.length) walk(subs, `${where}Key ${o.digit} → `, depth + 1)
      }
    }
    add(`${where}Any menu`, 'press an unused key', 'says "invalid option", then asks once more', true)
    add(`${where}Any menu`, 'press nothing', 'waits, asks once more, then says goodbye and hangs up', true)
  }
  if (root.length) walk(root, '', 0)
  else add('Menu', 'press any key', '⚠ no keys configured', false)

  const failed = tests.filter(t => !t.ok).length
  return { tests, passed: tests.length - failed, failed, ok: failed === 0 }
}

// ── Canonical blueprint (nodes + edges) for the visual flow builder / export ──
function blueprint(ivr, ctx = {}) {
  const nodes = []
  const edges = []
  const add = (id, type, label, detail) => { nodes.push({ id, type, label, detail: detail || '' }); return id }
  const link = (from, to, label) => edges.push({ from, to, label: label || '' })

  add('incoming', 'incoming', 'Incoming call', '')
  const gid = add('greeting', 'greeting', 'Greeting', ivr?.greeting?.trim() ? String(ivr.greeting).slice(0, 120) : 'Standard greeting')
  link('incoming', gid)

  const destNode = (o, id) => {
    if (o.action === 'forward') return add(id, 'forward', 'Forward', o.forwardTo ? fmt(o.forwardTo) : 'no number set')
    if (o.action === 'message') return add(id, 'message', 'Message', (o.message || 'audio').slice(0, 80))
    if (o.action === 'sms') return add(id, 'sms', 'Send a text', (o.smsText || '').slice(0, 80))
    if (o.action === 'voicemail') return add(id, 'voicemail', 'Voicemail', ctx?.voicemailAvailable === false ? 'needs Starter+' : '')
    if (o.action === 'webhook') return add(id, 'webhook', 'Webhook', (o.url || 'no URL set'))
    if (o.action === 'queue') return add(id, 'queue', 'Call queue', `${agentsOf(o).length} phone${agentsOf(o).length === 1 ? '' : 's'} · wait up to ${Number(o.maxWait) || 180}s · then ${o.overflow?.action || 'message'}`)
    if (o.action === 'pay') return add(id, 'pay', 'Text a payment link', o.payUrl || 'no link set')
    if (o.action === 'collect') return add(id, 'collect', 'Collect digits', o.prompt ? String(o.prompt).slice(0, 60) : (isPhone(o.forwardTo) ? `→ ${fmt(o.forwardTo)}` : ''))
    if (o.action === 'pin') return add(id, 'pin', 'PIN check', isPhone(o.onOk?.forwardTo) ? `ok → ${fmt(o.onOk.forwardTo)}` : '')
    return null
  }
  const walk = (opts, parent, prefix, depth) => {
    for (const o of optList(opts)) {
      if (o.action === 'submenu' && depth < MAX_SUB_DEPTH) {
        const subId = add(`${prefix}${o.digit}`, 'menu', o.label || `Sub-menu ${o.digit}`, subGreeting(o) ? String(subGreeting(o)).slice(0, 80) : '')
        link(parent, subId, `Key ${o.digit}`)
        walk(subList(o), subId, `${prefix}${o.digit}.`, depth + 1)
      } else {
        const d = destNode(o, `${prefix}${o.digit}`)
        if (d) link(parent, d, `Key ${o.digit}${o.label ? ` · ${o.label}` : ''}`)
      }
    }
  }
  walk(ivr?.options, gid, 'k', 0)
  return { nodes, edges }
}

// Compact "ready / still needed" summary the assistant appends to its replies.
function readiness(ivr, ctx) {
  const v = validate(ivr, ctx)
  return {
    ready: v.ready,
    stillNeeded: v.issues.filter(i => i.level === 'error').map(i => `${i.where}: ${i.message}`).slice(0, 8),
    advice: v.issues.filter(i => i.level === 'warn').map(i => i.message).slice(0, 5),
  }
}

// ── Outbound (Quick IVR call / Bulk IVR campaign): one call returns checks + simulated test + flow ──
// config uses the same field names the setup assistant fills. Menus here are the outbound kind:
// forward | message | submenu (one level), with the sub-menu's greeting/options on the key itself.
function outbound(kind, c = {}, ctx = {}) {
  const issues = []
  const err = (where, message) => issues.push({ level: 'error', where, message })
  const warn = (where, message) => issues.push({ level: 'warn', where, message })
  const script = String(c.script || '').trim()
  const hasAudio = !!ctx.hasAudio
  const mode = c.mode || (kind === 'campaign' ? 'report_only' : 'transfer')
  const to = kind === 'campaign' ? c.transferNumber : c.transferTo
  const keys = (Array.isArray(c.activeKeys) ? c.activeKeys : []).map(String)
  const menu = optList(c.menu)
  const says = (k) => new RegExp(`\\b(${k}|${['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'][Number(k)]})\\b`, 'i').test(script)
  const stopKey = /^[0-9]$/.test(String(c.stopKey ?? '')) && (mode === 'transfer' || mode === 'report_only') && !menu.length ? String(c.stopKey) : ''
  const targets = String(Array.isArray(c.targets) ? c.targets.join(',') : c.targets || '').split(/[\s,;]+/).filter(Boolean)

  if (!script && !hasAudio) err('message', kind === 'campaign' ? 'Write the message (or pick an audio file) people will hear.' : 'Write the script the call reads out.')
  if (kind === 'quick') {
    if (!targets.length) err('who to call', 'Add at least one number to call.')
    else if (targets.some(t => !isPhone(t))) err('who to call', 'One of the numbers is not a full number with country code (e.g. +14155550100).')
  } else {
    if (ctx.contacts === 0) err('contacts', 'Choose or upload the list of people to call.')
    if (typeof ctx.balance === 'number' && ctx.balance < 20) warn('wallet', 'A campaign needs about $20 in the wallet to start — add funds so it does not pause.')
    warn('contacts', 'Only call people who agreed to hear from you. Rules differ by country.')
    if (!stopKey && (mode === 'transfer' || mode === 'report_only')) warn('keys', 'No stop-calls key is set. Consider one (for example 9) so people can take themselves off your list.')
  }
  // A script may promise a stop key only when that exact key is set as the stop-calls key.
  const hits = stopClauses(script).hits
  const promised = (hits.find(h => h.key !== stopKey) || hits[0] || {}).key || ''
  if (promised && promised !== stopKey) err('message', stopKey ? `The message says key ${promised} stops future calls, but the stop-calls key is ${stopKey}.` : `The message promises that key ${promised} stops future calls, but no stop-calls key is set. Set the stop-calls key to ${promised}, or remove that line.`)
  if (stopKey && keys.includes(stopKey)) err('keys', `Key ${stopKey} is both a normal key and the stop-calls key — pick a different one.`)
  if (stopKey && script && !promised) warn('message', `The stop-calls key is ${stopKey}, but the message never tells people to press it.`)
  if (mode === 'transfer') {
    if (!isPhone(to)) err('connect to', 'Add the phone number people are connected to when they press a key.')
    if (!keys.length) err('keys', 'Choose which key connects the call (e.g. 1).')
    if (script) for (const k of keys) if (!says(k)) warn('message', `The message doesn't tell people to press ${k}.`)
  }
  if (mode === 'report_only' && script) for (const k of keys) if (!says(k)) warn('message', `The message doesn't tell people to press ${k}.`)
  if (mode === 'otp' && script && !/press\s*(1|one)\b/i.test(script)) err('script', 'The script must tell the person to press 1 before typing the code.')
  if (mode === 'menu') {
    const v = validate({ greeting: script, options: menu }, { ...ctx, textingNumbers: null })
    for (const i of v.issues) if (!(i.where === 'menu' && /No key reaches a person/.test(i.message))) issues.push({ ...i, where: i.where === 'greeting' ? 'message' : i.where, message: i.message.replace('The greeting', 'The message').replace('No greeting yet — the standard "please select an option" will be used, which does not list your keys.', 'The message should list the keys people can press.') })
    for (const o of menu) if (o.action === 'submenu' && subList(o).some(s => s.action === 'submenu')) err(`Key ${o.digit}`, 'Outbound menus can only have one sub-menu level.')
    for (const o of menu) if (!['forward', 'message', 'submenu'].includes(o.action)) err(`Key ${o.digit}`, 'Outbound menus can connect to a phone, play a message or open a sub-menu.')
  }

  // simulated walk-through
  const tests = []
  const t = (path, input, expect, ok = true) => tests.push({ path, input, expect, ok })
  const heard = script || hasAudio
  t('Start', 'person answers', heard ? 'hears your message' : '⚠ nothing to play yet', !!heard)
  if (mode === 'transfer') {
    for (const k of keys) t(`Key ${k}`, `press ${k}`, isPhone(to) ? `is connected to ${fmt(to)}${c.holdMusic ? ' (hold music while connecting)' : ''}` : '⚠ no phone to connect to', isPhone(to))
    if (!keys.length) t('Keys', 'press any key', '⚠ no key is set to connect', false)
    t('Other keys', 'press another key', 'no action is set for other keys')
  } else if (mode === 'report_only') {
    t(keys.length ? `Keys ${keys.join(', ')}` : 'Any key', 'press a key', 'the key press is recorded in your results; nobody is connected')
  } else if (mode === 'otp') {
    const says1 = /press\s*(1|one)\b/i.test(script)
    t('Key 1', 'press 1', says1 ? `is asked to type a ${c.otp?.length || 6}-digit code` : '⚠ the script never asks them to press 1', says1)
    t('Code', 'types the code', 'you see the code and accept or decline it')
    t('Accepted', 'you accept', isPhone(to) ? `hears the confirmation, then is connected to ${fmt(to)}` : 'hears the confirmation, then the call ends')
    t('Declined', 'you decline', 'hears that the code was not accepted')
  } else if (mode === 'menu') {
    const walk = (opts, where, depth) => {
      for (const o of opts) {
        const ok = o.action === 'forward' ? isPhone(o.forwardTo) : o.action === 'message' ? hasText(o.message) : o.action === 'submenu' ? subList(o).length > 0 && depth < 1 : false
        t(`${where}Key ${o.digit}`, `press ${o.digit}`, !ok ? '⚠ not set up yet' : o.action === 'forward' ? `is connected to ${fmt(o.forwardTo)}` : o.action === 'message' ? 'hears your message, then the call ends' : 'hears the sub-menu prompt', ok)
        if (o.action === 'submenu' && depth < 1) walk(subList(o), `${where}Key ${o.digit} → `, depth + 1)
      }
    }
    if (menu.length) walk(menu, '', 0); else t('Menu', 'press any key', '⚠ no keys set', false)
  }
  if (stopKey) t(`Key ${stopKey}`, `press ${stopKey}`, 'is put on your do-not-call list and told they will not be called again; nobody is connected')
  t('No key', 'presses nothing', 'nobody is connected; the call ends')
  t('No answer', 'does not pick up', 'nothing is played; shown as not answered in your results')

  // flow
  const nodes = [], edges = []
  const add = (id, type, label, detail) => { nodes.push({ id, type, label, detail: detail || '' }); return id }
  const link = (from, toId, label) => edges.push({ from, to: toId, label: label || '' })
  add('incoming', 'outgoing', kind === 'campaign' ? 'Call each contact' : `Call ${targets.length || 0} number${targets.length === 1 ? '' : 's'}`, '')
  add('greeting', 'greeting', 'Message', script ? script.slice(0, 120) : hasAudio ? 'Audio file' : 'not written yet'); link('incoming', 'greeting')
  if (mode === 'transfer') for (const k of keys) link('greeting', add(`k${k}`, 'forward', 'Connect', isPhone(to) ? fmt(to) : 'no number set'), `Key ${k}`)
  if (mode === 'report_only') link('greeting', add('report', 'message', 'Record the key press', 'shown in your results'), keys.length ? `Key ${keys.join(', ')}` : 'Any key')
  if (stopKey) link('greeting', add('stop', 'stop', 'Stop these calls', 'added to your do-not-call list'), `Key ${stopKey}`)
  if (mode === 'otp') { link('greeting', add('code', 'collect', 'Type a code', `${c.otp?.length || 6} digits`), 'Key 1'); link('code', add('review', 'pin', 'You accept or decline', ''), ''); if (isPhone(to)) link('review', add('conn', 'forward', 'Connect', fmt(to)), 'accepted') }
  if (mode === 'menu') {
    const walk = (opts, parent, prefix, depth) => { for (const o of opts) {
      if (o.action === 'submenu' && depth < 1) { const id = add(`${prefix}${o.digit}`, 'menu', o.label || `Sub-menu ${o.digit}`, String(subGreeting(o) || '').slice(0, 80)); link(parent, id, `Key ${o.digit}`); walk(subList(o), id, `${prefix}${o.digit}.`, depth + 1) }
      else if (o.action === 'forward') link(parent, add(`${prefix}${o.digit}`, 'forward', 'Connect', isPhone(o.forwardTo) ? fmt(o.forwardTo) : 'no number set'), `Key ${o.digit}`)
      else if (o.action === 'message') link(parent, add(`${prefix}${o.digit}`, 'message', 'Message', String(o.message || '').slice(0, 80)), `Key ${o.digit}`)
    } }
    walk(menu, 'greeting', 'k', 0)
  }

  const errors = issues.filter(i => i.level === 'error').length
  const failed = tests.filter(x => !x.ok).length
  return { validation: { ok: errors === 0, ready: errors === 0, errors, warnings: issues.length - errors, issues }, test: { tests, passed: tests.length - failed, failed, ok: failed === 0 }, flow: { nodes, edges } }
}

// Stop-call promises in a script, found clause by clause ("press 9 to stop these calls", "to opt out, press nine", "…and 9 to unsubscribe").
const NUMW = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine']
const KEYW = '(\\d|zero|one|two|three|four|five|six|seven|eight|nine)'
const STOP_RE = new RegExp('\\b(?:' + [
  'stop(?:\\s+(?:receiving|getting))?(?:\\s+(?:these|the|our|all|future|further|any more))*\\s+(?:calls?|calling|messages|contact)',
  'to stop(?!\\s+by\\b)(?=\\s*(?:$|now\\b|at any time|anytime))',
  'opt(?:ing)?[ -]?out', 'unsubscribe', 'be removed', 'removed? (?:you|me|your number|my number|from)', 'no more calls',
  "(?:not|n't|never) (?:call you|be called|receive|get|contact you)", 'no longer (?:wish|want|receive|be called|call)',
  "do(?:n't| not) (?:want|wish)(?: to (?:receive|get|hear))? (?:these|any|more|further|our) calls?", 'do[- ]not[- ]call',
  'off (?:our|the|this|my) (?:calling |call )?list',
].join('|') + ')', 'i')
const KEY_IN = new RegExp(`\\b(?:press(?:ing)?|dial|hit|push|key|option)\\s+${KEYW}\\b`, 'i')
const KEY_BARE = /^(?:(?:or|and)\s+)?(\d)\s+(?:to|for|if)\b/i
const KEY_ONLY = new RegExp(`^(?:(?:or|and|then|just|simply|please)\\s+)*(?:press|dial|hit|push)\\s+${KEYW}(?:\\s+(?:now|anytime|at any time|any time|instead))?$`, 'i')
const FILLER = /^(?:now|today|anytime|at any time|any time)$/i
const CLAUSE_SEP = /([.!?]+(?:\s+|$)|[,;]\s*|\s+[—–-]\s+|\s+(?=(?:or|and)\s+(?:please\s+)?(?:press|dial|hit|push|to\s|if\s|for\s|\d\b)))/
const digitOf = (w) => (NUMW.indexOf(String(w).toLowerCase()) >= 0 ? String(NUMW.indexOf(String(w).toLowerCase())) : String(w))
function stopClauses(script) {
  const parts = String(script || '').split(CLAUSE_SEP)
  const cl = []
  for (let i = 0; i < parts.length; i += 2) cl.push({ text: parts[i] || '', sep: parts[i + 1] || '' })
  const near = (i, step) => { for (let j = i + step; j >= 0 && j < cl.length; j += step) if (cl[j].text.trim()) return j; return -1 }
  const hits = []
  cl.forEach((c, i) => {
    if (!STOP_RE.test(c.text)) return
    const m = c.text.match(KEY_IN) || c.text.trim().match(KEY_BARE)
    let idx = null, key = ''
    if (m) { idx = [i]; key = digitOf(m[1]) }
    else for (const j of [near(i, 1), near(i, -1)]) { const k = j >= 0 && cl[j].text.trim().match(KEY_ONLY); if (k) { idx = [i, j]; key = digitOf(k[1]); break } }
    if (!idx) return
    const after = near(Math.max(...idx), 1)
    if (after >= 0 && FILLER.test(cl[after].text.trim())) idx.push(after)
    hits.push({ key, idx })
  })
  return { cl, hits }
}

// Remove every stop-call promise from a script (used when no stop-calls key is in effect).
function stripStopPromise(script) {
  const src = String(script || '').trim()
  const { cl, hits } = stopClauses(src)
  if (!hits.length) return src
  const drop = new Set(hits.flatMap(h => h.idx))
  const rank = (x) => (/[.!?]/.test(x) ? 3 : /[,;—–-]/.test(x) ? 2 : x ? 1 : 0)
  let out = '', pend = '', started = false, lastDropped = false
  cl.forEach((c, i) => {
    if (drop.has(i)) { if (started && rank(c.sep) > rank(pend)) pend = c.sep; lastDropped = true; return }
    if (!c.text.trim() && !started) return
    out += pend + c.text; pend = c.sep; started = true; if (c.text.trim()) lastDropped = false
  })
  out += /[.!?]/.test(pend) ? pend : lastDropped ? '.' : pend
  return out.replace(/(^|[.!?]\s+)(?:or|and)\s+(\w)/gi, (m, pre, ch) => pre + ch.toUpperCase()).replace(/([.!?]\s+)([a-z])/g, (m, pre, ch) => pre + ch.toUpperCase())
    .replace(/\s+([.,!?])/g, '$1').replace(/,\s*([.!?])/g, '$1').replace(/([.!?])\s*[.,]+/g, '$1').replace(/^[\s,.;]+/, '').replace(/\s{2,}/g, ' ').trim()
}

module.exports = { validate, simulate, blueprint, readiness, outbound, stripStopPromise, stopClauses, optList, LEAF, ACTIONS }
