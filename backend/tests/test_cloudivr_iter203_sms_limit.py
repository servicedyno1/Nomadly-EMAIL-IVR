# Iteration 203: one-SMS length limit (160 GSM-7 / 70 Unicode) on messages send, schedule, thread maxLength, IVR keypad text
import os
import subprocess
from datetime import datetime, timedelta, timezone
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
MOBILE = "+15554586272"     # Alice USA mobile number (esim kind mobile)
BIZ = "+13346972125"        # Alice Business dry-run number
CONTACT = "+14155550123"


@pytest.fixture(scope="module")
def s():
    ses = requests.Session()
    r = ses.post(f"{API}/auth/login", json=ALICE)
    if r.status_code != 200:
        pytest.skip(f"login failed {r.status_code}")
    return ses


# ---- unit: sms-limit module ----
def test_unit_sms_limit():
    out = subprocess.run(["node", "-e", "const s=require('/app/js/cloudivr-web/sms-limit');console.log(JSON.stringify([s.smsTooLong('a'.repeat(160)), s.smsTooLong('a'.repeat(161)), s.smsTooLong('😀'+'a'.repeat(68)), s.smsTooLong('😀'+'a'.repeat(69)), s.smsTooLong('é'.repeat(80)+'ñ'.repeat(80)), s.smsTooLong('{'.repeat(80)), s.smsTooLong('{'.repeat(81)), s.fitSms('😀'+'a'.repeat(200)).length]))"], capture_output=True, text=True)
    import json
    a = json.loads(out.stdout)
    assert a[0] is None
    assert "Keep it to 160" in a[1] and "161" in a[1]
    assert a[2] is None
    assert "Keep it to 70" in a[3] and "71" in a[3]
    assert a[4] is None
    assert a[5] is None and a[6] and "162" in a[6]
    assert a[7] == 70


# ---- thread maxLength ----
def test_thread_maxlength(s):
    r = s.get(f"{API}/messages/thread", params={"number": MOBILE, "contact": CONTACT})
    assert r.status_code == 200, r.text
    assert r.json()["maxLength"] == 160


# ---- send validation (mobile/esim path + business/sms-reply path) ----
@pytest.mark.parametrize("number", [MOBILE, BIZ])
def test_send_161_rejected(s, number):
    r = s.post(f"{API}/messages/send", json={"number": number, "contact": CONTACT, "text": "a" * 161})
    assert r.status_code == 400, r.text
    assert "Keep it to 160 characters" in r.text


@pytest.mark.parametrize("number", [MOBILE, BIZ])
def test_send_emoji_71_rejected(s, number):
    r = s.post(f"{API}/messages/send", json={"number": number, "contact": CONTACT, "text": "😀" + "a" * 69})
    assert r.status_code == 400, r.text
    assert "Keep it to 70 characters" in r.text


@pytest.mark.parametrize("number", [MOBILE, BIZ])
def test_send_160_ok(s, number):
    r = s.post(f"{API}/messages/send", json={"number": number, "contact": CONTACT, "text": "TEST_iter203 " + "b" * 147})
    assert "Keep it to" not in r.text, r.text
    print(number, r.status_code, r.text[:200])


# ---- schedule ----
def test_schedule_limits(s):
    at = (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()
    r = s.post(f"{API}/messages/schedule", json={"number": MOBILE, "contact": CONTACT, "text": "a" * 161, "sendAt": at})
    assert r.status_code == 400 and "Keep it to 160" in r.text, r.text
    r = s.post(f"{API}/messages/schedule", json={"number": MOBILE, "contact": CONTACT, "text": "😀" + "a" * 69, "sendAt": at})
    assert r.status_code == 400 and "Keep it to 70" in r.text, r.text
    r = s.post(f"{API}/messages/schedule", json={"number": MOBILE, "contact": CONTACT, "text": "a" * 160, "sendAt": at})
    assert r.status_code == 200, r.text
    DB.webScheduledTexts.delete_many({"text": "a" * 160}) if "webScheduledTexts" in DB.list_collection_names() else None
    sid = (r.json().get("scheduled") or r.json()).get("id") or (r.json().get("scheduled") or r.json()).get("_id")
    if sid:
        s.delete(f"{API}/messages/schedule/{sid}")


# ---- IVR keypad text ----
def test_ivr_sms_too_long(s):
    line = DB.esimLines.find_one({"kind": "mobile", "chatId": "5000000000000001"})
    if not line:
        pytest.skip("no mobile line")
    body = {"enabled": False, "greeting": "Hi", "options": {"3": {"action": "sms", "smsFrom": line["_id"], "smsText": "x" * 200}}}
    r = s.put(f"{API}/numbers/{BIZ}/ivr", json=body)
    assert r.status_code == 400, r.text
    assert "Key 3: Keep it to 160 characters" in r.text
    body["options"]["3"]["smsText"] = "😀" + "x" * 80
    r = s.put(f"{API}/numbers/{BIZ}/ivr", json=body)
    assert r.status_code == 400 and "Key 3: Keep it to 70" in r.text, r.text
