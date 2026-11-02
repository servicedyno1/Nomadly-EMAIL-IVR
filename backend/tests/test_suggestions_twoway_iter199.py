# Iteration 199: Overview "Suggested" line prefs (hide/show, cross-session) + two-way SMS copy in landing/app sources
import os
import re
import pytest
import requests
from dotenv import dotenv_values

FE_ENV = dotenv_values('/app/frontend/.env')
BASE_URL = (os.environ.get('REACT_APP_BACKEND_URL') or FE_ENV['REACT_APP_BACKEND_URL']).rstrip('/')
API = f"{BASE_URL}/api/cloudivr-web"
ALICE = {"email": "civr.alice@example.com", "password": "AliceTest#2026"}
SRC = '/app/frontend/src/cloudivr/pages'


def login():
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json=ALICE)
    if r.status_code != 200:
        pytest.skip(f"alice login failed {r.status_code}")
    return s


@pytest.fixture(scope="module")
def alice():
    s = login()
    yield s
    s.put(f"{API}/prefs/suggestions", json={"hidden": False})  # restore visible


# ---- suggestions prefs ----
class TestSuggestionsPref:
    def test_unauth_401(self):
        assert requests.get(f"{API}/prefs/onboarding").status_code == 401
        assert requests.put(f"{API}/prefs/suggestions", json={"hidden": True}).status_code == 401

    def test_onboarding_has_flag(self, alice):
        d = alice.get(f"{API}/prefs/onboarding").json()
        assert isinstance(d["suggestionsHidden"], bool)
        assert isinstance(d["purposes"], list)

    def test_hide_persists_across_sessions(self, alice):
        r = alice.put(f"{API}/prefs/suggestions", json={"hidden": True})
        assert r.status_code == 200 and r.json() == {"suggestionsHidden": True}
        assert alice.get(f"{API}/prefs/onboarding").json()["suggestionsHidden"] is True
        other = login()  # fresh "device"
        assert other.get(f"{API}/prefs/onboarding").json()["suggestionsHidden"] is True

    def test_show_again(self, alice):
        r = alice.put(f"{API}/prefs/suggestions", json={"hidden": False})
        assert r.json() == {"suggestionsHidden": False}
        assert alice.get(f"{API}/prefs/onboarding").json()["suggestionsHidden"] is False

    def test_hide_does_not_touch_purposes(self, alice):
        before = alice.get(f"{API}/prefs/onboarding").json()
        alice.put(f"{API}/prefs/suggestions", json={"hidden": True})
        after = alice.get(f"{API}/prefs/onboarding").json()
        assert after["purposes"] == before["purposes"] and after["onboarded"] == before["onboarded"]
        alice.put(f"{API}/prefs/suggestions", json={"hidden": False})

    def test_truthy_coercion(self, alice):
        assert alice.put(f"{API}/prefs/suggestions", json={}).json()["suggestionsHidden"] is False
        assert alice.put(f"{API}/prefs/suggestions", json={"hidden": "yes"}).json()["suggestionsHidden"] is True
        alice.put(f"{API}/prefs/suggestions", json={"hidden": False})


# ---- two-way SMS copy (source check) ----
COPY = {
    'landing/ProductHero.js': ['Two-way SMS: send and receive texts instantly on your phone', 'Two-way SMS: send and receive texts instantly in CloudIVR Messages'],
    'landing/EsimPlans.js': ['Two-way SMS on your phone'],
    'landing/Families.js': ['two-way SMS'],
    'landing/PricingFaq.js': ['Can I receive texts, not just send them?', 'two-way SMS'],
    'Esim.js': ['Both have two-way SMS'],
    'buy/MobileOffer.js': ['Need a USA mobile number with two-way SMS?', 'Two-way SMS: send and receive texts instantly in Messages.'],
    'number/MobileLines.js': ['two-way SMS'],
    'Messages.js': ['A USA eSIM sends and receives texts on your phone instead.'],
}


@pytest.mark.parametrize("f,needles", list(COPY.items()))
def test_copy_present(f, needles):
    txt = open(f"{SRC}/{f}").read()
    for n in needles:
        assert n in txt, f"{n!r} missing in {f}"


@pytest.mark.parametrize("f", list(COPY.keys()))
def test_no_one_way_wording(f):
    txt = open(f"{SRC}/{f}").read()
    assert not re.search(r"one-way|send-only|send only|texts only|receive-only|only receive", txt, re.I), f
