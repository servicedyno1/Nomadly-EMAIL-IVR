#!/usr/bin/env python3
# Idempotently set/replace .env keys WITHOUT corrupting the file.
# Usage: python3 set_env_keys.py <envfile> KEY=VAL KEY=VAL ...
import sys
path = sys.argv[1]
pairs = [a.split('=', 1) for a in sys.argv[2:]]
with open(path, 'r') as f:
    lines = f.read().split('\n')
# normalize: ensure no trailing empty artifact handling
seen = {}
for i, line in enumerate(lines):
    s = line.strip()
    if not s or s.startswith('#') or '=' not in s:
        continue
    k = s.split('=', 1)[0].strip()
    for key, val in pairs:
        if k == key:
            lines[i] = f'{key}={val}'
            seen[key] = True
# append any missing keys (before trailing blank lines)
while lines and lines[-1] == '':
    lines.pop()
for key, val in pairs:
    if key not in seen:
        lines.append(f'{key}={val}')
with open(path, 'w') as f:
    f.write('\n'.join(lines) + '\n')
print('OK', path, {k: v for k, v in pairs})
