B = '/app/frontend/src/cloudivr/pages/'
def rep(p, a, b):
    s = open(B + p).read(); assert a in s, (p, a[:60]); open(B + p, 'w').write(s.replace(a, b, 1))
rep('Messages.js', 'sub="Get a number, a CloudIVR eSIM or Landline to Texting and conversations show up here."', 'sub="Get a calling number, a US mobile number or Landline to Texting and your conversations show up here. A US eSIM texts on your phone instead."')
p = 'landing/ProductHero.js'
rep(p, "function Card({ id, icon: I, badge, title, price, points, note, children, delay }) {", "function Card({ id, icon: I, badge, title, kind, price, points, note, children, delay }) {")
rep(p, """      <h2 className="civr-l-h text-2xl sm:text-3xl mt-4 text-slate-950">{title}</h2>""", """      <h2 className="civr-l-h text-2xl sm:text-3xl mt-4 text-slate-950">{title}</h2>
      <p className="text-sm font-semibold text-[color:var(--np-blue)] mt-1" data-testid={`product-kind-${id}`}>{kind}</p>""")
rep(p, 'badge="On your phone" title="CloudIVR eSIM"', 'badge="On your phone" title="US eSIM" kind="Downloadable eSIM: install it on your phone"')
rep(p, 'badge="In your browser" title="US mobile number"', 'badge="In your browser" title="US mobile number" kind="Virtual local number on a real US carrier"')
rep(p, "const ESIM_POINTS = ['Install it on your phone with a QR code',", "const ESIM_POINTS = ['Scan a QR code and the line is on your phone',")
rep(p, "<span>Want the line on your phone? <b>eSIM</b>.</span>", "<span>Want the line on your phone? <b>US eSIM</b> (downloadable).</span>")
rep(p, "<span>Want the number in your browser? <b>US mobile number</b>.</span>", "<span>Want a number you use in your browser? <b>US mobile number</b> (virtual, real carrier).</span>")
print('ok')
