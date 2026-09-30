"""Reseller RDP API + admin golden status tests (iteration_49).

Read-only tests. Never POST a valid RDP order (would create a billable droplet).
"""
import os
import pytest
import requests

def _load_base_url():
    url = os.environ.get("REACT_APP_BACKEND_URL", "").strip()
    if not url:
        try:
            with open("/app/frontend/.env") as f:
                for line in f:
                    if line.startswith("REACT_APP_BACKEND_URL="):
                        url = line.split("=", 1)[1].strip()
                        break
        except Exception:
            pass
    return url.rstrip("/")

BASE_URL = _load_base_url()
assert BASE_URL, "REACT_APP_BACKEND_URL not set"
API_KEY = "nmdly_e2e_51573577f5db956c5c0cb039"
ADMIN_KEY_RAW = "o/Qb8ArGahlquhCQ"
ADMIN_KEY_ENC = "o%2FQb8ArGahlquhCQ"

HEADERS = {"X-API-Key": API_KEY, "Content-Type": "application/json"}


# ------------------ GET /rdp/plans ------------------
class TestRdpPlans:
    def test_no_auth_rejected(self):
        r = requests.get(f"{BASE_URL}/api/reseller/v1/rdp/plans", timeout=30)
        assert r.status_code in (401, 403), f"expected 401/403 got {r.status_code}: {r.text[:200]}"

    def test_plans_us(self):
        r = requests.get(f"{BASE_URL}/api/reseller/v1/rdp/plans?region=US", headers=HEADERS, timeout=30)
        assert r.status_code == 200, r.text[:300]
        j = r.json()
        assert j.get("product") == "rdp"
        assert j.get("provider") == "digitalocean"
        assert j.get("default_os") == "ws2022"
        assert isinstance(j.get("plans"), list) and len(j["plans"]) == 9, f"plans length={len(j.get('plans',[]))}"
        # Speed lever 2: Starter (1vCPU/2GB) retired — must not be sold anymore.
        assert not any(str(p.get("plan_id", "")).startswith("starter") for p in j["plans"]), "starter plan must be removed"
        # Speed lever 1: ×2 pricing off the faster Premium-AMD hardware.
        by_plan = {p["plan_id"]: p for p in j["plans"]}
        assert by_plan["standard-1m"]["price_usd"] == 56, by_plan.get("standard-1m")
        assert by_plan["pro-1m"]["price_usd"] == 112, by_plan.get("pro-1m")
        assert by_plan["power-1m"]["price_usd"] == 224, by_plan.get("power-1m")
        os_opts = j.get("os_options")
        assert isinstance(os_opts, list) and len(os_opts) == 3, f"os_options={os_opts}"
        by_id = {o["id"]: o for o in os_opts}
        assert set(by_id) == {"ws2019", "ws2022", "ws2025"}

        w19 = by_id["ws2019"]
        assert w19["fast_deploy"] is True
        assert w19["eta_minutes"] == 3
        assert "US" in w19["fast_deploy_regions"]
        assert "EU" in w19["fast_deploy_regions"]

        w22 = by_id["ws2022"]
        assert w22["fast_deploy"] is True
        assert w22["eta_minutes"] == 3
        assert "US" in w22["fast_deploy_regions"]
        assert "EU" in w22["fast_deploy_regions"]

        w25 = by_id["ws2025"]
        assert w25["fast_deploy"] is False
        assert w25["eta_minutes"] == 45
        assert w25["fast_deploy_regions"] == []

    @pytest.mark.parametrize("region", ["EU", "SG"])
    def test_plans_other_regions(self, region):
        r = requests.get(f"{BASE_URL}/api/reseller/v1/rdp/plans?region={region}", headers=HEADERS, timeout=30)
        assert r.status_code == 200
        j = r.json()
        os_opts = {o["id"]: o for o in j["os_options"]}
        assert set(os_opts) == {"ws2019", "ws2022", "ws2025"}
        assert os_opts["ws2019"]["fast_deploy"] is True
        assert os_opts["ws2022"]["fast_deploy"] is True
        assert os_opts["ws2025"]["fast_deploy"] is False
        for wid in ("ws2019", "ws2022"):
            assert isinstance(os_opts[wid]["fast_deploy_regions"], list)
            assert len(os_opts[wid]["fast_deploy_regions"]) > 0


# ------------------ POST /rdp validation ------------------
class TestRdpCreateValidation:
    def test_no_auth(self):
        r = requests.post(f"{BASE_URL}/api/reseller/v1/rdp",
                          json={"plan_id": "standard-1m", "region": "US", "os": "ws2016"},
                          timeout=30)
        assert r.status_code in (401, 403), f"got {r.status_code}: {r.text[:200]}"

    def test_invalid_plan(self):
        r = requests.post(f"{BASE_URL}/api/reseller/v1/rdp",
                          headers=HEADERS,
                          json={"plan_id": "nope", "region": "US"}, timeout=30)
        assert r.status_code == 400, f"got {r.status_code}: {r.text[:300]}"
        j = r.json()
        err = j.get("error") or j.get("code") or ""
        assert err == "invalid_plan", f"expected error=invalid_plan got {j}"

    def test_invalid_os(self):
        r = requests.post(f"{BASE_URL}/api/reseller/v1/rdp",
                          headers=HEADERS,
                          json={"plan_id": "standard-1m", "region": "US", "os": "ws2016"}, timeout=30)
        assert r.status_code == 400, f"got {r.status_code}: {r.text[:300]}"
        j = r.json()
        err = j.get("error") or j.get("code") or ""
        assert err == "invalid_os", f"expected error=invalid_os got {j}"
        msg = (j.get("message") or "") + " " + str(j)
        for wid in ("ws2019", "ws2022", "ws2025"):
            assert wid in msg, f"missing {wid} in message: {msg}"


# ------------------ GET /rdp list ------------------
class TestRdpList:
    def test_list_rdp(self):
        r = requests.get(f"{BASE_URL}/api/reseller/v1/rdp", headers=HEADERS, timeout=30)
        assert r.status_code == 200, r.text[:300]
        j = r.json()
        assert "rdp" in j and isinstance(j["rdp"], list)


# ------------------ GET /api/provision/bootscript ------------------
class TestBootscript:
    def test_bootscript(self):
        r = requests.get(f"{BASE_URL}/api/provision/bootscript", timeout=30)
        assert r.status_code == 200, r.text[:200]
        ct = r.headers.get("content-type", "")
        assert "text/plain" in ct, f"content-type={ct}"
        body = r.text
        for needle in ("CloudInitApply", "67.207.67.2",
                       'net user Administrator "$pw" /y', "Clear-DnsClientCache"):
            assert needle in body, f"missing needle: {needle!r}"


# ------------------ Admin golden status ------------------
class TestAdminGoldenStatus:
    def test_wrong_key(self):
        r = requests.get(f"{BASE_URL}/api/admin/rdp-golden/status?key=wrong", timeout=30)
        assert r.status_code in (401, 403), f"got {r.status_code}"

    def test_status(self):
        r = requests.get(f"{BASE_URL}/api/admin/rdp-golden/status?key={ADMIN_KEY_ENC}", timeout=30)
        assert r.status_code == 200, r.text[:400]
        j = r.json()
        os_opts = j.get("os_options")
        assert isinstance(os_opts, list) and len(os_opts) == 3, f"os_options={os_opts}"
        by = {o["id"]: o for o in os_opts}
        assert set(by) == {"ws2019", "ws2022", "ws2025"}

        assert by["ws2019"]["golden_status"] == "available"
        assert by["ws2019"]["golden_image_id"] == 246589188
        assert by["ws2019"]["fast_deploy"] is True

        assert by["ws2022"]["golden_status"] == "available"
        assert by["ws2022"]["golden_image_id"] == 246587962
        assert by["ws2022"]["fast_deploy"] is True

        assert by["ws2025"]["golden_status"] == "building"
        # active_build_id on os option; phase lives on builds[] entry
        w25 = by["ws2025"]
        assert w25.get("active_build_id") == "build-6f59c03d1260", f"active_build_id={w25.get('active_build_id')}"
        builds = j.get("builds", [])
        w25_build = next((b for b in builds if b.get("build_id") == "build-6f59c03d1260"), None)
        assert w25_build is not None, f"build-6f59c03d1260 not in builds: {[b.get('build_id') for b in builds]}"
        assert w25_build.get("phase") == "importing", f"phase={w25_build.get('phase')}"
