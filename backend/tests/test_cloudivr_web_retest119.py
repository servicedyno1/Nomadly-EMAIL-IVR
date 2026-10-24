# CloudIVR web retest (iteration 119): downgrade→upgrade restores settings + keeps surcharge, scheduled preview
# calls past their time become 'completed', voice prefs default, coupon used flag. DRY-RUN preview.
import os
import datetime as dt
import pytest
import requests
from pymongo import MongoClient

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL').rstrip('/')
API = f"{BASE_URL}/api/cloudivr-web"
A = ("civr.alice@example.com", "AliceTest#2026")
B = ("civr.bob@example.com", "BobTest#2026")
ALICE_MAIN = "+15156445205"
ALICE_EXTRA = "+15512568232"
ALICE_ID = "5000000000000001"


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


def main_num(db):
    d = db.phoneNumbersOf.find_one({"_id": ALICE_ID})
    return next(n for n in d["val"]["numbers"] if n["phoneNumber"] == ALICE_MAIN)


# ── Downgrade → upgrade round trip ──
class TestDowngradeRestore:
    def test_round_trip_restores_recording_and_surcharge(self, sa, db):
        n = main_num(db)
        assert n["plan"] == "business", "precondition: Alice main on Business"
        orig_price = n["planPrice"]
        # turn recording on
        r = sa.patch(f"{API}/numbers/{enc(ALICE_MAIN)}/recording", json={"enabled": True})
        assert r.status_code == 200 and r.json()["recording"] is True
        # add a $5 surcharge to verify it is kept by downgrade+upgrade
        db.phoneNumbersOf.update_one({"_id": ALICE_ID, "val.numbers.phoneNumber": ALICE_MAIN}, {"$set": {"val.numbers.$.planPrice": orig_price + 5}})
        try:
            p = sa.post(f"{API}/numbers/{enc(ALICE_MAIN)}/downgrade", json={"plan": "pro"}).json()["preview"]
            assert p["planName"] == "Pro"
            assert p["newPrice"] == 80
            d = sa.post(f"{API}/numbers/{enc(ALICE_MAIN)}/downgrade", json={"plan": "pro", "confirm": True})
            assert d.status_code == 200, d.text
            dj = d.json()
            assert dj["planName"] == "Pro" and dj["planPrice"] == 80
            n = main_num(db)
            assert n["features"]["recording"] is False
            assert any(x["path"] == "features.recording" and x["value"] is True for x in n["downgradeSaved"])
            q = sa.post(f"{API}/numbers/{enc(ALICE_MAIN)}/upgrade", json={"plan": "business"}).json()["quote"]
            assert q["newPrice"] == orig_price + 5
            u = sa.post(f"{API}/numbers/{enc(ALICE_MAIN)}/upgrade", json={"plan": "business", "confirm": True})
            assert u.status_code == 200, u.text
            n = main_num(db)
            assert n["plan"] == "business"
            assert n["planPrice"] == orig_price + 5, "surcharge must be kept"
            assert n["features"]["recording"] is True, "recording must be restored"
            assert n["downgradeSaved"] == []
            g = sa.get(f"{API}/numbers/{enc(ALICE_MAIN)}").json()["number"]
            assert g["plan"] == "business"
        finally:
            db.phoneNumbersOf.update_one({"_id": ALICE_ID, "val.numbers.phoneNumber": ALICE_MAIN}, {"$set": {"val.numbers.$.planPrice": orig_price}})


# ── Scheduled calls: past preview entries become completed ──
class TestScheduledCompleted:
    def test_past_preview_marked_completed(self, sa, db):
        at = (dt.datetime.utcnow() + dt.timedelta(hours=2)).isoformat() + "Z"
        r = sa.post(f"{API}/calls/quick", json={"callerId": ALICE_MAIN, "to": "+14155550177", "text": "TEST sched", "transferTo": "+14155550199", "activeKeys": ["1"], "scheduleAt": at})
        assert r.status_code == 201, r.text
        lst = sa.get(f"{API}/calls/scheduled").json()["calls"]
        mine = next(c for c in lst if c.get("to") == "+14155550177" and c["status"] == "preview")
        # move it into the past
        db.scheduledCalls.update_one({"_id": mine["id"]}, {"$set": {"scheduledAt": dt.datetime.utcnow() - dt.timedelta(minutes=5)}})
        lst = sa.get(f"{API}/calls/scheduled").json()["calls"]
        c = next(c for c in lst if c["id"] == mine["id"])
        assert c["status"] == "completed"
        assert not any(c["status"] == "preview" and dt.datetime.fromisoformat(c["scheduledFor"].replace("Z", "+00:00")) < dt.datetime.now(dt.timezone.utc) for c in lst)


# ── Voice prefs + coupons ──
class TestPrefsCoupons:
    def test_alice_voice_pref(self, sa):
        d = sa.get(f"{API}/prefs/voice").json()
        assert d["voice"] == "onyx" and d["canSave"] is True

    def test_coupon_used_flags(self, sa, sb):
        ta = sa.get(f"{API}/coupons/today").json()["coupon"]
        tb = sb.get(f"{API}/coupons/today").json()["coupon"]
        assert ta and tb
        assert ta["used"] is True and tb["used"] is True
