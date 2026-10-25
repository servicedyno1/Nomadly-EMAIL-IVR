# Iteration 138: SMS webhook event filter, Telnyx sig pass-through (dry-run), PUT /webhooks keeps events, web inbox has no bot promos
import json
import os
import time
import uuid

import pytest
import requests

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL').rstrip('/')
API = f"{BASE_URL}/api/cloudivr-web"
NUM = "+16692098449"
NUM_ENC = "%2B16692098449"


@pytest.fixture(scope="module")
def alice():
    s = requests.Session()
    s.headers.update({"Origin": BASE_URL, "Content-Type": "application/json"})
    r = s.post(f"{API}/auth/login", json={"email": "civr.alice@example.com", "password": "AliceTest#2026"})
    if r.status_code != 200:
        pytest.skip(f"login failed {r.status_code} {r.text[:200]}")
    yield s
    # restore text triggers OFF
    s.put(f"{API}/numbers/{NUM_ENC}/text-triggers", json={"enabled": False, "myPhone": None, "rules": [{"action": "message", "message": "Thanks", "enabled": True, "oncePerHour": False}]})


def _sms(event_type, direction, text, mid):
    return {"data": {"event_type": event_type, "id": f"ev_{mid}", "payload": {
        "id": mid, "direction": direction, "from": {"phone_number": "+14155550111"},
        "to": [{"phone_number": NUM}], "text": text}}}


# SMS webhook: only message.received creates log/trigger run
class TestSmsWebhookFilter:
    def test_enable_text_triggers(self, alice):
        r = alice.put(f"{API}/numbers/{NUM_ENC}/text-triggers", json={"enabled": True, "myPhone": None, "rules": [{"action": "message", "message": "Thanks", "enabled": True, "oncePerHour": False}]})
        assert r.status_code == 200, r.text
        assert r.json()["textTriggers"]["enabled"] is True

    def test_finalized_outbound_ignored_received_counted(self, alice):
        before = alice.get(f"{API}/numbers/{NUM_ENC}/text-triggers").json()["runs"]
        tok_out = f"TEST_out_{uuid.uuid4().hex[:6]}"
        r = requests.post(f"{BASE_URL}/api/telnyx/sms-webhook", json=_sms("message.finalized", "outbound", f"please call me {tok_out}", f"m_{tok_out}"))
        assert r.status_code == 200
        time.sleep(3)
        logs = alice.get(f"{API}/numbers/{NUM_ENC}/logs").json()["logs"]
        assert tok_out not in json.dumps(logs), "finalized/outbound event created an SMS log"
        runs1 = alice.get(f"{API}/numbers/{NUM_ENC}/text-triggers").json()["runs"]
        assert len(runs1) == len(before) or json.dumps(runs1[:1]) == json.dumps(before[:1]), "finalized event created a trigger run"

        tok_in = f"TEST_in_{uuid.uuid4().hex[:6]}"
        r = requests.post(f"{BASE_URL}/api/telnyx/sms-webhook", json=_sms("message.received", "inbound", f"please call me {tok_in}", f"m_{tok_in}"))
        assert r.status_code == 200
        time.sleep(4)
        logs = alice.get(f"{API}/numbers/{NUM_ENC}/logs").json()["logs"]
        assert tok_in in json.dumps(logs), "inbound message.received not logged"
        runs2 = alice.get(f"{API}/numbers/{NUM_ENC}/text-triggers").json()["runs"]
        print("latest run:", runs2[:1])
        assert runs2 and json.dumps(runs2[:1]) != json.dumps(runs1[:1]), "no new trigger run for inbound text"
        assert runs2[0].get("status") == "preview"


# Telnyx signature middleware is pass-through in dry-run
class TestTelnyxSigPassThrough:
    @pytest.mark.parametrize("path", ["voice-webhook", "fax-webhook", "sms-webhook"])
    def test_unsigned_ok(self, path):
        r = requests.post(f"{BASE_URL}/api/telnyx/{path}", json={"data": {"event_type": "noop.test", "payload": {}}})
        assert r.status_code == 200


# PUT /webhooks without events keeps saved events
class TestWebhooksKeepEvents:
    def test_put_without_events(self, alice):
        cur = alice.get(f"{API}/webhooks")
        assert cur.status_code == 200
        orig = cur.json().get("webhook") or {}
        r = alice.put(f"{API}/webhooks", json={"enabled": True, "url": "https://example.com/hook", "events": ["call.ended", "voicemail.left"]})
        if r.status_code == 200:
            evs = r.json()["webhook"]["events"]
        else:
            pytest.skip(f"event name not accepted: {r.text[:200]}")
        r2 = alice.put(f"{API}/webhooks", json={"enabled": True, "url": "https://example.org/hook2"})
        assert r2.status_code == 200, r2.text
        assert r2.json()["webhook"]["events"] == evs
        assert alice.get(f"{API}/webhooks").json()["webhook"]["events"] == evs
        # restore
        alice.put(f"{API}/webhooks", json={"enabled": bool(orig.get("enabled")), "url": orig.get("url") or "", "events": orig.get("events") or evs})


# Web inbox must contain no bot promo rows
class TestInboxNoPromos:
    def test_no_promos(self, alice):
        r = alice.get(f"{API}/notifications?limit=200")
        assert r.status_code == 200
        items = r.json()["notifications"]
        bad = [n["text"][:80] for n in items if any(k in n["text"] for k in ("stoppromos", "Fill your dialer", "Leads $0.025"))]
        assert not bad, bad
        print("kinds:", sorted({n["kind"] for n in items}), "count", len(items))
