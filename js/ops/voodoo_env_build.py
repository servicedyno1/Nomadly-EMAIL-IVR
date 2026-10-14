#!/usr/bin/env python3
# Build /opt/nomadly/shared/app-voodoo/backend.env from Smadav's (app-wl) settings + Voodoo overrides.
# Secrets: Voodoo-only values from /root/voodoo_secrets.env, shared ones copied from app-main. Never prints values.
import json, os, re, secrets, shutil, time
SH = '/opt/nomadly/shared'
OUT = f'{SH}/app-voodoo/backend.env'

def load(p):
    d = {}
    for l in open(p):
        m = re.match(r'^([A-Z0-9_]+)=(.*)$', l.rstrip('\n'))
        if m: d[m.group(1)] = m.group(2)
    return d

wl_lines = open(f'{SH}/app-wl/backend.env').read().split('\n')
main = load(f'{SH}/app-main/backend.env')
prev0 = load(OUT) if os.path.exists(OUT) else {}
# Voodoo-only secrets: /root/voodoo_secrets.env on first run; afterwards re-used from the existing file.
sec = {**{k: prev0[k] for k in ('TELEGRAM_BOT_TOKEN_PROD', 'MONGO_URL', 'DYNO_PAY_API_KEY') if k in prev0}, **(load('/root/voodoo_secrets.env') if os.path.exists('/root/voodoo_secrets.env') else {})}
tx = json.load(open(f'{SH}/app-voodoo/telnyx_ids.json'))
prev = load(OUT) if os.path.exists(OUT) else {}

ov = {
    'PORT': '5003', 'DROPLET_APP_PORT': '5003',
    'DROPLET_FALLBACK_CERT': '/etc/letsencrypt/live/voodooivr.xyz/fullchain.pem',
    'DROPLET_FALLBACK_KEY': '/etc/letsencrypt/live/voodooivr.xyz/privkey.pem',
    'CHAT_BOT_BRAND': '"Voodoo Land"', 'CHAT_BOT_NAME': '"Voodoo Land Bot"', 'CHAT_BOT_USERNAME': '@Voodoo_landbot',
    'BOT_USERNAME': 'Voodoo_landbot', 'TELEGRAM_BOT_USERNAME': 'Voodoo_landbot',
    'TELEGRAM_BOT_TOKEN_PROD': sec['TELEGRAM_BOT_TOKEN_PROD'], 'TELEGRAM_BOT_TOKEN_DEV': sec['TELEGRAM_BOT_TOKEN_PROD'],
    'BRAND_PHONE_NAME': 'VoodooIVR', 'BRAND_PRIMARY_COLOR': '"#14B8A6"',
    'BRAND_LOGO_URL': 'https://panel.voodoohost.xyz/brand/logo.png',
    'PANEL_DOMAIN': 'panel.voodoohost.xyz', 'SIP_DOMAIN': 'sip.voodooivr.xyz',
    'CALL_PAGE_URL': 'https://voodooivr.xyz/call', 'SELF_URL': 'https://voodooivr.xyz', 'SELF_URL_PROD': 'https://voodooivr.xyz',
    'SMS_APP_LINK': 'https://panel.voodoohost.xyz/sms-app/download', 'SMS_APP_NAME': '"Voodoo Land BulkSMS App"',
    'SUPPORT_HANDLE': '@onarrival1', 'SUPPORT_HANDLE_2': '@onarrival1', 'SUPPORT_USERNAME': '@onarrival1',
    'APP_SUPPORT_LINK': 'https://t.me/onarrival1', 'TG_CHANNEL': 'https://t.me/Voodoo_landbot', 'TG_HANDLE': '@Voodoo_landbot',
    'REACT_APP_BRAND_BOT_NAME': 'VoodooLandBot', 'REACT_APP_BRAND_BOT_USERNAME': 'Voodoo_landbot',
    'REACT_APP_BRAND_COLOR': '"#14B8A6"',
    'REACT_APP_BRAND_FAVICON_URL': 'https://panel.voodoohost.xyz/brand/mark.png',
    'REACT_APP_BRAND_LOGO_URL': 'https://panel.voodoohost.xyz/brand/wordmark.png',
    'REACT_APP_BRAND_NAME': '"Voodoo Land"', 'REACT_APP_BRAND_PANEL_NAME': 'VoodooHost', 'REACT_APP_BRAND_PHONE_NAME': 'VoodooIVR',
    'REACT_APP_BRAND_POWERED_BY': '"Voodoo Land"', 'REACT_APP_BRAND_SUPPORT': '@onarrival1',
    'REACT_APP_PANEL_DOMAIN': 'panel.voodoohost.xyz', 'REACT_APP_SIP_DOMAIN': 'sip.voodooivr.xyz',
    'MONGO_URL': sec['MONGO_URL'], 'DB_NAME': 'voodoo',
    'DYNO_PAY_API_KEY': sec['DYNO_PAY_API_KEY'], 'DYNO_PAY_WALLET_TOKEN': '', 'DYNO_PAY_WEBHOOK_SECRET': '',
    'TELNYX_API_KEY': main['TELNYX_API_KEY'], 'TELNYX_SIP_CONNECTION_ID': tx['sipConnectionId'],
    'TELNYX_CALL_CONTROL_APP_ID': tx['callControlAppId'], 'TELNYX_MESSAGING_PROFILE_ID': tx['messagingProfileId'],
    'TELNYX_SIP_USERNAME': tx['sipUser'], 'TELNYX_SIP_PASSWORD': tx['sipPass'], 'TELNYX_DEFAULT_ANI': '',
    'TELNYX_BLOCKED_ANI': main.get('TELNYX_BLOCKED_ANI', ''),
    'OPEN_API_KEY': main['OPEN_API_KEY'], 'APP_OPEN_API_KEY': main['APP_OPEN_API_KEY'],
    'TWILIO_SIP_DOMAIN_PREFIX': 'voodoo',
    'SESSION_SECRET': prev.get('SESSION_SECRET') or secrets.token_hex(32),
    'SALES_DASHBOARD_PASSWORD': prev.get('SALES_DASHBOARD_PASSWORD') or secrets.token_urlsafe(18),
    'CONTABO_API_USER': '', 'CONTABO_API_PASSWORD': '', 'CONTABO_CLIENT_ID': '', 'CONTABO_CLIENT_SECRET': '',
    'API_KEY_RAILWAY': '',
    'PHONE_SERVICE_ON': os.environ.get('VOODOO_PHONE', prev.get('PHONE_SERVICE_ON', 'false')),
}
out, seen = [], set()
for l in wl_lines:
    m = re.match(r'^([A-Z0-9_]+)=(.*)$', l)
    if m and m.group(1) in ov:
        k = m.group(1)
        if k in seen: continue
        out.append(f'{k}={ov[k]}'); seen.add(k)
    else:
        out.append(l)
for k, v in ov.items():
    if k not in seen: out.append(f'{k}={v}')
txt = '\n'.join(out).rstrip('\n') + '\n'
if os.path.exists(OUT): shutil.copy2(OUT, f'{OUT}.bak.{time.strftime("%Y%m%dT%H%M%SZ", time.gmtime())}')
fd = os.open(OUT, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
with os.fdopen(fd, 'w') as f: f.write(txt)
final = load(OUT)
leaks = [k for k, v in final.items() if re.search(r'smadav', v, re.I)]
print('wrote', OUT, 'keys=', len(final), 'PHONE_SERVICE_ON=', final['PHONE_SERVICE_ON'])
print('values still mentioning smadav:', leaks or 'none')
print('same-as-smadav secret keys:', [k for k in ['TELEGRAM_BOT_TOKEN_PROD', 'MONGO_URL', 'DYNO_PAY_API_KEY', 'TELNYX_API_KEY', 'SESSION_SECRET', 'OPEN_API_KEY'] if final.get(k) == load(f'{SH}/app-wl/backend.env').get(k)] or 'none')
