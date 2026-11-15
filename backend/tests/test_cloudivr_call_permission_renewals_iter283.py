# CloudIVR web iter283: call-permission ask (Quick IVR once / every campaign), callPermissions log, renewals auto-renew toggle.
import os, time, pytest, requests
from pymongo import MongoClient

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL').rstrip('/')
API = f"{BASE_URL}/api/cloudivr-web"

def _env(k):
    for line in open('/app/backend/.env'):
        if line.startswith(k + '='):
            return line.split('=', 1)[1].strip().strip('"')
mdb = MongoClient(_env('MONGO_URL'))[_env('DB_NAME')]

ALICE = ("civr.alice@example.com", "AliceTest#2026")
UX = ("civr.uxtest@example.com", "UxTest#2026")
BOB = ("civr.bob@example.com", "BobTest#2026")

def login(em, pw):
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": em, "password": pw})
    if r.status_code != 200: pytest.skip(f"login failed {r.text}")
    return s

def acc(em): return mdb.webAccounts.find_one({"email": em})

TEST_EMAIL = f"test_perm{int(time.time())}@example.com"
TEST_PW = "TestPerm#2026x"

@pytest.fixture(scope="module")
def tsess():
    # TEST_ account with a completed legal profile (the seeded accounts have none -> profile_required fires first).
    s = requests.Session()
    r = s.post(f"{API}/auth/register", json={"email": TEST_EMAIL, "password": TEST_PW, "name": "TEST_ Perm", "acceptPolicy": True})
    assert r.status_code in (200, 201), r.text
    r = s.put(f"{API}/profile/legal", json={"type": "individual", "fullName": "TEST_ Perm User", "address": {"line1": "1 Main St", "city": "Austin", "postalCode": "78701", "countryCode": "US"}})
    assert r.status_code == 200, r.text
    yield s
    a = acc(TEST_EMAIL)
    if a: mdb.callPermissions.delete_many({"chatId": str(int(a["_id"]))})  # only this run's TEST_ account records


# --- Quick IVR permission: asked once per account
class TestQuickPermission:
    def test_quick_requires_permission_then_once(self, tsess):
        s = tsess
        a = acc(TEST_EMAIL)
        if a.get("quickIvrPermissionAt"): pytest.skip("alice already confirmed quick")
        nums = s.get(f"{API}/numbers").json().get("numbers", [])
        caller = nums[0]["phoneNumber"] if nums else "+10000000000"
        body = {"callerId": caller, "targets": "+14155550100", "mode": "transfer", "text": "TEST_ hello press one", "templateName": "Custom script", "transferTo": "+14155550111", "activeKeys": ["1"]}
        r = s.post(f"{API}/calls/quick", json=body)
        print("quick no-confirm", r.status_code, r.text[:300])
        if r.status_code == 428 and r.json().get("error") == "profile_required": pytest.skip("profile gate fired first")
        assert r.status_code == 428
        assert r.json()["error"] == "permission_required" and r.json()["kind"] == "quick"
        before = mdb.callPermissions.count_documents({"chatId": str(int(a["_id"])), "kind": "quick"})
        r2 = s.post(f"{API}/calls/quick", json={**body, "permissionConfirmed": True})
        print("quick confirm", r2.status_code, r2.text[:300])
        assert r2.status_code != 428
        assert mdb.callPermissions.count_documents({"chatId": str(int(a["_id"])), "kind": "quick"}) == before + 1
        assert acc(TEST_EMAIL).get("quickIvrPermissionAt") is not None
        r3 = s.post(f"{API}/calls/quick", json=body)
        print("quick after", r3.status_code, r3.text[:300])
        assert r3.status_code != 428

# --- Campaign permission: asked every time
class TestCampaignPermission:
    def test_campaign_requires_permission_every_time(self, tsess):
        s = tsess
        a = acc(TEST_EMAIL)
        name = f"TEST_perm_{int(time.time())}"
        for i in range(2):
            r = s.post(f"{API}/campaigns", json={"name": name, "leads": "+14155550100"})
            assert r.status_code == 428, r.text
            assert r.json()["kind"] == "campaign"
            r2 = s.post(f"{API}/campaigns", json={"name": name, "leads": "+14155550100", "permissionConfirmed": True})
            print("campaign confirmed", r2.status_code, r2.text[:200])  # Bob has no numbers -> rejected after the permission check
            assert r2.status_code != 428
        docs = list(mdb.callPermissions.find({"chatId": str(int(a["_id"])), "kind": "campaign", "campaign.name": name}))
        print("logged", [d.get("campaign") for d in docs])
        assert len(docs) == 2

    def test_validate_only_also_asks(self, tsess):
        # Campaigns.js sends validateOnly first (script → AI voice), then the real create: two prompts for one campaign.
        s = tsess
        r = s.post(f"{API}/campaigns", json={"name": "TEST_v", "leads": "+14155550100", "validateOnly": True, "audioPending": True})
        print("validateOnly", r.status_code, r.text[:200])
        assert r.status_code != 428, "validateOnly pre-check also demands permission -> user asked twice"

    def test_bad_campaign_still_logged(self, tsess):
        # Permission is logged before validation: a rejected campaign (no caller number) still leaves a callPermissions record.
        a = acc(TEST_EMAIL); name = f"TEST_rejected_{int(time.time())}"
        r = tsess.post(f"{API}/campaigns", json={"name": name, "leads": "+14155550100", "permissionConfirmed": True})
        print("rejected", r.status_code, r.text[:150])
        n = mdb.callPermissions.count_documents({"chatId": str(int(a["_id"])), "campaign.name": name})
        print("records for rejected campaign:", n)
        assert n == 0, "permission logged for a campaign that was rejected (no caller number)"

    def test_unauth_401(self):
        r = requests.post(f"{API}/campaigns", json={})
        assert r.status_code == 401

# --- Renewals: auto-renew toggle persists in GET /numbers
class TestRenewals:
    def test_toggle_auto_renew(self):
        s = login(*UX)
        nums = s.get(f"{API}/numbers").json()["numbers"]
        n = next(x for x in nums if x["phoneNumber"] == "+13341112222")
        orig = n.get("autoRenew") is not False
        try:
            r = s.post(f"{API}/numbers/%2B13341112222/auto-renew", json={"enabled": False})
            assert r.status_code == 200, r.text
            n2 = next(x for x in s.get(f"{API}/numbers").json()["numbers"] if x["phoneNumber"] == "+13341112222")
            assert n2["autoRenew"] is False
            r = s.post(f"{API}/numbers/%2B13341112222/auto-renew", json={"enabled": True})
            assert r.status_code == 200
            n3 = next(x for x in s.get(f"{API}/numbers").json()["numbers"] if x["phoneNumber"] == "+13341112222")
            assert n3["autoRenew"] is True
        finally:
            s.post(f"{API}/numbers/%2B13341112222/auto-renew", json={"enabled": orig})

    def test_esim_fax_lists_ok(self):
        s = login(*UX)
        assert s.get(f"{API}/esim").status_code == 200
        assert s.get(f"{API}/fax-numbers").status_code == 200
