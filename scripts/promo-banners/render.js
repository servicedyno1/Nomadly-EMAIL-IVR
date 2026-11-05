// Renders the web-app promo banners (real hosta.sh + CloudIVR logos) → js/assets/promo/nomadly/<theme>.jpg
//   node scripts/promo-banners/render.js
const path = require('path')
const puppeteer = require('puppeteer-core')

const OUT = path.join(__dirname, '../../js/assets/promo/nomadly')
const BANNERS = [['hosta.html', 'web_hosta.jpg'], ['cloudivr.html', 'web_cloudivr.jpg']]
// Link-preview card for cloudivr.net (Telegram / WhatsApp / X) → frontend/public/civr/brand/og-share.jpg
const SHARE = ['cloudivr-share.html', path.join(__dirname, '../../frontend/public/civr/brand/og-share.jpg'), 1200, 630]

;(async () => {
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/chromium', args: ['--no-sandbox', '--allow-file-access-from-files'] })
  const page = await browser.newPage()
  await page.setViewport({ width: 1280, height: 860, deviceScaleFactor: 1 })
  for (const [html, out] of BANNERS) {
    await page.goto(`file://${path.join(__dirname, html)}`, { waitUntil: 'networkidle0' })
    await page.evaluate(() => document.fonts.ready)
    await page.screenshot({ path: path.join(OUT, out), type: 'jpeg', quality: 90 })
    console.log(`wrote ${out}`)
  }
  const [shareHtml, shareOut, w, hgt] = SHARE
  await page.setViewport({ width: w, height: hgt, deviceScaleFactor: 1 })
  await page.goto(`file://${path.join(__dirname, shareHtml)}`, { waitUntil: 'networkidle0' })
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path: shareOut, type: 'jpeg', quality: 86 })
  console.log(`wrote ${path.basename(shareOut)}`)
  await browser.close()
})().catch((e) => { console.error(e); process.exit(1) })
