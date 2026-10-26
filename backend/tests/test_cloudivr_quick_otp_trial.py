# CloudIVR web: free Quick IVR trial call, OTP code collection (Accept/Decline/Hang up), Pro/Business gating.
# Preview (dry-run) only — nothing dials. Does NOT buy numbers. Uses Alice (Business +13313039039, seeded Pro +13313039077)
# and fresh throwaway registrations (each gets one free call).
import os, time, uuid
from datetime import datetime, timedelta, timezone
import pytest, requests

BASE = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/') or open('/app/frontend/.env').read().split('REACT_APP_BACKEND_URL=')[1].split()[0].rstrip('/')
API = f"{BASE}/api/cloudivr-web"
ALICE = ("civr.alice@example.com", "AliceTest#2026")
BUSINESS = "+13313039039"
PRO = "+13313039077"
TEXT = "Hello, this is a quick test call from CloudIVR."


def login(email, pw):
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": email, "password": pw})
    if r.status_code != 200:
        pytest.skip(f"login failed {email}: {r.status_code} {r.text[:200]}")
    return s


def fresh():
    s = requests.Session()
    r = s.post(f"{API}/auth/register", json={"email": f"test_trial_{uuid.uuid4().hex[:8]}@example.com", "password": "TestPass#2026", "name": "TEST Trial"})
    if r.status_code != 201:
        pytest.skip(f"register failed {r.status_code} {r.text[:200]}")
    return s


@pytest.fixture(scope="module")
def alice():
    return login(*ALICE)


def wait_state(s, ccid, want, timeout=20):
    end = time.time() + timeout
    last = None
    while time.time() < end:
        last = s.get(f"{API}/calls/otp/{ccid}").json()
        if last.get("state") == want:
            return last
        time.sleep(1)
    return last


# --- Free trial call ---
class TestTrial:
    def test_new_account_trial_available_and_dashboard_flag(self):
        s = fresh()
        t = s.get(f"{API}/calls/trial").json()
        assert t["available"] is True and t["used"] is False
        assert t["callerId"] == "+18889020132"
        d = s.get(f"{API}/dashboard").json()
        assert d.get("ivrTrial") is True

    def test_trial_validation(self):
        s = fresh()
        r = s.post(f"{API}/calls/trial", json={"to": "+14155550111", "text": TEXT})
        assert r.status_code == 400 and r.json()["error"] == "invalid_transfer"
        r = s.post(f"{API}/calls/trial", json={"to": "+14155550111", "text": TEXT, "menu": {"1": {"action": "forward", "to": "+14155550122"}}})
        assert r.status_code == 400
        r = s.post(f"{API}/calls/trial", json={"to": "+14155550111,+14155550112", "text": TEXT, "transferTo": "+14155550122"})
        assert r.status_code == 400 and r.json()["error"] == "too_many_numbers"
        # validation failures must not use up the trial
        assert s.get(f"{API}/calls/trial").json()["available"] is True

    def test_trial_transfer_then_used(self):
        s = fresh()
        r = s.post(f"{API}/calls/trial", json={"to": "+14155550111", "text": TEXT, "transferTo": "+14155550122"})
        assert r.status_code == 202, r.text
        b = r.json()
        assert b["dryRun"] is True and b["trial"]["available"] is False
        assert s.get(f"{API}/calls/trial").json()["available"] is False
        assert s.get(f"{API}/dashboard").json().get("ivrTrial") is False
        r2 = s.post(f"{API}/calls/trial", json={"to": "+14155550111", "text": TEXT, "transferTo": "+14155550122"})
        assert r2.status_code == 403 and r2.json()["error"] == "trial_used"

    def test_trial_otp_without_connect(self):
        s = fresh()
        r = s.post(f"{API}/calls/trial", json={"to": "+14155550111", "text": TEXT, "mode": "otp", "otp": {"length": 4}})
        assert r.status_code == 202, r.text
        ccid = r.json()["results"][0]["callControlId"]
        assert ccid.startswith("sim-")
        st = s.get(f"{API}/calls/otp/{ccid}").json()
        assert st["state"] in ("calling", "playing") and st["preview"] is True and st["connectTo"] is None
        st = wait_state(s, ccid, "code", 20)
        assert st["state"] == "code" and len(st["code"]) == 4
        r = s.post(f"{API}/calls/otp/{ccid}", json={"action": "accept"})
        assert r.status_code == 200 and r.json()["state"] == "accepted"

    def test_trial_forbidden_for_number_owner(self, alice):
        assert alice.get(f"{API}/calls/trial").json()["available"] is False
        r = alice.post(f"{API}/calls/trial", json={"to": "+14155550111", "text": TEXT, "transferTo": "+14155550122"})
        assert r.status_code == 403


# --- OTP endpoints ---
class TestOtp:
    def test_otp_full_flow_business(self, alice):
        r = alice.post(f"{API}/calls/quick", json={"callerId": BUSINESS, "to": "+14155550133", "text": TEXT, "mode": "otp",
                                                   "otp": {"length": 6, "confirmMsg": "Thanks", "rejectMsg": "Wrong"}, "transferTo": "+14155550144"})
        assert r.status_code == 202, r.text
        ccid = r.json()["results"][0]["callControlId"]
        st = alice.get(f"{API}/calls/otp/{ccid}").json()
        for k in ("state", "to", "code", "attempt", "maxAttempts", "holdEndsAt", "connectTo", "preview"):
            assert k in st
        assert st["code"] is None and st["connectTo"] == "+14155550144" and st["maxAttempts"] == 3
        # not waiting yet → 409
        r = alice.post(f"{API}/calls/otp/{ccid}", json={"action": "accept"})
        assert r.status_code == 409 and r.json()["error"] == "not_waiting"
        r = alice.post(f"{API}/calls/otp/{ccid}", json={"action": "bogus"})
        assert r.status_code == 400 and r.json()["error"] == "invalid_action"
        st = wait_state(alice, ccid, "code", 20)
        assert st["state"] == "code" and len(st["code"]) == 6 and st["holdEndsAt"]
        first = st["code"]
        r = alice.post(f"{API}/calls/otp/{ccid}", json={"action": "decline"})
        assert r.status_code == 200 and r.json()["attempt"] == 2 and r.json()["state"] == "waiting_code"
        st = wait_state(alice, ccid, "code", 12)
        assert st["state"] == "code" and st["attempt"] == 2
        print("codes", first, st["code"])
        r = alice.post(f"{API}/calls/otp/{ccid}", json={"action": "accept"})
        assert r.json()["state"] == "accepted"
        r = alice.post(f"{API}/calls/otp/{ccid}", json={"action": "hangup"})
        assert r.status_code == 409
        # another account can't see it
        other = fresh()
        assert other.get(f"{API}/calls/otp/{ccid}").status_code == 404
        assert other.post(f"{API}/calls/otp/{ccid}", json={"action": "accept"}).status_code == 404

    def test_otp_hangup_and_three_declines(self, alice):
        r = alice.post(f"{API}/calls/quick", json={"callerId": PRO, "to": "+14155550155", "text": TEXT, "mode": "otp", "otp": {"length": 5}})
        assert r.status_code == 202, r.text
        ccid = r.json()["results"][0]["callControlId"]
        for i in range(3):
            st = wait_state(alice, ccid, "code", 20)
            assert st["state"] == "code", st
            r = alice.post(f"{API}/calls/otp/{ccid}", json={"action": "decline"})
        assert r.json()["state"] == "declined"
        r2 = alice.post(f"{API}/calls/quick", json={"callerId": PRO, "to": "+14155550156", "text": TEXT, "mode": "otp", "otp": {"length": 5}})
        c2 = r2.json()["results"][0]["callControlId"]
        wait_state(alice, c2, "code", 20)
        assert alice.post(f"{API}/calls/otp/{c2}", json={"action": "hangup"}).json()["state"] == "hung_up"

    def test_otp_invalid_length(self, alice):
        r = alice.post(f"{API}/calls/quick", json={"callerId": BUSINESS, "to": "+14155550133", "text": TEXT, "mode": "otp", "otp": {"length": 12}})
        assert r.status_code == 400 and r.json()["error"] == "invalid_otp_length"

    def test_unknown_ccid_404(self, alice):
        assert alice.get(f"{API}/calls/otp/sim-doesnotexist").status_code == 404


# --- Pro vs Business gating ---
class TestGating:
    def test_pro_schedule_accepted(self, alice):
        at = (datetime.now(timezone.utc) + timedelta(minutes=30)).isoformat()
        r = alice.post(f"{API}/calls/quick", json={"callerId": PRO, "to": "+14155550166", "text": TEXT, "transferTo": "+14155550177", "scheduleAt": at})
        assert r.status_code == 201, r.text
        assert r.json()["scheduled"] == 1
        sch = alice.get(f"{API}/calls/scheduled").json()["calls"]
        mine = [c for c in sch if c["to"] == "+14155550166" and c["status"] in ("preview", "pending")]
        assert mine
        for c in mine:
            alice.delete(f"{API}/calls/scheduled/{c['id']}")

    def test_pro_preset_accepted(self, alice):
        r = alice.post(f"{API}/calls/presets", json={"name": "TEST_pro_preset", "setup": {"callerId": PRO, "text": TEXT, "transferTo": "+14155550177"}})
        assert r.status_code == 201, r.text
        pid = r.json()["preset"]["id"]
        assert any(p["id"] == pid for p in alice.get(f"{API}/calls/presets").json()["presets"])
        assert alice.delete(f"{API}/calls/presets/{pid}").status_code == 200

    def test_redial_pro_403_business_ok(self, alice):
        r = alice.post(f"{API}/calls/quick", json={"callerId": PRO, "to": "+14155550188", "text": TEXT, "transferTo": "+14155550177"})
        assert r.status_code == 202, r.text
        rd = alice.post(f"{API}/calls/history/{r.json()['callId']}/redial")
        assert rd.status_code == 403 and rd.json()["error"] == "plan_upgrade_required"
        r = alice.post(f"{API}/calls/quick", json={"callerId": BUSINESS, "to": "+14155550188", "text": TEXT, "transferTo": "+14155550177"})
        rd = alice.post(f"{API}/calls/history/{r.json()['callId']}/redial")
        assert rd.status_code == 202, rd.text
