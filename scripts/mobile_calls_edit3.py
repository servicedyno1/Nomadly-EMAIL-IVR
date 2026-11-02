B = '/app/frontend/src/cloudivr/pages/'
def rep(p, a, b):
    s = open(B + p).read(); assert a in s, (p, a[:60]); open(B + p, 'w').write(s.replace(a, b, 1))
rep('buy/MobileOffer.js', "Texts cost $0.05 each from your wallet. Calls aren’t included yet.", "Texts cost $0.05 each; calls from your browser $0.15/min to the US and Canada, from your wallet. Incoming calls aren’t answered in CloudIVR yet.")
rep('landing/ProductHero.js', "'Send and receive texts in CloudIVR Messages, in any browser',", "'Texts in CloudIVR Messages and calls out from your browser',")
rep('landing/PricingFaq.js', "['Can the US mobile number make calls?', 'Not yet. It sends and receives texts in Messages (texts cost $0.05 each from your wallet), and it’s added as a verified caller ID for your CloudIVR calls for free. Calls on the number itself are coming later.'],", "['Can the US mobile number make calls?', 'Yes, outgoing calls from the browser phone: $0.15 a minute to the US and Canada, other countries from $0.50 a minute, plus $0.03 per call, from your wallet. Incoming calls to the number aren’t answered in CloudIVR yet. Texts cost $0.05 each, and the number is a free verified caller ID for your other CloudIVR calls.'],")
rep('landing/ProductHero.js', 'note="Pick a ZIP code; the exact number is shown after payment. Calls to the number aren’t answered in CloudIVR yet."', 'note="Pick a ZIP code; the exact number is shown after payment. Incoming calls aren’t answered in CloudIVR yet."')
print('ok')
