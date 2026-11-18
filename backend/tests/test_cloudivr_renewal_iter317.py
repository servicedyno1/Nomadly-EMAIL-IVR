# iter 317: renewal calendar API, live-copy regression, single-extra concurrency
import os, threading, time
import requests, pytest

BASE = os.environ.get('REACT_APP_BACKEND_URL').rstrip('/')
API = f"{BASE}/api/cloudivr-web"
PARENT = "+13341112222"
PE = "%2B13341112222"
EMAIL, PASSWORD = "civr.uxtest@example.com", "UxTest#2026"
enc = lambda p: p.replace('+', '%2B')


@pytest.fixture(scope="module")
def s():
    ss = requests.Session()
    r = ss.post(f"{API}/auth/login", json={"email": EMAIL, "password": PASSWORD})
    if r.status_code != 200:
        pytest.skip(f"login failed {r.status_code}: {r.text[:200]}")
    return ss


def info(s):
    r = s.get(f"{API}/numbers/{PE}/extra"); assert r.status_code == 200; return r.json()


def search_free(s, n=4):
    r = s.get(f"{API}/numbers/search", params={"country": "US", "type": "local"})
    assert r.status_code == 200
    return [h for h in r.json()["numbers"] if not h.get("assigned")][:n]


def balance(s):
    r = s.get(f"{API}/wallet"); d = r.json()
    return d.get("balance", d.get("usd"))


# --- Renewal calendar API ---
def test_calendar_requires_auth():
    r = requests.get(f"{API}/renewals/calendar")
    assert r.status_code == 401


def test_calendar_shape(s):
    r = s.get(f"{API}/renewals/calendar")
    assert r.status_code == 200, r.text
    d = r.json()
    for k in ("balance", "entries", "months", "due7", "due30", "shortBy30", "firstShort"):
        assert k in d, f"missing {k}"
    assert isinstance(d["entries"], list)
    # sorted by date ascending
    dates = [e["date"] for e in d["entries"]]
    assert dates == sorted(dates), "entries must be sorted by date"
    # due30 equals sum of charges within 30 days
    from datetime import datetime, timezone, timedelta
    now = datetime.now(timezone.utc)
    cutoff = now + timedelta(days=30)
    chg30 = sum(e["amount"] for e in d["entries"]
                if e["type"] == "charge" and datetime.fromisoformat(e["date"].replace("Z","+00:00")) <= cutoff)
    assert abs(round(chg30, 2) - d["due30"]) < 0.02, (chg30, d["due30"])
    # shortBy30 math
    assert abs(d["shortBy30"] - max(0, round(d["due30"] - d["balance"], 2))) < 0.02
    # each charge has covered + walletAfter
    for e in d["entries"]:
        if e["type"] == "charge":
            assert "covered" in e and "walletAfter" in e
    # later months projected
    if d["entries"]:
        # projected flag should appear in later-month entries
        projected = [e for e in d["entries"] if e.get("projected")]
        print("projected count", len(projected), "total charges", sum(1 for e in d["entries"] if e["type"]=="charge"))


def test_calendar_plan_one_bill(s):
    """Plan entry for +13341112222 sums parts to amount."""
    d = s.get(f"{API}/renewals/calendar").json()
    plan_entries = [e for e in d["entries"] if e["kind"] == "plan" and e.get("phone") == PARENT and e["type"] == "charge"]
    assert plan_entries, "expected plan charge for parent number"
    first = plan_entries[0]
    assert "parts" in first and isinstance(first["parts"], list) and first["parts"], "plan charge has parts"
    s_parts = round(sum(p["amount"] for p in first["parts"]), 2)
    assert abs(s_parts - first["amount"]) < 0.02, (s_parts, first["amount"], first["parts"])
    # Extras on their own date = separate 'Extra number — days up to the plan date' charges
    extra_days = [e for e in d["entries"] if e["kind"] == "extra" and e["type"] == "charge" and "days up to" in e["title"]]
    print("extras-on-own-date count", len(extra_days))
    for e in extra_days:
        assert e["amount"] >= 0


# --- Live-copy regression (critical iter_316 bug) ---
def test_live_copy_delete_after_rebuy(s):
    """Buy an extra, delete it, buy it again, then DELETE must release the live entry."""
    d0 = info(s)
    hits = search_free(s, 1)
    if not hits:
        pytest.skip("no free numbers in search")
    x = hits[0]["phoneNumber"]
    bal0 = balance(s)
    if bal0 < 25:
        pytest.skip(f"wallet too low: {bal0}")

    # buy
    r = s.post(f"{API}/numbers/{PE}/extra", json={"phoneNumber": x})
    assert r.status_code == 201, r.text
    # delete
    r = s.delete(f"{API}/numbers/{enc(x)}/extra-line", json={"confirm": x})
    assert r.status_code == 200, r.text
    # re-search (pickFromSearch requirement) then re-buy
    hits2 = search_free(s, 20)
    y = next((h["phoneNumber"] for h in hits2 if h["phoneNumber"] == x), None)
    if not y:
        # buy any to still exercise the rebuy path with same number if search doesn't return it
        if bal0 < 50: pytest.skip("cannot rebuy same number, not enough balance")
        y = hits2[0]["phoneNumber"]
    r = s.post(f"{API}/numbers/{PE}/extra", json={"phoneNumber": y})
    assert r.status_code == 201, r.text

    d1 = info(s)
    assert y in [n["phoneNumber"] for n in d1["numbers"]]
    used1 = d1["used"]

    # (a) toggle auto-renew on y, verify it reflected on the ACTIVE entry via GET
    r = s.post(f"{API}/numbers/{enc(y)}/auto-renew", json={"enabled": False})
    assert r.status_code == 200, r.text
    d2 = info(s)
    ny = next(n for n in d2["numbers"] if n["phoneNumber"] == y)
    assert ny.get("autoRenew") is False, f"auto-renew not reflected on active entry: {ny}"

    # (b) delete y again, used must drop by 1, and y must disappear from extras list
    r = s.delete(f"{API}/numbers/{enc(y)}/extra-line", json={"confirm": y})
    assert r.status_code == 200, r.text
    d3 = info(s)
    assert y not in [n["phoneNumber"] for n in d3["numbers"]], "deleted extra still in list"
    assert d3["used"] == used1 - 1, f"used should drop by 1: {used1} -> {d3['used']}"


def test_cleanup_leftover_17076220116(s):
    """Leftover from iter_316 should be deletable now."""
    d = info(s)
    nums = [n["phoneNumber"] for n in d["numbers"]]
    leftover = "+17076220116"
    if leftover not in nums:
        pytest.skip("leftover already cleaned up")
    r = s.delete(f"{API}/numbers/{enc(leftover)}/extra-line", json={"confirm": leftover})
    assert r.status_code == 200, r.text
    d2 = info(s)
    assert leftover not in [n["phoneNumber"] for n in d2["numbers"]]


# --- Single-pick concurrency (plan lock on single buy) ---
def test_concurrent_single_buys(s):
    d0 = info(s)
    hits = search_free(s, 4)
    if len(hits) < 2:
        pytest.skip("not enough free numbers")
    bal = balance(s)
    if bal < 50:
        pytest.skip(f"wallet too low for 2 single buys: {bal}")
    picks = [hits[0]["phoneNumber"], hits[1]["phoneNumber"]]
    res = [None, None]
    cookies = s.cookies.get_dict()

    def go(i):
        res[i] = requests.post(f"{API}/numbers/{PE}/extra", json={"phoneNumber": picks[i]}, cookies=cookies)

    th = [threading.Thread(target=go, args=(i,)) for i in range(2)]
    [t.start() for t in th]
    [t.join() for t in th]
    codes = [r.status_code for r in res]
    print("single codes", codes)
    # Never 500
    assert all(c != 500 for c in codes), codes
    d1 = info(s)
    # used must never exceed limit
    assert d1["used"] <= d1["limit"]
    added = []
    for r, p in zip(res, picks):
        if r.status_code == 201:
            added.append(p)
    # cleanup
    for p in added:
        s.delete(f"{API}/numbers/{enc(p)}/extra-line", json={"confirm": p})
