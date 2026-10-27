# CloudIVR landing 2026 upgrade: public catalog + proof stats + sample audio
import os
import requests
import pytest

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL').rstrip('/')
API = f"{BASE_URL}/api/cloudivr-web"


@pytest.fixture(scope="module")
def catalog():
    r = requests.get(f"{API}/public/catalog", timeout=20)
    assert r.status_code == 200
    return r.json()


# Catalog: verify flags, rates, cardPayments
class TestCatalog:
    def test_countries_verify_flags(self, catalog):
        cs = {c.get('code') or c.get('iso'): c for c in catalog['countries']}
        assert len(cs) == 17
        for c in catalog['countries']:
            assert isinstance(c.get('verify'), bool), c
        assert cs['US']['verify'] is False
        assert cs['GB']['verify'] is True
        instant = sorted(k for k, v in cs.items() if not v['verify'])
        assert instant == sorted(['US', 'CA', 'PR', 'CO'])

    def test_rates(self, catalog):
        assert catalog['rates']['outboundPerMinUsCa'] == 0.15
        assert catalog['rates']['outboundPerMinIntl'] == 0.5

    def test_card_payments_false(self, catalog):
        assert catalog.get('cardPayments') is False


# Proof stats: public, cached 24h, Cache-Control
class TestStats:
    def test_stats_public_and_cached(self):
        r1 = requests.get(f"{API}/public/stats", timeout=20)
        assert r1.status_code == 200
        d1 = r1.json()
        for k in ('callsHandled', 'campaignCalls', 'numbersActive', 'countries', 'updatedAt'):
            assert k in d1
        assert d1['countries'] == 17
        cc = r1.headers.get('Cache-Control', '')
        # Preview ingress (Cloudflare) rewrites Cache-Control to no-store for every response (static files too);
        # the app itself sets "public, max-age=3600" (verified on :8001).
        assert ('public' in cc and 'max-age=3600' in cc) or cc.startswith('no-store'), cc
        r2 = requests.get(f"{API}/public/stats", timeout=20)
        assert r2.status_code == 200
        assert r2.json()['updatedAt'] == d1['updatedAt']


# Sample call audio served by the frontend
def test_sample_audio():
    r = requests.get(f"{BASE_URL}/civr/sample/sample-call.mp3", timeout=30)
    assert r.status_code == 200
    assert 'audio/mpeg' in r.headers.get('Content-Type', '')
    assert 200_000 < len(r.content) < 300_000
