# Adds a `fa:` block to a per-language JS dictionary by translating its `fr:` block (same line count per 30-line chunk).
# usage: python3 translate_fa_block.py FILE FR_START FR_END INSERT_BEFORE [FR_START FR_END INSERT_BEFORE ...]  (1-based lines)
import asyncio, os, re, subprocess, sys
from dotenv import load_dotenv
from emergentintegrations.llm.chat import LlmChat, UserMessage

load_dotenv('/app/backend/.env')
SYS = ("You translate lines of a JavaScript dictionary for a Telegram bot from French to Persian (Farsi). Return ONLY the code, "
       "EXACTLY the same number of lines, same code. Translate ONLY human-readable text inside string/template literals. NEVER change: "
       "object keys, variable names, ${...} expressions, arrow functions/parameters, HTML tags, emojis, URLs, /commands, "
       "brand/product names (Nomadly, Speechcue, Cloud IVR, SIP, IVR, SMS, VoIP, eSIM, USA), currency symbols, numbers. "
       "Never introduce an unescaped quote of the literal's own kind or an unescaped backtick. No markdown fences, no commentary.")


async def tr(chunk, tag, sem):
    async with sem:
        for attempt in range(4):
            try:
                chat = LlmChat(api_key=os.environ['EMERGENT_LLM_KEY'], session_id=f'fablk-{tag}-{attempt}', system_message=SYS).with_model('anthropic', 'claude-sonnet-4-6')
                out = re.sub(r'^```[a-z]*\n|\n```\s*$', '', (await chat.send_message(UserMessage(text='\n'.join(chunk)))).strip('\n')).split('\n')
                if len(out) == len(chunk):
                    return out
            except Exception as e:
                print('err', tag, e, flush=True)
        print('KEPT FR', tag, flush=True)
        return chunk


async def main():
    path, specs = sys.argv[1], sys.argv[2:]
    lines = open(path, encoding='utf8').read().split('\n')
    blocks = sorted([tuple(int(x) for x in specs[i:i + 3]) for i in range(0, len(specs), 3)], key=lambda b: -b[2])
    sem = asyncio.Semaphore(8)
    for a, b, ins in blocks:
        src = lines[a - 1:b]
        assert re.match(r'^\s*fr: \{', src[0]), src[0]
        parts = [src[i:i + 30] for i in range(0, len(src), 30)]
        res = await asyncio.gather(*[tr(p, f'{a}-{i}', sem) for i, p in enumerate(parts)])
        fa = [l for r in res for l in r]
        fa[0] = fa[0].replace('fr: {', 'fa: {', 1)
        lines[ins - 1:ins - 1] = fa
        print('block', a, b, '->', ins, flush=True)
    open(path, 'w', encoding='utf8').write('\n'.join(lines))
    print(subprocess.run(['node', '--check', path], capture_output=True, text=True).stderr or 'syntax ok')

asyncio.run(main())
