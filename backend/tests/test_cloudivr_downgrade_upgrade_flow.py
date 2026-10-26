# CloudIVR downgrade (Pro -> Starter) keeps settings, gates SIP + campaign start; upgrade restores (seeded copy +13313039077)
import os
import pytest
import requests

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL').rstrip('/')
API = f"{BASE_URL}/api/cloudivr-web"
PRO = "%2B13313039077"
IVR = {"enabled": True, "greeting": "TEST_ Welcome to test line", "options": {"1": {"action": "forward", "forwardTo": "+14155550111", "label": "Sales"}, "2": {"action": "message", "message": "TEST hours", "label": "Hours"}}}


@pytest.fixture(scope="module")
def s():
    sess = requests.Session()
    r = sess.post(f"{API}/auth/login", json={"email": "civr.alice@example.com", "password": "AliceTest#2026"})
    if r.status_code != 200:
        pytest.skip("login failed")
    return sess


def num(s):
    d = s.get(f"{API}/numbers/{PRO}").json()
    return d.get("number", d)


@pytest.fixture(scope="module")
def state():
    return {}


def test_01_setup_pro(s, state):
    n = num(s)
    if n["plan"] != "pro":
        pytest.skip(f"number is {n['plan']}, expected pro")
    r = s.put(f"{API}/numbers/{PRO}/ivr", json=IVR)
    assert r.status_code == 200, r.text
    r = s.patch(f"{API}/numbers/{PRO}/recording", json={"enabled": True})
    assert r.status_code == 200, r.text
    with open('/tmp/TEST_tone.mp3', 'rb') as f:
        r = s.post(f"{API}/audio/upload", files={"file": ("TEST_tone.mp3", f, "audio/mpeg")}, data={"name": "TEST_tone"})
    assert r.status_code == 201, r.text
    aid = r.json()["audio"]["id"]
    state["audio"] = aid
    r = s.post(f"{API}/campaigns", json={"callerId": "+13313039077", "audioId": aid, "mode": "report_only", "leads": "+14155550122,TEST lead"})
    assert r.status_code == 201, r.text
    state["campaign"] = r.json()["campaign"]["id"]
    n = num(s)
    assert n["features"]["ivr"]["enabled"] is True and n["features"]["recording"] is True


def test_02_downgrade_preview(s):
    r = s.post(f"{API}/numbers/{PRO}/downgrade", json={"plan": "starter"})
    assert r.status_code == 200, r.text
    p = r.json()["preview"]
    assert p["sipSignOut"] is True and p["settingsKept"] is True
    assert any("SIP" in x for x in p["lost"]), p["lost"]
    assert not any("rowser phone" in x for x in p["lost"]), p["lost"]


def test_03_downgrade_confirm(s):
    r = s.post(f"{API}/numbers/{PRO}/downgrade", json={"plan": "starter", "confirm": True})
    assert r.status_code == 200, r.text
    n = num(s)
    assert n["plan"] == "starter"
    assert n["features"]["ivr"]["enabled"] is False
    assert "1" in n["features"]["ivr"]["options"] and "2" in n["features"]["ivr"]["options"]
    assert n["features"]["recording"] is False
    assert n["access"]["sipCredentials"] is False and n["access"]["browserPhone"] is True
    assert s.get(f"{API}/numbers/{PRO}/sip").status_code == 403
    assert s.get(f"{API}/numbers/{PRO}/sip?browser=1").status_code == 200


def test_04_saved_campaign_start_blocked(s, state):
    if "campaign" not in state:
        pytest.skip("no campaign")
    r = s.post(f"{API}/campaigns/{state['campaign']}/start")
    assert r.status_code == 403, r.text
    assert r.json()["error"] == "plan_upgrade_required"
    r = s.post(f"{API}/campaigns/{state['campaign']}/cancel")
    assert r.status_code in (200, 400), r.text


def test_05_upgrade_back(s):
    r = s.post(f"{API}/numbers/{PRO}/upgrade", json={"plan": "pro"})
    assert r.status_code == 200, r.text
    r = s.post(f"{API}/numbers/{PRO}/upgrade", json={"plan": "pro", "confirm": True})
    assert r.status_code == 200, r.text
    n = num(s)
    assert n["plan"] == "pro"
    assert n["features"]["ivr"]["enabled"] is True
    assert n["features"]["recording"] is True
    assert n.get("sipDisabled") in (False, None)
    assert s.get(f"{API}/numbers/{PRO}/sip").status_code == 200


def test_99_cleanup(s, state):
    s.put(f"{API}/numbers/{PRO}/ivr", json={"enabled": False, "options": {}})
    s.patch(f"{API}/numbers/{PRO}/recording", json={"enabled": False})
    if state.get("audio"):
        s.delete(f"{API}/audio/{state['audio']}")
