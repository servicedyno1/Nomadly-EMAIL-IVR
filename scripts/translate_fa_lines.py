# Second pass: translate single remaining English lines of js/lang/fa.js (from `const t = {` up to `const fa = {`) in place.
import asyncio, json, os, re, subprocess
from dotenv import load_dotenv
from emergentintegrations.llm.chat import LlmChat, UserMessage

load_dotenv('/app/backend/.env')
P = '/app/js/lang/fa.js'
L = open(P, encoding='utf8').read().split('\n')
start = next(i for i, l in enumerate(L) if l.startswith('const t = {'))
end = next(i for i, l in enumerate(L) if l.startswith('const fa = {'))
cand = []
for i in range(start, end):
    l = L[i]
    if re.search(r'[\u0600-\u06FF]', l):
        continue
    txt = ' '.join(re.findall(r'`[^`]*`|\'[^\']*\'|"[^"]*"', l)) or l
    txt = re.sub(r'\$\{[^}]*\}|<[^>]+>|https?://\S+', '', txt)
    if len(re.findall(r'\b[A-Za-z]{3,}\b', txt)) >= 3:
        cand.append(i)
print('lines', len(cand), flush=True)
SYS = ("Each JSON value is ONE line of a JavaScript language file for a Telegram bot. Translate the human-readable English text inside string/template literals "
       "(or the literal continuation text) into Persian (Farsi). Return ONLY a JSON object with the same keys; each value must remain a single line of valid code. NEVER change: "
       "keys, identifiers, ${...} expressions, arrow functions/parameters, operators, quotes/backticks, HTML tags, emojis, URLs, /commands, \\n escapes, numbers, $ amounts, brand names "
       "(Nomadly, Cloud IVR, eSIM, VoIP, SIP, IVR, SMS, VPS, RDP, cPanel, USA, BTC, USDT, TRC20, ERC20, DNS, A, AAAA, CNAME, MX, TXT, SRV, CAA). Never add an unescaped quote of the literal's own kind or a backtick.")


async def run(keys, sem, out):
    async with sem:
        part = {str(i): L[i] for i in keys}
        for attempt in range(3):
            try:
                chat = LlmChat(api_key=os.environ['EMERGENT_LLM_KEY'], session_id=f'faln-{keys[0]}-{attempt}', system_message=SYS).with_model('anthropic', 'claude-sonnet-4-6')
                r = json.loads(re.sub(r'^```[a-z]*\n|\n```\s*$', '', (await chat.send_message(UserMessage(text=json.dumps(part, ensure_ascii=False)))).strip()))
                if set(r) == set(part) and all(isinstance(v, str) and '\n' not in v for v in r.values()):
                    out.update({int(k): v for k, v in r.items()}); return
            except Exception as e:
                print('err', keys[0], e, flush=True)


async def main():
    out, sem = {}, asyncio.Semaphore(8)
    await asyncio.gather(*[run(cand[i:i + 20], sem, out) for i in range(0, len(cand), 20)])
    C = L[:]
    for i, v in out.items():
        C[i] = v
    open('/tmp/fa_lines_cand.js', 'w', encoding='utf8').write('\n'.join(C))
    open('/tmp/fa_lines_base.js', 'w', encoding='utf8').write('\n'.join(L))
    print('translated', len(out), flush=True)
    print(subprocess.run(['node', '/app/scripts/merge_fa_pieces.js', '/tmp/fa_lines_base.js', '/tmp/fa_lines_cand.js', P], capture_output=True, text=True).stdout)

asyncio.run(main())
