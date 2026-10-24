#!/usr/bin/env python3
"""Translates /app/scripts/civr_strings.json (from civr_i18n_extract.js) into French and Spanish with the owner's
OpenAI key and merges into frontend/src/cloudivr/i18n/{fr,es}.json (existing translations are kept).
Run: node scripts/civr_i18n_extract.js && python3 scripts/civr_i18n_translate.py"""
import json, os, re, sys, time, urllib.request
from concurrent.futures import ThreadPoolExecutor

OUT = '/app/frontend/src/cloudivr/i18n'
BATCH = 80
GLOSSARY = {
    'fr': 'IVR → SVI (keep "IVR" inside "CloudIVR"); Quick IVR call → Appel SVI rapide; Inbox → Boîte de réception; Wallet → Portefeuille; '
          'Campaign → Campagne; Extra number → Numéro supplémentaire; Voicemail → Messagerie vocale; Top up / Add funds → Recharger / Ajouter des fonds; '
          'Plan → Forfait; Softphone stays Softphone; Forwarding → Renvoi d\'appel; Key (phone keypad) → Touche. Use "vous".',
    'es': 'IVR stays IVR; Quick IVR call → Llamada IVR rápida; Inbox → Bandeja de entrada; Wallet → Billetera; Campaign → Campaña; '
          'Extra number → Número adicional; Voicemail → Buzón de voz; Top up / Add funds → Recargar / Añadir fondos; Plan → Plan; '
          'Forwarding → Desvío de llamadas; Key (phone keypad) → Tecla. Use "tú" (friendly, neutral Latin American Spanish).',
}
NAMES = {'fr': 'French', 'es': 'Spanish'}


def key():
    for line in open('/app/backend/.env'):
        m = re.match(r'^(APP_OPEN_API_KEY|OPEN_API_KEY)=(.*)$', line.strip())
        if m and m.group(2).strip().strip('"'):
            return m.group(2).strip().strip('"')
    sys.exit('No OpenAI key in backend/.env')


def ask(lang, items, k):
    prompt = (f'Translate these user-interface strings of CloudIVR (a cloud phone number / IVR / SIP web app) from English to {NAMES[lang]}. '
              f'Return a JSON object mapping each English string EXACTLY as given to its translation. Rules: keep placeholders like {{0}} {{1}} '
              'unchanged and in a natural position; keep brand and tech names (CloudIVR, SIP, SMS, OTP, Telegram, Zoiper, Linphone, MicroSIP, '
              'Starter, Pro, Business, Google, USD, UDP/TCP/TLS) unchanged; keep emoji, symbols, $ amounts, leading/trailing punctuation and '
              'capitalisation style; short labels stay short; lowercase status words stay lowercase. Glossary: ' + GLOSSARY[lang] +
              '\n\nStrings:\n' + json.dumps(items, ensure_ascii=False))
    body = json.dumps({'model': 'gpt-4.1-mini', 'temperature': 0.1, 'response_format': {'type': 'json_object'},
                       'messages': [{'role': 'user', 'content': prompt}]}).encode()
    for attempt in range(4):
        try:
            req = urllib.request.Request('https://api.openai.com/v1/chat/completions', data=body,
                                         headers={'Authorization': f'Bearer {k}', 'Content-Type': 'application/json'})
            with urllib.request.urlopen(req, timeout=180) as r:
                data = json.loads(json.loads(r.read())['choices'][0]['message']['content'])
            return {s: data[s] for s in items if isinstance(data.get(s), str) and data[s].strip()}
        except Exception as e:  # retry on rate limits / bad JSON
            print(f'  {lang} batch retry {attempt + 1}: {e}', flush=True)
            time.sleep(5 * (attempt + 1))
    return {}


def slots_ok(src, dst):
    return sorted(re.findall(r'\{\d+\}', src)) == sorted(re.findall(r'\{\d+\}', dst))


def main():
    k = key()
    strings = json.load(open('/app/scripts/civr_strings.json'))
    for lang in ('fr', 'es'):
        path = f'{OUT}/{lang}.json'
        have = json.load(open(path)) if os.path.exists(path) else {}
        todo = [s for s in strings if s not in have]
        print(f'{lang}: {len(have)} kept, {len(todo)} to translate', flush=True)
        batches = [todo[i:i + BATCH] for i in range(0, len(todo), BATCH)]
        with ThreadPoolExecutor(max_workers=6) as ex:
            for res in ex.map(lambda b: ask(lang, b, k), batches):
                have.update({s: t for s, t in res.items() if slots_ok(s, t)})
        keep = {s: have[s] for s in strings if s in have}
        json.dump(dict(sorted(keep.items())), open(path, 'w'), ensure_ascii=False, indent=0)
        print(f'{lang}: wrote {len(keep)} / {len(strings)}', flush=True)


if __name__ == '__main__':
    main()
