B = '/app/frontend/src/cloudivr/'
def rep(p, a, b):
    s = open(B + p).read(); assert a in s, (p, a[:60]); open(B + p, 'w').write(s.replace(a, b, 1))
rep('Softphone.js', "          <CallMeFirst on={cmf}", "          {!selNum?.mobile && <CallMeFirst on={cmf}")
s = open(B + 'Softphone.js').read()
i = s.index("{!selNum?.mobile && <CallMeFirst on={cmf}")
j = s.index("/>", i) + 2
s = s[:j] + "}" + s[j:]
open(B + 'Softphone.js', 'w').write(s)
rep('pages/messages/Thread.js', "        {(t.number.kind !== 'esim' || t.number.mobile) && <button type=\"button\" onClick={call}", "        {t.number.caps?.calls && <button type=\"button\" onClick={call}")
rep('pages/number/MobileLines.js', '<span className="civr-pill">US mobile · texting</span>', '<span className="civr-pill">US mobile · texts + calls out</span>')
rep('pages/number/MobileLines.js', '>Mobile numbers for texting</h2>', '>US mobile numbers</h2>')
rep('pages/number/MobileLines.js', '<div className="font-semibold">Need a US mobile number for texting?</div>', '<div className="font-semibold">Need a US mobile number for texts and calls?</div>')
rep('pages/buy/MobileOffer.js', 'Need a US mobile number for texting?', 'Need a US mobile number for texts and calls?')
print('ok')
