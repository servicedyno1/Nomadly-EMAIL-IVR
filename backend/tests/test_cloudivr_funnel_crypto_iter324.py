# CloudIVR web: crypto invoice creation (not a purchase) should not raise the post-buy details prompt
from test_cloudivr_funnel_iter324 import new_account, API


def test_crypto_checkout_profile_due():
    s, _, _ = new_account()
    nums = s.get(f"{API}/numbers/search", params={"country": "US", "type": "local", "areaCode": "212"}, timeout=60).json().get("numbers") or []
    assert nums
    coins = None
    r = s.post(f"{API}/numbers/checkout", json={"phoneNumber": nums[0]["phoneNumber"], "plan": "pro", "method": "crypto", "coin": "x"}, timeout=60)
    if r.status_code == 400 and r.json().get("error") == "invalid_coin":
        coins = r.json()["message"].split(": ", 1)[1].rstrip(".").split(", ")
    r = s.post(f"{API}/numbers/checkout", json={"phoneNumber": nums[0]["phoneNumber"], "plan": "pro", "method": "crypto", "coin": coins[0]}, timeout=60)
    print(r.status_code, r.text[:200])
    assert r.status_code == 201
    me = s.get(f"{API}/auth/me", timeout=20).json()
    acc = me.get("account", me)
    print("profileDue after crypto invoice:", acc.get("profileDue"))
    assert not acc.get("profileDue"), "profileDue set by an unpaid crypto invoice"
