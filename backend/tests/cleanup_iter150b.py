# Cleanup helper for iter150b: hang up dry-run text calls, delete TEST_ audio clips, cancel TEST campaigns (Alice)
import requests
BASE = open('/app/frontend/.env').read().split('REACT_APP_BACKEND_URL=')[1].split()[0].rstrip('/')
API = f"{BASE}/api/cloudivr-web"
s = requests.Session()
s.post(f"{API}/auth/login", json={'email': 'civr.alice@example.com', 'password': 'AliceTest#2026'})
for c in s.get(f"{API}/relay/calls").json().get('calls', []):
    if c.get('status') in ('ringing', 'live'):
        print('hangup', c.get('id'), s.post(f"{API}/relay/calls/{c['id']}/hangup").status_code)
for c in s.get(f"{API}/campaigns").json()['campaigns']:
    if c.get('status') == 'created':
        print('cancel campaign', c['id'], s.post(f"{API}/campaigns/{c['id']}/cancel").status_code)
for a in s.get(f"{API}/audio").json()['audios']:
    if a['name'].startswith('TEST_'):
        print('delete audio', a['name'], s.delete(f"{API}/audio/{a['id']}").status_code)
