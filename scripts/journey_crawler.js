#!/usr/bin/env node
// End-to-end menu crawler against the LOCAL sandbox bot. Drives /telegram/webhook with fake
// Telegram updates (text presses AND inline callback_queries), reads the dev-only `[tg-out]`
// trace emitted by js/tg-opts.js (covers every bot.sendMessage / editMessageText / sendPhoto
// call, not just send()), and walks menus depth-first — replaying each path from /start so
// state is deterministic. Reports:
//   NO_REPLY      bot sent nothing
//   STRANDED      no reply keyboard on screen, no inline buttons, and not a free-text prompt
//   UNRECOGNIZED  a menu button fell through to the "[reset] Unrecognized message" handler
//   AI_FALLBACK   a menu button was answered by AI support instead of a handler
//   INVALID_OPT   bot answered a menu tap with a "valid option / plan" error
//   KB_LOST       same screen seen earlier WITH a keyboard, now without
//   JS_ERROR      TypeError/ReferenceError/… logged while the step ran
//   NO_PROGRESS   pressing a button re-rendered the exact same screen (button not recognised)
//   PROMPT_NO_KB  (low) free-text prompt shown with the keyboard removed — no Back/Cancel escape
// Usage: node scripts/journey_crawler.js <chatId> [maxDepth=3] [langBtn='🇬🇧 English']
//   env: SIM_WEBHOOK_URL, CRAWL_QUIET_MS (700), CRAWL_FIRST_MS (3500), CRAWL_MAX_MS (12000)
const fs = require('fs')
const { makeSim, inlineOf, strip, sleep } = require('./lib/tg_sim')
const chatId = String(process.argv[2] || '')
const MAX_DEPTH = Number(process.argv[3] || 3)
const LANG_BTN = process.argv[4] || '🇬🇧 English'
if (!chatId) { console.error('usage: journey_crawler.js <chatId> [maxDepth] [langBtn]'); process.exit(1) }

// Buttons that move money / fire external side effects / change global user prefs — never pressed.
const SKIP_RE = /deposit|dépôt|déposer|crypto|\bpay\b|payer|paiement|confirm|launch|lancer|delete|supprimer|remove|retirer|terminate|résilier|cancel plan|renew|renouveler|withdraw|retrait|transfer|transf[ée]rer|buy now|checkout|activate|activer|release|libérer|reset|réinitialiser|free call|appel gratuit|testsip|claim|réclamer|submit|soumettre|publish|publier|unsubscribe|subscribe|abonner|\byes\b|\boui\b|rotate|clear|effacer|logout|déconnexion|download|télécharger|airtime|topup|top up|recharger|naira|₦|bank|💵|₿|Ł|₮|🪙|usdt|bitcoin|litecoin|ethereum|solana|bnb|tron|doge|monero|xmr|\bton\b|request|demander|whitelist|approve|approuver|reject|rejeter|ban\b|refresh|actualiser|english|french|chinese|hindi|anglais|français|chinois|中文|हिंदी|🇬🇧|🇫🇷|🇨🇳|🇮🇳|start fresh|recommencer|重新开始|नए सिरे/i
const NAV_RE = /^(↩️ |🏠 |🔙 |⬅️ )?(back|cancel|main menu|done|retour|annuler|menu principal|取消|返回|主菜单|रद्द करें|वापस|मुख्य मेनू|\/done|\/start|\/cancel)$/i
const FREE_TEXT_RE = /enter|type|send (me|us|the|your|a |an )|paste|share|provide|write|reply with|what('s| is) (your|the)|how many|amount|describe|upload|forward|choose a name|entrez|saisissez|tapez|envoyez|collez|partagez|indiquez|écrivez|répondez|combien|montant|décrivez|téléversez|\?\s*$/i
const INVALID_RE = /valid (option|plan|choice|selection)|choose a valid|invalid (option|choice|selection)|option (in)?valide|choix (in)?valide|sélection (in)?valide/i
const RESUME_RE = /complete my order|terminer ma commande|完成我的订单|मेरा ऑर्डर पूरा/i
const DISMISS_RE = /start fresh|recommencer|重新开始|नए सिरे/i
const ONBOARD_RE = /just looking|je regarde|只是看看|随便看看|बस देख/i

const sim = makeSim(chatId)
const okBtn = t => !NAV_RE.test(t) && !SKIP_RE.test(t)
const issues = []
const seenScreens = new Map()
const expanded = new Set()
let steps = 0
let onboardBtns = null

async function gotoMain(screen) {
  let r = await sim.say(screen, '/start')
  if (screen.kb.some(b => /english|french|chinese|hindi|anglais|français/i.test(b))) {
    const offset = fs.statSync(require('./lib/tg_sim').LOG).size
    await sim.say(screen, LANG_BTN)
    await sleep(2500) // first-run onboarding sends its menu on a delayed timer
    r = sim.parseOut(sim.readFrom(offset)); sim.applyScreen(screen, r.msgs)
  }
  if (screen.kb.some(b => ONBOARD_RE.test(b))) { // first-run quick-pick → remember it, dismiss via "Just looking" to reach the real main menu
    if (!onboardBtns) onboardBtns = screen.kb.filter(b => !ONBOARD_RE.test(b))
    r = await sim.say(screen, screen.kb.find(b => ONBOARD_RE.test(b)))
    if (screen.kb.length < 8) r = await sim.say(screen, '/start')
  }
  if (screen.kb.some(b => RESUME_RE.test(b))) { // "Welcome back — resume?" prompt → dismiss so every path starts from the main menu
    const dismiss = screen.kb.find(b => DISMISS_RE.test(b))
    if (dismiss) await sim.say(screen, dismiss)
    r = await sim.say(screen, '/start')
  }
  return r
}

function evaluate(label, res, screen) {
  const { msgs, errors, unrecognized, ai } = res
  if (!msgs.length) { issues.push({ type: 'NO_REPLY', path: label }); return { hasKb: false, last: null } }
  const last = msgs[msgs.length - 1]
  const text = strip(last.text)
  const inline = inlineOf(msgs)
  const hasKb = screen.kb.length > 0 || inline.length > 0
  const isPrompt = screen.force || msgs.some(m => FREE_TEXT_RE.test(strip(m.text)))
  const key = text.slice(0, 60)
  if (unrecognized) issues.push({ type: 'UNRECOGNIZED', path: label, text })
  if (ai) issues.push({ type: 'AI_FALLBACK', path: label, text })
  if (INVALID_RE.test(text)) issues.push({ type: 'INVALID_OPT', path: label, text })
  if (!hasKb && !isPrompt) issues.push({ type: 'STRANDED', path: label, text })
  if (!hasKb && isPrompt) issues.push({ type: 'PROMPT_NO_KB', sev: 'low', path: label, text })
  if (seenScreens.has(key) && seenScreens.get(key) && !hasKb) issues.push({ type: 'KB_LOST', path: label, text })
  if (!seenScreens.has(key)) seenScreens.set(key, hasKb)
  for (const e of errors) issues.push({ type: 'JS_ERROR', path: label, text: e })
  return { hasKb, last, text, inline }
}

function show(label, ev, screen) {
  console.log(`[${steps}] ${label}\n     ↳ ${(ev.text || '(no reply)').replace(/\n/g, ' ⏎ ').slice(0, 130)}\n     ⌨ ${screen.kb.slice(0, 14).join(' | ')}${ev.inline?.length ? `  [inline: ${ev.inline.slice(0, 8).map(b => b.t).join(' | ')}]` : ''}`)
}

async function crawl(path, depth, parent) {
  const screen = { kb: [], force: false }
  let res = await gotoMain(screen)
  for (const st of path) { res = await sim.step(st); sim.applyScreen(screen, res.msgs) }
  const label = path.map(s => s.label).join(' → ') || '(main)'
  steps++
  const ev = evaluate(label, res, screen)
  if (parent && ev.text && ev.text === parent.text && screen.kb.join('|') === parent.kb) issues.push({ type: 'NO_PROGRESS', path: label, text: ev.text })
  show(label, ev, screen)
  if (depth >= MAX_DEPTH || !ev.last) return
  const screenKey = ev.text.slice(0, 80) + '|' + screen.kb.join(',')
  if (expanded.has(screenKey)) return
  expanded.add(screenKey)
  const children = [
    ...screen.kb.filter(okBtn).map(t => ({ kind: 'text', v: t, label: t })),
    ...(ev.inline || []).filter(b => okBtn(b.t)).map(b => ({ kind: 'cb', data: b.d, label: `[${b.t}]` })),
  ]
  for (const c of children) {
    if (path.some(p => p.label === c.label)) continue
    await crawl([...path, c], depth + 1, { text: ev.text, kb: screen.kb.join('|') })
  }
}

;(async () => {
  const t0 = Date.now()
  await crawl([], 0)
  for (const b of onboardBtns || []) { // first-run quick-pick buttons (shown once per user) — one level each
    const screen = { kb: [], force: false }
    await gotoMain(screen)
    const res = await sim.say(screen, b); steps++
    show(`(onboarding) ${b}`, evaluate(`(onboarding) ${b}`, res, screen), screen)
  }
  const high = issues.filter(i => i.sev !== 'low')
  console.log(`\n══ Crawled ${steps} screens in ${((Date.now() - t0) / 1000).toFixed(0)}s — ${high.length} issue(s), ${issues.length - high.length} low`)
  for (const i of issues) console.log(`  • ${i.type}${i.sev ? ` (${i.sev})` : ''}: ${i.path}${i.text ? `\n      "${i.text.replace(/\n/g, ' ⏎ ').slice(0, 160)}"` : ''}`)
  const out = `/app/test_reports/journey_crawl_${chatId}.json`
  fs.writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), chatId, lang: LANG_BTN, maxDepth: MAX_DEPTH, steps, issues }, null, 2))
  console.log(`report → ${out}`)
  process.exit(high.length ? 1 : 0)
})().catch(e => { console.error('CRAWL ERR', e.message); process.exit(2) })
