// Sandbox harness — AI agent call recordings + Google Calendar booking. SANDBOX MONGO ONLY.
//   P3_SANDBOX_MONGO=mongodb://127.0.0.1:27999 node js/tests/test_ai_booking_recording_2026-10.js
// Real recorder (ffmpeg), booking slot logic, gcal OAuth/token code, bridge tool flow and calls.finish billing.
// Google HTTP, OpenAI and Telegram are stubbed — nothing leaves the box.
const URL = process.env.P3_SANDBOX_MONGO || 'mongodb://127.0.0.1:27999'
if (!/^mongodb:\/\/(127\.0\.0\.1|localhost):27999(\/|$)/.test(URL)) { console.error('REFUSING: not the sandbox Mongo'); process.exit(2) }
process.env.MONGO_URL = URL
process.env.DB_NAME = 'p5_ai_booking_rec_sandbox'
process.env.APP_OPEN_API_KEY = 'sk-test-stub'
process.env.SESSION_SECRET = 'sandbox-session-secret-0123456789'
delete process.env.GOOGLE_OAUTH_CLIENT_ID; delete process.env.GOOGLE_OAUTH_CLIENT_SECRET
delete process.env.AI_RECORDING_RATE_PER_MIN; delete process.env.AI_AGENT_RATE_PER_MIN
process.env.SELF_URL = 'https://sandbox.invalid/api'; delete process.env.SELF_URL_PROD

const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')
const { MongoClient } = require('mongodb')
const { DateTime } = require('luxon')
const recorder = require('../ai-agent/recorder')
const booking = require('../ai-agent/booking')
const gcal = require('../ai-agent/gcal')
const store = require('../ai-agent/store')
const { Bridge, opening, instructions, tools } = require('../ai-agent/bridge')
const calls = require('../ai-agent/calls')
const audioLib = require('../audio-library-service')

const results = []
const ok = (id, name, pass, detail) => results.push({ id, name, pass: !!pass, detail })
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const tone = (ms, byte) => Buffer.alloc(ms * 8, byte)
const b64 = (b) => b.toString('base64')
const near = (a, b, tol) => Math.abs(a - b) <= tol

// ── stub Google HTTP ──
let gReq = []
let gPlan = {}
const httpStub = {
  async post(url, body, opts) {
    gReq.push({ m: 'POST', url, body, auth: opts?.headers?.Authorization })
    const h = gPlan[url.split('?')[0]] || gPlan[Object.keys(gPlan).find(k => url.startsWith(k))]
    if (!h) throw Object.assign(new Error('unplanned ' + url), { response: { status: 500, data: {} } })
    return { data: await h(body, opts) }
  },
  async get(url, opts) {
    gReq.push({ m: 'GET', url, auth: opts?.headers?.Authorization })
    const h = gPlan[url.split('?')[0]]
    if (!h) throw Object.assign(new Error('unplanned ' + url), { response: { status: 500, data: {} } })
    return { data: await h(null, opts) }
  },
}
const gFail = (status, data) => { throw Object.assign(new Error(`HTTP ${status}`), { response: { status, data } }) }

;(async () => {
  const client = new MongoClient(URL); await client.connect()
  const db = client.db(process.env.DB_NAME); await db.dropDatabase()

  // ═════════════ A. Recorder ═════════════
  {
    const r = new recorder.Recorder()
    for (let i = 0; i < 25; i++) r.addCaller(b64(tone(20, 0xff))) // 0.5 s caller (μ-law 0xff = silence)
    r.addAgent(b64(tone(1000, 0x80))) // 1 s agent, queued at 0.5 s
    for (let i = 0; i < 75; i++) r.addCaller(b64(tone(20, 0xff))) // caller up to 2.0 s
    ok('A1', 'agent chunk placed at the caller clock (0.5 s)', r.agent[0].at === 4000, r.agent[0].at)
    ok('A2', 'timeline = 2 s of samples', r.samples === 16000 && r.seconds === 2, r.samples)
    const pcm = r.mix()
    const at = (s) => pcm.readInt16LE(s * 2)
    ok('A3', 'mix: agent audio inside its window, silence outside', at(4000 + 10) === recorder.ULAW[0x80] + recorder.ULAW[0xff] && at(100) === recorder.ULAW[0xff] && at(15000) === recorder.ULAW[0xff], [at(4010), at(100), at(15000)])
    // barge-in: agent queued 3 s ahead, caller at 2 s → cut back to 2 s
    r.addAgent(b64(tone(3000, 0x80)))
    ok('A4', 'second agent chunk queued after the first (1.5 s → 2 s cursor)', r.agent[1].at === 16000, r.agent[1].at)
    r.cut()
    ok('A5', 'cut() drops unplayed agent audio (barge-in)', r.agentEnd === 16000 && r.agent.length === 1, { end: r.agentEnd, n: r.agent.length })
    const mp3 = await r.toMp3()
    const isMp3 = mp3 && (mp3.slice(0, 3).toString() === 'ID3' || (mp3[0] === 0xff && (mp3[1] & 0xe0) === 0xe0))
    const tmp = path.join('/tmp', `rec_test_${Date.now()}.mp3`); fs.writeFileSync(tmp, mp3)
    const dur = parseFloat(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', tmp]).toString())
    const rate = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=sample_rate', '-of', 'csv=p=0', tmp]).toString().trim()
    fs.unlinkSync(tmp)
    ok('A6', 'MP3 encoded, ~2 s long, 16 kHz (plays in every browser)', isMp3 && near(dur, 2, 0.2) && rate === '16000', { bytes: mp3?.length, dur, rate })
    const tiny = new recorder.Recorder(); tiny.addCaller(b64(tone(500, 0xff)))
    ok('A7', 'under 1 s of audio → no recording', (await tiny.toMp3()) === null)
    const big = new recorder.Recorder(); big.callerLen = 16 * 60 * 8000; big.addCaller(b64(tone(20, 0xff)))
    ok('A8', 'caps each track at 16 minutes', big.caller.length === 0)
  }

  // ═════════════ B. Slot logic ═════════════
  const B = booking.cleanBooking({ enabled: true, days: [1, 2, 3, 4, 5], start: '09:00', end: '12:00', slotMinutes: 30, timeZone: 'America/New_York' })
  {
    const mon = '2026-11-02' // Monday
    const now = DateTime.fromISO('2026-10-30T12:00:00', { zone: 'America/New_York' })
    const busy = [{ start: '2026-11-02T15:00:00Z', end: '2026-11-02T16:00:00Z' }] // 10:00–11:00 EST
    const s = booking.freeSlots({ date: mon, booking: B, busy, now }).map(t => t.toFormat('HH:mm'))
    ok('B1', 'busy 10:00–11:00 removes two 30-min slots', JSON.stringify(s) === JSON.stringify(['09:00', '09:30', '11:00', '11:30']), s)
    ok('B2', 'weekend day → no slots', booking.freeSlots({ date: '2026-11-01', booking: B, now }).length === 0)
    const sameDay = DateTime.fromISO('2026-11-02T09:10:00', { zone: 'America/New_York' })
    const s2 = booking.freeSlots({ date: mon, booking: B, now: sameDay }).map(t => t.toFormat('HH:mm'))
    ok('B3', `nothing sooner than ${booking.LEAD_MINUTES} min from now`, s2[0] === '10:00', s2)
    const s45 = booking.freeSlots({ date: mon, booking: { ...B, slotMinutes: 45 }, now }).map(t => t.toFormat('HH:mm'))
    ok('B4', '45-min slots fit inside the hours', JSON.stringify(s45) === JSON.stringify(['09:00', '09:45', '10:30', '11:15']), s45)
    let e1 = null; try { booking.cleanBooking({ enabled: true, start: '12:00', end: '09:00' }) } catch (e) { e1 = e.message }
    let e2 = null; try { booking.cleanBooking({ enabled: true, days: [] }) } catch (e) { e2 = e.message }
    const d = booking.cleanBooking({ timeZone: 'Mars/Base', slotMinutes: 7, days: [9, 3, 3] })
    ok('B5', 'validation: end after start, at least one day, bad zone/length → defaults', !!e1 && !!e2 && d.timeZone === 'America/New_York' && d.slotMinutes === 30 && JSON.stringify(d.days) === '[3]', { e1, e2, d })
    const old = store.publicAgent({ id: 'x', name: 'Old' })
    ok('B6', 'agents saved before this change: recording ON, booking OFF', old.record === true && old.booking.enabled === false)
  }

  // ═════════════ C. Booking tools (stub calendar) ═════════════
  {
    const events = []
    let busyList = []
    const cal = {
      async busy() { return busyList },
      async createEvent(chatId, calendarId, ev) { events.push({ chatId, calendarId, ev }); return { id: 'evt-1', link: 'https://calendar.google.com/event?eid=1' } },
    }
    const agent = { id: 'ag1', name: 'Ava', businessName: 'Sunrise Dental', language: 'en' }
    const now = () => DateTime.fromISO('2026-10-30T12:00:00', { zone: 'America/New_York' })
    const ctx = booking.createContext({ chatId: '5000000000000001', agent, booking: B, callerNumber: '+14155550100', now, cal })
    const r = await ctx.check({ date: '2026-11-02' })
    ok('C1', 'check_availability: free slots with exact ISO start + spoken time', r.ok && r.slots.length === 6 && r.slots[0].start === '2026-11-02T09:00:00-05:00' && /9:00/.test(r.slots[0].time) && r.timeZone === 'America/New_York', r.slots?.[0])
    ok('C2', 'caller in another zone (415 = Pacific) gets callerTime', /6:00/.test(r.slots[0].callerTime || '') && /PST|Pacific/.test(r.slots[0].callerTime || ''), r.slots[0].callerTime)
    busyList = [{ start: '2026-11-02T14:00:00Z', end: '2026-11-02T17:00:00Z' }] // Monday 9–12 EST all busy
    const full = await ctx.check({ date: '2026-11-02' })
    ok('C3', 'full day → nextAvailable (Tuesday)', full.ok && full.slots.length === 0 && full.nextAvailable?.date === '2026-11-03' && full.nextAvailable.slots.length > 0, full.nextAvailable)
    const past = await ctx.check({ date: '2026-10-01' })
    const bad = await ctx.check({ date: 'next tuesday' })
    ok('C4', 'past date / bad format → ok:false with a reason', past.ok === false && /passed/.test(past.error) && bad.ok === false, [past.error, bad.error])
    busyList = []
    const noName = await ctx.book({ start: '2026-11-02T09:00:00-05:00' })
    ok('C5', 'book without a name → asks for the name first', noName.ok === false && /name/.test(noName.error) && events.length === 0)
    const bk = await ctx.book({ start: '2026-11-02T10:30:00-05:00', name: 'Jane Doe', note: 'cleaning' })
    const ev = events[0]?.ev
    ok('C6', 'book_appointment creates the event (zone, 30 min, summary, caller phone)', bk.ok && ev && ev.start.dateTime === '2026-11-02T10:30:00-05:00' && ev.end.dateTime === '2026-11-02T11:00:00-05:00' && ev.start.timeZone === 'America/New_York' && ev.summary === 'Sunrise Dental: Jane Doe' && /\+14155550100/.test(ev.description), ev)
    ok('C7', 'booking saved with eventId + link, reply tells the agent to confirm', bk.booking.eventId === 'evt-1' && !!bk.booking.link && /Repeat/.test(bk.reply.next) && bk.booking.phone === '+14155550100', bk.booking)
    const local = await ctx.book({ start: '2026-11-02T11:00:00', name: 'Joe' })
    ok('C8', 'start without an offset is read as business time', local.ok && events[1].ev.start.dateTime === '2026-11-02T11:00:00-05:00', events[1]?.ev.start)
    busyList = [{ start: '2026-11-02T16:30:00Z', end: '2026-11-02T17:00:00Z' }] // 11:30 taken
    const taken = await ctx.book({ start: '2026-11-02T11:30:00-05:00', name: 'Late' })
    ok('C9', 'time taken meanwhile → ok:false + other free times, no event', taken.ok === false && taken.slots.length > 0 && events.length === 2, taken)
    const offGrid = await ctx.book({ start: '2026-11-02T09:10:00-05:00', name: 'Odd' })
    ok('C10', 'a time that is not a slot start is refused', offGrid.ok === false && events.length === 2)
    const again = await ctx.book({ start: '2026-11-02T09:00:00-05:00', name: 'Second' }, bk.booking)
    ok('C11', 'one appointment per call', again.ok === false && /already booked/.test(again.error) && events.length === 2)
  }

  // ═════════════ D. Google OAuth + tokens (stub HTTP) ═════════════
  {
    gcal.init(db); gcal.setHttp(httpStub)
    ok('D1', 'not configured without client id/secret', gcal.configured() === false && (await gcal.status('1')).configured === false)
    let threw = null; try { await gcal.startConnect('1', { redirectUri: 'https://x/cb' }) } catch (e) { threw = e.code }
    ok('D2', 'connect refused when not configured', threw === 'not_configured')
    process.env.GOOGLE_OAUTH_CLIENT_ID = 'cid.apps.googleusercontent.com'; process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'csecret'
    const chatId = '5000000000000001'
    const url = new globalThis.URL(await gcal.startConnect(chatId, { redirectUri: 'https://pod.example/api/cloudivr-web/calendar/google/callback', returnTo: '/cloudivr/app/ai-agents/ag1' }))
    const q = url.searchParams, state = q.get('state')
    ok('D3', 'auth URL: offline + consent + calendar scope + state', url.host === 'accounts.google.com' && q.get('access_type') === 'offline' && q.get('prompt') === 'consent' && q.get('scope').includes('https://www.googleapis.com/auth/calendar') && q.get('scope').includes('email') && state?.length >= 30 && q.get('redirect_uri').endsWith('/calendar/google/callback'), q.toString().slice(0, 200))
    gPlan = {
      'https://oauth2.googleapis.com/token': (body) => {
        const p = new URLSearchParams(body)
        if (p.get('grant_type') === 'authorization_code') return { access_token: 'at-1', expires_in: 3600, refresh_token: 'rt-SECRET-1', scope: 'openid https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/calendar', token_type: 'Bearer' }
        if (p.get('refresh_token') === 'rt-SECRET-1') return { access_token: 'at-2', expires_in: 3600 }
        return gFail(400, { error: 'invalid_grant' })
      },
      'https://www.googleapis.com/oauth2/v2/userinfo': () => ({ email: 'owner@gmail.com' }),
    }
    const fin = await gcal.finishConnect({ state, code: 'auth-code' })
    const link = await db.collection('aiCalendarLinks').findOne({ chatId })
    const exch = new URLSearchParams(gReq.find(r => r.url.includes('/token')).body)
    ok('D4', 'callback: code exchanged with the SAME redirect_uri, link saved', fin.ok && fin.email === 'owner@gmail.com' && fin.returnTo === '/cloudivr/app/ai-agents/ag1' && exch.get('redirect_uri') === 'https://pod.example/api/cloudivr-web/calendar/google/callback' && link?.status === 'ok', fin)
    ok('D5', 'refresh token encrypted at rest (no plaintext in Mongo), decrypts back', !JSON.stringify(link).includes('rt-SECRET-1') && gcal.unseal(link.refreshToken) === 'rt-SECRET-1')
    const st = await gcal.status(chatId)
    ok('D6', 'status for the browser never carries tokens', st.connected && st.email === 'owner@gmail.com' && !JSON.stringify(st).includes('rt-') && !('refreshToken' in st))
    const replay = await gcal.finishConnect({ state, code: 'auth-code' })
    ok('D7', 'state is single-use (replay → expired)', replay.ok === false && replay.error === 'expired')
    const s2 = new globalThis.URL(await gcal.startConnect('5000000000000002', { redirectUri: 'https://x/cb' })).searchParams.get('state')
    gPlan['https://oauth2.googleapis.com/token'] = () => ({ access_token: 'at-x', expires_in: 3600, refresh_token: 'rt-x', scope: 'openid email' })
    const noCal = await gcal.finishConnect({ state: s2, code: 'c' })
    ok('D8', 'calendar permission unticked on Google → error "scope", nothing saved', noCal.ok === false && noCal.error === 'scope' && !(await db.collection('aiCalendarLinks').findOne({ chatId: '5000000000000002' })))
    const s3 = new globalThis.URL(await gcal.startConnect(chatId, { redirectUri: 'https://x/cb' })).searchParams.get('state')
    const denied = await gcal.finishConnect({ state: s3, error: 'access_denied' })
    ok('D9', 'owner cancels on Google → denied', denied.ok === false && denied.error === 'denied')
    // refresh + API calls
    gPlan['https://oauth2.googleapis.com/token'] = (body) => (new URLSearchParams(body).get('refresh_token') === 'rt-SECRET-1' ? { access_token: 'at-2', expires_in: 3600 } : gFail(400, { error: 'invalid_grant' }))
    gPlan['https://www.googleapis.com/calendar/v3/freeBusy'] = (body) => ({ calendars: { [body.items[0].id]: { busy: [{ start: '2026-11-02T15:00:00Z', end: '2026-11-02T16:00:00Z' }] } } })
    gPlan['https://www.googleapis.com/calendar/v3/users/me/calendarList'] = () => ({ items: [{ id: 'primary@x', summary: 'Owner', primary: true, timeZone: 'America/New_York' }, { id: 'dental@group', summary: 'Dental', summaryOverride: 'Chairs' }] })
    gPlan['https://www.googleapis.com/calendar/v3/calendars/'] = (body) => ({ id: 'evt-9', htmlLink: 'https://calendar.google.com/e/9', ...body })
    gcal._tokenCache.clear(); gReq = []
    const busy = await gcal.busy(chatId, 'primary', '2026-11-02T00:00:00Z', '2026-11-03T00:00:00Z')
    const refresh = gReq.find(r => r.url.includes('/token')), fb = gReq.find(r => r.url.includes('freeBusy'))
    ok('D10', 'expired access token is refreshed, then freeBusy called with it', busy.length === 1 && new URLSearchParams(refresh.body).get('grant_type') === 'refresh_token' && fb.auth === 'Bearer at-2', { busy, auth: fb?.auth })
    const list = await gcal.listCalendars(chatId)
    ok('D11', 'calendar list (writer access) with names', list.length === 2 && list[1].name === 'Chairs' && gReq.some(r => r.url.includes('minAccessRole=writer')), list)
    const ev = await gcal.createEvent(chatId, 'dental@group', { summary: 'x' })
    ok('D12', 'events.insert on the chosen calendar', ev.id === 'evt-9' && gReq.some(r => r.url.endsWith('/calendars/dental%40group/events')), ev)
    // revoked access
    await db.collection('aiCalendarLinks').updateOne({ chatId }, { $set: { refreshToken: gcal.seal('rt-REVOKED') } })
    gcal._tokenCache.clear()
    let code = null; try { await gcal.busy(chatId, 'primary', 'a', 'b') } catch (e) { code = e.code }
    ok('D13', 'Google says invalid_grant → link marked revoked, booking off for calls', code === 'revoked' && (await gcal.status(chatId)).status === 'revoked' && (await gcal.isConnected(chatId)) === false)
    // forCall gates
    const agentOn = { id: 'ag1', name: 'Ava', language: 'en', booking: { ...B, enabled: true } }
    ok('D14', 'forCall → null when the calendar is not connected', (await booking.forCall(chatId, agentOn, '+1')) === null)
    await db.collection('aiCalendarLinks').updateOne({ chatId }, { $set: { status: 'ok', refreshToken: gcal.seal('rt-SECRET-1') } })
    const fc = await booking.forCall(chatId, agentOn, '+14155550100')
    ok('D15', 'forCall → context when connected + enabled; null when booking off', !!fc && typeof fc.check === 'function' && (await booking.forCall(chatId, { ...agentOn, booking: { ...B, enabled: false } }, '+1')) === null)
    gReq = []; gPlan['https://oauth2.googleapis.com/revoke'] = () => ({})
    const dis = await gcal.disconnect(chatId)
    ok('D16', 'disconnect revokes at Google and deletes the link', dis && gReq.some(r => r.url.includes('/revoke')) && !(await db.collection('aiCalendarLinks').findOne({ chatId })))
  }

  // ═════════════ E. Bridge: opening, tools, async tool flow, recording hooks ═════════════
  {
    const agent = { id: 'ag1', name: 'Ava', businessName: 'Sunrise Dental', language: 'en', goal: 'Book cleanings.', voice: 'marin', maxMinutes: 5, takeMessages: true }
    ok('E1', 'opening adds "this call may be recorded" only when recording', /may be recorded/.test(opening(agent, 'inbound', true)) && !/recorded/.test(opening(agent, 'inbound', false)) && /peut être enregistré/.test(opening({ ...agent, language: 'fr' }, 'outbound', true)))
    const fakeCal = { timeZone: 'America/New_York', minutes: 30, today: () => 'Friday, October 30, 2026 (2026-10-30)', hours: () => 'Mon, Tue 09:00–12:00', check: async () => { await sleep(60); return { ok: true, slots: [{ start: '2026-11-02T09:00:00-05:00', time: '9:00 AM' }] } }, book: async (args, already) => (already ? { ok: false, error: 'already' } : { ok: true, booking: { start: args.start, day: 'Monday, November 2', time: '9:00 AM', eventId: 'e1', link: 'l', name: args.name, phone: args.phone }, reply: { ok: true, booked: true } }) }
    const names = (ctx) => tools(agent, ctx).map(t => t.name)
    ok('E2', 'booking tools only when a calendar is connected', names({ calendar: fakeCal }).includes('check_availability') && names({ calendar: fakeCal }).includes('book_appointment') && !names({}).includes('check_availability'))
    const ins = instructions(agent, { direction: 'inbound', calendar: fakeCal })
    ok('E3', 'instructions: booking rules + today + business zone', /Booking appointments/.test(ins) && /Friday, October 30, 2026/.test(ins) && /America\/New_York/.test(ins) && !/Booking appointments/.test(instructions(agent, { direction: 'inbound' })))

    const mk = (ctx) => {
      const sent = [], phone = []
      const b = new Bridge({ agent, ctx: { direction: 'inbound', callerNumber: '+14155550100', ...ctx }, media: { readyState: 1, send: (m) => phone.push(JSON.parse(m)) }, actions: { hangup() {}, transfer() {} }, log: () => {} })
      b.ai = { readyState: 1, send: (m) => sent.push(JSON.parse(m)), close() {} }
      return { b, sent, phone }
    }
    // 1) agent called check_availability without speaking → filler (out-of-band), result answered after the filler finishes
    const { b, sent } = mk({ calendar: fakeCal, record: true })
    b.onAi({ type: 'response.created' })
    b.onAi({ type: 'response.done', response: { status: 'completed', output: [{ type: 'function_call', name: 'check_availability', call_id: 'c1', arguments: '{"date":"2026-11-02"}' }] } })
    const filler = sent.find(m => m.type === 'response.create')
    ok('E4', 'silent tool call → out-of-band filler line ("One moment while I check")', filler && filler.response.conversation === 'none' && /One moment/.test(filler.response.instructions) && filler.response.tool_choice === 'none', filler?.response)
    b.onAi({ type: 'response.created' }) // filler starts
    await sleep(120) // calendar answered meanwhile
    const outIdx = sent.findIndex(m => m.type === 'conversation.item.create' && m.item.call_id === 'c1')
    const out = outIdx >= 0 ? JSON.parse(sent[outIdx].item.output) : null
    const createsBefore = sent.filter(m => m.type === 'response.create').length
    ok('E5', 'function_call_output carries the free slots; next response waits for the filler', out?.ok && out.slots[0].start === '2026-11-02T09:00:00-05:00' && createsBefore === 1, { out, createsBefore })
    b.onAi({ type: 'response.done', response: { status: 'completed', output: [{ type: 'message' }] } }) // filler done
    const creates = sent.filter(m => m.type === 'response.create')
    ok('E6', 'after the filler ends the agent answers with the result', creates.length === 2 && !creates[1].response && sent.lastIndexOf(creates[1]) > outIdx)

    // 2) agent spoke ("let me book that") + book_appointment → no filler, booking stored, outcome booked
    const m2 = mk({ calendar: fakeCal, record: true })
    m2.b.onAi({ type: 'response.created' })
    m2.b.onAi({ type: 'response.done', response: { status: 'completed', output: [{ type: 'message' }, { type: 'function_call', name: 'book_appointment', call_id: 'c2', arguments: '{"start":"2026-11-02T09:00:00-05:00","name":"Jane"}' }] } })
    await sleep(20)
    const c2 = m2.sent.filter(m => m.type === 'response.create')
    ok('E7', 'spoke first → no filler; booking saved with caller phone; outcome booked', c2.length === 1 && !c2[0].response && m2.b.result.booking?.eventId === 'e1' && m2.b.result.booking.phone === '+14155550100' && m2.b.result.outcome === 'booked', { creates: c2.length, booking: m2.b.result.booking })
    m2.b.onAi({ type: 'response.created' })
    m2.b.onAi({ type: 'response.done', response: { status: 'completed', output: [{ type: 'function_call', name: 'record_outcome', call_id: 'c3', arguments: '{"outcome":"interested"}' }] } })
    ok('E8', 'record_outcome later does not overwrite "booked"', m2.b.result.outcome === 'booked')
    // 3) calendar error → graceful tool output
    const m3 = mk({ calendar: { ...fakeCal, check: async () => { throw new Error('boom') } } })
    m3.b.onAi({ type: 'response.done', response: { status: 'completed', output: [{ type: 'message' }, { type: 'function_call', name: 'check_availability', call_id: 'c4', arguments: '{}' }] } })
    await sleep(20)
    const o4 = JSON.parse(m3.sent.find(m => m.type === 'conversation.item.create')?.item.output || '{}')
    ok('E9', 'calendar down → tool says so and suggests taking a message', o4.ok === false && /message/.test(o4.error))
    // 4) collision with a server-created response → retried after it ends
    const m4 = mk({})
    m4.b.createResponse({ instructions: 'x' })
    m4.b.onAi({ type: 'response.created' }) // server auto response won the race
    m4.b.onAi({ type: 'error', error: { code: 'conversation_already_has_active_response' } })
    m4.b.onAi({ type: 'response.done', response: { status: 'completed', output: [] } })
    ok('E10', 'create that collided with an active response is retried after it', m4.sent.filter(m => m.type === 'response.create').length === 2)
    // 5) recording hooks
    const m5 = mk({ record: true })
    for (let i = 0; i < 50; i++) m5.b.onMedia({ event: 'media', media: { track: 'inbound', payload: b64(tone(20, 0xff)) } })
    m5.b.onAi({ type: 'response.output_audio.delta', item_id: 'i1', delta: b64(tone(2000, 0x80)) })
    ok('E11', 'caller frames + agent audio land in the recorder', m5.b.rec.callerLen === 8000 && m5.b.rec.agentEnd === 8000 + 16000)
    m5.b.interruptible = true
    m5.b.onAi({ type: 'input_audio_buffer.speech_started' })
    ok('E12', 'barge-in clears the phone and cuts the recording', m5.b.rec.agentEnd === 8000 && m5.phone.some(p => p.event === 'clear'))
    ok('E13', 'no recorder when the agent does not record', mk({ record: false }).b.rec === null)
  }

  // ═════════════ F. calls.finish: billing, record, inbox, retention ═════════════
  {
    store.init(db)
    await audioLib.initAudioLibrary(db)
    recorder.setDb(db) // production: ai-agent/index.js init() → recorder.setDb(db) (renames the redeploy backup)
    const walletOf = db.collection('walletOf')
    const chatId = '5000000000000099'
    await walletOf.insertOne({ _id: chatId, usdIn: 50, usdOut: 0 })
    const sentBot = []
    const bot = { sendMessage: async (id, text) => sentBot.push({ m: 'sendMessage', id, text }), sendAudio: async (id, url, o) => sentBot.push({ m: 'sendAudio', id, url, caption: o.caption }) }
    calls.init({ walletOf, bot, audioLibraryService: audioLib, log: () => {}, voiceService: { getIvrCallRate: () => 0.15 } })
    ok('F1', 'rates: AI $0.20/min, +$0.02 when recorded', calls.RATE() === 0.2 && calls.RECORD_RATE() === 0.02 && calls.leadRate('+14155550100') === 0.2 && calls.leadRate('+14155550100', true) === 0.22)
    const rec = new recorder.Recorder()
    for (let i = 0; i < 150; i++) rec.addCaller(b64(tone(20, 0xff)))
    rec.addAgent(b64(tone(1500, 0x80))) // queued after 3 s of caller audio → 4.5 s timeline
    const agent = { id: 'ag1', name: 'Ava', language: 'en', record: true }
    const bk = { start: '2026-11-02T09:00:00-05:00', day: 'Monday, November 2', time: '9:00 AM', name: 'Jane', eventId: 'e1', link: 'https://calendar.google.com/e/1' }
    const s = { ccid: 'cc-1', token: 'tok1', kind: 'inbound', rate: 0.22, baseRate: 0.2, recRate: 0.02, chatId, agent, number: '+19786001640', other: '+14155550100', startedAt: new Date(), answeredAt: Date.now() - 65000, bridge: { stop() {}, rec, result: { transcript: [], outcome: 'booked', booking: bk, usage: {} } } }
    await calls.finish(s, { hangup_cause: 'normal_clearing' })
    const c = await db.collection('aiCalls').findOne({ chatId })
    const file = c?.recordingFile && path.join(recorder.AUDIO_DIR, c.recordingFile)
    ok('F2', 'recorded inbound call: 2 started min × $0.22 = $0.44', c && c.rate === 0.22 && c.recordingRate === 0.02 && c.charge === 0.44 && c.minutesBilled === 2, c && { rate: c.rate, charge: c.charge })
    const w = await walletOf.findOne({ _id: chatId })
    ok('F3', 'wallet charged $0.44', Math.abs((w.usdOut || 0) - 0.44) < 1e-9, w)
    ok('F4', 'recording saved (MP3 on disk + redeploy backup), kept 90 days', c.recordingUrl?.includes('/assets/user-audio/') && fs.existsSync(file) && c.recordingSeconds === 5 && near((new Date(c.recordingExpiresAt) - Date.now()) / 86400000, 90, 0.01) && !!(await db.collection('ivrAudioStore').findOne({ filename: c.recordingFile })), { url: c.recordingUrl, secs: c.recordingSeconds })
    ok('F5', 'booking + outcome "booked" on the call record', c.outcome === 'booked' && c.booking?.eventId === 'e1')
    ok('F6', 'inbox notice carries the recording as audio + the booking line', sentBot[0]?.m === 'sendAudio' && sentBot[0].url === c.recordingUrl && /Booked: Monday, November 2 at 9:00 AM/.test(sentBot[0].caption) && /\$0\.44/.test(sentBot[0].caption), sentBot[0])
    // recording could not be saved → no surcharge
    const s2 = { ...s, ccid: 'cc-2', token: 'tok2', done: false, bridge: { stop() {}, rec: null, result: { transcript: [], usage: {} } } }
    sentBot.length = 0
    await calls.finish(s2, {})
    const c2 = await db.collection('aiCalls').findOne({ chatId, recordingUrl: null })
    ok('F7', 'no recording saved → billed $0.20/min only, plain text notice', c2 && c2.rate === 0.2 && c2.charge === 0.4 && c2.recordingRate === 0 && sentBot[0]?.m === 'sendMessage', c2 && { rate: c2.rate, charge: c2.charge })
    // retention sweep
    const later = new Date(Date.now() + 91 * 86400000)
    const n = await recorder.sweep(db, { now: later, log: () => {} })
    const c3 = await db.collection('aiCalls').findOne({ id: c.id })
    ok('F8', 'after 90 days: MP3 + backup deleted, call record kept without the link', n === 1 && !fs.existsSync(file) && !(await db.collection('ivrAudioStore').findOne({ filename: c.recordingFile })) && c3.recordingUrl === null && !!c3.recordingDeletedAt && c3.summary === c.summary)
    ok('F9', 'sweep is a no-op before the keep date', (await recorder.sweep(db, { now: new Date(), log: () => {} })) === 0)
  }

  // ═════════════ G. Web route helpers ═════════════
  {
    const web = require('../cloudivr-web/ai')
    ok('G1', 'returnTo only accepts same-site paths', web.safePath('/cloudivr/app/ai-agents/x') && !web.safePath('//evil.com') && !web.safePath('https://evil.com') && !web.safePath('/\\evil'))
    ok('G2', 'redirect URI built from the public host', web.redirectUri({ headers: { 'x-forwarded-host': 'cloudivr.net', host: '127.0.0.1:5000' } }) === 'https://cloudivr.net/api/cloudivr-web/calendar/google/callback')
  }

  await client.db(process.env.DB_NAME).dropDatabase().catch(() => {})
  await client.close()
  const failed = results.filter(r => !r.pass)
  for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'} ${r.id} ${r.name}${r.pass ? '' : ` → ${JSON.stringify(r.detail)?.slice(0, 400)}`}`)
  console.log(`\n${results.length - failed.length}/${results.length} passed`)
  process.exit(failed.length ? 1 : 0)
})().catch(e => { console.error(e); process.exit(1) })
