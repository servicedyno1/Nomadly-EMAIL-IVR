#!/usr/bin/env python3
# Read-only production log analyzer: activity, errors, UX pain signals per app (last N hours).
import re, sys, glob, collections, datetime as dt
HOURS = int(sys.argv[1]) if len(sys.argv) > 1 else 24
since = dt.datetime.utcnow() - dt.timedelta(hours=HOURS)
TS = re.compile(r'^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}): ?(.*)$')
norm = lambda s: re.sub(r'\b[0-9a-f]{24}\b|\+?\d[\d\-]{5,}|\d+(\.\d+)?', '#', s)[:150]
PAIN = [('pick_button', r'Please (pick|choose) (one of the buttons|a valid)|Veuillez (choisir|sélectionner)|请选择|कृपया.*चुनें'),
        ('not_understood', r"didn.t (understand|catch)|not sure what you mean|Unknown command|isn.t a valid option"),
        ('invalid_input', r'(?i)invalid (number|input|amount|email|domain)|not a valid|has no country code|Enter the phone number with'),
        ('insufficient', r'(?i)insufficient|not enough (balance|funds)|top up|Wallet balance too low'),
        ('error_reply', r'(?i)something went wrong|try again later|failed to|couldn.t|could not'),
        ('support_session', r'Message reçu|Message received! A support agent|support agent will reply')]
def scan(app):
    files = sorted(glob.glob(f'/root/.pm2/logs/{app}-out__2026-11-1[01]*.log')) + [f'/root/.pm2/logs/{app}-out.log']
    efiles = sorted(glob.glob(f'/root/.pm2/logs/{app}-error__2026-11-1[01]*.log')) + [f'/root/.pm2/logs/{app}-error.log']
    users, msgs, btn, pain, painEx, seq, rep3, starts, langs = set(), 0, collections.Counter(), collections.Counter(), collections.defaultdict(list), collections.defaultdict(list), collections.Counter(), 0, collections.Counter()
    dead, tgerr, web = 0, collections.Counter(), collections.Counter()
    last_to = None
    for f in files:
        try: fh = open(f, errors='replace')
        except OSError: continue
        for line in fh:
            m = TS.match(line)
            if not m: continue
            t = dt.datetime.strptime(m.group(1), '%Y-%m-%dT%H:%M:%S')
            if t < since: continue
            body = m.group(2)
            mm = re.match(r'message: (.*?)\tfrom: (\d+)', body)
            if mm:
                text, uid = mm.group(1), mm.group(2)
                users.add(uid); msgs += 1
                key = text if len(text) < 40 else '(free text)'
                btn[key] += 1
                if text.startswith('/start'): starts += 1
                seq[uid].append(text)
                if len(seq[uid]) >= 3 and seq[uid][-1] == seq[uid][-2] == seq[uid][-3]: rep3[text[:40]] += 1
                continue
            mr = re.match(r'reply: (.*?)(\tto: (\d+))?$', body)
            if mr:
                for k, rx in PAIN:
                    if re.search(rx, body):
                        pain[k] += 1
                        if len(painEx[k]) < 6: painEx[k].append(body[:140])
            if 'marked dead' in body: dead += 1
            if re.search(r'(?i)telegram.*(error|40[03]|429)|ETELEGRAM', body): tgerr[norm(body)[:110]] += 1
            mw = re.search(r'\[cloudivr-web\][^\n]*?(\b[45]\d\d\b)', body)
            if mw: web[norm(body)[:120]] += 1
    errs = collections.Counter()
    for f in efiles:
        try: fh = open(f, errors='replace')
        except OSError: continue
        for line in fh:
            m = TS.match(line)
            if not m: continue
            if dt.datetime.strptime(m.group(1), '%Y-%m-%dT%H:%M:%S') < since: continue
            b = m.group(2).strip()
            if not b or b.startswith('at ') or b in ('}', '{'): continue
            errs[norm(b)] += 1
    print(f'\n######## {app}  (last {HOURS}h)')
    print(f'users={len(users)} messages={msgs} /start={starts} dead_chats={dead}')
    print('top inputs:', '; '.join(f'{k!r}×{v}' for k, v in btn.most_common(28)))
    print('pain signals:', dict(pain))
    for k, ex in painEx.items(): print(f'  {k}:', ' || '.join(ex[:4]))
    print('same input 3x in a row:', dict(rep3.most_common(10)))
    print('telegram errors:', dict(tgerr.most_common(6)))
    print('web 4xx/5xx:', dict(web.most_common(8)))
    print('top errors:')
    for k, v in errs.most_common(22): print(f'  {v:5d}  {k}')
for app in ['app-main-a', 'app-wl-a', 'app-voodoo-b', 'app-proshop-a']: scan(app)
