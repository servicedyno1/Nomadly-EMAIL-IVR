// Captures real CloudIVR app screens (preview, demo account) for the landing page product tabs.
//   node scripts/capture_landing_shots.js <baseUrl> <outDir> [name ...]
// Seed first: node scripts/seed_civr_live_demo.js
const puppeteer = require('puppeteer-core')
const [base, out = '/tmp/shots', ...only] = process.argv.slice(2)
const NUM = process.env.SHOT_NUMBER || ''
// name: [path, scrollY]
const PAGES = {
  overview: ['/app', 0],
  ivr: [`/app/numbers/${encodeURIComponent(NUM)}?tab=ivr`, 0],
  campaigns: ['/app/campaigns/seed-live-running', 0],
  live: ['/app/live', 0],
  map: ['/app/live', 322],
}

// Marketing clean-up: no preview banners/badges, no chat bubble, demo-safe 555 numbers and email.
function tidy() {
  document.querySelectorAll('[data-testid="preview-mode-banner"],[data-testid="support-chat-toggle"],[data-testid="cookie-banner"],[data-testid="dashboard-channel-card"],[data-testid="dashboard-coupon-banner"],[data-testid="dashboard-trial-card"]').forEach(e => e.remove())
  document.querySelectorAll('.civr-pill-warn').forEach(e => { if (/^preview$/i.test(e.textContent.trim())) e.remove() })
  const map = window.__civrMap || (window.__civrMap = new Map())
  const fake = (m) => { if (/^\+1\d{3}555/.test(m)) return m; if (!map.has(m)) map.set(m, `+1415555${String(182 + map.size * 7).padStart(4, '0')}`); return map.get(m) }
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  for (let n = w.nextNode(); n; n = w.nextNode()) {
    const t = n.nodeValue.replace(/\+1\d{10}/g, fake).replace(/civr\.alice@example\.com/g, 'maya@northwind.co').replace(/\bAlice( Tester)?\b/g, 'Maya').replace(/ — demo\b/g, '')
    if (t !== n.nodeValue) n.nodeValue = t
  }
  const ta = document.querySelector('[data-testid="number-tabpanel-ivr"] textarea')
  if (ta) ta.value = 'Thanks for calling Northwind Dental. Press 1 to book an appointment, 2 for billing, or 3 to leave us a message.'
  document.querySelectorAll('input[placeholder^="Label"]').forEach((e, i) => { e.value = ['Appointments', 'Billing', 'Voicemail', 'Front desk'][i] || '' })
}

;(async () => {
  const browser = await puppeteer.launch({ executablePath: '/root/bin/chromium', args: ['--no-sandbox', '--disable-dev-shm-usage'] })
  const page = await browser.newPage()
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1.5 })
  await page.goto(`${base}/cloudivr/login`, { waitUntil: 'networkidle2' })
  await page.waitForSelector('[data-testid="cookie-deny"]', { timeout: 8000 }).then(() => page.click('[data-testid="cookie-deny"]')).catch(() => {})
  await page.waitForSelector('[data-testid="auth-email-input"]')
  await new Promise(r => setTimeout(r, 800))
  await page.type('[data-testid="auth-email-input"]', 'civr.alice@example.com')
  await page.type('input[type="password"]', 'AliceTest#2026')
  await page.click('[data-testid="auth-submit-button"]')
  await page.waitForFunction(() => location.pathname.includes('/app'), { timeout: 15000 })
  for (const [name, [path, y]] of Object.entries(PAGES)) {
    if (only.length && !only.includes(name)) continue
    await page.goto(`${base}/cloudivr${path}`, { waitUntil: 'networkidle2' })
    await new Promise(r => setTimeout(r, 3000))
    await page.evaluate(tidy)
    if (y) await page.evaluate((v) => { (document.querySelector('main') || document.scrollingElement).scrollTo(0, v); window.scrollTo(0, v) }, y)
    await new Promise(r => setTimeout(r, 300))
    await page.screenshot({ path: `${out}/${name}.webp`, type: 'webp', quality: 82 })
    console.log('saved', name)
  }
  await browser.close()
})().catch(e => { console.error(e); process.exit(1) })
