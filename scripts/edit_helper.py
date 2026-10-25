import re, sys

# Exact one-time replacements; every `old` must appear exactly once in the file.
def edit(path, pairs):
    s = open(path, encoding='utf-8').read()
    for old, new in pairs:
        n = s.count(old)
        if n != 1:
            sys.exit(f'{path}: expected 1 match, found {n}: {old[:90]!r}')
        s = s.replace(old, new)
    open(path, 'w', encoding='utf-8').write(s)
    print('ok', path)


# Replace `old` on one specific line number (1-based) only.
def edit_line(path, line, old, new):
    lines = open(path, encoding='utf-8').read().split('\n')
    if old not in lines[line - 1]:
        sys.exit(f'{path}:{line}: {old!r} not found in {lines[line - 1][:120]!r}')
    lines[line - 1] = lines[line - 1].replace(old, new, 1)
    open(path, 'w', encoding='utf-8').write('\n'.join(lines))
    print('ok', path, line)
