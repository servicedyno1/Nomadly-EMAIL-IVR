'use strict'
// What the agent says first, and the cleaned-up script the model reads.
//  - An owner's own first message may use {name}, {business} and {lead_name}.
//  - The AI disclosure and (on recorded calls) the recording notice are added only when the owner's text leaves them out.
//  - Stage directions such as "[PAUSE]" are removed before the model sees the script, so they are never read aloud.
const { LANGUAGES } = require('./languages')

const SAMPLE_LEAD = 'Alex' // lead name used for browser tests and the form preview
const lang = (agent) => LANGUAGES[agent?.language] || LANGUAGES.en

// "[Client Full Name]", "[First Name]", "[Lead name]" … → the lead's name.
const NAME_SLOT = /\[\s*(?:(?:client|customer|lead|contact|caller|prospect|recipient|person)(?:'s)?\s*)?(?:(?:full|first|last)\s*)?name\s*\]/gi
// {lead_name|there} → "there" when the lead has no name.
const TOKEN = /\{\{?\s*(name|agent_name|business|business_name|lead_name|lead|first_name|client_name)\s*(?:\|\s*([^{}|\n]{1,40}?)\s*)?\}?\}/gi

function tidy(s) {
  return String(s || '')
    .replace(/[ \t]+/g, ' ')
    .replace(/ +([,.!?;:。！？，])/g, '$1')
    .replace(/([,;:，])\s*(?=[,.!?;:。！？])/g, '')
    .replace(/(^|\n)\s*[,.;:]\s*/g, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

// Placeholders → values. Unknown lead name: the slot disappears ("Hi {lead_name}," → "Hi,").
function fill(text, { name = '', business = '', leadName = '' } = {}) {
  return String(text || '')
    .replace(TOKEN, (_, k, fallback = '') => {
      k = k.toLowerCase()
      if (k === 'name' || k === 'agent_name') return name || fallback
      if (k === 'business' || k === 'business_name') return business || fallback
      return leadName || fallback || EMPTY
    })
    .replace(NAME_SLOT, leadName || EMPTY)
}
// A lead name slot that stayed empty: drop it with the little word in front ("speak with {lead_name}?" → "speak with them?").
const EMPTY = '\u0000'
function dropEmpty(s) {
  return s
    .replace(/\b(speak|talk)\s+(with|to)\s+\u0000/gi, '$1 $2 the right person')
    .replace(/\b(is this|am I speaking with|am I talking to)\s+\u0000/gi, '$1 the right person')
    .replace(/\s*\u0000/g, '')
}

// Bracketed notes and ALL-CAPS stage directions are for the owner, not the caller.
function stripNotes(text) {
  return String(text || '')
    .replace(/\[[^\]\n]{0,200}\]/g, '')
    .replace(/\((?=[^)\n]*[A-Z]{3})[A-Z0-9 ,.'’:;!?-]{3,80}\)/g, '')
    .replace(/\*\s*(pause|beat|wait|silence|laughs?|smiles?|sighs?)[^*\n]{0,60}\*/gi, '')
    .split('\n').map(l => l.replace(/[ \t]+/g, ' ').replace(/ +([,.!?;:])/g, '$1').trimEnd()).join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

const AI_WORDS_CASED = /(^|[^A-Za-z])(AI|A\.I\.|IA|KI|ИИ)([^A-Za-z]|$)/
const AI_WORDS = /(artificial intelligence|intelligence artificielle|inteligencia artificial|intelig[eê]ncia artificial|k[üu]nstliche intelligenz|intelligenza artificiale|kunstmatige intelligentie|ذكاء اصطناعي|बुद्धिमत्ता|人工智能|人工知能|인공지능|искусственн|yapay zek|sztuczn|בינה מלאכותית|inteligen[țt][aă] artificial|um[eě]l[aá] inteligence|trí tuệ nhân tạo|kecerdasan buatan|virtual assistant|automated assistant|robot)/i
const REC_WORDS = /(record|grabad|grabaci|enregistr|gravad|grava[çc]|aufgezeichnet|aufgenommen|aufzeichn|registrat|registraz|opgenomen|تسجيل|مسجل|रिकॉर्ड|录音|録音|녹음|запис|kaydedil|kayd|nagryw|מוקלט|הקלט|[îi]nregistr|nahr[aá]v|ghi [aâ]m|direkam|rekam)/i
const hasAi = (t) => AI_WORDS_CASED.test(t) || AI_WORDS.test(t)
const hasRec = (t) => REC_WORDS.test(t)

const SENTENCES = /[^.!?。！？]+(?:[.!?。！？]+|$)\s*/g
const upFirst = (s) => s.charAt(0).toLocaleUpperCase() + s.slice(1)

// Adds the missing notices where they sound natural: before the closing question, after a short "Hi," — else at the end.
function withNotices(text, { agent, recorded }) {
  const o = lang(agent)
  const discloseAi = agent.discloseAi !== false
  const needAi = discloseAi && !hasAi(text), needRec = !!recorded && !hasRec(text)
  if (!needAi && !needRec) return { text, aiAdded: false, recAdded: false }
  const named = agent.name && text.toLowerCase().includes(String(agent.name).toLowerCase())
  const add = [needAi ? (named ? o.aiBare : o.ai(agent.name || 'Ava')) : '', needRec ? o.rec : ''].filter(Boolean).join(' ')
  const parts = (text.match(SENTENCES) || [text]).map(s => s.trim()).filter(Boolean)
  const last = parts[parts.length - 1] || ''
  let out
  if (/[?？]$/.test(last) && parts.length > 1) out = [...parts.slice(0, -1), add, last].join(' ')
  else if (/[?？]$/.test(last)) {
    const m = /^([^,，、]{1,24}[,，、])\s*(.+)$/.exec(last)
    out = m && m[1].trim().split(/\s+/).length <= 3 ? `${m[1]} ${add} ${upFirst(m[2])}` : `${add} ${last}`
  } else out = `${text} ${add}`
  return { text: tidy(out), aiAdded: needAi, recAdded: needRec }
}

// The standard opening (no first message): intro + recording notice + the old "opening line" or a default question.
// When the owner turns the AI disclosure off, a plain intro (no "AI assistant") is used.
function standard(agent, direction, recorded) {
  const o = lang(agent), out = direction === 'outbound'
  const disclose = agent.discloseAi !== false
  const intro = out ? (disclose ? o.out : o.outPlain)(agent.name, agent.businessName) : (disclose ? o.in : o.inPlain)(agent.name, agent.businessName)
  return `${intro}${recorded ? ` ${o.rec}` : ''} ${agent.greeting || (out ? o.askOut : o.askIn)}`
}

// → { text, custom, aiAdded, recAdded }
function openingInfo(agent, direction, recorded = false, leadName = null) {
  const own = String(agent.firstMessage || '').trim()
  if (!own) return { text: standard(agent, direction, recorded), custom: false, aiAdded: false, recAdded: false }
  const filled = tidy(dropEmpty(stripNotes(fill(own, { name: agent.name, business: agent.businessName, leadName: direction === 'outbound' ? leadName : '' }))))
  if (!filled) return { text: standard(agent, direction, recorded), custom: false, aiAdded: false, recAdded: false }
  return { ...withNotices(filled, { agent, recorded }), custom: true }
}
const opening = (agent, direction, recorded = false, leadName = null) => openingInfo(agent, direction, recorded, leadName).text

// Script / FAQ text as the model gets it: placeholders filled, stage directions gone.
function prepare(text, agent, leadName) {
  return dropEmpty(stripNotes(fill(text, { name: agent.name, business: agent.businessName, leadName: leadName || 'the person' })))
}

module.exports = { SAMPLE_LEAD, fill, stripNotes, tidy, hasAi, hasRec, withNotices, openingInfo, opening, prepare }
