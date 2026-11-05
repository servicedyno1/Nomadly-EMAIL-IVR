# iter222: GET /caller-ids (manager list) is ordered most-recently-used first, same as /caller-ids/presets
import os, time, requests, pytest
from dotenv import dotenv_values

BASE_URL = (os.environ.get('REACT_APP_BACKEND_URL') or dotenv_values('/app/frontend/.env')['REACT_APP_BACKEND_URL']).rstrip('/')
API = f"{BASE_URL}/api/cloudivr-web"


@pytest.fixture(scope='module')
def alice():
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": "civr.alice@example.com", "password": "AliceTest#2026"})
    if r.status_code != 200:
        pytest.skip('alice login failed')
    return s


def verified(items):
    return [i['number'] for i in items if i.get('status') == 'verified']


# Manager list order == presets order (both last-used first)
class TestManagerOrder:
    def test_list_matches_presets(self, alice):
        lst = verified(alice.get(f"{API}/caller-ids").json()['items'])
        pre = [i['number'] for i in alice.get(f"{API}/caller-ids/presets").json()['items']]
        assert lst[:len(pre)] == pre[:len(lst)], (lst, pre)

    def test_use_moves_to_front_of_list(self, alice):
        lst = verified(alice.get(f"{API}/caller-ids").json()['items'])
        assert len(lst) >= 2
        last = lst[-1]
        r = alice.post(f"{API}/calls/callback", json={"from": "+13346972125", "callerId": "+13346972125", "myPhone": "+14155553001", "to": "+14155553002", "showAs": last})
        assert r.status_code in (200, 202), r.text[:300]
        time.sleep(1)
        lst2 = verified(alice.get(f"{API}/caller-ids").json()['items'])
        assert lst2[0] == last, lst2
        pre = [i['number'] for i in alice.get(f"{API}/caller-ids/presets").json()['items']]
        assert pre[0] == last
