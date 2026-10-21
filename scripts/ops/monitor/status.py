#!/usr/bin/env python3
# Read-only status snapshot for the DR-side alert monitor (SSH forced command on the prod droplet)
import json, os, shutil, subprocess, time, urllib.request

APPS = ('app-main', 'app-wl', 'app-voodoo', 'app-proshop')


def sh(cmd):
    return subprocess.run(cmd, capture_output=True, text=True, timeout=25).stdout


def env_of(app):
    out = {}
    try:
        for line in open(f'/opt/nomadly/shared/{app}/backend.env'):
            if '=' in line:
                k, v = line.rstrip('\n').split('=', 1)
                out[k] = v.strip().strip('"')
    except OSError:
        pass
    return out


def healthy(port):
    try:
        with urllib.request.urlopen(f'http://127.0.0.1:{port}/health', timeout=8) as r:
            return r.status == 200 and b'healthy' in r.read(4096)
    except Exception:
        return False


raw = sh(['pm2', 'jlist'])
procs = [{'name': p['name'], 'status': p['pm2_env']['status'], 'restarts': p['pm2_env'].get('restart_time', 0)}
         for p in json.loads(raw[raw.find('['):] or '[]')]
bots = {}
for app in APPS:
    e = env_of(app)
    port = int(e.get('PORT') or 0)
    bots[app] = {'brand': e.get('CHAT_BOT_BRAND') or app, 'ok': bool(port) and (healthy(port) or healthy(port + 100))}
du = shutil.disk_usage('/')
mem = {k: int(v.split()[0]) for k, v in (l.split(':', 1) for l in open('/proc/meminfo')) if k in ('MemTotal', 'MemAvailable')}
services = {s: sh(['systemctl', 'is-active', s]).strip() for s in ('nginx', 'fail2ban')}

os.makedirs('/var/lib/nomadly-monitor', exist_ok=True)
with open('/var/lib/nomadly-monitor/last_seen', 'w') as f:
    f.write(str(int(time.time())))

print(json.dumps({'procs': procs, 'bots': bots, 'services': services,
                  'disk_pct': round(du.used * 100 / du.total, 1),
                  'mem_pct': round(100 - mem['MemAvailable'] * 100 / mem['MemTotal'], 1)}))
