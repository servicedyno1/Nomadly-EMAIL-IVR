// QA helper (testing agent): measure word/line counts + bullet/filler checks for the formatting cases
require('dotenv').config({ path: require('path').join(__dirname, '../backend/.env') })
const { MongoClient } = require('mongodb')
const ai = require('../js/ai-support.js')
const QS = [
  ['qa_m_sip', 'How do I buy a SIP number and use it for calls?'],
  ['qa_m_panel', 'How do I access my hosting panel?'],
  ['qa_m_vps', 'How do I set up a VPS and connect to it?'],
  ['qa_m_fr', 'Comment acheter un numéro SIP ?'],
]
;(async () => {
  const client = new MongoClient(process.env.MONGO_URL || 'mongodb://localhost:27017')
  await client.connect()
  await ai.initAiSupport(client.db('test'))
  const runs = parseInt(process.argv[2] || '2')
  for (let r = 0; r < runs; r++) for (const [id, q] of QS) {
    try { await ai.clearHistory(id) } catch (_) {}
    const res = await ai.getAiResponse(id, q, id === 'qa_m_fr' ? 'fr' : 'en')
    const t = typeof res === 'string' ? res : (res && (res.response || res.text)) || ''
    const w = t.split(/\s+/).filter(Boolean).length
    const lines = t.split('\n').filter(s => s.trim())
    const dash = lines.some(l => /^\s*-\s/.test(l)), dot = lines.some(l => /^\s*•\s/.test(l))
    const filler = /anything else|need help with anything|let me know if/i.test(t)
    const tagsOk = (t.match(/<b>/g) || []).length === (t.match(/<\/b>/g) || []).length
    console.log(`[run${r + 1}] ${id}: words=${w} lines=${lines.length} mixedBullets=${dash && dot} filler=${filler} boldBalanced=${tagsOk}`)
    if (r === 0) console.log('---\n' + t + '\n---')
  }
  await client.close(); process.exit(0)
})().catch(e => { console.error(e); process.exit(1) })
