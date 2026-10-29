import os, sys, json, requests
BASE = open('/app/frontend/.env').read().split('REACT_APP_BACKEND_URL=')[1].split()[0].rstrip('/') + '/api/cloudivr-web'
s = requests.Session()
r = s.post(f"{BASE}/auth/login", json={"email": "civr.alice@example.com", "password": "AliceTest#2026"})
print('login', r.status_code, r.text[:200])
for p in sys.argv[1:]:
    r = s.get(BASE + p)
    print('GET', p, r.status_code, r.text[:1500])
