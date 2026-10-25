import sys

# Exact one-time replacements: edit(path, [(old, new), ...]); every `old` must appear exactly once.
def edit(path, pairs):
    s = open(path, encoding='utf-8').read()
    for old, new in pairs:
        n = s.count(old)
        if n != 1:
            sys.exit(f'{path}: expected 1 match, found {n}: {old[:80]!r}')
        s = s.replace(old, new)
    open(path, 'w', encoding='utf-8').write(s)
    print('ok', path)
