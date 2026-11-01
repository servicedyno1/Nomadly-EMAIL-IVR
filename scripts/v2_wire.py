import os
os.chdir('/app/frontend/src/cloudivr/pages')
def edit(p, pairs):
    s = open(p).read()
    for a, b in pairs:
        assert a in s, (p, a); s = s.replace(a, b)
    open(p, 'w').write(s)

edit('Landing.js', [
 ("import { Hero } from './landing/Hero';\nimport { Coverage, HowItWorks, Facts, Statement } from './landing/Sections';", "import { HeroV2 } from './landing/HeroV2';\nimport { TrustStrip, Pillars, ChannelSlider, FinalCtaV2, Quotes } from './landing/V2Sections';\nimport { Coverage, HowItWorks } from './landing/Sections';"),
 ("import { Pricing, Faq, FinalCta, Footer } from './landing/PricingFaq';", "import { Pricing, Faq, Footer } from './landing/PricingFaq';"),
 ("import { Bubbles } from './landing/Bubbles';\nimport { ProductCards } from './landing/ProductCards';\n", ""),
 ("""        <Hero catalog={catalog} />
        <Facts catalog={catalog} />
        <Bubbles />
        <Statement />
        <UseCases />
        <Platform catalog={catalog} />
        <TryCall />
        <Coverage catalog={catalog} />
        <ProductCards />
        <Reviews />
        <Trust />
        <HowItWorks catalog={catalog} />
        <Pricing catalog={catalog} />
        <Faq catalog={catalog} />
        <FinalCta catalog={catalog} />""", """        <HeroV2 catalog={catalog} />
        <TrustStrip catalog={catalog} />
        <Pillars />
        <ChannelSlider />
        <Platform catalog={catalog} />
        <UseCases />
        <TryCall />
        <HowItWorks catalog={catalog} />
        <Coverage catalog={catalog} />
        <Quotes />
        <Reviews />
        <Pricing catalog={catalog} />
        <Trust />
        <Faq catalog={catalog} />
        <FinalCtaV2 />"""),
])

edit('landing/Nav.js', [
 ("export const LANDING_LINKS = [['#coverage', 'Coverage', 'coverage'], ['#pricing', 'Pricing', 'pricing'], ['#faq', 'FAQ', 'faq']];", "export const LANDING_LINKS = [['#pricing', 'Pricing', 'pricing'], ['#coverage', 'Coverage', 'coverage'], ['#faq', 'Help', 'faq']];\n// Products mega menu groups (ids from menu.js PRODUCTS).\nconst GROUPS = [['Calling', ['numbers', 'phone', 'inbox']], ['Automation', ['ivr', 'campaigns']], ['Texting', ['hosted']], ['AI', ['ai', 'text']]];"),
 ("""      <div className="col-span-8 grid grid-cols-2 gap-1 content-start p-2">{items.map(it => <Item key={it[0]} it={it} onPick={onPick} testid={`nav-menu-${which}-item`} />)}</div>""",
  """      {which === 'products'
        ? <div className="col-span-8 grid grid-cols-2 gap-x-2 gap-y-4 content-start p-2">{GROUPS.map(([g, ids]) => (
            <div key={g} data-testid={`nav-menu-group-${g.toLowerCase()}`}><div className="civr-l-eyebrow text-xs px-3 mb-1">{g}</div>{ids.map(id => items.find(x => x[0] === id)).filter(Boolean).map(it => <Item key={it[0]} it={it} onPick={onPick} testid={`nav-menu-${which}-item`} />)}</div>
          ))}</div>
        : <div className="col-span-8 grid grid-cols-2 gap-1 content-start p-2">{items.map(it => <Item key={it[0]} it={it} onPick={onPick} testid={`nav-menu-${which}-item`} />)}</div>}"""),
 ("""        {scrolled > 300 && <a href="#try" onClick={(e) => goTo('#try', e)} className="hidden xl:inline-flex""", """        {<a href="#try" onClick={(e) => goTo('#try', e)} className="hidden xl:inline-flex"""),
 ("""<Slide><span className="sm:hidden">Start</span><span className="hidden sm:inline">Get your number</span></Slide>""", """<Slide><span className="sm:hidden">Sign up</span><span className="hidden sm:inline">Sign up free</span></Slide>"""),
 ("""{account ? 'Open dashboard' : 'Get your number'}</Link>""", """{account ? 'Open dashboard' : 'Sign up free'}</Link>"""),
 ("""<PhoneCall className="w-4 h-4" />Free call</a>}""", """<PhoneCall className="w-4 h-4" />Try a free call</a>}"""),
])
s = open('landing/Nav.js').read()
s = s.replace('<Wordmark accent="#059669"', '<Wordmark accent="var(--v2-accent)"')
open('landing/Nav.js', 'w').write(s)

edit('landing/V2Sections.js', [("export function FinalCtaV2() {", """export function Quotes() {
  if (!PROOF.quotes?.length) return null;
  return (
    <section className="py-16 md:py-24" data-testid="proof-quotes">
      <div className="max-w-7xl mx-auto px-5 sm:px-6 lg:px-8 grid md:grid-cols-3 gap-6">
        {PROOF.quotes.slice(0, 3).map((q, i) => (
          <figure key={i} className="v2-surface p-8" data-testid={`proof-quote-${i}`}><blockquote className="text-lg leading-relaxed">{`“${q.text}”`}</blockquote><figcaption className="v2-muted text-sm mt-5">{`${q.name} · ${q.role}, ${q.company}`}</figcaption></figure>
        ))}
      </div>
    </section>
  );
}

export function FinalCtaV2() {""")])
print('ok')
