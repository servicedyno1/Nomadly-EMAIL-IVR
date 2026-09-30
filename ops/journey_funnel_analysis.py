#!/usr/bin/env python3
"""Read-only funnel analysis over the 7-day Railway log sample in /app/investigations/journey7d."""
import json, re, collections, datetime as dt
D = '/app/investigations/journey7d/'

def load(name):
    return [json.loads(l) for l in open(D + name + '.jsonl')]

msgs = load('message'); replies = load('reply')
IN = re.compile(r'message: (.*)\tfrom: (\S+) ?(\S*)', re.S)
OUT = re.compile(r'reply: (.*)\tto: (\S+)', re.S)
events = []  # (ts, chat, dir, text)
for r in msgs:
    m = IN.match(r['m'])
    if m: events.append((r['t'], m.group(2), 'in', m.group(1).strip(), m.group(3)))
for r in replies:
    m = OUT.match(r['m'])
    if m: events.append((r['t'], m.group(2).strip(), 'out', m.group(1).strip(), ''))
events.sort()
by_user = collections.defaultdict(list)
for e in events: by_user[e[1]].append(e)
ADMIN = {'5590563715'}
users = [u for u in by_user if u not in ADMIN]
print(f"users={len(users)}  in_events={sum(1 for e in events if e[2]=='in')}  out_events={sum(1 for e in events if e[2]=='out')}")

def has(txts, *needles): return any(any(n in t for n in needles) for t in txts)
def count(txts, *needles): return sum(1 for t in txts if any(n in t for n in needles))

BACK = ('↩️ Back', 'Back', 'Cancel', '🏠 Main Menu', 'Retour', '🔙 Back', '⬅️ Back', '❌ Cancel', 'Annuler', '返回', 'वापस')
LANG = ('🇬🇧 English', '🇫🇷 French', '🇨🇳 Chinese', '🇮🇳 Hindi')

# ---- Global counts ----
ins = [e for e in events if e[2] == 'in' and e[1] not in ADMIN]
outs = [e for e in events if e[2] == 'out' and e[1] not in ADMIN]
in_txt = [e[3] for e in ins]; out_txt = [e[3] for e in outs]
print("\n== Global (7d) ==")
print("total user taps/messages:", len(ins))
print("/start:", count(in_txt, '/start'), " users:", len({e[1] for e in ins if e[3].startswith('/start')}))
print("Back/Cancel/Main Menu taps:", sum(1 for t in in_txt if t in BACK), f"({100*sum(1 for t in in_txt if t in BACK)/len(in_txt):.1f}% of taps)")
print("'That option isn't available' replies:", count(out_txt, "That option isn't available", "Cette option n'est pas disponible", '该选项目前不可用'))
print("Insufficient balance walls shown:", count(out_txt, 'Insufficient Balance', 'Insufficient balance', 'Insufficient funds', 'Solde insuffisant'))
print("Deposit Amount screen shown:", count(out_txt, 'Deposit Amount (min'))
print("Coin picker shown:", count(out_txt, 'choose a crypto currency', 'Choisissez une crypto'))
print("'Send exactly' invoices shown (all purposes):", count(out_txt, 'Send exactly', 'Envoyez exactement'))
print("Cloud IVR hub shown:", count(out_txt, 'Plans from <b>$'))
print("Choose Your Plan shown:", count(out_txt, 'Choose Your Plan', 'Choisir un Forfait'))
print("Plan → country screen:", count(out_txt, 'Select country for your new phone number', 'Sélectionnez le pays'))
print("Order Summary shown:", count(out_txt, 'Order Summary'))
print("Phone payment prompt shown:", count(out_txt, 'Choose payment method'))
print("Cloud IVR activated:", count(out_txt, 'Your Cloud IVR is Active', 'Cloud IVR est actif'))
print("Try-before-you-buy nudge shown:", count(out_txt, 'Did you know?'))
print("SIP test code issued:", count(out_txt, 'Your SIP Test Code', 'Votre code de test SIP', '您的SIP测试码'))
print("SIP test complete (limit):", count(out_txt, 'SIP Test Complete', 'Test SIP terminé'))
print("Quick IVR trial flows started (New Call/Custom Script):", count(in_txt, '✍️ Custom Script', '🎵 Custom Script (TTS)'))
print("Session expired msg:", count(out_txt, 'Your session expired'))
print("Welcome gift msg:", count(out_txt, 'welcome gift'))

# ---- New users ----
print("\n== New users (picked a language in-window) ==")
new_users = []
for u in users:
    ev = by_user[u]
    first_lang = next((e for e in ev if e[2] == 'in' and e[3] in LANG), None)
    if first_lang: new_users.append((u, first_lang))
print("new users:", len(new_users))
langs = collections.Counter(fl[3] for _, fl in new_users); print("langs:", dict(langs))

def parse(ts): return dt.datetime.fromisoformat(ts[:26].rstrip('Z')[:26])
rows = []
for u, fl in new_users:
    t0 = parse(fl[0]); ev = by_user[u]
    after = [e for e in ev if parse(e[0]) > t0]
    ins_a = [e for e in after if e[2] == 'in']
    outs_a = [e for e in after if e[2] == 'out']
    s30 = [e[3] for e in ins_a if (parse(e[0]) - t0).total_seconds() <= 1800]
    txt_in = [e[3] for e in ins_a]; txt_out = [e[3] for e in outs_a]
    span = (parse(ev[-1][0]) - t0).total_seconds() / 60 if ev else 0
    days_active = len({e[0][:10] for e in ins_a})
    first_hub = next((e[3] for e in ins_a if e[3] not in BACK and not e[3].startswith('/start')), None)
    rows.append(dict(u=u, name=fl[4], lang=fl[3], taps30=len(s30), taps_total=len(txt_in), span_min=round(span), days=days_active,
        first=first_hub, backs=sum(1 for t in txt_in if t in BACK),
        cloudivr=has(txt_in, '📞 Cloud IVR + SIP', 'Cloud IVR'), testsip=has(txt_in, '/testsip', 'Try SIP Call Free', 'Test SIP'),
        wallet=has(txt_in, '👛 Wallet', 'Portefeuille'), deposit_tap=has(txt_in, '➕💵 Deposit', 'Deposit'),
        amount_screen=has(txt_out, 'Deposit Amount (min'), coin=has(txt_out, 'choose a crypto currency', 'Choisissez une crypto'),
        invoice=has(txt_out, 'Send exactly', 'Envoyez exactement'), wall=has(txt_out, 'Insufficient'), support=has(txt_in, '💬 Support', '📞 Contact Support'),
        what=count(txt_out, "That option isn't available"), starts=count(txt_in, '/start'), hubs=len({t for t in txt_in if t in ('📞 Cloud IVR + SIP','🛡️ Anti-Red Hosting','🌐 Bulletproof Domains','🛒 Digital Products','🏪 Marketplace','🖥️ VPS / RDP','📱 BulkSMS','📧 Email Validation','💳 Virtual Card','📱 SMS Leads','🔗 URL Shortener','⚡ Upgrade Plan','🤝 Refer & Earn')})))
rows.sort(key=lambda r: -r['taps_total'])
agg = lambda k: sum(1 for r in rows if r[k])
print(f"reached Cloud IVR hub: {agg('cloudivr')} | testsip: {agg('testsip')} | opened wallet: {agg('wallet')} | tapped Deposit: {agg('deposit_tap')} | saw amount screen: {agg('amount_screen')} | coin picker: {agg('coin')} | got invoice: {agg('invoice')} | hit balance wall: {agg('wall')} | opened support: {agg('support')}")
print("median taps in first 30 min:", sorted(r['taps30'] for r in rows)[len(rows)//2], "| 0-tap after onboarding:", sum(1 for r in rows if r['taps_total']==0))
print("users with >=2 active days:", sum(1 for r in rows if r['days']>=2))
print("first thing tapped after menu:", collections.Counter(r['first'] for r in rows).most_common(12))
print("distinct hubs visited distribution:", collections.Counter(r['hubs'] for r in rows))
print("\nper-new-user detail (top 40 by activity):")
for r in rows[:40]:
    print(f" {r['u']:>11} {r['name'][:14]:<14} {r['lang'][:5]} taps={r['taps_total']:<3} 30m={r['taps30']:<3} days={r['days']} backs={r['backs']:<2} hubs={r['hubs']} IVR={int(r['cloudivr'])} sip={int(r['testsip'])} wal={int(r['wallet'])} dep={int(r['deposit_tap'])} amt={int(r['amount_screen'])} inv={int(r['invoice'])} wall={int(r['wall'])} sup={int(r['support'])} what={r['what']} first={str(r['first'])[:28]}")

# ---- Deposit / purchase completions from other logs ----
print("\n== Payments (webhooks) ==")
dyn = load('dynopay'); wal = load('wallet'); conv = load('conversion'); cart = load('cartrecovery')
print("DynoPay webhooks received:", count([r['m'] for r in dyn], 'DYNOPAY WEBHOOK RECEIVED'))
print("wallet top-up webhook COMPLETE:", count([r['m'] for r in dyn], 'WALLET WEBHOOK PROCESSING COMPLETE'))
for k in ['crypto-wallet', 'crypto-pay-domain', 'crypto-pay-hosting', 'crypto-pay-vps', 'crypto-pay-phone', 'crypto-pay-plan', 'crypto-pay-digital', 'crypto-pay-leads']:
    print(f"  URL hits {k}:", count([r['m'] for r in dyn if r['m'].startswith('URL:')], k))
print("First-deposit bonus awarded:", count([r['m'] for r in conv], 'First deposit bonus $', 'First deposit bonus <'), [re.search(r'to (\d+)', r['m']).group(1) for r in conv if 'First deposit bonus $' in r['m'] and ' to ' in r['m']])
print("CartRecovery 'Payment completed' (wallet purchases):", count([r['m'] for r in cart], 'Payment completed'), "distinct users:", len({re.search(r'for (\d+)', r['m']).group(1) for r in cart if 'Payment completed for' in r['m']}))
print("CartRecovery nudges sent:", count([r['m'] for r in cart], '✅ Nudged'))
print("Welcome offers scheduled:", count([r['m'] for r in conv], 'Welcome offer scheduled'), "| browse follow-ups sent:", count([r['m'] for r in conv], 'Browse follow-up sent'))
ap = load('autopromo')
print("AutoPromo blocked-by-user failures:", count([r['m'] for r in ap], 'bot was blocked'), "| marked dead lines:", count([r['m'] for r in ap], 'marked dead'))
sent = [r['m'] for r in ap if 'sent' in r['m'].lower() and 'Scheduled' not in r['m']]
print("AutoPromo send summaries:", len(sent)); [print('   ', s[:160]) for s in sent[:12]]

# wallet deposit users vs wall users
wall_users = {e[1] for e in outs if 'Insufficient' in e[3]}
inv_users = {e[1] for e in outs if 'Send exactly' in e[3]}
print("\nusers who saw balance wall:", len(wall_users), "| users who got any crypto invoice:", len(inv_users), "| overlap:", len(wall_users & inv_users))
