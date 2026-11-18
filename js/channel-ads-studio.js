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

// Nomadly product screens — bot-only products (no web screenshots, use AI artwork).
const NOMADLY_SCREENS = [
  { id: 'nm-hosting', title: 'Anti-Red hosting that keeps your site online', pillar: 'feature', product: 'hosting' },
  { id: 'nm-hosting-gold', title: 'Golden hosting: captcha, geo-block, full protection', pillar: 'feature', product: 'hosting' },
  { id: 'nm-domains', title: 'Bulletproof domains with DNS and privacy', pillar: 'feature', product: 'domains' },
  { id: 'nm-vps', title: 'VPS and RDP servers in minutes', pillar: 'feature', product: 'vps' },
  { id: 'nm-leads', title: 'Targeted phone leads by area code', pillar: 'feature', product: 'leads' },
  { id: 'nm-sms', title: 'BulkSMS campaigns to US and Canada', pillar: 'feature', product: 'sms' },
  { id: 'nm-esim', title: 'USA eSIM with data, calls and texts', pillar: 'feature', product: 'esim' },
  { id: 'nm-digital', title: 'Google Workspace, Cloud accounts, SMTP', pillar: 'feature', product: 'digital' },
  { id: 'nm-shortener', title: 'URL shortener with custom domains', pillar: 'feature', product: 'shortener' },
  { id: 'nm-wallet', title: 'One wallet for everything — crypto deposits in seconds', pillar: 'tip', product: 'wallet' },
  { id: 'nm-all-in-one', title: 'Hosting, numbers, domains, SMS — one bot', pillar: 'how', product: 'platform' },
  { id: 'nm-reseller', title: 'White-label hosting for your clients', pillar: 'usecase', product: 'reseller' },
  { id: 'nm-startup', title: 'Everything a startup needs from day one', pillar: 'usecase', product: 'platform' },
  { id: 'nm-nomad', title: 'Run your business from anywhere with eSIM and cloud', pillar: 'usecase', product: 'platform' },
]

// Phone-size clips, recorded live each time (steps run after recording starts).
const CLIPS = [
  { id: 'landing-tour', title: 'CloudIVR on your phone', pillar: 'how', path: '/', steps: async (p) => { for (let i = 0; i < 7; i++) { await p.evaluate(() => window.scrollBy({ top: 520, behavior: 'smooth' })); await wait(1800) } } },
  { id: 'plan-pick', title: 'Not sure which plan? Ask Emily', pillar: 'feature', path: '/pricing', steps: async (p) => {
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

// Emily end to end: ask in plain words → she suggests the setup → the form is filled in. Stops before Save / Pay.
const tap = async (p, sel, ms = 2500) => { const el = await p.$(sel); if (el) { await el.click(); await wait(ms) } return !!el }
const into = (p, sel) => p.evaluate((s) => { const el = document.querySelector(s); if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 80, behavior: 'smooth' }) }, sel).then(() => wait(1200))
async function emily(p, prefix, ask, builder) {
  const input = `[data-testid="${prefix}-input"]`
  await tap(p, `[data-testid="${prefix}-mode-chat"]`, 800)
  await p.waitForSelector(input, { timeout: 20000 }); await into(p, `[data-testid="${prefix}"]`)
  const ready = builder ? `[data-testid^="${prefix}-msg-"][data-testid$="-changes"]` : `[data-testid="${prefix}-apply"]`
  for (const msg of [ask, 'Ring +14155550199 for anything that goes to a person, and use your best guess for the rest.', 'Yes, that looks good.']) {
    await p.click(input); await p.type(input, msg, { delay: 26 }); await p.keyboard.press('Enter'); await wait(2000)
    await p.waitForFunction((pre) => !document.querySelector(`[data-testid="${pre}-typing"]`), { timeout: 70000, polling: 500 }, prefix).catch(() => {})
    await wait(1500)
    if (await p.$(ready)) return true
  }
  throw new Error(`Emily gave no setup on ${prefix}`)
}
const apply = async (p, prefix) => { await tap(p, `[data-testid="${prefix}-apply"]`, 2500) }
const down = async (p, px) => { await p.evaluate((y) => window.scrollBy({ top: y, behavior: 'smooth' }), px); await wait(1600) }

const DEMOS = [
  { id: 'demo-ivr', title: 'Build a "Press 1 for sales" menu by chatting with Emily', login: true, path: '/app/answer/ivr', run: async (p, snap) => {
    if (!(await tap(p, '[data-testid="answer-row-0-ivr"]', 4500))) throw new Error('no number for the menu')
    await emily(p, 'ivr-assist', pick(['Greet callers for Sunrise Dental. Press 1 to book (ring +14155550199), 2 for billing (ring +14155550188), 3 to leave a voicemail', 'Welcome to Bright Homes Realty: press 1 for buying (ring +14155550199), 2 for selling (ring +14155550188), 3 to leave a voicemail', 'Press 1 for sales (ring +14155550199), 2 for support (ring +14155550188), 3 to leave a voicemail']))
    await snap('Tell Emily what callers can do')
    await apply(p, 'ivr-assist'); await down(p, 520); await snap('Emily writes the greeting and sets every key')
    await down(p, 520); await snap('Check it, save, switch it on')
  } },
  { id: 'demo-receptionist', title: 'An AI receptionist answering your calls, set up by chatting', login: true, path: '/app/receptionist/new', run: async (p, snap) => {
    await emily(p, 'ai-builder', pick(['Answer calls for Sunrise Dental, book cleanings Monday to Friday 9 to 5 and take a message after hours', 'Pick up for Bella Pizza, take orders for pickup and tell people our hours, 11am to 10pm', 'Answer for Green Leaf Plumbing, get the address and problem, and pass urgent leaks to +14155550199']), true)
    await snap('Describe your business to Emily')
    await down(p, 560); await snap('She writes the receptionist: greeting, script and FAQs')
    await down(p, 620); await snap('Hear it with a free test call, then turn it on')
  } },
  { id: 'demo-reminder', title: 'An automated reminder call from one sentence', login: true, path: '/app/quick-call', run: async (p, snap) => {
    await emily(p, 'quick-assist', pick(['Remind +14155550123 about her 3pm cleaning tomorrow, press 1 to confirm or 2 to talk to us at +14155550199', 'Call +14155550188 to confirm Friday 10am delivery, press 1 to confirm or 2 to talk to us at +14155550199', 'Remind +14155550144 that the invoice is due Monday, press 1 to talk to billing at +14155550199']))
    await snap('Say who to call and why')
    await apply(p, 'quick-assist'); await down(p, 480); await snap('Emily writes the call and sets the keys')
    await down(p, 520); await snap('Press Place call, or schedule it')
  } },
  { id: 'demo-plan-number', title: 'Pick the right plan and get a local number', login: true, path: '/app/buy', run: async (p, snap) => {
    await tap(p, '[data-testid="buy-kind-calls"]', 2500)
    await snap('Say what the number is for')
    await p.type('[data-testid="buy-area-code-input"]', pick(['415', '212', '305', '512', '646', '718']), { delay: 180 }); await p.keyboard.press('Enter'); await wait(5000)
    await down(p, 320); await snap('Pick a local number in seconds')
    await go(p, '/pricing')
    await p.evaluate(() => document.querySelector('[data-testid="pricing-plan-suggest"]')?.scrollIntoView({ block: 'center' })); await wait(1200)
    await p.type('[data-testid="pricing-plan-suggest-input"]', pick(['Dental clinic with 3 front-desk phones', 'Real estate agent, I work alone', 'Online shop with 5 support agents']), { delay: 50 })
    await p.click('[data-testid="pricing-plan-suggest-button"]'); await wait(8000)
    await snap('Not sure which plan? Emily picks it')
  } },
  { id: 'demo-ai-campaign', title: 'An AI conversation campaign to your lead list, set up by chatting', login: true, path: '/app/campaigns/new?kind=ai', run: async (p, snap) => {
    await emily(p, 'aicampaign-assist', pick(['Call my real estate leads, ask if they still plan to buy this year, and pass the interested ones to me at +14155550199', 'Call last month\'s webinar sign-ups, ask what they need, and pass the interested ones to me at +14155550199', 'Call my dental patients who are due a cleaning, offer a time this week, and pass questions to +14155550199']))
    await snap('Tell Emily who to call and why')
    await apply(p, 'aicampaign-assist'); await down(p, 520); await snap('She writes the AI agent and picks your number')
    await down(p, 560); await snap('Upload your list and start')
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
  if (/(^|\/)admin(\/|$)/.test(route)) throw new Error('admin pages are never shown')
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

// Never put the admin dashboard in a post.
const notAdmin = (page) => { if (/\/admin(\/|$|\?)/.test(new URL(page.url()).pathname)) throw new Error('admin page reached') }
const snapPage = async (page) => { notAdmin(page); return page.screenshot({ type: 'jpeg', quality: 84 }) }

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
        buf = await snapPage(page)
      } catch (_) { buf = null } finally { await done() }
    }
    if (!buf) { buf = fromLib(screen.id, view); out.live = false }
    out[view] = buf
  }
  return out
}

// AI artwork with the owner's own OpenAI keys; tries each key × model, null when all fail.
async function artwork(scene, theme, chat) {
  const keys = [...new Set([process.env.APP_OPEN_API_KEY, process.env.OPEN_API_KEY].filter(Boolean))]
  const models = [...new Set([process.env.CHANNEL_ADS_IMAGE_MODEL, 'gpt-image-1.5', 'gpt-image-1-mini'].filter(Boolean))]
  const hb = /hostbay/i.test(chat || '')
  const brandDesc = hb
    ? 'an all-in-one online business platform (hosting, domains, VPS, phone systems, SMS, digital products)'
    : 'a cloud business phone system'
  const prompt = `Premium editorial ad illustration for ${brandDesc}. Scene: ${scene}. Colour palette: ${theme.name} — ${theme.bg} background with ${theme.glow} accents. Soft cinematic lighting, modern, clean, generous calm empty space on the left third. Absolutely no text, letters, numbers, logos or user-interface screens.`
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

function html({ v, headline, sub, desk, phone, art, w, h, clipBox, chat }) {
  const t = THEMES[v.theme]
  const hb = /hostbay/i.test(chat || '')
  const brandName = hb ? 'Nomadly' : 'CloudIVR'
  const brandUrl = hb ? '@Nomadlybot' : 'cloudivr.net'
  const deskBarUrl = hb ? 'nomadly.bot' : 'cloudivr.net'
  const phoneEl = (x, y, pw, ph, img) => `<div class="phone" style="left:${x}px;top:${y}px;width:${pw}px;height:${ph}px">${img ? `<img src="${uri(img)}">` : ''}<span class="notch"></span></div>`
  const deskEl = (x, y, dw, dh) => `<div class="desk" style="left:${x}px;top:${y}px;width:${dw}px;height:${dh}px;transform:rotate(${v.tilt}deg)"><div class="bar"><b></b><b></b><b></b><span>${esc(deskBarUrl)}</span></div><img src="${uri(desk)}"></div>`
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
.step{display:inline-block;padding:10px 20px;border-radius:999px;background:${t.glow};color:#fff;font-weight:800;font-size:22px}
.desk{position:absolute;border-radius:18px;overflow:hidden;background:#0f172a;border:1px solid ${t.soft}44;box-shadow:0 50px 100px -30px rgba(0,0,0,.6);transform-origin:top left}
.desk .bar{height:34px;background:#111827;display:flex;align-items:center;gap:8px;padding:0 14px}.desk .bar b{width:11px;height:11px;border-radius:50%;background:#374151}.desk .bar span{margin-left:14px;font:500 14px sans-serif;color:#9ca3af}
.desk img{width:100%;display:block}
.phone{position:absolute;border-radius:48px;background:#050505;padding:12px;box-shadow:0 40px 90px -20px rgba(0,0,0,.7),0 0 0 2px ${t.soft}33;z-index:2}
.phone img{width:100%;height:100%;object-fit:cover;object-position:top;border-radius:37px;display:block}
.phone .notch{position:absolute;top:22px;left:50%;transform:translateX(-50%);width:96px;height:26px;border-radius:14px;background:#050505}
.art{position:absolute;top:0;right:0;width:1100px;height:100%;background-size:cover;background-position:center}
.art:after{content:'';position:absolute;inset:0;background:linear-gradient(90deg,${t.bg} 0%,${t.bg}cc 22%,transparent 60%)}
</style></head><body><div class="g"></div><div class="dots"></div><div class="brand"><i></i>${brandName}</div>${body}<div class="url">${v.step ? `<span class="step">${esc(v.step)}</span>` : esc(brandUrl)}</div></body></html>`
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

// Records a phone-size run of a clip or demo; demos that cannot run live use their saved recording.
async function liveWebm(item) {
  const webm = path.join(WORK(), `${item.id}-${Date.now()}.webm`)
  const { page, done } = await openPage(PHONE)
  try {
    if (item.login) await login(page)
    await go(page, item.path)
    const rec = await page.screencast({ path: webm })
    try { await (item.steps ? item.steps(page) : item.run(page, async () => notAdmin(page))) } finally { await rec.stop() }
  } finally { await done() }
  return webm
}

async function frameClip(webm, v, headline, speed = 1) {
  const id = `${path.basename(webm, '.webm')}-${Date.now()}`
  const bg = path.join(WORK(), `${id}.png`), mp4 = path.join(WORK(), `${id}.mp4`)
  const box = { x: 300, y: 330, w: 480, h: 1040 }
  const { full, thumb } = await render(html({ v, headline, w: 1080, h: 1350, clipBox: box }), 1080, 1350, true)
  fs.writeFileSync(bg, full)
  try {
    await ffmpeg(['-loop', '1', '-i', bg, '-i', webm, '-filter_complex', `[1:v]setpts=PTS/${speed},scale=${box.w}:-2,crop=${box.w}:${box.h - 30}:0:0,fps=24[c];[0:v][c]overlay=${box.x}:${box.y}:shortest=1,format=yuv420p`, '-an', '-c:v', 'libx264', '-crf', '24', '-movflags', '+faststart', '-t', '55', mp4])
  } finally { fs.rmSync(bg, { force: true }) }
  if (fs.statSync(mp4).size < 30000) throw new Error('clip too short')
  return { file: mp4, thumb }
}

const demoWebm = (id) => path.join(SRC, `${id}.webm`)
const demoShots = (id) => { try { return JSON.parse(fs.readFileSync(path.join(SRC, `${id}.json`), 'utf8')).map((label, i) => ({ label, buf: fs.readFileSync(path.join(SRC, `${id}-${i + 1}.jpg`)) })) } catch (_) { return null } }

async function liveStages(demo) {
  const out = []
  const { page, done } = await openPage(DESK)
  try {
    if (demo.login) await login(page)
    await go(page, demo.path)
    await demo.run(page, async (label) => out.push({ label, buf: await snapPage(page) }))
  } finally { await done() }
  if (out.length < 2) throw new Error('demo incomplete')
  return out
}

// Album of 3–4 framed steps (same look across the album, new look every post).
async function series(demo, kind, chat) {
  let stages = null, live = true
  if (DEMO()) stages = await liveStages(demo).catch(() => null)
  if (!stages) { stages = demoShots(demo.id); live = false }
  if (!stages) throw new Error(`no saved demo for ${demo.id}`)
  const v = { ...variant('screen'), kind, layout: 'desk' }
  const files = [], thumbs = []
  for (const [i, s] of stages.entries()) {
    const { full, thumb } = await render(html({ v: { ...v, step: `Step ${i + 1} of ${stages.length}` }, headline: s.label, desk: s.buf, w: 1600, h: 1000, chat }), 1600, 1000)
    const file = path.join(WORK(), `${demo.id}-${i + 1}-${Date.now()}.jpg`); fs.writeFileSync(file, full); files.push(file); thumbs.push(thumb)
  }
  return { type: 'album', files, file: null, thumb: thumbs[0], v, live }
}

// One finished visual for a post. kind: 'screen' | 'art' | 'clip'. Falls back to a screen image.
async function make({ kind, screen, clip, demo, headline, sub, scene, chat }) {
  {
    let v = variant(kind)
    if (kind === 'series') {
      try { return await series(demo, kind, chat) } catch (e) { v = { ...variant('screen'), fallback: `series: ${e.message}` } }
    }
    if (kind === 'clip' || kind === 'demo') {
      const item = kind === 'demo' ? demo : clip
      let webm = null, live = true
      try {
        if (!item.login || DEMO()) webm = await liveWebm(item).catch(() => null)
        if (!webm && kind === 'demo' && fs.existsSync(demoWebm(item.id))) { webm = demoWebm(item.id); live = false }
        if (!webm) throw new Error('no recording')
        const c = await frameClip(webm, { ...v, layout: 'clip' }, headline, kind === 'demo' ? 0.6 : 1)
        return { type: 'video', ...c, v: { ...v, layout: 'clip' }, live }
      } catch (e) { v = { ...variant('screen'), fallback: `${kind}: ${e.message}` } } finally { if (webm && live) fs.rmSync(webm, { force: true }) }
    }
    // For Nomadly-only products (no web path), force art layout
    const nomadlyForceArt = screen.product && screen.product !== 'cloudivr' && !screen.path
    if (nomadlyForceArt && v.kind !== 'art') v = { ...variant('art') }
    const s = nomadlyForceArt ? { desktop: null, phone: null, live: false } : await shots(screen)
    let art = null
    if (v.kind === 'art' || nomadlyForceArt) { art = await artwork(scene || screen.title, THEMES[v.theme], chat); if (!art && !nomadlyForceArt) { v = { ...variant('screen'), fallback: 'art unavailable' } } }
    if (!s.desktop && v.layout !== 'art') throw new Error(`no screen for ${screen.id}`)
    const { full, thumb } = await render(html({ v, headline, sub, desk: s.desktop, phone: s.phone, art, w: 1600, h: 1000, chat }), 1600, 1000)
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
        try { if (s.login) await login(page); await go(page, s.path); fs.writeFileSync(libFile(s.id, view), await snapPage(page)); out.push(`${s.id}-${view}`) } catch (e) { out.push(`${s.id}-${view} FAILED ${e.message}`) } finally { await done() }
      }
    }
    return out
  }
}

// Saves each Emily demo (desktop steps + phone recording) for when no showcase account can be used live.
async function buildDemoLibrary(ids) {
  fs.mkdirSync(SRC, { recursive: true })
  const out = []
  for (const d of DEMOS.filter(x => !ids || ids.includes(x.id))) {
    try {
      const st = await liveStages(d)
      st.forEach((s, i) => fs.writeFileSync(path.join(SRC, `${d.id}-${i + 1}.jpg`), s.buf))
      fs.writeFileSync(path.join(SRC, `${d.id}.json`), JSON.stringify(st.map(s => s.label)))
      out.push(`${d.id} steps ${st.length}`)
    } catch (e) { out.push(`${d.id} steps FAILED ${e.message}`) }
    try { const w = await liveWebm(d); fs.copyFileSync(w, demoWebm(d.id)); fs.rmSync(w, { force: true }); out.push(`${d.id} clip ${Math.round(fs.statSync(demoWebm(d.id)).size / 1024)}KB`) } catch (e) { out.push(`${d.id} clip FAILED ${e.message}`) }
  }
  return out
}

module.exports = { make, buildLibrary, buildDemoLibrary, SCREENS, NOMADLY_SCREENS, CLIPS, DEMOS, THEMES, variant }
