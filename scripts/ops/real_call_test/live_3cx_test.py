"""LIVE test of Ring groups + Text Triggers on https://cloudivr.net with real Telnyx calls.
Two temporary Telnyx lines (A, B) sit on a temporary Call Control app whose webhooks go to a webhook.site bin, so this
script can see them ring and answer / press keys through the Telnyx API.
Usage: python3 live_3cx_test.py setup | ring_answer | ring_noanswer | callback | message | cleanup
State → run/state.json, report → /app/test_reports/live_3cx_test_2026-10-25.json
"""
import json, os, re, sys, time, urllib.request, urllib.error

HERE = os.path.dirname(os.path.abspath(__file__))
STATE = f'{HERE}/run/state.json'
REPORT = '/app/test_reports/live_3cx_test_2026-10-25.json'
SITE = 'https://cloudivr.net/cloudivr-web'
TEST_NUM = '+19379800767'
ENV = dict(re.findall(r'^([A-Z0-9_]+)="?([^"\n]*)"?$', open('/app/backend/.env').read(), re.M))
KEY, APP, ANI, MSG = ENV['TELNYX_API_KEY'], ENV['TELNYX_CALL_CONTROL_APP_ID'], ENV['TELNYX_DEFAULT_ANI'], ENV['TELNYX_MESSAGING_PROFILE_ID']
EMAIL, PASSWORD, CHAT_ID = open(f'{HERE}/.acct').read().split()


def load(path, default):
    return json.load(open(path)) if os.path.exists(path) else default


state = load(STATE, {})
report = load(REPORT, {'tests': {}})


def save():
    os.makedirs(f'{HERE}/run', exist_ok=True)
    json.dump(state, open(STATE, 'w'), indent=1)
    json.dump(report, open(REPORT, 'w'), indent=1, default=str)


def http(method, url, body=None, headers=None, cookie=None):
    h = {'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0 (civr-live-test)', **(headers or {})}
    if cookie:
        h['Cookie'] = cookie
    req = urllib.request.Request(url, method=method, data=json.dumps(body).encode() if body is not None else None, headers=h)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            raw = r.read()
            return r.status, json.loads(raw or b'{}'), r.headers
    except urllib.error.HTTPError as e:
        raw = e.read().decode()[:400]
        try:
            return e.code, json.loads(raw), e.headers
        except Exception:
            return e.code, {'raw': raw}, e.headers


def tx(method, path, body=None):
    return http(method, f'https://api.telnyx.com/v2{path}', body, {'Authorization': f'Bearer {KEY}'})[1]


def log(*a):
    print(time.strftime('%H:%M:%S'), *a, flush=True)


# ---------- web account (cloudivr.net) ----------
def web_login():
    st, body, hdrs = http('POST', f'{SITE}/auth/login', {'email': EMAIL, 'password': PASSWORD}, {'Origin': 'https://cloudivr.net'})
    cookies = [c.split(';')[0] for c in hdrs.get_all('Set-Cookie') or []]
    assert st == 200, body
    return '; '.join(cookies)


def web(method, path, body=None, cookie=None):
    return http(method, f'{SITE}{path}', body, {'Origin': 'https://cloudivr.net'}, cookie)


# ---------- webhook.site sink ----------
def new_bin():
    st, d, _ = http('POST', 'https://webhook.site/token', {}, {'Accept': 'application/json'})
    return d['uuid']


def bin_events(uuid):
    st, d, _ = http('GET', f'https://webhook.site/token/{uuid}/requests?sorting=oldest&per_page=100', None, {'Accept': 'application/json'})
    out = []
    for r in d.get('data', []):
        try:
            ev = json.loads(r.get('content') or '{}').get('data', {})
            out.append({'type': ev.get('event_type'), **(ev.get('payload') or {})})
        except Exception:
            pass
    return out


def wait_leg(to, since_ids, secs, kind='call.initiated'):
    """First new inbound call.initiated to `to` on the temp app → payload."""
    end = time.time() + secs
    while time.time() < end:
        for e in bin_events(state['bin']):
            if e['type'] == kind and e.get('to') == to and e.get('call_control_id') not in since_ids:
                return e
        time.sleep(1.5)
    return None


def seen_ids():
    return {e.get('call_control_id') for e in bin_events(state['bin'])}


def alive(ccid):
    return tx('GET', f'/calls/{ccid}').get('data', {}).get('is_alive')


def answer(ccid):
    return tx('POST', f'/calls/{ccid}/actions/answer', {})


def hang(ccid):
    if ccid and alive(ccid):
        tx('POST', f'/calls/{ccid}/actions/hangup', {})


def dial_test_number():
    r = tx('POST', '/calls', {'connection_id': APP, 'to': TEST_NUM, 'from': ANI, 'webhook_url': 'https://httpbin.org/post', 'timeout_secs': 60})
    return r.get('data', {}).get('call_control_id'), r


def calls_log(cookie):
    st, d, _ = web('GET', f'/numbers/{urllib.parse.quote(TEST_NUM)}/logs', None, cookie)
    return d


# ---------- commands ----------
def setup():
    if state.get('A'):
        log('already set up', state)
        return
    state['bin'] = new_bin()
    hook = f"https://webhook.site/{state['bin']}"
    app = tx('POST', '/call_control_applications', {'application_name': 'CIVR live test (temp)', 'webhook_event_url': hook, 'webhook_api_version': '2'})
    state['app'] = app['data']['id']
    log('temp app', state['app'], hook)
    q = 'filter[country_code]=US&filter[phone_number_type]=local&filter[features][]=voice&filter[features][]=sms&filter[limit]=10'
    found = tx('GET', f'/available_phone_numbers?{q}')['data']
    picks = [n['phone_number'] for n in found if n['cost_information']['monthly_cost'].startswith('1.')][:2]
    order = tx('POST', '/number_orders', {'phone_numbers': [{'phone_number': p} for p in picks], 'connection_id': state['app'], 'messaging_profile_id': MSG})
    oid = order['data']['id']
    for _ in range(30):
        o = tx('GET', f'/number_orders/{oid}')['data']
        if o['status'] in ('success', 'failure'):
            break
        time.sleep(3)
    log('order', o['status'], picks)
    assert o['status'] == 'success', o
    state['A'], state['B'] = picks
    state['ids'] = {}
    for p in picks:
        for _ in range(10):
            pn = tx('GET', f'/phone_numbers?filter[phone_number]={urllib.parse.quote(p)}').get('data') or []
            if pn:
                state['ids'][p] = pn[0]['id']
                break
            time.sleep(3)
    save()
    log('state', state)


def set_ring_group(cookie, enabled, timeout=20):
    body = {'enabled': enabled, 'members': [state['A'], state['B']], 'ringTimeout': timeout, 'fallback': 'message',
            'message': 'Sorry, nobody could take your call. This is the ring group fallback message.'}
    st, d, _ = web('PUT', f'/numbers/{urllib.parse.quote(TEST_NUM)}/ring-group', body, cookie)
    log('ring-group PUT', st, json.dumps(d)[:300])
    return st, d


def ring_answer():
    cookie = web_login()
    set_ring_group(cookie, True)
    before = seen_ids()
    caller, r = dial_test_number()
    log('caller leg', caller, r.get('error'))
    res = {'caller': caller}
    t0 = time.time()
    a = wait_leg(state['A'], before, 40)
    b = wait_leg(state['B'], before, 10)
    res['A_rang_after_s'] = a and round(time.time() - t0, 1)
    res['A_from'] = a and a.get('from')
    res['B_rang'] = bool(b)
    log('A rang', bool(a), 'B rang', bool(b), 'caller id shown', a and a.get('from'))
    if a:
        time.sleep(3)
        answer(a['call_control_id'])
        time.sleep(6)
        res['A_alive'] = alive(a['call_control_id'])
        res['B_alive_after_A_answered'] = b and alive(b['call_control_id'])
        res['caller_alive'] = alive(caller)
        evs = [e for e in bin_events(state['bin']) if e.get('call_control_id') == (b or {}).get('call_control_id')]
        res['B_events'] = [e['type'] for e in evs]
        res['B_hangup_cause'] = next((e.get('hangup_cause') for e in evs if e['type'] == 'call.hangup'), None)
        log('A alive', res['A_alive'], 'B alive', res['B_alive_after_A_answered'], 'caller alive', res['caller_alive'], res['B_events'])
        time.sleep(4)
        hang(a['call_control_id'])
    time.sleep(3)
    res['caller_alive_after_A_hangup'] = alive(caller)
    hang(caller)
    time.sleep(5)
    res['log_top'] = top_logs(cookie)
    res['pass'] = bool(a and b and res.get('A_alive') and res.get('caller_alive') and not res.get('B_alive_after_A_answered'))
    report['tests']['ring_group_first_answer_wins'] = res
    save()
    log('RESULT', json.dumps(res)[:800])


def ring_noanswer():
    cookie = web_login()
    set_ring_group(cookie, True, 15)
    before = seen_ids()
    caller, r = dial_test_number()
    res = {'caller': caller}
    a = wait_leg(state['A'], before, 40)
    b = wait_leg(state['B'], before, 10)
    res['A_rang'], res['B_rang'] = bool(a), bool(b)
    t0 = time.time()
    while time.time() - t0 < 40 and ((a and alive(a['call_control_id'])) or (b and alive(b['call_control_id']))):
        time.sleep(2)
    res['legs_stopped_after_s'] = round(time.time() - t0, 1)
    res['caller_alive_during_fallback'] = alive(caller)
    time.sleep(12)
    res['caller_alive_after_fallback_s12'] = alive(caller)
    hang(caller)
    time.sleep(6)
    res['log_top'] = top_logs(cookie)
    st, mc, _ = web('GET', '/missed-calls', None, cookie)
    res['missed_calls_top'] = json.dumps(mc)[:400]
    set_ring_group(cookie, False)
    res['pass'] = bool(a and b and res['caller_alive_during_fallback'] is not None)
    report['tests']['ring_group_no_answer_fallback'] = res
    save()
    log('RESULT', json.dumps(res)[:900])


def top_logs(cookie):
    st, d, _ = web('GET', f'/numbers/{urllib.parse.quote(TEST_NUM)}/logs', None, cookie)
    items = d.get('logs') or d.get('items') or (d if isinstance(d, list) else [])
    return json.dumps(items[:2], default=str)[:700] if items else json.dumps(d)[:300]


def set_triggers(cookie, action, enabled=True, message=None):
    rule = {'id': f'live-{action}-01', 'enabled': True, 'action': action, 'keywordOnly': False, 'keywords': [], 'businessHoursOnly': False, 'oncePerHour': False}
    if message:
        rule['message'] = message
    body = {'enabled': enabled, 'myPhone': state['A'], 'rules': [rule]}
    st, d, _ = web('PUT', f'/numbers/{urllib.parse.quote(TEST_NUM)}/text-triggers', body, cookie)
    log('text-triggers PUT', st, json.dumps(d)[:300])
    return st


def send_text(text):
    """Real SMS from line B to the test number → result of the Telnyx send."""
    r = tx('POST', '/messages', {'from': state['B'], 'to': TEST_NUM, 'text': text, 'messaging_profile_id': MSG})
    log('SMS send', json.dumps(r)[:300])
    return r


def runs(cookie):
    st, d, _ = web('GET', f'/numbers/{urllib.parse.quote(TEST_NUM)}/text-triggers', None, cookie)
    return d.get('runs') or []


def callback():
    cookie = web_login()
    set_triggers(cookie, 'callback')
    before = seen_ids()
    st, w0, _ = web('GET', '/wallet', None, cookie)
    res = {'wallet_before': w0.get('balance')}
    sms = send_text('Hi, live test of Auto Callback, please call me back')
    res['sms'] = sms.get('data', {}).get('id') or sms.get('errors')
    a = wait_leg(state['A'], before, 60)
    res['owner_phone_rang'] = bool(a)
    res['owner_call_from'] = a and a.get('from')
    log('owner (A) rang', bool(a), a and a.get('from'))
    if a:
        answer(a['call_control_id'])
        b = None
        for wait in (7, 6, 6):
            time.sleep(wait)
            tx('POST', f"/calls/{a['call_control_id']}/actions/send_dtmf", {'digits': '1'})
            log('pressed 1')
            b = wait_leg(state['B'], before, 12)
            if b:
                break
        res['texter_rang_after_press_1'] = bool(b)
        res['texter_call_from'] = b and b.get('from')
        if b:
            time.sleep(2)
            answer(b['call_control_id'])
            time.sleep(6)
            res['owner_alive'] = alive(a['call_control_id'])
            res['texter_alive'] = alive(b['call_control_id'])
            evs = [e['type'] for e in bin_events(state['bin']) if e.get('call_control_id') in (a['call_control_id'], b['call_control_id'])]
            res['events'] = evs
            res['bridged'] = 'call.bridged' in evs
            time.sleep(4)
            hang(b['call_control_id'])
        time.sleep(3)
        hang(a['call_control_id'])
    time.sleep(8)
    res['runs_top'] = runs(cookie)[:2]
    st, w1, _ = web('GET', '/wallet', None, cookie)
    res['wallet_after'] = w1.get('balance')
    set_triggers(cookie, 'callback', enabled=False)
    res['pass'] = bool(a and res.get('texter_rang_after_press_1') and res.get('owner_alive') and res.get('texter_alive'))
    report['tests']['text_trigger_auto_callback'] = res
    save()
    log('RESULT', json.dumps(res, default=str)[:1200])


def message():
    cookie = web_login()
    set_triggers(cookie, 'message', message='Thanks for your text. This is the CloudIVR text to call message test.')
    before = seen_ids()
    sms = send_text('Hello, live test of the text to call message')
    res = {'sms': sms.get('data', {}).get('id') or sms.get('errors')}
    b = wait_leg(state['B'], before, 60)
    res['texter_rang'] = bool(b)
    res['call_from'] = b and b.get('from')
    if b:
        answer(b['call_control_id'])
        time.sleep(15)
        evs = [e for e in bin_events(state['bin']) if e.get('call_control_id') == b['call_control_id']]
        res['events'] = [e['type'] for e in evs]
        res['hangup_cause'] = next((e.get('hangup_cause') for e in evs if e['type'] == 'call.hangup'), None)
        hang(b['call_control_id'])
    time.sleep(6)
    res['runs_top'] = runs(cookie)[:1]
    set_triggers(cookie, 'message', enabled=False, message='Thanks for your text.')
    res['pass'] = bool(b)
    report['tests']['text_trigger_text_to_call_message'] = res
    save()
    log('RESULT', json.dumps(res, default=str)[:900])


def cleanup():
    cookie = web_login()
    set_ring_group(cookie, False)
    web('PUT', f'/numbers/{urllib.parse.quote(TEST_NUM)}/text-triggers', {'enabled': False, 'myPhone': None, 'rules': []}, cookie)
    for p, pid in (state.get('ids') or {}).items():
        log('release', p, json.dumps(tx('DELETE', f'/phone_numbers/{pid}'))[:160])
    time.sleep(5)
    if state.get('app'):
        log('delete app', json.dumps(tx('DELETE', f"/call_control_applications/{state['app']}"))[:160])
    report['cleanup'] = {'at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), 'released': list((state.get('ids') or {}).keys()), 'app': state.get('app')}
    save()


if __name__ == '__main__':
    import urllib.parse
    {'setup': setup, 'ring_answer': ring_answer, 'ring_noanswer': ring_noanswer, 'callback': callback, 'message': message, 'cleanup': cleanup}[sys.argv[1]]()
