# CloudIVR iteration 144: Hours toggle (never-saved defaults), off-hours forward to backup numbers (PUT/GET /hours), switch API
import os, urllib.parse
import pytest, requests

BASE = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')
if not BASE:
    for line in open('/app/frontend/.env'):
        if line.startswith('REACT_APP_BACKEND_URL='):
            BASE = line.split('=', 1)[1].strip().rstrip('/')
API = f"{BASE}/api/cloudivr-web"
ALICE = ("civr.alice@example.com", "AliceTest#2026")
BUS, PRO, PRO2 = "+13313039039", "+13313039077", "+13313039088"
q = lambda p: urllib.parse.quote(p, safe='')
DAYS = {d: {"on": d in ("mon", "tue", "wed", "thu", "fri"), "start": "09:00", "end": "17:00"} for d in ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]}


@pytest.fixture(scope="module")
def alice():
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": ALICE[0], "password": ALICE[1]})
    if r.status_code != 200:
        pytest.skip(f"login failed {r.status_code}")
    return s


@pytest.fixture(scope="module")
def original(alice):
    # snapshot BUS hours to restore afterwards
    h = alice.get(f"{API}/numbers/{q(BUS)}/hours").json()["hours"]
    yield h
    body = {**h, "enabled": False}
    if body.get("offAction") == "forward" and not body.get("offForward"):
        body["offAction"] = "voicemail"
    alice.put(f"{API}/numbers/{q(BUS)}/hours", json=body)


def put(alice, phone, **kw):
    body = {"enabled": False, "timezone": "America/New_York", "days": DAYS, "offAction": "voicemail", "offMessage": ""}
    body.update(kw)
    return alice.put(f"{API}/numbers/{q(phone)}/hours", json=body)


class TestHoursForward:
    def test_get_hours_shape(self, alice, original):
        r = alice.get(f"{API}/numbers/{q(BUS)}/hours")
        assert r.status_code == 200
        d = r.json()
        assert "hours" in d and "openNow" in d and "days" in d["hours"]

    def test_forward_string_normalized(self, alice, original):
        r = put(alice, BUS, offAction="forward", offForward="+14155550101, 4155550102")
        assert r.status_code == 200, r.text
        assert r.json()["hours"]["offForward"] == ["+14155550101", "+14155550102"]
        g = alice.get(f"{API}/numbers/{q(BUS)}/hours").json()["hours"]
        assert g["offAction"] == "forward" and g["offForward"] == ["+14155550101", "+14155550102"]

    def test_forward_array_dedupe_excludes_self(self, alice, original):
        r = put(alice, BUS, offAction="forward", offForward=["+14155550101", "4155550101", BUS, "+14155550103"])
        assert r.status_code == 200, r.text
        assert r.json()["hours"]["offForward"] == ["+14155550101", "+14155550103"]

    def test_forward_six_rejected(self, alice, original):
        r = put(alice, BUS, offAction="forward", offForward=",".join(f"+1415555011{i}" for i in range(6)))
        assert r.status_code == 400
        assert r.json()["error"] == "invalid_backup" and "up to 5" in r.json()["message"]

    def test_forward_five_ok(self, alice, original):
        r = put(alice, BUS, offAction="forward", offForward=",".join(f"+1415555011{i}" for i in range(5)))
        assert r.status_code == 200 and len(r.json()["hours"]["offForward"]) == 5

    def test_forward_empty_rejected(self, alice, original):
        r = put(alice, BUS, offAction="forward", offForward="")
        assert r.status_code == 400 and r.json()["error"] == "no_backup"
        assert r.json()["message"] == "Add at least one backup number to forward to."

    def test_forward_only_self_rejected(self, alice, original):
        r = put(alice, BUS, offAction="forward", offForward=BUS)
        assert r.status_code == 400 and r.json()["error"] == "no_backup"

    def test_forward_junk_rejected(self, alice, original):
        r = put(alice, BUS, offAction="forward", offForward="abc")
        assert r.status_code == 400 and r.json()["error"] == "invalid_backup"
        assert 'Backup "abc" is not a phone number' in r.json()["message"]

    def test_message_action_still_saves(self, alice, original):
        r = put(alice, BUS, offAction="message", offMessage="TEST_closed")
        assert r.status_code == 200
        g = alice.get(f"{API}/numbers/{q(BUS)}/hours").json()["hours"]
        assert g["offAction"] == "message" and g["offMessage"] == "TEST_closed" and g["offForward"] == []

    def test_voicemail_action_still_saves(self, alice, original):
        r = put(alice, BUS, offAction="voicemail")
        assert r.status_code == 200 and alice.get(f"{API}/numbers/{q(BUS)}/hours").json()["hours"]["offAction"] == "voicemail"

    def test_enable_disable_via_put(self, alice, original):
        r = put(alice, BUS, enabled=True)
        assert r.status_code == 200 and r.json()["hours"]["enabled"] is True and isinstance(r.json()["openNow"], bool)
        r = put(alice, BUS, enabled=False)
        assert r.status_code == 200 and r.json()["hours"]["enabled"] is False


class TestHoursSwitch:
    def test_switch_hours_on_off(self, alice):
        r = alice.patch(f"{API}/numbers/{q(PRO2)}/switch", json={"feature": "hours", "enabled": True})
        assert r.status_code == 200, r.text
        assert r.json()["enabled"] is True
        g = alice.get(f"{API}/numbers/{q(PRO2)}/hours").json()["hours"]
        assert g["enabled"] is True and any(g["days"][d]["on"] for d in g["days"])
        r = alice.patch(f"{API}/numbers/{q(PRO2)}/switch", json={"feature": "hours", "enabled": False})
        assert r.status_code == 200 and r.json()["enabled"] is False
        assert alice.get(f"{API}/numbers/{q(PRO2)}/hours").json()["hours"]["enabled"] is False

    def test_switch_all_days_off_rejected(self, alice):
        before = alice.get(f"{API}/numbers/{q(PRO2)}/hours").json()["hours"]
        off = {d: {**v, "on": False} for d, v in DAYS.items()}
        r = put(alice, PRO2, days=off)
        if r.status_code == 200:
            s = alice.patch(f"{API}/numbers/{q(PRO2)}/switch", json={"feature": "hours", "enabled": True})
            assert s.status_code == 400 and s.json()["error"] == "not_configured"
        body = {**before, "enabled": False}
        if body.get("offAction") == "forward" and not body.get("offForward"):
            body["offAction"] = "voicemail"
        alice.put(f"{API}/numbers/{q(PRO2)}/hours", json=body)

    def test_unauth(self):
        r = requests.get(f"{API}/numbers/{q(BUS)}/hours")
        assert r.status_code == 401
