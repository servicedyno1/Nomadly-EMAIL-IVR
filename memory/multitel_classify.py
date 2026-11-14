import json, re, csv
d = json.load(open('/app/memory/multitel_scan.json'))
ib = {r['Code']: r for r in csv.DictReader(open('/app/memory/infobip_full_report.csv'))}
DOC = re.compile(r'copy|passport|certificate|bill|letter of auth|\bLOA\b|proof|agreement|permit|extract|declaration|contract|form\b|registry|statement', re.I)
NORM = {'local': 'Local', 'geographic': 'Local', 'Geographic': 'Local', 'tollfree': 'Toll-free', 'mobile': 'Mobile', 'sharedcost': 'Shared Cost'}

def clean(t):
    t = re.sub(r'</?b>', '', t or ''); t = re.sub(r'<[^>]+>', '\n', t).replace('\\r', '').replace('\\n', '\n').replace('"', '')
    return re.sub(r'[ \t]+', ' ', t)

def section(t, key):
    m = re.search(key + r'[^:]*:(.*?)(?=For \w+ identity|For address|For \w+ verification|Additional information|The number provided|Please send|$)', t, re.S | re.I)
    return m.group(1).strip() if m else None

def classify(p):
    if p['needs_registration'] in ('0', 0):
        return 'No ID', '', ''
    t = clean(p['restrictions'])
    if not t.strip():
        return 'Unclear', '', ''
    pers, bus, addr = section(t, 'For personal identity'), section(t, 'For business identity'), section(t, 'For address')
    addr_where = ''
    if addr:
        a = addr.lower()
        addr_where = 'any country' if 'worldwide' in a else ('in the number\'s area' if 'matching' in a else 'in-country')
    paths = [x for x in (pers, bus) if x is not None] or [t]
    nodoc = [x for x in paths if not DOC.search(x)] if not (addr and DOC.search(addr)) else []
    who = 'personal+business' if pers is not None and bus is not None else ('business only' if bus is not None else ('personal only' if pers is not None else ''))
    if nodoc:
        return 'Details only (no documents)', addr_where, who
    return 'Documents', addr_where, who

rows = []
for iso, v in d.items():
    for t, x in v['types'].items():
        if not x['prefixes'] or not x['stock']:
            continue
        p = x['prefixes'][0]
        cat, aw, who = classify(p)
        prices = p['prices'] or []
        m = min((float(z['m']) for z in prices), default=None)
        s = min((float(z['s']) for z in prices), default=None)
        rows.append(dict(iso=iso, name=v['name'], type=NORM.get(t, t), cat=cat, addr=aw, who=who, monthly=m, setup=s,
                         sms=('yes' if x['smsAreas'] else 'no'), stock=x['stock'], ib=(ib.get(iso, {}).get('Voice') or '—')))
# merge duplicate type spellings, keep the least-paperwork one
rank = {'No ID': 0, 'Details only (no documents)': 1, 'Documents': 2, 'Unclear': 3}
best = {}
for r in rows:
    k = (r['iso'], r['type'])
    if k not in best or rank[r['cat']] < rank[best[k]['cat']]:
        best[k] = r
rows = sorted(best.values(), key=lambda r: (rank[r['cat']], r['name'], r['type']))
json.dump(rows, open('/app/memory/multitel_classified.json', 'w'), indent=1)
from collections import Counter
print(Counter(r['cat'] for r in rows), len(rows), 'countries', len({r['iso'] for r in rows}))
for r in rows:
    print(f"{r['cat'][:7]:7} | {r['name'][:20]:20} {r['iso']} | {r['type']:11} | ${r['monthly']}/mo setup ${r['setup']} | sms {r['sms']} | {r['who']:17} | addr {r['addr']:22} | IB: {r['ib']}")
