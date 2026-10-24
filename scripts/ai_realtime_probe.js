const WebSocket = require('ws')
const model = process.argv[2] || 'gpt-realtime-mini'
const ws = new WebSocket(`wss://api.openai.com/v1/realtime?model=${model}`, { headers: { Authorization: `Bearer ${process.env.APP_OPEN_API_KEY}` } })
const t = setTimeout(() => { console.log('TIMEOUT'); process.exit(1) }, 15000)
ws.on('open', () => ws.send(JSON.stringify({ type: 'session.update', session: { type: 'realtime', instructions: 'test', output_modalities: ['audio'], audio: { input: { format: { type: 'audio/pcmu' }, transcription: { model: 'gpt-4o-mini-transcribe' }, turn_detection: { type: 'semantic_vad', eagerness: 'auto', create_response: true, interrupt_response: false } }, output: { format: { type: 'audio/pcmu' }, voice: 'marin' } } } })))
ws.on('message', (m) => { const e = JSON.parse(m); console.log(e.type, e.error ? JSON.stringify(e.error) : ''); if (e.type === 'session.updated' || e.type === 'error') { clearTimeout(t); ws.close(); console.log('fmt', JSON.stringify(e.session?.audio?.input?.format), e.session?.model) } })
ws.on('unexpected-response', (req, res) => { console.log('HTTP', res.statusCode); process.exit(1) })
ws.on('error', (e) => console.log('ERR', e.message))
