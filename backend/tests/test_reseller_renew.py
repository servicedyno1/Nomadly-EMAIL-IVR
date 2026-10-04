"""Tests for reseller API manual renew endpoints (hosting, vps, rdp).
Served by Node bot at http://127.0.0.1:5000/reseller/v1. Sandbox returns dry_run."""
import pytest
import requests

BASE_URL = "http://127.0.0.1:5000/reseller/v1"
APIDOC_URL = "http://127.0.0.1:5000/apidoc"
API_KEY = "rsk_live_566a19727b74061600ef1d0b671132070b47892ab7b1d900"
HEADERS = {"Authorization": f"Bearer {API_KEY}", "Content-Type": "application/json"}


def _assert_dry_run(data, product, action="renew"):
    assert data.get("mode") == "dry_run", f"expected dry_run, got {data}"
    assert data.get("product") == product
    assert data.get("action") == action
    assert "price_usd" in data
    assert data.get("sufficient_balance") is True
    assert "would_provision" in data


# -------- Hosting renew --------
class TestHostingRenew:
    def test_default_periods_golden(self):
        r = requests.post(f"{BASE_URL}/hosting/apifix01/renew", headers=HEADERS, json={})
        assert r.status_code == 200, r.text
        d = r.json()
        _assert_dry_run(d, "hosting")
        assert d["price_usd"] == 100
        wp = d["would_provision"]
        assert wp.get("username") == "apifix01"
        assert "domain" in wp and "plan" in wp and "periods" in wp

    def test_periods_3_golden(self):
        r = requests.post(f"{BASE_URL}/hosting/apifix01/renew", headers=HEADERS, json={"periods": 3})
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["price_usd"] == 300
        assert d["would_provision"]["periods"] == 3

    def test_periods_clamp_zero_to_one(self):
        r = requests.post(f"{BASE_URL}/hosting/apifix01/renew", headers=HEADERS, json={"periods": 0})
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["would_provision"]["periods"] == 1
        assert d["price_usd"] == 100

    def test_periods_clamp_99_to_12(self):
        r = requests.post(f"{BASE_URL}/hosting/apifix01/renew", headers=HEADERS, json={"periods": 99})
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["would_provision"]["periods"] == 12
        assert d["price_usd"] == 1200

    def test_unknown_user_404(self):
        r = requests.post(f"{BASE_URL}/hosting/doesnotexist_zzz/renew", headers=HEADERS, json={})
        assert r.status_code == 404, r.text

    def test_premium_plan_price(self):
        r = requests.post(f"{BASE_URL}/hosting/apifix02/renew", headers=HEADERS, json={})
        assert r.status_code == 200, r.text
        d = r.json()
        # Premium plan should NOT be Golden's 100
        assert d["price_usd"] != 100
        assert d["price_usd"] > 0

    def test_requires_auth(self):
        r = requests.post(f"{BASE_URL}/hosting/apifix01/renew", json={})
        assert r.status_code == 401


# -------- VPS renew --------
class TestVpsRenew:
    def test_default_months_1(self):
        r = requests.post(f"{BASE_URL}/vps/vps-test-1/renew", headers=HEADERS, json={})
        assert r.status_code == 200, r.text
        d = r.json()
        _assert_dry_run(d, "vps")
        assert d["price_usd"] == 18

    def test_months_2(self):
        r = requests.post(f"{BASE_URL}/vps/vps-test-1/renew", headers=HEADERS, json={"months": 2})
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["price_usd"] == 36

    def test_months_clamp_zero(self):
        r = requests.post(f"{BASE_URL}/vps/vps-test-1/renew", headers=HEADERS, json={"months": 0})
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["price_usd"] == 18

    def test_months_clamp_99(self):
        r = requests.post(f"{BASE_URL}/vps/vps-test-1/renew", headers=HEADERS, json={"months": 99})
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["price_usd"] == 18 * 12

    def test_unknown_id_404(self):
        r = requests.post(f"{BASE_URL}/vps/vps-doesnotexist/renew", headers=HEADERS, json={})
        assert r.status_code == 404

    def test_requires_auth(self):
        r = requests.post(f"{BASE_URL}/vps/vps-test-1/renew", json={})
        assert r.status_code == 401


# -------- RDP renew --------
class TestRdpRenew:
    def test_months_1(self):
        r = requests.post(f"{BASE_URL}/rdp/rdp-test-1/renew", headers=HEADERS, json={"months": 1})
        assert r.status_code == 200, r.text
        d = r.json()
        _assert_dry_run(d, "rdp")
        assert d["price_usd"] == 56

    def test_months_2_bundle_discount(self):
        r = requests.post(f"{BASE_URL}/rdp/rdp-test-1/renew", headers=HEADERS, json={"months": 2})
        assert r.status_code == 200, r.text
        d = r.json()
        # ~100.8 bundle
        assert 95 <= d["price_usd"] <= 105

    def test_months_3_bundle(self):
        r = requests.post(f"{BASE_URL}/rdp/rdp-test-1/renew", headers=HEADERS, json={"months": 3})
        assert r.status_code == 200, r.text
        d = r.json()
        assert 135 <= d["price_usd"] <= 150

    def test_months_clamp_rdp_to_3(self):
        r = requests.post(f"{BASE_URL}/rdp/rdp-test-1/renew", headers=HEADERS, json={"months": 99})
        assert r.status_code == 200, r.text
        d = r.json()
        # Should clamp at 3 months
        r3 = requests.post(f"{BASE_URL}/rdp/rdp-test-1/renew", headers=HEADERS, json={"months": 3})
        assert d["price_usd"] == r3.json()["price_usd"]

    def test_unknown_id_404(self):
        r = requests.post(f"{BASE_URL}/rdp/rdp-doesnotexist/renew", headers=HEADERS, json={})
        assert r.status_code == 404

    def test_requires_auth(self):
        r = requests.post(f"{BASE_URL}/rdp/rdp-test-1/renew", json={})
        assert r.status_code == 401


# -------- Apidoc --------
class TestApiDoc:
    def test_apidoc_renders(self):
        r = requests.get(APIDOC_URL)
        assert r.status_code == 200
        body = r.text
        assert "render error" not in body.lower()
        # Documented endpoints
        assert "/vps/:id/renew" in body or "/vps/{id}/renew" in body
        assert "/hosting/:user/renew" in body or "/hosting/{user}/renew" in body
        assert "/rdp/:id/renew" in body or "/rdp/{id}/renew" in body


# -------- Regression: renewals listing still works --------
class TestRenewalsListingRegression:
    def test_renewals_list(self):
        r = requests.get(f"{BASE_URL}/renewals", headers=HEADERS)
        assert r.status_code == 200, r.text
        d = r.json()
        # Should contain the groupings
        assert isinstance(d, dict)
