'use strict'
// One live AI conversation: phone audio in the Telnyx media-stream protocol (μ-law 8 kHz) ⇄ OpenAI Realtime speech-to-speech.
// The phone side is a Telnyx stream or the browser tester; `actions` does hangup/transfer for that side.
const WebSocket = require('ws')
const { LANG_NAMES } = require('./store')
const { Recorder } = require('./recorder')

const MODEL = () => process.env.AI_AGENT_MODEL || 'gpt-realtime-mini'
const OPENING = {
  en: { in: (n, b) => `Thanks for calling${b ? ` ${b}` : ''}. I'm ${n}, an AI assistant.`, out: (n, b) => `Hi, this is ${n}, an AI assistant calling${b ? ` for ${b}` : ''}.`, askIn: 'How can I help you today?', askOut: 'Do you have a minute?', rec: 'This call may be recorded.', wait: 'One moment while I check.' },
  fr: { in: (n, b) => `Merci d'avoir appelé${b ? ` ${b}` : ''}. Je suis ${n}, un assistant IA.`, out: (n, b) => `Bonjour, ici ${n}, un assistant IA qui appelle${b ? ` de la part de ${b}` : ''}.`, askIn: 'Comment puis-je vous aider ?', askOut: 'Avez-vous une minute ?', rec: 'Cet appel peut être enregistré.', wait: 'Un instant, je vérifie.' },
  es: { in: (n, b) => `Gracias por llamar${b ? ` a ${b}` : ''}. Soy ${n}, un asistente de IA.`, out: (n, b) => `Hola, soy ${n}, un asistente de IA que llama${b ? ` de parte de ${b}` : ''}.`, askIn: '¿En qué puedo ayudarle?', askOut: '¿Tiene un minuto?', rec: 'Esta llamada puede ser grabada.', wait: 'Un momento, lo reviso.' },
}

// The AI disclosure (and the recording notice when the call is recorded) always opens the call and cannot be interrupted.
function opening(agent, direction, recorded = false) {
  const o = OPENING[agent.language] || OPENING.en, out = direction === 'outbound'
  return `${out ? o.out(agent.name, agent.businessName) : o.in(agent.name, agent.businessName)}${recorded ? ` ${o.rec}` : ''} ${agent.greeting || (out ? o.askOut : o.askIn)}`
}

function bookingRules(cal) {
  if (!cal) return ''
  return [
    '# Booking appointments',
    `- You can book ${cal.minutes}-minute appointments straight into the business calendar. Today is ${cal.today()}. Business time zone: ${cal.timeZone}. Bookable hours: ${cal.hours()}.`,
    '- To find free times, call check_availability with the date as YYYY-MM-DD (work out "tomorrow", "next Tuesday" and so on from today). Right before you call it, say a short line such as "One moment while I check."',
    '- Only offer times that check_availability returned, at most three at a time. Never guess or invent free times. If the day is full, offer nextAvailable.',
    '- Times are in the business time zone. If a time has callerTime, the caller is in another time zone: say both, e.g. "2 PM our time, that is 11 AM for you".',
    "- Before booking, get the caller's name (and a callback number if they want one other than the number they are calling from). Then call book_appointment with the exact start value of the chosen time.",
    '- When book_appointment succeeds, repeat the day, date and time back to confirm. If it fails, say so briefly and offer the other times or take a message.',
    '- Book at most one appointment per call.',
  ].join('\n')
}

function instructions(agent, ctx) {
  const who = ctx.direction === 'outbound' ? `You are calling ${ctx.leadName || 'a contact'} on behalf of the business.` : 'You are answering an incoming phone call for the business.'
  return [
    `You are ${agent.name}, an AI phone assistant for ${agent.businessName || 'a business'}. ${who}`,
    `# Your goal\n${agent.goal}`,
    agent.knowledge ? `# What you know (use only this; never invent prices, policies or facts)\n${agent.knowledge}` : '# Facts\nDo not invent prices, policies or facts. If you do not know, say someone will follow up.',
    '# Rules',
    '- This is a phone call: keep each reply to one or two short sentences and ask one question at a time.',
    `- Speak ${LANG_NAMES[agent.language] || 'English'}. If the person clearly speaks another language, switch to it.`,
    '- Never claim to be human. If asked, say you are an AI assistant.',
    '- Never ask for card numbers, passwords or one-time codes.',
    '- If the person asks not to be called again or to be removed from the list, apologise, call opt_out, then say goodbye.',
    agent.transferTo ? '- If the person wants to talk to a human, or is ready to go ahead, call transfer_call.' : '- You cannot transfer calls. If someone wants a human, offer to take a message.',
    agent.takeMessages ? '- If they want to leave a message, get their name, a callback number and the message, then call take_message.' : '',
    '- As soon as you know how it went (interested, not interested, call back later), call record_outcome.',
    '- When the conversation is over, say a short goodbye and call end_call.',
    bookingRules(ctx.calendar),
  ].filter(Boolean).join('\n')
}

const fn = (name, description, properties = {}, required = []) => ({ type: 'function', name, description, parameters: { type: 'object', properties, required } })
const SLOW = new Set(['check_availability', 'book_appointment']) // answered when the calendar replies
function tools(agent, ctx = {}) {
  const t = [
    fn('end_call', 'Hang up. Use after saying goodbye.'),
    fn('record_outcome', 'Save how the conversation went.', { outcome: { type: 'string', enum: ['interested', 'not_interested', 'callback'] }, note: { type: 'string', description: 'One short sentence, e.g. a good time to call back.' } }, ['outcome']),
    fn('opt_out', 'The person asked not to be called again.'),
  ]
  if (agent.transferTo) t.push(fn('transfer_call', 'Connect the person to a human at the business now.'))
  if (agent.takeMessages) t.push(fn('take_message', 'Save a message for the business.', { name: { type: 'string' }, callback_number: { type: 'string' }, message: { type: 'string' } }, ['message']))
  if (ctx.calendar) {
    t.push(fn('check_availability', 'Free appointment times on one day of the business calendar.', { date: { type: 'string', description: 'The day, YYYY-MM-DD.' } }, ['date']))
    t.push(fn('book_appointment', 'Book an appointment in the business calendar at one of the free times.', {
      start: { type: 'string', description: 'The exact start value of a free time from check_availability.' }, name: { type: 'string', description: "The caller's full name." },
      phone: { type: 'string', description: 'Callback number, only if different from the number they call from.' }, note: { type: 'string', description: 'What the appointment is for, in a few words.' },
    }, ['start', 'name']))
  }
  return t
}

const vad = (interrupt) => ({ type: 'semantic_vad', eagerness: 'auto', create_response: true, interrupt_response: interrupt })

class Bridge {
  constructor({ agent, ctx, media, actions, log = console.log }) {
    Object.assign(this, { agent, ctx, media, actions, log })
    this.result = { transcript: [], outcome: null, note: null, message: null, optedOut: false, transferredTo: null, voicemail: false, booking: null, usage: { input: 0, output: 0 } }
    this.rec = ctx.record ? new Recorder() : null
    this.responding = false // a response is being generated
    this.creating = false // response.create sent, response.created not seen yet
    this.queued = null // response.create waiting for the current response to finish
    this.closed = false
    this.interruptible = false
    this.ending = null // 'hangup' | 'transfer' once the last words are queued
  }

  start() {
    this.ai = new WebSocket(`wss://api.openai.com/v1/realtime?model=${MODEL()}`, { headers: { Authorization: `Bearer ${process.env.APP_OPEN_API_KEY}` } })
    this.ai.on('open', () => this.send({ type: 'session.update', session: {
      type: 'realtime', instructions: instructions(this.agent, this.ctx), output_modalities: ['audio'], tools: tools(this.agent, this.ctx), tool_choice: 'auto',
      audio: { input: { format: { type: 'audio/pcmu' }, transcription: { model: 'gpt-4o-mini-transcribe' }, turn_detection: vad(false) }, output: { format: { type: 'audio/pcmu' }, voice: this.agent.voice } },
    } }))
    this.ai.on('message', (m) => { try { this.onAi(JSON.parse(m)) } catch (e) { this.log(`[AIAgent] event error: ${e.message}`) } })
    this.ai.on('close', () => { if (!this.closed) this.actions.hangup('ai_closed') })
    this.ai.on('error', (e) => this.log(`[AIAgent] OpenAI socket error: ${e.message}`))
    const max = this.agent.maxMinutes * 60000
    this.timers = [setTimeout(() => this.wrapUp('The call time limit is reached.'), Math.max(30000, max - 25000)), setTimeout(() => this.actions.hangup('max_duration'), max + 5000)]
  }

  send(o) { if (this.ai?.readyState === WebSocket.OPEN) this.ai.send(JSON.stringify(o)) }
  // Only one response can run at a time: a create sent while one is running waits for its response.done.
  createResponse(response) {
    if (this.closed) return
    if (this.responding || this.creating) { this.queued = response || {}; return }
    this.creating = true
    this.lastCreate = response || {}
    this.send({ type: 'response.create', ...(response && Object.keys(response).length ? { response } : {}) })
  }
  flush() {
    if (!this.queued || this.responding || this.creating) return
    const r = this.queued
    this.queued = null
    this.createResponse(r)
  }
  toPhone(o) { if (this.media.readyState === WebSocket.OPEN) this.media.send(JSON.stringify(o)) }
  say(role, text) {
    const t = String(text || '').trim()
    if (!t) return
    this.result.transcript.push({ role, text: t, at: new Date() })
    if (this.ctx.test) this.toPhone({ event: 'transcript', role, text: t })
  }

  // Phone side → OpenAI.
  onMedia(msg) {
    if (msg.event === 'media' && msg.media?.payload && msg.media.track !== 'outbound') { this.rec?.addCaller(msg.media.payload); this.send({ type: 'input_audio_buffer.append', audio: msg.media.payload }) }
    else if (msg.event === 'mark') this.onMark(msg.mark?.name)
    else if (msg.event === 'stop') this.stop()
  }

  onMark(name) {
    if (name === 'greeted' && !this.interruptible) {
      this.interruptible = true
      this.send({ type: 'session.update', session: { type: 'realtime', audio: { input: { turn_detection: vad(true) } } } })
    } else if (name === 'end' && this.ending) {
      const how = this.ending
      this.ending = 'done'
      if (how === 'transfer') this.actions.transfer(this.agent.transferTo)
      else if (how === 'hangup') this.actions.hangup('goodbye')
    }
  }

  onAi(e) {
    switch (e.type) {
      case 'session.updated':
        if (this.greeted) break
        this.greeted = true
        this.createResponse({ instructions: `Start the call now. Say exactly this, then stop and listen: "${opening(this.agent, this.ctx.direction, !!this.rec)}"`, tool_choice: 'none' })
        break
      case 'response.created': this.creating = false; this.responding = true; break
      case 'response.output_audio.delta':
        if (this.item !== e.item_id) { this.item = e.item_id; this.itemStart = Date.now(); this.itemMs = 0 }
        this.itemMs += Buffer.byteLength(e.delta, 'base64') / 8
        this.toPhone({ event: 'media', media: { payload: e.delta } })
        this.rec?.addAgent(e.delta)
        break
      case 'input_audio_buffer.speech_started':
        // Caller talks over the agent: stop playback and cut the agent's turn to what was heard.
        if (this.interruptible && !this.ending && this.item) {
          this.toPhone({ event: 'clear' })
          this.rec?.cut()
          this.send({ type: 'conversation.item.truncate', item_id: this.item, content_index: 0, audio_end_ms: Math.max(0, Math.round(Math.min(this.itemMs, Date.now() - this.itemStart))) })
          this.item = null
        }
        break
      case 'response.output_audio_transcript.done': this.say('agent', e.transcript); break
      case 'conversation.item.input_audio_transcription.completed': this.say('caller', e.transcript); break
      case 'response.done': this.responding = false; this.onResponseDone(e.response || {}); this.flush(); break
      case 'error':
        if (e.error?.code !== 'response_cancel_not_active') this.creating = false
        // Our create collided with a response the server started itself (caller spoke): retry after it ends.
        if (e.error?.code === 'conversation_already_has_active_response' && this.lastCreate && !this.queued) this.queued = this.lastCreate
        this.log(`[AIAgent] OpenAI error: ${JSON.stringify(e.error || {}).slice(0, 300)}`)
        this.flush()
        break
      default: break
    }
  }

  onResponseDone(r) {
    this.item = null
    this.result.usage.input += r.usage?.input_tokens || 0
    this.result.usage.output += r.usage?.output_tokens || 0
    if (!this.interruptible && !this.greetMarked) { this.greetMarked = true; this.toPhone({ event: 'mark', mark: { name: 'greeted' } }) }
    if (r.status === 'cancelled') return
    const out = r.output || []
    const calls = out.filter(o => o.type === 'function_call')
    const spoke = out.some(o => o.type === 'message')
    if (this.ending === 'hangup' || this.ending === 'transfer') { if (calls.length) this.reply(calls); this.toPhone({ event: 'mark', mark: { name: 'end' } }); return }
    if (calls.length) this.runTools(calls, spoke).catch(e => this.log(`[AIAgent] tool error: ${e.message}`))
  }

  // Answers every tool call, then either ends the call after the spoken words play, or lets the agent continue.
  // Calendar tools are answered when Google replies; a short filler line covers the wait if the agent said nothing.
  async runTools(calls, spoke) {
    let end = null, note = null
    const outputs = {}
    if (!spoke && calls.some(c => SLOW.has(c.name))) this.filler()
    for (const c of calls) {
      let args = {}
      try { args = JSON.parse(c.arguments || '{}') } catch (_) { /* ignore */ }
      if (SLOW.has(c.name)) outputs[c.call_id] = await this.slowTool(c.name, args)
      else if (c.name === 'end_call') end = end || 'hangup'
      else if (c.name === 'transfer_call' && this.agent.transferTo) { end = 'transfer'; this.result.transferredTo = this.agent.transferTo }
      else if (c.name === 'opt_out') { this.result.optedOut = true; this.result.outcome = 'opted_out'; note = 'Removed from the list. Apologise briefly, say goodbye and call end_call.' }
      else if (c.name === 'record_outcome') { if (!this.result.optedOut && !this.result.booking) this.result.outcome = args.outcome || null; this.result.note = String(args.note || '').slice(0, 300) || null }
      else if (c.name === 'take_message') { this.result.message = { name: String(args.name || '').slice(0, 80), callback: String(args.callback_number || '').slice(0, 30), text: String(args.message || '').slice(0, 1000) }; if (!this.result.optedOut) this.result.outcome = this.result.outcome || 'message' }
    }
    if (this.closed) return
    this.reply(calls, note, outputs)
    if (!end) return this.createResponse()
    this.ending = end
    if (spoke) this.toPhone({ event: 'mark', mark: { name: 'end' } })
    else this.createResponse({ instructions: end === 'transfer' ? 'Tell them in one short sentence that you are connecting them now.' : 'Say a short, friendly goodbye.', tool_choice: 'none' })
  }

  async slowTool(name, args) {
    const cal = this.ctx.calendar
    if (!cal) return { ok: false, error: 'Booking is not available on this call. Offer to take a message instead.' }
    try {
      if (name === 'check_availability') return await cal.check(args)
      const r = await cal.book({ ...args, phone: args.phone || this.ctx.callerNumber || null }, this.result.booking)
      if (!r.ok) return r
      this.result.booking = r.booking
      if (!this.result.optedOut) this.result.outcome = 'booked'
      this.log(`[AIAgent] booked ${r.booking.start} (${r.booking.timeZone}) event=${r.booking.eventId}`)
      return r.reply
    } catch (e) {
      this.log(`[AIAgent] ${name} failed: ${e.code || ''} ${e.message}`)
      return { ok: false, error: 'The calendar could not be reached right now. Apologise and offer to take a message so the business can confirm a time.' }
    }
  }

  // Out-of-band line so the caller doesn't hear silence while the calendar answers (not added to the conversation).
  filler() {
    const o = OPENING[this.agent.language] || OPENING.en
    this.createResponse({ conversation: 'none', input: [], output_modalities: ['audio'], tool_choice: 'none', metadata: { kind: 'filler' }, instructions: `Say only this, warmly and briefly: "${o.wait}"` })
  }

  reply(calls, note, outputs = {}) {
    for (const c of calls) {
      const out = outputs[c.call_id] || { ok: true, ...(note && c.name === 'opt_out' ? { next: note } : {}) }
      this.send({ type: 'conversation.item.create', item: { type: 'function_call_output', call_id: c.call_id, output: JSON.stringify(out) } })
    }
  }

  // Ends the conversation politely (time limit, empty wallet…).
  wrapUp(why) {
    if (this.closed || this.ending) return
    this.ending = 'hangup'
    this.send({ type: 'response.cancel' })
    this.createResponse({ instructions: `${why} Politely wrap up in one sentence and say goodbye now.`, tool_choice: 'none' })
  }

  // Outbound call reached an answering machine: leave one short voicemail, then hang up.
  voicemail() {
    if (this.closed || this.ending) return
    this.result.voicemail = true
    this.ending = 'hangup'
    this.toPhone({ event: 'clear' })
    this.rec?.cut()
    this.send({ type: 'response.cancel' })
    this.createResponse({ instructions: 'You reached voicemail, not a person. Leave one short message (under 20 seconds): who you are, who you are calling for, why, and that they can call back this number. Then say goodbye.', tool_choice: 'none' })
  }

  stop() {
    if (this.closed) return
    this.closed = true
    for (const t of this.timers || []) clearTimeout(t)
    try { this.ai?.close() } catch (_) { /* ignore */ }
  }
}

module.exports = { Bridge, opening, instructions, tools }
