#!/usr/bin/env python3
# Register sending domains on Telnyx Email, publish their DNS in Cloudflare (merging SPF, keeping existing DMARC), verify.
# usage: telnyx_email_domains.py setup|verify domain [domain ...]
import json, os, sys, time, urllib.request

ENV = dict(l.split('=', 1) for l in open('/app/backend/.env').read().splitlines() if '=' in l and not l.startswith('#'))
clean = lambda v: v.strip().strip('"')
TK, CFE, CFK = clean(ENV['TELNYX_API_KEY']), clean(ENV['CLOUDFLARE_EMAIL']), clean(ENV['CLOUDFLARE_API_KEY'])


def call(method, url, body=None, headers=None):
    req = urllib.request.Request(url, method=method, data=json.dumps(body).encode() if body is not None else None,
                                 headers={'Content-Type': 'application/json', **(headers or {})})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, json.loads(r.read() or b'{}')
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b'{}')


tx = lambda m, p, b=None: call(m, f'https://api.telnyx.com/v2{p}', b, {'Authorization': f'Bearer {TK}'})
cf = lambda m, p, b=None: call(m, f'https://api.cloudflare.com/client/v4{p}', b, {'X-Auth-Email': CFE, 'X-Auth-Key': CFK})


def telnyx_domain(name, create):
    _, d = tx('GET', '/email_domains?page[size]=100')
    for x in d.get('data', []):
        if x['domain'] == name and x.get('type') != 'shared':
            return x
    if not create:
        return None
    s, d = tx('POST', '/email_domains', {'domain': name, 'inbound_enabled': False})
    if s >= 300:
        sys.exit(f'{name}: create failed {s} {json.dumps(d)[:400]}')
    return d['data']


def publish(name, records):
    _, z = cf('GET', f'/zones?name={name}')
    if not z.get('result'):
        print(f'  ! {name} is not in this Cloudflare account'); return
    zid = z['result'][0]['id']
    _, ex = cf('GET', f'/zones/{zid}/dns_records?per_page=500')
    existing = ex['result']
    for r in records:
        t, host, val = r['record_type'].upper(), r['host'].rstrip('.'), r['value']
        if t == 'MX':
            continue
        same = [e for e in existing if e['type'] == t and e['name'] == host]
        if t == 'TXT' and val.startswith('v=spf1'):
            spf = [e for e in same if e['content'].strip('"').startswith('v=spf1')]
            if spf:
                cur = spf[0]['content'].strip('"')
                if 'include:spf.telnyx.com' in cur:
                    print(f'  = SPF already includes Telnyx'); continue
                new = cur.replace('v=spf1', 'v=spf1 include:spf.telnyx.com', 1)
                cf('PATCH', f'/zones/{zid}/dns_records/{spf[0]["id"]}', {'content': new})
                print(f'  ~ SPF merged: {new}'); continue
        if t == 'TXT' and val.startswith('v=DMARC1') and any(e['content'].strip('"').startswith('v=DMARC1') for e in same):
            print('  = DMARC kept (existing policy)'); continue
        if any(e['content'].strip('"') == val for e in same):
            print(f'  = {t} {host} already set'); continue
        s, d = cf('POST', f'/zones/{zid}/dns_records', {'type': t, 'name': host, 'content': val, 'ttl': 300})
        print(f'  + {t} {host} {"ok" if d.get("success") else d.get("errors")}')


def main():
    mode, names = sys.argv[1], sys.argv[2:]
    for name in names:
        d = telnyx_domain(name, mode == 'setup')
        if not d:
            print(f'{name}: not registered'); continue
        if mode == 'setup':
            _, r = tx('GET', f'/email_domains/{d["id"]}/dns_records')
            print(f'{name}: id={d["id"]}')
            publish(name, r.get('data', []))
        _, v = tx('POST', f'/email_domains/{d["id"]}/verify')
        v = v.get('data', v)
        print(f'{name}: status={v.get("status")} usable_for_sending={v.get("usable_for_sending")}')
        if v.get('status') != 'verified':
            _, r = tx('GET', f'/email_domains/{d["id"]}/dns_records')
            for x in r.get('data', []):
                if x.get('required') or x.get('status') not in ('verified', 'not_required'):
                    print(f'   {x["record_type"]} {x["host"]}: {x.get("status")}')


main()
