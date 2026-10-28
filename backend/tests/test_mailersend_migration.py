# MailerSend migration regression: node mailer suites, DNS dry run, health, CloudIVR login
import os, subprocess, requests

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL') or open('/app/frontend/.env').read().split('REACT_APP_BACKEND_URL=')[1].split()[0]
BASE_URL = BASE_URL.rstrip('/')


def run(cmd):
    return subprocess.run(cmd, shell=True, cwd='/app', capture_output=True, text=True, timeout=120)


def test_mailer_unit_suite():
    r = run('node js/tests/test_mailer_2026-10.js')
    assert 'RESULT pass=16 fail=0' in r.stdout


def test_mailer_live_nosend():
    r = run('node js/tests/t1_mailer_live_nosend.js')
    assert 'fail=0' in r.stdout and 'pass=6' in r.stdout


def test_auth_sendmail_routing_stub():
    r = run('node js/tests/t1_auth_sendmail_stub.js')
    assert 'RESULT pass=8 fail=0' in r.stdout


def test_dns_dry_run_plan():
    r = run('node scripts/mailersend_dns.js cloudivr.net')
    assert r.returncode == 0
    assert 'APPLY' not in r.stdout
    assert ('include:_spf.mailersend.net' in r.stdout) or ('already has every record' in r.stdout)


def test_lang_no_brevo_and_parity():
    assert run("grep -il brevo js/lang/*.js").stdout.strip() == ''
    assert run('node scripts/check_lang_parity.js').returncode == 0


def test_health():
    r = requests.get(f"{BASE_URL}/api/health", timeout=20)
    assert r.status_code == 200


def test_alice_login():
    r = requests.post(f"{BASE_URL}/api/cloudivr-web/auth/login", json={"email": "civr.alice@example.com", "password": "AliceTest#2026"}, timeout=20)
    assert r.status_code == 200
    assert r.json()["account"]["email"] == "civr.alice@example.com"
