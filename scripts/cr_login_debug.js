/* global process */
// Debug: why does the ConnectReseller panel login fail? Dumps URL, visible alerts, form fields.
// Usage (on droplet): cd /opt/nomadly/app-main && set -a && . backend/.env && set +a && node /tmp/cr_login_debug.js
const puppeteer = require('puppeteer-core')

async function main() {
  const email = process.env.CR_PANEL_EMAIL || ''
  const password = process.env.CR_PANEL_PASSWORD || ''
  const ws = process.env.BROWSER_WS_ENDPOINT
  console.log('email set:', !!email, 'len', email.length, '| pass len', password.length, '| ws:', !!ws)
  const browser = await puppeteer.connect({ browserWSEndpoint: ws })
  const page = await browser.newPage()
  await page.setViewport({ width: 1366, height: 900 })
  page.on('response', r => {
    const u = r.url()
    if (/login|auth|token|signin/i.test(u) && !/\.(js|css|png|svg|woff)/.test(u)) console.log('RESP', r.status(), u.slice(0, 140))
  })
  await page.goto('https://global.connectreseller.com', { waitUntil: 'networkidle2', timeout: 45000 })
  await new Promise(r => setTimeout(r, 2500))
  console.log('landing url:', page.url())
  const inputs = await page.$$eval('input', els => els.map(e => ({ type: e.type, name: e.name, fcn: e.getAttribute('formcontrolname'), ph: e.placeholder })))
  console.log('inputs:', JSON.stringify(inputs))
  const hasCaptcha = await page.evaluate(() => !!document.querySelector('iframe[src*="recaptcha"], iframe[src*="hcaptcha"], .g-recaptcha, [class*="captcha"]'))
  console.log('captcha present:', hasCaptcha)
  const emailField = await page.$('input[type="text"], input[type="email"]')
  const passField = await page.$('input[type="password"]')
  if (emailField) { await emailField.click({ clickCount: 3 }); await emailField.type(email, { delay: 15 }) }
  if (passField) { await passField.click({ clickCount: 3 }); await passField.type(password, { delay: 15 }) }
  const btns = await page.$$eval('button', els => els.map(b => b.textContent.trim()).filter(Boolean))
  console.log('buttons:', JSON.stringify(btns))
  const signIn = await page.evaluateHandle(() => [...document.querySelectorAll('button')].find(b => /sign in|login/i.test(b.textContent)))
  if (signIn && (await signIn.asElement())) await signIn.click(); else await page.keyboard.press('Enter')
  await new Promise(r => setTimeout(r, 10000))
  console.log('post-login url:', page.url())
  const alerts = await page.evaluate(() => [...document.querySelectorAll('[class*="alert"], [class*="error"], [class*="toast"], [class*="invalid"], mat-error, .text-danger, [role="alert"]')].map(e => e.textContent.trim()).filter(Boolean).slice(0, 10))
  console.log('alerts:', JSON.stringify(alerts))
  const body = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').slice(0, 900))
  console.log('body:', body)
  await page.screenshot({ path: '/tmp/cr_login_debug.png' })
  await browser.close()
}
main().catch(e => { console.error('ERR', e.message); process.exit(1) })
