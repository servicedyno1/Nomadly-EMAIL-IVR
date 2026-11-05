# Re-translates the 60-line chunks of js/lang/fa.raw.js that stayed English, in 15-line pieces (same line count required).
import asyncio, json, os, re, sys
from dotenv import load_dotenv
from emergentintegrations.llm.chat import LlmChat, UserMessage

load_dotenv('/app/backend/.env')
KEY = os.environ['EMERGENT_LLM_KEY']
CH, SUB = 60, 15
EN = open('/app/js/lang/en.js', encoding='utf8').read().split('\n')
FA = open('/app/js/lang/fa.raw.js', encoding='utf8').read().split('\n')
OK = json.load(open(sys.argv[1]))
assert len(EN) == len(FA), (len(EN), len(FA))
SYS = ("You translate lines of a Telegram bot's JavaScript language file from English to Persian (Farsi). Return ONLY the code, "
       "EXACTLY the same number of lines, same code. Translate ONLY human-readable text inside string/template literals. NEVER change: "
       "object keys, variable names, ${...} expressions, function signatures, HTML tags, emojis, URLs, /commands, "
       "brand/product names (Nomadly, CloudIVR, Cloud IVR, SIP, IVR, VPS, RDP, cPanel, USDT, BTC, eSIM, VoIP, USA, T-Mobile), currency symbols, numbers. "
       "Escape any quote character you introduce. Lines with no English text are returned unchanged. No markdown fences, no commentary.")


async def tr(start, sem):
    src = EN[start:start + SUB]
    async with sem:
        for attempt in range(3):
            try:
                chat = LlmChat(api_key=KEY, session_id=f'fafix-{start}-{attempt}', system_message=SYS).with_model('anthropic', 'claude-sonnet-4-6')
                out = await chat.send_message(UserMessage(text='\n'.join(src)))
                out = re.sub(r'^```[a-z]*\n|\n```\s*$', '', out.strip('\n')).split('\n')
                if len(out) == len(src):
                    return start, out
            except Exception as e:
                print('err', start, e, flush=True)
    return start, None


async def main():
    sem = asyncio.Semaphore(8)
    jobs = [tr(s, sem) for i, ok in enumerate(OK) if not ok for s in range(i * CH, min((i + 1) * CH, len(EN)), SUB)]
    done = 0
    for start, out in await asyncio.gather(*jobs):
        if out:
            FA[start:start + len(out)] = out; done += 1
    open('/app/js/lang/fa.raw.js', 'w', encoding='utf8').write('\n'.join(FA))
    print(f'fixed {done}/{len(jobs)} pieces', flush=True)

asyncio.run(main())
