# CloudIVR web: audio library playback via /api/assets/user-audio (prod-style Node direct + preview), uploads, restore, regression
import os
import subprocess
import uuid
import pytest
import requests

PREVIEW = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')
if not PREVIEW:
    for line in open('/app/frontend/.env'):
        if line.startswith('REACT_APP_BACKEND_URL='):
            PREVIEW = line.split('=', 1)[1].strip().rstrip('/')
NODE = 'http://127.0.0.1:5000'
AUD = '/tmp/aud'
ASSET_DIR = '/app/js/assets/user-audio'
ALICE = {'email': 'civr.alice@example.com', 'password': 'AliceTest#2026'}
CREATED = []


def ffdur(path):
    out = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path],
                         capture_output=True, text=True).stdout.strip()
    return float(out or 0)


def fname(audio_url):
    return audio_url.split('/assets/user-audio/')[1]


@pytest.fixture(scope='module')
def alice():
    s = requests.Session()
    r = s.post(f'{PREVIEW}/api/cloudivr-web/auth/login', json=ALICE)
    if r.status_code != 200:
        pytest.skip(f'Alice login failed {r.status_code} {r.text[:200]}')
    yield s
    for aid in CREATED:
        s.delete(f'{PREVIEW}/api/cloudivr-web/audio/{aid}')


@pytest.fixture(scope='module')
def seeded(alice):
    r = alice.get(f'{PREVIEW}/api/cloudivr-web/audio')
    assert r.status_code == 200
    a = r.json()['audios']
    names = [x['name'] for x in a]
    assert 'VM test vm50.wav' in names and 'VM test vm50.mp3' in names, names
    return [x for x in a if x['name'].startswith('VM test vm50')]


def check_play(base, f, tmpname, expect_dur=50):
    r = requests.get(f'{base}/api/assets/user-audio/{f}?v=2')
    assert r.status_code == 200, r.status_code
    assert r.headers['content-type'].startswith('audio/mpeg'), r.headers['content-type']
    assert not r.content.lstrip().startswith(b'<')
    p = f'/tmp/aud/{tmpname}'
    open(p, 'wb').write(r.content)
    d = ffdur(p)
    assert abs(d - expect_dur) < 2, d
    return len(r.content)


# Seeded clips: prod-style (Node direct) and preview
class TestSeededPlayback:
    def test_seeded_audio_urls(self, seeded):
        for a in seeded:
            assert '/assets/user-audio/5000000000000001_' in a['audioUrl'] and a['audioUrl'].endswith('.mp3')

    @pytest.mark.parametrize('base', [NODE, PREVIEW])
    def test_seeded_play(self, seeded, base):
        for i, a in enumerate(seeded):
            size = check_play(base, fname(a['audioUrl']), f'seed{i}.mp3')
            assert size > 700_000

    def test_range_node_direct(self, seeded):
        f = fname(seeded[0]['audioUrl'])
        r = requests.get(f'{NODE}/api/assets/user-audio/{f}?v=2', headers={'Range': 'bytes=0-999'})
        assert r.status_code == 206 and len(r.content) == 1000
        assert r.headers.get('content-range', '').startswith('bytes 0-999/')

    def test_no_api_prefix_and_brand(self, seeded):
        f = fname(seeded[0]['audioUrl'])
        r = requests.get(f'{NODE}/assets/user-audio/{f}')
        assert r.status_code == 200 and r.headers['content-type'].startswith('audio/mpeg')
        r = requests.get(f'{NODE}/api/assets/brand/nomadly/logo.png')
        assert r.status_code == 200 and r.headers['content-type'].startswith('image/png')

    @pytest.mark.parametrize('base', [NODE, PREVIEW])
    def test_missing_404_plain(self, base):
        r = requests.get(f'{base}/api/assets/user-audio/zz_nope_{uuid.uuid4().hex}.mp3')
        assert r.status_code == 404, r.status_code
        assert 'text/plain' in r.headers['content-type'], r.headers['content-type']
        assert 'Audio not found' in r.text


# Uploads of various formats -> playable 50 s MP3
class TestUploads:
    @pytest.mark.parametrize('ext,mime', [('mp3', 'audio/mpeg'), ('wav', 'audio/wav'), ('m4a', 'audio/mp4'), ('ogg', 'audio/ogg')])
    def test_upload_and_play(self, alice, ext, mime):
        with open(f'{AUD}/t.{ext}', 'rb') as fh:
            r = alice.post(f'{PREVIEW}/api/cloudivr-web/audio/upload',
                           files={'file': (f'TEST_t.{ext}', fh, mime)}, data={'name': f'TEST_ {ext}'})
        assert r.status_code == 201, r.text[:300]
        a = r.json()['audio']
        CREATED.append(a['id'])
        assert a['mimeType'] == 'audio/mpeg' and a['name'] == f'TEST_ {ext}'
        check_play(NODE, fname(a['audioUrl']), f'up_{ext}.mp3')
        lst = alice.get(f'{PREVIEW}/api/cloudivr-web/audio').json()['audios']
        assert any(x['id'] == a['id'] for x in lst)

    def test_too_big(self, alice):
        with open(f'{AUD}/big.wav', 'rb') as fh:
            r = alice.post(f'{PREVIEW}/api/cloudivr-web/audio/upload', files={'file': ('TEST_big.wav', fh, 'audio/wav')}, data={'name': 'TEST_big'})
        assert r.status_code == 400, (r.status_code, r.text[:300])
        # multer limit fires before route check -> 'upload_failed' (message still "under 10 MB")
        assert r.json().get('error') in ('too_big', 'upload_failed'), r.text[:300]
        assert '10 MB' in r.json().get('message', '')

    def test_bad_type(self, alice):
        with open(f'{AUD}/t.txt', 'rb') as fh:
            r = alice.post(f'{PREVIEW}/api/cloudivr-web/audio/upload', files={'file': ('TEST_t.txt', fh, 'text/plain')}, data={'name': 'TEST_txt'})
        assert r.status_code == 400 and r.json().get('error') == 'bad_type', r.text[:300]

    def test_disk_loss_restore(self, alice):
        with open(f'{AUD}/t.mp3', 'rb') as fh:
            r = alice.post(f'{PREVIEW}/api/cloudivr-web/audio/upload', files={'file': ('TEST_restore.mp3', fh, 'audio/mpeg')}, data={'name': 'TEST_restore'})
        assert r.status_code == 201
        a = r.json()['audio']
        CREATED.append(a['id'])
        f = fname(a['audioUrl'])
        path = os.path.join(ASSET_DIR, f)
        assert os.path.exists(path)
        os.remove(path)
        check_play(NODE, f, 'restored.mp3')
        assert os.path.exists(path)

    def test_rename_and_delete(self, alice):
        with open(f'{AUD}/t.mp3', 'rb') as fh:
            r = alice.post(f'{PREVIEW}/api/cloudivr-web/audio/upload', files={'file': ('TEST_rd.mp3', fh, 'audio/mpeg')}, data={'name': 'TEST_rd'})
        aid = r.json()['audio']['id']
        r = alice.patch(f'{PREVIEW}/api/cloudivr-web/audio/{aid}', json={'name': 'TEST_rd2'})
        assert r.status_code == 200 and r.json()['name'] == 'TEST_rd2'
        r = alice.delete(f'{PREVIEW}/api/cloudivr-web/audio/{aid}')
        assert r.status_code == 200 and r.json()['deleted'] is True
        lst = alice.get(f'{PREVIEW}/api/cloudivr-web/audio').json()['audios']
        assert not any(x['id'] == aid for x in lst)


# Other /api routes unaffected by the rewrite
class TestRegression:
    @pytest.mark.parametrize('base', [NODE, PREVIEW])
    def test_routes(self, base):
        assert requests.get(f'{base}/api/health').status_code == 200
        assert requests.get(f'{base}/api/cloudivr-web/auth/me').status_code == 401
        s = requests.Session()
        assert s.post(f'{base}/api/cloudivr-web/auth/login', json=ALICE).status_code == 200
        r = s.get(f'{base}/api/cloudivr-web/audio')
        assert r.status_code == 200 and isinstance(r.json()['audios'], list)
        r = s.get(f'{base}/api/cloudivr-web/audio/voices')
        assert r.status_code == 200 and len(r.json()['voices']) > 0
