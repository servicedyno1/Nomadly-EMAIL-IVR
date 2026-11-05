# Copies the new English Cloud IVR plan-flow lines (cp_8, cp_227-230, cp_232) into fa/fr/zh/hi, translated.
import asyncio, json, os, re, subprocess
from dotenv import load_dotenv
from emergentintegrations.llm.chat import LlmChat, UserMessage
load_dotenv('/app/backend/.env')
KEYS = ['cp_8', 'cp_227', 'cp_228', 'cp_229', 'cp_230', 'cp_232']
NAMES = {k: v for k, v in {'fa': 'Persian (Farsi)', 'fr': 'French', 'zh': 'Simplified Chinese', 'hi': 'Hindi'}.items() if k in os.environ.get('LANGS', 'fa,fr,zh,hi').split(',')}
en = open('/app/js/lang/en.js', encoding='utf8').read().split('\n')
src = {k: next(l for l in en if l.startswith(f' {k}:')) for k in KEYS}


async def one(lang):
    sys = (f"Each JSON value is ONE line of JavaScript. Translate only the human-readable English inside the template literal into {NAMES[lang]}. "
           "Keep code, ${...}, HTML tags, emojis, \\n escapes, numbers, $ and brand names (Cloud IVR, SIP, IVR, Starter, Pro, Business, Quick IVR, Bulk IVR, OTP) unchanged. Return ONLY a JSON object with the same keys; each value a single line.")
    for attempt in range(3):
        try:
            chat = LlmChat(api_key=os.environ['EMERGENT_LLM_KEY'], session_id=f'cpflow-{lang}-{attempt}', system_message=sys).with_model('anthropic', 'claude-sonnet-4-6')
            r = json.loads(re.sub(r'^```[a-z]*\n|\n```\s*$', '', (await chat.send_message(UserMessage(text=json.dumps(src, ensure_ascii=False)))).strip()))
            if set(r) == set(KEYS):
                break
        except Exception as e:
            print('err', lang, e)
    else:
        return print('FAILED', lang)
    p = f'/app/js/lang/{lang}.js'
    L = open(p, encoding='utf8').read().split('\n')
    old = L[:]
    for k in KEYS:
        i = next(i for i, l in enumerate(L) if l.startswith(f' {k}:'))
        v = r[k].rstrip(); v = (' ' + v.lstrip()) if not v.startswith(' ') else v; L[i] = v if v.endswith(',') else v + ','
    open(p, 'w', encoding='utf8').write('\n'.join(L))
    if subprocess.run(['node', '--check', p], capture_output=True).returncode != 0:
        print('ERR', lang, subprocess.run(['node', '--check', p], capture_output=True, text=True).stderr[:400]); open(p, 'w', encoding='utf8').write('\n'.join(old))
    else:
        print('ok', lang)


async def main():
    await asyncio.gather(*[one(l) for l in NAMES])

asyncio.run(main())
