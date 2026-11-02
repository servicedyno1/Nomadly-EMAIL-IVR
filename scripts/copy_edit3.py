B = '/app/frontend/src/cloudivr/pages/landing/'
def rep(p, a, b):
    s = open(B + p).read(); assert a in s, (p, a[:60]); open(B + p, 'w').write(s.replace(a, b, 1))
rep('EsimPlans.js', '>CloudIVR eSIM: a US mobile line on the T-Mobile network</h2>', '>US eSIM: a downloadable US mobile line on the T-Mobile network</h2>')
rep('Nav.js', "[['#esim-card', 'eSIM', 'esim'],", "[['#esim-card', 'US eSIM', 'esim'],")
rep('menu.js', "  ['esim', Smartphone, 'CloudIVR eSIM', 'A US mobile line on T-Mobile — install instantly with a QR code.', '#esim'],", "  ['esim', Smartphone, 'US eSIM', 'A downloadable US line on T-Mobile for your phone, installed with a QR code.', '#esim'],\n  ['mobile', Smartphone, 'US mobile number', 'A virtual local number on a real US carrier, used in your browser.', '#mobile'],")
print('ok')
