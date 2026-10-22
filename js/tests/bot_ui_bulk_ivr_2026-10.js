#!/usr/bin/env node
// Iteration 107 — Bulk IVR Telegram UI flows driven end-to-end against the REAL bot via mock Telegram API.
// Pre-req: mock_telegram_api.js on :5099, bot started with TELEGRAM_API_BASE_URL=http://127.0.0.1:5099.
// Seeds throwaway docs (chat ids 99010700x) in local Mongo and removes them at the end. Never launches (no dialing).
require('dotenv').config({ path: require('path').join(__dirname, '../../backend/.env') })
const axios = require('axios')
const { MongoClient } = require('mongodb')
const WEBHOOK = 'http://localhost:5000/telegram/webhook'
const MOCK = 'http://127.0.0.1:5099'
const sleep = ms => new Promise(r => setTimeout(r, ms))
const OWNER = '990107001', OTHER = '990107002', FR = '990107003', ZH = '990107004', HI = '990107005', EMPTY = '990107006'
const ALL = [OWNER, OTHER, FR, ZH, HI, EMPTY]
const CALLER = '+18885550107'
let uid = 9_000_000 + Math.floor(Math.random() * 100000)
const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail && !ok ? ' :: ' + detail : ''}`) }
const strip = s => String(s || '').replace(/<[^>]+>/g, '')

async function calls(chat, since, method) {
  const q = new URLSearchParams({ chat_id: chat, since: String(since), ...(method ? { method } : {}) })
  return (await axios.get(`${MOCK}/_calls?${q}`)).data
}
async function sendText(chat, text, wait = 2500) {
  const since = Date.now()
  const n = uid++
  await axios.post(WEBHOOK, { update_id: n, message: { message_id: n, date: Math.floor(Date.now() / 1000), chat: { id: Number(chat), type: 'private', first_name: 'Sim' }, from: { id: Number(chat), is_bot: false, first_name: 'Sim', username: 'sim' + chat }, text } }, { timeout: 15000 })
  await sleep(wait)
  return calls(chat, since)
}
async function sendCb(chat, data, wait = 2500) {
  const since = Date.now()
  const n = uid++
  await axios.post(WEBHOOK, { update_id: n, callback_query: { id: String(n), from: { id: Number(chat), is_bot: false, first_name: 'Sim' }, message: { message_id: 1, date: Math.floor(Date.now() / 1000), chat: { id: Number(chat), type: 'private' } }, data } }, { timeout: 15000 })
  await sleep(wait)
  const own = await calls(chat, since)
  const acq = (await axios.get(`${MOCK}/_calls?method=answerCallbackQuery&since=${since}`)).data.filter(c => String(c.raw?.callback_query_id) === String(n))
  return [...own, ...acq]
}
const msgs = cs => cs.filter(c => c.method === 'sendMessage')
const lastMsg = cs => msgs(cs).slice(-1)[0] || {}
const allText = cs => msgs(cs).map(c => strip(c.text)).join('\n---\n')
const inlineOf = c => { let m = c.reply_markup; if (typeof m === 'string') try { m = JSON.parse(m) } catch { m = {} } return (m?.inline_keyboard || []).flat() }
const answers = cs => cs.filter(c => c.method === 'answerCallbackQuery').map(c => c.raw?.text || '')
const NAV = ['🏠 Main Menu', 'Cancel']
const btnsOf = c => (c.buttons || []).filter(b => !NAV.includes(b))
const dump = (label, cs) => { for (const c of cs) if (c.text || c.buttons?.length) console.log(`   [${label}] ${c.method}: ${strip(c.text).slice(0, 400).replace(/\n/g, ' ⏎ ')}${c.buttons?.length ? '  BTNS=' + JSON.stringify(c.buttons) : ''}`) }

function lead(i, number, status = 'pending') { return { index: i, number, name: null, status, digitPressed: null, transferred: false, transferConnected: false, duration: 0, callSid: null, startedAt: null, answeredAt: null, completedAt: null, hangupCause: null } }
function campaign(id, chatId, status, leads, extra = {}) {
  return { id, chatId, callerId: CALLER, audioUrl: 'https://example.invalid/a.mp3', audioName: 'TEST_main', mode: 'report_only', transferNumber: null, menu: null, activeKeys: ['1'], concurrency: 5, holdMusic: false, provider: 'telnyx', voicemailAudioUrl: null, voicemailAudioName: null, leads, status, stats: { total: leads.length, completed: leads.filter(l => l.status !== 'pending').length, answered: 0, keyPressed: 0, transferred: 0, noAnswer: 0, busy: 0, failed: 0, hungUp: 0, voicemail: 0, voicemailLeft: 0 }, createdAt: new Date(Date.now() - Math.random() * 1e6), ...extra }
}

;(async () => {
  const mc = await MongoClient.connect(process.env.MONGO_URL)
  const db = mc.db(process.env.DB_NAME)
  const cleanup = async () => {
    for (const c of ['state', 'walletOf', 'phoneNumbersOf', 'nameOf', 'chatIdOf', 'userConversion']) await db.collection(c).deleteMany({ _id: { $in: ALL } })
    await db.collection('ivrAudioFiles').deleteMany({ chatId: { $in: ALL } })
    await db.collection('bulkCallCampaigns').deleteMany({ chatId: { $in: ALL } })
  }
  try {
    await cleanup()
    // ── Seed ──
    for (const [id, lang] of [[OWNER, 'en'], [OTHER, 'en'], [FR, 'fr'], [ZH, 'zh'], [HI, 'hi'], [EMPTY, 'en']]) {
      await db.collection('state').insertOne({ _id: id, userLanguage: lang, action: 'none' })
      await db.collection('walletOf').insertOne({ _id: id, usdIn: 100, usdOut: 0 })
    }
    await db.collection('phoneNumbersOf').insertOne({ _id: OWNER, val: { numbers: [{ phoneNumber: CALLER, status: 'active', plan: 'pro', provider: 'telnyx', telnyxNumberId: 'TEST_none' }] } })
    const now = Date.now()
    await db.collection('ivrAudioFiles').insertMany([
      { id: 'TEST_clipA', chatId: OWNER, name: 'Promo', audioUrl: 'https://example.invalid/promoA.mp3', filename: 'TEST_a.mp3', size: 2048, createdAt: new Date(now - 3000) },
      { id: 'TEST_clipB', chatId: OWNER, name: 'Promo', audioUrl: 'https://example.invalid/promoB.mp3', filename: 'TEST_b.mp3', size: 2048, createdAt: new Date(now - 2000) },
      { id: 'TEST_clipC', chatId: OWNER, name: 'VM Msg', audioUrl: 'https://example.invalid/vm.mp3', filename: 'TEST_c.mp3', size: 2048, createdAt: new Date(now - 1000) },
    ])
    const C = { run: 'TEST_c_run', pause: 'TEST_c_pause', done: 'TEST_c_done', cxl: 'TEST_c_cxl', pause2: 'TEST_c_pause2' }
    await db.collection('bulkCallCampaigns').insertMany([
      campaign(C.run, OWNER, 'running', [lead(0, '+12125550001'), lead(1, '+12125550002'), lead(2, '+12125550003')], { startedAt: new Date() }),
      campaign(C.pause, OWNER, 'paused', [lead(0, '+12125550004', 'completed'), lead(1, '+12125550005')], { startedAt: new Date(), pausedReason: 'wallet' }),
      campaign(C.done, OWNER, 'completed', [lead(0, '+12125550006', 'completed')], { startedAt: new Date(), completedAt: new Date() }),
      campaign(C.cxl, OWNER, 'cancelled', [lead(0, '+12125550007', 'completed')], { startedAt: new Date(), completedAt: new Date() }),
      campaign(C.pause2, OWNER, 'paused', [lead(0, '+12125550008', 'completed'), lead(1, '+12125550009'), lead(2, '+12125550010')], { startedAt: new Date(), pausedReason: 'user' }),
    ])
    const get = id => db.collection('bulkCallCampaigns').findOne({ id })

    // ── 1. Submenu shows My Campaigns next to Bulk IVR (all langs) ──
    const expected = { [OWNER]: '📋 My Campaigns', [FR]: '📋 Mes Campagnes', [ZH]: '📋 我的活动', [HI]: '📋 मेरे अभियान' }
    for (const chat of [OWNER, FR, ZH, HI]) {
      const cs = await sendText(chat, '📞☁️ Cloud IVR — Speechcue', 3500)
      const withKb = msgs(cs).filter(c => c.reply_markup).slice(-1)[0] || {}
      let kb = withKb.reply_markup; if (typeof kb === 'string') kb = JSON.parse(kb)
      const row = (kb?.keyboard || []).find(r => r.map(b => b.text || b).includes(expected[chat]))
      check(`1.submenu[${chat}] has '${expected[chat]}' in same row as Bulk IVR`, row && row.length === 2, JSON.stringify(withKb.buttons))
      if (chat !== OWNER) {
        const l = await sendText(chat, expected[chat])
        check(`1.myCampaigns[${chat}] localized tap → empty list`, /No Bulk IVR campaigns yet/.test(allText(l)), allText(l))
      }
    }
    // ── 2. My Campaigns list (owner) ──
    let cs = await sendText(OWNER, '📋 My Campaigns')
    dump('list', cs)
    const listMsg = lastMsg(cs)
    const btns = inlineOf(listMsg)
    check('2.list shows 5 campaigns with one bulk_view button each', btns.length === 5 && btns.every(b => /^bulk_view:TEST_c_/.test(b.callback_data)), JSON.stringify(btns))
    check('2.list text has statuses', /RUNNING/.test(strip(listMsg.text)) && /PAUSED/.test(strip(listMsg.text)) && /COMPLETED/.test(strip(listMsg.text)) && /CANCELLED/.test(strip(listMsg.text)))
    await sendText(EMPTY, '📞☁️ Cloud IVR — Speechcue', 3000)
    cs = await sendText(EMPTY, '📋 My Campaigns')
    check('2.empty state', /No Bulk IVR campaigns yet\./.test(allText(cs)), allText(cs))

    // ── 3. Callbacks ──
    const ctrl = c => inlineOf(c).map(b => b.callback_data.split(':')[0])
    cs = await sendCb(OWNER, `bulk_view:${C.run}`); dump('view run', cs)
    check('3.view running → Pause+Cancel', ctrl(lastMsg(cs)).includes('bulk_pause') && ctrl(lastMsg(cs)).includes('bulk_cancel') && !ctrl(lastMsg(cs)).includes('bulk_resume'), JSON.stringify(ctrl(lastMsg(cs))))
    cs = await sendCb(OWNER, `bulk_view:${C.pause}`)
    check('3.view paused → Resume+Cancel', ctrl(lastMsg(cs)).includes('bulk_resume') && ctrl(lastMsg(cs)).includes('bulk_cancel') && !ctrl(lastMsg(cs)).includes('bulk_pause'), JSON.stringify(ctrl(lastMsg(cs))))
    cs = await sendCb(OWNER, `bulk_view:${C.done}`)
    check('3.view completed → no buttons', msgs(cs).length === 1 && inlineOf(lastMsg(cs)).length === 0, JSON.stringify(lastMsg(cs).reply_markup))
    // foreign chat
    for (const verb of ['bulk_view', 'bulk_pause', 'bulk_resume', 'bulk_cancel', 'bulk_cancelyes']) {
      const target = verb === 'bulk_resume' ? C.pause : C.run
      cs = await sendCb(OTHER, `${verb}:${target}`, 1500)
      check(`3.foreign ${verb} → 'Campaign not found.' + no message`, answers(cs).includes('Campaign not found.') && msgs(cs).length === 0, JSON.stringify(answers(cs)))
    }
    check('3.foreign: running still running', (await get(C.run)).status === 'running')
    check('3.foreign: paused still paused', (await get(C.pause)).status === 'paused')
    // pause running
    cs = await sendCb(OWNER, `bulk_pause:${C.run}`); dump('pause', cs)
    check('3.pause → status paused + card Resume+Cancel', (await get(C.run)).status === 'paused' && /Campaign paused/.test(allText(cs)) && ctrl(lastMsg(cs)).includes('bulk_resume'), allText(cs))
    // pause again (not running)
    cs = await sendCb(OWNER, `bulk_pause:${C.run}`)
    check('3.pause on paused → "not running" warning', /not running/i.test(allText(cs)), allText(cs))
    // resume low wallet
    await db.collection('walletOf').updateOne({ _id: OWNER }, { $set: { usdIn: 0.05, usdOut: 0 } })
    cs = await sendCb(OWNER, `bulk_resume:${C.pause}`); dump('resume low', cs)
    check('3.resume low wallet → top-up text, stays paused', /too low/.test(allText(cs)) && /Top up/.test(allText(cs)) && (await get(C.pause)).status === 'paused' && answers(cs).includes('Could not resume'), allText(cs))
    await db.collection('walletOf').updateOne({ _id: OWNER }, { $set: { usdIn: 100, usdOut: 0 } })
    // cancel prompt on paused
    cs = await sendCb(OWNER, `bulk_cancel:${C.pause2}`); dump('cancel prompt', cs)
    const cb = inlineOf(lastMsg(cs))
    check('3.cancel prompt buttons', cb.some(b => b.text === '✅ Yes, cancel campaign' && b.callback_data === `bulk_cancelyes:${C.pause2}`) && cb.some(b => b.text === '↩️ Keep it' && b.callback_data === `bulk_view:${C.pause2}`), JSON.stringify(cb))
    check('3.cancel prompt counts 2 pending', /2 leads not dialed/.test(strip(lastMsg(cs).text)), strip(lastMsg(cs).text))
    check('3.cancel prompt does not change status', (await get(C.pause2)).status === 'paused')
    // cancel on finished
    for (const id of [C.done, C.cxl]) {
      cs = await sendCb(OWNER, `bulk_cancel:${id}`)
      check(`3.cancel on ${id} → already finished`, /This campaign has already finished/.test(allText(cs)) && !inlineOf(lastMsg(cs)).length, allText(cs))
    }
    // cancelyes
    cs = await sendCb(OWNER, `bulk_cancelyes:${C.pause2}`, 3500); dump('cancelyes', cs)
    const p2 = await get(C.pause2)
    check('3.cancelyes → cancelled, pending notCalled', p2.status === 'cancelled' && p2.leads.filter(l => l.index > 0).every(l => l.notCalled) && !p2.leads[0].notCalled)
    check('3.cancelyes reply "Campaign cancelled" (2 not dialed)', /Campaign cancelled\./.test(allText(cs)) && /2 leads were not dialed/.test(allText(cs)) && answers(cs).includes('Campaign cancelled'), allText(cs))
    check('3.cancelyes final report sent exactly once, lists not-dialed', msgs(cs).filter(c => /Campaign Complete|Campaign Report|📊/.test(strip(c.text)) && /Total Calls/.test(strip(c.text))).length === 1 && /Not dialed \(campaign cancelled\): 2/.test(allText(cs)), allText(cs))
    check('3.cancelyes final report sent once (no reportPending left)', !p2.reportPending)
    cs = await sendCb(OWNER, `bulk_cancelyes:${C.pause2}`)
    check('3.cancelyes twice → error card', /already finished or cancelled/.test(allText(cs)), allText(cs))
    // cancel the paused (ex-running) campaign too so nothing is left running/paused
    await sendCb(OWNER, `bulk_cancelyes:${C.run}`, 2500)
    await sendCb(OWNER, `bulk_cancelyes:${C.pause}`, 2500)

    // ── 4. Setup flow (Telnyx) ──
    await sendText(OWNER, '📞☁️ Cloud IVR — Speechcue', 3000)
    cs = await sendText(OWNER, '📞 Bulk IVR Campaign', 3000); dump('bulk entry', cs)
    cs = await sendText(OWNER, `${CALLER} ☎️`); dump('caller', cs)
    cs = await sendText(OWNER, '+12125551234\n+12125551235\n+447911123456\n+5352345678', 3000); dump('leads', cs)
    let st0
    const leadsTxt = allText(cs)
    check('4.leads upload shows intl line', /1 international lead/.test(leadsTxt), leadsTxt)
    check('4.leads upload shows blocked line', /🚫 1 blocked number \(satellite\/premium-rate\) will be skipped — not charged/.test(leadsTxt), leadsTxt)
    check('4.main-audio list dedupes duplicate names', JSON.stringify(btnsOf(lastMsg(cs)).slice(0, 3)) === JSON.stringify(['🎵 VM Msg', '🎵 Promo', '🎵 Promo #2']), JSON.stringify(lastMsg(cs).buttons))
    await sendText(OWNER, '🎵 Promo #2')
    st0 = await db.collection('state').findOne({ _id: OWNER })
    check('4.main-audio #2 picks the 2nd Promo (clipA)', st0.bulkData?.audioUrl === 'https://example.invalid/promoA.mp3', st0.bulkData?.audioUrl)
    await sendText(OWNER, '↩️ Back')
    cs = await sendText(OWNER, '🎵 VM Msg'); dump('audio', cs)
    cs = await sendText(OWNER, '📊 Report Only'); dump('mode', cs)
    cs = await sendText(OWNER, '1 only'); dump('keys', cs)
    cs = await sendText(OWNER, '5'); dump('concurrency', cs)
    const vm = lastMsg(cs)
    check('4.voicemail step buttons', JSON.stringify(btnsOf(vm)) === JSON.stringify(['📵 Hang up (no message)', '🎵 VM Msg', '🎵 Promo', '🎵 Promo #2', '↩️ Back']), JSON.stringify(vm.buttons))
    cs = await sendText(OWNER, '↩️ Back'); dump('vm back', cs)
    check('4.vm Back → concurrency', JSON.stringify(btnsOf(lastMsg(cs))) === JSON.stringify(['5', '10', '15', '20', '↩️ Back']), JSON.stringify(lastMsg(cs).buttons))
    cs = await sendText(OWNER, '5')
    cs = await sendText(OWNER, '🎵 VM Msg'); dump('preview clip', cs)
    const prev = strip(lastMsg(cs).text)
    check('4.preview voicemail clip', /📭 Voicemail: Leave "VM Msg" after the beep/.test(prev), prev)
    check('4.preview split counts', /Leads: 4 \(max \d+\) — 2 US\/CA · 1 international/.test(prev), prev)
    check('4.preview rate line', /\$0\.15\/min US\/CA · \$0\.50\/min international \(1 lead\)/.test(prev), prev)
    check('4.preview blocked line', /🚫 1 blocked number/.test(prev), prev)
    check('4.preview estimate $0.80', /Estimated cost: \$0\.80/.test(prev), prev)
    check('4.preview buttons', JSON.stringify(btnsOf(lastMsg(cs))) === JSON.stringify(['🚀 Launch Campaign', '⏰ Schedule for later', '↩️ Back']))
    cs = await sendText(OWNER, '↩️ Back')
    check('4.preview Back → voicemail step', /📭 Voicemail/.test(strip(lastMsg(cs).text)) && (lastMsg(cs).buttons || []).includes('🎵 Promo #2'), strip(lastMsg(cs).text))
    cs = await sendText(OWNER, '📵 Hang up (no message)')
    check('4.preview hang up', /📭 Voicemail: Hang up/.test(strip(lastMsg(cs).text)), strip(lastMsg(cs).text))
    let st = await db.collection('state').findOne({ _id: OWNER })
    check('4.state hangup → voicemailAudioUrl null', st.bulkData && st.bulkData.voicemailAudioUrl === null)
    await sendText(OWNER, '↩️ Back')
    cs = await sendText(OWNER, '🎵 Promo #2')
    st = await db.collection('state').findOne({ _id: OWNER })
    check('4.#2 duplicate stores THAT clip url', st.bulkData?.voicemailAudioUrl === 'https://example.invalid/promoA.mp3' || st.bulkData?.voicemailAudioUrl === 'https://example.invalid/promoB.mp3', st.bulkData?.voicemailAudioUrl)
    // listAudios sorts by createdAt desc → order: VM Msg, Promo(B, newer), Promo #2 (A, older)
    check('4.#2 maps to the 2nd listed Promo (clipA, older)', st.bulkData?.voicemailAudioUrl === 'https://example.invalid/promoA.mp3', st.bulkData?.voicemailAudioUrl)
    check('4.preview #2 shows name Promo', /Leave "Promo" after the beep/.test(strip(lastMsg(cs).text)), strip(lastMsg(cs).text))
    cs = await sendText(OWNER, '🎵 Nonexistent')
    check('4.unknown text at preview → no launch', !(await db.collection('bulkCallCampaigns').findOne({ chatId: OWNER, status: { $in: ['created', 'running', 'scheduled'] } })))
    // schedule
    cs = await sendText(OWNER, '⏰ Schedule for later'); dump('sched', cs)
    cs = await sendText(OWNER, '⏰ In 24 hours'); dump('sched24', cs)
    const sched = await db.collection('bulkCallCampaigns').findOne({ chatId: OWNER, status: 'scheduled' })
    check('4.scheduled doc created', !!sched && /Campaign scheduled/.test(allText(cs)), allText(cs))
    check('4.scheduled stores voicemail fields', sched && sched.voicemailAudioUrl === 'https://example.invalid/promoA.mp3' && sched.voicemailAudioName === 'Promo' && sched.provider === 'telnyx', JSON.stringify(sched && { u: sched.voicemailAudioUrl, n: sched.voicemailAudioName, p: sched.provider }))
    check('4.scheduled stores 4 leads (blocked kept, skipped at dial)', sched && sched.leads.length === 4, sched && sched.leads.length)
    cs = await sendText(OWNER, '❌ Cancel scheduled launch')
    check('4.cancel scheduled launch', /Scheduled campaign cancelled/.test(allText(cs)) && (await get(sched.id)).status === 'cancelled', allText(cs))

    // ── 5. Optional: Twilio bulkData skips voicemail step ──
    await db.collection('state').updateOne({ _id: OWNER }, { $set: { action: 'bulkSetConcurrency', bulkData: { callerId: CALLER, provider: 'twilio', twilioSubAccountSid: 'ACtest', leads: [{ number: '+12125551234' }], audioUrl: 'https://example.invalid/x.mp3', audioName: 'X', mode: 'report_only', activeKeys: ['1'] } } })
    cs = await sendText(OWNER, '10')
    const tw = strip(lastMsg(cs).text)
    check('5.twilio skips voicemail step → preview', /Campaign Preview/.test(tw) && !/📭 Voicemail/.test(tw), tw)
    cs = await sendText(OWNER, '↩️ Back')
    check('5.twilio preview Back → concurrency', JSON.stringify(btnsOf(lastMsg(cs))) === JSON.stringify(['5', '10', '15', '20', '↩️ Back']), JSON.stringify(lastMsg(cs).buttons))
    // US-only preview (no intl split)
    await db.collection('state').updateOne({ _id: OWNER }, { $set: { action: 'bulkSetConcurrency', bulkData: { callerId: CALLER, provider: 'telnyx', leads: [{ number: '+12125551234' }, { number: '+14165551234' }], audioUrl: 'https://example.invalid/x.mp3', audioName: 'X', mode: 'report_only', activeKeys: ['1'] } } })
    await sendText(OWNER, '10')
    cs = await sendText(OWNER, '📵 Hang up (no message)')
    const us = strip(lastMsg(cs).text)
    check('5.US/CA-only preview: no intl split, flat rate, $0.30', !/international/.test(us) && /Rate: \$0\.15\/min per call/.test(us) && /Estimated cost: \$0\.30/.test(us), us)
  } catch (e) {
    console.error('DRIVER ERROR', e.stack || e.message)
    check('driver ran without exception', false, e.message)
  } finally {
    await cleanup()
    await mc.close()
    const pass = results.filter(r => r.ok).length
    console.log(`\nRESULT ${pass}/${results.length}`)
    require('fs').writeFileSync('/app/test_reports/bot_ui_bulk_ivr_2026-10_results.json', JSON.stringify({ pass, total: results.length, results }, null, 2))
    process.exit(0)
  }
})()
