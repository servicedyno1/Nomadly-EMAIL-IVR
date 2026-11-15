# Iteration 297 helper: inspect fax state / seed calling number for UI retest (not a pytest module)
import sys, datetime, requests, os
sys.path.insert(0, '/app/backend/tests')
from test_iter296_pay_then_details import _mongo, CHAT, SEED_PHONE

BASE = open('/app/frontend/.env').read().split('REACT_APP_BACKEND_URL=')[1].split()[0].rstrip('/')
API = f"{BASE}/api/cloudivr-web"
db = _mongo()
cmd = sys.argv[1]
s = requests.Session()
s.post(f"{API}/auth/login", json={"email": "civr.uxtest@example.com", "password": "UxTest#2026"})

if cmd == 'state':
    print('wallet', s.get(f"{API}/wallet").json().get('balance'))
    for n in s.get(f"{API}/fax").json()['numbers']:
        print(n['phoneNumber'], n['status'], n['eligible'], n['faxOnly'], n['countryName'], n['registration'] and n['registration'].get('needsDetails'))
    print('faxNumbers active/pending:', [(d['_id'], d['status']) for d in db.faxNumbers.find({"chatId": CHAT, "status": {"$nin": ["released"]}})])
elif cmd == 'seed':
    db.phoneNumbersOf.update_one({"_id": CHAT}, {"$pull": {"val.numbers": {"phoneNumber": SEED_PHONE}}})
    db.phoneNumbersOf.update_one({"_id": CHAT}, {"$push": {"val.numbers": {
        "phoneNumber": SEED_PHONE, "provider": "multitel", "status": "active", "country": "DE", "type": "local",
        "plan": "business", "planPrice": 120, "dryRun": True,
        "registration": {"status": "needs_details", "level": 2, "since": datetime.datetime.utcnow().isoformat() + "Z", "paid": 120}}}})
    w = db.walletOf.find_one({"_id": CHAT})
    import json
    open('/tmp/w0.json', 'w').write(json.dumps(w, default=str))
    print('seeded; wallet snapshot saved', {k: w.get(k) for k in w if k != '_id'})
elif cmd == 'unseed':
    import json
    db.phoneNumbersOf.update_one({"_id": CHAT}, {"$pull": {"val.numbers": {"phoneNumber": SEED_PHONE}}})
    w0 = json.loads(open('/tmp/w0.json').read())
    db.walletOf.replace_one({"_id": CHAT}, w0)
    print('unseeded; wallet restored', s.get(f"{API}/wallet").json().get('balance'))
elif cmd == 'buy':
    country = sys.argv[2]
    r = s.get(f"{API}/fax-numbers/search", params={"country": country, "type": "local"}, timeout=60)
    phone = r.json()['numbers'][0]['phoneNumber']
    r = s.post(f"{API}/fax-numbers", json={"phoneNumber": phone, "autoRenew": True}, timeout=60)
    print(r.status_code, r.json().get('number', r.json()))
elif cmd == 'cancel':
    q = requests.utils.quote(sys.argv[2], safe='')
    print(s.post(f"{API}/fax-numbers/{q}/cancel", json={}).text)
