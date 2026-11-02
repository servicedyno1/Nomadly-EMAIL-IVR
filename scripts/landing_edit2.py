B = '/app/frontend/src/cloudivr/pages/'
def rep(p, a, b):
    s = open(B + p).read(); assert a in s, (p, a[:60]); open(B + p, 'w').write(s.replace(a, b, 1))
p = 'Landing.js'
rep(p, "import { Coverage, HowItWorks, Facts, Statement } from './landing/Sections';", "import { Coverage, HowItWorks, Facts } from './landing/Sections';")
rep(p, "import { Bubbles } from './landing/Bubbles';\n", "")
p = 'landing/StickyCta.js'
rep(p, """document.querySelector('[data-testid="civr-hero"]')""", """document.querySelector('[data-testid="product-hero"]')""")
rep(p, """        <Link to={account ? cp('/app/buy') : cp('/signup')} tabIndex={show ? 0 : -1} className="civr-l-btn flex-1 !h-12" data-testid="sticky-cta-buy">{account ? 'Open dashboard' : 'Get your number'}<ArrowRight className="w-4 h-4" /></Link>""", """        <a href="#product-hero" onClick={(e) => { e.preventDefault(); window.scrollTo({ top: 0, behavior: 'smooth' }); }} tabIndex={show ? 0 : -1} className="civr-l-btn flex-1 !h-12" data-testid="sticky-cta-order">Order eSIM or number<ArrowRight className="w-4 h-4" /></a>""")
p = 'landing/PricingFaq.js'
rep(p, """  return [
    ['Can I try it before I pay?',""", """  return [
    ['Is the US mobile number or the eSIM VoIP?', 'No. Both are real mobile numbers on a US carrier, not VoIP. The eSIM runs on your phone; the US mobile number lives in CloudIVR and you read and send its texts in Messages in any browser.'],
    ['Does it work with my bank?', 'It’s a real carrier number, and most banks and apps accept it for sign-ups and verification codes. Each service sets its own rules, so we can’t promise every one will.'],
    ['Can I choose the number?', 'You pick a US ZIP code and we ask the carrier for a number near it. It’s a preference: the area code and the exact number can’t be chosen.'],
    ['When do I get it?', 'After your payment is confirmed. It’s usually ready within minutes, and sometimes takes longer. The eSIM QR code is shown in the app and emailed to the address you enter; the US mobile number appears in My numbers.'],
    ['Can the US mobile number make calls?', 'Not yet. It sends and receives texts in Messages (texts cost $0.05 each from your wallet), and it’s added as a verified caller ID for your CloudIVR calls for free. Calls on the number itself are coming later.'],
    ['What happens if I don’t renew?', 'Both renew monthly at $75 from your wallet when auto-renew is on. If the wallet is short or auto-renew is off, the line pauses and is cancelled if it stays unpaid, and the number can’t be recovered.'],
    ['Can I replace the number?', 'Yes, for $25. The carrier assigns the new number; you can’t choose it. If the carrier refuses, or doesn’t assign one within 24 hours, the $25 goes back to your wallet.'],
    ['Can I try it before I pay?',""")
print('ok')
