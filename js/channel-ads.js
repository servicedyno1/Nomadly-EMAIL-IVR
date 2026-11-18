'use strict'
// Automatic CloudIVR posts to Telegram channels (@CloudIVRNet twice a day, @Hostbay once): every post gets
// a new visual made on the spot (live screens desktop + phone, AI artwork, or a phone clip) and a punchy caption.
const fs = require('fs')
const crypto = require('crypto')
const axios = require('axios')
const studio = require('./channel-ads-studio')

const TARGETS = () => String(process.env.CHANNEL_ADS_TARGETS || '@CloudIVRNet=14:00,22:00;@Hostbay=18:00').split(';')
  .map(s => { const [chat, slots = ''] = s.split('='); return { chat: chat.trim(), slots: slots.split(',').map(x => x.trim()).filter(Boolean) } })
  .filter(t => t.chat && t.slots.length)
const POSTER_BOT = () => String(process.env.CHANNEL_ADS_BOT || 'Nomadlybot').toLowerCase()
const SITE = () => String(process.env.CLOUDIVR_PUBLIC_URL || 'https://cloudivr.net').replace(/\/+$/, '')
const dryRun = () => process.env.WEB_CLOUDIVR_DRY_RUN === 'true' || process.env.CHANNEL_ADS_DRY_RUN === 'true'
const PILLARS = ['how', 'feature', 'usecase', 'tip', 'new']
const USE_CASES = ['dental or medical clinic', 'real estate agent', 'online shop', 'small call center', 'law office', 'restaurant taking bookings', 'home services (plumber, cleaner)', 'recruiting agency', 'freelancer or consultant', 'car dealership']
const WHATS_NEW = [['Emily sets up menus, calls and campaigns just by chatting', 'landing-ai'], ['AI conversation campaigns: an AI talks with each lead, then hands the interested ones to you', 'ai-campaign'], ['Free "Call me now" test call to hear your AI agent before going live', 'ai-conversations'], ['Ask Emily which plan fits your business', 'pricing'], ['Live "signed in" badges for your softphones and desk phones', 'sip'], ['Renewal dates synced to Google or Apple Calendar', 'renewals'], ['Number search answers in a second or two', 'buy']]

let col = null, token = null, log = console.log, timer = null, busy = false

function facts() {
  try {
    const pc = require('./phone-config.js')
    const plans = pc.PLAN_ORDER.map(k => `${pc.plans[k].name} $${pc.plans[k].price}/mo`).join(', ')
    return `Plans: ${plans}. Keypad menu from Plus; Quick IVR, bulk and AI conversation campaigns from Pro; custom caller ID on Business. AI receptionist $0.10/min on every plan; AI conversation campaigns $0.30/min. Numbers in the US, Canada and more countries; month to month, no contract.`
  } catch (_) { return 'Plans from $50/month, month to month.' }
}

// Headline (also printed on the visual) + 1–2 short lines + an artwork scene, from the owner's OpenAI keys.
async function caption(pillar, topic, extra) {
  const brief = { how: topic.run ? `an end-to-end "watch Emily set it up" post: ${topic.title}. The visual shows the whole flow — you ask Emily in plain words, she suggests the setup, the form is filled in, you press Save` : `"how it works" — the screen: "${topic.title}"`, feature: `a feature spotlight on "${topic.title}"`, usecase: `why a ${extra} would use CloudIVR (screen: "${topic.title}")`, tip: `a quick tip about "${topic.title}"`, new: `"What's new": ${extra}` }[pillar]
  const fallback = { headline: (pillar === 'new' ? extra : topic.title).slice(0, 70), line: 'Business numbers, keypad menus and AI calling — set up in minutes by chatting with Emily. From $50/month.', scene: `a small business owner relaxed while calls are handled for them, ${extra || topic.title}` }
  const keys = [...new Set([process.env.APP_OPEN_API_KEY, process.env.OPEN_API_KEY].filter(Boolean))]
  for (const key of keys) {
    try {
      const r = await axios.post('https://api.openai.com/v1/chat/completions', {
        model: process.env.AI_AGENT_DRAFT_MODEL || 'gpt-4.1-mini', temperature: 0.9, max_tokens: 300, response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: `You write short ad posts for the CloudIVR Telegram channel (cloud phone system for businesses: virtual numbers, keypad menus, AI receptionist, AI conversation campaigns, softphones, texting, fax). English. Return JSON {"headline","line","scene"}. headline: punchy hook, max 7 words, no emoji, no trailing period. line: 1–2 short sentences, max 150 characters total, concrete benefit, may end with a tiny call to action, at most 1 emoji. scene: one sentence describing an illustration for this post (people/objects/mood, no text, no screens). Never invent prices, numbers, customers or features beyond: ${facts()} Mention Emily (the in-app setup assistant) only when it fits. No hashtags, no links.` },
          { role: 'user', content: `Write ${brief}. Be fresh — avoid generic phrases like "game changer" or "revolutionize".` },
        ],
      }, { headers: { Authorization: `Bearer ${key}` }, timeout: 25000 })
      const j = JSON.parse(r.data.choices[0].message.content)
      const clean = (s, n) => String(s || '').replace(/<[^>]*>/g, '').trim().slice(0, n)
      if (clean(j.headline, 80).length > 5 && clean(j.line, 220).length > 10) return { headline: clean(j.headline, 80).replace(/\.$/, ''), line: clean(j.line, 220), scene: clean(j.scene, 300) || fallback.scene }
    } catch (e) { log(`[ChannelAds] caption attempt failed: ${e.message}`) }
  }
  return fallback
}

const SUPPORT = () => String(process.env.CHANNEL_ADS_SUPPORT || 'CloudIVRhelp').replace('@', '')
const ctaUrl = (chat, topicId) => `${SITE()}/?utm_source=telegram&utm_medium=channel&utm_campaign=${encodeURIComponent(chat.replace('@', ''))}&utm_content=${topicId}`
// Every post ends with the cloudivr.net link and the support handle.
const htmlText = (c, url) => `<b>${c.headline.replace(/[<>&]/g, '')}</b>\n${c.line.replace(/[<>&]/g, '')}\n\n👉 <a href="${url}">${new URL(SITE()).host}</a>\n💬 Support: @${SUPPORT()}`

// Next post for a channel: rotate the 5 kinds, least-recently-used topic, random visual (clip / AI art / screens).
async function plan(chat) {
  const done = { chat, status: { $in: ['posted', 'simulated'] } }
  const n = await col.countDocuments(done)
  const ti = Math.max(0, TARGETS().findIndex(t => t.chat === chat))
  const pillar = PILLARS[(n + ti * 2) % PILLARS.length]
  const recent = await col.find({ status: { $in: ['posted', 'simulated'] } }).sort({ at: -1 }).limit(40).project({ topicId: 1, sig: 1 }).toArray()
  const lastUse = (id) => { const i = recent.findIndex(r => r.topicId === id); return i < 0 ? 999 : i }
  const r = crypto.randomInt(100)
  // Emily end-to-end demos lead (clip or step-by-step album); then live screens, AI artwork, short clips.
  const kind = r < 30 ? 'demo' : r < 55 ? 'series' : r < 75 ? 'screen' : r < 90 ? 'art' : 'clip'
  let extra = null, screen, clip = null, demo = null
  if (pillar === 'new') {
    const [what, id] = WHATS_NEW[n % WHATS_NEW.length]
    extra = what; screen = studio.SCREENS.find(s => s.id === id) || studio.SCREENS[0]
  } else {
    const pool = studio.SCREENS.filter(s => (pillar === 'usecase' ? ['usecase', 'feature'] : [pillar]).includes(s.pillar))
    screen = [...pool].sort((a, b) => lastUse(b.id) - lastUse(a.id) || crypto.randomInt(3) - 1)[0]
    if (pillar === 'usecase') extra = USE_CASES[(n + ti * 3) % USE_CASES.length]
  }
  if (kind === 'clip') clip = [...studio.CLIPS].sort((a, b) => lastUse(b.id) - lastUse(a.id))[0]
  if (kind === 'demo' || kind === 'series') demo = [...studio.DEMOS].sort((a, b) => lastUse(b.id) - lastUse(a.id) || crypto.randomInt(3) - 1)[0]
  return { pillar: demo ? 'how' : pillar, kind, screen, clip, demo, extra: demo ? null : extra, topic: demo || clip || screen, recentSigs: new Set(recent.map(x => x.sig).filter(Boolean)) }
}

async function send(chat, media, text, topicId) {
  const button = { inline_keyboard: [[{ text: 'Try CloudIVR', url: ctaUrl(chat, topicId) }, { text: 'Support', url: `https://t.me/${SUPPORT()}` }]] }
  if (media.type === 'album') {
    const fd = new FormData()
    fd.append('chat_id', chat)
    fd.append('media', JSON.stringify(media.files.map((_, i) => ({ type: 'photo', media: `attach://s${i}`, ...(i === 0 ? { caption: text, parse_mode: 'HTML' } : {}) }))))
    media.files.forEach((f, i) => fd.append(`s${i}`, new Blob([fs.readFileSync(f)]), `step-${i + 1}.jpg`))
    const r = await axios.post(`https://api.telegram.org/bot${token}/sendMediaGroup`, fd, { timeout: 120000, maxBodyLength: Infinity })
    return r.data.result[0].message_id
  }
  const video = media.type === 'video'
  const fd = new FormData()
  fd.append('chat_id', chat); fd.append('caption', text); fd.append('parse_mode', 'HTML'); fd.append('reply_markup', JSON.stringify(button))
  if (video) { fd.append('supports_streaming', 'true'); fd.append('width', '1080'); fd.append('height', '1350') }
  fd.append(video ? 'video' : 'photo', new Blob([fs.readFileSync(media.file)]), video ? 'cloudivr.mp4' : 'cloudivr.jpg')
  const r = await axios.post(`https://api.telegram.org/bot${token}/${video ? 'sendVideo' : 'sendPhoto'}`, fd, { timeout: 120000, maxBodyLength: Infinity })
  return r.data.result.message_id
}

const sigOf = (topicId, v) => `${topicId}|${v.layout}|${v.theme}|${v.font}`

// Posts one (slotKey makes it once-only across the app slots and restarts).
// prepare=true builds the visual ahead of the slot and keeps it on disk; publish() sends it on time.
async function postNow(chat = TARGETS()[0]?.chat, slotKey = `manual:${chat}:${Date.now()}`, { prepare = false } = {}) {
  try { await col.insertOne({ _id: slotKey, chat, at: new Date(), status: 'claimed' }) } catch (e) { if (e.code === 11000) return { skipped: 'already posted' }; throw e }
  let media = null, keep = false
  try {
    const p = await plan(chat)
    const cap = await caption(p.pillar, p.topic, p.extra)
    for (let i = 0; i < 4; i++) {
      media = await studio.make({ kind: p.kind, screen: p.screen, clip: p.clip, demo: p.demo, headline: cap.headline, sub: cap.line, scene: cap.scene })
      if (media.type !== 'photo' || media.v.layout === 'art' || !p.recentSigs.has(sigOf(p.screen.id, media.v))) break
      fs.rmSync(media.file, { force: true })
    }
    const topicId = media.type === 'photo' ? p.screen.id : (p.demo && !media.v.fallback ? p.demo.id : (p.clip || p.screen).id)
    const text = htmlText(cap, ctaUrl(chat, topicId))
    const rec = { chat, pillar: p.pillar, topicId, mediaId: topicId, visual: media.type === 'album' ? 'series' : media.type === 'video' ? (p.kind === 'demo' ? 'demo' : 'clip') : media.v.layout, steps: media.files?.length || null, live: media.live, fallback: media.v.fallback || null, sig: sigOf(topicId, media.v), extra: p.extra, text, thumb: media.thumb.toString('base64') }
    if (prepare) {
      await col.updateOne({ _id: slotKey }, { $set: { status: 'prepared', ...rec, media: { type: media.type, file: media.file || null, files: media.files || null } } })
      keep = true
      log(`[ChannelAds] prepared ${p.pillar}/${topicId} (${rec.visual}) for ${chat}`)
      return { prepared: true }
    }
    if (dryRun()) {
      await col.updateOne({ _id: slotKey }, { $set: { status: 'simulated', ...rec } })
      log(`[ChannelAds] (preview) would post ${p.pillar}/${topicId} (${rec.visual}) to ${chat}`)
      return { simulated: true, chat, pillar: p.pillar, topicId, visual: rec.visual, text }
    }
    const messageId = await send(chat, media, text, topicId)
    await col.updateOne({ _id: slotKey }, { $set: { status: 'posted', ...rec, messageId } })
    log(`[ChannelAds] posted ${p.pillar}/${topicId} (${rec.visual}) to ${chat} (#${messageId})`)
    return { posted: true, chat, pillar: p.pillar, topicId, visual: rec.visual, messageId }
  } catch (e) {
    const msg = e.response?.data?.description || e.message
    await col.updateOne({ _id: slotKey }, { $set: { status: 'failed', error: msg } }).catch(() => {})
    log(`[ChannelAds] post to ${chat} failed: ${msg}`)
    return { error: msg }
  } finally { if (!keep) for (const f of [media?.file, ...(media?.files || [])].filter(Boolean)) fs.rmSync(f, { force: true }) }
}

// Sends a prepared post; if its files are gone (e.g. server moved), it is rebuilt and sent now.
async function publish(doc) {
  const m = doc.media || {}, files = [m.file, ...(m.files || [])].filter(Boolean)
  if (!files.length || !files.every(f => fs.existsSync(f))) { await col.deleteOne({ _id: doc._id }); return postNow(doc.chat, doc._id) }
  try {
    if (dryRun()) { await col.updateOne({ _id: doc._id }, { $set: { status: 'simulated' }, $unset: { media: '' } }); log(`[ChannelAds] (preview) would post prepared ${doc.topicId} to ${doc.chat}`); return { simulated: true } }
    const messageId = await send(doc.chat, m, doc.text, doc.topicId)
    await col.updateOne({ _id: doc._id }, { $set: { status: 'posted', messageId, postedAt: new Date() }, $unset: { media: '' } })
    log(`[ChannelAds] posted ${doc.pillar}/${doc.topicId} (${doc.visual}) to ${doc.chat} (#${messageId})`)
    return { posted: true, messageId }
  } catch (e) {
    const msg = e.response?.data?.description || e.message
    await col.updateOne({ _id: doc._id }, { $set: { status: 'failed', error: msg } }).catch(() => {})
    log(`[ChannelAds] post to ${doc.chat} failed: ${msg}`)
    return { error: msg }
  } finally { for (const f of files) fs.rmSync(f, { force: true }) }
}

async function tick() {
  if (busy) return
  busy = true
  try {
    const now = new Date(), day = now.toISOString().slice(0, 10)
    for (const { chat, slots } of TARGETS()) {
      for (const hm of slots) {
        const [h, m] = hm.split(':').map(Number)
        const at = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), h, m || 0)
        const key = chat === '@CloudIVRNet' ? `${day}T${hm}` : `${chat}:${day}T${hm}`
        const doc = await col.findOne({ _id: key })
        // Built up to 25 min early so it goes out on the minute; due and not more than 3 h late (a long outage skips the slot).
        if (!doc && now < at && at - now <= 25 * 60e3) await postNow(chat, key, { prepare: true })
        else if (now >= at && now - at < 3 * 3600e3) {
          if (!doc) await postNow(chat, key)
          else if (doc.status === 'prepared') await publish(doc)
        }
      }
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
  log(`[ChannelAds] ${dryRun() ? 'preview (simulated)' : 'live'} — ${TARGETS().map(t => `${t.chat} at ${t.slots.join(' & ')}`).join('; ')} UTC via @${me?.username || '?'}`)
  if (timer) clearInterval(timer)
  timer = setInterval(tick, 60000); timer.unref?.()
  setTimeout(tick, 60000).unref?.()
  return true
}

const recentPosts = (limit = 20) => (col ? col.find({ _id: { $not: /^file:/ } }).sort({ at: -1 }).limit(limit).toArray() : [])
const targets = () => TARGETS()

module.exports = { init, postNow, tick, plan, caption, recentPosts, targets }
