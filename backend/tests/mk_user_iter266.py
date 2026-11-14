# Helper: register a fresh qa TEST user with preview wallet funds (own account only)
import os, sys, uuid, requests
from pymongo import MongoClient
API = os.environ['REACT_APP_BACKEND_URL'].rstrip('/') + '/api/cloudivr-web'
M = MongoClient(os.environ.get('MONGO_URL', 'mongodb://localhost:27017'))[os.environ.get('DB_NAME', 'test')]
email = f"qa.iter266{uuid.uuid4().hex[:6]}@example.com"
r = requests.post(f"{API}/auth/register", json={"email": email, "password": "QaTest#2026x", "name": "TEST_ qa266"})
acc = r.json()["account"]
M.walletOf.update_one({"_id": acc["id"]}, {"$set": {"usdIn": 300, "usdOut": 0}}, upsert=True)
print(email, acc["id"], acc.get("profileDue"))
