# iter284: stuck lookup batch GET -> 410 check_failed + refund (uxtest batch bmwh09az7jzm)
import os, requests
from pymongo import MongoClient
def _env(k):
    for line in open('/app/backend/.env'):
        if line.startswith(k + '='):
            return line.split('=', 1)[1].strip().strip('"')
mdb = MongoClient(_env('MONGO_URL'))[_env('DB_NAME')]
API = os.environ.get('REACT_APP_BACKEND_URL').rstrip('/') + "/api/cloudivr-web"
s = requests.Session()
r = s.post(f"{API}/auth/login", json={"email": "civr.uxtest@example.com", "password": "UxTest#2026"})
print("login", r.status_code)
cid = '5000000000000077'
print("wallet before", mdb.walletOf.find_one({"_id": cid}))
print("batch before", {k: v for k, v in mdb.lookupBatches.find_one({"_id": "bmwh09az7jzm"}).items() if k in ('status', 'refunded', 'price', 'total')})
r = s.get(f"{API}/lookup/batches/bmwh09az7jzm")
print("GET", r.status_code, r.text[:300])
print("wallet after", mdb.walletOf.find_one({"_id": cid}))
print("batch after", {k: v for k, v in mdb.lookupBatches.find_one({"_id": "bmwh09az7jzm"}).items() if k in ('status', 'refunded', 'price', 'total')})
r = s.get(f"{API}/lookup")
print("batches list", [(b['batchId'], b['status'], b['kind'], b['total']) for b in r.json().get('batches', [])], "emailPrice", r.json().get('emailPrice'))
r = s.get(f"{API}/lookup/batches/doesnotexist")
print("404 check", r.status_code, r.text[:120])
