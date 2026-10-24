'use strict'
// One live AI conversation: phone audio in the Telnyx media-stream protocol (μ-law 8 kHz) ⇄ OpenAI Realtime speech-to-speech.
// The phone side is a Telnyx stream or the browser tester; `actions` does hangup/transfer for that side.
const WebSocket = require('ws')
const { LANG_NAMES } = require('./store')

const MODEL = () => process.env.AI_AGENT_MODEL || 'gpt-realtime-mini'
const OPENING = {
  en: { in: (n, b) => `Thanks for calling${b ? ` ${b}` : ''}. I'm ${n}, an AI assistant.`, out: (n, b) => `Hi, this is ${n}, an AI assistant calling${b ? ` for ${b}` : ''}.`, askIn: 'How can I help you today?', askOut: 'Do you have a minute?' },
  fr: { in: (n, b) => `Merci d'avoir appelé${b ? ` ${b}` : ''}. Je suis ${n}, un assistant IA.`, out: (n, b) => `Bonjour, ici ${n}, un assistant IA qui appelle${b ? ` de la part de ${b}` : ''}.`, askIn: 'Comment puis-je vous aider ?', askOut: 'Avez-vous une minute ?' },
  es: { in: (n, b) => `Gracias por llamar${b ? ` a ${b}` : ''}. Soy ${n}, un asistente de IA.`, out: (n, b) => `Hola, soy ${n}, un asistente de IA que llama${b ? ` de parte de ${b}` : ''}.`, askIn: '¿En qué puedo ayudarle?', askOut: '¿Tiene un minuto?' },
}

// The AI disclosure always opens the call and cannot be interrupted.
function opening(agent, direction) {
  const o = OPENING[agent.language] || OPENING.en, out = direction === 'outbound'
  return `${out ? o.out(agent.name, agent.businessName) : o.in(agent.name, agent.businessName)} ${agent.greeting || (out ? o.askOut : o.askIn)}`
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
  ].filter(Boolean).join('\n')
}

const fn = (name, description, properties = {}, required = []) => ({ type: 'function', name, description, parameters: { type: 'object', properties, required } })
function tools(agent) {
  const t = [
    fn('end_call', 'Hang up. Use after saying goodbye.'),
    fn('record_outcome', 'Save how the conversation went.', { outcome: { type: 'string', enum: ['interested', 'not_interested', 'callback'] }, note: { type: 'string', description: 'One short sentence, e.g. a good time to call back.' } }, ['outcome']),
    fn('opt_out', 'The person asked not to be called again.'),
  ]
  if (agent.transferTo) t.push(fn('transfer_call', 'Connect the person to a human at the business now.'))
  if (agent.takeMessages) t.push(fn('take_message', 'Save a message for the business.', { name: { type: 'string' }, callback_number: { type: 'string' }, message: { type: 'string' } }, ['message']))
  return t
}

const vad = (interrupt) => ({ type: 'semantic_vad', eagerness: 'auto', create_response: true, interrupt_response: interrupt })

class Bridge {
  constructor({ agent, ctx, media, actions, log = console.log }) {
    Object.assign(this, { agent, ctx, media, actions, log })
    this.result = { transcript: [], outcome: null, note: null, message: null, optedOut: false, transferredTo: null, voicemail: false, usage: { input: 0, output: 0 } }
    this.closed = false
    this.interruptible = false
    this.ending = null // 'hangup' | 'transfer' once the last words are queued
  }

  start() {
    this.ai = new WebSocket(`wss://api.openai.com/v1/realtime?model=${MODEL()}`, { headers: { Authorization: `Bearer ${process.env.APP_OPEN_API_KEY}` } })
    this.ai.on('open', () => this.send({ type: 'session.update', session: {
      type: 'realtime', instructions: instructions(this.agent, this.ctx), output_modalities: ['audio'], tools: tools(this.agent), tool_choice: 'auto',
      audio: { input: { format: { type: 'audio/pcmu' }, transcription: { model: 'gpt-4o-mini-transcribe' }, turn_detection: vad(false) }, output: { format: { type: 'audio/pcmu' }, voice: this.agent.voice } },
    } }))
    this.ai.on('message', (m) => { try { this.onAi(JSON.parse(m)) } catch (e) { this.log(`[AIAgent] event error: ${e.message}`) } })
    this.ai.on('close', () => { if (!this.closed) this.actions.hangup('ai_closed') })
    this.ai.on('error', (e) => this.log(`[AIAgent] OpenAI socket error: ${e.message}`))
    const max = this.agent.maxMinutes * 60000
    this.timers = [setTimeout(() => this.wrapUp('The call time limit is reached.'), Math.max(30000, max - 25000)), setTimeout(() => this.actions.hangup('max_duration'), max + 5000)]
  }

  send(o) { if (this.ai?.readyState === WebSocket.OPEN) this.ai.send(JSON.stringify(o)) }
  toPhone(o) { if (this.media.readyState === WebSocket.OPEN) this.media.send(JSON.stringify(o)) }
  say(role, text) {
    const t = String(text || '').trim()
    if (!t) return
    this.result.transcript.push({ role, text: t, at: new Date() })
    if (this.ctx.test) this.toPhone({ event: 'transcript', role, text: t })
  }

  // Phone side → OpenAI.
  onMedia(msg) {
    if (msg.event === 'media' && msg.media?.payload && msg.media.track !== 'outbound') this.send({ type: 'input_audio_buffer.append', audio: msg.media.payload })
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
        this.send({ type: 'response.create', response: { instructions: `Start the call now. Say exactly this, then stop and listen: "${opening(this.agent, this.ctx.direction)}"`, tool_choice: 'none' } })
        break
      case 'response.output_audio.delta':
        if (this.item !== e.item_id) { this.item = e.item_id; this.itemStart = Date.now(); this.itemMs = 0 }
        this.itemMs += Buffer.byteLength(e.delta, 'base64') / 8
        this.toPhone({ event: 'media', media: { payload: e.delta } })
        break
      case 'input_audio_buffer.speech_started':
        // Caller talks over the agent: stop playback and cut the agent's turn to what was heard.
        if (this.interruptible && !this.ending && this.item) {
          this.toPhone({ event: 'clear' })
          this.send({ type: 'conversation.item.truncate', item_id: this.item, content_index: 0, audio_end_ms: Math.max(0, Math.round(Math.min(this.itemMs, Date.now() - this.itemStart))) })
          this.item = null
        }
        break
      case 'response.output_audio_transcript.done': this.say('agent', e.transcript); break
      case 'conversation.item.input_audio_transcription.completed': this.say('caller', e.transcript); break
      case 'response.done': this.onResponseDone(e.response || {}); break
      case 'error': this.log(`[AIAgent] OpenAI error: ${JSON.stringify(e.error || {}).slice(0, 300)}`); break
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
    if (calls.length) this.runTools(calls, spoke)
  }

  // Answers every tool call, then either ends the call after the spoken words play, or lets the agent continue.
  runTools(calls, spoke) {
    let end = null, note = null
    for (const c of calls) {
      let args = {}
      try { args = JSON.parse(c.arguments || '{}') } catch (_) { /* ignore */ }
      if (c.name === 'end_call') end = end || 'hangup'
      else if (c.name === 'transfer_call' && this.agent.transferTo) { end = 'transfer'; this.result.transferredTo = this.agent.transferTo }
      else if (c.name === 'opt_out') { this.result.optedOut = true; this.result.outcome = 'opted_out'; note = 'Removed from the list. Apologise briefly, say goodbye and call end_call.' }
      else if (c.name === 'record_outcome') { if (!this.result.optedOut) this.result.outcome = args.outcome || null; this.result.note = String(args.note || '').slice(0, 300) || null }
      else if (c.name === 'take_message') { this.result.message = { name: String(args.name || '').slice(0, 80), callback: String(args.callback_number || '').slice(0, 30), text: String(args.message || '').slice(0, 1000) }; if (!this.result.optedOut) this.result.outcome = this.result.outcome || 'message' }
    }
    this.reply(calls, note)
    if (!end) return this.send({ type: 'response.create' })
    this.ending = end
    if (spoke) this.toPhone({ event: 'mark', mark: { name: 'end' } })
    else this.send({ type: 'response.create', response: { instructions: end === 'transfer' ? 'Tell them in one short sentence that you are connecting them now.' : 'Say a short, friendly goodbye.', tool_choice: 'none' } })
  }

  reply(calls, note) {
    for (const c of calls) this.send({ type: 'conversation.item.create', item: { type: 'function_call_output', call_id: c.call_id, output: JSON.stringify({ ok: true, ...(note && c.name === 'opt_out' ? { next: note } : {}) }) } })
  }

  // Ends the conversation politely (time limit, empty wallet…).
  wrapUp(why) {
    if (this.closed || this.ending) return
    this.ending = 'hangup'
    this.send({ type: 'response.cancel' })
    this.send({ type: 'response.create', response: { instructions: `${why} Politely wrap up in one sentence and say goodbye now.`, tool_choice: 'none' } })
  }

  // Outbound call reached an answering machine: leave one short voicemail, then hang up.
  voicemail() {
    if (this.closed || this.ending) return
    this.result.voicemail = true
    this.ending = 'hangup'
    this.toPhone({ event: 'clear' })
    this.send({ type: 'response.cancel' })
    this.send({ type: 'response.create', response: { instructions: 'You reached voicemail, not a person. Leave one short message (under 20 seconds): who you are, who you are calling for, why, and that they can call back this number. Then say goodbye.', tool_choice: 'none' } })
  }

  stop() {
    if (this.closed) return
    this.closed = true
    for (const t of this.timers || []) clearTimeout(t)
    try { this.ai?.close() } catch (_) { /* ignore */ }
  }
}

module.exports = { Bridge, opening, instructions }
