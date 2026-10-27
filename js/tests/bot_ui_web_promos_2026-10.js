#!/usr/bin/env node
// Iteration 157 — CloudIVR-on-web entry points, web_hosta/web_cloudivr ads, web sign-up admin alert.
// Drives the REAL bot via fake webhook updates; replies read from mock Telegram API (:5099).
require('dotenv').config({ path: require('path').join(__dirname, '../../backend/.env') })
require('dotenv').config({ path: require('path').join(__dirname, '../../frontend/.env') })
const axios = require('axios')
const { MongoClient } = require('mongodb')
const WEBHOOK = 'http://localhost:5000/telegram/webhook'
const MOCK = 'http://127.0.0.1:5099'
const PUBLIC = process.env.REACT_APP_BACKEND_URL.replace(/\/+$/, '')
const ADMIN = process.env.TELEGRAM_ADMIN_CHAT_ID
const sleep = ms => new Promise(r => setTimeout(r, ms))
const RET = '990271001', NEWU = '990271002', FR = '990271003', HUB = '990271004'
const ALL = [RET, NEWU, FR, HUB, '990270001']
const COLLS = ['state', 'nameOf', 'walletOf', 'userConversion', 'chatIdOf', 'phoneNumbersOf', 'promoOptOut', 'userJoinedAt', 'trialNudge']
let uid = 8_000_000 + Math.floor(Math.random() * 100000)
const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail: ok ? '' : String(detail).slice(0, 600) }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail && !ok ? ' :: ' + String(detail).slice(0, 600) : ''}`) }
const strip = s => String(s || '').replace(/<[^>]+>/g, '')
const parse = m => { if (typeof m === 'string') { try { return JSON.parse(m) } catch { return {} } } return m || {} }
async function calls(chat, since, method) {
  const q = new URLSearchParams({ chat_id: chat, since: String(since), ...(method ? { method } : {}) })
  return (await axios.get(`${MOCK}/_calls?${q}`)).data
}
async function sendText(chat, text, wait = 2500, lang = 'en') {
  const since = Date.now(); const n = uid++
  await axios.post(WEBHOOK, { update_id: n, message: { message_id: n, date: Math.floor(Date.now() / 1000), chat: { id: Number(chat), type: 'private', first_name: 'Sim' }, from: { id: Number(chat), is_bot: false, first_name: 'Sim', username: 'sim' + chat, language_code: lang }, text } }, { timeout: 15000 })
  await sleep(wait)
  return calls(chat, since)
}
const msgs = cs => cs.filter(c => c.method === 'sendMessage')
const allText = cs => cs.map(c => c.text || '').join('\n---\n')
const kbOf = c => parse(c.reply_markup).keyboard || []
const inl = c => (parse(c.reply_markup).inline_keyboard || [])
const lastKb = cs => msgs(cs).filter(c => kbOf(c).length).slice(-1)[0]
const CIVR_LINK = '<a href="https://cloudivr.net">cloudivr.net</a>'

;(async () => {
  const mc = await MongoClient.connect(process.env.MONGO_URL)
  const db = mc.db(process.env.DB_NAME)
  const adminHad = {}
  for (const c of COLLS) adminHad[c] = !!(await db.collection(c).findOne({ _id: ADMIN }))
  const cleanup = async () => {
    for (const c of COLLS) await db.collection(c).deleteMany({ _id: { $in: ALL } })
    await db.collection('userConversion').deleteMany({ chatId: { $in: ALL } })
  }
  let webEmails = []
  try {
    await cleanup()
    for (const [id, lang] of [[RET, 'en'], [FR, 'fr'], [HUB, 'en']]) await db.collection('state').insertOne({ _id: id, userLanguage: lang, action: 'none', firstSessionIntentDone: true, firstIntentReshown: true })
    if (!adminHad.state) await db.collection('state').insertOne({ _id: ADMIN, userLanguage: 'en', action: 'none', firstSessionIntentDone: true, firstIntentReshown: true })

    // ── 1. Returning user /start ──
    let cs = await sendText(RET, '/start', 3500)
    const greet = msgs(cs).find(c => /cloudivr\.net/.test(c.text || ''))
    check('1.returning /start greeting has cloudivr link', !!greet, allText(cs))
    if (greet) {
      check('1.greeting ENDS with the Cloud IVR line', greet.text.trim().endsWith(`📞 <i>Cloud IVR on the web: ${CIVR_LINK}</i>`), greet.text.slice(-200))
      check('1.disable_web_page_preview true', String(greet.raw?.disable_web_page_preview) === 'true', JSON.stringify(greet.raw?.disable_web_page_preview))
      check('1.main menu keyboard attached (has Cloud IVR + SIP)', kbOf(greet).flat().map(b => b.text || b).includes('📞 Cloud IVR + SIP'), JSON.stringify(greet.buttons))
      check('1.main menu keyboard has hosta Use on Web row', kbOf(greet).flat().map(b => b.text || b).includes('🌐 Use on Web'), JSON.stringify(greet.buttons))
    }

    // ── 2. Brand-new user ──
    cs = await sendText(NEWU, '/start', 3500)
    check('2.new user gets language picker', cs.some(c => (c.buttons || []).includes('🇬🇧 English')), allText(cs))
    cs = await sendText(NEWU, '🇬🇧 English', 6000)
    const intent = msgs(cs).find(c => /What do you need today/.test(c.text || ''))
    check('2.first-session intent shown', !!intent, allText(cs).slice(0, 1500))
    if (intent) {
      check('2.intent has hosta.sh line', /Prefer the web\? Use <a href="https:\/\/hosta\.sh">hosta\.sh<\/a>/.test(intent.text), intent.text)
      check('2.intent has cloudivr.net line', intent.text.includes(CIVR_LINK), intent.text)
      check('2.intent no link preview', String(intent.raw?.disable_web_page_preview) === 'true', JSON.stringify(intent.raw))
    }

    // ── 3. Cloud IVR hub ──
    cs = await sendText(RET, '📞 Cloud IVR + SIP', 3500)
    let kbm = lastKb(cs)
    const rows = kbm ? kbOf(kbm).map(r => r.map(b => b.text || b)) : []
    check('3.EN hub first row = single CloudIVR web button', rows[0] && rows[0].length === 1 && rows[0][0] === '🌐 Use CloudIVR on the web', JSON.stringify(rows))
    check('3.EN hub rest unchanged (Test SIP/Buy/Bulk/Audio/MyNumbers/SIP/Usage/HowItWorks)', rows.length >= 10 && rows.flat().includes('❓ How It Works') && rows.flat().some(b => /Bulk IVR/.test(b)), JSON.stringify(rows))
    console.log('   EN hub rows:', JSON.stringify(rows))
    cs = await sendText(FR, '📞 Cloud IVR + SIP', 3500, 'fr')
    kbm = lastKb(cs)
    const frRows = kbm ? kbOf(kbm).map(r => r.map(b => b.text || b)) : []
    check('3.FR hub first row = 🌐 CloudIVR sur le web', frRows[0] && frRows[0].length === 1 && frRows[0][0] === '🌐 CloudIVR sur le web', JSON.stringify(frRows))

    // ── 4. Tap CloudIVR web button ──
    cs = await sendText(RET, '🌐 Use CloudIVR on the web', 2500)
    const inv = msgs(cs)
    check('4.exactly one reply', inv.length === 1, allText(cs))
    const iv = inv[0] || {}
    check('4.invite text mentions cloudivr.net/separate account/free sign-up', /cloudivr\.net/.test(iv.text) && /separate account/.test(iv.text) && /Sign up free/.test(iv.text), iv.text)
    const ib = inl(iv).flat()
    check('4.single inline URL button → https://cloudivr.net', ib.length === 1 && ib[0].url === 'https://cloudivr.net', JSON.stringify(ib))
    check('4.no reply keyboard replaced (no keyboard/remove_keyboard)', !parse(iv.reply_markup).keyboard && !parse(iv.reply_markup).remove_keyboard, iv.reply_markup)
    const st = await db.collection('state').findOne({ _id: RET })
    check('4.action still submenu5', st.action === 'submenu5', st.action)
    cs = await sendText(RET, '❓ How It Works', 3000)
    kbm = lastKb(cs)
    const hiw = kbm ? kbOf(kbm).map(r => r.map(b => b.text || b)) : []
    check('4.How It Works still works after invite', /How It Works/.test(allText(cs)), allText(cs).slice(0, 300))
    check('4.How It Works keyboard first row = CloudIVR web', hiw[0] && hiw[0].length === 1 && hiw[0][0] === '🌐 Use CloudIVR on the web', JSON.stringify(hiw))
    cs = await sendText(FR, '🌐 CloudIVR sur le web', 2500, 'fr')
    const fiv = msgs(cs)[0] || {}
    check('4.FR invite localized + url', /CloudIVR sur le web/.test(fiv.text) && inl(fiv).flat()[0]?.url === 'https://cloudivr.net', allText(cs))

    // ── 5. hosta Use on Web regression ──
    cs = await sendText(RET, '🌐 Use on Web', 2500)
    const hv = msgs(cs)[0] || {}
    check('5.Use on Web → inline URL https://hosta.sh', inl(hv).flat().length === 1 && inl(hv).flat()[0].url === 'https://hosta.sh' && /hosta\.sh/.test(hv.text), allText(cs))

    // ── 7. Deep links ──
    cs = await sendText(HUB, '/start open_web_cloudivr', 3000)
    let dl = msgs(cs).find(c => inl(c).flat().some(b => b.url))
    check('7.deep link open_web_cloudivr → cloudivr card', dl && inl(dl).flat()[0].url === 'https://cloudivr.net' && /CloudIVR on the web/.test(dl.text), allText(cs))
    cs = await sendText(HUB, '/start open_web_hosta', 3000)
    dl = msgs(cs).find(c => inl(c).flat().some(b => b.url))
    check('7.deep link open_web_hosta → hosta card', dl && inl(dl).flat()[0].url === 'https://hosta.sh' && /Prefer the web/.test(dl.text), allText(cs))

    // ── 6. Admin /ad ──
    cs = await sendText(ADMIN, '/ad list', 2500)
    const lst = allText(cs)
    check('6./ad list includes web_hosta + web_cloudivr', /web_hosta/.test(lst) && /web_cloudivr/.test(lst), lst)
    for (const [theme, lang, url, host] of [['web_hosta', 'en', 'https://hosta.sh', 'hosta.sh'], ['web_cloudivr', 'en', 'https://cloudivr.net', 'cloudivr.net'], ['web_hosta', 'fr', 'https://hosta.sh', 'hosta.sh'], ['web_cloudivr', 'fr', 'https://cloudivr.net', 'cloudivr.net']]) {
      cs = await sendText(ADMIN, `/ad bot ${theme} ${lang}`, 5000)
      const ph = cs.find(c => c.method === 'sendPhoto')
      const conf = allText(msgs(cs))
      check(`6./ad bot ${theme} ${lang} → sendPhoto`, !!ph, cs.map(c => c.method + ':' + strip(c.text).slice(0, 80)).join(' | '))
      if (ph) {
        const kb = inl(ph)
        console.log(`   [${theme}/${lang}] caption: ${strip(ph.text).slice(0, 260).replace(/\n/g, ' ⏎ ')}`)
        console.log(`   [${theme}/${lang}] kb: ${JSON.stringify(kb)}`)
        check(`6.${theme}/${lang} caption mentions ${host}`, (ph.text || '').includes(host), ph.text)
        check(`6.${theme}/${lang} row1 URL ${url}`, kb[0] && kb[0].length >= 1 && kb[0][0].url === url, JSON.stringify(kb))
        check(`6.${theme}/${lang} row2 promo_optout`, kb[1] && kb[1].some(b => b.callback_data === 'promo_optout'), JSON.stringify(kb))
      }
      check(`6.${theme}/${lang} confirmation says with banner`, /with banner/.test(conf), conf)
    }
    cs = await sendText(ADMIN, '/ad web_cloudivr', 3500)
    const chPost = msgs(cs).find(c => inl(c).flat().some(b => b.url))
    check('6./ad web_cloudivr channel preview URL button https://cloudivr.net', chPost && inl(chPost).flat().some(b => b.url === 'https://cloudivr.net'), allText(cs) + ' ' + JSON.stringify(chPost && inl(chPost)))
    if (chPost) console.log('   channel preview:', strip(chPost.text).slice(0, 300).replace(/\n/g, ' ⏎ '), JSON.stringify(inl(chPost)))
    check('6./ad web_cloudivr confirmation Button → https://cloudivr.net', /Button → https:\/\/cloudivr\.net/.test(allText(cs)), allText(cs))
    cs = await sendText(ADMIN, '/ad web_hosta', 3500)
    const chH = msgs(cs).find(c => inl(c).flat().some(b => b.url))
    check('6./ad web_hosta channel preview URL button https://hosta.sh', chH && inl(chH).flat().some(b => b.url === 'https://hosta.sh'), JSON.stringify(chH && inl(chH)))

    // ── 8. Web sign-up admin alert ──
    const ts = Date.now()
    const email = `qa.alert${ts}@example.com`
    webEmails.push(email)
    let since = Date.now()
    let r = await axios.post(`${PUBLIC}/api/cloudivr-web/auth/register`, { email, password: 'QaTest#2026x', name: 'QA Alert' }, { validateStatus: () => true })
    check('8.register → 201', r.status === 201, `${r.status} ${JSON.stringify(r.data)}`)
    await sleep(3000)
    let al = (await calls(ADMIN, since, 'sendMessage')).filter(c => /New CloudIVR web sign-up/.test(c.text || ''))
    check('8.exactly one admin alert', al.length === 1, JSON.stringify(al.map(c => c.text)))
    const at = al[0]?.text || ''
    console.log('   alert:', at.replace(/\n/g, ' ⏎ '))
    check('8.alert title with (preview)', at.startsWith('🆕 <b>New CloudIVR web sign-up</b> (preview)'), at)
    check('8.alert email/name/method lines', at.includes(`email: ${email}`) && at.includes('name: QA Alert') && at.includes('method: Email + password'), at)
    check('8.alert web account 16-digit id', /web account: \d{16}$/m.test(at), at)
    const accId = (at.match(/web account: (\d+)/) || [])[1]
    check('8.alert id matches register response', !accId || JSON.stringify(r.data).includes(accId), JSON.stringify(r.data))
    check('8.alert parse_mode HTML', al[0] && String(al[0].raw?.parse_mode).toUpperCase() === 'HTML', JSON.stringify(al[0]?.raw?.parse_mode))
    since = Date.now()
    r = await axios.post(`${PUBLIC}/api/cloudivr-web/auth/register`, { email, password: 'QaTest#2026x', name: 'QA Alert' }, { validateStatus: () => true })
    check('8.duplicate register → 409', r.status === 409, `${r.status}`)
    r = await axios.post(`${PUBLIC}/api/cloudivr-web/auth/login`, { email, password: 'QaTest#2026x' }, { validateStatus: () => true })
    check('8.login → 200', r.status === 200, `${r.status} ${JSON.stringify(r.data)}`)
    await sleep(3000)
    al = (await calls(ADMIN, since, 'sendMessage')).filter(c => /New CloudIVR web sign-up/.test(c.text || ''))
    check('8.no extra alert on 409/login', al.length === 0, JSON.stringify(al.map(c => c.text)))
    // HTML escaping
    const email2 = `qa.alert${ts}h@example.com`; webEmails.push(email2)
    since = Date.now()
    r = await axios.post(`${PUBLIC}/api/cloudivr-web/auth/register`, { email: email2, password: 'QaTest#2026x', name: '<b>Evil</b> & "Co"' }, { validateStatus: () => true, headers: { 'cf-ipcountry': 'DE' } })
    check('8.register html-name → 201', r.status === 201, `${r.status} ${JSON.stringify(r.data)}`)
    await sleep(3000)
    al = (await calls(ADMIN, since, 'sendMessage')).filter(c => /New CloudIVR web sign-up/.test(c.text || ''))
    const at2 = al[0]?.text || ''
    console.log('   alert2:', at2.replace(/\n/g, ' ⏎ '))
    check('8.html name escaped', at2.includes('name: &lt;b&gt;Evil&lt;/b&gt; &amp; "Co"'), at2)
  } catch (e) {
    console.error('DRIVER ERROR', e.stack || e.message)
    check('driver ran without exception', false, e.message)
  } finally {
    await cleanup()
    for (const c of COLLS) if (!adminHad[c]) await db.collection(c).deleteMany({ _id: ADMIN })
    if (webEmails.length) {
      const accs = await db.collection('webAccounts').find({ email: { $in: webEmails } }).toArray()
      console.log('   web accounts created:', accs.map(a => a._id + ' ' + a.email + ' ' + JSON.stringify(a.name)).join(', '))
      await db.collection('webAccounts').deleteMany({ email: { $in: webEmails } })
    }
    await mc.close()
    const pass = results.filter(r => r.ok).length
    console.log(`\nRESULT ${pass}/${results.length}`)
    require('fs').writeFileSync('/app/test_reports/bot_ui_web_promos_2026-10_results.json', JSON.stringify({ pass, total: results.length, results }, null, 2))
    process.exit(0)
  }
})()
