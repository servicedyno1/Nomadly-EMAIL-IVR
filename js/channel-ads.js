'use strict'
// Automatic CloudIVR posts to the Telegram channel (@CloudIVRNet) — 2 a day, real in-app screens and clips,
// captions written by Emily. Runs only in the bot that is an admin of the channel (default @Nomadlybot).
const fs = require('fs')
const path = require('path')
const axios = require('axios')

const MEDIA = require('./channel-ads-media.json')
const MEDIA_DIR = path.join(__dirname, '..', 'frontend', 'public', 'channel-ads')
const CHANNEL = () => process.env.CHANNEL_ADS_CHAT || '@CloudIVRNet'
const POSTER_BOT = () => String(process.env.CHANNEL_ADS_BOT || 'Nomadlybot').toLowerCase()
const SLOTS_UTC = () => String(process.env.CHANNEL_ADS_SLOTS_UTC || '14:00,22:00').split(',').map(s => s.trim()).filter(Boolean)
const SITE = () => String(process.env.CLOUDIVR_PUBLIC_URL || 'https://cloudivr.net').replace(/\/+$/, '')
const dryRun = () => process.env.WEB_CLOUDIVR_DRY_RUN === 'true' || process.env.CHANNEL_ADS_DRY_RUN === 'true'
const PILLARS = ['how', 'feature', 'usecase', 'tip', 'new']
const USE_CASES = ['dental or medical clinic', 'real estate agent', 'online shop', 'small call center', 'law office', 'restaurant taking bookings', 'home services (plumber, cleaner)', 'recruiting agency', 'freelancer or consultant', 'car dealership']
const WHATS_NEW = ['Emily sets up menus, calls and campaigns just by chatting', 'AI conversation campaigns: an AI talks with each lead, then hands the interested ones to you', 'Free "Call me now" test call to hear your AI agent before going live', 'Ask Emily which plan fits your business', 'Live "signed in" badges for your softphones and desk phones', 'Renewal dates synced to Google or Apple Calendar', 'Number search answers in a second or two']
const NEW_MEDIA = { 0: 'emily-ivr', 1: 'ai-campaign', 2: 'ai-campaign', 3: 'plan-pick', 4: 'sip', 5: 'renewals', 6: 'number-search' }

let col = null, token = null, log = console.log, timer = null, busy = false

function facts() {
  try {
    const pc = require('./phone-config.js')
    const plans = pc.PLAN_ORDER.map(k => `${pc.plans[k].name} $${pc.plans[k].price}/mo`).join(', ')
    return `Plans: ${plans}. Keypad menu from Plus; Quick IVR, bulk and AI conversation campaigns from Pro; custom caller ID on Business. AI receptionist $0.10/min on every plan; AI conversation campaigns $0.30/min. Numbers in the US, Canada and more countries; month to month, no contract.`
  } catch (_) { return 'Plans from $50/month, month to month.' }
}

async function caption(pillar, media, extra) {
  const brief = { how: `a 30-second "how it works" post built around this real screen: "${media.title}" — 3 short numbered steps`, feature: `a feature spotlight on: "${media.title}"`, usecase: `a use case for a ${extra} using CloudIVR — tie it to the screen "${media.title}"`, tip: `a practical tip or trick inside the CloudIVR app related to: "${media.title}"`, new: `a "What's new" post announcing: ${extra}` }[pillar]
  const fallback = `<b>${media.title}</b>\n\n${pillar === 'new' ? `New in CloudIVR: ${extra}.` : 'Business numbers, keypad menus, AI receptionist and AI conversation campaigns — set up in minutes by chatting with Emily.'}\n\nMonth to month, from $50.`
  if (!process.env.APP_OPEN_API_KEY) return fallback
  try {
    const r = await axios.post('https://api.openai.com/v1/chat/completions', {
      model: process.env.AI_AGENT_DRAFT_MODEL || 'gpt-4.1-mini', temperature: 0.8, max_tokens: 400,
      messages: [
        { role: 'system', content: `You write posts for the CloudIVR Telegram channel (cloud phone system for businesses: virtual numbers, keypad menus, AI receptionist, AI conversation campaigns, softphones, texting, fax). Audience: channel subscribers — keep them engaged and curious. Style: friendly, concrete, skimmable, English, max 550 characters, at most 2 emoji, no hashtags, no links (a button is added). Use Telegram HTML only: <b>bold</b> for the first line (a hook) and nothing else. Never invent prices, numbers, customers or features beyond these facts: ${facts()} Mention Emily (the in-app setup assistant) when it fits. End with one short call to action.` },
        { role: 'user', content: `Write ${brief}. The post shows a real screen / clip from the app.` },
      ],
    }, { headers: { Authorization: `Bearer ${process.env.APP_OPEN_API_KEY}` }, timeout: 25000 })
    const t = String(r.data.choices[0].message.content || '').trim().replace(/<(?!\/?b>)[^>]*>/g, '')
    return t.length > 40 ? t.slice(0, 1000) : fallback
  } catch (e) { log(`[ChannelAds] caption fallback: ${e.message}`); return fallback }
}

// Next post: rotate the 5 kinds; pick the screen used least recently for that kind.
async function plan() {
  const n = await col.countDocuments({ status: { $in: ['posted', 'simulated'] } })
  const pillar = PILLARS[n % PILLARS.length]
  const recent = (await col.find({ status: { $in: ['posted', 'simulated'] } }).sort({ at: -1 }).limit(30).project({ mediaId: 1, extra: 1 }).toArray())
  const lastUse = (id) => { const i = recent.findIndex(r => r.mediaId === id); return i < 0 ? 999 : i }
  let extra = null, media
  if (pillar === 'new') {
    const idx = WHATS_NEW.map((_, i) => i).sort((a, b) => recent.filter(r => r.extra === WHATS_NEW[a]).length - recent.filter(r => r.extra === WHATS_NEW[b]).length || a - b)[0]
    extra = WHATS_NEW[idx]; media = MEDIA.find(m => m.id === NEW_MEDIA[idx]) || MEDIA[0]
  } else {
    const pool = pillar === 'usecase' ? MEDIA.filter(m => m.pillar === 'feature') : MEDIA.filter(m => m.pillar === pillar)
    media = [...(pool.length ? pool : MEDIA)].sort((a, b) => lastUse(b.id) - lastUse(a.id))[0]
    if (pillar === 'usecase') extra = USE_CASES[n % USE_CASES.length]
  }
  return { pillar, media, extra }
}

async function send(media, text) {
  const button = { inline_keyboard: [[{ text: 'Try CloudIVR', url: `${SITE()}/?utm_source=telegram&utm_medium=channel&utm_content=${media.id}` }]] }
  const method = media.kind === 'video' ? 'sendVideo' : 'sendPhoto'
  const field = media.kind === 'video' ? 'video' : 'photo'
  const cached = (await col.findOne({ _id: `file:${media.id}` }))?.fileId
  const fd = new FormData()
  fd.append('chat_id', CHANNEL()); fd.append('caption', text); fd.append('parse_mode', 'HTML'); fd.append('reply_markup', JSON.stringify(button))
  if (media.kind === 'video') fd.append('supports_streaming', 'true')
  if (cached) fd.append(field, cached)
  else fd.append(field, new Blob([fs.readFileSync(path.join(MEDIA_DIR, path.basename(media.file)))]), path.basename(media.file))
  const r = await axios.post(`https://api.telegram.org/bot${token}/${method}`, fd, { timeout: 60000 })
  const m = r.data.result
  const fileId = media.kind === 'video' ? m.video?.file_id : m.photo?.[m.photo.length - 1]?.file_id
  if (fileId && !cached) await col.updateOne({ _id: `file:${media.id}` }, { $set: { fileId } }, { upsert: true })
  return m.message_id
}

// Posts one (slotKey makes it once-only across the two app slots and restarts).
async function postNow(slotKey = `manual:${Date.now()}`) {
  try { await col.insertOne({ _id: slotKey, at: new Date(), status: 'claimed' }) } catch (e) { if (e.code === 11000) return { skipped: 'already posted' }; throw e }
  try {
    const { pillar, media, extra } = await plan()
    const text = await caption(pillar, media, extra)
    if (dryRun()) {
      await col.updateOne({ _id: slotKey }, { $set: { status: 'simulated', pillar, mediaId: media.id, extra, text } })
      log(`[ChannelAds] (preview) would post ${pillar}/${media.id} to ${CHANNEL()}`)
      return { simulated: true, pillar, mediaId: media.id, text }
    }
    const messageId = await send(media, text)
    await col.updateOne({ _id: slotKey }, { $set: { status: 'posted', pillar, mediaId: media.id, extra, text, messageId } })
    log(`[ChannelAds] posted ${pillar}/${media.id} to ${CHANNEL()} (#${messageId})`)
    return { posted: true, pillar, mediaId: media.id, messageId }
  } catch (e) {
    const msg = e.response?.data?.description || e.message
    await col.updateOne({ _id: slotKey }, { $set: { status: 'failed', error: msg } }).catch(() => {})
    log(`[ChannelAds] post failed: ${msg}`)
    return { error: msg }
  }
}

async function tick() {
  if (busy) return
  busy = true
  try {
    const now = new Date(), day = now.toISOString().slice(0, 10)
    for (const hm of SLOTS_UTC()) {
      const [h, m] = hm.split(':').map(Number)
      const at = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), h, m || 0)
      // Due and not more than 3 h late (a long outage skips the slot instead of double posting later).
      if (now >= at && now - at < 3 * 3600e3 && !(await col.findOne({ _id: `${day}T${hm}` }))) await postNow(`${day}T${hm}`)
    }
  } catch (e) { log(`[ChannelAds] tick error: ${e.message}`) } finally { busy = false }
}

async function init({ db, bot, logger } = {}) {
  if (logger) log = logger
  col = db.collection('channelAdPosts')
  token = bot?.token || process.env.TELEGRAM_BOT_TOKEN_PROD
  if (process.env.CHANNEL_ADS_ON === 'false' || !token) return false
  let me = null
  try { me = (await axios.get(`https://api.telegram.org/bot${token}/getMe`, { timeout: 15000 })).data.result } catch (_) { /* offline */ }
  if (!dryRun() && String(me?.username || '').toLowerCase() !== POSTER_BOT()) return false
  log(`[ChannelAds] ${dryRun() ? 'preview (simulated)' : 'live'} — ${CHANNEL()} at ${SLOTS_UTC().join(' & ')} UTC via @${me?.username || '?'}`)
  if (timer) clearInterval(timer)
  timer = setInterval(tick, 5 * 60000); timer.unref?.()
  setTimeout(tick, 60000).unref?.()
  return true
}

const recentPosts = (limit = 20) => (col ? col.find({ _id: { $not: /^file:/ } }).sort({ at: -1 }).limit(limit).toArray() : [])

module.exports = { init, postNow, tick, plan, caption, recentPosts, MEDIA, CHANNEL }
