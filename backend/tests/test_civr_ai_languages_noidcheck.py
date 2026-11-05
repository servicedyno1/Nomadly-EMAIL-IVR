# CloudIVR: AI agent 20 languages (API) + landing SEO has no ID-check FAQ
import os
import re
import json
import pytest
import requests

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL').rstrip('/')
API = f"{BASE_URL}/api/cloudivr-web"
ALICE = {"email": "civr.alice@example.com", "password": "AliceTest#2026"}
GOAL = "Answer questions about opening hours and take messages."


@pytest.fixture(scope="module")
def alice():
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json=ALICE, timeout=20)
    if r.status_code != 200:
        pytest.skip(f"login failed {r.status_code}")
    created = []
    s.created = created
    yield s
    for aid in created:
        s.delete(f"{API}/ai-agents/{aid}", timeout=20)


def _create(s, lang, name):
    r = s.post(f"{API}/ai-agents", json={"name": name, "goal": GOAL, "language": lang}, timeout=20)
    assert r.status_code in (200, 201), r.text
    a = r.json().get("agent", r.json())
    s.created.append(a["id"])
    return a


# AI agent languages: create with ja, fallback for xx, update to de
class TestAgentLanguages:
    def test_create_ja(self, alice):
        a = _create(alice, "ja", "TEST_lang_ja")
        assert a["language"] == "ja"
        g = alice.get(f"{API}/ai-agents/{a['id']}", timeout=20).json()["agent"]
        assert g["language"] == "ja"

    def test_invalid_falls_back_en(self, alice):
        a = _create(alice, "xx", "TEST_lang_xx")
        assert a["language"] == "en"

    @pytest.mark.parametrize("code", ["es", "fr", "pt", "de", "it", "nl", "ar", "hi", "zh", "ko", "ru", "tr", "pl", "he", "ro", "cs", "vi", "id"])
    def test_update_all_codes(self, alice, code):
        if not hasattr(alice, "upd_id"):
            alice.upd_id = _create(alice, "en", "TEST_lang_upd")["id"]
        r = alice.put(f"{API}/ai-agents/{alice.upd_id}", json={"name": "TEST_lang_upd", "goal": GOAL, "language": code}, timeout=20)
        assert r.status_code == 200, r.text
        assert r.json().get("agent", r.json())["language"] == code
        g = alice.get(f"{API}/ai-agents/{alice.upd_id}", timeout=20).json()["agent"]
        assert g["language"] == code


# Server-rendered SEO for /cloudivr: no ID-check FAQ in JSON-LD
def test_seo_no_idcheck():
    # seo.js only serves on the custom domain, so check the generator directly via node
    import subprocess
    js = "const s=require('/app/js/cloudivr-web/seo.js');process.stdout.write(s.headTags('/'));process.exit(0)"
    html = subprocess.run(["node", "-e", js], capture_output=True, text=True, timeout=60, cwd="/app").stdout
    blocks = re.findall(r'<script type="application/ld\+json"[^>]*>(.*?)</script>', html, re.S)
    assert blocks, "no JSON-LD"
    joined = " ".join(blocks)
    for t in ("SoftwareApplication", "FAQPage", "Organization"):
        assert t in joined, t
    assert "id check" not in joined.lower()
    assert "id check" not in html.lower()
    for b in blocks:
        json.loads(b)
