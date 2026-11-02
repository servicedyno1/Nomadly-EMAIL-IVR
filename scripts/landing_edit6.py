B = '/app/frontend/src/cloudivr/pages/landing/'
def rep(p, a, b):
    s = open(B + p).read(); assert a in s, (p, a[:60]); open(B + p, 'w').write(s.replace(a, b, 1))
p = 'HeroTabs.js'
rep(p, "const src = (f) => `${process.env.PUBLIC_URL || ''}/cloudivr/shots/${f}-desktop.webp`;", "const src = (f, v = 'desktop') => `${process.env.PUBLIC_URL || ''}/cloudivr/shots/${f}-${v}.webp`;")
rep(p, '<div className="relative aspect-[16/10] bg-white">', '<div className="relative aspect-[4/5] md:aspect-[16/10] bg-white">')
rep(p, """          <img key={id} src={src(file)} alt={`CloudIVR ${label} screen`} width="1440" height="900" loading={k ? 'lazy' : 'eager'} decoding="async"
            className={`absolute inset-0 w-full h-full object-cover object-top transition-opacity duration-500 ${k === i ? 'opacity-100' : 'opacity-0'}`} data-testid={`hero-shot-${id}`} />""", """          <picture key={id}>
            <source media="(max-width: 767px)" srcSet={src(file, 'phone')} />
            <img src={src(file)} alt={`CloudIVR ${label} screen`} width="1440" height="900" loading={k ? 'lazy' : 'eager'} decoding="async"
              className={`absolute inset-0 w-full h-full object-cover object-top transition-opacity duration-500 ${k === i ? 'opacity-100' : 'opacity-0'}`} data-testid={`hero-shot-${id}`} />
          </picture>""")
p = 'StickyCta.js'
rep(p, 'aria-label="Try a free call" data-testid="sticky-cta-try"><PhoneCall className="w-4 h-4" />Try a call</a>', 'aria-label="Try a free call" data-testid="sticky-cta-try"><PhoneCall className="w-4 h-4" /><span className="max-[419px]:hidden">Try a call</span></a>')
print('ok')
