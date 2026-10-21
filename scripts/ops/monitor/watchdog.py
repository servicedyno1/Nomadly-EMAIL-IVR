#!/usr/bin/env python3
# Prod-side watchdog (cron */5): alerts if the DR alert monitor stops checking in, so the monitor itself is watched.
import json, os, time, urllib.parse, urllib.request

SEEN, STATE, MAX_AGE = '/var/lib/nomadly-monitor/last_seen', '/var/lib/nomadly-monitor/watchdog.json', 600
env = {}
for line in open('/opt/nomadly/shared/app-main/backend.env'):
    if '=' in line:
        k, v = line.rstrip('\n').split('=', 1)
        env[k] = v.strip().strip('"')


def telegram(text):
    data = urllib.parse.urlencode({'chat_id': env['TELEGRAM_ADMIN_CHAT_ID'], 'text': text, 'parse_mode': 'HTML'}).encode()
    urllib.request.urlopen(f"https://api.telegram.org/bot{env['TELEGRAM_BOT_TOKEN_PROD']}/sendMessage", data, timeout=15).read()


try:
    age = time.time() - int(open(SEEN).read().strip())
except (OSError, ValueError):
    age = None
try:
    alerted = json.load(open(STATE)).get('alerted', False)
except (OSError, ValueError):
    alerted = False
stale = age is None or age > MAX_AGE
if stale and not alerted:
    telegram('🔴 <b>Alert monitor is silent</b>\n• The backup server (146.190.229.132) has not checked the main server for '
             f'{int(age // 60) if age else "?"} min — it may be down, so other alerts will not arrive.')
    alerted = True
elif not stale and alerted:
    telegram('✅ <b>Recovered</b>\n• Alert monitor on the backup server is checking in again')
    alerted = False
json.dump({'alerted': alerted}, open(STATE, 'w'))
