p = '/app/frontend/src/cloudivr/pages/Esim.js'
s = open(p).read()
i = s.index('function CallsChoice({ item, onChange }) {')
j = s.index('\n}\n', i) + 3
s = s[:i] + s[j:]
open(p, 'w').write(s)
print('removed', j - i)
