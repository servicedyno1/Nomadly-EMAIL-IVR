# Builds js/lang/fa.raw.js from js/lang/en.js with Claude; each chunk must keep en.js valid JS or it stays English.
import asyncio, os, re, subprocess, sys, uuid
from dotenv import load_dotenv
from emergentintegrations.llm.chat import LlmChat, UserMessage

load_dotenv('/app/backend/.env')
KEY = os.environ['EMERGENT_LLM_KEY']
SRC = '/app/js/lang/en.js'
OUT = '/app/js/lang/fa.raw.js'
lines = open(SRC, encoding='utf8').read().split('\n')
END = next(i for i, l in enumerate(lines) if l.startswith('const en = {'))

SYSTEM = """You translate a fragment of a JavaScript language file for a Telegram bot from English to Persian (Farsi).
Rules:
- Output ONLY the translated code fragment, no markdown fences, no explanations.
- Keep every line of code structure identical: keys, identifiers, function signatures, ${...} expressions, operators, commas, brackets, quotes, comments may stay English.
- Translate only human-readable English text inside string and template literals into natural, friendly Persian.
- Never change: HTML tags/attributes, URLs, emojis, /commands, @handles, numbers, currency symbols, placeholders, variable names, code inside ${...}.
- Keep brand/product names in Latin: Nomadly, Cloud IVR, CloudIVR, eSIM, VoIP, SIP, IVR, SMS, USA, T-Mobile, cPanel, VPS, RDP, BTC, USDT, Telegram, Anti-Red.
- Use \"USA\" for the United States. A phone line for calls is a \"VoIP number\" (شماره VoIP).
- If a string is inside single quotes, never introduce an unescaped single quote. Inside template literals never introduce an unescaped backtick.
- Return exactly the same number of top-level entries; do not drop or add anything."""


def parity_boundaries():
    b, odd = [], False
    for i, l in enumerate(lines[:END]):
        if not odd and (re.match(r'^(const|function|let) ', l) or re.match(r"^ [\w$'\"]+\s*:", l)):
            b.append(i)
        odd ^= (len(re.findall(r'(?<!\\)`', l)) % 2 == 1)
    return b


def chunks(size=140):
    cuts, last = [0], 0
    for i in parity_boundaries():
        if i - last >= size:
            cuts.append(i); last = i
    cuts.append(END)
    return [(cuts[k], cuts[k + 1]) for k in range(len(cuts) - 1)]


def valid_with(a, b, text):
    trial = lines[:a] + text.split('\n') + lines[b:]
    p = '/tmp/fa_trial_%s.js' % uuid.uuid4().hex
    open(p, 'w', encoding='utf8').write('\n'.join(trial))
    r = subprocess.run(['node', '--check', p], capture_output=True)
    os.unlink(p)
    return r.returncode == 0


async def translate(idx, a, b, sem):
    src = '\n'.join(lines[a:b])
    if not re.search(r"[A-Za-z]{3,}", re.sub(r'\$\{[^}]*\}', '', src)):
        return src, True
    async with sem:
        for attempt in range(3):
            try:
                chat = LlmChat(api_key=KEY, session_id=f'fa-{idx}-{attempt}-{uuid.uuid4().hex[:6]}', system_message=SYSTEM).with_model('anthropic', 'claude-sonnet-4-5-20250929')
                out = await chat.send_message(UserMessage(text=src))
                out = re.sub(r'^```[a-z]*\n|\n```\s*$', '', out.strip('\n'))
                if valid_with(a, b, out):
                    print(f'chunk {idx} ok', flush=True)
                    return out, True
                print(f'chunk {idx} invalid JS (attempt {attempt})', flush=True)
            except Exception as e:
                print(f'chunk {idx} error {e}', flush=True)
        return src, False


async def main():
    cs = chunks()
    print('chunks', len(cs), flush=True)
    sem = asyncio.Semaphore(8)
    res = await asyncio.gather(*[translate(i, a, b, sem) for i, (a, b) in enumerate(cs)])
    body = '\n'.join(r[0] for r in res)
    tail = '\n'.join(lines[END:]).replace('const en = {', 'const fa = {', 1)
    tail = re.sub(r'module\.exports = \{\n en,\n\}', 'module.exports = {\n fa,\n}', tail)
    open(OUT, 'w', encoding='utf8').write(body + '\n' + tail)
    print('failed chunks kept English:', [i for i, r in enumerate(res) if not r[1]], flush=True)

asyncio.run(main())
