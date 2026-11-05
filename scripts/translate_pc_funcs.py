# Re-translates the new English phone-config functions (orderSummary, activated, paymentPrompt, hubWelcome) into fr/zh/hi/fa blocks.
import asyncio, json, os, re, subprocess
from dotenv import load_dotenv
from emergentintegrations.llm.chat import LlmChat, UserMessage
load_dotenv('/app/backend/.env')
P = '/app/js/phone-config.js'
KEYS = ['orderSummary', 'activated', 'paymentPrompt', 'hubWelcome']
NAMES = {'fr': 'French', 'zh': 'Simplified Chinese', 'hi': 'Hindi', 'fa': 'Persian (Farsi)'}


def span(L, start, end, key, ind):
    for i in range(start, end):
        if re.match(rf'^{" " * ind}{key}:', L[i]):
            j = i + 1
            while j < end and not re.match(rf'^{" " * ind}[A-Za-z_$][\w$]*:', L[j]) and not re.match(rf'^{" " * (ind - 2)}\}}', L[j]):
                j += 1
            return i, j
    return None


def blocks(L):
    t0 = next(i for i, l in enumerate(L) if l.startswith('const txtI18n = {'))
    out = {}
    for lang in NAMES:
        s = next(i for i in range(t0, len(L)) if L[i] == f'  {lang}: {{')
        e = next(i for i in range(s + 1, len(L)) if L[i] == '  },')
        out[lang] = (s, e)
    return out


async def tr(src, lang):
    sys = (f"Translate the human-readable English text in this JavaScript object property into {NAMES[lang]}. Return ONLY the code, same structure, "
           "keep the property name, parameters, ${...} expressions (including nested template literals and ternaries), regex, HTML tags, emojis, \\n, numbers and brand names "
           "(Cloud IVR, Speechcue, SIP, IVR, Starter, Pro, Business, Zoiper, Linphone, USA) unchanged. Keep the trailing comma. No markdown.")
    for a in range(3):
        try:
            c = LlmChat(api_key=os.environ['EMERGENT_LLM_KEY'], session_id=f'pcf-{lang}-{hash(src) % 9999}-{a}', system_message=sys).with_model('anthropic', 'claude-sonnet-4-6')
            return re.sub(r'^```[a-z]*\n|\n```\s*$', '', (await c.send_message(UserMessage(text=src))).strip('\n'))
        except Exception as e:
            print('err', e)


async def main():
    L = open(P, encoding='utf8').read().split('\n')
    en_s = next(i for i, l in enumerate(L) if l.startswith('const txt = {'))
    en_e = next(i for i in range(en_s, len(L)) if L[i] == '}')
    src = {}
    for k in KEYS:
        a, b = span(L, en_s, en_e, k, 2)
        src[k] = '\n'.join('  ' + l if l.startswith('  ') else l for l in L[a:b]).rstrip()
    jobs = [(lang, k) for lang in NAMES for k in KEYS]
    res = await asyncio.gather(*[tr(src[k], lang) for lang, k in jobs])
    for (lang, k), out in zip(jobs, res):
        if not out:
            continue
        L = open(P, encoding='utf8').read().split('\n')
        s, e = blocks(L)[lang]
        sp = span(L, s, e, k, 4)
        new = out.split('\n')
        new[0] = '    ' + new[0].lstrip()
        if not new[-1].rstrip().endswith(','):
            new[-1] = new[-1].rstrip() + ','
        C = L[:sp[0]] + new + L[sp[1]:] if sp else L[:e] + new + L[e:]
        open(P, 'w', encoding='utf8').write('\n'.join(C))
        ok = subprocess.run(['node', '--check', P], capture_output=True).returncode == 0
        if not ok:
            open(P, 'w', encoding='utf8').write('\n'.join(L))
        print(lang, k, 'ok' if ok else 'REVERTED', flush=True)

asyncio.run(main())
