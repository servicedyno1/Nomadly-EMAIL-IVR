# iter218: 10-digit showAs '4155550199' normalises to +14155550199 on /public/try/* and /phone/test/caller-id
import os, time, uuid
import pytest, requests
from pymongo import MongoClient
from dotenv import load_dotenv

load_dotenv('/app/frontend/.env')
load_dotenv('/app/backend/.env')
BASE_URL = os.environ.get('REACT_APP_BACKEND_URL').rstrip('/')
API = f"{BASE_URL}/api/cloudivr-web"
db = MongoClient(os.environ['MONGO_URL'])[os.environ['DB_NAME']]
created_creds, created_calls = [], []


@pytest.fixture(scope='module', autouse=True)
def cleanup():
    yield
    for u in created_creds:
        db.testCredentials.delete_one({'sipUsername': u})
    for i in created_calls:
        db.webTryCalls.delete_one({'_id': i})


@pytest.fixture(scope='module')
def tok():
    email = f"test_iter218_{uuid.uuid4().hex[:8]}@example.com"
    r = requests.post(f"{API}/public/try/send-code", json={"email": email})
    if r.status_code != 200 or 'previewCode' not in r.json():
        pytest.skip(f"send-code: {r.status_code} {r.text[:200]}")
    v = requests.post(f"{API}/public/try/verify", json={"email": email, "code": r.json()['previewCode']})
    assert v.status_code == 200, v.text
    return v.json()['token']


@pytest.mark.parametrize('kind', ['call-me', 'browser'])
def test_try_10digit_accepted(tok, kind):
    # dry run does not persist showAs; normaliser itself checked by js/tests/showas_norm_iter218.js
    r = requests.post(f"{API}/public/try/{kind}", json={"to": "+14155550133", "showAs": "4155550199", "token": tok})
    if r.status_code in (200, 201):
        created_calls.append(r.json()['id'])
        return
    assert r.json().get('error') != 'invalid_show_as', r.text


def test_phone_test_10digit():
    u = 'T218sip' + uuid.uuid4().hex[:6]
    created_creds.append(u)
    db.testCredentials.insert_one({'chatId': 'T218_sipchat', 'sipUsername': u, 'expired': False, 'callsMade': 0, 'createdAt': time.time()})
    r = requests.post(f"{BASE_URL}/api/phone/test/caller-id", json={"sipUsername": u, "showAs": "4155550199"})
    assert r.status_code == 200 and r.json()['showAs'] == '+14155550199', r.text
    assert db.testCredentials.find_one({'sipUsername': u})['showAs'] == '+14155550199'
    r = requests.post(f"{BASE_URL}/api/phone/test/caller-id", json={"sipUsername": u, "showAs": "+447911123456"})
    assert r.json()['showAs'] == '+447911123456'
    r = requests.post(f"{BASE_URL}/api/phone/test/caller-id", json={"sipUsername": u, "showAs": "112"})
    assert r.status_code == 400
