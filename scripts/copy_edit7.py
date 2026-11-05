B = '/app/frontend/src/cloudivr/pages/'
def rep(p, a, b):
    s = open(B + p).read(); assert a in s, (p, a[:60]); open(B + p, 'w').write(s.replace(a, b, 1))
p = 'landing/ProductHero.js'
rep(p, "'USA data, calls and texts on your phone',", "'Send and receive SMS instantly, plus USA data and calls, on your phone',")
rep(p, "'Texts in CloudIVR Messages and calls out from your browser',", "'Send and receive SMS instantly in CloudIVR Messages, and call out from your browser',")
rep('Esim.js', "The USA eSIM downloads to your phone with a QR code: data, calls and texts happen on the phone. The USA mobile number is virtual: you use it in your browser, with texts in Messages and calls from the browser phone.", "Both send and receive SMS instantly. The USA eSIM downloads to your phone with a QR code: texts, calls and data happen on the phone. The USA mobile number is virtual: you use it in your browser, with texts in Messages and calls from the browser phone.")
rep('buy/MobileOffer.js', "Texts arrive in Messages.", "Send and receive SMS instantly in Messages.")
print('ok')
