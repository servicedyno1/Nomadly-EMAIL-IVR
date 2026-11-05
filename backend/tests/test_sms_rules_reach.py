# SMS carrier rules: sms-reach status/countries, destination check, sender-name prefs, per-country pricing on hosted send,
# inbox/missed-call reply enforcement. Preview = DRY-RUN (every long code = A2P w/o 10DLC → US blocked).
import os, datetime, pytest, requests
from bson import ObjectId
from pymongo import MongoClient

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL').rstrip('/')
API = f"{BASE_URL}/api/cloudivr-web"
BOB = ('civr.bob@example.com', 'BobTest#2026', '5000000000000002')
ALICE = ('civr.alice@example.com', 'AliceTest#2026', '5000000000000001')
db = MongoClient('mongodb://localhost:27017')['test']
BOB_HS = db.hostedSms.find_one({"chatId": BOB[2], "status": "active"})
BOB_PHONE = BOB_HS['phoneNumber'] if BOB_HS else None
ALICE_PHONE = db.phoneNumbersOf.find_one({"_id": ALICE[2]})['val']['numbers'][0]['phoneNumber']


def login(acc):
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": acc[0], "password": acc[1]})
    if r.status_code != 200:
        pytest.skip(f"login failed {r.status_code}")
    return s


def bal(cid):
    w = db.walletOf.find_one({"_id": cid}) or {}
    return round(w.get('usdIn', 0) - w.get('usdOut', 0), 2)


@pytest.fixture(scope='module', autouse=True)
def restore():
    w = {c: db.walletOf.find_one({"_id": c}) for c in (BOB[2], ALICE[2])}
    sn = (db.webPrefs.find_one({"_id": BOB[2]}) or {}).get('senderName')
    yield
    for c, x in w.items():
        db.walletOf.update_one({"_id": c}, {"$set": {"usdIn": x.get('usdIn', 0), "usdOut": x.get('usdOut', 0)}})
    db.webPrefs.update_one({"_id": BOB[2]}, {"$set": {"senderName": sn}})
    db.phoneLogs.delete_many({"body": {"$regex": "^TEST_"}})
    db.phoneLogs.delete_many({"from": {"$in": ["+14155557001", "+14165557002"]}, "type": "missed"})
    db.webNotifications.delete_many({"text": {"$regex": "TEST_SMSRULES"}})


@pytest.fixture(scope='module')
def bob():
    return login(BOB)


@pytest.fixture(scope='module')
def alice():
    return login(ALICE)


# --- sms-reach status
def test_reach_hosted_limited(bob):
    r = bob.get(f"{API}/sms-reach", params={"phone": BOB_PHONE})
    assert r.status_code == 200, r.text
    d = r.json()
    assert d['status'] == 'limited' and d['receive'] is True
    assert 'person-to-person' in d['note']
    by = {c['iso']: c for c in d['countries']}
    assert len(by) == 15
    assert by['CA']['ok'] and by['CA']['price'] == 0.05
    assert by['US']['ok'] is False and by['US']['mode'] == 'approval'
    assert by['IN']['ok'] is False and by['IN']['mode'] == 'blocked'
    assert by['BR']['price'] == 0.06 and by['DE']['price'] == 0.12 and by['FR']['price'] == 0.10 and by['GB']['price'] == 0.08


def test_reach_alice_long_code(alice):
    r = alice.get(f"{API}/sms-reach", params={"phone": ALICE_PHONE})
    assert r.status_code == 200
    d = r.json()
    assert d['status'] == 'limited' and '10DLC' in d['note']


def test_reach_not_owned_404(bob, alice):
    assert bob.get(f"{API}/sms-reach", params={"phone": ALICE_PHONE}).status_code == 404
    assert alice.get(f"{API}/sms-reach", params={"phone": BOB_PHONE}).status_code == 404
    assert bob.post(f"{API}/sms-reach/check", json={"phone": ALICE_PHONE, "to": "+14165550100"}).status_code == 404


def test_unauth_401():
    assert requests.get(f"{API}/sms-reach", params={"phone": BOB_PHONE}).status_code == 401


# --- sender name prefs
def test_sender_name_validation(bob):
    for bad in ['AB', 'TOOLONGNAME12', '12345', 'BAD!NAME', 'ÄBCD']:
        r = bob.put(f"{API}/prefs/sender-name", json={"senderName": bad})
        assert r.status_code == 400, bad
        assert r.json()['error'] == 'invalid_sender'
    r = bob.put(f"{API}/prefs/sender-name", json={"senderName": ""})
    assert r.status_code == 200 and r.json()['senderName'] is None
    assert bob.get(f"{API}/prefs/sender-name").json()['senderName'] is None


# --- destination checks
def test_check_destinations_no_sender(bob):
    bob.put(f"{API}/prefs/sender-name", json={"senderName": ""})
    c = lambda to: bob.post(f"{API}/sms-reach/check", json={"phone": BOB_PHONE, "to": to}).json()
    ca = c("+1 416 555 0100")
    assert ca['ok'] and ca['iso'] == 'CA' and ca['price'] == 0.05 and ca['mode'] == 'number'
    us = c("+13125550100")
    assert not us['ok'] and us['mode'] == 'approval' and us['iso'] == 'US'
    uk = c("+447700900123")
    assert not uk['ok'] and uk['mode'] == 'brand' and 'Settings' in uk['why']
    inn = c("+919876543210")
    assert not inn['ok'] and inn['mode'] == 'blocked' and 'weeks' in inn['why']
    br = c("+5511987654321")
    assert br['ok'] and br['price'] == 0.06
    bad = c("12")
    assert not bad['ok'] and 'country code' in bad['why']
    unk = c("+81312345678")
    assert not unk['ok']


def test_sender_set_then_uk_ok(bob):
    r = bob.put(f"{API}/prefs/sender-name", json={"senderName": " BOBCO "})
    assert r.status_code == 200 and r.json()['senderName'] == 'BOBCO'
    assert bob.get(f"{API}/prefs/sender-name").json()['senderName'] == 'BOBCO'
    uk = bob.post(f"{API}/sms-reach/check", json={"phone": BOB_PHONE, "to": "+447700900123"}).json()
    assert uk['ok'] and uk['mode'] == 'brand' and uk['from'] == 'BOBCO' and uk['price'] == 0.08
    reach = bob.get(f"{API}/sms-reach", params={"phone": BOB_PHONE}).json()
    assert {c['iso']: c for c in reach['countries']}['GB']['ok'] is True


# --- hosted send: per-country price, US refused w/o charge
@pytest.mark.parametrize("to,price", [("+14165550111", 0.05), ("+5511987650000", 0.06)])
def test_hosted_send_charges_country_price(bob, to, price):
    b0 = bal(BOB[2])
    r = bob.post(f"{API}/hosted-sms/{BOB_HS['_id']}/send", json={"to": to, "text": "TEST_ country price"})
    assert r.status_code == 200, r.text
    assert r.json()['charge'] == price
    assert round(b0 - bal(BOB[2]), 2) == price
    log = db.phoneLogs.find_one({"to": to, "body": "TEST_ country price"})
    assert log and log['charge'] == price


def test_hosted_send_us_blocked_no_charge(bob):
    b0 = bal(BOB[2])
    r = bob.post(f"{API}/hosted-sms/{BOB_HS['_id']}/send", json={"to": "+13125550188", "text": "TEST_ us"})
    assert r.status_code == 400
    assert 'person-to-person' in r.json()['message']
    assert bal(BOB[2]) == b0
    assert db.phoneLogs.find_one({"body": "TEST_ us"}) is None


def test_hosted_send_uk_brand_from(bob):
    r = bob.post(f"{API}/hosted-sms/{BOB_HS['_id']}/send", json={"to": "+447700900555", "text": "TEST_ uk"})
    assert r.status_code == 200 and r.json()['charge'] == 0.08
    assert db.phoneLogs.find_one({"body": "TEST_ uk"})['from'] == 'BOBCO'


# --- inbox reply (hosted) + missed-call text back (long code)
def test_inbox_hosted_reply_us_blocked(bob):
    nid = db.webNotifications.insert_one({"chatId": BOB[2], "text": "TEST_SMSRULES", "kind": "sms", "meta": {"from": "+14155557003", "to": BOB_PHONE, "hosted": BOB_HS['_id']}, "read": False, "createdAt": datetime.datetime.utcnow()}).inserted_id
    b0 = bal(BOB[2])
    r = bob.post(f"{API}/notifications/{nid}/reply", json={"text": "TEST_ inbox"})
    assert r.status_code == 400 and 'person-to-person' in r.json()['message']
    assert bal(BOB[2]) == b0


def test_missed_call_text_back_us_blocked_ca_ok(alice):
    now = datetime.datetime.utcnow().isoformat() + 'Z'
    us = db.phoneLogs.insert_one({"chatId": ALICE[2], "phoneNumber": ALICE_PHONE, "from": "+14155557001", "type": "missed", "timestamp": now}).inserted_id
    ca = db.phoneLogs.insert_one({"chatId": ALICE[2], "phoneNumber": ALICE_PHONE, "from": "+14165557002", "type": "missed", "timestamp": now}).inserted_id
    r = alice.post(f"{API}/missed-calls/{us}/reply", json={"text": "TEST_ tb us"})
    assert r.status_code == 400 and r.json()['error'] == 'sms_blocked' and '10DLC' in r.json()['message']
    assert db.phoneLogs.find_one({"_id": us}).get('reply') is None
    r = alice.post(f"{API}/missed-calls/{ca}/reply", json={"text": "TEST_ tb ca"})
    assert r.status_code == 200, r.text
    assert r.json()['reply']['status'] == 'preview'
