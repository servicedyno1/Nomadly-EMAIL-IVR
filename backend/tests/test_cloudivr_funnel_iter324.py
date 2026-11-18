# CloudIVR web onboarding funnel: no details before first buy, free trial typing fixes, MultiTEL-only search
import os
import time
import random
import pytest
import requests

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL').rstrip('/')
API = f"{BASE_URL}/api/cloudivr-web"
PW = "FunnelTest#2026"


def new_account():
    s = requests.Session()
    email = f"funnel.{int(time.time()*1000)}{random.randint(100,999)}@example.com"
    r = s.post(f"{API}/auth/register", json={"email": email, "password": PW, "acceptPolicy": True}, timeout=30)
    if r.status_code == 429:
        pytest.skip("register rate-limited")
    assert r.status_code == 201, r.text
    return s, r.json()["account"], email


@pytest.fixture(scope="module")
def acct():
    return new_account()


# Registration: no details prompt at signup
def test_register_no_profile_due(acct):
    s, a, email = acct
    assert a["email"] == email
    assert not a.get("profileDue")
    assert a.get("profileComplete") is False
    me = s.get(f"{API}/auth/me", timeout=20)
    if me.status_code == 200:
        acc = me.json().get("account", me.json())
        assert not acc.get("profileDue")


# Trial: custom caller ID still needs details
def test_trial_show_as_requires_profile(acct):
    s, _, _ = acct
    r = s.post(f"{API}/calls/trial", json={"to": "(415) 555-0123", "mode": "transfer", "transferTo": "", "text": "Hello, this is a test call.", "showAs": "+14155550177"}, timeout=30)
    assert r.status_code == 428, r.text
    assert r.json()["error"] == "profile_required"


# Trial: unfilled placeholders flagged
def test_trial_unfilled_placeholder(acct):
    s, _, _ = acct
    r = s.post(f"{API}/calls/trial", json={"to": "4155550123", "mode": "transfer", "transferTo": "", "text": "Hi [Name], your order is ready."}, timeout=30)
    assert r.status_code == 400, r.text
    assert r.json()["error"] == "unfilled_placeholders"
    assert "[Name]" in r.json()["message"]


# Trial: succeeds w/o profile, +1 auto, empty key-1 connects back
def test_trial_no_profile_dry_run(acct):
    s, _, _ = acct
    r = s.post(f"{API}/calls/trial", json={"to": "(415) 555-0123", "mode": "transfer", "transferTo": "", "text": "Hello, this is a quick test call from CloudIVR."}, timeout=40)
    assert r.status_code in (200, 201, 202), r.text
    d = r.json()
    print(d)
    assert d.get("dryRun") is True
    assert "+14155550123" in (d.get("targets") or d.get("call", {}).get("targets") or [d.get("to")]) or "+14155550123" in str(d)
    assert d.get("transferTo") == "+14155550123" or "transfer to +14155550123" in str(d.get("message", ""))


# Number search: MultiTEL only
def test_search_multitel_only(acct):
    s, _, _ = acct
    r = s.get(f"{API}/numbers/search", params={"country": "US", "type": "local", "areaCode": "212"}, timeout=60)
    assert r.status_code == 200, r.text
    d = r.json()
    nums = d.get("numbers") or d.get("results") or []
    print(f"found {len(nums)}: {[ (n.get('phoneNumber'), n.get('provider')) for n in nums][:5]}")
    assert len(nums) > 0
    for n in nums:
        assert n.get("provider") == "multitel", n


# Checkout: no 428 gate for plain US numbers before details
def test_checkout_not_gated(acct):
    s, _, _ = acct
    r = s.get(f"{API}/numbers/search", params={"country": "US", "type": "local", "areaCode": "212"}, timeout=60)
    nums = r.json().get("numbers") or r.json().get("results") or []
    if not nums:
        pytest.skip("no numbers")
    r = s.post(f"{API}/numbers/checkout", json={"phoneNumber": nums[0]["phoneNumber"], "plan": "pro", "method": "wallet", "autoRenew": True}, timeout=60)
    print(r.status_code, r.text[:300])
    assert r.status_code != 428, r.text
    assert r.status_code == 402 and r.json()["error"] == "insufficient_balance"
    me = s.get(f"{API}/auth/me", timeout=20).json()
    acc = me.get("account", me)
    assert not acc.get("profileDue"), "profileDue set after failed (402) checkout"


# Regression: demo account still works
def test_alice_login_numbers():
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": "civr.alice@example.com", "password": "AliceTest#2026"}, timeout=30)
    assert r.status_code == 200, r.text
    n = s.get(f"{API}/numbers", timeout=30)
    assert n.status_code == 200
