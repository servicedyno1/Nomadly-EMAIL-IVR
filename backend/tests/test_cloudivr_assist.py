# CloudIVR setup assistant (/assist/:screen) + IVR sms rotation (smsTexts/smsFrom) API tests
import os, json, copy, pytest, requests

BASE = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/') + '/api/cloudivr-web'
NUM = '%2B13346970100'
SCREENS = ['quick', 'campaign', 'ivr', 'hours', 'voicemail', 'forwarding', 'ringgroup', 'textback', 'triggers']
PROMPTS = {
    'quick': 'Call +14155550123 and collect a 6 digit code for Acme Gym, connect them to +14155550100 after I accept. Propose the setup now please.',
    'campaign': 'Campaign "TEST_spring" for my gym: say spring sale 20% off, press 1 to talk to us at +14155550100. Propose now.',
    'ivr': 'Bella Bakery. key 1 forwards to 4155550100, key 3 voicemail. Propose the setup now.',
    'hours': 'Open 9 to 5 weekdays, 10 to 2 Saturday, closed Sunday, Chicago time zone, voicemail when closed. Propose now.',
    'voicemail': 'Greeting: You reached Bella Bakery, leave a message. Ring 25 seconds. Propose now.',
    'forwarding': 'Forward all calls always to 4155550100, ring 20 seconds. Propose now.',
    'ringgroup': 'Ring 4155550100 and 4155550101 together for 20 seconds then voicemail. Propose now.',
    'textback': 'Missed call text: Sorry we missed you at Bella Bakery, we will call back soon. Propose now.',
    'triggers': 'When someone texts the word quote, call them and say thanks, we will send a quote shortly. Propose now.',
}


@pytest.fixture(scope='module')
def s():
    ses = requests.Session()
    r = ses.post(f'{BASE}/auth/login', json={'email': 'civr.alice@example.com', 'password': 'AliceTest#2026'})
    if r.status_code != 200:
        pytest.skip('login failed')
    return ses


@pytest.fixture(scope='module')
def orig_ivr(s):
    j = s.get(f'{BASE}/numbers/{NUM}').json()
    ivr = j.get('number', j).get('features', {}).get('ivr')
    yield copy.deepcopy(ivr)
    if ivr:
        ivr['enabled'] = False
        s.put(f'{BASE}/numbers/{NUM}/ivr', json=ivr)


# Assist: validation
def test_unauth():
    r = requests.post(f'{BASE}/assist/ivr', json={'messages': [{'role': 'user', 'content': 'hi'}]})
    assert r.status_code == 401


def test_unknown_screen(s):
    r = s.post(f'{BASE}/assist/nope', json={'messages': [{'role': 'user', 'content': 'hi'}]})
    assert r.status_code == 404 and r.json()['error'] == 'unknown_screen'


def test_empty_messages(s):
    for body in ({'messages': []}, {}, {'messages': [{'role': 'user', 'content': '  '}]}, {'messages': [{'role': 'assistant', 'content': 'hi'}]}):
        r = s.post(f'{BASE}/assist/ivr', json=body)
        assert r.status_code == 400 and r.json()['error'] == 'no_message', body


# Assist: each screen returns the shape and a sanitized patch
@pytest.mark.parametrize('screen', SCREENS)
def test_assist_screen(s, screen):
    r = s.post(f'{BASE}/assist/{screen}', json={'messages': [{'role': 'user', 'content': PROMPTS[screen]}], 'current': {},
                                                'context': {'textingNumbers': [{'id': 'mn_ab01', 'phone': '+12025550111'}], 'voicemailAvailable': True}}, timeout=60)
    assert r.status_code == 200, r.text
    d = r.json()
    for k in ('reply', 'summary', 'missing', 'patch'):
        assert k in d
    assert isinstance(d['reply'], str) and d['reply']
    p = d['patch']
    print(screen, json.dumps(d)[:700])
    import re
    e164 = re.compile(r'^\+\d{8,15}$')
    for k in ('transferTo', 'forwardTo', 'fallbackTo', 'transferNumber', 'myPhone'):
        if p.get(k):
            assert e164.match(p[k]), (k, p[k])
    for k in ('members',):
        for ph in p.get(k, []):
            assert e164.match(ph)
    if 'ringTimeout' in p:
        assert 10 <= p['ringTimeout'] <= 60


def test_patch_sanitized_clamped(s):
    # Ask LLM to propose silly values; patch must be clamped/filtered
    r = s.post(f'{BASE}/assist/forwarding', json={'messages': [{'role': 'user', 'content': 'Set forwarding mode always to (415) 555-0100 and ring timeout 500 seconds, exactly that. Propose straight away, I confirm values.'}]}, timeout=60)
    assert r.status_code == 200
    p = r.json()['patch']
    print(p)
    allowed = {'mode', 'forwardTo', 'ringTimeout', 'backups', 'holdMusic', 'showCallerId'}
    assert set(p) <= allowed
    if 'ringTimeout' in p:
        assert p['ringTimeout'] <= 60
    if 'forwardTo' in p:
        assert p['forwardTo'] == '+14155550100'


# IVR sms rotation persistence
def test_ivr_sms_rotation_persist(s, orig_ivr):
    body = {'enabled': False, 'greetingType': 'text', 'greeting': 'TEST Press 1 for a text.', 'language': 'en',
            'options': {'1': {'action': 'sms', 'smsFrom': 'mn_ab01', 'smsTexts': ['TEST A bella.com/menu', 'TEST B bella.com/today', 'TEST C'], 'after': 'hangup', 'label': 'Menu'}}}
    r = s.put(f'{BASE}/numbers/{NUM}/ivr', json=body)
    assert r.status_code == 200, r.text
    j = s.get(f'{BASE}/numbers/{NUM}').json()
    o = j.get('number', j)['features']['ivr']['options']['1']
    assert o['smsFrom'] == 'mn_ab01'
    assert o['smsTexts'] == ['TEST A bella.com/menu', 'TEST B bella.com/today', 'TEST C']
    assert o['smsText'] == 'TEST A bella.com/menu'


def test_ivr_sms_max5(s, orig_ivr):
    body = {'enabled': False, 'greetingType': 'text', 'greeting': 'Press 1.', 'language': 'en',
            'options': {'1': {'action': 'sms', 'smsFrom': 'mn_ab01', 'smsTexts': [f'v{i}' for i in range(7)], 'label': 'x'}}}
    r = s.put(f'{BASE}/numbers/{NUM}/ivr', json=body)
    assert r.status_code in (200, 400)
    if r.status_code == 200:
        assert len(r.json()['ivr']['options']['1'].get('smsTexts', [])) <= 5


def test_ivr_sms_foreign_from_rejected(s, orig_ivr):
    body = {'enabled': False, 'greetingType': 'text', 'greeting': 'Press 1.', 'language': 'en',
            'options': {'1': {'action': 'sms', 'smsFrom': 'mn_deadbeef99', 'smsTexts': ['a', 'b'], 'label': 'x'}}}
    r = s.put(f'{BASE}/numbers/{NUM}/ivr', json=body)
    assert r.status_code == 400 and r.json().get('error') == 'invalid_ivr'
    body['options']['1']['smsFrom'] = 'bad id'
    assert s.put(f'{BASE}/numbers/{NUM}/ivr', json=body).status_code == 400
