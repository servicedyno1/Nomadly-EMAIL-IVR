"""
Backend tests for the new Reseller URL Shortener feature.
Target: Node bot reseller API on http://127.0.0.1:5000/reseller/v1
"""
import os
import time
import uuid
import pytest
import requests
from pymongo import MongoClient

BASE = "http://127.0.0.1:5000/reseller/v1"
APIDOC = "http://127.0.0.1:5000/apidoc"
KEY = "rsk_live_566a19727b74061600ef1d0b671132070b47892ab7b1d900"
OWNER = 999000111
DOMAIN = "golink-test.com"

AUTH = {"Authorization": f"Bearer {KEY}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def mongo():
    url = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
    db_name = os.environ.get("DB_NAME", "test")
    c = MongoClient(url)
    yield c[db_name]
    c.close()


# ---------- health & listing ----------

def test_health_includes_shortener():
    r = requests.get(f"{BASE}/health", headers=AUTH)
    assert r.status_code == 200
    assert "shortener" in r.json().get("products", [])


def test_list_domains_contains_seed():
    r = requests.get(f"{BASE}/shortener/domains", headers=AUTH)
    assert r.status_code == 200
    data = r.json()
    doms = {d["domain"]: d for d in data["domains"]}
    assert DOMAIN in doms
    assert doms[DOMAIN]["status"] == "completed"
    assert doms[DOMAIN].get("cname_target")


# ---------- activation dry-runs ----------

def test_activate_existing_owned():
    r = requests.post(f"{BASE}/shortener/domains", headers=AUTH,
                      json={"source": "existing", "domain": DOMAIN})
    assert r.status_code in (200, 201, 202), r.text
    j = r.json()
    assert j.get("mode") == "dry_run" or j.get("dry_run") is True
    # Expect would_activate true per spec
    inner = j.get("result") or j
    assert inner.get("would_activate") is True or j.get("would_activate") is True


def test_activate_existing_not_owned():
    r = requests.post(f"{BASE}/shortener/domains", headers=AUTH,
                      json={"source": "existing", "domain": "someone-else-domain-xyz.com"})
    assert r.status_code == 404
    assert "not_found" in r.text


def test_activate_external_any_domain():
    r = requests.post(f"{BASE}/shortener/domains", headers=AUTH,
                      json={"source": "external", "domain": f"ext-{uuid.uuid4().hex[:6]}.com"})
    assert r.status_code in (200, 201, 202), r.text
    assert r.json().get("mode") == "dry_run"


def test_activate_buy_returns_dry_run_with_price():
    r = requests.post(f"{BASE}/shortener/domains", headers=AUTH,
                      json={"source": "buy", "domain": f"buyme-{uuid.uuid4().hex[:6]}.com"})
    assert r.status_code in (200, 201, 202), r.text
    j = r.json()
    assert j.get("mode") == "dry_run" or j.get("dry_run") is True
    # price should appear somewhere
    body = r.text.lower()
    assert "price" in body or "amount" in body or "cost" in body


def test_activate_invalid_source():
    r = requests.post(f"{BASE}/shortener/domains", headers=AUTH,
                      json={"source": "bogus", "domain": DOMAIN})
    assert r.status_code == 400


def test_activate_invalid_domain():
    r = requests.post(f"{BASE}/shortener/domains", headers=AUTH,
                      json={"source": "existing", "domain": "not a domain"})
    assert r.status_code == 400


# ---------- auth required ----------

def test_links_requires_auth_missing():
    r = requests.get(f"{BASE}/shortener/links")
    assert r.status_code == 401


def test_links_requires_auth_bad_key():
    r = requests.get(f"{BASE}/shortener/links", headers={"Authorization": "Bearer bad_key"})
    assert r.status_code == 401


def test_domains_requires_auth():
    r = requests.get(f"{BASE}/shortener/domains")
    assert r.status_code == 401


# ---------- link CRUD ----------

_created_slugs = []


def _create_link(alias=None, url="https://example.com/hello", expires_in_days=None, domain=DOMAIN):
    payload = {"domain": domain, "url": url}
    if alias is not None:
        payload["alias"] = alias
    if expires_in_days is not None:
        payload["expires_in_days"] = expires_in_days
    return requests.post(f"{BASE}/shortener/links", headers=AUTH, json=payload)


def test_create_link_custom_alias():
    alias = f"qa{uuid.uuid4().hex[:6]}"
    r = _create_link(alias=alias)
    assert r.status_code == 201, r.text
    j = r.json()
    assert j.get("short_url") == f"https://{DOMAIN}/{alias}"
    assert j.get("clicks") == 0
    assert j.get("status") == "active"
    _created_slugs.append(alias)


def test_create_link_auto_slug():
    r = _create_link()
    assert r.status_code == 201, r.text
    j = r.json()
    slug = j.get("slug") or (j.get("short_url", "").rsplit("/", 1)[-1])
    assert slug and len(slug) == 7
    _created_slugs.append(slug)


def test_create_link_with_expiry():
    alias = f"exp{uuid.uuid4().hex[:5]}"
    r = _create_link(alias=alias, expires_in_days=3)
    assert r.status_code == 201, r.text
    j = r.json()
    assert j.get("expires_at")
    assert j.get("status") == "active"
    _created_slugs.append(alias)


def test_create_link_non_activated_domain():
    r = _create_link(alias="abc", domain="not-activated-xyz.com")
    assert r.status_code == 409
    assert "domain_not_activated" in r.text


def test_create_link_reserved_alias():
    r = _create_link(alias="login")
    assert r.status_code == 409
    assert "reserved_alias" in r.text


def test_create_link_duplicate_alias():
    alias = f"dup{uuid.uuid4().hex[:5]}"
    r1 = _create_link(alias=alias)
    assert r1.status_code == 201
    _created_slugs.append(alias)
    r2 = _create_link(alias=alias)
    assert r2.status_code == 409
    assert "alias_taken" in r2.text


def test_create_link_invalid_url():
    r = _create_link(alias=f"iu{uuid.uuid4().hex[:5]}", url="not-a-url")
    assert r.status_code == 400
    assert "invalid_url" in r.text


def test_list_links_and_filter():
    r = requests.get(f"{BASE}/shortener/links", headers=AUTH)
    assert r.status_code == 200
    j = r.json()
    links = j.get("links") or j.get("items") or []
    assert any(l.get("slug") in _created_slugs for l in links) or len(links) > 0
    # with domain filter
    r2 = requests.get(f"{BASE}/shortener/links?domain={DOMAIN}", headers=AUTH)
    assert r2.status_code == 200
    for l in (r2.json().get("links") or r2.json().get("items") or []):
        assert l.get("domain") == DOMAIN


def test_get_single_link():
    assert _created_slugs
    slug = _created_slugs[0]
    r = requests.get(f"{BASE}/shortener/links/{slug}?domain={DOMAIN}", headers=AUTH)
    assert r.status_code == 200, r.text
    j = r.json()
    assert (j.get("slug") == slug) or (slug in j.get("short_url", ""))


def test_get_unknown_slug_404():
    r = requests.get(f"{BASE}/shortener/links/nope{uuid.uuid4().hex[:6]}?domain={DOMAIN}", headers=AUTH)
    assert r.status_code == 404


# ---------- PATCH ----------

def test_patch_disable_and_enable():
    assert _created_slugs
    slug = _created_slugs[0]
    r = requests.patch(f"{BASE}/shortener/links/{slug}", headers=AUTH,
                       json={"domain": DOMAIN, "disabled": True})
    assert r.status_code == 200, r.text
    assert r.json().get("status") == "disabled"
    r2 = requests.patch(f"{BASE}/shortener/links/{slug}", headers=AUTH,
                        json={"domain": DOMAIN, "disabled": False})
    assert r2.status_code == 200
    assert r2.json().get("status") == "active"


def test_patch_expiry_set_and_clear():
    assert _created_slugs
    slug = _created_slugs[0]
    r = requests.patch(f"{BASE}/shortener/links/{slug}", headers=AUTH,
                       json={"domain": DOMAIN, "expires_in_days": 7})
    assert r.status_code == 200, r.text
    assert r.json().get("expires_at")
    r2 = requests.patch(f"{BASE}/shortener/links/{slug}", headers=AUTH,
                        json={"domain": DOMAIN, "expires_in_days": None})
    assert r2.status_code == 200
    j = r2.json()
    assert j.get("expires_at") in (None, "")
    assert j.get("status") == "active"


def test_patch_empty_body_400():
    assert _created_slugs
    slug = _created_slugs[0]
    r = requests.patch(f"{BASE}/shortener/links/{slug}", headers=AUTH, json={"domain": DOMAIN})
    assert r.status_code == 400
    body = r.text
    assert ("nothing_to_update" in body) or ("invalid_body" in body)


def test_patch_invalid_expiry_400():
    assert _created_slugs
    slug = _created_slugs[0]
    r = requests.patch(f"{BASE}/shortener/links/{slug}", headers=AUTH,
                       json={"domain": DOMAIN, "expires_in_days": "banana"})
    assert r.status_code == 400
    assert "invalid_expiry" in r.text or "invalid_body" in r.text


# ---------- DB redirect-compatibility assertion ----------

def test_fullurlof_key_shape(mongo):
    alias = "qa1"
    # ensure clean slate
    requests.delete(f"{BASE}/shortener/links/{alias}?domain={DOMAIN}", headers=AUTH)
    long_url = "https://example.com/redirect-key-check"
    r = _create_link(alias=alias, url=long_url)
    assert r.status_code == 201, r.text
    _created_slugs.append(alias)
    expected_id = "golink-test@com/qa1"
    doc = mongo["fullUrlOf"].find_one({"_id": expected_id})
    assert doc is not None, f"fullUrlOf doc with _id={expected_id} not found"
    assert doc.get("val") == long_url


# ---------- DELETE ----------

def test_delete_link_and_404():
    alias = f"del{uuid.uuid4().hex[:5]}"
    r = _create_link(alias=alias)
    assert r.status_code == 201
    d = requests.delete(f"{BASE}/shortener/links/{alias}?domain={DOMAIN}", headers=AUTH)
    assert d.status_code == 200, d.text
    assert d.json().get("deleted") is True
    g = requests.get(f"{BASE}/shortener/links/{alias}?domain={DOMAIN}", headers=AUTH)
    assert g.status_code == 404
    d2 = requests.delete(f"{BASE}/shortener/links/{alias}?domain={DOMAIN}", headers=AUTH)
    assert d2.status_code == 404


# ---------- apidoc ----------

def test_apidoc_renders_shortener():
    r = requests.get(APIDOC)
    assert r.status_code == 200
    txt = r.text
    assert "URL Shortener" in txt or "shortener" in txt.lower()
    assert "/shortener/domains" in txt
    assert "/shortener/links" in txt
    assert "render error" not in txt.lower()
    # patch badge should be present
    assert "PATCH" in txt


# ---------- cleanup ----------

def test_cleanup_created_links():
    for slug in set(_created_slugs):
        requests.delete(f"{BASE}/shortener/links/{slug}?domain={DOMAIN}", headers=AUTH)
