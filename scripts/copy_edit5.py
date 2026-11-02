import re, glob
p = '/app/frontend/src/cloudivr/pages/Esim.js'
# "US" → "USA" in customer-facing copy (frontend app + landing, Spenza notices, voice/IVR texts left alone)
pat = re.compile(r"(?<![A-Za-z0-9_./-])US(?= (eSIM|mobile|carrier|number|numbers|ZIP|data|line|lines|callers|phone|and Canada|& Canada|local|Starter|plan))")
files = glob.glob('/app/frontend/src/cloudivr/**/*.js', recursive=True) + ['/app/js/spenza.js']
n = 0
for f in files:
    t = open(f).read()
    u, k = pat.subn('USA', t)
    if k:
        open(f, 'w').write(u); n += k; print(f.replace('/app/', ''), k)
print('total', n)
