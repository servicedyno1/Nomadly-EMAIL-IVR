#!/usr/bin/env python3
"""Fills only the missing FR/ES keys (from scripts/civr_strings.json) using civr_i18n_translate.ask, and keeps every
existing key (the stock script drops keys the extractor no longer sees). Run after node scripts/civr_i18n_extract.js."""
import json, sys
from concurrent.futures import ThreadPoolExecutor
sys.path.insert(0, '/app/scripts')
from civr_i18n_translate import ask, key, slots_ok, OUT

SKIP = {'(max-width: 767px)', '[CloudIVR] screen crashed:', 'Crash test (development builds only)', 'Esc',
        '{0}{1} Reply in {2}{3}.', 'They are on this screen: {0}.', 'Website (not signed in)', '{0} — {1} tab'}

k = key()
strings = json.load(open('/app/scripts/civr_strings.json'))
for lang in ('fr', 'es'):
    path = f'{OUT}/{lang}.json'
    have = json.load(open(path, encoding='utf-8'))
    todo = [s for s in strings if s not in have and s not in SKIP]
    print(lang, len(have), 'kept,', len(todo), 'to translate', flush=True)
    batches = [todo[i:i + 60] for i in range(0, len(todo), 60)]
    with ThreadPoolExecutor(max_workers=4) as ex:
        for res in ex.map(lambda b: ask(lang, b, k), batches):
            have.update({s: t for s, t in res.items() if slots_ok(s, t)})
    with open(path, 'w', encoding='utf-8') as f:
        f.write('{\n' + ',\n'.join(f'{json.dumps(a, ensure_ascii=False)}: {json.dumps(b, ensure_ascii=False)}' for a, b in sorted(have.items())) + '\n}\n')
    print(lang, 'now', len(have), 'missing', [s for s in todo if s not in have], flush=True)
