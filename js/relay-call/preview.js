'use strict'
// Preview mode (WEB_CLOUDIVR_DRY_RUN): nothing is dialed; a pretend person answers and replies so the screen can be tried.
const REPLIES = {
  en: ['Hello? Yes, I can hear the message.', 'Okay, sure. Let me check that for you.', 'Got it. Is there anything else?', 'Thanks for calling. Have a nice day.'],
  es: ['¿Hola? Sí, escucho el mensaje.', 'Claro, déjeme revisarlo.', 'Entendido. ¿Algo más?', 'Gracias por llamar. Que tenga un buen día.'],
  fr: ['Allô ? Oui, j’entends le message.', 'D’accord, je regarde ça pour vous.', 'C’est noté. Autre chose ?', 'Merci de votre appel. Bonne journée.'],
}
const later = (s, ms, fn) => { (s.simTimers = s.simTimers || []).push(setTimeout(fn, ms)) }

// Says the words one by one as interim text, then the full sentence as final.
function speak(s, text, onText, delay) {
  const words = text.split(' ')
  words.forEach((_, i) => later(s, delay + i * 220, () => onText(s, words.slice(0, i + 1).join(' '), false)))
  later(s, delay + words.length * 220 + 300, () => onText(s, text, true))
}

function ring(s, { answered, onText }) {
  later(s, 3000, async () => {
    await answered(s)
    if (s.announce) later(s, 2500, () => { s.speaking = Math.max(0, s.speaking - 1) })
    s.simTurn = 0
    speak(s, (REPLIES[s.lang] || REPLIES.en)[0], onText, s.announce ? 3000 : 800)
  })
}

function reply(s, text, { onText, spoke }) {
  const read = Math.min(6000, 600 + text.length * 45)
  later(s, read, spoke)
  const list = REPLIES[s.lang] || REPLIES.en
  s.simTurn = Math.min(list.length - 1, (s.simTurn || 0) + 1)
  speak(s, list[s.simTurn], onText, read + 700)
}

const stop = (s) => { (s.simTimers || []).forEach(clearTimeout); s.simTimers = [] }

module.exports = { ring, reply, stop }
