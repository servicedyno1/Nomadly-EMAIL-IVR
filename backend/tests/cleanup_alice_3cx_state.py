# Cleanup helper: leaves Alice tidy after 3CX feature tests (triggers OFF, ring group OFF, AI summaries auto OFF, webhook disabled)
import os
import urllib.parse
import requests

BASE = os.environ['REACT_APP_BACKEND_URL'].rstrip('/')
API = f"{BASE}/api/cloudivr-web"
BIZ = '+16692098449'
enc = lambda p: urllib.parse.quote(p, safe='')

s = requests.Session()
assert s.post(f"{API}/auth/login", json={'email': 'civr.alice@example.com', 'password': 'AliceTest#2026'}).status_code == 200
bal = lambda: s.get(f"{API}/wallet").json() if s.get(f"{API}/wallet").ok else None

# re-summarize a done row must be free / cached
logs = s.get(f"{API}/numbers/{enc(BIZ)}/logs?kind=all").json()['logs']
vm = [l for l in logs if l['id'] == '6ade2df3f74a7e050f46a259'][0]
r = s.post(f"{API}/numbers/{enc(BIZ)}/logs/{vm['id']}/summarize")
print('re-summarize:', r.status_code, (r.json().get('aiSummary') or {}).get('status'), (r.json().get('aiSummary') or {}).get('charge'))

for p in ['+16692098449', '+14179247738']:
    tt = s.get(f"{API}/numbers/{enc(p)}/text-triggers").json()['textTriggers']
    print(p, 'triggers off:', s.put(f"{API}/numbers/{enc(p)}/text-triggers", json={**tt, 'enabled': False}).status_code)
    n = s.get(f"{API}/numbers/{enc(p)}").json()
    n = n.get('number', n)
    rg = n['features'].get('ringGroup') or {}
    body = {**rg, 'enabled': False}
    print(p, 'ring group off:', s.put(f"{API}/numbers/{enc(p)}/ring-group", json=body).status_code)
    print(p, 'ai summary off:', s.patch(f"{API}/numbers/{enc(p)}/ai-summary", json={'enabled': False}).status_code)

w = s.get(f"{API}/webhooks").json()['webhook']
print('webhook disabled:', s.put(f"{API}/webhooks", json={'enabled': False, 'url': w['url'], 'events': ['call.started', 'call.ended', 'voicemail.left', 'sms.received', 'ai_summary.ready']}).status_code)

n = s.get(f"{API}/numbers/{enc(BIZ)}").json()
n = n.get('number', n)
f = n['features']
print('FINAL', BIZ, 'ivr:', f.get('ivr', {}).get('enabled'), 'triggers:', f.get('textTriggers', {}).get('enabled'),
      'ringGroup:', f.get('ringGroup', {}).get('enabled'), 'aiSummary:', f.get('aiSummary', {}).get('enabled'),
      'route:', n.get('routeSummary', {}).get('primary'))
print('FINAL webhook:', s.get(f"{API}/webhooks").json()['webhook']['enabled'])
