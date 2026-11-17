# CloudIVR setup assistant — retest of iteration_301 fixes (texting-line gap, empty/null sanitizer, fallback summary)
import os, json, subprocess, pytest, requests

BASE = os.environ.get('REACT_APP_BACKEND_URL').rstrip('/') + '/api/cloudivr-web'
LINES = [{'id': 'mn_ab01', 'phone': '+12025550111'}, {'id': 'mn_cd02', 'phone': '+12025550122'}]
CTX = {'textingNumbers': LINES, 'voicemailAvailable': True}


@pytest.fixture(scope='module')
def s():
    ses = requests.Session()
    r = ses.post(f'{BASE}/auth/login', json={'email': 'civr.alice@example.com', 'password': 'AliceTest#2026'})
    if r.status_code != 200:
        pytest.skip('login failed')
    return ses


def ask(s, screen, msg, ctx=None, tries=3, need=lambda d: bool(d['patch'])):
    d = None
    for _ in range(tries):
        r = s.post(f'{BASE}/assist/{screen}', json={'messages': [{'role': 'user', 'content': msg}], 'current': {}, 'context': ctx}, timeout=60)
        if r.status_code == 503:
            continue
        assert r.status_code == 200, r.text
        d = r.json()
        if need(d):
            return d
    return d


def sms_keys(d):
    return [o for o in d['patch'].get('options', []) if o.get('action') == 'sms']


# Texting line gap: 2 lines, user doesn't name one -> missing asks which line
def test_ivr_two_lines_unnamed_flags_missing(s):
    d = ask(s, 'ivr', 'Bella Bakery. Key 1: send the caller a text with our menu link bella.example/menu, then hang up. Key 2 forwards to 4155550100. Fill it in now, no more questions.', CTX, need=lambda d: bool(sms_keys(d)))
    assert d and sms_keys(d), f'no sms key proposed: {d}'
    print('missing:', d['missing'], 'smsFrom:', [o.get('smsFrom') for o in sms_keys(d)])
    assert any('which Texting Number' in m and '+12025550111' in m and '+12025550122' in m for m in d['missing']), d['missing']


# Texting line gap: user names the line ending 0122 -> no 'which Texting Number' item
def test_ivr_two_lines_named_no_missing(s):
    d = ask(s, 'ivr', 'Bella Bakery. Key 1: send the caller a text with our menu link bella.example/menu, then hang up. Send from the one ending 0122. Key 2 forwards to 4155550100. Fill it in now, no more questions.', CTX,
            need=lambda d: bool(sms_keys(d)) and all(o.get('smsFrom') == 'mn_cd02' for o in sms_keys(d)))
    assert d and sms_keys(d), d
    print('missing:', d['missing'], 'smsFrom:', [o.get('smsFrom') for o in sms_keys(d)])
    assert all(o.get('smsFrom') == 'mn_cd02' for o in sms_keys(d))
    assert not any('which Texting Number' in m for m in d['missing']), d['missing']


# Sanitizer unit checks via node (empty/null ignored, not coerced)
def node(js):
    out = subprocess.run(['node', '-e', js], capture_output=True, text=True, cwd='/app', timeout=30)
    assert out.returncode == 0, out.stderr
    return json.loads(out.stdout.strip().splitlines()[-1])


def test_clean_forwarding_empty_null():
    r = node("const a=require('/app/js/cloudivr-web/assist.js');console.log(JSON.stringify(a.clean(a.SCREENS.forwarding,{ringTimeout:'',holdMusic:null,mode:'always'})))")
    assert r == {'mode': 'always'}


def test_clean_other_empty_values():
    r = node("const a=require('/app/js/cloudivr-web/assist.js');const S=a.SCREENS;console.log(JSON.stringify([a.clean(S.voicemail,{ringTimeout:null}),a.clean(S.ringgroup,{ringTimeout:''}),a.clean(S.quick,{holdMusic:undefined}),a.clean(S.forwarding,{holdMusic:false,showCallerId:'true',ringTimeout:'25'}),a.clean(S.campaign,{concurrency:'',holdMusic:null})]))")
    assert r[0] == {} and r[1] == {} and r[2] == {} and r[4] == {}
    assert r[3] == {'holdMusic': False, 'showCallerId': True, 'ringTimeout': 25}


# Fallback summary: summaryOf (not exported) checked via vm on file source
def test_summary_fallback_unit():
    js = r"""
const fs=require('fs'),vm=require('vm');const src=fs.readFileSync('/app/js/cloudivr-web/assist.js','utf8').replace(/module\.exports[\s\S]*$/,'')+';globalThis.__s=summaryOf;';
const ctx={require,console,process,globalThis:{}};ctx.globalThis=ctx;vm.createContext(ctx);vm.runInContext(src,ctx);
const f=ctx.__s;console.log(JSON.stringify([f([],{mode:'always',ringTimeout:20,holdMusic:true}),f([],{options:[{digit:'1',action:'message',message:'hi'}]}),f([],{members:['+14155550100']}),f([],{days:{mon:{on:true}}})]))"""
    r = node(js)
    print(r)
    assert r[0] == ['mode: always', 'ringTimeout: 20', 'holdMusic: on']
    # object/array-only patches (ivr options, ringgroup members, hours days) should still get a summary
    assert r[1] and r[2] and r[3], f'object-only patches give empty summary: {r[1:]}'


# Fallback summary live: every non-empty patch has a non-empty summary
@pytest.mark.parametrize('screen,msg', [
    ('hours', 'Open 9 to 5 weekdays, closed weekends, Chicago time. Fill it in now.'),
    ('forwarding', 'Forward always to 4155550100. Fill it in now.'),
    ('ringgroup', 'Ring 4155550100 and 4155550101 together, then voicemail. Fill it in now.'),
])
def test_live_summary_nonempty(s, screen, msg):
    d = ask(s, screen, msg, {'voicemailAvailable': True})
    assert d and d['patch'], d
    assert isinstance(d['summary'], list) and len(d['summary']) > 0, d
