# Infobip countries on CloudIVR web "Get a number": catalog, instant search/buy, request-based orders (dry-run)
import os, time, subprocess, json
import pytest, requests
from pymongo import MongoClient

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL').rstrip('/')
API = f"{BASE_URL}/api/cloudivr-web"
QA = {"email": "qa.iter266318ef6@example.com", "password": "QaTest#2026x"}
UX = {"email": "civr.uxtest@example.com", "password": "UxTest#2026"}
QA_ID = "5000000000000092"
INSTANT = ["AR", "CL", "ES", "FR", "HR", "LT", "MX", "MY", "PL", "PR", "RO", "UA"]
REQ = {"AT": "none", "CR": "none", "DO": "none", "EC": "none", "PE": "none", "PY": "none", "SE": "name",
       "AU": "name_address", "DK": "name_address", "DE": "name_address", "CY": "name_address"}
CREATED = {"numbers": [], "requests": []}


def _env(k):
    for line in open('/app/backend/.env'):
        if line.startswith(k + '='):
            return line.split('=', 1)[1].strip().strip('"')


db = MongoClient(_env('MONGO_URL'))[_env('DB_NAME')]


def set_wallet(amount):
    subprocess.run(['python3', '/app/backend/tests/wallet_helper.py', QA_ID, 'set', str(amount)], check=True, capture_output=True)


def balance(s):
    return s.get(f"{API}/wallet").json().get("balance")


def login(creds):
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json=creds)
    if r.status_code != 200:
        pytest.skip(f"login failed {r.status_code}")
    return s


@pytest.fixture(scope="module")
def qa():
    return login(QA)


@pytest.fixture(scope="module")
def ux():
    return login(UX)


@pytest.fixture(scope="module")
def plan_price(qa):
    cat = qa.get(f"{API}/catalog").json()
    plans = cat.get("plans")
    p = next((x for x in plans if x.get("id") == "starter"), None) if isinstance(plans, list) else plans.get("starter")
    return float(p["price"])


# Catalog
class TestCatalog:
    def test_catalog_infobip_countries(self, qa):
        cs = {c["code"]: c for c in qa.get(f"{API}/catalog").json()["countries"]}
        for cc in INSTANT:
            assert cc in cs, cc
            assert cs[cc].get("provider") == "infobip", cc
            assert not cs[cc].get("request"), cc
        for cc, det in REQ.items():
            assert cc in cs, cc
            assert cs[cc].get("provider") == "infobip", cc
            assert cs[cc]["request"]["details"] == det, cc
            assert cs[cc]["request"]["localOnly"] == (cc in ("DE", "CY")), cc
        assert "US" in cs and cs["US"].get("provider") != "infobip"


# Search
class TestSearch:
    def test_search_fr_surcharge_zero(self, qa):
        r = qa.get(f"{API}/numbers/search", params={"country": "FR", "type": "local"})
        assert r.status_code == 200, r.text
        nums = r.json()["numbers"]
        assert len(nums) > 0
        assert all(n["surcharge"] == 0 for n in nums)

    def test_search_au_request(self, qa):
        d = qa.get(f"{API}/numbers/search", params={"country": "AU"}).json()
        assert d["numbers"] == []
        assert d["request"]["details"] == "name_address" and d["request"]["country"] == "AU"
        assert d["request"]["name"] == "Australia" and d["request"]["flag"]

    def test_search_us_regression(self, qa):
        r = qa.get(f"{API}/numbers/search", params={"country": "US", "type": "local"})
        assert r.status_code == 200, r.text
        assert len(r.json()["numbers"]) > 0


# Buy instant (FR) + US regression
class TestBuy:
    def test_buy_fr(self, qa, plan_price):
        set_wallet(300)
        nums = qa.get(f"{API}/numbers/search", params={"country": "FR", "type": "local"}).json()["numbers"]
        phone = nums[0]["phoneNumber"]
        b0 = balance(qa)
        r = qa.post(f"{API}/numbers/buy", json={"phoneNumber": phone, "plan": "starter"})
        assert r.status_code in (200, 201), r.text
        CREATED["numbers"].append(phone)
        assert round(b0 - balance(qa), 2) == plan_price
        doc = db.phoneNumbersOf.find_one({"_id": QA_ID}) or db.phoneNumbersOf.find_one({"_id": int(QA_ID)})
        n = next(x for x in doc["val"]["numbers"] if x["phoneNumber"] == phone)
        assert n["provider"] == "infobip" and n["country"] == "FR"
        assert not n.get("numberSurcharge")

    def test_buy_us_regression(self, qa, plan_price):
        set_wallet(300)
        nums = qa.get(f"{API}/numbers/search", params={"country": "US", "type": "local"}).json()["numbers"]
        n0 = nums[0]
        b0 = balance(qa)
        r = qa.post(f"{API}/numbers/buy", json={"phoneNumber": n0["phoneNumber"], "plan": "starter"})
        assert r.status_code in (200, 201), r.text
        CREATED["numbers"].append(n0["phoneNumber"])
        assert round(b0 - balance(qa), 2) == round(plan_price + (n0.get("surcharge") or 0), 2)


# Request-based countries
class TestRequest:
    def test_invalid_country(self, qa):
        r = qa.post(f"{API}/numbers/request", json={"country": "GB", "plan": "starter"})
        assert r.status_code == 400 and r.json()["error"] == "invalid_country"

    def test_invalid_plan(self, qa):
        r = qa.post(f"{API}/numbers/request", json={"country": "AU", "plan": "nope"})
        assert r.status_code == 400

    def test_profile_required(self, ux):
        r = ux.post(f"{API}/numbers/request", json={"country": "AU", "plan": "starter"})
        assert r.status_code == 428, r.text
        assert r.json().get("error") == "profile_required"

    def test_insufficient(self, qa):
        set_wallet(1)
        r = qa.post(f"{API}/numbers/request", json={"country": "AU", "plan": "starter"})
        assert r.status_code == 402, r.text
        assert balance(qa) == 1

    def test_request_flow_to_active(self, qa, plan_price):
        set_wallet(300)
        b0 = balance(qa)
        r = qa.post(f"{API}/numbers/request", json={"country": "AU", "plan": "starter"})
        assert r.status_code == 202, r.text
        req = r.json()["request"]
        CREATED["requests"].append(req["id"])
        assert req["status"] == "submitted" and req["price"] == plan_price
        assert round(b0 - balance(qa), 2) == plan_price
        lst = qa.get(f"{API}/numbers/requests").json()["requests"]
        assert any(x["id"] == req["id"] for x in lst)
        deadline = time.time() + 170
        got = None
        while time.time() < deadline:
            got = next(x for x in qa.get(f"{API}/numbers/requests").json()["requests"] if x["id"] == req["id"])
            if got["status"] == "active":
                break
            time.sleep(10)
        assert got["status"] == "active", got
        assert got["phoneNumber"]
        CREATED["numbers"].append(got["phoneNumber"])
        assert round(b0 - balance(qa), 2) == plan_price  # no second debit
        mine = [n["phoneNumber"] for n in qa.get(f"{API}/numbers").json()["numbers"]]
        assert got["phoneNumber"] in mine
        doc = db.phoneNumbersOf.find_one({"_id": QA_ID}) or db.phoneNumbersOf.find_one({"_id": int(QA_ID)})
        n = next(x for x in doc["val"]["numbers"] if x["phoneNumber"] == got["phoneNumber"])
        assert n["provider"] == "infobip" and n["country"] == "AU"


def teardown_module(module):
    with open('/tmp/infobip_created.json', 'w') as f:
        json.dump(CREATED, f)
