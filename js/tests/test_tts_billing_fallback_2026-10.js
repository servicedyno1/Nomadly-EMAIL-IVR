// TTS hardening (2026-10-16): EdenAI 401/402/403 → skip same-account fallback → direct OpenAI TTS,
// EdenAI credit monitor + throttled admin alert, friendly IVR failure copy.
// Run: node js/tests/test_tts_billing_fallback_2026-10.js  (exit 0 = pass)
const axios = require('axios')
const fs = require('fs')

process.env.EDENAI_API_KEY = 'eden-test'
process.env.APP_OPEN_API_KEY = 'sk-test'
process.env.TELEGRAM_ADMIN_CHAT_ID = '42'
delete process.env.TELNYX_API_KEY; delete process.env.TWILIO_ACCOUNT_SID; delete process.env.TWILIO_AUTH_TOKEN

let calls = []
let edenMode = '402'      // '402' | '500' | 'ok'
let openaiMode = 'ok'     // 'ok' | 'fail'
let credits = 7.59
const httpErr = (status, data) => { const e = new Error(`Request failed with status code ${status}`); e.response = { status, data }; return e }

axios.post = async (url, body) => {
  calls.push({ url, body })
  if (url.includes('edenai')) {
    if (edenMode === '402') throw httpErr(402, { 'Not enough credits': "You don't have enough credits left with your access token." })
    if (edenMode === '500') throw httpErr(500, { error: 'boom' })
    return { data: { [body.providers]: { status: 'success', audio: Buffer.from('EDEN').toString('base64') } } }
  }
  if (url.includes('api.openai.com/v1/audio/speech')) {
    if (openaiMode === 'fail') throw httpErr(429, Buffer.from('{"error":"rate"}'))
    return { data: Buffer.from('ID3-OPENAI') }
  }
  throw new Error('unexpected POST ' + url)
}
axios.get = async (url) => {
  if (url.includes('cost_management/credits')) {
    if (credits === '402') throw httpErr(402, { 'Not enough credits': 'x' })
    return { data: { credits } }
  }
  throw new Error('unexpected GET ' + url)
}

const bm = require('../balance-monitor.js')
const sent = []
bm.initBalanceMonitor({ sendMessage: async (chat, msg) => { sent.push({ chat, msg }); return {} } })
const tts = require('../tts-service.js')

let pass = 0, fail = 0
const ok = (name, cond, detail) => { if (cond) { pass++; console.log(`  ✅ ${name}`) } else { fail++; console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`) } }
const created = []
const track = (r) => { if (r?.audioPath) created.push(r.audioPath); if (r?.audioUrl) created.push(require('path').join(__dirname, '..', 'assets', 'user-audio', r.audioUrl.split('/').pop())) }
const edenCalls = () => calls.filter(c => c.url.includes('edenai'))
const oaCalls = () => calls.filter(c => c.url.includes('openai.com'))

;(async () => {
  console.log('── EdenAI 402 + ElevenLabs Rachel ──')
  calls = []; edenMode = '402'
  let r = await tts.generateTTS('Hello caller', 'rachel', null, 0.85); track(r)
  ok('EdenAI called exactly once (no retry, no same-account fallback)', edenCalls().length === 1, `got ${edenCalls().length}`)
  ok('direct OpenAI called once with mapped voice nova', oaCalls().length === 1 && oaCalls()[0].body.voice === 'nova')
  ok('speed passed to direct OpenAI', oaCalls()[0].body.speed === 0.85)
  ok('result flags fallback to openai / Nova', r.fallbackUsed === true && r.fallbackProvider === 'openai' && r.voice === 'Nova')
  ok('audio file written from OpenAI bytes', fs.readFileSync(r.audioPath).toString() === 'ID3-OPENAI')
  await new Promise(res => setTimeout(res, 20))
  ok('one admin alert with HTTP 402 + EdenAI body', sent.length === 1 && /HTTP 402/.test(sent[0].msg) && /Not enough credits/.test(sent[0].msg) && sent[0].chat === '42', JSON.stringify(sent))

  console.log('── EdenAI 402 + OpenAI Nova (same voice, alert deduped) ──')
  calls = []
  r = await tts.generateTTS('Hello caller', 'nova'); track(r)
  ok('direct OpenAI uses the same voice nova', oaCalls().length === 1 && oaCalls()[0].body.voice === 'nova')
  ok('same voice → fallbackUsed false', r.fallbackUsed === false && r.voice === 'Nova')
  await new Promise(res => setTimeout(res, 20))
  ok('second 402 within 6h does not re-alert', sent.length === 1, `sent=${sent.length}`)

  console.log('── EdenAI 500 → cross-provider then direct ──')
  calls = []; edenMode = '500'
  r = await tts.generateTTS('Hello caller', 'adam'); track(r)
  ok('EdenAI tried primary + cross-provider (2 calls)', edenCalls().length === 2, `got ${edenCalls().length}`)
  ok('then direct OpenAI with onyx for Adam', oaCalls().length === 1 && oaCalls()[0].body.voice === 'onyx')
  ok('500 does not trigger a billing alert', sent.length === 1)

  console.log('── EdenAI OK → no OpenAI direct call ──')
  calls = []; edenMode = 'ok'
  r = await tts.generateTTS('Hello caller', 'rachel'); track(r)
  ok('EdenAI success path unchanged', edenCalls().length === 1 && oaCalls().length === 0 && r.fallbackUsed === false && r.voice === 'Rachel')

  console.log('── EdenAI 402 + OpenAI down → clean error ──')
  calls = []; edenMode = '402'; openaiMode = 'fail'
  let err = null
  try { await tts.generateTTS('Hello caller', 'rachel') } catch (e) { err = e }
  ok('throws "Voice generation unavailable"', err && /Voice generation unavailable/.test(err.message), err?.message)
  openaiMode = 'ok'

  console.log('── EdenAI credit monitor ──')
  sent.length = 0; credits = 7.59
  let res = await bm.checkEdenAiBalance()
  ok('reads credits', res.provider === 'EdenAI' && Math.abs(res.balance - 7.59) < 1e-9)
  await bm.checkAllBalances()
  ok('$7.59 above EdenAI warn ($5) → no alert', sent.length === 0, sent.map(s => s.msg).join('|'))
  credits = 1.5
  await bm.checkAllBalances()
  ok('$1.50 → CRITICAL EdenAI alert with app.edenai.run link', sent.length === 1 && /CRITICAL: EdenAI/.test(sent[0].msg) && /app\.edenai\.run/.test(sent[0].msg) && /warn=\$5 \| critical=\$2/.test(sent[0].msg), sent[0]?.msg)
  credits = '402'
  res = await bm.checkEdenAiBalance()
  ok('HTTP 402 on credits endpoint → balance 0', res.balance === 0)
  sent.length = 0
  await bm.checkAllBalances()
  ok('balance 0 → EMERGENCY with EdenAI impact text', sent.length === 1 && /EMERGENCY: EdenAI/.test(sent[0].msg) && /falls back to direct OpenAI/.test(sent[0].msg), sent[0]?.msg)

  console.log('── User-facing copy ──')
  for (const l of ['en', 'fr', 'hi', 'zh']) {
    const mod = require(`../lang/${l}.js`)
    const t = (mod[l] || mod).t
    for (const key of ['cp_104', 'cp_207', 'cp_278', 'cp_308', 'cp_338']) {
      const out = t[key]('Request failed with status code 402')
      ok(`${l}.${key} hides raw error + no ElevenLabs tip`, !/402|ElevenLabs/.test(out), out)
    }
  }

  for (const f of created) { try { fs.unlinkSync(f) } catch (_) { /* ignore */ } }
  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
})().catch(e => { console.error(e); process.exit(1) })
