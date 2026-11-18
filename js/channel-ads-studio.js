'use strict'
// Makes a fresh visual for every channel post: live CloudIVR screens (desktop + phone) in a new layout,
// AI artwork from the owner's own OpenAI keys, or a phone-size clip recorded on the spot.
const fs = require('fs')
const os = require('os')
const path = require('path')
const crypto = require('crypto')
const { execFile } = require('child_process')
const axios = require('axios')

const SRC = path.join(__dirname, 'channel-ads-src')
const WORK = () => { const d = process.env.CHANNEL_ADS_WORK_DIR || path.join(os.tmpdir(), 'channel-ads'); fs.mkdirSync(d, { recursive: true }); return d }
const BASE = () => String(process.env.CHANNEL_ADS_CAPTURE_URL || process.env.CLOUDIVR_PUBLIC_URL || 'https://cloudivr.net').replace(/\/+$/, '')
const DEMO = () => (process.env.CHANNEL_ADS_DEMO_EMAIL && process.env.CHANNEL_ADS_DEMO_PASSWORD ? { email: process.env.CHANNEL_ADS_DEMO_EMAIL, password: process.env.CHANNEL_ADS_DEMO_PASSWORD } : null)
const DESK = { width: 1280, height: 800, deviceScaleFactor: 1.5 }
const PHONE = { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
const PHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
const wait = (ms) => new Promise(r => setTimeout(r, ms))
const pick = (a) => a[crypto.randomInt(a.length)]
const esc = (s) => String(s || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

const SCREENS = [
  { id: 'home', path: '/app', login: true, title: 'Your whole phone system at a glance', pillar: 'how' },
  { id: 'buy', path: '/app/buy', login: true, title: 'A business number in three steps', pillar: 'how' },
  { id: 'ai-campaign', path: '/app/campaigns/new?kind=ai', login: true, title: 'Tell Emily who to call — she builds the AI campaign', pillar: 'feature' },
  { id: 'ai-conversations', path: '/app/ai-agents', login: true, title: 'AI conversations with every lead', pillar: 'feature' },
  { id: 'ivr', path: '/app/answer/ivr', login: true, title: '"Press 1 for sales" menus in minutes', pillar: 'feature' },
  { id: 'quick-call', path: '/app/quick-call', login: true, title: 'Automated calls from one sentence', pillar: 'feature' },
  { id: 'live', path: '/app/live', login: true, title: 'Watch every call live', pillar: 'tip' },
  { id: 'renewals', path: '/app/renewals', login: true, title: 'Every renewal on your calendar', pillar: 'tip' },
  { id: 'sip', path: '/app/sip', login: true, title: 'Answer on any softphone or desk phone', pillar: 'tip' },
  { id: 'landing', path: '/', title: 'One business number, wherever you work', pillar: 'how' },
  { id: 'landing-ai', path: '/#ai', title: 'Set up by chatting with Emily', pillar: 'feature' },
  { id: 'pricing', path: '/#pricing', title: 'Month to month, no contract', pillar: 'tip' },
  { id: 'try-call', path: '/#try', title: 'Hear it yourself with a free test call', pillar: 'tip' },
  { id: 'for-small-business', path: '/for/small-business', title: 'Built for small businesses', pillar: 'usecase' },
  { id: 'for-sales', path: '/for/sales', title: 'Built for sales teams', pillar: 'usecase' },
  { id: 'for-teams', path: '/for/teams', title: 'One number for the whole team', pillar: 'usecase' },
  { id: 'for-nomads', path: '/for/nomads', title: 'Your local number, anywhere in the world', pillar: 'usecase' },
]

// Phone-size clips, recorded live each time (steps run after recording starts).
const CLIPS = [
  { id: 'landing-tour', title: 'CloudIVR on your phone', pillar: 'how', path: '/', steps: async (p) => { for (let i = 0; i < 7; i++) { await p.evaluate(() => window.scrollBy({ top: 520, behavior: 'smooth' })); await wait(1800) } } },
  { id: 'plan-pick', title: 'Not sure which plan? Ask Emily', pillar: 'feature', path: '/#pricing', steps: async (p) => {
    await p.evaluate(() => document.querySelector('[data-testid="pricing-plan-suggest"]')?.scrollIntoView({ block: 'center' })); await wait(1500)
    await p.type('[data-testid="pricing-plan-suggest-input"]', pick(['Dental clinic with 3 front-desk phones', 'Real estate agent, I work alone', 'Online shop with 5 support agents', 'Small law office, 2 lines']), { delay: 60 })
    await p.click('[data-testid="pricing-plan-suggest-button"]'); await wait(8000)
    await p.evaluate(() => window.scrollBy({ top: 260, behavior: 'smooth' })); await wait(2500)
  } },
  { id: 'number-search', title: 'Find a local number in seconds', pillar: 'how', path: '/app/buy', login: true, steps: async (p) => {
    const k = await p.$('[data-testid="buy-kind-calls"]'); if (k) { await k.click(); await wait(2000) }
    await p.type('[data-testid="buy-area-code-input"]', pick(['415', '212', '305', '512', '646', '718']), { delay: 220 }); await p.keyboard.press('Enter'); await wait(5000)
    await p.evaluate(() => window.scrollBy({ top: 340, behavior: 'smooth' })); await wait(2500)
  } },
  { id: 'emily-ivr', title: 'Emily writes the call for you', pillar: 'how', path: '/app/quick-call', login: true, steps: async (p) => {
    const sel = 'textarea[placeholder*="Remind"], input[placeholder*="Remind"]'
    await p.waitForSelector(sel, { timeout: 10000 }); await p.click(sel)
    await p.type(sel, 'Remind +14155550123 about her 3pm appointment, press 1 to confirm or 2 to talk to us', { delay: 35 }); await p.keyboard.press('Enter'); await wait(10000)
  } },
]

const THEMES = [
  { name: 'midnight blue', bg: '#0b1220', glow: '#3b82f6', ink: '#ffffff', soft: '#a9bbd6' },
  { name: 'deep teal', bg: '#05201c', glow: '#2dd4bf', ink: '#ecfdf5', soft: '#9fd8cb' },
  { name: 'warm amber', bg: '#1a1206', glow: '#f59e0b', ink: '#fffbeb', soft: '#e8c992' },
  { name: 'rose night', bg: '#1c0b14', glow: '#fb7185', ink: '#fff1f2', soft: '#f2abb9' },
  { name: 'paper and ink', bg: '#f4f1ea', glow: '#1d6fd8', ink: '#0f172a', soft: '#475569' },
  { name: 'sky light', bg: '#eaf3ff', glow: '#0ea5e9', ink: '#0b1220', soft: '#41536b' },
  { name: 'forest', bg: '#0c1a10', glow: '#84cc16', ink: '#f7fee7', soft: '#b5d39a' },
]
const FONTS = ['Space Grotesk', 'Manrope', 'Sora', 'Outfit', 'DM Sans', 'Plus Jakarta Sans', 'Bricolage Grotesque']

function variant(kind) {
  return { kind, layout: kind === 'screen' ? (process.env.CHANNEL_ADS_FORCE_LAYOUT || pick(['desk', 'duo'])) : kind, theme: crypto.randomInt(THEMES.length), font: pick(FONTS), tilt: crypto.randomInt(-3, 4), jx: crypto.randomInt(-50, 51), jy: crypto.randomInt(-30, 31), glow: [crypto.randomInt(0, 100), crypto.randomInt(0, 100)] }
}

// One short browser session per page (hosted browsers end long sessions), local Chrome when no endpoint is set.
async function openPage(view) {
  const puppeteer = require('puppeteer-core')
  const ws = process.env.BROWSER_WS_ENDPOINT
  const exe = process.env.CHROME_PATH || ['/root/bin/chromium', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(p => fs.existsSync(p))
  const br = ws ? await puppeteer.connect({ browserWSEndpoint: ws, protocolTimeout: 120000 }) : await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] })
  const page = await br.newPage()
  await page.setViewport(view)
  if (view.isMobile) await page.setUserAgent(PHONE_UA)
  await page.evaluateOnNewDocument(() => {
    document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); s.textContent = '[data-testid=preview-mode-banner],[data-testid^=cookie-],[data-testid=install-banner]{display:none!important}'; document.head.appendChild(s) })
  })
  const done = async () => { await page.close().catch(() => {}); ws ? await br.disconnect().catch(() => {}) : await br.close().catch(() => {}) }
  return { page, done }
}

async function go(page, p) {
  const [route, hash] = p.split('#')
  await page.goto(BASE() + route, { waitUntil: 'networkidle2', timeout: 45000 }).catch(() => {})
  await wait(3500)
  if (hash) { await page.evaluate((h) => document.getElementById(h)?.scrollIntoView({ block: 'start' }), hash); await wait(1500) }
}

async function login(page) {
  const d = DEMO()
  if (!d) throw new Error('no showcase account')
  await go(page, '/login')
  await page.type('input[type="email"]', d.email); await page.type('input[type="password"]', d.password)
  await page.keyboard.press('Enter'); await wait(5000)
  if (!/\/app/.test(page.url())) throw new Error('showcase login failed')
}

const libFile = (id, view) => path.join(SRC, `${id}-${view}.jpg`)
const fromLib = (id, view) => (fs.existsSync(libFile(id, view)) ? fs.readFileSync(libFile(id, view)) : null)

// Desktop + phone shots of one screen: live when possible, else the saved real screens.
async function shots(screen) {
  const out = { live: true }
  for (const [view, vp] of [['desktop', DESK], ['phone', PHONE]]) {
    let buf = null
    if (!screen.login || DEMO()) {
      const { page, done } = await openPage(vp)
      try {
        if (screen.login) await login(page)
        await go(page, screen.path)
        buf = await page.screenshot({ type: 'jpeg', quality: 84 })
      } catch (_) { buf = null } finally { await done() }
    }
    if (!buf) { buf = fromLib(screen.id, view); out.live = false }
    out[view] = buf
  }
  return out
}

// AI artwork with the owner's own OpenAI keys; tries each key × model, null when all fail.
async function artwork(scene, theme) {
  const keys = [...new Set([process.env.APP_OPEN_API_KEY, process.env.OPEN_API_KEY].filter(Boolean))]
  const models = [...new Set([process.env.CHANNEL_ADS_IMAGE_MODEL, 'gpt-image-1.5', 'gpt-image-1-mini'].filter(Boolean))]
  const prompt = `Premium editorial ad illustration for a cloud business phone system. Scene: ${scene}. Colour palette: ${theme.name} — ${theme.bg} background with ${theme.glow} accents. Soft cinematic lighting, modern, clean, generous calm empty space on the left third. Absolutely no text, letters, numbers, logos or user-interface screens.`
  for (const key of keys) {
    for (const model of models) {
      try {
        const r = await axios.post('https://api.openai.com/v1/images/generations', { model, prompt, n: 1, size: '1536x1024', quality: 'medium' }, { headers: { Authorization: `Bearer ${key}` }, timeout: 150000 })
        const b64 = r.data?.data?.[0]?.b64_json
        if (b64) return Buffer.from(b64, 'base64')
      } catch (_) { /* next key / model */ }
    }
  }
  return null
}

const uri = (buf, mime = 'image/jpeg') => (buf ? `data:${mime};base64,${buf.toString('base64')}` : '')

function html({ v, headline, sub, desk, phone, art, w, h, clipBox }) {
  const t = THEMES[v.theme]
  const phoneEl = (x, y, pw, ph, img) => `<div class="phone" style="left:${x}px;top:${y}px;width:${pw}px;height:${ph}px">${img ? `<img src="${uri(img)}">` : ''}<span class="notch"></span></div>`
  const deskEl = (x, y, dw, dh) => `<div class="desk" style="left:${x}px;top:${y}px;width:${dw}px;height:${dh}px;transform:rotate(${v.tilt}deg)"><div class="bar"><b></b><b></b><b></b><span>cloudivr.net</span></div><img src="${uri(desk)}"></div>`
  let body = ''
  if (v.layout === 'desk') body = `<h1 style="max-width:1320px;font-size:66px">${esc(headline)}</h1>${deskEl(170 + v.jx, 330 + v.jy, 1260, 760)}`
  if (v.layout === 'duo') body = `<h1 style="max-width:560px;font-size:60px;top:150px">${esc(headline)}</h1>${sub ? `<p class="sub" style="top:${headline.length > 28 ? 420 : 350}px">${esc(sub)}</p>` : ''}${deskEl(700 + v.jx, 120 + v.jy, 1080, 680)}${phoneEl(560 + v.jx, 300, 290, 620, phone)}`
  if (v.layout === 'art') body = `<div class="art" style="background-image:url(${uri(art, 'image/png')})"></div><h1 style="max-width:620px;font-size:62px;top:150px">${esc(headline)}</h1>${sub ? `<p class="sub" style="top:${headline.length > 28 ? 420 : 350}px;max-width:560px">${esc(sub)}</p>` : ''}${phone ? phoneEl(1210 + Math.round(v.jx / 2), 290, 280, 600, phone) : ''}`
  if (v.layout === 'clip') body = `<h1 style="left:70px;top:128px;max-width:940px;font-size:62px">${esc(headline)}</h1>${phoneEl(clipBox.x - 14, clipBox.y - 14, clipBox.w + 28, clipBox.h + 60, null)}`
  return `<!doctype html><html><head><link rel="preconnect" href="https://fonts.gstatic.com"><link href="https://fonts.googleapis.com/css2?family=${encodeURIComponent(v.font)}:wght@600;800&display=block" rel="stylesheet"><style>
*{margin:0;box-sizing:border-box}body{width:${w}px;height:${h}px;overflow:hidden;position:relative;background:${t.bg};color:${t.ink};font-family:'${v.font}',sans-serif}
.g{position:absolute;width:760px;height:760px;border-radius:50%;background:${t.glow};filter:blur(150px);opacity:.38;left:${v.glow[0]}%;top:${v.glow[1]}%;transform:translate(-50%,-50%)}
.dots{position:absolute;inset:0;background-image:radial-gradient(${t.soft}40 1.4px,transparent 1.6px);background-size:30px 30px;-webkit-mask-image:linear-gradient(135deg,#000 0%,transparent 55%)}
.brand{position:absolute;left:80px;top:62px;display:flex;align-items:center;gap:12px;font-weight:800;font-size:28px;letter-spacing:-.01em}
.brand i{width:16px;height:16px;border-radius:5px;background:${t.glow};box-shadow:0 0 24px ${t.glow}}
h1{position:absolute;left:80px;top:118px;line-height:1.04;font-weight:800;letter-spacing:-.025em;z-index:3}
.sub{position:absolute;left:80px;max-width:470px;font-size:27px;line-height:1.4;font-weight:600;color:${t.soft};z-index:3}
.url{position:absolute;right:80px;top:66px;font-size:22px;font-weight:600;color:${t.soft};z-index:3}
.desk{position:absolute;border-radius:18px;overflow:hidden;background:#0f172a;border:1px solid ${t.soft}44;box-shadow:0 50px 100px -30px rgba(0,0,0,.6);transform-origin:top left}
.desk .bar{height:34px;background:#111827;display:flex;align-items:center;gap:8px;padding:0 14px}.desk .bar b{width:11px;height:11px;border-radius:50%;background:#374151}.desk .bar span{margin-left:14px;font:500 14px sans-serif;color:#9ca3af}
.desk img{width:100%;display:block}
.phone{position:absolute;border-radius:48px;background:#050505;padding:12px;box-shadow:0 40px 90px -20px rgba(0,0,0,.7),0 0 0 2px ${t.soft}33;z-index:2}
.phone img{width:100%;height:100%;object-fit:cover;object-position:top;border-radius:37px;display:block}
.phone .notch{position:absolute;top:22px;left:50%;transform:translateX(-50%);width:96px;height:26px;border-radius:14px;background:#050505}
.art{position:absolute;top:0;right:0;width:1100px;height:100%;background-size:cover;background-position:center}
.art:after{content:'';position:absolute;inset:0;background:linear-gradient(90deg,${t.bg} 0%,${t.bg}cc 22%,transparent 60%)}
</style></head><body><div class="g"></div><div class="dots"></div><div class="brand"><i></i>CloudIVR</div>${body}<div class="url">cloudivr.net</div></body></html>`
}

async function render(doc, w, h, png) {
  const { page, done } = await openPage({ width: w, height: h, deviceScaleFactor: 1 })
  try {
    await page.setContent(doc, { waitUntil: 'networkidle0', timeout: 30000 }).catch(() => {})
    await page.evaluate(() => document.fonts.ready).catch(() => {})
    await wait(300)
    const full = await page.screenshot(png ? { type: 'png' } : { type: 'jpeg', quality: 88 })
    const thumb = await page.screenshot({ type: 'jpeg', quality: 55, clip: { x: 0, y: 0, width: w, height: h, scale: 0.25 } })
    return { full, thumb }
  } finally { await done() }
}

const ffmpeg = (args) => new Promise((ok, no) => execFile('ffmpeg', ['-y', '-loglevel', 'error', ...args], { timeout: 120000 }, (e) => (e ? no(e) : ok())))

async function recordClip(clip, v, headline) {
  const dir = WORK(), id = `${clip.id}-${Date.now()}`
  const webm = path.join(dir, `${id}.webm`), bg = path.join(dir, `${id}.png`), mp4 = path.join(dir, `${id}.mp4`)
  const { page, done } = await openPage(PHONE)
  try {
    if (clip.login) await login(page)
    await go(page, clip.path)
    const rec = await page.screencast({ path: webm })
    await clip.steps(page)
    await rec.stop()
  } finally { await done() }
  const box = { x: 300, y: 330, w: 480, h: 1040 }
  const { full, thumb } = await render(html({ v, headline, w: 1080, h: 1350, clipBox: box }), 1080, 1350, true)
  fs.writeFileSync(bg, full)
  await ffmpeg(['-loop', '1', '-i', bg, '-i', webm, '-filter_complex', `[1:v]scale=${box.w}:-2,crop=${box.w}:${box.h - 30}:0:0,fps=24[c];[0:v][c]overlay=${box.x}:${box.y}:shortest=1,format=yuv420p`, '-an', '-c:v', 'libx264', '-crf', '24', '-movflags', '+faststart', '-t', '25', mp4])
  const st = fs.statSync(mp4)
  if (st.size < 30000) throw new Error('clip too short')
  for (const f of [webm, bg]) fs.rmSync(f, { force: true })
  return { file: mp4, thumb }
}

// One finished visual for a post. kind: 'screen' | 'art' | 'clip'. Falls back to a screen image.
async function make({ kind, screen, clip, headline, sub, scene }) {
  {
    let v = variant(kind)
    if (kind === 'clip') {
      try { const c = await recordClip(clip, v, headline); return { type: 'video', ...c, v, live: true } } catch (e) { v = variant('screen'); v.fallback = `clip: ${e.message}` }
    }
    const s = await shots(screen)
    let art = null
    if (v.kind === 'art') { art = await artwork(scene || screen.title, THEMES[v.theme]); if (!art) { v = { ...variant('screen'), fallback: 'art unavailable' } } }
    if (!s.desktop && v.layout !== 'art') throw new Error(`no screen for ${screen.id}`)
    const { full, thumb } = await render(html({ v, headline, sub, desk: s.desktop, phone: s.phone, art, w: 1600, h: 1000 }), 1600, 1000)
    const file = path.join(WORK(), `${screen.id}-${Date.now()}.jpg`)
    fs.writeFileSync(file, full)
    return { type: 'photo', file, thumb, v, live: s.live }
  }
}

// Refreshes the saved real screens (desktop + phone) used when a live capture is not possible.
async function buildLibrary(ids) {
  fs.mkdirSync(SRC, { recursive: true })
  {
    const out = []
    for (const s of SCREENS.filter(x => !ids || ids.includes(x.id))) {
      for (const [view, vp] of [['desktop', DESK], ['phone', PHONE]]) {
        const { page, done } = await openPage(vp)
        try { if (s.login) await login(page); await go(page, s.path); fs.writeFileSync(libFile(s.id, view), await page.screenshot({ type: 'jpeg', quality: 80 })); out.push(`${s.id}-${view}`) } catch (e) { out.push(`${s.id}-${view} FAILED ${e.message}`) } finally { await done() }
      }
    }
    return out
  }
}

module.exports = { make, buildLibrary, SCREENS, CLIPS, THEMES, variant }
