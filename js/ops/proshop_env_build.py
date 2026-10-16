#!/usr/bin/env python3
# Build /opt/nomadly/shared/app-proshop/backend.env from Smadav's (app-wl) settings + PROSHOP overrides.
# Secrets: PROSHOP-only values from /root/proshop_secrets.env on first run; afterwards re-used from the existing file.
# Shared keys (Telnyx account, OpenAI, CF, OP, DO, WHM, EdenAI …) come from app-wl / app-main. Never prints values.
import json, os, re, secrets, shutil, time
SH = '/opt/nomadly/shared'
OUT = f'{SH}/app-proshop/backend.env'

def load(p):
    d = {}
    for l in open(p):
        m = re.match(r'^([A-Z0-9_]+)=(.*)$', l.rstrip('\n'))
        if m: d[m.group(1)] = m.group(2)
    return d

wl_lines = open(f'{SH}/app-wl/backend.env').read().split('\n')
main = load(f'{SH}/app-main/backend.env')
prev = load(OUT) if os.path.exists(OUT) else {}
sec = {**{k: prev[k] for k in ('TELEGRAM_BOT_TOKEN_PROD', 'MONGO_URL', 'DYNO_PAY_API_KEY') if k in prev},
       **(load('/root/proshop_secrets.env') if os.path.exists('/root/proshop_secrets.env') else {})}
missing = [k for k in ('TELEGRAM_BOT_TOKEN_PROD', 'MONGO_URL', 'DYNO_PAY_API_KEY') if not sec.get(k)]
if missing: raise SystemExit(f'missing PROSHOP secrets in /root/proshop_secrets.env: {missing}')
tx = json.load(open(f'{SH}/app-proshop/telnyx_ids.json'))

PANEL, IVR = 'panel.proshophost.xyz', 'proshopivr.xyz'
SUPPORT, SUPPORT_LINK = '@proshopHQ', 'https://t.me/proshopHQ'  # owner-supplied support + channel
ov = {
    'PORT': '5004', 'DROPLET_APP_PORT': '5004',
    'DROPLET_FALLBACK_CERT': f'/etc/letsencrypt/live/{IVR}/fullchain.pem',
    'DROPLET_FALLBACK_KEY': f'/etc/letsencrypt/live/{IVR}/privkey.pem',
    'CHAT_BOT_BRAND': '"PROSHOP"', 'CHAT_BOT_NAME': '"PROSHOP Bot"', 'CHAT_BOT_USERNAME': '@ProshopHQ_bot',
    'BOT_USERNAME': 'ProshopHQ_bot', 'TELEGRAM_BOT_USERNAME': 'ProshopHQ_bot',
    'TELEGRAM_BOT_TOKEN_PROD': sec['TELEGRAM_BOT_TOKEN_PROD'], 'TELEGRAM_BOT_TOKEN_DEV': sec['TELEGRAM_BOT_TOKEN_PROD'],
    'BRAND_PHONE_NAME': 'ProshopIVR', 'BRAND_PRIMARY_COLOR': '"#F59E0B"',
    'BRAND_LOGO_URL': f'https://{PANEL}/brand/logo.png',
    'PANEL_DOMAIN': PANEL, 'SIP_DOMAIN': f'sip.{IVR}',
    'CALL_PAGE_URL': f'https://{IVR}/call', 'SELF_URL': f'https://{IVR}', 'SELF_URL_PROD': f'https://{IVR}',
    'SMS_APP_LINK': f'https://{PANEL}/sms-app/download', 'SMS_APP_NAME': '"PROSHOP BulkSMS App"',
    'SUPPORT_HANDLE': SUPPORT, 'SUPPORT_HANDLE_2': SUPPORT, 'SUPPORT_USERNAME': SUPPORT,
    'APP_SUPPORT_LINK': SUPPORT_LINK, 'TG_CHANNEL': SUPPORT_LINK, 'TG_HANDLE': SUPPORT,
    'REACT_APP_BRAND_BOT_NAME': 'ProshopBot', 'REACT_APP_BRAND_BOT_USERNAME': 'ProshopHQ_bot',
    'REACT_APP_BRAND_COLOR': '"#F59E0B"',
    'REACT_APP_BRAND_FAVICON_URL': f'https://{PANEL}/brand/mark.png',
    'REACT_APP_BRAND_LOGO_URL': f'https://{PANEL}/brand/wordmark.png',
    'REACT_APP_BRAND_NAME': '"PROSHOP"', 'REACT_APP_BRAND_PANEL_NAME': 'ProshopHost', 'REACT_APP_BRAND_PHONE_NAME': 'ProshopIVR',
    'REACT_APP_BRAND_POWERED_BY': '"PROSHOP"', 'REACT_APP_BRAND_SUPPORT': SUPPORT,
    'REACT_APP_PANEL_DOMAIN': PANEL, 'REACT_APP_SIP_DOMAIN': f'sip.{IVR}',
    'MONGO_URL': sec['MONGO_URL'], 'DB_NAME': 'proshop',
    'DYNO_PAY_API_KEY': sec['DYNO_PAY_API_KEY'], 'DYNO_PAY_WALLET_TOKEN': '', 'DYNO_PAY_WEBHOOK_SECRET': '',
    'TELNYX_API_KEY': main['TELNYX_API_KEY'], 'TELNYX_SIP_CONNECTION_ID': tx['sipConnectionId'],
    'TELNYX_CALL_CONTROL_APP_ID': tx['callControlAppId'], 'TELNYX_MESSAGING_PROFILE_ID': tx['messagingProfileId'],
    'TELNYX_SIP_USERNAME': tx['sipUser'], 'TELNYX_SIP_PASSWORD': tx['sipPass'], 'TELNYX_DEFAULT_ANI': '',
    'TELNYX_BLOCKED_ANI': main.get('TELNYX_BLOCKED_ANI', ''),
    'OPEN_API_KEY': main['OPEN_API_KEY'], 'APP_OPEN_API_KEY': main['APP_OPEN_API_KEY'],
    'TWILIO_SIP_DOMAIN_PREFIX': 'proshop',
    'SESSION_SECRET': prev.get('SESSION_SECRET') or secrets.token_hex(32),
    'SALES_DASHBOARD_PASSWORD': prev.get('SALES_DASHBOARD_PASSWORD') or secrets.token_urlsafe(18),
    'CONTABO_API_USER': '', 'CONTABO_API_PASSWORD': '', 'CONTABO_CLIENT_ID': '', 'CONTABO_CLIENT_SECRET': '',
    'API_KEY_RAILWAY': '',
    'PHONE_SERVICE_ON': 'true',
    'HIDE_BECOME_RESELLER': 'false',
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
wl = load(f'{SH}/app-wl/backend.env')
leaks = [k for k, v in final.items() if re.search(r'smadav|voodoo', v, re.I)]
print('wrote', OUT, 'keys=', len(final), 'PHONE_SERVICE_ON=', final['PHONE_SERVICE_ON'], 'PORT=', final['PORT'])
print('values still mentioning smadav/voodoo:', leaks or 'none')
print('same-as-smadav secret keys:', [k for k in ['TELEGRAM_BOT_TOKEN_PROD', 'MONGO_URL', 'DYNO_PAY_API_KEY', 'SESSION_SECRET', 'SALES_DASHBOARD_PASSWORD'] if final.get(k) == wl.get(k)] or 'none')
