# CloudIVR web: Contacts (lists, CRUD, smart import parse/check/import, leads-file), campaigns from a list, campaign rename
import os, json, uuid
import pytest, requests

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL').rstrip('/')
API = f"{BASE_URL}/api/cloudivr-web"
A = ("civr.alice@example.com", "AliceTest#2026")
B = ("civr.bob@example.com", "BobTest#2026")
XLSX = "/app/tests/fixtures/contacts_sample.xlsx"


def login(email, pw):
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": email, "password": pw}, timeout=30)
    if r.status_code != 200:
        pytest.skip(f"login failed {email}: {r.status_code} {r.text}")
    return s


@pytest.fixture(scope="module")
def sa():
    return login(*A)


@pytest.fixture(scope="module")
def sb():
    return login(*B)


@pytest.fixture(scope="module")
def cleanup(sa):
    made = {"lists": [], "contacts": []}
    yield made
    for c in made["contacts"]:
        sa.delete(f"{API}/contacts/{c}")
    for l in made["lists"]:
        sa.delete(f"{API}/contacts/lists/{l}")


def parse_xlsx(s):
    with open(XLSX, "rb") as f:
        return s.post(f"{API}/contacts/import/parse", files={"file": ("contacts_sample.xlsx", f, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")})


# --- Lists ---
class TestLists:
    def test_list_crud(self, sa, cleanup):
        r = sa.post(f"{API}/contacts/lists", json={"name": "TEST_list"})
        assert r.status_code == 201, r.text
        lid = r.json()["list"]["id"]
        assert r.json()["list"]["count"] == 0
        assert sa.patch(f"{API}/contacts/lists/{lid}", json={"name": "TEST_list2"}).status_code == 200
        names = {l["id"]: l["name"] for l in sa.get(f"{API}/contacts/lists").json()["lists"]}
        assert names[lid] == "TEST_list2"
        assert sa.patch(f"{API}/contacts/lists/{lid}", json={"name": " "}).status_code == 400
        assert sa.post(f"{API}/contacts/lists", json={"name": ""}).status_code == 400
        assert sa.delete(f"{API}/contacts/lists/{lid}").status_code == 200
        assert sa.delete(f"{API}/contacts/lists/{lid}").status_code == 404


# --- Contacts CRUD + isolation ---
class TestContacts:
    def test_crud_dupe_isolation(self, sa, sb, cleanup):
        phone = "+1415555" + str(uuid.uuid4().int)[:4]
        assert sa.post(f"{API}/contacts", json={"name": "TEST_x"}).status_code == 400
        assert sa.post(f"{API}/contacts", json={"phone": "12"}).status_code == 400
        assert sa.post(f"{API}/contacts", json={"phone": phone, "email": "bad"}).status_code == 400
        r = sa.post(f"{API}/contacts", json={"phone": phone, "name": "TEST_Carl", "email": "c@x.io"})
        assert r.status_code == 201, r.text
        c = r.json()["contact"]; cleanup["contacts"].append(c["id"])
        assert c["phone"] == phone and c["name"] == "TEST_Carl"
        d = sa.post(f"{API}/contacts", json={"phone": phone})
        assert d.status_code == 409 and d.json()["error"] == "contact_exists" and "already saved" in d.json()["message"]
        # isolation
        assert sb.get(f"{API}/contacts/{c['id']}").status_code == 404
        assert sb.patch(f"{API}/contacts/{c['id']}", json={"name": "hack"}).status_code == 404
        assert sb.delete(f"{API}/contacts/{c['id']}").status_code == 404
        assert all(x["id"] != c["id"] for x in sb.get(f"{API}/contacts?limit=100").json()["contacts"])
        # patch
        p = sa.patch(f"{API}/contacts/{c['id']}", json={"notes": "TEST note", "name": "TEST_Carl2"})
        assert p.status_code == 200 and p.json()["contact"]["notes"] == "TEST note"
        g = sa.get(f"{API}/contacts/{c['id']}").json()["contact"]
        assert g["name"] == "TEST_Carl2" and g["email"] == "c@x.io"
        # search server-side
        s = sa.get(f"{API}/contacts", params={"q": "TEST_Carl2"}).json()
        assert s["total"] == 1 and s["contacts"][0]["id"] == c["id"]
        s2 = sa.get(f"{API}/contacts", params={"q": phone[-7:]}).json()
        assert any(x["id"] == c["id"] for x in s2["contacts"])
        # delete
        assert sa.delete(f"{API}/contacts/{c['id']}").status_code == 200
        assert sa.get(f"{API}/contacts/{c['id']}").status_code == 404
        cleanup["contacts"].remove(c["id"])

    def test_list_delete_keeps_contacts(self, sa, cleanup):
        lid = sa.post(f"{API}/contacts/lists", json={"name": "TEST_keep"}).json()["list"]["id"]
        phone = "+1415556" + str(uuid.uuid4().int)[:4]
        c = sa.post(f"{API}/contacts", json={"phone": phone, "listIds": [lid, "bogus"]}).json()["contact"]
        cleanup["contacts"].append(c["id"])
        assert c["listIds"] == [lid]
        assert sa.get(f"{API}/contacts", params={"list": lid}).json()["total"] == 1
        sa.delete(f"{API}/contacts/lists/{lid}")
        g = sa.get(f"{API}/contacts/{c['id']}").json()["contact"]
        assert g["listIds"] == []


# --- Import parse/check/import ---
class TestImport:
    def test_parse_xlsx_roles(self, sa):
        r = parse_xlsx(sa)
        assert r.status_code == 201, r.text
        d = r.json()
        assert d["hasHeader"] is True and d["fileName"] == "contacts_sample.xlsx"
        roles = {c["header"]: c["role"] for c in d["columns"]}
        assert roles == {"First Name": "first_name", "Last Name": "last_name", "Mobile Phone": "phone", "E-mail": "email", "Company": "company", "City": "keep", "Notes": "notes"}, roles
        assert d["rows"] == 5  # header + 4 filled rows

    def test_check_new_list_and_invalid(self, sa):
        d = parse_xlsx(sa).json()
        roles = [c["role"] for c in d["columns"]]
        ck = sa.post(f"{API}/contacts/import/check", json={"importId": d["importId"], "roles": roles, "hasHeader": True})
        assert ck.status_code == 200, ck.text
        c = ck.json()
        assert c["valid"] == 3 and c["invalid"] == 1
        assert c["invalidSample"][0]["row"] == 5 and c["invalidSample"][0]["value"] == "12"
        assert c["existingCount"] == 3 and c["newCount"] == 0  # Alice imported it into t1 already
        # no phone column / two phone columns
        np = [("keep" if r == "phone" else r) for r in roles]
        assert sa.post(f"{API}/contacts/import/check", json={"importId": d["importId"], "roles": np, "hasHeader": True}).json()["error"] == "no_phone_column"
        assert sa.post(f"{API}/contacts/import/check", json={"importId": d["importId"], "roles": ["bogus"] * len(roles), "hasHeader": True}).status_code == 400
        assert sa.post(f"{API}/contacts/import/check", json={"importId": "nope", "roles": roles, "hasHeader": True}).status_code == 404

    def test_import_update_into_existing_and_skip(self, sa, sb, cleanup):
        lid = sa.post(f"{API}/contacts/lists", json={"name": "TEST_imp"}).json()["list"]["id"]
        cleanup["lists"].append(lid)
        d = parse_xlsx(sa).json()
        roles = [c["role"] for c in d["columns"]]
        # Bob can't use Alice's importId
        assert sb.post(f"{API}/contacts/import/check", json={"importId": d["importId"], "roles": roles, "hasHeader": True}).status_code == 404
        r = sa.post(f"{API}/contacts/import", json={"importId": d["importId"], "roles": roles, "hasHeader": True, "listId": lid, "duplicates": "update"})
        assert r.status_code == 201, r.text
        j = r.json()
        assert j["updated"] == 3 and j["created"] == 0 and j["invalid"] == 1 and j["list"]["count"] == 3
        # importId consumed
        assert sa.post(f"{API}/contacts/import/check", json={"importId": d["importId"], "roles": roles, "hasHeader": True}).status_code == 404
        # skip into new list by name
        d2 = parse_xlsx(sa).json()
        r2 = sa.post(f"{API}/contacts/import", json={"importId": d2["importId"], "roles": roles, "hasHeader": True, "listName": "TEST_imp_new", "duplicates": "skip"})
        assert r2.status_code == 201 and r2.json()["skipped"] == 3
        cleanup["lists"].append(r2.json()["list"]["id"])
        # bogus listId
        d3 = parse_xlsx(sa).json()
        assert sa.post(f"{API}/contacts/import", json={"importId": d3["importId"], "roles": roles, "hasHeader": True, "listId": "nope"}).status_code == 404

    def test_paste_flow(self, sa, cleanup):
        phone = "+1415557" + str(uuid.uuid4().int)[:4]
        p = sa.post(f"{API}/contacts/import/parse", json={"text": f"{phone},TEST Paste Person"})
        assert p.status_code == 201, p.text
        d = p.json()
        assert d["hasHeader"] is False and [c["role"] for c in d["columns"]] == ["phone", "name"]
        r = sa.post(f"{API}/contacts/import", json={"importId": d["importId"], "roles": ["phone", "name"], "hasHeader": False, "listName": "TEST_paste"})
        assert r.status_code == 201 and r.json()["created"] == 1
        cleanup["lists"].append(r.json()["list"]["id"])
        c = sa.get(f"{API}/contacts", params={"q": phone}).json()["contacts"][0]
        assert c["name"] == "TEST Paste Person"
        cleanup["contacts"].append(c["id"])

    def test_refuse_xls_and_empty(self, sa):
        xls = bytes.fromhex("D0CF11E0A1B11AE1") + b"\x00" * 600
        r = sa.post(f"{API}/contacts/import/parse", files={"file": ("old.xls", xls, "application/vnd.ms-excel")})
        assert r.status_code == 400 and r.json()["error"] == "unsupported_file" and ".xls" in r.json()["message"]
        assert sa.post(f"{API}/contacts/import/parse", json={"text": "   "}).status_code == 400

    def test_leads_file(self, sa):
        with open(XLSX, "rb") as f:
            r = sa.post(f"{API}/contacts/leads-file", files={"file": ("contacts_sample.xlsx", f)})
        assert r.status_code == 200, r.text
        j = r.json()
        assert j["count"] == 3 and "+14155550100,Jane Doe" in j["text"].split("\n")
        assert j["columns"]["phone"] == "Mobile Phone"
        assert sa.post(f"{API}/contacts/leads-file").status_code == 400


# --- Campaigns from a list + rename ---
class TestCampaignList:
    def test_estimate_create_rename(self, sa, sb):
        lists = sa.get(f"{API}/contacts/lists").json()["lists"]
        t1 = next((l for l in lists if l["name"] == "t1"), None)
        if not t1:
            pytest.skip("no t1 list")
        e = sa.post(f"{API}/campaigns/estimate", json={"listId": t1["id"]})
        assert e.status_code == 200 and e.json()["count"] == t1["count"]
        assert sb.post(f"{API}/campaigns/estimate", json={"listId": t1["id"]}).json()["count"] == 0
        nums = sa.get(f"{API}/numbers").json()["numbers"]
        act = [n for n in nums if n["status"] == "active" and n["plan"] in ("pro", "business")]
        auds = sa.get(f"{API}/audio").json().get("audios") or []
        if not act or not auds:
            pytest.skip("no number/audio")
        r = sa.post(f"{API}/campaigns", json={"callerId": act[0]["phoneNumber"], "audioId": auds[0]["id"], "listId": t1["id"], "name": "TEST_camp", "mode": "report_only"})
        assert r.status_code in (200, 201), r.text
        camp = r.json()["campaign"]
        assert camp.get("name") == "TEST_camp"
        assert camp.get("total", len(camp.get("leads", [])) or t1["count"]) == t1["count"]
        cid = camp["id"]
        assert sa.patch(f"{API}/campaigns/{cid}", json={"name": "  "}).json()["error"] == "invalid_name"
        assert sb.patch(f"{API}/campaigns/{cid}", json={"name": "hack"}).status_code == 404
        rn = sa.patch(f"{API}/campaigns/{cid}", json={"name": "TEST_renamed"})
        assert rn.status_code == 200 and rn.json()["campaign"]["name"] == "TEST_renamed"
        assert sa.get(f"{API}/campaigns/{cid}").json()["campaign"]["name"] == "TEST_renamed"
        sa.post(f"{API}/campaigns/{cid}/cancel")
        # list owned by someone else / empty
        assert sb.post(f"{API}/campaigns", json={"callerId": "+10000000000", "audioId": "x", "listId": t1["id"]}).status_code == 400
