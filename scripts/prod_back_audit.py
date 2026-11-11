#!/usr/bin/env python3
# Read-only: find screens where a real user pressed Back and the bot did not move (same reply, or an error/re-prompt).
import re, glob, collections
TS = re.compile(r'^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}): ?(.*)$')
BACK = re.compile(r'^(↩️ |🔙 |⬅️ )?(Back|Retour|返回|वापस|بازگشت)$')
BAD = re.compile(r'(?i)valid option|select a option|choose a valid|invalid|not valid|format incorrect|please (pick|choose|select|enter|send)')
hits = collections.Counter(); ex = {}
for app in ['app-main', 'app-wl', 'app-voodoo', 'app-proshop']:
    files = sorted(glob.glob(f'/root/.pm2/logs/{app}*-out*.log'))
    for f in files:
        last_reply, pending, cur = {}, {}, None
        try: fh = open(f, errors='replace')
        except OSError: continue
        for line in fh:
            m = TS.match(line)
            body = m.group(2) if m else line.rstrip('\n')
            mm = re.match(r'message: (.*?)\tfrom: (\d+)', body)
            if mm:
                text, uid = mm.group(1).strip(), mm.group(2)
                pending[uid] = BACK.match(text) is not None; cur = uid
                continue
            mr = re.match(r'reply: (.*)', body)
            if mr and cur in pending:
                rep, uid, was_back = mr.group(1)[:90], cur, pending.pop(cur)
                prev = last_reply.get(uid, '')
                if was_back and (rep == prev or BAD.search(rep)):
                    key = (app, prev[:70] if rep == prev else 'ERR: ' + rep[:70])
                    hits[key] += 1; ex[key] = prev[:90]
                last_reply[uid] = rep
for (app, k), n in hits.most_common(60):
    print(f'{n:4} {app:12} {k}  || before: {ex[(app, k)]}')
print('total', sum(hits.values()))
