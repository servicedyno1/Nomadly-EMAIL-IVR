# Iter192: US mobile number ($75, ZIP), eSIM list exclusion, QR guards, IVR 'sms' key validation/persistence, Messages mobile flag.
# SAFE: restores Alice wallet + IVR config on +13346972125; TEST mobile lines cancelled at the end.
import os, time, copy, pytest, requests
from pymongo import MongoClient

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL').rstrip('/')
API = f"{BASE_URL}/api/cloudivr-web"
ALICE = ('civr.alice@example.com', 'AliceTest#2026', '5000000000000001')
BOB = ('civr.bob@example.com', 'BobTest#2026')
A_NUM = '+13346972125'
MN = 'mn_b5893a901b4f'
db = MongoClient('mongodb://localhost:27017')['test']
STATE = {}


def bal(cid):
    w = db.walletOf.find_one({'_id': cid}) or {}
    return round((w.get('usdIn') or 0) - (w.get('usdOut') or 0), 4)


def login(e, p):
    x = requests.Session()
    r = x.post(f"{API}/auth/login", json={"email": e, "password": p})
    if r.status_code != 200:
        pytest.skip(f"login {r.status_code}")
    return x


@pytest.fixture(scope='module')
def s():
    return login(ALICE[0], ALICE[1])


@pytest.fixture(scope='module', autouse=True)
def guard():
    w = db.walletOf.find_one({'_id': ALICE[2]})
    doc = db.phoneNumbersOf.find_one({'_id': ALICE[2]})
    ivr = next((copy.deepcopy(n.get('features', {}).get('ivr')) for n in doc['val']['numbers'] if n['phoneNumber'] == A_NUM), None)
    yield
    for lid in STATE.get('created', []):
        db.esimLines.update_one({'_id': lid}, {'$set': {'status': 'cancelled', 'note': 'TEST_iter192 cleanup'}})
    db.phoneLogs.delete_many({'body': {'$regex': '^TEST_iter192'}})
    db.walletOf.update_one({'_id': ALICE[2]}, {'$set': {'usdIn': w['usdIn'], 'usdOut': w['usdOut']}})
    db.phoneNumbersOf.update_one({'_id': ALICE[2], 'val.numbers.phoneNumber': A_NUM}, {'$set': {'val.numbers.$.features.ivr': ivr}})


# --- Mobile offer
def test_unauth_401():
    assert requests.get(f"{API}/mobile-numbers").status_code == 401
    assert requests.post(f"{API}/mobile-numbers", json={'zipcode': '10011'}).status_code == 401


def test_mobile_offer(s):
    r = s.get(f"{API}/mobile-numbers")
    assert r.status_code == 200, r.text
    d = r.json()
    assert d['available'] is True and d['price'] == 75
    assert isinstance(d['items'], list)
    assert all(i['kind'] == 'mobile' for i in d['items'])
    assert any(i['id'] == MN for i in d['items'])


@pytest.mark.parametrize('zip_', ['12', '', 'abcde', '123456'])
def test_mobile_bad_zip(s, zip_):
    b = bal(ALICE[2])
    r = s.post(f"{API}/mobile-numbers", json={'zipcode': zip_})
    assert r.status_code == 400
    assert 'ZIP' in r.json()['message']
    assert bal(ALICE[2]) == b


def test_mobile_insufficient(s):
    w = db.walletOf.find_one({'_id': ALICE[2]})
    db.walletOf.update_one({'_id': ALICE[2]}, {'$set': {'usdOut': w['usdIn'] - 10}})
    try:
        r = s.post(f"{API}/mobile-numbers", json={'zipcode': '10011'})
        assert r.status_code == 402, r.text
        assert r.json()['error'] == 'insufficient_balance'
        assert not db.esimLines.find_one({'chatId': ALICE[2], 'kind': 'mobile', 'status': 'provisioning'})
    finally:
        db.walletOf.update_one({'_id': ALICE[2]}, {'$set': {'usdIn': w['usdIn'], 'usdOut': w['usdOut']}})


def test_mobile_buy_and_provision(s):
    b = bal(ALICE[2])
    r = s.post(f"{API}/mobile-numbers", json={'zipcode': '10011'})
    assert r.status_code == 200, r.text
    it = r.json()['item']
    STATE.setdefault('created', []).append(it['id'])
    STATE['new'] = it['id']
    assert it['kind'] == 'mobile' and it['status'] == 'provisioning' and it['phoneNumber'] is None
    assert it['zipcode'] == '10011' and it['id'].startswith('mn_')
    assert round(b - bal(ALICE[2]), 2) == 75
    # appears in /mobile-numbers, not in /esim
    assert any(i['id'] == it['id'] for i in s.get(f"{API}/mobile-numbers").json()['items'])
    es = s.get(f"{API}/esim").json()['items']
    assert not any(i['kind'] == 'mobile' for i in es)
    # wait for provisioning
    got = None
    for _ in range(18):
        time.sleep(5)
        got = next(i for i in s.get(f"{API}/mobile-numbers").json()['items'] if i['id'] == it['id'])
        if got['status'] == 'active':
            break
    assert got['status'] == 'active', got
    assert got['phoneNumber'] and got['phoneNumber'].startswith('+1555')


def test_mobile_no_qr(s):
    for lid in [MN, STATE.get('new', MN)]:
        r = s.get(f"{API}/esim/{lid}/qr")
        assert r.status_code == 400
        r = s.post(f"{API}/esim/{lid}/email-qr", json={'email': 'x@example.com'})
        assert r.status_code == 400


def test_mobile_autorenew_and_cancel(s):
    lid = STATE.get('new')
    if not lid:
        pytest.skip('no new line')
    r = s.post(f"{API}/esim/{lid}/auto-renew", json={'on': False})
    assert r.status_code == 200 and r.json()['item']['autoRenew'] is False
    r = s.post(f"{API}/esim/{lid}/cancel")
    assert r.status_code == 200, r.text
    assert not any(i['id'] == lid for i in s.get(f"{API}/mobile-numbers").json()['items'])


# --- Messages
def test_messages_numbers_mobile_flag(s):
    r = s.get(f"{API}/messages")
    assert r.status_code == 200, r.text
    rows = r.json().get('numbers') or []
    m = [n for n in rows if n.get('lineId') == MN]
    assert m, list(r.json().keys())
    assert m[0]['mobile'] is True and m[0]['caps']['calls'] is False and m[0]['caps']['pictures'] is False


def test_messages_send_from_mobile(s):
    phone = db.esimLines.find_one({'_id': MN})['phoneNumber']
    b = bal(ALICE[2])
    r = s.post(f"{API}/messages/send", json={'number': phone, 'contact': '+14155550123', 'text': 'TEST_iter192 via inbox'})
    assert r.status_code == 200, r.text
    assert round(b - bal(ALICE[2]), 2) == 0.05
    t = s.get(f"{API}/messages/thread", params={'number': phone, 'contact': '+14155550123'})
    assert t.status_code == 200
    assert any('TEST_iter192 via inbox' in (m.get('body') or m.get('text') or '') for m in t.json().get('events', []))


def test_mobile_send_text(s):
    b = bal(ALICE[2])
    r = s.post(f"{API}/esim/{MN}/sms", json={'to': '+14155550123', 'text': 'TEST_iter192 hello'})
    assert r.status_code == 200, r.text
    assert r.json()['log']['status'] == 'preview'
    assert round(b - bal(ALICE[2]), 2) == 0.05


# --- IVR sms key
def ivr(opts, enabled=False):
    return {'enabled': enabled, 'greeting': 'Hi', 'options': opts}


def test_ivr_sms_missing_text(s):
    r = s.put(f"{API}/numbers/{A_NUM}/ivr", json=ivr({'1': {'action': 'sms', 'smsFrom': MN, 'smsText': '  '}}))
    assert r.status_code == 400 and r.json()['message'] == 'Key 1: write the text to send.'


def test_ivr_sms_missing_from(s):
    r = s.put(f"{API}/numbers/{A_NUM}/ivr", json=ivr({'1': {'action': 'sms', 'smsFrom': '', 'smsText': 'x'}}))
    assert r.status_code == 400 and 'pick the number' in r.json()['message']


def test_ivr_sms_foreign_line(s):
    r = s.put(f"{API}/numbers/{A_NUM}/ivr", json=ivr({'1': {'action': 'sms', 'smsFrom': 'mn_000000000000', 'smsText': 'x'}}))
    assert r.status_code == 400 and r.json()['message'].startswith('Pick one of your own texting numbers')


def test_ivr_sms_cancelled_line_rejected(s):
    r = s.put(f"{API}/numbers/{A_NUM}/ivr", json=ivr({'1': {'action': 'sms', 'smsFrom': 'es_c2b63cfed572', 'smsText': 'x'}}))
    assert r.status_code == 400


def test_ivr_sms_save_and_persist(s):
    body = ivr({'1': {'action': 'sms', 'smsFrom': MN, 'smsText': 'TEST_iter192 addr', 'message': 'Sent!', 'after': 'menu', 'label': 'Addr'},
                '2': {'action': 'submenu', 'subMenu': {'greeting': 'Sub', 'options': {'3': {'action': 'sms', 'smsFrom': 'es_069da6dee178', 'smsText': 'sub text', 'after': 'weird'}}}}})
    r = s.put(f"{API}/numbers/{A_NUM}/ivr", json=body)
    assert r.status_code == 200, r.text
    o = r.json()['ivr']['options']
    assert o['1'] == {'action': 'sms', 'smsFrom': MN, 'smsText': 'TEST_iter192 addr', 'message': 'Sent!', 'after': 'menu', 'label': 'Addr'}
    assert o['2']['subMenu']['options']['3']['after'] == 'hangup'
    doc = db.phoneNumbersOf.find_one({'_id': ALICE[2]})
    n = next(n for n in doc['val']['numbers'] if n['phoneNumber'] == A_NUM)
    assert n['features']['ivr']['options']['1']['smsText'] == 'TEST_iter192 addr'


def test_ivr_sms_submenu_foreign_line(s):
    body = ivr({'2': {'action': 'submenu', 'subMenu': {'options': {'3': {'action': 'sms', 'smsFrom': 'es_aaaaaaaaaaaa', 'smsText': 'x'}}}}})
    r = s.put(f"{API}/numbers/{A_NUM}/ivr", json=body)
    assert r.status_code == 400 and 'own texting numbers' in r.json()['message']


def test_bob_mobile_offer():
    b = login(*BOB)
    r = b.get(f"{API}/mobile-numbers")
    assert r.status_code == 200 and r.json()['items'] == []
    assert b.get(f"{API}/esim/{MN}/qr").status_code == 400
