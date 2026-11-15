# CloudIVR web iter284: retest of iter283 fixes - permission ask/log timing, record fields, stuck lookup batch, offer plan name.
import os, time, pytest, requests
from pymongo import MongoClient

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL').rstrip('/')
API = f"{BASE_URL}/api/cloudivr-web"

def _env(k):
    for line in open('/app/backend/.env'):
        if line.startswith(k + '='):
            return line.split('=', 1)[1].strip().strip('"')
mdb = MongoClient(_env('MONGO_URL'))[_env('DB_NAME')]

TEST_EMAIL = f"test_perm284_{int(time.time())}@example.com"
TEST_PW = "TestPerm#2026x"
QUICK = {"targets": "+14155550100", "mode": "transfer", "text": "TEST_ hello press one", "templateName": "Custom script", "transferTo": "+14155550111", "activeKeys": ["1"]}

def acc(): return mdb.webAccounts.find_one({"email": TEST_EMAIL})
def cid(): return str(int(acc()["_id"]))
def perms(kind): return mdb.callPermissions.count_documents({"chatId": cid(), "kind": kind})

@pytest.fixture(scope="module")
def s():
    s = requests.Session()
    r = s.post(f"{API}/auth/register", json={"email": TEST_EMAIL, "password": TEST_PW, "name": "TEST_ Perm284", "acceptPolicy": True})
    assert r.status_code in (200, 201), r.text
    r = s.put(f"{API}/profile/legal", json={"type": "individual", "fullName": "TEST_ Perm284 User", "address": {"line1": "1 Main St", "city": "Austin", "postalCode": "78701", "countryCode": "US"}})
    assert r.status_code == 200, r.text
    yield s
    a = acc()
    if a: mdb.callPermissions.delete_many({"chatId": str(int(a["_id"]))})  # only this run's TEST_ account

# --- Campaign validateOnly pre-check skips permission
def test_campaign_validate_only_no_428(s):
    r = s.post(f"{API}/campaigns", json={"name": "TEST_v", "leads": "+14155550100", "validateOnly": True, "audioPending": True})
    print("validateOnly", r.status_code, r.text[:200])
    assert r.status_code != 428
    assert perms("campaign") == 0

# --- Rejected campaign (invalid caller / 503) writes NO record
def test_rejected_campaign_no_record(s):
    r = s.post(f"{API}/campaigns", json={"name": "TEST_rej", "leads": "+14155550100 +14155550101", "callerId": "+10000000000"})
    assert r.status_code == 428 and r.json()["kind"] == "campaign"
    r2 = s.post(f"{API}/campaigns", json={"name": "TEST_rej", "leads": "+14155550100 +14155550101", "callerId": "+10000000000", "permissionConfirmed": True})
    print("confirmed rejected", r2.status_code, r2.text[:200])
    assert r2.status_code >= 300
    time.sleep(1)
    assert perms("campaign") == 0

# --- Quick IVR rejected (400) does not set quickIvrPermissionAt or log
def test_quick_rejected_no_flag(s):
    r = s.post(f"{API}/calls/quick", json={**QUICK, "callerId": "+10000000000", "permissionConfirmed": True})
    print("quick rejected", r.status_code, r.text[:200])
    assert r.status_code >= 400 and r.status_code != 428
    time.sleep(1)
    assert acc().get("quickIvrPermissionAt") is None
    assert perms("quick") == 0
    # still asked afterwards
    r = s.post(f"{API}/calls/quick", json={**QUICK, "callerId": "+10000000000"})
    assert r.status_code == 428 and r.json()["error"] == "permission_required"

# --- Quick IVR regression: no own number -> cannot succeed for TEST_ account; check behaviour
def test_quick_no_number_status(s):
    nums = s.get(f"{API}/numbers").json().get("numbers", [])
    print("test acct numbers", len(nums))

# --- Offer banner never says 'undefined'
@pytest.mark.parametrize("cred", [("civr.uxtest@example.com", "UxTest#2026"), ("civr.alice@example.com", "AliceTest#2026"), ("civr.bob@example.com", "BobTest#2026")])
def test_offer_no_undefined(cred):
    x = requests.Session()
    assert x.post(f"{API}/auth/login", json={"email": cred[0], "password": cred[1]}).status_code == 200
    r = x.get(f"{API}/offers/current")
    print(cred[0], r.status_code, r.text[:400])
    assert r.status_code == 200
    assert r.headers.get("content-type","").startswith("application/json")
    assert "undefined" not in r.text
