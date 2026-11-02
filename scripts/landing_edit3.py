B = '/app/frontend/src/cloudivr/pages/landing/ProductHero.js'
s = open(B).read()
def rep(a, b):
    global s
    assert a in s, a[:60]; s = s.replace(a, b, 1)
rep('pt-28 md:pt-36 pb-14 md:pb-20', 'pt-24 md:pt-28 pb-14 md:pb-20')
rep('<div className="max-w-3xl">', '<div className="max-w-4xl">')
rep('className="civr-l-h text-4xl sm:text-5xl lg:text-6xl mt-6 text-slate-950 civr-rise civr-d1"', 'className="civr-l-h text-4xl sm:text-5xl lg:text-[54px] lg:leading-[1.08] mt-5 text-slate-950 civr-rise civr-d1"')
rep('text-base md:text-lg text-slate-600 mt-5 leading-relaxed', 'text-base md:text-lg text-slate-600 mt-4 leading-relaxed')
rep('<div className="grid md:grid-cols-2 gap-5 mt-10">', '<div className="grid md:grid-cols-2 gap-5 mt-8">')
rep('className="v2-surface p-6 sm:p-8 flex flex-col', 'className="v2-surface p-6 sm:p-7 flex flex-col')
rep('<h2 className="civr-l-h text-2xl sm:text-3xl mt-5 text-slate-950">', '<h2 className="civr-l-h text-2xl sm:text-3xl mt-4 text-slate-950">')
open(B, 'w').write(s)
print('ok')
