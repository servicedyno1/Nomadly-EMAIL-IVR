# LIVE read-only checks: brand panel served on root domains, favicons, redirects, cPanel tunnels, preview favicon via /api
import hashlib
import os
import pytest
import requests

PREVIEW = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')
ROOTS = ['hostbay.io', 'smadavhost.com', 'voodoohost.xyz', 'proshophost.xyz']
OLD_PANEL = {'hostbay.io': 'panel.2.hostbay.io', 'smadavhost.com': '1.panel.smadavhost.com',
             'voodoohost.xyz': 'panel.voodoohost.xyz', 'proshophost.xyz': 'panel.proshophost.xyz'}


# Favicon per brand: 200 image/png, non-empty, distinct per brand
def test_favicons_distinct():
    hashes = {}
    for d in ROOTS:
        for p in ['/favicon.ico', '/favicon.png', '/apple-touch-icon.png']:
            r = requests.get(f'https://{d}{p}', timeout=20)
            assert r.status_code == 200 and r.headers['content-type'].startswith('image/png') and len(r.content) > 1000, (d, p)
        hashes[d] = hashlib.md5(requests.get(f'https://{d}/favicon.ico', timeout=20).content).hexdigest()
    assert len(set(hashes.values())) == 4


# Root serves hosting panel SPA, brand images load
@pytest.mark.parametrize('d', ROOTS)
def test_root_panel_and_brand_assets(d):
    r = requests.get(f'https://{d}/', timeout=20)
    assert r.status_code == 200 and '<title>Hosting Panel</title>' in r.text
    for f in ['logo', 'mark', 'wordmark']:
        a = requests.get(f'https://{d}/brand/{f}.png', timeout=20)
        assert a.status_code == 200 and a.headers['content-type'].startswith('image/png')


# Old panel hosts and www redirect 301 to root with same path
@pytest.mark.parametrize('d', ROOTS)
def test_redirects(d):
    for host in [OLD_PANEL[d], f'www.{d}']:
        r = requests.get(f'https://{host}/some/path?q=1', allow_redirects=False, timeout=20)
        assert r.status_code == 301 and r.headers['location'] == f'https://{d}/some/path?q=1', host


# cPanel / WHM tunnels untouched
@pytest.mark.parametrize('u', ['https://cpanel-api.hostbay.io/', 'https://whm-api.hostbay.io/'])
def test_cpanel_up(u):
    r = requests.get(u, timeout=20)
    assert r.status_code < 500 and 'Hosting Panel' not in r.text


# Preview: node favicon/brand reachable via /api prefix
def test_preview_favicon_api():
    for p in ['/api/favicon.ico', '/api/brand/mark.png']:
        r = requests.get(f'{PREVIEW}{p}', timeout=20)
        assert r.status_code == 200 and r.headers['content-type'].startswith('image/png')
