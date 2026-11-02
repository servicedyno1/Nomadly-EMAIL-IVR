B = '/app/frontend/src/cloudivr/'
def rep(p, a, b, must=True):
    s = open(B + p).read()
    if a not in s:
        assert not must, (p, a[:60]); return
    open(B + p, 'w').write(s.replace(a, b, 1))
rep('nav.js', "['esim', 'CloudIVR eSIM', Smartphone, 'nav-esim']", "['esim', 'eSIM & mobile numbers', Smartphone, 'nav-esim']")
P = 'pages/'
rep(P + 'Esim.js', 'PageHeader label="CloudIVR eSIM" title="US mobile lines, ready in minutes" sub="Two ways to get a real US carrier number: an eSIM for your phone (data, calls and texts on the phone), or a US mobile number for texting and calling from your browser. Both are $75/month."', 'PageHeader label="Mobile lines" title="US eSIM and US mobile numbers" sub="Two real US carrier numbers, $75/month each. The US eSIM downloads to your phone with a QR code: data, calls and texts happen on the phone. The US mobile number is virtual: you use it in your browser, with texts in Messages and calls from the browser phone."')
rep(P + 'Numbers.js', 'sub="Each number answers your callers. Switch forwarding, the keypad menu or hours on and off here, or open a number for everything else."', 'sub="Your CloudIVR calling numbers answer your callers: switch forwarding, the keypad menu or hours here, or open a number for everything else. Your US mobile numbers are listed below them."')
rep(P + 'Wallet.js', 'sub="Numbers, renewals, extra minutes and SMS, forwarded calls, IVR calls, AI agent calls and text calls are paid from here."', 'sub="Numbers, eSIMs, US mobile numbers, renewals, texts, calls, campaigns and AI agent calls are all paid from here."')
rep(P + 'Settings.js', 'sub="This web account is separate from any Telegram bot account."', 'sub="Your login, language, alerts and security. This web account is separate from any Telegram bot account."')
rep(P + 'Campaigns.js', 'PageHeader label="Outbound" title="Bulk IVR campaigns"', 'PageHeader label="Calling" title="Bulk IVR campaigns"', False)
rep(P + 'messages/NewMessage.js', "(n.mobile ? 'Mobile number' : 'CloudIVR eSIM')", "(n.mobile ? 'US mobile number' : 'US eSIM')")
rep(P + 'messages/Thread.js', "{t.number.mobile ? 'Mobile number' : KIND[t.number.kind]}", "{t.number.mobile ? 'US mobile number' : KIND[t.number.kind]}")
rep(P + 'number/IvrSms.js', "x.kind === 'mobile' ? 'Mobile number' : 'CloudIVR eSIM'", "x.kind === 'mobile' ? 'US mobile number' : 'US eSIM'")
rep(P + 'number/MobileLines.js', '<span className="civr-pill">US mobile · texts + calls out</span>', '<span className="civr-pill">Virtual US mobile · real carrier</span>')
rep(P + 'number/MobileLines.js', '>US mobile numbers</h2>', '>US mobile numbers <span className="text-sm font-normal text-[var(--c-muted)]">· virtual, on a real US carrier, used in your browser</span></h2>')
rep(P + 'buy/MobileOffer.js', 'A real US mobile number that sends and receives texts, right in Messages.', 'A virtual US mobile number on a real carrier (not VoIP), used in your browser: no phone or SIM. Texts arrive in Messages.')
print('ok')
