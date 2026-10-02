#!/usr/bin/env python3
"""One-off codemod: literal generic-button comparisons → locale-aware helpers in js/_index.js."""
import re, sys
p = '/app/js/_index.js'
src = open(p, encoding='utf8').read()
orig = src
subs = [
    (r"message === \('↩️ Back'\)|message === '↩️ Back'", "isBackPress(message)"),
    (r"message === \('🔙 Back'\)|message === '🔙 Back'", "isBackPress(message)"),
    (r"message === \('⬅️ Back'\)|message === '⬅️ Back'", "isBackPress(message)"),
    (r"message !== '↩️ Back'", "!isBackPress(message)"),
    (r"message === \('❌ Cancel'\)|message === '❌ Cancel'", "isCancelPress(message)"),
    (r"message !== '❌ Cancel'", "!isCancelPress(message)"),
    (r"message === \('🏠 Main Menu'\)|message === '🏠 Main Menu'", "isMainMenuPress(message)"),
]
counts = {}
for pat, rep in subs:
    src, n = re.subn(pat, rep, src)
    counts[pat] = n
# collapse duplicates produced inside the same condition (e.g. `isBackPress(message) || isBackPress(message)`)
for h in ('isBackPress(message)', 'isCancelPress(message)', 'isMainMenuPress(message)'):
    for _ in range(3):
        src = src.replace(f"{h} || {h}", h)
src = src.replace("isBackPress(message) || isCancelPress(message) || isBackPress(message) || isCancelPress(message)", "isBackPress(message) || isCancelPress(message)")
src = src.replace("isCancelPress(message) || isBackPress(message) || isCancelPress(message)", "isCancelPress(message) || isBackPress(message)")
# `message === 'Cancel' || isCancelPress(message)` → already robust; leave.
open(p, 'w', encoding='utf8').write(src)
print(counts, 'changed' if src != orig else 'unchanged')
