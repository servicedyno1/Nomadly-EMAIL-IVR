# Lists literal English strings in texting UI files that have no key in es.json / fr.json (template strings with ${} skipped).
import re, json, glob
B = '/app/frontend/src/cloudivr/'
FILES = glob.glob(B + 'pages/texting/*.js') + [B + 'pages/Texting.js', B + 'pages/BuyNumber.js', B + 'pages/landing/PricingFaq.js']
es = json.load(open(B + 'i18n/es.json')); fr = json.load(open(B + 'i18n/fr.json'))
pat = re.compile(r">([^<>{}]*[A-Za-z]{3,}[^<>{}]*)<|label: '([^']+)'|'([A-Z][^']{6,})'")
for f in FILES:
    src = open(f).read()
    found = set()
    for m in pat.finditer(src):
        s = next(g for g in m.groups() if g).strip()
        if len(s.split()) < 2 or s in found or 'className' in s or '=>' in s:
            continue
        found.add(s)
        miss = [l for l, d in (('es', es), ('fr', fr)) if s not in d]
        if miss:
            print(f.replace(B, ''), miss, repr(s[:110]))
