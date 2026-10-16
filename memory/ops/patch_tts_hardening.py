#!/usr/bin/env python3
# TTS hardening (2026-10-16): friendly IVR audio-failure copy + Bulk IVR "Upload New Audio" escape hatch.
# Usage: python3 patch_tts_hardening.py <js_dir>   (idempotent; asserts exact single matches)
import re, sys, os

JS = sys.argv[1]

COPY = {
    'en': {
        'quick': '❌ Voice generation is temporarily unavailable — please try again later.',
        'upload': '❌ Voice generation is temporarily unavailable — upload your own recording or try again later.',
    },
    'fr': {
        'quick': '❌ La génération vocale est temporairement indisponible — veuillez réessayer plus tard.',
        'upload': '❌ La génération vocale est temporairement indisponible — importez votre propre enregistrement ou réessayez plus tard.',
    },
    'hi': {
        'quick': '❌ वॉइस जनरेशन अस्थायी रूप से उपलब्ध नहीं है — कृपया बाद में पुनः प्रयास करें।',
        'upload': '❌ वॉइस जनरेशन अस्थायी रूप से उपलब्ध नहीं है — अपनी रिकॉर्डिंग अपलोड करें या बाद में पुनः प्रयास करें।',
    },
    'zh': {
        'quick': '❌ 语音生成暂时不可用 — 请稍后再试。',
        'upload': '❌ 语音生成暂时不可用 — 请上传您自己的录音，或稍后再试。',
    },
}
KEYS = {'cp_104': 'quick', 'cp_207': 'upload', 'cp_278': 'upload', 'cp_308': 'upload', 'cp_338': 'upload'}

for lang, copy in COPY.items():
    p = os.path.join(JS, 'lang', f'{lang}.js')
    s = open(p, encoding='utf-8').read()
    for key, kind in KEYS.items():
        new_line = f" {key}: () => `{copy[kind]}`,"
        pat = re.compile(r'^ ' + key + r': .*$', re.M)
        hits = pat.findall(s)
        assert len(hits) == 1, (p, key, len(hits))
        s = pat.sub(lambda m: new_line, s)
    open(p, 'w', encoding='utf-8').write(s)
    print('lang ok', lang)

p = os.path.join(JS, '_index.js')
s = open(p, encoding='utf-8').read()
old_err = "return send(chatId, trans('t.cp_207', sanitizeProviderError(err.message, 'voice')), k.of([['🎤 Change Voice'], ['↩️ Back']]))"
new_err = "return send(chatId, trans('t.cp_207'), k.of([['📎 Upload New Audio'], ['🎤 Change Voice'], ['↩️ Back']]))"
anchor = """      return send(chatId, trans('t.cp_209'), k.of([...providerBtns, ['↩️ Back']]))
    }
"""
upload = """    if (message === '📎 Upload New Audio') {
      await set(state, chatId, 'action', a.bulkUploadAudio)
      return send(chatId, trans('t.cp_140'), k.of([['↩️ Back']]))
    }
"""
if new_err not in s:
    assert s.count(old_err) == 1, ('cp_207 call', s.count(old_err))
    s = s.replace(old_err, new_err)
if anchor + upload not in s:
    assert s.count(anchor) == 1, ('cp_209 anchor', s.count(anchor))
    s = s.replace(anchor, anchor + upload)
open(p, 'w', encoding='utf-8').write(s)
print('_index ok')
