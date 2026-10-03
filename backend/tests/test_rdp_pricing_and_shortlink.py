"""Tests for health, DigitalOcean-RDP 1/2/3-month pricing & math, and URL shortener analytics display."""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    # Fallback: read from frontend .env
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith("REACT_APP_BACKEND_URL="):
                BASE_URL = line.strip().split("=", 1)[1].rstrip("/")


# Health check
def test_health():
    r = requests.get(f"{BASE_URL}/api/health", timeout=30)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data.get("status") == "healthy"
    assert data.get("database") == "connected"


# RDP pricing/math diagnostic
class TestRdpPricing:
    @pytest.fixture(scope="class")
    def payload(self):
        r = requests.get(f"{BASE_URL}/api/dev/rdp-pricing-test", timeout=60)
        assert r.status_code == 200, r.text
        return r.json()

    def test_top_level_flags(self, payload):
        assert payload.get("ok") is True, f"failures={payload.get('failures')}"
        assert payload.get("failures") == []
        assert payload.get("rdpProvider") == "digitalocean-rdp"
        assert payload.get("tierCount") == 3
        assert payload.get("durationsPerTier") == 3

    def test_expected_prices_in_checks(self, payload):
        expected = {
            "standard": {1: 56, 2: 100.8, 3: 142.8},
            "pro": {1: 112, 2: 201.6, 3: 285.6},
            "power": {1: 224, 2: 403.2, 3: 571.2},
        }
        expected_discount = {1: 0, 2: 10, 3: 15}
        checks = payload.get("checks", [])
        assert checks, "no checks returned"

        # Index: (layer, tier, months) -> check. productId like "standard-1m"
        idx = {}
        for c in checks:
            pid = c.get("productId", "")
            if "-" in pid and pid.endswith("m"):
                tier_name, mpart = pid.rsplit("-", 1)
                months_val = int(mpart.rstrip("m"))
                idx[(c.get("layer"), tier_name, months_val)] = c

        for layer in ("catalog", "bot"):
            for tier, months_map in expected.items():
                for months, want in months_map.items():
                    c = idx.get((layer, tier, months))
                    assert c is not None, f"missing check {layer}/{tier}/{months}m"
                    got_val = c.get("got") if c.get("got") is not None else c.get("cyclePrice")
                    assert got_val == want, f"{layer}/{tier}/{months}m got={got_val} want={want}"
                    assert c.get("want") == want
                    assert c.get("discountPct") == expected_discount[months], \
                        f"{layer}/{tier}/{months}m discountPct={c.get('discountPct')}"
                    if layer == "bot":
                        # chargeTotalPrice equals selected duration price; endTimeMonthsAhead equals durationMonths
                        assert float(c.get("chargeTotalPrice")) == float(want)
                        assert c.get("endTimeMonthsAhead") == months
                        assert c.get("durationMonths") == months

    def test_bot_layer_okCycle(self, payload):
        bot_checks = [c for c in payload["checks"] if c.get("layer") == "bot"]
        assert len(bot_checks) == 9
        for c in bot_checks:
            assert c.get("okCycle") is True or (c.get("okPrice") is True and c.get("okDisc") is True), \
                f"bot check not ok: {c}"

    def test_coupon_example(self, payload):
        ce = payload.get("couponExample")
        assert ce is not None
        assert ce.get("couponOk") is True, ce
        # Sanity: 25% off power-3m = 571.20 * 0.75 = 428.40
        if "finalPrice" in ce:
            assert round(float(ce["finalPrice"]), 2) == 428.40


# Shortlink analytics display regression
class TestShortlinkAnalytics:
    @pytest.fixture(scope="class")
    def payload(self):
        r = requests.get(f"{BASE_URL}/api/dev/shortlink-analytics-test", timeout=60)
        assert r.status_code == 200, r.text
        return r.json()

    def test_flags(self, payload):
        assert payload.get("ok") is True, payload
        assert payload.get("customShowsClicks") is True
        assert payload.get("externalsStillNA") is True
        assert payload.get("bitlyShowsClicks") is True

    def test_rendered_lines(self, payload):
        rendered = payload.get("rendered", [])
        text_blob = "\n".join(
            r if isinstance(r, str) else r.get("line", "") + " " + str(r)
            for r in rendered
        )

        def find_line(substr):
            for r in rendered:
                s = r if isinstance(r, str) else (r.get("line") or r.get("text") or str(r))
                if substr in s:
                    return s
            return None

        custom1 = find_line("sfrsclaim.com/recovery")
        custom2 = find_line("mydomain.com/promo")
        srtn = find_line("srtn.me")
        ap1s = find_line("ap1s.net")

        assert custom1, f"custom1 line missing in {rendered}"
        assert custom2, f"custom2 line missing in {rendered}"
        assert srtn, f"srtn.me line missing in {rendered}"
        assert ap1s, f"ap1s.net line missing in {rendered}"

        assert "clicks" in custom1.lower()
        assert "analytics not available" not in custom1.lower()
        assert "clicks" in custom2.lower()
        assert "analytics not available" not in custom2.lower()
        assert "analytics not available" in srtn.lower()
        assert "analytics not available" in ap1s.lower()
