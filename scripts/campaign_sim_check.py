import time, datetime, requests
BASE = open('/app/frontend/.env').read().split('REACT_APP_BACKEND_URL=')[1].split()[0] + '/api/cloudivr-web'
s = requests.Session()
r = s.post(BASE + '/auth/login', json={'email': 'civr.alice@example.com', 'password': 'AliceTest#2026'}); print('login', r.status_code)
audio = s.get(BASE + '/audio').json()['audios'][0]['id']
NUM = '+13346972125'
LEADS = '+12025550123\n+12025550124\n+12025550125\n+12025550126\n+12025550127'
base = {'name': 'SIM now', 'callerId': NUM, 'audioId': audio, 'leads': LEADS, 'mode': 'report_only', 'concurrency': 3, 'tz': 'America/New_York'}

r = s.post(BASE + '/campaigns', json={**base, 'audioId': '', 'validateOnly': True, 'audioPending': True}); print('validateOnly ok:', r.status_code, r.json())
r = s.post(BASE + '/campaigns', json={**base, 'audioId': '', 'leads': '', 'validateOnly': True, 'audioPending': True}); print('validateOnly no leads ->', r.status_code, r.json().get('message'))
before = len(s.get(BASE + '/campaigns').json()['campaigns'])
print('validateOnly created nothing:', before == len(s.get(BASE + '/campaigns').json()['campaigns']))

c = s.post(BASE + '/campaigns', json=base).json()['campaign']; print('created', c['status'], c['dryRun'])
r = s.post(BASE + f"/campaigns/{c['id']}/start"); print('start', r.status_code, r.json().get('message'))
r = s.post(BASE + f"/campaigns/{c['id']}/start"); print('start again ->', r.status_code, r.json().get('message'))
time.sleep(3); d = s.get(BASE + f"/campaigns/{c['id']}").json()['campaign']; print('mid-run', d['status'], d['stats']['completed'], '/', d['stats']['total'])
time.sleep(8); d = s.get(BASE + f"/campaigns/{c['id']}").json()['campaign']
print('end', d['status'], {k: v for k, v in d['stats'].items() if v}, [l['status'] for l in d['leads']])

at = (datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(minutes=2, seconds=10)).isoformat()
sc = s.post(BASE + '/campaigns', json={**base, 'name': 'SIM scheduled daily', 'scheduledFor': at, 'repeat': 'daily'}).json()
print('scheduled create:', sc.get('campaign', {}).get('status'), sc.get('campaign', {}).get('scheduledFor'), sc.get('message'))
open('/tmp/sim_ids', 'w').write(c['id'] + '\n' + sc['campaign']['id'])
