# CloudIVR web: daily coupon, calendar booking (unconfigured), agent booking settings, call recordings, isolation
import os
import time
import pytest
import requests

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL')
if not BASE_URL:
    with open('/app/frontend/.env') as f:
        for line in f:
            if line.startswith('REACT_APP_BACKEND_URL='):
                BASE_URL = line.split('=', 1)[1].strip()
BASE_URL = BASE_URL.rstrip('/')
API = f"{BASE_URL}/api/cloudivr-web"
ALICE = {"email": "civr.alice@example.com", "password": "AliceTest#2026"}
BOB = {"email": "civr.bob@example.com", "password": "BobTest#2026"}
AVA = "6155bd1b-e392-4566-83a8-2a229bf3a34e"


def login(creds):
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json=creds, timeout=20)
    if r.status_code != 200:
        pytest.skip(f"login failed {creds['email']}: {r.status_code}")
    return s


@pytest.fixture(scope="module")
def alice():
    return login(ALICE)


@pytest.fixture(scope="module")
def bob():
    return login(BOB)


@pytest.fixture(scope="module")
def ava_original(alice):
    a = alice.get(f"{API}/ai-agents/{AVA}").json()["agent"]
    yield a
    # restore booking + record ON
    alice.put(f"{API}/ai-agents/{AVA}", json={**a, "record": True})


@pytest.fixture(scope="module")
def alice_call(alice):
    calls = alice.get(f"{API}/ai-calls").json()["calls"]
    rec = [c for c in calls if c.get("recordingUrl")]
    if not rec:
        pytest.skip("no recorded call")
    return rec[0]


# Coupon
class TestCoupon:
    def test_today(self, alice):
        r = alice.get(f"{API}/coupons/today")
        assert r.status_code == 200
        c = r.json()["coupon"]
        assert c["code"] == "NMD108XZJUA"
        assert c["discount"] == 10
        assert c["used"] is False
        assert c["expiresAt"].endswith("T23:59:59.000Z")


# Calendar (keys not configured)
class TestCalendar:
    def test_status(self, alice):
        r = alice.get(f"{API}/calendar")
        assert r.status_code == 200
        d = r.json()
        assert d["configured"] is False and d["connected"] is False

    def test_connect_503(self, alice):
        r = alice.post(f"{API}/calendar/google/connect", json={})
        assert r.status_code == 503
        assert r.json()["error"] == "calendar_unavailable"

    def test_slots_400(self, alice):
        r = alice.get(f"{API}/ai-agents/{AVA}/slots", params={"date": "2026-11-02"})
        assert r.status_code == 400
        assert r.json()["error"] == "calendar_not_connected"

    def test_callback_bogus_redirect(self):
        r = requests.get(f"{API}/calendar/google/callback", params={"state": "bogus", "code": "x"}, allow_redirects=False)
        assert r.status_code == 302
        assert r.headers["location"].endswith("/cloudivr/app/ai-agents?calendar=expired")

    def test_calendars_list_not_connected(self, alice):
        r = alice.get(f"{API}/calendar/calendars")
        assert r.status_code == 400

    def test_bob_calendar_own(self, bob):
        r = bob.get(f"{API}/calendar")
        assert r.status_code == 200
        assert r.json()["connected"] is False


# Agent booking settings + recording flag
class TestAgentBooking:
    def test_list_rates(self, alice):
        d = alice.get(f"{API}/ai-agents").json()
        assert d["recordRate"] == 0.02 and d["recordingDays"] == 90 and d["rate"] == 0.2
        assert d["agents"] and all(a.get("record") is True for a in d["agents"])

    def test_enable_booking_rejected(self, alice, ava_original):
        r = alice.put(f"{API}/ai-agents/{AVA}", json={**ava_original, "booking": {**ava_original["booking"], "enabled": True}})
        assert r.status_code == 400
        assert r.json()["error"] == "calendar_not_connected"
        a = alice.get(f"{API}/ai-agents/{AVA}").json()["agent"]
        assert a["booking"]["enabled"] is False
        assert a["updatedAt"] == ava_original["updatedAt"]

    def test_custom_booking_saved(self, alice, ava_original):
        b = {"enabled": False, "calendarId": "primary", "slotMinutes": 45, "days": [1, 3, 5], "start": "10:00", "end": "15:30", "timeZone": "Europe/Paris"}
        r = alice.put(f"{API}/ai-agents/{AVA}", json={**ava_original, "booking": b})
        assert r.status_code == 200, r.text
        g = alice.get(f"{API}/ai-agents/{AVA}").json()["agent"]["booking"]
        for k in ("slotMinutes", "days", "start", "end", "timeZone"):
            assert g[k] == b[k], (k, g)
        assert g["enabled"] is False

    def test_invalid_tz_and_slot_fallback(self, alice, ava_original):
        b = {"enabled": False, "slotMinutes": 7, "days": [1, 2], "start": "09:00", "end": "17:00", "timeZone": "Mars/Olympus"}
        r = alice.put(f"{API}/ai-agents/{AVA}", json={**ava_original, "booking": b})
        assert r.status_code == 200, r.text
        g = alice.get(f"{API}/ai-agents/{AVA}").json()["agent"]["booking"]
        assert g["timeZone"] == "America/New_York"
        assert g["slotMinutes"] == 30

    def test_record_toggle_persist(self, alice, ava_original):
        r = alice.put(f"{API}/ai-agents/{AVA}", json={**ava_original, "record": False})
        assert r.status_code == 200
        assert alice.get(f"{API}/ai-agents/{AVA}").json()["agent"]["record"] is False
        r = alice.put(f"{API}/ai-agents/{AVA}", json={**ava_original, "record": True})
        assert alice.get(f"{API}/ai-agents/{AVA}").json()["agent"]["record"] is True

    def test_restore_booking(self, alice, ava_original):
        r = alice.put(f"{API}/ai-agents/{AVA}", json={**ava_original, "record": True})
        assert r.status_code == 200
        g = alice.get(f"{API}/ai-agents/{AVA}").json()["agent"]
        assert g["booking"]["slotMinutes"] == ava_original["booking"]["slotMinutes"]
        assert g["record"] is True


# Recordings
class TestRecording:
    def test_recording_fields(self, alice_call):
        assert "/api/assets/user-audio/5000000000000001_" in alice_call["recordingUrl"]
        assert alice_call["recordingUrl"].endswith(".mp3")
        assert alice_call["recordingExpiresAt"].startswith("2027-01-22")

    def test_recording_file_served(self, alice_call):
        r = requests.get(alice_call["recordingUrl"], timeout=30)
        assert r.status_code == 200
        assert "audio/mpeg" in r.headers.get("content-type", "")
        assert len(r.content) > 1000

    def test_call_detail_transcript(self, alice, alice_call):
        r = alice.get(f"{API}/ai-calls/{alice_call['id']}")
        assert r.status_code == 200
        c = r.json()["call"]
        tr = c.get("transcript") or []
        assert tr, "transcript empty"
        first_agent = next((t for t in tr if t.get("role") in ("agent", "assistant")), tr[0])
        assert "this call may be recorded" in str(first_agent.get("text", "")).lower()


# Isolation
class TestIsolation:
    def test_bob_cannot_see_alice_call(self, bob, alice_call):
        assert bob.get(f"{API}/ai-calls/{alice_call['id']}").status_code == 404

    def test_bob_cannot_see_ava(self, bob):
        assert bob.get(f"{API}/ai-agents/{AVA}").status_code == 404
        assert bob.put(f"{API}/ai-agents/{AVA}", json={"record": False}).status_code == 404
        assert bob.get(f"{API}/ai-agents/{AVA}/slots", params={"date": "2026-11-02"}).status_code == 404

    def test_unauth(self):
        assert requests.get(f"{API}/calendar").status_code == 401
