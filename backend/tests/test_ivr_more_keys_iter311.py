# CloudIVR keypad menu expansion: devices/ai/ringgroup/fax/callback keys, mailbox boxes, sub-menu language, extensions, after-hours.
import os, json, pytest, requests

BASE = os.environ.get('REACT_APP_BACKEND_URL').rstrip('/') + '/api/cloudivr-web'
PHONE = '%2B13346970100'


@pytest.fixture(scope='module')
def s():
    ss = requests.Session()
    r = ss.post(f'{BASE}/auth/login', json={'email': 'civr.alice@example.com', 'password': 'AliceTest#2026'})
    if r.status_code != 200:
        pytest.skip('login failed')
    return ss


@pytest.fixture(scope='module', autouse=True)
def restore(s):
    orig = s.get(f'{BASE}/numbers/{PHONE}').json()['number']['features'].get('ivr')
    yield
    if orig:
        r = s.put(f'{BASE}/numbers/{PHONE}/ivr', json=orig)
        assert r.status_code == 200, r.text


def full_menu():
    return {
        'enabled': False, 'greeting': 'Press 1 for call back, 2 for Spanish, 3 billing. Dial an extension any time.', 'language': 'en',
        'options': {
            '1': {'action': 'callback', 'label': 'Callback', 'message': 'We will call you back.', 'auto': True, 'callbackTo': '+14155550100'},
            '2': {'action': 'submenu', 'label': 'Espanol', 'subMenu': {'language': 'es', 'greeting': 'Pulse 1 para ventas.', 'options': {
                '1': {'action': 'voicemail', 'label': 'Ventas', 'box': {'name': 'Ventas', 'email': ''}}}}},
            '3': {'action': 'voicemail', 'label': 'Billing', 'box': {'name': 'Billing', 'email': 'Billing@Example.com'}},
            '4': {'action': 'devices', 'label': 'Me', 'ringSecs': 30, 'noAnswer': 'message', 'noAnswerMessage': 'Sorry'},
        },
        'extensions': [{'code': '101', 'name': 'Anna', 'action': 'forward', 'forwardTo': '+14155550111'}],
        'afterHours': {'enabled': True, 'greeting': 'We are closed. Press 1.', 'options': {'1': {'action': 'message', 'message': 'Open 9 to 5.'}}},
    }


class TestSave:
    def test_save_roundtrip(self, s):
        r = s.put(f'{BASE}/numbers/{PHONE}/ivr', json=full_menu())
        assert r.status_code == 200, r.text
        iv = r.json()['ivr']
        assert iv['options']['1'] == {'action': 'callback', 'label': 'Callback', 'message': 'We will call you back.', 'auto': True, 'callbackTo': '+14155550100'}
        assert iv['options']['2']['subMenu']['language'] == 'es'
        assert iv['options']['2']['subMenu']['options']['1']['box']['name'] == 'Ventas'
        assert iv['options']['3']['box'] == {'name': 'Billing', 'email': 'billing@example.com', 'greeting': ''}
        assert iv['options']['4']['ringSecs'] == 30 and iv['options']['4']['noAnswer'] == 'message'
        assert iv['extensions'] == [{'code': '101', 'name': 'Anna', 'action': 'forward', 'forwardTo': '+14155550111'}]
        assert iv['afterHours']['enabled'] is True and iv['afterHours']['options']['1']['action'] == 'message'
        g = s.get(f'{BASE}/numbers/{PHONE}').json()['number']['features']['ivr']
        assert g['extensions'][0]['code'] == '101'
        assert g['afterHours']['greeting'] == 'We are closed. Press 1.'
        assert g['options']['2']['subMenu']['language'] == 'es'

    def test_callback_not_auto_clears_phone(self, s):
        m = full_menu(); m['options']['1'] = {'action': 'callback', 'auto': False, 'callbackTo': '+14155550100'}
        r = s.put(f'{BASE}/numbers/{PHONE}/ivr', json=m)
        assert r.status_code == 200 and r.json()['ivr']['options']['1']['callbackTo'] == ''

    @pytest.mark.parametrize('mut,needle', [
        (lambda m: m.update(extensions=[{'code': '1', 'name': 'x', 'forwardTo': '+14155550111'}]), '2 to 5 digits'),
        (lambda m: m.update(extensions=[{'code': '101', 'forwardTo': '+14155550111'}, {'code': '101', 'forwardTo': '+14155550112'}]), 'same code'),
        (lambda m: m['options'].update({'5': {'action': 'ai', 'agentId': 'nonexistent-agent-123'}}), 'AI agent'),
        (lambda m: m['options'].update({'5': {'action': 'ai'}}), 'pick the AI agent'),
        (lambda m: m['options'].update({'5': {'action': 'fax', 'faxFrom': '+14155550199', 'fileId': 'a' * 24}}), 'fax number'),
        (lambda m: m['options'].update({'5': {'action': 'fax'}}), 'fax number'),
        (lambda m: m['options'].update({'5': {'action': 'ringgroup'}}), 'Ring group'),
        (lambda m: m['options'].update({'5': {'action': 'callback', 'auto': True, 'callbackTo': '12'}}), 'country code'),
        (lambda m: m['options']['3'].update(box={'name': 'B', 'email': 'notanemail'}), 'email'),
        (lambda m: m['afterHours'].update(options={}), 'After-hours'),
    ])
    def test_invalid_refused(self, s, mut, needle):
        m = full_menu(); mut(m)
        r = s.put(f'{BASE}/numbers/{PHONE}/ivr', json=m)
        assert r.status_code == 400, r.text
        assert needle.lower() in r.json().get('message', json.dumps(r.json())).lower(), r.text


class TestValidateBlueprint:
    CTX = {'sipLogin': False, 'ringGroupMembers': 0, 'faxNumbers': [], 'aiAgents': []}
    IVR = {'greeting': 'Press 1 2 3 4 5', 'options': {'1': {'action': 'devices'}, '2': {'action': 'ringgroup'}, '3': {'action': 'fax'}, '4': {'action': 'ai'}, '5': {'action': 'callback', 'auto': True}},
           'extensions': [{'code': '1', 'forwardTo': '+14155550111'}], 'afterHours': {'enabled': True, 'greeting': 'closed', 'options': {'1': {'action': 'message', 'message': 'hi'}}}}

    def test_validate(self, s):
        r = s.post(f'{BASE}/ivr/validate', json={'ivr': self.IVR, 'context': self.CTX})
        assert r.status_code == 200, r.text
        d = r.json(); msgs = ' | '.join(f"{i['where']}: {i['message']}" for i in d['issues'] if i['level'] == 'error')
        assert d['ok'] is False
        for n in ['Phone apps tab', 'Ring group tab', 'get one on the Fax page', 'Upload the document', 'Create an AI agent', 'Add your phone', '2 to 5 digits']:
            assert n in msgs, f'{n} not in {msgs}'

    def test_blueprint(self, s):
        r = s.post(f'{BASE}/ivr/blueprint', json={'ivr': self.IVR, 'context': self.CTX})
        assert r.status_code == 200, r.text
        types = [n['type'] for n in r.json()['nodes']]
        labels = [n['label'] for n in r.json()['nodes']]
        for t in ['devices', 'ringgroup', 'fax', 'ai', 'callback', 'extensions']:
            assert t in types
        assert 'After-hours greeting' in labels


class TestFaxDoc:
    def test_upload_pdf(self, s):
        pdf = b'%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF'
        r = s.post(f'{BASE}/fax/ivr-doc', files={'file': ('TEST_price.pdf', pdf, 'application/pdf')})
        print(r.status_code, r.text[:300])
        assert r.status_code == 200, r.text
        d = r.json()
        assert d['docName'] == 'TEST_price.pdf'
        assert 'fileId' in d and len(d['fileId']) == 24
        assert d.get('pages', 0) >= 1

    def test_upload_none(self, s):
        r = s.post(f'{BASE}/fax/ivr-doc')
        assert r.status_code == 400
