# CloudIVR web iteration 120: support/channel links, visitor AI chat (+rate limit via fake docs), prefs/lang → IVR
# language relocalization, IVR save language, Spanish voicemail, coupon/today used flag, SIP creds gating.
import os
import uuid
import datetime as dt
import pytest
import requests
from pymongo import MongoClient

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL').rstrip('/')
API = f"{BASE_URL}/api/cloudivr-web"
A = ("civr.alice@example.com", "AliceTest#2026")
B = ("civr.bob@example.com", "BobTest#2026")
ALICE_MAIN = "+15156445205"
BOB_MAIN = "+19565971129"
ALICE_ID = "5000000000000001"
GREET = {"en": "Thank you for calling. Please select an option.",
         "fr": "Merci de votre appel. Veuillez choisir une option.",
         "es": "Gracias por llamar. Por favor, seleccione una opción."}


def enc(p):
    return requests.utils.quote(p, safe='')


def login(email, pw):
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": email, "password": pw}, timeout=30)
    if r.status_code != 200:
        pytest.skip(f"login failed {email}: {r.status_code}")
    return s


@pytest.fixture(scope="module")
def sa():
    return login(*A)


@pytest.fixture(scope="module")
def sb():
    return login(*B)


@pytest.fixture(scope="module")
def db():
    return MongoClient("mongodb://localhost:27017")["test"]


def main_ivr(db):
    d = db.phoneNumbersOf.find_one({"_id": ALICE_ID})
    return next(n for n in d["val"]["numbers"] if n["phoneNumber"] == ALICE_MAIN)["features"]["ivr"]


# ── Links ──
class TestLinks:
    def test_catalog_links(self):
        r = requests.get(f"{API}/public/catalog", timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert d["supportLink"] == "https://t.me/CloudIVRhelp"
        assert d["channelLink"] == "https://t.me/CloudIVRNET"

    def test_voicemail_langs_include_es(self):
        d = requests.get(f"{API}/public/catalog", timeout=30).json()
        codes = [l["code"] for l in d.get("voicemailLanguages", [])]
        assert "es" in codes, codes


# ── Visitor AI chat ──
class TestVisitorChat:
    def test_invalid_visitor(self):
        assert requests.get(f"{API}/public/support/chat", params={"visitorId": "bad!"}, timeout=30).status_code == 400
        r = requests.post(f"{API}/public/support/chat", json={"visitorId": "short", "message": "hi"}, timeout=30)
        assert r.status_code == 400 and r.json()["error"] == "invalid_visitor"
        assert requests.delete(f"{API}/public/support/chat", timeout=30).status_code == 400

    def test_empty_message(self):
        r = requests.post(f"{API}/public/support/chat", json={"visitorId": "qa-empty-000001", "message": "  "}, timeout=30)
        assert r.status_code == 400 and r.json()["error"] == "empty"

    def test_ask_price_then_rate_limit(self, db):
        vid = "qa-" + uuid.uuid4().hex[:12]
        try:
            g = requests.get(f"{API}/public/support/chat", params={"visitorId": vid}, timeout=30)
            assert g.status_code == 200 and g.json()["messages"] == [] and g.json()["supportLink"] == "https://t.me/CloudIVRhelp"
            r = requests.post(f"{API}/public/support/chat", json={"visitorId": vid, "message": "How much is a number?", "lang": "en"}, timeout=90)
            assert r.status_code == 200, r.text
            reply = r.json()["reply"] or ""
            print("AI reply:", reply)
            assert "50" in reply and "75" in reply and "120" in reply
            g = requests.get(f"{API}/public/support/chat", params={"visitorId": vid}, timeout=30).json()
            assert [m["role"] for m in g["messages"]] == ["user", "assistant"]
            ip = db.webVisitorChats.find_one({"visitorId": vid, "role": "user"})["ip"]
            print("server-seen ip:", ip)
            db.webVisitorChats.insert_many([{"visitorId": "qa-limit-0001", "ip": ip, "role": "user", "content": "x", "createdAt": dt.datetime.utcnow()} for _ in range(10)])
            r = requests.post(f"{API}/public/support/chat", json={"visitorId": vid, "message": "another"}, timeout=30)
            assert r.status_code == 429 and r.json()["error"] == "slow_down"
            # DELETE clears visitor thread
            d = requests.delete(f"{API}/public/support/chat", params={"visitorId": vid}, timeout=30)
            assert d.status_code == 200 and d.json()["cleared"] is True
            assert requests.get(f"{API}/public/support/chat", params={"visitorId": vid}, timeout=30).json()["messages"] == []
        finally:
            db.webVisitorChats.delete_many({"visitorId": {"$in": ["qa-limit-0001", vid]}})


# ── prefs/lang → IVR language ──
class TestPrefsLang:
    def test_invalid_lang(self, sa):
        r = sa.put(f"{API}/prefs/lang", json={"lang": "de"})
        assert r.status_code == 400 and r.json()["error"] == "invalid_lang"

    def test_switch_fr_es_en(self, sa, db):
        try:
            r = sa.put(f"{API}/prefs/lang", json={"lang": "fr"})
            assert r.status_code == 200 and r.json()["lang"] == "fr"
            ivr = main_ivr(db)
            assert ivr["language"] == "fr" and ivr["greeting"] == GREET["fr"]
            assert db.webPrefs.find_one({"_id": ALICE_ID})["lang"] == "fr"
            r = sa.put(f"{API}/prefs/lang", json={"lang": "fr"})
            assert r.json()["updated"] == 0
            sa.put(f"{API}/prefs/lang", json={"lang": "es"})
            ivr = main_ivr(db)
            assert ivr["language"] == "es" and ivr["greeting"] == GREET["es"]
        finally:
            sa.put(f"{API}/prefs/lang", json={"lang": "en"})
        ivr = main_ivr(db)
        assert ivr["language"] == "en" and ivr["greeting"] == GREET["en"]

    def test_custom_greeting_kept(self, sa, db):
        orig = main_ivr(db)
        body = {**orig, "greeting": "TEST_custom hello", "enabled": False, "language": "en"}
        try:
            assert sa.put(f"{API}/numbers/{enc(ALICE_MAIN)}/ivr", json=body).status_code == 200
            sa.put(f"{API}/prefs/lang", json={"lang": "es"})
            ivr = main_ivr(db)
            assert ivr["language"] == "es" and ivr["greeting"] == "TEST_custom hello"
        finally:
            sa.put(f"{API}/prefs/lang", json={"lang": "en"})
            sa.put(f"{API}/numbers/{enc(ALICE_MAIN)}/ivr", json={**orig, "enabled": False, "greeting": GREET["en"], "language": "en"})
        assert main_ivr(db)["greeting"] == GREET["en"]

    def test_ivr_save_language_and_default_greeting(self, sa, db):
        orig = main_ivr(db)
        try:
            body = {"enabled": False, "language": "es", "options": orig.get("options", {})}
            r = sa.put(f"{API}/numbers/{enc(ALICE_MAIN)}/ivr", json=body)
            assert r.status_code == 200, r.text
            assert r.json()["ivr"]["language"] == "es" and r.json()["ivr"]["greeting"] == GREET["es"]
        finally:
            sa.put(f"{API}/numbers/{enc(ALICE_MAIN)}/ivr", json={**orig, "enabled": False, "language": "en", "greeting": GREET["en"]})
        assert main_ivr(db)["language"] == "en"


# ── Spanish voicemail ──
class TestVoicemailEs:
    def test_set_es(self, sa):
        n = sa.get(f"{API}/numbers/{enc(ALICE_MAIN)}").json()["number"]
        vm = n["features"]["voicemail"]
        try:
            r = sa.patch(f"{API}/numbers/{enc(ALICE_MAIN)}/voicemail", json={**vm, "language": "es"})
            assert r.status_code == 200 and r.json()["voicemail"]["language"] == "es"
            n2 = sa.get(f"{API}/numbers/{enc(ALICE_MAIN)}").json()["number"]
            assert n2["features"]["voicemail"]["language"] == "es"
            bad = sa.patch(f"{API}/numbers/{enc(ALICE_MAIN)}/voicemail", json={**vm, "language": "xx"})
            assert bad.status_code == 400
        finally:
            sa.patch(f"{API}/numbers/{enc(ALICE_MAIN)}/voicemail", json={**vm, "language": vm.get("language", "en")})


# ── Coupon + SIP ──
class TestCouponSip:
    def test_coupon_used_flags(self, sa):
        c = sa.get(f"{API}/coupons/today").json()["coupon"]
        if c is None:
            pytest.skip("no coupon today")
        assert c["used"] is True and c["code"]

    def test_fresh_account_coupon_unused(self, db):
        s = requests.Session()
        email = f"qa.iter120.{uuid.uuid4().hex[:6]}@example.com"
        r = s.post(f"{API}/auth/register", json={"email": email, "password": "QaTest#2026x", "name": "QA"}, timeout=30)
        assert r.status_code == 201, r.text
        c = s.get(f"{API}/coupons/today").json()["coupon"]
        if c is None:
            pytest.skip("no coupon today")
        assert c["used"] is False
        exp = dt.datetime.fromisoformat(c["expiresAt"].replace("Z", "+00:00"))
        assert exp.hour == 23 and exp.minute == 59

    def test_sip_alice_ok_bob_gated(self, sa, sb):
        r = sa.get(f"{API}/numbers/{enc(ALICE_MAIN)}/sip")
        assert r.status_code == 200 and r.json()["username"] and r.json()["password"] and r.json()["domain"]
        r = sb.get(f"{API}/numbers/{enc(BOB_MAIN)}/sip")
        assert r.status_code in (402, 403), r.status_code
