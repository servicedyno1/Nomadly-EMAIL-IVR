'use strict'
// Telegram bot: AI receptionist for one number — status, on/off, quick setup, business hours, when closed, messages.
const ai = require('./ai-agent')
const numberHours = require('./number-hours')
const phoneConfig = require('./phone-config')

const BTN = {
  menu: '🤖 AI Receptionist', on: '✅ Turn receptionist on', off: '⏸ Turn receptionist off', setup: '✨ Quick setup',
  hoursOn: '🕘 Hours: Mon–Fri 9:00–17:00', hoursOff: '🔁 Answer 24/7', afterMsg: '✉️ When closed: take a message', afterVm: '📼 When closed: voicemail',
  msgs: '📨 Messages', allDone: '✔️ Mark these done',
}
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const DAYS_TEXT = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' }
const hoursText = (h) => (!h?.enabled ? 'Answers 24/7' : `${Object.entries(h.days).filter(([, d]) => d.on).map(([k, d]) => `${DAYS_TEXT[k]} ${d.start}–${d.end}`).join(', ')} (${h.timezone})`)
const zoneOf = (phone) => require('./ai-agent/hours').zonesOf(phone)[0] || 'UTC'

async function agentOf(chatId, num) {
  const id = num.features?.aiAgent?.agentId
  const a = id ? await ai.store.getAgent(id, chatId) : null
  if (a) return a
  return (await ai.store.listAgents(chatId)).find(x => x.role === 'receptionist') || null
}

// → { text, rows }
async function screen(chatId, num) {
  if (!phoneConfig.canAccessFeature(num.plan, 'aiAgent')) return { text: '🤖 <b>AI Receptionist</b>\n\nThe AI receptionist isn’t available on this number’s plan.', rows: [] }
  const a = await agentOf(chatId, num)
  const on = !!(num.features?.aiAgent?.enabled && a && num.features.aiAgent.agentId === a.id)
  const open = await ai.store.countOpenMessages(chatId).catch(() => 0)
  const rate = ai.RECEPTION_RATE()
  if (!a) return { text: `🤖 <b>AI Receptionist</b> · ${esc(num.phoneNumber)}\n\nAn AI that answers this number 24/7: answers questions from your info, takes messages and can send callers to voicemail when you’re closed.\n💳 $${rate}/min from your wallet.\n\nTap <b>${BTN.setup}</b> — two quick questions and it’s ready.`, rows: [[BTN.setup]] }
  const h = a.hours
  const closed = h?.enabled ? (h.afterHours === 'voicemail' ? 'callers go to voicemail' : 'it takes a message') : null
  const text = [
    `🤖 <b>AI Receptionist</b> · ${esc(num.phoneNumber)}`,
    '',
    `Status: ${on ? '🟢 answering this number' : '⚪ off'}`,
    `Receptionist: ${esc(a.name)}${a.businessName ? ` · ${esc(a.businessName)}` : ''}`,
    `Hours: ${esc(hoursText(h))}${h?.enabled ? ` — ${numberHours.isOpen(h) ? 'open now' : 'closed now'}` : ''}`,
    closed ? `When closed: ${closed}` : '',
    `Messages to read: ${open}`,
    `💳 $${rate}/min from your wallet.`,
    '',
    '<i>Edit the greeting, FAQs and calendar bookings in the CloudIVR web app.</i>',
  ].filter(x => x !== '').join('\n')
  const rows = [[on ? BTN.off : BTN.on], [h?.enabled ? BTN.hoursOff : BTN.hoursOn]]
  if (h?.enabled) rows.push([h.afterHours === 'voicemail' ? BTN.afterMsg : BTN.afterVm])
  rows.push([BTN.msgs])
  return { text, rows }
}

// Only one answers a number: the receptionist going on switches the keypad menu and forward-every-call off.
async function turnOn(chatId, num, agentId, setFeature) {
  const notes = []
  await setFeature('aiAgent', { enabled: true, agentId })
  num.features.aiAgent = { enabled: true, agentId }
  const ivr = num.features?.ivr
  if (ivr?.enabled) { await setFeature('ivr', { ...ivr, enabled: false }); num.features.ivr = { ...ivr, enabled: false }; notes.push('keypad menu switched off') }
  const cf = num.features?.callForwarding
  if (cf?.enabled && cf.mode === 'always') { const v = { ...cf, enabled: false, mode: 'disabled', lastMode: 'always' }; await setFeature('callForwarding', v); num.features.callForwarding = v; notes.push('forward-every-call switched off') }
  return notes
}

async function createQuick(chatId, business, info) {
  const zone = 'UTC'
  return ai.store.createAgent(chatId, {
    role: 'receptionist', name: 'Receptionist', businessName: String(business || '').slice(0, 60), knowledge: String(info || '').slice(0, 6000),
    goal: 'Friendly receptionist. Answer callers’ questions from the FAQs, take a message with their name and number, and offer to have someone call them back.',
    takeMessages: true, waitForHello: false, hours: { ...numberHours.defaultHours(zone), afterHours: 'message' },
  })
}

async function setHours(chatId, a, on, phone) {
  const base = a.hours?.days ? a.hours : { ...numberHours.defaultHours(zoneOf(phone)), afterHours: 'message' }
  const hours = { ...base, enabled: on, timezone: base.timezone && base.timezone !== 'UTC' ? base.timezone : zoneOf(phone) }
  return ai.store.updateAgent(chatId, a.id, { ...a, hours })
}
const setAfter = (chatId, a, afterHours) => ai.store.updateAgent(chatId, a.id, { ...a, hours: { ...a.hours, afterHours } })

async function messagesText(chatId) {
  const list = await ai.store.listMessages(chatId, { open: true, limit: 5 })
  if (!list.length) return { text: '📨 <b>Receptionist messages</b>\n\nNothing to read — new messages and bookings show up here and in your notifications.', ids: [] }
  const lines = list.map(m => `• <b>${esc(m.message?.name || m.other)}</b> (${esc(m.message?.callback || m.other)}) → ${esc(m.number)}\n  ${m.message?.text ? `“${esc(m.message.text)}”` : m.booking ? `📅 Booked ${esc(m.booking.day)} at ${esc(m.booking.time)}` : esc(m.summary || 'Wants a call back')}`)
  return { text: `📨 <b>Receptionist messages</b> (${list.length} to read)\n\n${lines.join('\n\n')}`, ids: list.map(m => m.id) }
}

module.exports = { BTN, screen, agentOf, turnOn, createQuick, setHours, setAfter, messagesText }
