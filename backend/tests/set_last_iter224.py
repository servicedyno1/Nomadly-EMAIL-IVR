import sys, requests
from dotenv import dotenv_values
API = dotenv_values('/app/frontend/.env')['REACT_APP_BACKEND_URL'].rstrip('/') + '/api/cloudivr-web'
s = requests.Session()
s.post(f"{API}/auth/login", json={"email": "civr.alice@example.com", "password": "AliceTest#2026"})
# usage: set_last.py FROM SHOWAS [FROM SHOWAS ...]  (SHOWAS '' = own)
a = sys.argv[1:]
for frm, sa in zip(a[::2], a[1::2]):
    r = s.post(f"{API}/calls/quick", json={"callerId": frm, "targets": ["+14155553002"], "showAs": sa, "text": "TEST_ hello", "mode": "transfer", "transferTo": "+14155553009"})
    print(frm, sa, r.status_code, s.get(f"{API}/caller-ids/presets", params={"from": frm}).json()['last'])
