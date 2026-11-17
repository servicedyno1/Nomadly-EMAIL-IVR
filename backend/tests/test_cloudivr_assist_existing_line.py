# CloudIVR assist: an already-saved sms key with a chosen line should not be re-flagged when only the greeting changes
import os, pytest, requests

BASE = os.environ.get('REACT_APP_BACKEND_URL').rstrip('/') + '/api/cloudivr-web'
LINES = [{'id': 'mn_ab01', 'phone': '+12025550111'}, {'id': 'mn_cd02', 'phone': '+12025550122'}]
CUR = {'greeting': 'Thanks for calling Bella Bakery. Press 1 for our menu by text.',
       'options': [{'digit': '1', 'action': 'sms', 'label': 'Menu', 'smsText': 'Our menu: bella.example/menu', 'message': 'We sent you a text.', 'after': 'hangup', 'smsFrom': 'mn_cd02'}]}


def test_existing_line_not_reflagged():
    s = requests.Session()
    assert s.post(f'{BASE}/auth/login', json={'email': 'civr.alice@example.com', 'password': 'AliceTest#2026'}).status_code == 200
    d = None
    for _ in range(3):
        r = s.post(f'{BASE}/assist/ivr', json={'messages': [{'role': 'user', 'content': 'Only change the greeting to start with "Welcome to Bella Bakery". Keep key 1 as is. Fill it in now.'}],
                                               'current': CUR, 'context': {'textingNumbers': LINES}}, timeout=60)
        if r.status_code == 200 and r.json()['patch']:
            d = r.json(); break
    assert d, 'no proposal'
    print(d['missing'], d['patch'])
    assert not any('which Texting Number' in m for m in d['missing']), d['missing']
