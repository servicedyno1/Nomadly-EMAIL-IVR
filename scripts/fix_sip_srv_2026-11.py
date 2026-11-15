#!/usr/bin/env python3
# Repoint brand SIP SRV records from sip.telnyx.com to our own SIP server (sip.<brand>). --apply to write.
import json, sys, urllib.request

env = {}
for l in open('/app/backend/.env'):
    if '=' in l and not l.startswith('#'):
        k, v = l.rstrip('\n').split('=', 1); env[k] = v.strip('"')
H = {'X-Auth-Email': env['CLOUDFLARE_EMAIL'], 'X-Auth-Key': env['CLOUDFLARE_API_KEY'], 'Content-Type': 'application/json'}
APPLY = '--apply' in sys.argv

def cf(method, path, body=None):
    r = urllib.request.Request('https://api.cloudflare.com/client/v4' + path, method=method, headers=H, data=json.dumps(body).encode() if body else None)
    return json.load(urllib.request.urlopen(r))

for zone in ['speechcue.com', 'smadavspeech.com', 'voodooivr.xyz', 'proshopivr.xyz']:
    zid = cf('GET', f'/zones?name={zone}')['result'][0]['id']
    host = f'sip.{zone}'
    for rec in cf('GET', f'/zones/{zid}/dns_records?type=SRV&per_page=100')['result']:
        if not rec['name'].endswith(host) or 'telnyx' not in json.dumps(rec.get('data', {})) + rec.get('content', ''):
            continue
        port = 5061 if rec['name'].startswith('_sips.') else 5060
        data = {**rec['data'], 'target': host, 'port': port, 'priority': 10, 'weight': 10}
        print(('UPDATE' if APPLY else 'DRY'), rec['name'], rec['content'], '->', f'10 10 {port} {host}')
        if APPLY:
            r = cf('PUT', f"/zones/{zid}/dns_records/{rec['id']}", {'type': 'SRV', 'name': rec['name'], 'data': data, 'ttl': 300})
            print('  ok' if r.get('success') else f"  FAIL {r.get('errors')}")
