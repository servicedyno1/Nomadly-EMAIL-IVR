# Iter183: GET /hosted-sms/recent (inbound hosted texts only, own account) + texting-only dashboard data
import os, pytest, requests
from pymongo import MongoClient

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL').rstrip('/')
API = f"{BASE_URL}/api/cloudivr-web"
ALICE = ('civr.alice@example.com', 'AliceTest#2026', '5000000000000001')
BOB = ('civr.bob@example.com', 'BobTest#2026', '5000000000000002')
db = MongoClient('mongodb://localhost:27017')['test']


def login(acc):
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": acc[0], "password": acc[1]})
    if r.status_code != 200:
        pytest.skip(f"login failed {r.status_code}")
    return s


@pytest.fixture(scope='module')
def alice():
    return login(ALICE)


@pytest.fixture(scope='module')
def bob():
    return login(BOB)


def test_recent_requires_auth():
    r = requests.get(f"{API}/hosted-sms/recent")
    assert r.status_code == 401


def test_recent_bob_shape_and_inbound_only(bob):
    r = bob.get(f"{API}/hosted-sms/recent?limit=8")
    assert r.status_code == 200
    msgs = r.json()['messages']
    assert isinstance(msgs, list) and 0 < len(msgs) <= 8
    for m in msgs:
        assert set(m.keys()) == {'id', 'phoneNumber', 'from', 'body', 'at'}
        assert isinstance(m['id'], str)
    ids = [m['id'] for m in msgs]
    from bson import ObjectId
    docs = list(db.phoneLogs.find({"_id": {"$in": [ObjectId(i) for i in ids]}}))
    assert len(docs) == len(ids)
    for d in docs:
        assert d['chatId'] == BOB[2] and d.get('hosted') is True and d['direction'] == 'inbound'
    ats = [m['at'] for m in msgs]
    assert ats == sorted(ats, reverse=True)


def test_recent_excludes_outbound(bob):
    ins = db.phoneLogs.insert_one({"chatId": BOB[2], "phoneNumber": "+13125550142", "from": "+13125550142", "to": "+15550001111",
                                   "direction": "outbound", "hosted": True, "body": "TEST_iter183_out", "type": "sms_out",
                                   "timestamp": __import__('datetime').datetime.utcnow()})
    try:
        msgs = bob.get(f"{API}/hosted-sms/recent?limit=50").json()['messages']
        assert all(m['body'] != 'TEST_iter183_out' for m in msgs)
    finally:
        db.phoneLogs.delete_one({"_id": ins.inserted_id})


def test_recent_isolated_per_account(alice):
    r = alice.get(f"{API}/hosted-sms/recent?limit=50")
    assert r.status_code == 200
    bob_ids = {str(d['_id']) for d in db.phoneLogs.find({"chatId": BOB[2]}, {"_id": 1})}
    assert not any(m['id'] in bob_ids for m in r.json()['messages'])


def test_recent_limit_capped(bob):
    r = bob.get(f"{API}/hosted-sms/recent?limit=500")
    assert r.status_code == 200 and len(r.json()['messages']) <= 50
    r = bob.get(f"{API}/hosted-sms/recent?limit=abc")
    assert r.status_code == 200 and len(r.json()['messages']) <= 10


def test_bob_texting_only_summary(bob):
    s = bob.get(f"{API}/summary")
    if s.status_code == 404:
        pytest.skip('no summary route')
    assert s.status_code == 200
    assert not (s.json().get('numbers') or {}).get('total')
    items = bob.get(f"{API}/hosted-sms").json()['items']
    assert any(x['status'] not in ('rejected', 'cancelled') for x in items)
