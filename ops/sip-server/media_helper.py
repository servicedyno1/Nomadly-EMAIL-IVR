#!/usr/bin/env python3
# Media helper for the call engine (Asterisk can only play 8 kHz wav): converts any audio URL, and speaks text as a last resort.
# GET /c.wav?u=<base64url of audio URL>   GET /tts.wav?t=<base64url text>&g=female|male&l=en
import base64, hashlib, os, subprocess, urllib.parse, urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

CACHE = '/var/cache/callengine'
os.makedirs(CACHE, exist_ok=True)
b64 = lambda s: base64.urlsafe_b64decode(s + '=' * (-len(s) % 4)).decode()

def convert(src, out):
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', src, '-ar', '8000', '-ac', '1', '-acodec', 'pcm_s16le', out], check=True, timeout=60)

class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_GET(self):
        q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        try:
            if self.path.startswith('/c.wav'):
                url = b64(q['u'][0]); out = f"{CACHE}/{hashlib.sha1(url.encode()).hexdigest()}.wav"
                if not os.path.exists(out):
                    tmp = out + '.src'
                    with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'CloudIVR'}), timeout=30) as r, open(tmp, 'wb') as f: f.write(r.read())
                    convert(tmp, out); os.remove(tmp)
            elif self.path.startswith('/tts.wav'):
                text = b64(q['t'][0]); g = q.get('g', ['female'])[0]; lang = q.get('l', ['en'])[0][:2]
                out = f"{CACHE}/tts-{hashlib.sha1((text + g + lang).encode()).hexdigest()}.wav"
                if not os.path.exists(out):
                    raw = out + '.raw.wav'
                    subprocess.run(['espeak-ng', '-v', f"{lang}+{'m3' if g == 'male' else 'f3'}", '-s', '150', '-w', raw, text], check=True, timeout=30)
                    convert(raw, out); os.remove(raw)
            else:
                self.send_response(404); self.end_headers(); return
            data = open(out, 'rb').read()
            self.send_response(200); self.send_header('Content-Type', 'audio/wav'); self.send_header('Content-Length', str(len(data))); self.end_headers(); self.wfile.write(data)
        except Exception as e:
            self.send_response(502); self.end_headers(); self.wfile.write(str(e).encode()[:200])

ThreadingHTTPServer(('127.0.0.1', 8090), H).serve_forever()
