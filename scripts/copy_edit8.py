import re, glob, subprocess
pat = re.compile(r"(?<![A-Za-z0-9_.\-$])US(?=[ /][A-Za-z&(])")
files = glob.glob('/app/frontend/src/cloudivr/**/*.js', recursive=True) + ['/app/js/cloudivr-web/email-copy.js']
for f in files:
    t = open(f).read()
    u, k = pat.subn('USA', t)
    if k:
        open(f, 'w').write(u); print(f.replace('/app/', ''), k)
p = '/app/js/spenza.js'
s = open(p).read()
a = "async function plansForCustomers() {"
assert a in s
open(p, 'w').write(s)
print('done')
