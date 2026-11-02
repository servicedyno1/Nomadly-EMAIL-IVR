# Iteration 198: phone sign-up/sign-in (Telesign, simulated +1555 numbers) + auto-renew for eSIM / USA mobile number
import os
import random
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


def new_phone():
    return "+1555" + "".join(random.choice("0123456789") for _ in range(7))


def reset_ip_limit():
    # test-side: clear the per-IP code budget (10 / 15 min) so the suite isn't blocked by its own calls
    DB.webLoginAttempts.delete_many({"_id": {"$regex": r"^phone-send\|\d"}})


def start(s, phone, channel="sms"):
    return s.post(f"{API}/auth/phone/start", json={"phone": phone, "channel": channel})


@pytest.fixture(autouse=True)
def _ip_reset():
    reset_ip_limit()
    yield


# ---- config ----
def test_auth_config_phone_flags():
    r = requests.get(f"{API}/auth/config")
    assert r.status_code == 200
    d = r.json()
    assert d["phoneSignIn"] is True
    assert d["phoneVoice"] is True


# ---- signup + signin one account per phone ----
class TestPhoneSignupSignin:
    phone = new_phone()

    def test_signup_then_signin_same_account(self):
        s = requests.Session()
        r = start(s, self.phone)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["channel"] == "sms" and len(d["previewCode"]) == 6 and d["expiresIn"] == 300
        v = s.post(f"{API}/auth/phone/verify", json={"challenge": d["challenge"], "code": d["previewCode"], "name": "TEST_Phone User"})
        assert v.status_code == 200, v.text
        acc = v.json()["account"]
        me = s.get(f"{API}/auth/me")
        assert me.status_code == 200
        me1 = me.json()["account"]
        assert me1["id"] == acc["id"]
        assert me1.get("phone") == self.phone, me1
        assert not me1.get("email")
        # reuse same code -> rejected
        again = requests.post(f"{API}/auth/phone/verify", json={"challenge": d["challenge"], "code": d["previewCode"]})
        assert again.status_code == 400 and again.json()["error"] == "code_expired"
        # sign-in with same number, new session
        s2 = requests.Session()
        d2 = start(s2, self.phone.replace("+1555", "+1 555 ")).json()
        v2 = s2.post(f"{API}/auth/phone/verify", json={"challenge": d2["challenge"], "code": d2["previewCode"]})
        assert v2.status_code == 200
        assert s2.get(f"{API}/auth/me").json()["account"]["id"] == me1["id"]
        assert DB.webAccounts.count_documents({"phone": self.phone}) == 1


# ---- wrong code / tries ----
class TestCodeErrors:
    def test_wrong_code_and_lockout(self):
        s = requests.Session()
        d = start(s, new_phone()).json()
        wrong = "000000" if d["previewCode"] != "000000" else "111111"
        msgs = []
        for _ in range(5):
            r = s.post(f"{API}/auth/phone/verify", json={"challenge": d["challenge"], "code": wrong})
            assert r.status_code == 401
            msgs.append(r.json()["message"])
        assert msgs[0] == "Wrong code. Try again."
        assert msgs[-1] == "Wrong code. Ask for a new one."
        # challenge dead even with the right code
        r = s.post(f"{API}/auth/phone/verify", json={"challenge": d["challenge"], "code": d["previewCode"]})
        assert r.status_code == 400 and r.json()["error"] == "code_expired"

    def test_invalid_phone(self):
        r = start(requests.Session(), "12345")
        assert r.status_code == 400 and r.json()["error"] == "invalid_phone"

    def test_invalid_code_format(self):
        r = requests.post(f"{API}/auth/phone/verify", json={"challenge": "x", "code": "1"})
        assert r.status_code == 400 and r.json()["error"] == "invalid_code"

    def test_unknown_challenge(self):
        r = requests.post(f"{API}/auth/phone/verify", json={"challenge": "nope", "code": "123456"})
        assert r.status_code == 400 and r.json()["error"] == "code_expired"

    def test_voice_simulated(self):
        r = start(requests.Session(), new_phone(), "voice")
        assert r.status_code == 200 and r.json()["channel"] == "voice" and r.json().get("previewCode")


# ---- rate limit ----
def test_rate_limit_per_phone():
    p = new_phone()
    s = requests.Session()
    codes = [start(s, p).status_code for _ in range(6)]
    assert codes[:5] == [200] * 5, codes
    assert codes[5] == 429
    r = start(s, p)
    assert r.json()["error"] == "too_many_codes"


# ---- email login regression ----
@pytest.fixture(scope="module")
def alice():
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json=ALICE)
    if r.status_code != 200:
        pytest.skip(f"alice login failed {r.status_code}")
    return s


def test_email_login(alice):
    assert alice.get(f"{API}/auth/me").json()["account"]["email"] == ALICE["email"]


# ---- auto-renew ----
class TestAutoRenew:
    def test_lists_have_expires_and_autorenew(self, alice):
        for path in ("/esim", "/mobile-numbers"):
            r = alice.get(f"{API}{path}")
            assert r.status_code == 200
            for it in r.json()["items"]:
                assert "expiresAt" in it and "autoRenew" in it and isinstance(it["autoRenew"], bool)

    def test_buy_mobile_autorenew_off_and_toggle(self, alice):
        r = alice.post(f"{API}/mobile-numbers", json={"zipcode": "10001", "autoRenew": False})
        assert r.status_code == 200, r.text
        item = r.json()["item"]
        assert item["autoRenew"] is False and item["kind"] == "mobile"
        lid = item["id"]
        try:
            got = [i for i in alice.get(f"{API}/mobile-numbers").json()["items"] if i["id"] == lid][0]
            assert got["autoRenew"] is False
            t = alice.post(f"{API}/esim/{lid}/auto-renew", json={"on": True})
            assert t.status_code == 200 and t.json()["item"]["autoRenew"] is True
            got = [i for i in alice.get(f"{API}/mobile-numbers").json()["items"] if i["id"] == lid][0]
            assert got["autoRenew"] is True
            t = alice.post(f"{API}/esim/{lid}/auto-renew", json={"on": False})
            assert t.json()["item"]["autoRenew"] is False
        finally:
            DB.esimLines.find_one  # noqa
            pytest.mobile_line_id = lid

    def test_buy_esim_validation(self, alice):
        r = alice.post(f"{API}/esim", json={"planId": "x", "imei": "1", "email": "a@b.co", "autoRenew": False})
        assert r.status_code >= 400
