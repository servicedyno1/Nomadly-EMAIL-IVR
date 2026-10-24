// Browser "phone" for test talks: mic → 8 kHz μ-law frames over the same media protocol Telnyx uses, and back.
const BIAS = 0x84, CLIP = 32635;

function encodeMulaw(s) {
  let x = Math.max(-1, Math.min(1, s)) * 32767;
  const sign = x < 0 ? 0x80 : 0;
  x = Math.min(CLIP, Math.abs(x)) + BIAS;
  let exp = 7;
  for (let m = 0x4000; (x & m) === 0 && exp > 0; m >>= 1) exp--;
  return ~(sign | (exp << 4) | ((x >> (exp + 3)) & 0x0f)) & 0xff;
}

function decodeMulaw(b) {
  const u = ~b & 0xff, sign = u & 0x80, exp = (u >> 4) & 7;
  const x = ((((u & 0x0f) << 3) + BIAS) << exp) - BIAS;
  return (sign ? -x : x) / 32768;
}

const toB64 = (bytes) => { let s = ''; for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]); return btoa(s); };
const fromB64 = (b64) => Uint8Array.from(atob(b64), c => c.charCodeAt(0));

// Opens the talk; onEvent gets {event:'transcript'|'notice'|'hangup'|'closed'}. Returns { stop }.
export async function startTalk(url, onEvent) {
  const mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const ws = new WebSocket(url);
  const ratio = ctx.sampleRate / 8000;
  let frame = [], playHead = 0, sources = [], timers = [];
  const send = (o) => ws.readyState === 1 && ws.send(JSON.stringify(o));

  const src = ctx.createMediaStreamSource(mic);
  const proc = ctx.createScriptProcessor(2048, 1, 1);
  let pos = 0;
  proc.onaudioprocess = (e) => {
    const input = e.inputBuffer.getChannelData(0);
    for (; pos < input.length; pos += ratio) {
      frame.push(encodeMulaw(input[Math.floor(pos)]));
      if (frame.length === 160) { send({ event: 'media', media: { track: 'inbound', payload: toB64(frame) } }); frame = []; }
    }
    pos -= input.length;
    e.outputBuffer.getChannelData(0).fill(0);
  };
  src.connect(proc); proc.connect(ctx.destination);

  const play = (b64) => {
    const bytes = fromB64(b64), buf = ctx.createBuffer(1, bytes.length, 8000), ch = buf.getChannelData(0);
    for (let i = 0; i < bytes.length; i++) ch[i] = decodeMulaw(bytes[i]);
    const node = ctx.createBufferSource();
    node.buffer = buf; node.connect(ctx.destination);
    playHead = Math.max(playHead, ctx.currentTime + 0.05);
    node.start(playHead); playHead += buf.duration;
    sources.push(node); node.onended = () => { sources = sources.filter(s => s !== node); };
  };
  // A mark comes back once the audio queued before it has played (like Telnyx).
  const mark = (name) => { const wait = Math.max(0, playHead - ctx.currentTime) * 1000; timers.push(setTimeout(() => send({ event: 'mark', mark: { name } }), wait)); };
  const clear = () => { sources.forEach(s => { try { s.stop(); } catch (_) { /* ended */ } }); sources = []; playHead = ctx.currentTime; };

  ws.onmessage = (m) => {
    const e = JSON.parse(m.data);
    if (e.event === 'media') play(e.media.payload);
    else if (e.event === 'mark') mark(e.mark.name);
    else if (e.event === 'clear') clear();
    else onEvent(e);
  };
  const cleanup = () => { timers.forEach(clearTimeout); proc.disconnect(); src.disconnect(); mic.getTracks().forEach(t => t.stop()); ctx.close().catch(() => {}); };
  ws.onclose = () => { cleanup(); onEvent({ event: 'closed' }); };
  ws.onerror = () => onEvent({ event: 'notice', text: 'Connection problem — try again.' });
  return { stop: () => { send({ event: 'stop' }); setTimeout(() => ws.close(), 200); } };
}
