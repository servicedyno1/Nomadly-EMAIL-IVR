#!/usr/bin/env python3
# Nomadly alert feed (runs on the DR droplet every minute): prod bots + processes, websites, DR sync.
# One Telegram message when something breaks (after 2 failed checks in a row) and one when it recovers.
import html, json, os, re, socket, ssl, subprocess, time, urllib.error, urllib.parse, urllib.request
from concurrent.futures import ThreadPoolExecutor

BASE = '/opt/monitor'
STATE_FILE = f'{BASE}/state.json'
PROD = '146.190.238.190'
SITES = ['1.panel.smadavhost.com', '1.smadavspeech.com', '2.speechcue.com', '3.hostbay.io', 'bozzmail.com',
         'www.bozzmail.com', 'hosta.sh', 'www.hosta.sh', 'panel.2.hostbay.io', 'panel.proshophost.xyz',
         'panel.voodoohost.xyz', 'proshopivr.xyz', 'voodooivr.xyz']
APIS = {'https://bozzmail.com/api/': 'Bozzmail API (forms)', 'https://hosta.sh/api/v1/health': 'HostA API'}
FAILS_TO_ALERT = 2
CRASH_RESTARTS, CRASH_WINDOW = 3, 600
DISK_MAX, MEM_MAX = 90, 95
DR_HEALTH, DR_HEALTH_MAX_AGE = '/opt/dr/state/health.txt', 720

CONF = dict(l.strip().split('=', 1) for l in open(f'{BASE}/monitor.env') if '=' in l and not l.startswith('#'))


def telegram(text):
    data = urllib.parse.urlencode({'chat_id': CONF['TG_CHAT'], 'text': text, 'parse_mode': 'HTML',
                                   'disable_web_page_preview': 'true'}).encode()
    try:
        urllib.request.urlopen(f"https://api.telegram.org/bot{CONF['TG_TOKEN']}/sendMessage", data, timeout=15).read()
        return True
    except Exception as e:
        print(f'telegram send failed: {e}')
        return False


def http_check(url):
    def once():
        req = urllib.request.Request(url, headers={'User-Agent': 'NomadlyMonitor/1.0'})
        try:
            with urllib.request.urlopen(req, timeout=15) as r:
                return True, f'HTTP {r.status}'
        except urllib.error.HTTPError as e:
            return e.code < 500, f'HTTP {e.code}'
        except (socket.timeout, TimeoutError):
            return False, 'timed out'
        except ssl.SSLError as e:
            return False, f'SSL error ({e.reason})'
        except urllib.error.URLError as e:
            return False, f'unreachable ({getattr(e.reason, "strerror", None) or e.reason})'
        except Exception as e:
            return False, str(e)[:80]
    ok, detail = once()
    if not ok:
        time.sleep(3)
        ok, detail = once()
    return ok, detail


def prod_snapshot():
    try:
        out = subprocess.run(['ssh', '-i', f'{BASE}/id_ed25519', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10',
                              '-o', f'UserKnownHostsFile={BASE}/known_hosts', f'root@{PROD}', 'status'],
                             capture_output=True, text=True, timeout=45)
        return json.loads(out.stdout) if out.returncode == 0 else None
    except Exception as e:
        print(f'prod snapshot failed: {e}')
        return None


def dr_check():
    try:
        age = time.time() - os.stat(DR_HEALTH).st_mtime
        txt = open(DR_HEALTH).read()
    except OSError:
        return False, 'health report missing'
    if age > DR_HEALTH_MAX_AGE:
        return False, f'health report is {int(age // 60)} min old (backup checks not running)'
    if 'STATUS: OK' in txt:
        return True, 'OK'
    return False, '; '.join(l.strip(' -') for l in txt.splitlines() if l.startswith(' - '))[:300] or 'problem'


def crash_loop(st, name, restarts, now):
    hist = [h for h in st['restarts'].get(name, []) if now - h[0] <= CRASH_WINDOW] + [[now, restarts]]
    st['restarts'][name] = hist
    jump = restarts - min(h[1] for h in hist)
    return jump < CRASH_RESTARTS, f'restarted {jump} times in the last {CRASH_WINDOW // 60} min'


def collect(st, now):
    res = {}
    urls = {f'https://{h}/': h for h in SITES} | APIS
    with ThreadPoolExecutor(8) as ex:
        for (url, label), (ok, detail) in zip(urls.items(), ex.map(http_check, urls)):
            res[f'site:{url}'] = (ok, f'Website {label}', detail)
    snap = prod_snapshot()
    res['prod:ssh'] = (snap is not None, 'Main server status check', 'cannot reach the main server over SSH')
    if snap:
        for app, b in snap['bots'].items():
            res[f'bot:{app}'] = (b['ok'], f"Bot {b['brand']}", 'health check failing on both slots')
        for p in snap['procs']:
            res[f"proc:{p['name']}"] = (p['status'] == 'online', f"Process {p['name']}", f"status: {p['status']}")
            ok, detail = crash_loop(st, p['name'], p['restarts'], now)
            res[f"crash:{p['name']}"] = (ok, f"Process {p['name']} crash loop", detail)
        for s, v in snap['services'].items():
            res[f'svc:{s}'] = (v == 'active', f'{s} on main server', v)
        res['prod:disk'] = (snap['disk_pct'] < DISK_MAX, 'Main server disk', f"{snap['disk_pct']}% used")
        res['prod:mem'] = (snap['mem_pct'] < MEM_MAX, 'Main server memory', f"{snap['mem_pct']}% used")
    ok, detail = dr_check()
    res['dr:sync'] = (ok, 'Backup sync (Mongo / Postgres / Redis)', detail)
    return res, snap is not None


def ago(sec):
    sec = int(sec)
    return f'{sec // 3600}h {sec % 3600 // 60}m' if sec >= 3600 else f'{max(sec // 60, 1)} min'


def main():
    now = time.time()
    try:
        st = json.load(open(STATE_FILE))
    except (OSError, ValueError):
        st = {}
    st.setdefault('checks', {})
    st.setdefault('restarts', {})
    res, prod_ok = collect(st, now)
    down, up, down_keys = [], [], []
    for key, (ok, label, detail) in res.items():
        c = st['checks'].setdefault(key, {'fails': 0, 'alerted': False, 'since': None})
        if ok:
            if c['alerted']:
                up.append(f'• {html.escape(label)} — back after {ago(now - c["since"])}')
            c.update(fails=0, alerted=False, since=None)
        else:
            c['fails'] += 1
            c['since'] = c['since'] or now
            if c['fails'] >= FAILS_TO_ALERT and not c['alerted']:
                down.append(f'• {html.escape(label)}: {html.escape(detail)}')
                down_keys.append(key)
                c['alerted'] = True
    if prod_ok:
        for key in [k for k in st['checks'] if k not in res and re.match(r'(proc|crash|bot|svc):', k)]:
            if st['checks'][key]['alerted']:
                up.append(f'• {html.escape(key.split(":", 1)[1])} — no longer running (removed)')
            del st['checks'][key]
        st['restarts'] = {k: v for k, v in st['restarts'].items() if f'proc:{k}' in res}
    msg = []
    if down:
        msg.append('🔴 <b>Something is down</b>\n' + '\n'.join(down))
    if up:
        msg.append('✅ <b>Recovered</b>\n' + '\n'.join(up))
    if msg and not telegram('\n\n'.join(msg)):
        for key in down_keys:
            st['checks'][key]['alerted'] = False
    tmp = STATE_FILE + '.tmp'
    json.dump(st, open(tmp, 'w'))
    os.replace(tmp, STATE_FILE)
    bad = [k for k, v in res.items() if not v[0]]
    print(f'checks={len(res)} failing={len(bad)} {bad[:6]} alerts_down={len(down)} alerts_up={len(up)}')


if __name__ == '__main__':
    main()
