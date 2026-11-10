# helper: create/clean a texting-only TEST_ account for UI check. Usage: python txonly_ui_helper.py create|clean <email>
import os, sys
from datetime import datetime, timedelta, timezone
import requests
from dotenv import load_dotenv
from pymongo import MongoClient
load_dotenv('/app/frontend/.env'); load_dotenv('/app/backend/.env')
API = os.environ['REACT_APP_BACKEND_URL'].rstrip('/') + '/api/cloudivr-web'
db = MongoClient(os.environ['MONGO_URL'])[os.environ['DB_NAME']]
cmd, email = sys.argv[1], sys.argv[2]
if cmd == 'create':
    r = requests.post(f"{API}/auth/register", json={'email': email, 'password': 'QaTest#2026x', 'name': 'TEST Texting'}, timeout=30)
    acc = str(r.json()['account'].get('id') or r.json()['account'].get('chatId'))
    now = datetime.now(timezone.utc)
    db.hostedSms.insert_one({'_id': f'TEST-TXONLY-{acc}', 'chatId': acc, 'status': 'active', 'phoneNumber': '+12125559877', 'plan': 'texting', 'planNumber': None, 'nextBillAt': now + timedelta(days=20), 'createdAt': now, 'updatedAt': now})
    print('created', acc)
else:
    acc = db.webAccounts.find_one({'email': email})
    print(db.hostedSms.delete_many({'_id': f"TEST-TXONLY-{int(acc['_id'])}"}).deleted_count, acc['_id'])
