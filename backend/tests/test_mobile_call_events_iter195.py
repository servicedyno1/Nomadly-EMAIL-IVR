# Iter195: calls made from a USA mobile number appear in its Messages thread with duration + cost
import os
import pytest
import requests

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL').rstrip('/')
API = f"{BASE_URL}/api/cloudivr-web"


def login(email, pw):
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": email, "password": pw})
    if r.status_code != 200:
        pytest.skip(f"login failed {r.status_code}")
    tok = (r.json() or {}).get("token")
    if tok:
        s.headers["Authorization"] = f"Bearer {tok}"
    return s


@pytest.fixture(scope="module")
def alice():
    return login("civr.alice@example.com", "AliceTest#2026")


@pytest.fixture(scope="module")
def bob():
    return login("civr.bob@example.com", "BobTest#2026")


THREAD = {"number": "+15554586272", "contact": "+14155550142"}


# Thread returns the seeded outgoing call shot_5 with duration 154 and charge 0.48
def test_thread_has_outgoing_call_with_charge(alice):
    r = alice.get(f"{API}/messages/thread", params=THREAD)
    assert r.status_code == 200, r.text
    d = r.json()
    calls = [e for e in d["events"] if "body" not in e and e.get("out")]
    match = [e for e in calls if e.get("duration") == 154]
    assert match, f"no 154s outgoing call: {calls}"
    assert abs(match[0].get("charge", 0) - 0.48) < 1e-9
    assert "_id" not in match[0]


# Calls without charge don't carry a charge key; SMS events always keep charge
def test_event_shape(alice):
    d = alice.get(f"{API}/messages/thread", params=THREAD).json()
    for e in d["events"]:
        if "body" in e:
            assert "charge" in e
        elif "charge" in e:
            assert e["charge"] > 0


# Bob cannot read Alice's mobile thread; no auth -> 401
def test_thread_access_control(bob):
    r = bob.get(f"{API}/messages/thread", params=THREAD)
    assert r.status_code in (403, 404), r.status_code
    r2 = requests.get(f"{API}/messages/thread", params=THREAD)
    assert r2.status_code == 401
