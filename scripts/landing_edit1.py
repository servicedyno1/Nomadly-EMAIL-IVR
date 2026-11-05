import sys
B = '/app/frontend/src/cloudivr/pages/'
def rep(p, a, b):
    s = open(B + p).read(); assert a in s, (p, a[:60]); open(B + p, 'w').write(s.replace(a, b, 1))
rep('landing/ProductHero.js', "'A real carrier mobile number, not VoIP',", "'A real carrier mobile number, not VoIP, accepted by most banks and apps',")
p = 'landing/Hero.js'
rep(p, '<section className="civr-l-cream relative pt-32 md:pt-40" data-testid="civr-hero">', '<section id="business" className="civr-l-cream relative pt-16 md:pt-24 border-t civr-l-rule scroll-mt-16" data-testid="civr-hero">')
rep(p, '<div className="civr-l-kicker civr-rise" data-testid="hero-eyebrow">', '<div className="civr-l-kicker civr-rise" data-testid="business-eyebrow">')
rep(p, '<h1 className="civr-l-h text-4xl sm:text-5xl lg:text-[64px] lg:leading-[72px] mt-7 civr-rise civr-d1 text-slate-950" data-testid="hero-title" data-no-translate>', '<h2 className="civr-l-h text-3xl sm:text-4xl lg:text-5xl mt-7 civr-rise civr-d1 text-slate-950" data-testid="business-title" data-no-translate>')
rep(p, '{t[2]}</h1>', '{t[2]}</h2>')
rep(p, 'data-testid="hero-subtitle">', 'data-testid="business-subtitle">')
rep(p, "<span className=\"sm:hidden\">IVR · AI voice agents · Campaigns</span><span className=\"hidden sm:inline\">Virtual numbers · IVR · AI voice agents · Campaigns</span>", "<span>For business · Calling numbers · IVR · AI voice agents</span>")
p = 'landing/Nav.js'
rep(p, "export const LANDING_LINKS = [['#pricing', 'Pricing', 'pricing'], ['#coverage', 'Coverage', 'coverage'], ['#faq', 'Help', 'faq']];", "export const LANDING_LINKS = [['#esim-card', 'eSIM', 'esim'], ['#mobile', 'US mobile number', 'mobile'], ['#business', 'Business calling', 'business'], ['#pricing', 'Pricing', 'pricing'], ['#faq', 'Help', 'faq']];")
p = 'landing/Families.js'
rep(p, """    'A US mobile line on the T-Mobile network. Install it instantly with a QR code, then use the same number for calls and texts on your phone and in the CloudIVR app.',
    ['T-Mobile network · US phone number included', 'Instant QR code to install on your phone', 'Calls and texts on your phone and in the app'],""", """    'A US mobile line on the T-Mobile network for your phone, or a US mobile number for texting in your browser. Both are real carrier numbers, not VoIP.',
    ['eSIM: install with a QR code; data, calls and texts on your phone', 'US mobile number: texts in CloudIVR Messages, no phone needed', 'Each $75/month, no contract'],""")
rep(p, "'Mobile', 'CloudIVR eSIM',", "'Mobile', 'CloudIVR eSIM & US mobile number',")
p = 'landing/EsimPlans.js'
rep(p, "[MessageSquareText, 'Calls & texts in the app', 'Use the same number on your phone and in CloudIVR.']", "[MessageSquareText, 'Calls & texts on your phone', 'Your number works like any mobile line. Want texting in the browser? Get a US mobile number.']")
rep(p, """<p className="v2-muted mt-4 max-w-2xl text-lg">Buy it right here, scan the QR code and your new number works on your phone, with calls, texts and data. The same number makes calls and sends texts in the CloudIVR app too.</p>""", """<p className="v2-muted mt-4 max-w-2xl text-lg">Buy it right here, scan the QR code and your new number works on your phone, with calls, texts and data. The QR code is shown in the app and emailed to you.</p>""")
rep(p, "'US phone number included', 'Calls and texts in the CloudIVR app'", "'US phone number included', 'QR code in the app and by email'")
print('ok')
