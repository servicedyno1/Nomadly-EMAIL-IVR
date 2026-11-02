# Iteration 204: per-line receipts API + long (joined, up to 3 parts) SMS: limits, per-part pricing, thread maxLength, IVR save
import json
import os
import subprocess
import pytest
import requests
from dotenv import dotenv_values
from pymongo import MongoClient

FE_ENV = dotenv_values('/app/frontend/.env')
BASE_URL = (os.environ.get('REACT_APP_BACKEND_URL') or FE_ENV['REACT_APP_BACKEND_URL']).rstrip('/')
API = f"{BASE_URL}/api/cloudivr-web"
BE_ENV = dotenv_values('/app/backend/.env')
DB = MongoClient(BE_ENV['MONGO_URL'])[BE_ENV['DB_NAME']]
ALICE = {"email": "civr.alice@example.com", "password": "AliceTest#2026"}
BOB = {"email": "civr.bob@example.com", "password": "BobTest#2026"}
MOBILE = "+15554586272"     # mn_b5893a901b4f (simulated USA mobile number)
MOBILE_ID = "mn_b5893a901b4f"
BIZ = "+13346972125"
CONTACT = "+14155550123"
ESIM_WITH_RENEWAL = "es_a52441cc7f4f"


def login(c):
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json=c)
    if r.status_code != 200:
        pytest.skip(f"login failed {r.status_code}")
    return s


@pytest.fixture(scope="module")
def s():
    return login(ALICE)


# ---- unit: parts ----
def test_unit_parts():
    js = "const s=require('/app/js/cloudivr-web/sms-limit');console.log(JSON.stringify([s.smsParts('a'.repeat(160)),s.smsParts('a'.repeat(161)),s.smsParts('a'.repeat(306)),s.smsParts('a'.repeat(307)),s.smsParts('a'.repeat(459)),s.smsTooLong('a'.repeat(459)),s.smsTooLong('a'.repeat(460)),s.smsParts('😀'+'a'.repeat(68)),s.smsParts('😀'+'a'.repeat(69)),s.smsTooLong('😀'+'a'.repeat(199)),s.smsTooLong('😀'+'a'.repeat(200)),s.smsTooLong('a'.repeat(161),1)]))"
    a = json.loads(subprocess.run(["node", "-e", js], capture_output=True, text=True).stdout)
    assert a[:5] == [1, 2, 2, 3, 3]
    assert a[5] is None and "Keep it to 459 characters (3 joined texts)" in a[6]
    assert a[7] == 1 and a[8] == 2
    assert a[9] is None and "Keep it to 201" in a[10]
    assert "Keep it to 160" in a[11]


# ---- receipts ----
class TestReceipts:
    def test_unauth(self):
        assert requests.get(f"{API}/esim/{ESIM_WITH_RENEWAL}/receipts").status_code == 401

    def test_esim_receipts(self, s):
        r = s.get(f"{API}/esim/{ESIM_WITH_RENEWAL}/receipts")
        assert r.status_code == 200, r.text
        rec = r.json()["receipts"]
        kinds = [x["kind"] for x in rec]
        assert "Purchase" in kinds and "Renewal" in kinds
        for x in rec:
            assert set(["id", "kind", "refund", "amount", "at", "line", "phoneNumber"]) <= set(x)
            assert x["line"] == "USA eSIM" and x["amount"] == 75
        ats = [x["at"] for x in rec]
        assert ats == sorted(ats, reverse=True)

    def test_mobile_receipts_excludes_texts(self, s):
        r = s.get(f"{API}/esim/{MOBILE_ID}/receipts")
        assert r.status_code == 200, r.text
        rec = r.json()["receipts"]
        print("mobile receipts", rec[:3])
        assert all(x["kind"] != "Text" for x in rec)
        assert all(x["line"] == "USA mobile number" for x in rec)

    def test_other_user_line(self):
        bob = login(BOB)
        r = bob.get(f"{API}/esim/{ESIM_WITH_RENEWAL}/receipts")
        assert r.status_code in (400, 404), r.text
        assert "Line not found" in r.text

    def test_bad_id(self, s):
        r = s.get(f"{API}/esim/nope_xyz/receipts")
        assert r.status_code in (400, 404) and "Line not found" in r.text


# ---- long texts ----
def test_thread_maxlength(s):
    r = s.get(f"{API}/messages/thread", params={"number": MOBILE, "contact": CONTACT})
    assert r.status_code == 200 and r.json()["maxLength"] == 459


@pytest.mark.parametrize("number", [MOBILE, BIZ])
def test_send_460_rejected(s, number):
    r = s.post(f"{API}/messages/send", json={"number": number, "contact": CONTACT, "text": "a" * 460})
    assert r.status_code == 400 and "Keep it to 459 characters (3 joined texts)" in r.text, r.text


def test_send_emoji_202_rejected(s):
    r = s.post(f"{API}/messages/send", json={"number": MOBILE, "contact": CONTACT, "text": "😀" + "a" * 200})
    assert r.status_code == 400 and "Keep it to 201" in r.text, r.text


def test_send_300_charges_two_parts(s):
    bal0 = s.get(f"{API}/wallet").json()["balance"]
    text = "TEST_iter204 " + "c" * 287
    assert len(text) == 300
    r = s.post(f"{API}/messages/send", json={"number": MOBILE, "contact": CONTACT, "text": text})
    assert r.status_code == 200, r.text
    bal1 = s.get(f"{API}/wallet").json()["balance"]
    assert round(bal0 - bal1, 3) == 0.1, (bal0, bal1)
    t = DB.transactions.find_one({"chatId": "5000000000000001", "type": "esim-sms", "metadata.lineId": MOBILE_ID}, sort=[("createdAt", -1)])
    assert t["amount"] == 0.1 and t["metadata"]["parts"] == 2
    log = DB.phoneLogs.find_one({"body": text})
    assert log and log["charge"] == 0.1


def test_biz_300_not_length_error(s):
    r = s.post(f"{API}/messages/send", json={"number": BIZ, "contact": CONTACT, "text": "TEST_iter204b " + "d" * 286})
    print("biz", r.status_code, r.text[:200])
    assert "Keep it to" not in r.text


# ---- IVR keypad text ----
def test_ivr_400_ok_500_fails(s):
    cur = s.get(f"{API}/numbers/%2B13346972125").json()["number"]["features"]["ivr"]
    try:
        body = json.loads(json.dumps(cur))
        body["options"]["3"]["smsText"] = "TEST_ " + "x" * 394
        r = s.put(f"{API}/numbers/{BIZ}/ivr", json=body)
        assert r.status_code == 200, r.text
        got = s.get(f"{API}/numbers/%2B13346972125").json()["number"]["features"]["ivr"]["options"]["3"]["smsText"]
        assert len(got) == 400
        body["options"]["3"]["smsText"] = "x" * 500
        r = s.put(f"{API}/numbers/{BIZ}/ivr", json=body)
        assert r.status_code == 400 and "Key 3: Keep it to 459" in r.text, r.text
    finally:
        r = s.put(f"{API}/numbers/{BIZ}/ivr", json=cur)
        assert r.status_code == 200, r.text
