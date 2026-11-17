# CloudIVR web: one-bill renewal summary, per-extra auto-renew, delete extra, copy settings, prorated extras, concurrency
import os
import threading
from datetime import datetime, timezone
import requests
import pytest

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL').rstrip('/')
API = f"{BASE_URL}/api/cloudivr-web"
PARENT = "+13341112222"
PE = "%2B13341112222"
EMAIL, PASSWORD = "civr.uxtest@example.com", "UxTest#2026"
enc = lambda p: p.replace('+', '%2B')


@pytest.fixture(scope="module")
def s():
    ss = requests.Session()
    r = ss.post(f"{API}/auth/login", json={"email": EMAIL, "password": PASSWORD})
    if r.status_code != 200:
        pytest.skip(f"login failed {r.status_code}")
    return ss


def info(s):
    r = s.get(f"{API}/numbers/{PE}/extra")
    assert r.status_code == 200, r.text
    return r.json()


def search(s):
    r = s.get(f"{API}/numbers/search", params={"country": "US", "type": "local"})
    assert r.status_code == 200, r.text
    return [n for n in r.json()["numbers"] if not n.get("assigned")]


def balance(s):
    r = s.get(f"{API}/wallet")
    assert r.status_code == 200, r.text
    d = r.json()
    return d.get("balance", d.get("usd"))


# Renewal summary math
def test_renewal_summary_math(s):
    d = info(s)
    r = d["renewal"]
    print("used", d["used"], "renewal", {k: r[k] for k in ("date", "autoRenew", "main", "renewing", "total")})
    assert d["renewsOn"] and 0 < d["prorate"] <= 1
    on = [e for e in r["extras"] if e["autoRenew"]]
    exp = round(r["main"] + sum(e["price"] for e in on), 2)
    assert r["autoRenew"] is True
    assert abs(r["total"] - exp) < 0.01
    assert r["renewing"] == len(on)
    assert len(d["numbers"]) == d["used"]


# Auto-renew toggle on one extra changes the total
def test_toggle_extra_autorenew(s):
    d = info(s)
    x = next(n for n in d["numbers"] if n.get("autoRenew"))
    t0 = d["renewal"]["total"]
    r = s.post(f"{API}/numbers/{enc(x['phoneNumber'])}/auto-renew", json={"enabled": False})
    assert r.status_code == 200, r.text
    t1 = info(s)["renewal"]["total"]
    assert abs((t0 - t1) - x["renewalPrice"]) < 0.01, (t0, t1, x["renewalPrice"])
    r = s.post(f"{API}/numbers/{enc(x['phoneNumber'])}/auto-renew", json={"enabled": True})
    assert r.status_code == 200
    assert abs(info(s)["renewal"]["total"] - t0) < 0.01


# Delete extra-line validation
def test_delete_on_main_rejected(s):
    r = s.delete(f"{API}/numbers/{PE}/extra-line", json={"confirm": PARENT})
    assert r.status_code == 400 and r.json()["error"] == "not_extra"


def test_delete_needs_confirm(s):
    x = info(s)["numbers"][-1]["phoneNumber"]
    r = s.delete(f"{API}/numbers/{enc(x)}/extra-line", json={"confirm": "+1999"})
    assert r.status_code == 400 and r.json()["error"] == "confirm"
    r = s.delete(f"{API}/numbers/{enc(x)}/extra-line")
    assert r.status_code == 400


# Buy one prorated extra -> expiry aligned, charged prorated; then delete it -> released, slot frees
def test_buy_prorated_then_delete(s):
    d = info(s)
    hits = search(s)
    assert hits
    b0 = balance(s)
    r = s.post(f"{API}/numbers/{PE}/extra", json={"phoneNumbers": [hits[0]["phoneNumber"], hits[1]["phoneNumber"]]})
    assert r.status_code == 201, r.text
    added = r.json()["added"]
    assert len(added) == 2
    b1 = balance(s)
    price = d["price"]
    print("charged", round(b0 - b1, 2), "price", price, "prorate", d["prorate"])
    exp_total = round(2 * max(0.5, price * d["prorate"]), 2)
    assert abs((b0 - b1) - exp_total) < 0.05, (b0 - b1, exp_total)
    d2 = info(s)
    assert d2["used"] == d["used"] + 2
    for p in added:
        n = next(x for x in d2["numbers"] if x["phoneNumber"] == p)
        assert n["onPlanDate"] is True, n
    # delete both
    for p in added:
        r = s.delete(f"{API}/numbers/{enc(p)}/extra-line", json={"confirm": p})
        assert r.status_code == 200, r.text
        assert r.json()["deleted"] == p
    d3 = info(s)
    assert d3["used"] == d["used"]
    assert all(x["phoneNumber"] not in added for x in d3["numbers"])
    # deleting again must not succeed
    r = s.delete(f"{API}/numbers/{enc(added[0])}/extra-line", json={"confirm": added[0]})
    print("re-delete", r.status_code, r.text[:200])
    assert r.status_code in (400, 404, 409)
    # released number gone from list
    lst = s.get(f"{API}/numbers").json()
    nums = lst.get("numbers", lst) if isinstance(lst, dict) else lst
    for n in nums:
        if n["phoneNumber"] in added:
            assert n.get("status") == "released", n


# Copy settings
def test_copy_settings_validation(s):
    r = s.post(f"{API}/numbers/{PE}/copy-settings", json={"to": [], "parts": ["forwarding"]})
    assert r.status_code == 400 and r.json()["error"] == "pick_numbers"
    r = s.post(f"{API}/numbers/{PE}/copy-settings", json={"to": ["+13343334444"], "parts": []})
    assert r.status_code == 400 and r.json()["error"] == "pick_parts"


def test_copy_settings_applies(s):
    tgt = info(s)["numbers"][0]["phoneNumber"]
    r = s.post(f"{API}/numbers/{PE}/copy-settings", json={"to": [tgt], "parts": ["forwarding", "ivr", "voicemail"]})
    assert r.status_code == 200, r.text
    assert r.json()["to"] == [tgt]
    src = s.get(f"{API}/numbers/{PE}").json()
    dst = s.get(f"{API}/numbers/{enc(tgt)}").json()
    src = src.get("number", src)
    dst = dst.get("number", dst)
    print("src keys", list(src.keys())[:40])
    for k in ("forwarding", "callForwarding", "ivr", "voicemail"):
        if k in src or k in dst:
            print(k, "src:", str(src.get(k))[:120], "| dst:", str(dst.get(k))[:120])
            sv, dv = src.get(k), dst.get(k)
            if isinstance(sv, dict) and isinstance(dv, dict):
                sv = {a: b for a, b in sv.items() if a not in ("audioUrl",)}
                dv = {a: b for a, b in dv.items() if a not in ("audioUrl",)}
            assert sv == dv, k


# Concurrency: two simultaneous multi orders never exceed limit, one may be busy
def test_concurrent_multi(s):
    d = info(s)
    hits = search(s)
    assert len(hits) >= 4
    picks = [[hits[0]["phoneNumber"], hits[1]["phoneNumber"]], [hits[2]["phoneNumber"], hits[3]["phoneNumber"]]]
    res = [None, None]
    cookies = s.cookies.get_dict()

    def go(i):
        res[i] = requests.post(f"{API}/numbers/{PE}/extra", json={"phoneNumbers": picks[i]}, cookies=cookies)
    th = [threading.Thread(target=go, args=(i,)) for i in range(2)]
    [t.start() for t in th]
    [t.join() for t in th]
    codes = [r.status_code for r in res]
    print("codes", codes, [r.text[:160] for r in res])
    assert all(c in (201, 409, 400) for c in codes)
    added = sum((r.json().get("added", []) for r in res if r.status_code == 201), [])
    d2 = info(s)
    assert d2["used"] <= d2["limit"]
    assert d2["used"] == d["used"] + len(added)
    for p in added:
        r = s.delete(f"{API}/numbers/{enc(p)}/extra-line", json={"confirm": p})
        assert r.status_code == 200
