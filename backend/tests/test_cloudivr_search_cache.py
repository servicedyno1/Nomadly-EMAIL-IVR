# CloudIVR web: number search background cache (search-warm.js) + warm endpoint + unheld filtering
import os, time, pytest, requests

BASE = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/') or open('/app/frontend/.env').read().split('REACT_APP_BACKEND_URL=')[1].split()[0].rstrip('/')
API = f"{BASE}/api/cloudivr-web"


def login(email, pw):
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": email, "password": pw}, timeout=30)
    if r.status_code != 200:
        pytest.skip(f"login failed {r.status_code} {r.text[:200]}")
    return s


@pytest.fixture(scope="module")
def alice():
    return login("civr.alice@example.com", "AliceTest#2026")


@pytest.fixture(scope="module")
def held(alice):
    r = alice.get(f"{API}/numbers", timeout=30)
    assert r.status_code == 200
    return {n["phoneNumber"] for n in r.json()["numbers"]}


# Popular area codes should be pre-warmed -> fast
@pytest.mark.parametrize("ac", ["415", "212", "305", "713", "818"])
def test_popular_search_fast(alice, held, ac):
    t = time.time()
    r = alice.get(f"{API}/numbers/search", params={"country": "US", "type": "local", "areaCode": ac}, timeout=90)
    dt = time.time() - t
    print(f"areaCode {ac}: {dt:.2f}s, {len(r.json().get('numbers', []))} numbers")
    assert r.status_code == 200
    nums = r.json()["numbers"]
    assert len(nums) > 0
    assert all(n.get("provider") for n in nums)
    assert not ({n["phoneNumber"] for n in nums} & held)
    assert dt < 2.5, f"search {ac} took {dt:.2f}s"


# Warm endpoint returns 202 immediately; subsequent search fast
def test_warm_then_search(alice):
    t = time.time()
    r = alice.get(f"{API}/numbers/search/warm", params={"country": "US", "type": "local", "areaCode": "919"}, timeout=30)
    assert r.status_code == 202
    assert r.json().get("ok") is True
    assert time.time() - t < 1.5
    time.sleep(8)
    t = time.time()
    r = alice.get(f"{API}/numbers/search", params={"country": "US", "type": "local", "areaCode": "919"}, timeout=90)
    dt = time.time() - t
    print(f"919 after warm: {dt:.2f}s, {len(r.json().get('numbers', []))}")
    assert r.status_code == 200
    assert dt < 2.5


# Repeat search still consistent and quick
def test_repeat_search_cached(alice, held):
    for _ in range(2):
        t = time.time()
        r = alice.get(f"{API}/numbers/search", params={"country": "US", "type": "local", "areaCode": "415"}, timeout=90)
        assert r.status_code == 200
        assert time.time() - t < 2.5
        assert not ({n["phoneNumber"] for n in r.json()["numbers"]} & held)


def test_warm_unauth():
    r = requests.get(f"{API}/numbers/search/warm", params={"areaCode": "415"}, timeout=30)
    assert r.status_code in (401, 403)


def test_search_bad_country(alice):
    r = alice.get(f"{API}/numbers/search", params={"country": "ZZ"}, timeout=30)
    assert r.status_code == 400
