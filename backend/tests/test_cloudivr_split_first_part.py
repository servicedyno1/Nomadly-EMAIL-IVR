# CloudIVR web Bulk IVR lists over 500: splitMode first / part / auto / ask, drop waiting parts, low-wallet messages
import os, time
import pytest, requests
from pymongo import MongoClient
from dotenv import load_dotenv

load_dotenv('/app/backend/.env')
BASE_URL = os.environ.get('REACT_APP_BACKEND_URL').rstrip('/')
API = f"{BASE_URL}/api/cloudivr-web"
U = ("civr.uxtest@example.com", "UxTest#2026")
CALLER, AUDIO = "+13341112222", "aud-split-test"
db = MongoClient(os.environ['MONGO_URL'])[os.environ['DB_NAME']]
CREATED = []


def nums(n, base=200):
    return "\n".join(f"+1212{base + i // 10000:03d}{i % 10000:04d}" for i in range(n))


@pytest.fixture(scope="module")
def s():
    x = requests.Session()
    r = x.post(f"{API}/auth/login", json={"email": U[0], "password": U[1], "remember": True}, timeout=30)
    if r.status_code != 200:
        pytest.skip(f"login failed {r.status_code} {r.text}")
    yield x
    # cleanup only our campaigns (by id / splitId)
    for cid in CREATED:
        doc = db.bulkCallCampaigns.find_one({"id": cid}, {"splitId": 1})
        if doc and doc.get("splitId"):
            db.bulkCallCampaigns.delete_many({"splitId": doc["splitId"], "chatId": "5000000000000077"})
        db.bulkCallCampaigns.delete_one({"id": cid, "chatId": "5000000000000077"})


def make(s, n, mode=None, **extra):
    body = {"name": f"TEST_split_{mode}_{n}", "callerId": CALLER, "audioId": AUDIO, "leads": nums(n), "mode": "report_only", **extra}
    if mode:
        body["splitMode"] = mode
    r = s.post(f"{API}/campaigns", json=body, timeout=60)
    if r.status_code == 201:
        CREATED.append(r.json()["campaign"]["id"])
    return r


def series(split_id):
    return list(db.bulkCallCampaigns.find({"splitId": split_id}, {"_id": 0, "id": 1, "part": 1, "status": 1, "leads.number": 1, "payPerPart": 1, "autoNext": 1}).sort("part", 1))


# --- first: only first 500, rest dropped ---
def test_first_mode_700(s):
    r = make(s, 700, "first")
    assert r.status_code == 201, r.text
    c = r.json()["campaign"]
    assert c["splitId"] is None and c["trimmedFrom"] == 700 and c["payPerPart"] is False
    doc = db.bulkCallCampaigns.find_one({"id": c["id"]})
    assert len(doc["leads"]) == 500
    assert [l["number"] for l in doc["leads"]] == nums(500).split("\n")
    assert doc.get("dryRun") is True
    d = s.get(f"{API}/campaigns/{c['id']}").json()["campaign"]
    assert d["trimmedFrom"] == 700
    assert any(x["id"] == c["id"] and x["trimmedFrom"] == 700 for x in s.get(f"{API}/campaigns").json()["campaigns"])


def test_first_mode_repeat_allowed(s):
    r = make(s, 600, "first", repeat="daily")
    assert r.status_code == 201, r.text
    assert r.json()["campaign"]["repeat"] == "daily"


@pytest.mark.parametrize("mode", ["auto", "ask", "part"])
def test_split_repeat_rejected(s, mode):
    r = make(s, 600, mode, repeat="daily")
    assert r.status_code == 400 and r.json()["error"] == "split_no_repeat", r.text


# --- part: pay per part ---
def test_part_mode_700(s):
    r = make(s, 700, "part")
    assert r.status_code == 201, r.text
    c = r.json()["campaign"]
    assert c["payPerPart"] is True and c["autoNext"] is False and c["part"] == 1 and c["parts"] == 2 and c["splitTotal"] == 700
    parts = series(c["splitId"])
    assert [len(p["leads"]) for p in parts] == [500, 200]
    assert parts[1]["status"] == "series_waiting" and parts[1]["payPerPart"] is True
    assert parts[1]["leads"][0]["number"] == nums(501).split("\n")[500]


def test_part_flow_ready_start_and_drop(s):
    r = make(s, 1240, "part")
    assert r.status_code == 201, r.text
    c = r.json()["campaign"]
    parts = series(c["splitId"])
    assert [len(p["leads"]) for p in parts] == [500, 500, 240]
    p1, p2, p3 = (p["id"] for p in parts)
    # start part 1 (dry-run sim)
    st = s.post(f"{API}/campaigns/{p1}/start")
    assert st.status_code == 202, st.text
    time.sleep(2)
    # fast-forward our own test part 1: mark all leads done so sim completes on next step
    db.bulkCallCampaigns.update_one({"id": p1}, {"$set": {"leads.$[].status": "completed"}})
    for _ in range(15):
        time.sleep(1)
        if db.bulkCallCampaigns.find_one({"id": p2})["status"] == "series_ready":
            break
    assert db.bulkCallCampaigns.find_one({"id": p1})["status"] == "completed"
    assert db.bulkCallCampaigns.find_one({"id": p2})["status"] == "series_ready"
    assert db.bulkCallCampaigns.find_one({"id": p3})["status"] == "series_waiting"
    # drop part 2 → part 2 and 3 cancelled
    d = s.post(f"{API}/campaigns/{p2}/cancel")
    assert d.status_code == 200 and d.json()["ok"] is True, d.text
    assert d.json()["campaign"]["status"] == "cancelled"
    assert db.bulkCallCampaigns.find_one({"id": p3})["status"] == "cancelled"
    # cancelling again → clear error
    again = s.post(f"{API}/campaigns/{p2}/cancel")
    assert again.status_code == 400, again.text
    print("cancel-again:", again.text)
    fin = s.post(f"{API}/campaigns/{p1}/cancel")
    assert fin.status_code == 400, fin.text
    print("cancel-finished:", fin.text)


def test_drop_waiting_part_directly(s):
    r = make(s, 700, "part")
    c = r.json()["campaign"]
    p2 = series(c["splitId"])[1]["id"]
    d = s.post(f"{API}/campaigns/{p2}/cancel")
    assert d.status_code == 200 and d.json()["campaign"]["status"] == "cancelled"
    assert db.bulkCallCampaigns.find_one({"id": c["id"]})["status"] == "created"  # part 1 untouched


def test_ready_start_dry_run(s):
    r = make(s, 700, "ask")
    c = r.json()["campaign"]
    p2 = series(c["splitId"])[1]["id"]
    db.bulkCallCampaigns.update_one({"id": c["id"]}, {"$set": {"status": "completed"}})
    db.bulkCallCampaigns.update_one({"id": p2}, {"$set": {"status": "series_ready"}})
    st = s.post(f"{API}/campaigns/{p2}/start")
    assert st.status_code == 202, st.text
    time.sleep(2)
    assert db.bulkCallCampaigns.find_one({"id": p2})["status"] in ("running", "completed")
    s.post(f"{API}/campaigns/{p2}/cancel")


def test_cancel_part1_cascades(s):
    r = make(s, 700, "part")
    c = r.json()["campaign"]
    p2 = series(c["splitId"])[1]["id"]
    d = s.post(f"{API}/campaigns/{c['id']}/cancel")
    assert d.status_code == 200, d.text
    time.sleep(1)
    assert db.bulkCallCampaigns.find_one({"id": p2})["status"] == "cancelled"


def test_start_waiting_part_rejected(s):
    r = make(s, 700, "part")
    c = r.json()["campaign"]
    p2 = series(c["splitId"])[1]["id"]
    st = s.post(f"{API}/campaigns/{p2}/start")
    print("start waiting:", st.status_code, st.text)
    assert st.status_code == 400
    assert db.bulkCallCampaigns.find_one({"id": p2})["status"] == "series_waiting"


# --- unchanged behaviors ---
def test_small_list_normal(s):
    r = make(s, 500, "first")
    assert r.status_code == 201
    c = r.json()["campaign"]
    assert c["splitId"] is None and c["trimmedFrom"] is None


def test_auto_and_ask_create(s):
    for m in ("auto", "ask"):
        r = make(s, 700, m)
        assert r.status_code == 201, r.text
        c = r.json()["campaign"]
        assert c["payPerPart"] is False and c["autoNext"] is (m == "auto")


def test_over_5000_choices(s):
    r = make(s, 5001, "first")
    assert r.status_code == 201 and r.json()["campaign"]["trimmedFrom"] == 5001
    r = make(s, 5001, "auto")
    assert r.status_code == 400 and "series_too_big" in r.text
    r = make(s, 6000, "part")
    assert r.status_code == 201, r.text
    c = r.json()["campaign"]
    assert c["parts"] == 10 and c["seriesDropped"] == 1000 and c["payPerPart"]
    db.bulkCallCampaigns.delete_many({"splitId": c["splitId"]})


def test_over_50000_rejected(s):
    r = make(s, 50001, "first")
    assert r.status_code == 400 and "too_many_leads" in r.text


# --- low wallet ---
@pytest.fixture
def low_wallet():
    db.walletOf.update_one({"_id": "5000000000000077"}, {"$set": {"usdIn": 100}})
    yield
    db.walletOf.update_one({"_id": "5000000000000077"}, {"$set": {"usdIn": 1000}})


def test_low_wallet_messages(s, low_wallet):
    # ~$0.15/number: 500 → ~$75 OK with $100 ; 2 parts (1000) → ~$150 not OK
    out = {}
    for m in ("auto", "ask", "part", "first"):
        out[m] = make(s, 1000, m)
        print(m, out[m].status_code, out[m].text[:300])
    assert out["auto"].status_code == 402 and "all 2 parts" in out["auto"].text
    assert out["ask"].status_code == 402
    assert out["part"].status_code == 201
    assert out["first"].status_code == 201


@pytest.fixture
def tiny_wallet():
    db.walletOf.update_one({"_id": "5000000000000077"}, {"$set": {"usdIn": 10}})
    yield
    db.walletOf.update_one({"_id": "5000000000000077"}, {"$set": {"usdIn": 1000}})


def test_tiny_wallet_messages(s, tiny_wallet):
    p = make(s, 700, "part")
    f = make(s, 700, "first")
    print("part", p.text, "\nfirst", f.text)
    assert p.status_code == 402 and "part 1" in p.text and "all" not in p.text.lower().split("wallet must cover")[1][:5]
    assert f.status_code == 402 and "first 500" in f.text
    assert "$10.00" in p.text and "$10.00" in f.text
