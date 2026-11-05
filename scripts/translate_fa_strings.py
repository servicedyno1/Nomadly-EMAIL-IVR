# Translates the plain-string entries still English in js/lang/fa.js and appends them as an override block.
import asyncio, json, os, re, subprocess
from dotenv import load_dotenv
from emergentintegrations.llm.chat import LlmChat, UserMessage

load_dotenv('/app/backend/.env')
SKIP = re.compile(r'(parse_mode$|^tickerOf|^tickerViewOf|^supportedCrypto|^vpsPlanOf|^payIn|^user\.|^vp\.(yes|no|back|skip|cancel)$|Record$|^t\.(a|aaaa)$|— )')
paths = json.loads(subprocess.check_output(['node', '-e', "const g=require('/app/scripts/fa_gap.js');console.log(JSON.stringify(g.S.map(p=>[p,p.reduce((o,k)=>o[k],g.en)])))"], cwd='/app/js', stderr=subprocess.DEVNULL).decode().strip().split('\n')[-1])
STATIC = set(json.loads(subprocess.check_output(['node', '/app/scripts/fa_static_paths.js']).decode()))
todo = {'\u241f'.join(p): v for p, v in paths if not SKIP.search('.'.join(p)) and '\u241f'.join(p) in STATIC}
print('to translate', len(todo))
SYS = ("Translate the JSON values from English to Persian (Farsi) for a Telegram bot. Return ONLY a JSON object with the same keys. "
       "Keep HTML tags, emojis, URLs, @handles, /commands, numbers, $ amounts, newlines and brand names (Nomadly, Cloud IVR, eSIM, VoIP, SIP, IVR, SMS, VPS, RDP, cPanel, USA, BTC, USDT) unchanged.")


async def main():
    items = list(todo.items())
    out = {}
    for i in range(0, len(items), 25):
        part = dict(items[i:i + 25])
        for attempt in range(3):
            try:
                chat = LlmChat(api_key=os.environ['EMERGENT_LLM_KEY'], session_id=f'faov-{i}-{attempt}', system_message=SYS).with_model('anthropic', 'claude-sonnet-4-6')
                r = await chat.send_message(UserMessage(text=json.dumps(part, ensure_ascii=False)))
                r = json.loads(re.sub(r'^```[a-z]*\n|\n```\s*$', '', r.strip()))
                if set(r) == set(part) and all(isinstance(v, str) for v in r.values()):
                    out.update(r); print('ok', i, flush=True); break
            except Exception as e:
                print('err', i, e, flush=True)
    block = ('\n// Persian text for entries the first pass left in English.\nconst _faText = ' + json.dumps({k: v for k, v in out.items()}, ensure_ascii=False, indent=1) +
             "\nfor (const [p, v] of Object.entries(_faText)) {\n  const ks = p.split('\u241f'); let o = fa\n  for (const k of ks.slice(0, -1)) o = o?.[k]\n  if (o && typeof o[ks[ks.length - 1]] === 'string') o[ks[ks.length - 1]] = v\n}\n")
    p = '/app/js/lang/fa.js'
    s = open(p, encoding='utf8').read()
    i = s.rindex('module.exports = {')
    open(p, 'w', encoding='utf8').write(s[:i] + block + s[i:])
    print('applied', len(out))

asyncio.run(main())
