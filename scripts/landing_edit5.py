B = '/app/frontend/src/cloudivr/pages/landing/'
def rep(p, a, b):
    s = open(B + p).read(); assert a in s, (p, a[:60]); open(B + p, 'w').write(s.replace(a, b, 1))
p = 'Hero.js'
rep(p, "import { HeroDecor } from './Bubbles';\nimport { HeroPhone } from './HeroPhone';\n", "")
rep(p, "      <HeroDecor />\n      <div className=\"relative max-w-4xl mx-auto px-6 text-center\">", "      <div className=\"relative max-w-7xl mx-auto px-6 md:px-8\">")
rep(p, "        <HeroPhone />\n", "")
rep(p, 'className="text-base md:text-xl text-slate-600 mt-6 max-w-2xl mx-auto leading-relaxed civr-rise civr-d2"', 'className="text-base md:text-lg text-slate-600 mt-5 max-w-3xl leading-relaxed civr-rise civr-d2"')
rep(p, '<div className="flex flex-wrap justify-center gap-3 mt-10 civr-rise civr-d3">', '<div className="flex flex-wrap gap-3 mt-8 civr-rise civr-d3">')
rep(p, '<HearIt className="max-w-2xl mx-auto mt-8 civr-rise civr-d3" />', '<HearIt className="max-w-2xl mt-8 civr-rise civr-d3" />')
rep(p, '<div className="flex flex-wrap justify-center items-center gap-x-6 gap-y-2 mt-8 civr-rise civr-d4" data-testid="hero-microcopy">', '<div className="flex flex-wrap items-center gap-x-6 gap-y-2 mt-6 civr-rise civr-d4" data-testid="hero-microcopy">')
rep(p, '<p className="text-sm text-slate-500 mt-10 civr-rise civr-d4" data-testid="hero-price-note">', '<p className="text-sm text-slate-500 mt-4 civr-rise civr-d4" data-testid="hero-price-note">')
p = 'HeroTabs.js'
rep(p, "  ['dashboard', 'Dashboard', LayoutDashboard, 'overview', 'app', 'Your numbers, wallet and calls at a glance.'],", "  ['dashboard', 'Overview', LayoutDashboard, 'overview', 'app', 'Your numbers, wallet and calls at a glance.'],")
rep(p, "const src = (f) => `/civr/shots/app-${f}.webp`;", "const src = (f) => `${process.env.PUBLIC_URL || ''}/cloudivr/shots/${f}-desktop.webp`;")
rep(p, "  ['live', 'Live map', MapPinned, 'map', 'app/live',", "  ['live', 'Live map', MapPinned, 'live', 'app/live',")
rep(p, '<div className="relative aspect-[16/10] bg-[#0a0a0a]">', '<div className="relative aspect-[16/10] bg-white">')
rep(p, 'width="2160" height="1350"', 'width="1440" height="900"')
rep(p, 'className="flex justify-start sm:justify-center gap-6 sm:gap-10 overflow-x-auto px-2 -mx-2 civr-no-scrollbar"', 'className="flex justify-start gap-6 sm:gap-10 overflow-x-auto px-2 -mx-2 civr-no-scrollbar"')
rep(p, '<p key={i} className="text-center text-sm md:text-base text-slate-600 mt-6 civr-l-swap"', '<p key={i} className="text-sm md:text-base text-slate-600 mt-6 civr-l-swap"')
rep(p, '<div ref={ref} className="relative mt-16 md:mt-20 pb-20 md:pb-28" data-testid="hero-preview">\n      <div className="max-w-6xl mx-auto px-4 sm:px-6">', '<div ref={ref} className="relative mt-12 md:mt-16 pb-20 md:pb-24" data-testid="hero-preview">\n      <div className="max-w-7xl mx-auto px-6 md:px-8">')
rep(p, 'className="mt-8 max-w-5xl mx-auto" data-testid="hero-tab-panel"', 'className="mt-6" data-testid="hero-tab-panel"')
for p in ['ProductHero.js', 'Showcase.js']:
    rep(p, 'max-w-6xl mx-auto px-5 sm:px-6', 'max-w-7xl mx-auto px-6 md:px-8')
rep('Showcase.js', '-mx-5 px-5 sm:mx-0 sm:px-0', '-mx-6 px-6 md:mx-0 md:px-0')
p = 'PricingFaq.js'
rep(p, "{[['#coverage', 'Coverage', 'coverage'],", "{[['#esim-card', 'CloudIVR eSIM', 'esim'], ['#mobile', 'US mobile number', 'mobile'], ['#coverage', 'Coverage', 'coverage'],")
rep(p, """          <div className="text-xs text-slate-500" data-testid="footer-copyright">""", """          <button type="button" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} className="inline-flex items-center gap-2 text-sm font-semibold text-slate-900 hover:text-[color:var(--np-blue)] min-h-[44px] md:order-last" data-testid="footer-back-to-top"><ArrowUp className="w-4 h-4" />Back to top</button>
          <div className="text-xs text-slate-500" data-testid="footer-copyright">""")
print('ok')
