# Iter281: profile gate (428 profile_required), lookup bulk (numbers/emails), caller-ids filter, provider health related APIs
import os
import pytest
import requests

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL').rstrip('/')
API = f"{BASE_URL}/api/cloudivr-web"
QA = ("civr.uxtest@example.com", "UxTest#2026")
ALICE = ("civr.alice@example.com", "AliceTest#2026")


def login(creds):
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": creds[0], "password": creds[1]}, timeout=30)
    if r.status_code != 200:
        pytest.skip(f"login failed {creds[0]}: {r.status_code} {r.text[:200]}")
    tok = (r.json() or {}).get("token")
    if tok:
        s.headers["Authorization"] = f"Bearer {tok}"
    return s


@pytest.fixture(scope="module")
def qa():
    return login(QA)


@pytest.fixture(scope="module")
def alice():
    return login(ALICE)


# --- Profile gate ---
class TestProfileGate:
    def test_qa_has_no_profile(self, qa):
        r = qa.get(f"{API}/profile/legal")
        assert r.status_code == 200
        assert r.json()["complete"] is False

    @pytest.mark.parametrize("path", [
        "/calls/quick", "/calls/trial", "/calls/callback", "/calls/history/xyz/redial",
        "/campaigns", "/campaigns/xyz/start", "/campaigns/xyz/followup", "/relay/calls", "/ai-agents/xyz/test",
    ])
    def test_gated_posts_return_428(self, qa, path):
        r = qa.post(f"{API}{path}", json={})
        assert r.status_code == 428, f"{path}: {r.status_code} {r.text[:200]}"
        assert r.json()["error"] == "profile_required"

    @pytest.mark.parametrize("path", ["/campaigns", "/calls/history", "/lookup", "/numbers", "/wallet"])
    def test_gets_still_work(self, qa, path):
        r = qa.get(f"{API}{path}")
        assert r.status_code != 428, f"{path}: {r.status_code}"
        assert r.status_code < 500, f"{path}: {r.status_code} {r.text[:200]}"

    def test_account_with_details_not_gated(self):
        import uuid
        s = requests.Session()
        email = f"test_iter281_{uuid.uuid4().hex[:8]}@example.com"
        r = s.post(f"{API}/auth/register", json={"email": email, "password": "QaTest#2026x", "name": "TEST_ iter281", "acceptPolicy": True})
        if r.status_code not in (200, 201):
            pytest.skip(f"register failed {r.status_code} {r.text[:200]}")
        tok = (r.json() or {}).get("token")
        if tok:
            s.headers["Authorization"] = f"Bearer {tok}"
        print("registered", email)
        assert s.post(f"{API}/calls/quick", json={}).status_code == 428
        p = s.put(f"{API}/profile/legal", json={"type": "individual", "fullName": "TEST User", "address": {"line1": "1 Main St", "city": "Austin", "postalCode": "78701", "countryCode": "US"}})
        assert p.status_code == 200, p.text[:200]
        assert s.get(f"{API}/profile/legal").json()["complete"] is True
        for path in ("/calls/quick", "/campaigns", "/relay/calls"):
            r = s.post(f"{API}{path}", json={})
            assert r.status_code != 428, f"{path} still gated: {r.text[:200]}"


# --- Caller IDs (iter280 fix) ---
class TestCallerIds:
    def test_no_attested_or_review(self, alice, qa):
        for s in (alice, qa):
            r = s.get(f"{API}/caller-ids")
            assert r.status_code == 200
            txt = r.text.lower()
            items = r.json() if isinstance(r.json(), list) else (r.json().get("callerIds") or r.json().get("items") or [])
            for c in items:
                assert c.get("method") != "review", c
                assert c.get("status") != "attested", c


# --- Lookup ---
class TestLookup:
    def test_lookup_get(self, qa):
        r = qa.get(f"{API}/lookup")
        assert r.status_code == 200
        d = r.json()
        assert d["price"] == 0.015
        assert d["emailPrice"] == 0.0015
        assert d["maxBulk"] == 1000
        assert isinstance(d["history"], list) and isinstance(d["emailHistory"], list)

    def test_bulk_numbers_too_many(self, qa):
        nums = [f"+1415555{i:04d}" for i in range(1001)]
        r = qa.post(f"{API}/lookup/bulk", json={"numbers": nums})
        assert r.status_code == 400
        assert r.json()["error"] == "too_many"

    def test_bulk_emails_too_many(self, qa):
        r = qa.post(f"{API}/lookup/email/bulk", json={"emails": [f"u{i}@example.com" for i in range(1001)]})
        assert r.status_code == 400
        assert r.json()["error"] == "too_many"

    def test_bulk_nothing(self, qa):
        r = qa.post(f"{API}/lookup/bulk", json={"numbers": ["abc", "12"]})
        assert r.status_code == 400
        assert r.json()["error"] == "nothing_to_check"

    def test_single_invalid_email(self, qa):
        r = qa.post(f"{API}/lookup/email", json={"email": "nope"})
        assert r.status_code == 400 and r.json()["error"] == "invalid_email"

    def test_bulk_numbers_real(self, qa):
        before = qa.get(f"{API}/wallet").json()
        r = qa.post(f"{API}/lookup/bulk", json={"numbers": ["+14155552671", "+442079460958", "notanumber"]}, timeout=90)
        assert r.status_code == 200, r.text[:300]
        d = r.json()
        print("bulk numbers:", d)
        assert d["skipped"] == 1
        assert len(d["results"]) == 2
        okn = [x for x in d["results"] if not x.get("failed")]
        assert abs(d["charged"] - round(len(okn) * 0.015, 4)) < 1e-6
        assert abs(d["refunded"] - round((2 - len(okn)) * 0.015, 4)) < 1e-6
        after = qa.get(f"{API}/wallet").json()
        print("wallet before/after", before, after)
        hist = qa.get(f"{API}/lookup").json()["history"]
        if okn:
            assert any(h.get("batchId") == d["batchId"] for h in hist)

    def test_bulk_emails_real(self, qa):
        r = qa.post(f"{API}/lookup/email/bulk", json={"emails": ["support@google.com", "x@", "Support@Google.com", "nobody12345zz@example.com"]}, timeout=90)
        assert r.status_code == 200, r.text[:300]
        d = r.json()
        print("bulk emails:", d)
        assert len(d["results"]) == 2  # dedupe lowercase
        assert d["skipped"] == 2
        hist = qa.get(f"{API}/lookup").json()["emailHistory"]
        if any(not x.get("failed") for x in d["results"]):
            assert any(h.get("batchId") == d["batchId"] for h in hist)

    def test_single_email_real(self, qa):
        r = qa.post(f"{API}/lookup/email", json={"email": "support@google.com"}, timeout=60)
        print("single email:", r.status_code, r.text[:300])
        assert r.status_code in (200, 503)
        if r.status_code == 200:
            d = r.json()
            assert d["email"] == "support@google.com" and d["price"] == 0.0015 and "result" in d
