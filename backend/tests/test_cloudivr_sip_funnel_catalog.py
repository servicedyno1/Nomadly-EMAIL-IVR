# CloudIVR SIP sales page (/cloudivr/sip) — public catalog the page renders from
import os
import requests

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL').rstrip('/')
CAT = f"{BASE_URL}/api/cloudivr-web/public/catalog"


def _cat():
    r = requests.get(CAT, timeout=20)
    assert r.status_code == 200
    return r.json()


def test_sip_domain():
    assert _cat()["sipDomain"] == "sip.cloudivr.net"


def test_plan_prices_and_sip_access():
    plans = {p["id"]: p for p in _cat()["plans"]}
    assert plans["starter"]["price"] == 50 and plans["pro"]["price"] == 75 and plans["business"]["price"] == 120
    assert not plans["starter"]["access"]["sipCredentials"]
    assert plans["pro"]["access"]["sipCredentials"] and plans["business"]["access"]["sipCredentials"]
    assert plans["pro"]["recommended"] is True


def test_extra_number_limits_and_countries():
    c = _cat()
    assert c["extraNumber"]["limits"] == {"starter": 3, "pro": 15, "business": 30}
    assert len(c["countries"]) == 17


def test_sip_page_spa_served():
    r = requests.get(f"{BASE_URL}/cloudivr/sip", timeout=20)
    assert r.status_code == 200 and "<div id=\"root\"" in r.text
