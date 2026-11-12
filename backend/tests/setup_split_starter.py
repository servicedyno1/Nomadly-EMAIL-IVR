# Setup for UI test: TEST_ starter account with one Starter number and a $<amount> wallet. Usage: setup_split_starter.py <amount> [release]
import os
import sys

import requests
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env'))
env = os.environ.__getitem__
db = MongoClient(env('MONGO_URL'))[env('DB_NAME')]
API = os.environ['REACT_APP_BACKEND_URL'].rstrip('/') + '/api/cloudivr-web'
EM, PW = "test_civr_split_starter@example.com", "SplitTest#2026"
s = requests.Session()
r = s.post(f"{API}/auth/login", json={"email": EM, "password": PW}); assert r.status_code == 200, r.text
cid = str(int(db.webAccounts.find_one({"email": EM})["_id"]))
def setbal(a):
    w = db.walletOf.find_one({"_id": cid}) or {}
    db.walletOf.update_one({"_id": cid}, {"$set": {"usdIn": (w.get("usdOut") or 0) + a}}, upsert=True)
if len(sys.argv) > 2 and sys.argv[2] == 'release':
    db.phoneNumbersOf.update_one({"_id": cid}, {"$set": {"val.numbers": []}}); setbal(0); print("released", cid); sys.exit()
nums = s.get(f"{API}/numbers").json()["numbers"]
if not nums:
    setbal(100)
    p = s.get(f"{API}/numbers/search", params={"country": "US", "type": "local"}, timeout=60).json()["numbers"][0]["phoneNumber"]
    r = s.post(f"{API}/numbers/checkout", json={"phoneNumber": p, "plan": "starter", "method": "wallet"}); assert r.status_code == 201, r.text
    nums = s.get(f"{API}/numbers").json()["numbers"]
setbal(float(sys.argv[1]))
print(cid, [(n["phoneNumber"], n["plan"]) for n in nums])
