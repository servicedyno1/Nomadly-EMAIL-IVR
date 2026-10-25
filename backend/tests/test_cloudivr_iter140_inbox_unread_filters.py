# Iteration 140: Inbox unread counts per kind (GET /notifications) + per-filter mark-read (POST /notifications/read)
import os
from datetime import datetime, timezone

import pytest
import requests
from pymongo import MongoClient

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL').rstrip('/')
API = f"{BASE_URL}/api/cloudivr-web"
MONGO_URL = os.environ.get('MONGO_URL')
DB_NAME = os.environ.get('DB_NAME')
TAG = "TEST_iter140_"


def _login(email, pw):
    s = requests.Session()
    s.headers.update({"Origin": BASE_URL, "Content-Type": "application/json"})
    r = s.post(f"{API}/auth/login", json={"email": email, "password": pw})
    if r.status_code != 200:
        pytest.skip(f"login failed {email} {r.status_code}")
    return s, r.json()["account"]["id"]


@pytest.fixture(scope="module")
def col():
    c = MongoClient(MONGO_URL)[DB_NAME]["webNotifications"]
    yield c


@pytest.fixture(scope="module")
def ctx(col):
    alice, aid = _login("civr.alice@example.com", "AliceTest#2026")
    bob, bid = _login("civr.bob@example.com", "BobTest#2026")
    # snapshot pre-existing unread rows so we can restore them
    a_unread = [d["_id"] for d in col.find({"chatId": aid, "read": False, "text": {"$not": {"$regex": f"^{TAG}"}}}, {"_id": 1})]
    b_unread = [d["_id"] for d in col.find({"chatId": bid, "read": False, "text": {"$not": {"$regex": f"^{TAG}"}}}, {"_id": 1})]
    now = datetime.now(timezone.utc)
    rows = []
    for k, n in [("sms", 3), ("voicemail", 2), ("wallet", 1), ("info", 1)]:
        for i in range(n):
            rows.append({"chatId": aid, "text": f"{TAG}{k}_{i}", "kind": k, "mediaUrl": None, "meta": None, "read": False, "createdAt": now})
    rows += [{"chatId": bid, "text": f"{TAG}bob_sms_{i}", "kind": "sms", "mediaUrl": None, "meta": None, "read": False, "createdAt": now} for i in range(2)]
    col.insert_many(rows)
    yield {"alice": alice, "aid": aid, "bob": bob, "bid": bid}
    col.delete_many({"text": {"$regex": f"^{TAG}"}})
    if a_unread:
        col.update_many({"_id": {"$in": a_unread}}, {"$set": {"read": False}})
    if b_unread:
        col.update_many({"_id": {"$in": b_unread}}, {"$set": {"read": False}})


def _get(s, kind=None):
    r = s.get(f"{API}/notifications", params={"limit": 100, **({"kind": kind} if kind else {})})
    assert r.status_code == 200, r.text
    return r.json()


class TestInboxCounts:
    def test_counts_shape_and_sum(self, ctx):
        d = _get(ctx["alice"])
        assert isinstance(d["unread"], int) and isinstance(d["unreadByKind"], dict)
        assert sum(d["unreadByKind"].values()) == d["unread"]
        assert d["unreadByKind"].get("voicemail", 0) >= 2 and d["unreadByKind"].get("sms", 0) >= 3

    def test_kind_filter_lists_only_kind_counts_all(self, ctx):
        full = _get(ctx["alice"])
        d = _get(ctx["alice"], "sms")
        assert d["notifications"] and all(n["kind"] == "sms" for n in d["notifications"])
        assert d["unread"] == full["unread"] and d["unreadByKind"] == full["unreadByKind"]

    def test_requires_login(self):
        r = requests.get(f"{API}/notifications", headers={"Origin": BASE_URL})
        assert r.status_code == 401, r.text
        r2 = requests.post(f"{API}/notifications/read", json={"kind": "sms"}, headers={"Origin": BASE_URL})
        assert r2.status_code == 401, r2.text
        print(r.text, r2.text)

    @pytest.mark.parametrize("bad", ["BAD KIND", 123, "a" * 30, "SMS", ["sms"], {"x": 1}])
    def test_bad_kind(self, ctx, bad):
        r = ctx["alice"].post(f"{API}/notifications/read", json={"kind": bad})
        assert r.status_code == 400, r.text
        assert r.json().get("error") == "bad_kind"


class TestMarkRead:
    def test_mark_sms_only(self, ctx, col):
        before = _get(ctx["alice"])
        bob_before = _get(ctx["bob"])
        r = ctx["alice"].post(f"{API}/notifications/read", json={"kind": "sms"})
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["marked"] == before["unreadByKind"].get("sms", 0)
        assert "sms" not in d["unreadByKind"]
        exp = {k: v for k, v in before["unreadByKind"].items() if k != "sms"}
        assert d["unreadByKind"] == exp
        assert d["unread"] == before["unread"] - before["unreadByKind"]["sms"]
        # persisted
        g = _get(ctx["alice"])
        assert g["unreadByKind"] == exp
        assert col.count_documents({"chatId": ctx["aid"], "kind": "voicemail", "read": False}) >= 2
        # Bob untouched
        assert _get(ctx["bob"])["unreadByKind"] == bob_before["unreadByKind"]
        assert col.count_documents({"chatId": ctx["bid"], "text": {"$regex": f"^{TAG}bob"}, "read": False}) == 2

    def test_mark_kind_with_zero_unread(self, ctx):
        r = ctx["alice"].post(f"{API}/notifications/read", json={"kind": "sms"})
        assert r.status_code == 200 and r.json()["marked"] == 0

    def test_mark_all_empty_body(self, ctx):
        bob_before = _get(ctx["bob"])
        r = ctx["alice"].post(f"{API}/notifications/read", json={})
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["unread"] == 0 and d["unreadByKind"] == {}
        assert _get(ctx["alice"])["unread"] == 0
        assert _get(ctx["bob"])["unreadByKind"] == bob_before["unreadByKind"]

    def test_mark_all_no_body(self, ctx, col):
        col.insert_one({"chatId": ctx["aid"], "text": f"{TAG}nobody", "kind": "wallet", "read": False, "createdAt": datetime.now(timezone.utc)})
        r = requests.post(f"{API}/notifications/read", cookies=ctx["alice"].cookies, headers={"Origin": BASE_URL})
        assert r.status_code == 200, r.text
        assert r.json()["unread"] == 0

    def test_null_kind_marks_all(self, ctx, col):
        col.insert_one({"chatId": ctx["aid"], "text": f"{TAG}nullk", "kind": "call", "read": False, "createdAt": datetime.now(timezone.utc)})
        r = ctx["alice"].post(f"{API}/notifications/read", json={"kind": None})
        assert r.status_code == 200, r.text
        assert r.json()["unread"] == 0
