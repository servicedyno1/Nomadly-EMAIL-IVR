# Iter226: web free test ring (GET/POST /numbers/:phone/test-call) + campaign not-in-service cleanup
import os
import time
import uuid
import pytest
import requests
from pymongo import MongoClient
from dotenv import dotenv_values

FRONT_ENV = dotenv_values("/app/frontend/.env")
BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or FRONT_ENV["REACT_APP_BACKEND_URL"]).rstrip("/")
API = f"{BASE_URL}/api/cloudivr-web"
BENV = dotenv_values("/app/backend/.env")

ALICE = ("civr.alice@example.com", "AliceTest#2026")
BOB = ("civr.bob@example.com", "BobTest#2026")
ALICE_ID = "5000000000000001"
BOB_ID = "5000000000000002"
ALICE_NUM = "+13346972125"  # Alice active business dry-run number (+15156445901 no longer exists on this DB)
BOB_NUM = "+18509558201"

RUN = uuid.uuid4().hex[:8]
BAD1, BAD2, GOOD1, GOOD2 = "+14155550911", "+14155550912", "+14155550913", "+14155550914"


def login(email, pw):
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json", "Origin": BASE_URL})
    r = s.post(f"{API}/auth/login", json={"email": email, "password": pw})
    if r.status_code != 200:
        pytest.skip(f"login failed {email}: {r.status_code} {r.text[:200]}")
    return s


@pytest.fixture(scope="module")
def alice():
    return login(*ALICE)


@pytest.fixture(scope="module")
def bob():
    return login(*BOB)


@pytest.fixture(scope="module")
def db():
    c = MongoClient(BENV["MONGO_URL"])
    yield c[BENV["DB_NAME"]]
    c.close()


@pytest.fixture(scope="module")
def seeded(db):
    camp_bad = f"TEST_iter226_bad_{RUN}"
    camp_ok = f"TEST_iter226_ok_{RUN}"
    camp_bob = f"TEST_iter226_bob_{RUN}"
    now = time.strftime("%Y-%m-%dT%H:%M:%SZ")
    stats = {"total": 4, "answered": 1, "keyPressed": 0, "transferred": 0, "noAnswer": 1, "hungUp": 0, "busy": 0, "failed": 2, "voicemail": 0, "completed": 4}
    leads = [
        {"index": 0, "number": BAD1, "name": "Bad One", "status": "failed", "hangupCause": "Not an in-service number — skipped, not charged"},
        {"index": 1, "number": BAD2, "status": "failed", "hangupCause": "unallocated_number"},
        {"index": 2, "number": GOOD1, "name": "Good One", "status": "answered", "hangupCause": "normal_clearing"},
        {"index": 3, "number": GOOD2, "status": "no_answer", "hangupCause": "timeout"},
    ]
    base = {"callerId": ALICE_NUM, "provider": "telnyx", "status": "completed", "concurrency": 1, "mode": "report_only",
            "audioName": "TEST audio", "activeKeys": ["1"], "stats": stats, "createdAt": now, "startedAt": now, "completedAt": now, "dryRun": True}
    db.bulkCallCampaigns.insert_many([
        {**base, "id": camp_bad, "chatId": ALICE_ID, "name": f"TEST_iter226 bad {RUN}", "leads": leads},
        {**base, "id": camp_ok, "chatId": ALICE_ID, "name": f"TEST_iter226 ok {RUN}", "leads": [leads[2], leads[3]]},
        {**base, "id": camp_bob, "chatId": BOB_ID, "name": f"TEST_iter226 bob {RUN}", "leads": leads},
    ])
    contact_ids = []
    for ph, owner in [(BAD1, ALICE_ID), (BAD2, ALICE_ID), (GOOD1, ALICE_ID), (BAD1, BOB_ID)]:
        cid = f"TEST_iter226_{uuid.uuid4().hex[:10]}"
        db.webContacts.insert_one({"_id": cid, "chatId": owner, "phone": ph, "name": "TEST_contact", "listIds": [], "source": "manual", "createdAt": now, "updatedAt": now})
        contact_ids.append(cid)
    yield {"bad": camp_bad, "ok": camp_ok, "bob": camp_bob, "contacts": contact_ids}
    db.bulkCallCampaigns.delete_many({"id": {"$in": [camp_bad, camp_ok, camp_bob]}})
    db.webContacts.delete_many({"_id": {"$in": contact_ids}})


# ── Free test ring ──
class TestTestRing:
    def test_status_idle_for_owner(self, alice):
        r = alice.get(f"{API}/numbers/{ALICE_NUM}/test-call")
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["state"] == "idle"
        assert d["max"] == 3 and d["maxSeconds"] == 60
        assert isinstance(d["left"], int) and 0 <= d["left"] <= 3

    def test_status_404_non_owner(self, alice):
        r = alice.get(f"{API}/numbers/{BOB_NUM}/test-call")
        assert r.status_code == 404
        assert r.json()["error"] == "not_found"

    def test_unauth_rejected(self):
        r = requests.get(f"{API}/numbers/{ALICE_NUM}/test-call")
        assert r.status_code == 401

    def test_post_own_number_dryrun(self, alice):
        r = alice.post(f"{API}/numbers/{ALICE_NUM}/test-call", json={})
        assert r.status_code == 202, r.text
        d = r.json()
        assert d["dryRun"] is True and d["to"] is None
        assert "your number" in d["message"]

    def test_post_other_number_dryrun(self, alice):
        r = alice.post(f"{API}/numbers/{ALICE_NUM}/test-call", json={"to": "+447911123456"})
        assert r.status_code == 202, r.text
        d = r.json()
        assert d["to"] == "+447911123456"
        assert "+447911123456" in d["message"]

    @pytest.mark.parametrize("to", ["123", "+19115550100"])
    def test_post_invalid_number(self, alice, to):
        r = alice.post(f"{API}/numbers/{ALICE_NUM}/test-call", json={"to": to})
        assert r.status_code == 400, r.text
        assert r.json()["error"] == "invalid_number"

    def test_post_non_owner_404(self, alice):
        r = alice.post(f"{API}/numbers/{BOB_NUM}/test-call", json={})
        assert r.status_code == 404

    def test_dryrun_does_not_consume_quota(self, alice):
        assert alice.get(f"{API}/numbers/{ALICE_NUM}/test-call").json()["state"] == "idle"


# ── Bad-number cleanup ──
class TestBadNumbers:
    def test_campaign_detail_counts(self, alice, seeded):
        r = alice.get(f"{API}/campaigns/{seeded['bad']}")
        assert r.status_code == 200, r.text
        c = r.json()["campaign"]
        assert c["notInService"] == 2
        assert c["badNumbersCleanedAt"] is None

    def test_other_users_campaign_404(self, alice, seeded):
        assert alice.get(f"{API}/campaigns/{seeded['bob']}").status_code == 404
        r = alice.post(f"{API}/campaigns/{seeded['bob']}/remove-bad-numbers", json={})
        assert r.status_code == 404

    def test_nothing_to_remove(self, alice, seeded):
        r = alice.post(f"{API}/campaigns/{seeded['ok']}/remove-bad-numbers", json={})
        assert r.status_code == 400
        assert r.json()["error"] == "nothing_to_remove"

    def test_remove_and_persist(self, alice, seeded, db):
        r = alice.post(f"{API}/campaigns/{seeded['bad']}/remove-bad-numbers", json={})
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["numbers"] == 2 and d["removed"] == 2
        assert d["cleanList"].split("\n") == [f"{GOOD1},Good One", GOOD2]
        # Alice bad contacts gone, good kept, Bob's same number untouched
        assert db.webContacts.count_documents({"chatId": ALICE_ID, "phone": {"$in": [BAD1, BAD2]}}) == 0
        assert db.webContacts.count_documents({"chatId": ALICE_ID, "phone": GOOD1}) == 1
        assert db.webContacts.count_documents({"chatId": BOB_ID, "phone": BAD1}) == 1
        c = alice.get(f"{API}/campaigns/{seeded['bad']}").json()["campaign"]
        assert c["badNumbersCleanedAt"] is not None
        assert c["badNumbersRemoved"] == 2

    def test_remove_again_idempotent(self, alice, seeded):
        r = alice.post(f"{API}/campaigns/{seeded['bad']}/remove-bad-numbers", json={})
        assert r.status_code == 200
        assert r.json()["removed"] == 0
