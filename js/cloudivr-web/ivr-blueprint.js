'use strict'
// Whole-flow IVR architect helpers for the inbound keypad menu (features.ivr).
// Pure logic, no DB — mirrors how js/voice-service.js actually runs a call so the
// blueprint, validation report and simulated test report match real call behaviour.
// Executor facts honoured here: leaf actions forward|message|sms|voicemail; one
// sub-menu level only (depth capped at 2); wrong/no key → "invalid option" once,
// then goodbye.

const LEAF = ['forward', 'message', 'sms', 'voicemail', 'webhook']
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

function actionOutcome(o, ctx) {
  switch (o.action) {
    case 'forward': return o.forwardTo ? `connects the caller to ${fmt(o.forwardTo)}` : null
    case 'message': return (hasText(o.message) || o.audioUrl) ? 'reads your message, then hangs up' : null
    case 'sms': return hasText(o.smsText) || (Array.isArray(o.smsTexts) && o.smsTexts.length) ? 'sends the caller a text, then ' + (o.after === 'menu' ? 'replays the menu' : 'hangs up') : null
    case 'voicemail': return ctx?.voicemailAvailable === false ? null : 'takes a voicemail'
    case 'webhook': return isUrl(o.url) ? 'calls your system, then ' + (o.after === 'menu' ? 'replays the menu' : 'hangs up') : null
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
    if (o.action === 'sms') {
      if (!hasText(o.smsText) && !(Array.isArray(o.smsTexts) && o.smsTexts.length)) err(k, 'Add the text this key should send.')
      if (lines && !lines.length) err(k, 'This key texts the caller, but you have no Texting Number yet — order one, or change the key.')
      else if (lines && lines.length > 1 && !lines.some(l => l.id === o.smsFrom)) err(k, `Choose which Texting Number sends it (${lines.map(l => l.phone).join(' or ')}).`)
    }
    if (o.action === 'voicemail' && ctx.voicemailAvailable === false) err(k, 'Voicemail needs the Starter plan or higher.')
    if (o.action === 'webhook' && !isUrl(o.url)) err(k, 'Add the secure https web address (webhook URL) this key should call.')
    if (o.action === 'submenu') {
      if (depth >= MAX_SUB_DEPTH) { err(k, `Sub-menus can only go ${MAX_SUB_DEPTH} levels deep — this key is too deep to work on a real call.`); return }
      const subs = subList(o)
      if (!subs.length) err(k, 'This sub-menu has no keys yet.')
      for (const so of subs) checkKey(so, `${k} → `, depth + 1)
    }
  }
  for (const o of root) checkKey(o, '', 0)

  // Greeting must mention each key, or callers won't know to press it.
  const greeting = String(ivr?.greeting || '')
  if (!greeting.trim()) {
    if (root.length) warn('greeting', 'No greeting yet — the standard "please select an option" will be used, which does not list your keys.')
  } else {
    for (const o of root) if (!new RegExp(`\\b${o.digit}\\b`).test(greeting)) warn('greeting', `The greeting doesn't mention key ${o.digit} — callers won't know to press it.`)
  }

  // A way to reach a person is almost always wanted.
  if (root.length && !root.some(o => o.action === 'forward' || o.action === 'submenu')) warn('menu', 'No key reaches a person — consider a key that forwards to you (e.g. press 0 for an operator).')

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

module.exports = { validate, simulate, blueprint, readiness, optList, LEAF, ACTIONS }
