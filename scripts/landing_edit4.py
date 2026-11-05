B = '/app/frontend/src/cloudivr/pages/landing/'
def rep(p, a, b):
    s = open(B + p).read(); assert a in s, (p, a[:60]); open(B + p, 'w').write(s.replace(a, b, 1))
s = open(B + 'Nav.js').read()
start = s.index('        <div className="flex flex-col border-t border-slate-200 pt-4">')
end = s.index('</div>', s.index("['#try', 'Free test call', 'try']]", start)) + len('</div>')
block = s[start:end]
s = s[:start] + s[end:]
s = s.replace('      <div className="px-4 sm:px-6 py-6 flex flex-col gap-8">\n', '      <div className="px-4 sm:px-6 py-6 flex flex-col gap-8">\n' + block.replace('border-t border-slate-200 pt-4', 'border-b border-slate-200 pb-4') + '\n', 1)
open(B + 'Nav.js', 'w').write(s)
p = 'ProductHero.js'
rep(p, """      {children}
      <p className="mt-3 text-xs text-slate-500 flex items-start gap-1.5" data-testid={`product-note-${id}`}><ShieldCheck className="w-3.5 h-3.5 mt-px shrink-0" />{note}</p>""", """      <p className="mt-5 text-xs text-slate-500 flex items-start gap-1.5 min-h-[32px]" data-testid={`product-note-${id}`}><ShieldCheck className="w-3.5 h-3.5 mt-px shrink-0" />{note}</p>
      {children}""")
rep(p, 'className="civr-l-btn mt-7 w-full inline-flex items-center justify-center gap-2 min-h-[52px]" data-testid="hero-order-esim"', 'className="civr-l-btn mt-4 w-full inline-flex items-center justify-center gap-2 min-h-[52px]" data-testid="hero-order-esim"')
rep(p, 'className="civr-l-btn mt-7 w-full inline-flex items-center justify-center gap-2 min-h-[52px]" data-testid="hero-order-mobile"', 'className="civr-l-btn mt-4 w-full inline-flex items-center justify-center gap-2 min-h-[52px]" data-testid="hero-order-mobile"')
rep(p, ': offer ? <Waitlist /> : <div className="mt-7 h-[52px]" />}', ': offer ? <Waitlist /> : <div className="mt-4 h-[52px]" />}')
rep(p, '<form onSubmit={go} className="mt-6 space-y-2" data-testid="mobile-waitlist">', '<form onSubmit={go} className="mt-4 space-y-2" data-testid="mobile-waitlist">')
print('ok')
