# Creates a TEST_ CloudIVR web user, then clears its policy acceptance (register now records it) so the PolicyGate can be tested in UI
import time, requests
from pymongo import MongoClient
from dotenv import dotenv_values
BASE = [l.split('=', 1)[1].strip() for l in open('/app/frontend/.env') if l.startswith('REACT_APP_BACKEND_URL=')][0].rstrip('/')
API = f"{BASE}/api/cloudivr-web"
s = requests.Session()
email = f"test_gate{int(time.time())}@example.com"
r = s.post(f"{API}/auth/register", json={'email': email, 'password': 'TestGate#2026', 'name': 'TEST_Gate', 'acceptPolicy': True})
cid = r.json()['account']['id']
print(r.status_code, cid)
print(s.put(f"{API}/profile/legal", json={'type': 'business', 'fullName': 'TEST Gate', 'companyName': 'TEST_Gate GmbH',
      'address': {'line1': 'Teststr 1', 'city': 'Berlin', 'postalCode': '10115', 'countryCode': 'DE'}}).status_code)
print(s.put(f"{API}/prefs/onboarding", json={'purposes': []}).status_code)
env = dotenv_values('/app/backend/.env')
MongoClient(env['MONGO_URL'])[env['DB_NAME']].compliance.update_one({'_id': str(cid)}, {'$unset': {'policy': 1}})
print(s.get(f"{API}/compliance").json()['policy'])
print("EMAIL", email, "TestGate#2026")
