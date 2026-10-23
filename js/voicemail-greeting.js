'use strict'
// Standard voicemail greetings + off-hours messages in the languages callers can hear (Telnyx speech).
// `tts` is the Telnyx speak `language`; text is spoken with the female voice.
const LANGS = {
  en: {
    label: 'English', tts: 'en-US',
    greeting: (n) => `The person at ${n} is unavailable. Please leave a message after the tone.`,
    closed: 'Thank you for calling. We are closed right now. Please call back during our opening hours.',
    closedVm: 'Thank you for calling. We are closed right now. Please leave a message after the tone.',
  },
  fr: {
    label: 'Français', tts: 'fr-FR',
    greeting: (n) => `Votre correspondant au ${n} n'est pas disponible. Veuillez laisser un message après le bip.`,
    closed: 'Merci de votre appel. Nous sommes actuellement fermés. Veuillez rappeler pendant nos heures d’ouverture.',
    closedVm: 'Merci de votre appel. Nous sommes actuellement fermés. Veuillez laisser un message après le bip.',
  },
  pt: {
    label: 'Português', tts: 'pt-BR',
    greeting: (n) => `A pessoa no número ${n} não está disponível. Por favor, deixe uma mensagem após o sinal.`,
    closed: 'Obrigado pela sua ligação. Estamos fechados no momento. Por favor, ligue novamente no nosso horário de atendimento.',
    closedVm: 'Obrigado pela sua ligação. Estamos fechados no momento. Por favor, deixe uma mensagem após o sinal.',
  },
  ar: {
    label: 'العربية', tts: 'arb',
    greeting: (n) => `الشخص على الرقم ${n} غير متاح حاليًا. يرجى ترك رسالة بعد سماع الصافرة.`,
    closed: 'شكرًا لاتصالك. نحن مغلقون الآن. يرجى معاودة الاتصال خلال ساعات العمل.',
    closedVm: 'شكرًا لاتصالك. نحن مغلقون الآن. يرجى ترك رسالة بعد سماع الصافرة.',
  },
}
const langOf = (code) => LANGS[code] || LANGS.en

// Digits read one by one in any language: "+15156442785" → "1, 5 1 5, 6 4 4, 2 7 8 5".
function spokenNumber(phone) {
  const d = String(phone || '').replace(/\D/g, '')
  if (d.length === 11 && d[0] === '1') return [d[0], d.slice(1, 4), d.slice(4, 7), d.slice(7)].map(g => g.split('').join(' ')).join(', ')
  return (d.match(/.{1,3}/g) || []).map(g => g.split('').join(' ')).join(', ')
}

// { text, language } for the standard greeting of `phone`.
const standardGreeting = (code, phone) => ({ text: langOf(code).greeting(spokenNumber(phone)), language: langOf(code).tts })

// { text, language } spoken outside the number's hours (custom text wins).
function closedMessage(code, custom, withVoicemail) {
  const l = langOf(code)
  return { text: String(custom || '').trim() || (withVoicemail ? l.closedVm : l.closed), language: l.tts }
}

const LANG_CODES = Object.keys(LANGS)
const publicLangs = () => LANG_CODES.map(code => ({ code, label: LANGS[code].label, sample: LANGS[code].greeting('…') }))

module.exports = { LANGS, LANG_CODES, langOf, spokenNumber, standardGreeting, closedMessage, publicLangs }
