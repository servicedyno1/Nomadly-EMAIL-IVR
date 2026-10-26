# CloudIVR web: Telnyx delivery reports (message.finalized) -> text status, plain reason, give-back, inbox alert
import os, subprocess, time, json
import pytest, requests

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/') or open('/app/frontend/.env').read().split('REACT_APP_BACKEND_URL=')[1].split()[0].rstrip('/')
API = f"{BASE_URL}/api/cloudivr-web"
PHONE = '+13313039039'
A, B, C = '+19375550101', '+19375550102', '+19375550103'
TF = 'This toll-free number needs texting approval before its texts can reach mobile phones.'
STOP = 'This person has opted out of your texts (they replied STOP).'


def hook(mid, to, status, errors=None):
    body = {"data": {"event_type": "message.finalized", "payload": {"id": mid, "to": [{"phone_number": to, "status": status}], "errors": errors or []}}}
    return requests.post(f"{BASE_URL}/api/telnyx/sms-webhook", json=body, timeout=20)


@pytest.fixture(scope="module")
def s():
    ses = requests.Session()
    r = ses.post(f"{API}/auth/login", json={"email": "civr.alice@example.com", "password": "AliceTest#2026"}, timeout=20)
    if r.status_code != 200:
        pytest.skip(f"login failed {r.status_code}")
    return ses


def usage(s):
    n = [x for x in s.get(f"{API}/numbers", timeout=20).json()["numbers"] if x["phoneNumber"] == PHONE][0]
    return n.get("usage", {}).get("smsUsed")


@pytest.fixture(scope="module")
def replayed(s):
    # reseed: 3 texts back to 'sent', remove alerts / refund rows
    out = subprocess.run(["node", "/tmp/seed_sms_delivery_preview.js"], capture_output=True, text=True, timeout=60)
    assert out.returncode == 0, out.stderr
    seed = json.loads(out.stdout.strip().splitlines()[-1])
    bal0 = s.get(f"{API}/wallet", timeout=20).json()["balance"]
    sms0 = usage(s)
    codes = [hook('seed-ok', A, 'delivered').status_code,
             hook('seed-tf', B, 'delivery_failed', [{"code": "40329", "title": "Toll-free number not verified"}]).status_code,
             hook('seed-stop', C, 'delivery_failed', [{"code": "40300", "title": "Blocked as STOP"}]).status_code]
    time.sleep(5)
    return {"seed": seed, "bal0": bal0, "sms0": sms0, "codes": codes}


def test_webhook_accepted(replayed):
    assert replayed["codes"] == [200, 200, 200]


def test_logs_sms_status(s, replayed):
    logs = s.get(f"{API}/numbers/%2B13313039039/logs", timeout=20).json()["logs"]
    out = {l["to"]: l for l in logs if l["type"] == "sms_out" and l["to"] in (A, B, C)}
    assert out[A]["smsStatus"] == "delivered" and not out[A].get("smsReason")
    assert out[B]["smsStatus"] == "failed" and out[B]["smsReason"] == TF
    assert out[C]["smsStatus"] == "failed" and out[C]["smsReason"] == STOP
    missed = {l["from"]: l for l in logs if l["type"] == "missed" and l["from"] in (A, B)}
    assert missed[A]["reply"]["status"] == "delivered"
    assert missed[B]["reply"]["status"] == "failed" and missed[B]["reply"]["reason"] == TF
    for l in logs:
        assert "_id" not in l


def test_missed_calls_reply_status(s, replayed):
    calls = {c["from"]: c for c in s.get(f"{API}/missed-calls", timeout=20).json()["calls"] if c["from"] in (A, B)}
    assert calls[A]["reply"]["status"] == "delivered"
    assert calls[B]["reply"]["status"] == "failed" and calls[B]["reply"]["reason"] == TF
    assert calls[A]["canReply"] is False and calls[B]["canReply"] is False


def test_notifications_alerts(s, replayed):
    n = s.get(f"{API}/notifications", timeout=20).json()["notifications"]
    texts = [x["text"] for x in n]
    exp_b = f"Your text from {PHONE} to {B} wasn’t delivered. {TF} You weren’t charged for it."
    exp_c = f"Your text from {PHONE} to {C} wasn’t delivered. {STOP} You weren’t charged for it."
    assert texts.count(exp_b) == 1 and texts.count(exp_c) == 1
    for x in n:
        if x["text"] in (exp_b, exp_c):
            assert x["kind"] == "sms" and x["canReply"] is False and x["read"] is False
    # delivered text -> no alert
    assert not any(f"to {A} wasn’t delivered" in t for t in texts)
    item = [x for x in n if (x.get("meta") or {}).get("from") == C and (x["meta"].get("reply"))]
    assert item, "seeded inbox SMS item missing"
    assert item[0]["meta"]["reply"]["status"] == "failed" and item[0]["meta"]["reply"]["reason"] == STOP


def test_wallet_refund(s, replayed):
    w = s.get(f"{API}/wallet", timeout=20).json()
    refunds = [h for h in w["history"] if h["type"] == "sms-refund"]
    assert len(refunds) == 1
    assert refunds[0]["description"] == "Refund · text not delivered" and refunds[0]["amount"] == 0.05
    assert round(w["balance"] - replayed["bal0"], 2) == 0.05


def test_sms_used_given_back(s, replayed):
    if replayed["sms0"] is None:
        pytest.skip("usage.smsUsed not exposed")
    # 2 failed texts -> 2 plan texts given back (floor at 0)
    assert usage(s) == max(replayed["sms0"] - 2, 0)


def test_duplicate_reports_noop(s, replayed):
    bal = s.get(f"{API}/wallet", timeout=20).json()["balance"]
    sms = usage(s)
    hook('seed-tf', B, 'delivery_failed', [{"code": "40329"}])
    hook('seed-stop', C, 'delivery_failed', [{"code": "40300"}])
    hook('seed-ok', A, 'delivery_failed', [{"code": "40300"}])  # late contradicting report for delivered text
    time.sleep(5)
    w = s.get(f"{API}/wallet", timeout=20).json()
    assert w["balance"] == bal
    assert len([h for h in w["history"] if h["type"] == "sms-refund"]) == 1
    assert usage(s) == sms
    n = s.get(f"{API}/notifications", timeout=20).json()["notifications"]
    assert sum(1 for x in n if "wasn’t delivered" in x["text"]) == 2
    logs = s.get(f"{API}/numbers/%2B13313039039/logs", timeout=20).json()["logs"]
    a = [l for l in logs if l["type"] == "sms_out" and l["to"] == A][0]
    assert a["smsStatus"] == "delivered"


def test_unknown_message_id_ignored(replayed):
    assert hook('does-not-exist-xyz', A, 'delivery_failed', [{"code": "40300"}]).status_code == 200


def test_malformed_webhook_200():
    r = requests.post(f"{BASE_URL}/api/telnyx/sms-webhook", json={"data": {"event_type": "message.finalized"}}, timeout=20)
    assert r.status_code == 200
