# CloudIVR web iter142: OTP inbox link (/app/quick-call), pubOtp strips chatId/at, Starter caller refused, decline→new try item.
# Dry-run preview only (sim- callControlIds). Uses Alice.
import os, time
import pytest, requests

BASE = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')
API = f"{BASE}/api/cloudivr-web"
ALICE = ("civr.alice@example.com", "AliceTest#2026")
BUSINESS, PRO, STARTER = "+13313039039", "+13313039077", "+13313039088"


@pytest.fixture(scope="module")
def alice():
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": ALICE[0], "password": ALICE[1]})
    if r.status_code != 200:
        pytest.skip(f"alice login failed {r.status_code}")
    return s


def place_otp(s, caller=BUSINESS, to="+14155550123"):
    return s.post(f"{API}/calls/quick", json={"callerId": caller, "targets": to, "mode": "otp", "otp": {"length": 6}, "text": "Hello, enter your code."})


def wait_state(s, ccid, want, timeout=25):
    end, last = time.time() + timeout, None
    while time.time() < end:
        last = s.get(f"{API}/calls/otp/{ccid}").json()
        if last.get("state") == want:
            return last
        time.sleep(1)
    return last


@pytest.fixture(scope="module")
def otp_call(alice):
    r = place_otp(alice)
    assert r.status_code in (200, 201, 202), r.text
    d = r.json()
    res = d.get("results") or []
    ccid = res[0].get("callControlId") if res else None
    assert ccid and ccid.startswith("sim-"), d
    st = wait_state(alice, ccid, "code")
    assert st["state"] == "code", st
    return ccid


class TestStarterRefused:
    def test_starter_otp_403(self, alice):
        r = place_otp(alice, STARTER)
        assert r.status_code == 403
        assert "plan_upgrade_required" in r.text

    def test_starter_plain_403(self, alice):
        r = alice.post(f"{API}/calls/quick", json={"callerId": STARTER, "targets": "+14155550123", "mode": "plain", "text": "hi"})
        assert r.status_code == 403


class TestPubOtp:
    def test_get_no_chatid_at(self, alice, otp_call):
        d = alice.get(f"{API}/calls/otp/{otp_call}").json()
        assert "chatId" not in d and "at" not in d
        assert d["code"] and len(d["code"]) == 6 and d["attempt"] == 1

    def test_inbox_otp_link(self, alice, otp_call):
        items = alice.get(f"{API}/notifications").json()["notifications"]
        otp = [n for n in items if (n.get("meta") or {}).get("otp", {}).get("callControlId") == otp_call]
        assert otp, "no inbox item for OTP call"
        assert otp[0]["link"] == "/app/quick-call"

    def test_decline_then_new_item(self, alice, otp_call):
        r = alice.post(f"{API}/calls/otp/{otp_call}", json={"action": "decline"})
        assert r.status_code == 200, r.text
        d = r.json()
        assert "chatId" not in d and "at" not in d
        st = wait_state(alice, otp_call, "code")
        assert st["attempt"] == 2
        items = alice.get(f"{API}/notifications").json()["notifications"]
        n = [i for i in items if (i.get("meta") or {}).get("otp", {}).get("callControlId") == otp_call]
        assert len(n) >= 2, f"expected new item for try 2, got {len(n)}"

    def test_accept(self, alice, otp_call):
        r = alice.post(f"{API}/calls/otp/{otp_call}", json={"action": "accept"})
        assert r.status_code == 200
        d = r.json()
        assert d["state"] == "accepted" and "chatId" not in d and "at" not in d

    def test_invalid_action_and_not_waiting(self, alice, otp_call):
        assert alice.post(f"{API}/calls/otp/{otp_call}", json={"action": "x"}).status_code == 400
        assert alice.post(f"{API}/calls/otp/{otp_call}", json={"action": "decline"}).status_code == 409

    def test_unknown_404(self, alice):
        assert alice.get(f"{API}/calls/otp/sim-doesnotexist").status_code == 404
