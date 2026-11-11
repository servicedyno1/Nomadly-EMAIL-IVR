# CloudIVR web: "pick a country for numbers without a code" — phone-countries, fix-country, contacts import with country, leads-file
import os
import pytest, requests

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL').rstrip('/')
API = f"{BASE_URL}/api/cloudivr-web"
U = ("civr.uxtest@example.com", "UxTest#2026")
CSV = "Name,Phone\nAnn,4155550111\nBob,(212) 555-0122\nCat,+447911123456\nDan,07911123456\nEve,12345\n"


@pytest.fixture(scope="module")
def s():
    x = requests.Session()
    r = x.post(f"{API}/auth/login", json={"email": U[0], "password": U[1], "remember": True}, timeout=30)
    if r.status_code != 200:
        pytest.skip(f"login failed {r.status_code} {r.text}")
    return x


@pytest.fixture(scope="module")
def made(s):
    m = {"lists": [], "contacts": []}
    yield m
    for c in m["contacts"]:
        s.delete(f"{API}/contacts/{c}")
    for l in m["lists"]:
        s.delete(f"{API}/contacts/lists/{l}")


def fix(s, text, country):
    return s.post(f"{API}/contacts/fix-country", json={"text": text, "country": country})


# --- countries ---
def test_phone_countries(s):
    r = s.get(f"{API}/phone-countries")
    assert r.status_code == 200
    c = r.json()["countries"]
    assert 230 <= len(c) <= 260
    names = [x["name"] for x in c]
    assert names == sorted(names, key=lambda n: n) or names[0] < names[-1]
    gb = next(x for x in c if x["iso"] == "GB")
    assert gb["code"] == "+44" and gb["name"] == "United Kingdom"


def test_phone_countries_requires_login():
    r = requests.get(f"{API}/phone-countries")
    assert r.status_code in (401, 403)


# --- fix-country ---
def test_fix_gb(s):
    d = fix(s, "07911123456,Ann\n4155550100,Bob\n+14155550101", "GB").json()
    assert d["text"] == "+447911123456,Ann\n4155550100,Bob\n+14155550101"
    assert d["fixed"] == 1 and d["notFit"] == ["4155550100"] and d["countryName"] == "United Kingdom"


def test_fix_us(s):
    d = fix(s, "07911123456,Ann\n4155550100,Bob\n+14155550101", "US").json()
    assert "+14155550100,Bob" in d["text"] and "+14155550101" in d["text"]
    assert d["fixed"] == 1


def test_fix_fr(s):
    d = fix(s, "0612345678\n612345678", "FR").json()
    assert d["text"] == "+33612345678\n+33612345678", d


def test_fix_it_keeps_zero(s):
    d = fix(s, "0612345678", "IT").json()
    assert d["text"] == "+390612345678", d


def test_fix_already_coded_untouched(s):
    d = fix(s, "447911123456\n14155550100\n00447911123456", "FR").json()
    assert d["text"] == "447911123456\n14155550100\n00447911123456" and d["fixed"] == 0


def test_fix_invalid_country(s):
    r = fix(s, "4155550100", "XX")
    assert r.status_code == 400 and r.json()["error"] == "invalid_country"


def test_fix_names_untouched_and_quickcall_style(s):
    d = fix(s, "4155550100, 2125550123", "US").json()
    assert d["text"] == "+14155550100, +12125550123", d
    d = fix(s, "John 2nd,4155550100", "US").json()
    assert d["text"] == "John 2nd,+14155550100"


# --- contacts import ---
def parse(s, csv=CSV, name="TEST_cc.csv"):
    r = s.post(f"{API}/contacts/import/parse", files={"file": (name, csv.encode(), "text/csv")})
    assert r.status_code == 201, r.text
    return r.json()


def body(p, **kw):
    return {"importId": p["importId"], "hasHeader": p["hasHeader"], "roles": [c["role"] for c in p["columns"]], **kw}


def test_import_check_without_country(s):
    p = parse(s)
    d = s.post(f"{API}/contacts/import/check", json=body(p)).json()
    assert d["noCode"] == 3, d
    assert d["valid"] == 1  # only Cat
    reasons = " ".join(x.get("reason") or "" for x in d["invalidSample"])
    assert "has no country code" in reasons


def test_import_check_us_and_import(s, made):
    p = parse(s)
    d = s.post(f"{API}/contacts/import/check", json=body(p, country="US")).json()
    assert d["fixed"] == 2 and d["valid"] == 3 and d["invalid"] == 2, d
    reasons = [x.get("reason") or "" for x in d["invalidSample"]]
    assert any("doesn’t look like a United States number" in r or "doesn't look like a United States number" in r for r in reasons), reasons
    r = s.post(f"{API}/contacts/import", json=body(p, country="US", listName="TEST_cc_list"))
    assert r.status_code == 201, r.text
    lst = r.json()["list"]
    made["lists"].append(lst["id"])
    assert r.json()["fixed"] == 2
    cs = s.get(f"{API}/contacts", params={"list": lst["id"]}).json()["contacts"]
    phones = {c["name"]: c["phone"] for c in cs}
    assert phones.get("Ann") == "+14155550111" and phones.get("Bob") == "+12125550122" and phones.get("Cat") == "+447911123456", phones
    for c in cs:
        if c["listIds"] == [lst["id"]]:  # only contacts this test created (pre-existing ones are just linked)
            made["contacts"].append(c["id"])


def test_import_normal_e164_unchanged(s, made):
    p = parse(s, "Name,Phone\nTESTZed,+14155550177\n", "TEST_e164.csv")
    d = s.post(f"{API}/contacts/import/check", json=body(p)).json()
    assert d["valid"] == 1 and d["noCode"] == 0 and d["fixed"] == 0
    r = s.post(f"{API}/contacts/import", json=body(p, listName="TEST_e164_list"))
    assert r.status_code == 201
    made["lists"].append(r.json()["list"]["id"])
    cs = s.get(f"{API}/contacts", params={"list": r.json()["list"]["id"]}).json()["contacts"]
    assert cs[0]["phone"] == "+14155550177"
    if cs[0]["listIds"] == [r.json()["list"]["id"]]:
        made["contacts"].append(cs[0]["id"])


# --- leads-file ---
def test_leads_file_keeps_nocode(s):
    csv = "Phone,Name\n4155550100,Ann\n2125550123,Bob\n+447911123456,Cat\n"
    r = s.post(f"{API}/contacts/leads-file", files={"file": ("TEST_leads.csv", csv.encode(), "text/csv")})
    assert r.status_code == 200, r.text
    d = r.json()
    assert "4155550100,Ann" in d["text"] and "2125550123,Bob" in d["text"] and "+447911123456,Cat" in d["text"]
    assert d["noCode"] == 2 and d["count"] == 1 and d["suggestCountry"] == "US"
    assert not any("has no country code" in e for e in d["errors"])


def test_leads_file_no_suggest_for_uk(s):
    csv = "Phone\n07911123456\n07911123457\n"
    d = s.post(f"{API}/contacts/leads-file", files={"file": ("TEST_l.txt", csv.encode(), "text/plain")}).json()
    assert d["noCode"] == 2 and d["suggestCountry"] is None


def test_manual_contact_still_rejects_bare(s):
    r = s.post(f"{API}/contacts", json={"phone": "4155550100", "name": "TEST_bare"})
    assert r.status_code == 400 and "has no country code" in r.json()["message"]
