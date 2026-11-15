# Iteration 296: pay first, details after payment (fax numbers + calling numbers) — web API regression
import os
import datetime
import pytest
import requests
from pymongo import MongoClient

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL').rstrip('/')
API = f"{BASE_URL}/api/cloudivr-web"
CHAT = "5000000000000077"
SEED_PHONE = "+4930999000"


def _mongo():
    env = {}
    with open('/app/backend/.env') as f:
        for line in f:
            line = line.strip()
            if line.startswith('MONGO_URL=') or line.startswith('DB_NAME='):
                k, v = line.split('=', 1)
                env[k] = v.strip('"\'')
    return MongoClient(env['MONGO_URL'])['test']


@pytest.fixture(scope="module")
def s():
    ses = requests.Session()
    r = ses.post(f"{API}/auth/login", json={"email": "civr.uxtest@example.com", "password": "UxTest#2026"})
    if r.status_code != 200:
        pytest.skip(f"login failed {r.status_code}")
    return ses


@pytest.fixture(scope="module")
def db():
    return _mongo()


def bal(s):
    return float(s.get(f"{API}/wallet").json()["balance"])


# Offer: no paperwork leaks before payment
def test_fax_offer_hides_paperwork(s):
    d = s.get(f"{API}/fax-numbers").json()
    assert d["available"] is True
    keys = {k for c in d["countries"] for t in c["types"] for k in t}
    assert keys == {"type", "label"}
    de = next(c for c in d["countries"] if c["code"] == "DE")
    assert [t["type"] for t in de["types"]] == ["local", "national"]


def test_public_fax_offer_hides_paperwork():
    d = requests.get(f"{API}/public/fax-offer").json()
    keys = {k for c in d["countries"] for t in c["types"] for k in t}
    assert keys == {"type", "label"}


def _buy_fax(s, country, type_="local"):
    r = s.get(f"{API}/fax-numbers/search", params={"country": country, "type": type_}, timeout=60)
    assert r.status_code == 200, r.text
    nums = r.json()["numbers"]
    assert nums, f"no {country} fax numbers"
    phone = nums[0]["phoneNumber"]
    before = bal(s)
    r = s.post(f"{API}/fax-numbers", json={"phoneNumber": phone, "autoRenew": True}, timeout=60)
    return r, before


# Fax buy of a documents country → paid, pending_registration, needsDetails; cancel refunds
class TestFaxPayThenDetails:
    def test_fr_buy_without_docs_then_details_error_then_cancel(self, s, db):
        r, before = _buy_fax(s, "FR")
        assert r.status_code == 200, r.text
        n = r.json()["number"]
        phone = n["phoneNumber"]
        try:
            assert n["status"] == "pending_registration"
            assert n["registration"]["needsDetails"] is True
            assert n["registration"]["paperwork"] == "documents"
            assert n["registration"]["refundBy"]
            price = n["price"]
            assert abs(bal(s) - (before - price)) < 0.01
            # GET /fax lists it with registration
            f = s.get(f"{API}/fax").json()
            row = next(x for x in f["numbers"] if x["phoneNumber"] == phone)
            assert row["registration"]["needsDetails"] is True
            # details without FR documents → 400 paperwork_needed
            d = s.post(f"{API}/fax-numbers/{requests.utils.quote(phone, safe='')}/details", json={})
            assert d.status_code == 400, d.text
            assert d.json()["error"] == "paperwork_needed"
            assert d.json()["message"]
            print("details msg:", d.json()["message"])
            # cancel → refund
            c = s.post(f"{API}/fax-numbers/{requests.utils.quote(phone, safe='')}/cancel", json={})
            assert c.status_code == 200, c.text
            assert c.json()["refunded"] == price
            assert abs(bal(s) - before) < 0.01
            doc = db.faxNumbers.find_one({"_id": phone})
            assert doc["status"] == "released"
            assert doc["releaseReason"] == "cancelled_by_customer"
            assert phone not in [x["phoneNumber"] for x in s.get(f"{API}/fax-numbers").json()["numbers"]]
            # second cancel / details → 404
            assert s.post(f"{API}/fax-numbers/{requests.utils.quote(phone, safe='')}/cancel", json={}).status_code == 404
            assert s.post(f"{API}/fax-numbers/{requests.utils.quote(phone, safe='')}/details", json={}).status_code == 404
        finally:
            doc = db.faxNumbers.find_one({"_id": phone})
            if doc and doc["status"] != "released":
                s.post(f"{API}/fax-numbers/{requests.utils.quote(phone, safe='')}/cancel", json={})

    def test_de_buy_then_details_with_docs(self, s, db):
        # Account has a DE document uploaded → details may go through (depends on legal profile + signature)
        r, before = _buy_fax(s, "DE")
        assert r.status_code == 200, r.text
        n = r.json()["number"]
        phone = n["phoneNumber"]
        q = requests.utils.quote(phone, safe='')
        try:
            assert n["status"] == "pending_registration"
            assert n["registration"]["needsDetails"] is True
            d = s.post(f"{API}/fax-numbers/{q}/details", json={})
            print("DE details:", d.status_code, d.text[:300])
            assert d.status_code in (200, 400)
            if d.status_code == 200:
                assert d.json()["number"]["registration"]["needsDetails"] is False
                assert d.json()["number"]["status"] == "pending_registration"
            # cancel still allowed while pending (full refund)
            c = s.post(f"{API}/fax-numbers/{q}/cancel", json={})
            assert c.status_code == 200, c.text
            assert abs(bal(s) - before) < 0.01
        finally:
            doc = db.faxNumbers.find_one({"_id": phone})
            if doc and doc["status"] != "released":
                s.post(f"{API}/fax-numbers/{q}/cancel", json={})

    def test_unknown_fax_details_cancel_404(self, s):
        assert s.post(f"{API}/fax-numbers/%2B4999999999/details", json={}).status_code == 404
        assert s.post(f"{API}/fax-numbers/%2B4999999999/cancel", json={}).status_code == 404

    def test_active_fax_cannot_be_cancelled(self, s, db):
        act = db.faxNumbers.find_one({"chatId": CHAT, "status": "active"})
        if not act:
            pytest.skip("no active fax number")
        q = requests.utils.quote(act["_id"], safe='')
        assert s.post(f"{API}/fax-numbers/{q}/cancel", json={}).status_code == 404
        assert s.post(f"{API}/fax-numbers/{q}/details", json={}).status_code == 404


# Calling numbers: search hides paperwork; seeded needs_details number → registration endpoints
class TestCallingNumbers:
    @pytest.mark.parametrize("q", [("DE", "national"), ("AU", "local"), ("SG", "local")])
    def test_search_paperwork_null(self, s, q):
        r = s.get(f"{API}/numbers/search", params={"country": q[0], "type": q[1]}, timeout=60)
        assert r.status_code == 200
        assert r.json()["paperwork"] is None

    def test_seeded_registration_cancel_refund(self, s, db):
        db.phoneNumbersOf.update_one({"_id": CHAT}, {"$pull": {"val.numbers": {"phoneNumber": SEED_PHONE}}})
        db.phoneNumbersOf.update_one({"_id": CHAT}, {"$push": {"val.numbers": {
            "phoneNumber": SEED_PHONE, "provider": "multitel", "status": "active", "country": "DE", "type": "local",
            "plan": "business", "planPrice": 120, "dryRun": True,
            "registration": {"status": "needs_details", "level": 2, "since": datetime.datetime.utcnow().isoformat() + "Z", "paid": 120}}}})
        q = requests.utils.quote(SEED_PHONE, safe='')
        w0 = db.walletOf.find_one({"_id": CHAT})
        try:
            g = s.get(f"{API}/numbers/{q}")
            assert g.status_code == 200, g.text
            reg = g.json()["number"]["registration"]
            assert reg["needsDetails"] is True and reg["status"] == "needs_details" and reg["refundBy"]
            d = s.post(f"{API}/numbers/{q}/registration", json={})
            print("calling details:", d.status_code, d.text[:300])
            # DE local has no MultiTEL offer in catalog → expect 409 not_waiting (or 400 paperwork)
            assert d.status_code in (400, 409)
            before = bal(s)
            c = s.post(f"{API}/numbers/{q}/registration/cancel", json={})
            assert c.status_code == 200, c.text
            assert c.json()["refunded"] == 120
            assert abs(bal(s) - (before + 120)) < 0.01
            again = s.post(f"{API}/numbers/{q}/registration/cancel", json={})
            assert again.status_code in (404, 409)
        finally:
            db.phoneNumbersOf.update_one({"_id": CHAT}, {"$pull": {"val.numbers": {"phoneNumber": SEED_PHONE}}})
            # seeded number was never paid → undo the test refund
            db.walletOf.replace_one({"_id": CHAT}, w0)
