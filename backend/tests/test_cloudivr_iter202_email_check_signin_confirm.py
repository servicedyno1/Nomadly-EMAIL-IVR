# Iteration 202: sign-up email domain check, password/confirm before sign-in method changes, renewal receipt
import os
import random
import string
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
PW = "QaTest#2026x"


def rnd(n=8):
    return "".join(random.choice(string.ascii_lowercase + string.digits) for _ in range(n))


def new_phone():
    return "+1555" + "".join(random.choice("0123456789") for _ in range(7))


@pytest.fixture(autouse=True)
def _reset_limits():
    # test-side: clear per-IP budgets so the suite isn't blocked by its own calls
    DB.webLoginAttempts.delete_many({"_id": {"$regex": r"^(phone-send\|\d|reg\|)"}})
    yield


def register(s, email, password=PW):
    return s.post(f"{API}/auth/register", json={"email": email, "password": password, "name": "TEST_iter202"})


def phone_account():
    s = requests.Session()
    p = new_phone()
    d = s.post(f"{API}/auth/phone/start", json={"phone": p}).json()
    v = s.post(f"{API}/auth/phone/verify", json={"challenge": d["challenge"], "code": d["previewCode"], "name": "TEST_iter202 phone"})
    assert v.status_code == 200, v.text
    return s, p, v.json()["account"]


# ---- (1) sign-up email domain check ----
class TestRegisterEmailCheck:
    @pytest.mark.parametrize("email,needle", [
        ("a{r}@gmial.com", "Did you mean @gmail.com?"),
        ("a{r}@mailinator.com", "Throwaway"),
        ("a{r}@nonexistent-zz{r}qq.com", "deliver email to @nonexistent-zz"),
        ("a{r}@yopmail.com", "Throwaway"),
        ("a{r}@hotmial.com", "Did you mean @hotmail.com?"),
    ])
    def test_rejects(self, email, needle):
        r = rnd()
        resp = register(requests.Session(), email.format(r=r))
        assert resp.status_code == 400, resp.text
        assert resp.json()["error"] == "invalid_email"
        assert needle in resp.json()["message"]

    def test_accepts_example_com_preview(self):
        email = f"test_iter202_{rnd()}@example.com"
        resp = register(requests.Session(), email)
        assert resp.status_code == 201, resp.text
        assert resp.json()["account"]["email"] == email

    @pytest.mark.parametrize("domain", ["gmail.com", "outlook.com"])
    def test_accepts_real_domains(self, domain):
        email = f"test.iter202.{rnd()}@{domain}"
        resp = register(requests.Session(), email)
        assert resp.status_code == 201, resp.text
        DB.webAccounts.delete_one({"email": email})


# ---- (2) password before adding/changing phone (Alice has a password) ----
class TestAlicePhoneChangeNeedsPassword:
    @pytest.fixture(scope="class")
    def alice(self):
        s = requests.Session()
        r = s.post(f"{API}/auth/login", json=ALICE)
        assert r.status_code == 200, r.text
        return s

    def test_no_password_401(self, alice):
        r = alice.post(f"{API}/account/phone/start", json={"phone": new_phone()})
        assert r.status_code == 401
        assert r.json()["message"] == "Enter your current password to continue."
        DB.webLoginAttempts.delete_many({"_id": {"$regex": r"^acct-confirm\|"}})

    def test_wrong_password_401(self, alice):
        r = alice.post(f"{API}/account/phone/start", json={"phone": new_phone(), "password": "nope-wrong"})
        assert r.status_code == 401
        assert r.json()["message"] == "That password isn’t right."
        DB.webLoginAttempts.delete_many({"_id": {"$regex": r"^acct-confirm\|"}})

    def test_right_password_sends_code(self, alice):
        r = alice.post(f"{API}/account/phone/start", json={"phone": new_phone(), "password": ALICE["password"]})
        assert r.status_code == 200, r.text
        assert len(r.json()["previewCode"]) == 6

    def test_confirm_start_with_password_account(self, alice):
        r = alice.post(f"{API}/account/confirm/start", json={})
        assert r.status_code == 400 and r.json()["error"] == "use_password"


class TestPasswordLockout:
    def test_five_wrong_locks(self):
        s = requests.Session()
        email = f"test_iter202_lock_{rnd()}@example.com"
        assert register(s, email).status_code == 201
        codes = [s.post(f"{API}/account/phone/start", json={"phone": new_phone(), "password": "wrong"}).status_code for _ in range(5)]
        assert codes == [401] * 5
        r = s.post(f"{API}/account/phone/start", json={"phone": new_phone(), "password": PW})
        assert r.status_code == 429, r.text
        assert "15 minutes" in r.json()["message"]


# ---- (2b) phone-only account: confirm code to current phone before adding email ----
class TestPhoneOnlyAddEmail:
    def test_email_start_without_confirm(self):
        s, p, acc = phone_account()
        r = s.post(f"{API}/account/email/start", json={"email": f"test_iter202_{rnd()}@example.com"})
        assert r.status_code == 401 and r.json()["error"] == "confirm_needed"

    def test_email_domain_check_on_add(self):
        s, p, acc = phone_account()
        r = s.post(f"{API}/account/email/start", json={"email": f"a{rnd()}@gmial.com"})
        assert r.status_code == 400 and "Did you mean @gmail.com" in r.json()["message"]

    def test_full_confirm_then_add_email(self):
        s, p, acc = phone_account()
        c = s.post(f"{API}/account/confirm/start", json={})
        assert c.status_code == 200, c.text
        cd = c.json()
        assert len(cd["previewCode"]) == 6
        v = s.post(f"{API}/account/confirm/verify", json={"challenge": cd["challenge"], "code": cd["previewCode"]})
        assert v.status_code == 200, v.text
        tok = v.json()["confirmToken"]
        email = f"test_iter202_{rnd()}@example.com"
        e = s.post(f"{API}/account/email/start", json={"email": email, "confirmToken": tok})
        assert e.status_code == 200, e.text
        ev = s.post(f"{API}/account/email/verify", json={"challenge": e.json()["challenge"], "code": e.json()["previewCode"]})
        assert ev.status_code == 200, ev.text
        assert ev.json()["account"]["email"] == email
        me = s.get(f"{API}/auth/me").json()["account"]
        assert me["email"] == email and me["phone"] == p

    def test_confirm_challenge_not_usable_elsewhere(self):
        s, p, acc = phone_account()
        cd = s.post(f"{API}/account/confirm/start", json={}).json()
        r1 = s.post(f"{API}/account/phone/verify", json={"challenge": cd["challenge"], "code": cd["previewCode"]})
        assert r1.status_code == 400 and r1.json()["error"] == "code_expired"
        r2 = requests.post(f"{API}/auth/phone/verify", json={"challenge": cd["challenge"], "code": cd["previewCode"]})
        assert r2.status_code == 400 and r2.json()["error"] == "code_expired"
        # still usable for its own purpose
        ok = s.post(f"{API}/account/confirm/verify", json={"challenge": cd["challenge"], "code": cd["previewCode"]})
        assert ok.status_code == 200

    def test_confirm_token_of_other_account_rejected(self):
        s1, _, _ = phone_account()
        s2, _, _ = phone_account()
        cd = s1.post(f"{API}/account/confirm/start", json={}).json()
        tok = s1.post(f"{API}/account/confirm/verify", json={"challenge": cd["challenge"], "code": cd["previewCode"]}).json()["confirmToken"]
        r = s2.post(f"{API}/account/email/start", json={"email": f"test_iter202_{rnd()}@example.com", "confirmToken": tok})
        assert r.status_code == 401 and r.json()["error"] == "confirm_needed"

    def test_phone_change_on_phone_account_needs_confirm(self):
        s, p, acc = phone_account()
        r = s.post(f"{API}/account/phone/start", json={"phone": new_phone()})
        assert r.status_code == 401 and r.json()["error"] == "confirm_needed"


# ---- (3) renewal receipt ----
def test_esim_renewal_node_suite():
    out = subprocess.run(["node", "/app/backend/tests/esim_renewal.test.js"], capture_output=True, text=True, timeout=120, cwd="/app")
    assert "PASS" in out.stdout, out.stdout + out.stderr
    assert '"receiptSaved":true' in out.stdout
