# iter284: uxtest (temp legal profile) - quick record after success, campaign validateOnly/503 no record
import os, requests
from pymongo import MongoClient
def _env(k):
    for line in open('/app/backend/.env'):
        if line.startswith(k + '='):
            return line.split('=', 1)[1].strip().strip('"')
db = MongoClient(_env('MONGO_URL'))[_env('DB_NAME')]
API = os.environ.get('REACT_APP_BACKEND_URL').rstrip('/') + "/api/cloudivr-web"
cid = '5000000000000077'
a = db.webAccounts.find_one({"email": "civr.uxtest@example.com"})
print("quickAt", a.get("quickIvrPermissionAt"))
print("records", [(d["kind"], d.get("campaign"), str(d["at"])) for d in db.callPermissions.find({"chatId": cid})])
s = requests.Session()
s.post(f"{API}/auth/login", json={"email": "civr.uxtest@example.com", "password": "UxTest#2026"})
base = {"name": "TEST_perm284_ux", "leads": "+14155550100\n+14155550101,+14155550102", "callerId": "+13341112222", "mode": "ivr", "scheduledFor": None}
r = s.post(f"{API}/campaigns", json={**base, "validateOnly": True, "audioPending": True})
print("validateOnly (no confirm)", r.status_code, r.text[:200])
r = s.post(f"{API}/campaigns", json={**base, "audioId": "aud-split-test"})
print("real no confirm", r.status_code, r.text[:200])
r = s.post(f"{API}/campaigns", json={**base, "audioId": "aud-split-test", "permissionConfirmed": True})
print("real confirmed", r.status_code, r.text[:200])
import time; time.sleep(1)
print("campaign records", db.callPermissions.count_documents({"chatId": cid, "kind": "campaign"}))
