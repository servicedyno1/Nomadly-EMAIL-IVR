# CloudIVR invoices & receipts (user + admin) and number capacity labels — iteration 285
import os
import re
import pytest
import requests

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL').rstrip('/')
API = f"{BASE_URL}/api/cloudivr-web"
UX = ("civr.uxtest@example.com", "UxTest#2026")
ALICE = ("civr.alice@example.com", "AliceTest#2026")
ADMIN = ("moxxcompany@gmail.com", "Katiekendra123@")
NUM_RE = re.compile(r"^CIVR-\d{4}-\d{6}$")
BANNED = re.compile(r"\b(bot|telegram|chat)\b", re.I)


def login(creds):
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": creds[0], "password": creds[1]})
    if r.status_code != 200:
        pytest.skip(f"login failed {creds[0]}: {r.status_code}")
    return s


@pytest.fixture(scope="module")
def ux():
    return login(UX)


@pytest.fixture(scope="module")
def alice():
    return login(ALICE)


@pytest.fixture(scope="module")
def ux_invoices(ux):
    r = ux.get(f"{API}/billing/invoices")
    assert r.status_code == 200
    return r.json()["invoices"]


@pytest.fixture(scope="module")
def admin():
    s = requests.Session()
    r = s.post(f"{API}/admin/login", json={"email": ADMIN[0], "password": ADMIN[1]})
    if r.status_code != 200 or "devCode" not in r.json():
        pytest.skip(f"admin login unavailable {r.status_code}")
    d = r.json()
    v = s.post(f"{API}/admin/verify", json={"challenge": d["challenge"], "code": d["devCode"]})
    if v.status_code != 200:
        pytest.skip(f"admin verify failed {v.status_code}")
    return s


# --- User invoices ---
class TestUserInvoices:
    def test_unauth_401(self):
        r = requests.get(f"{API}/billing/invoices")
        assert r.status_code == 401

    def test_list_shape(self, ux_invoices):
        assert len(ux_invoices) > 0
        for inv in ux_invoices:
            assert NUM_RE.match(inv["number"]), inv["number"]
            assert inv["kind"] in ("invoice", "receipt", "credit_note")
            assert inv["seller"]["address"].startswith("Rua Aquilino Ribeiro, Nr. 255")
            assert inv["seller"]["site"] == "cloudivr.net"
            assert inv["billTo"] and inv["items"] and inv["paidWith"]
            assert isinstance(inv["total"], (int, float))
            assert "_id" not in inv

    def test_numbers_unique(self, ux_invoices):
        nums = [i["number"] for i in ux_invoices]
        assert len(nums) == len(set(nums))

    def test_no_zero_total(self, ux_invoices):
        zero = [i["number"] for i in ux_invoices if i["total"] <= 0]
        assert not zero, f"$0.00 invoices: {zero}"

    def test_no_bot_words(self, ux_invoices):
        for inv in ux_invoices:
            txt = " ".join([inv["items"][0]["description"], inv["paidWith"], str(inv["billTo"]), str(inv["seller"])])
            assert not BANNED.search(txt), txt

    def test_numbering_chronological(self, ux_invoices):
        srt = sorted(ux_invoices, key=lambda i: i["issuedAt"])
        nums = [i["number"] for i in srt]
        assert nums == sorted(nums), "invoice numbers not in issue-date order"

    def test_get_own_by_id(self, ux, ux_invoices):
        inv = ux_invoices[0]
        r = ux.get(f"{API}/billing/invoices/{inv['id']}")
        assert r.status_code == 200
        assert r.json()["invoice"]["number"] == inv["number"]

    def test_other_user_404(self, alice, ux_invoices):
        r = alice.get(f"{API}/billing/invoices/{ux_invoices[0]['id']}")
        assert r.status_code == 404
        assert r.json()["error"] == "not_found"

    def test_alice_list_isolated(self, alice, ux_invoices):
        r = alice.get(f"{API}/billing/invoices")
        assert r.status_code == 200
        ux_ids = {i["id"] for i in ux_invoices}
        a = r.json()["invoices"]
        assert all(i["chatId"] != "5000000000000077" for i in a)
        assert not ux_ids & {i["id"] for i in a}

    def test_missing_404(self, ux):
        r = ux.get(f"{API}/billing/invoices/doesnotexist")
        assert r.status_code == 404


# --- Admin invoices ---
class TestAdminInvoices:
    def test_admin_401_no_session(self):
        assert requests.get(f"{API}/admin/invoices").status_code == 401

    def test_admin_401_user_session(self, ux):
        assert ux.get(f"{API}/admin/invoices").status_code == 401

    def test_admin_list_and_search(self, admin, ux_invoices):
        r = admin.get(f"{API}/admin/invoices")
        assert r.status_code == 200
        d = r.json()
        assert d["total"] >= len(ux_invoices) and len(d["invoices"]) <= 200
        num = ux_invoices[0]["number"]
        r2 = admin.get(f"{API}/admin/invoices", params={"q": num})
        assert r2.json()["total"] == 1 and r2.json()["invoices"][0]["number"] == num
        r3 = admin.get(f"{API}/admin/invoices", params={"q": "civr.uxtest@example.com"})
        assert r3.json()["total"] == len(ux_invoices)
        assert all(i["billTo"].get("email") == "civr.uxtest@example.com" for i in r3.json()["invoices"])

    def test_admin_regex_escape(self, admin):
        r = admin.get(f"{API}/admin/invoices", params={"q": "(.*"})
        assert r.status_code == 200

    def test_admin_docs_no_bot_words(self, admin):
        d = admin.get(f"{API}/admin/invoices").json()["invoices"]
        bad = [i["number"] for i in d if BANNED.search(" ".join([i["items"][0]["description"], i["paidWith"], str(i["billTo"])]))]
        assert not bad, bad


# --- Number capacity ---
class TestCapacity:
    def test_numbers_have_capacity(self, ux):
        r = ux.get(f"{API}/numbers")
        assert r.status_code == 200
        nums = r.json()["numbers"]
        assert nums
        for n in nums:
            c = n["capacity"]
            assert set(c) == {"callsIn", "callsOut", "texts", "fax"}
            assert c["callsOut"] in (True, False, "pending")

    def test_number_detail_capacity(self, ux):
        nums = ux.get(f"{API}/numbers").json()["numbers"]
        p = nums[0]["phoneNumber"]
        r = ux.get(f"{API}/numbers/{requests.utils.quote(p)}")
        assert r.status_code == 200
        assert r.json()["number"]["capacity"] == nums[0]["capacity"]
