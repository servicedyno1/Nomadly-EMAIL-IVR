B = '/app/'
def rep(p, a, b):
    s = open(B + p).read(); assert a in s, (p, a[:60]); open(B + p, 'w').write(s.replace(a, b, 1))
F = 'frontend/src/cloudivr/'
rep(F + 'Softphone.js', """    api('/numbers').then(d => { const l = d.numbers.filter(n => n.status === 'active' && (n.access.browserPhone || n.access.ivrOutbound)); setNums(l);""", """    Promise.all([api('/numbers'), api('/mobile-numbers').catch(() => ({ items: [] }))]).then(([d, m]) => { const mob = (m.items || []).filter(x => x.status === 'active' && x.phoneNumber).map(x => ({ phoneNumber: x.phoneNumber, status: 'active', mobile: true, access: { browserPhone: true } })); const l = [...d.numbers.filter(n => n.status === 'active' && (n.access.browserPhone || n.access.ivrOutbound)), ...mob]; setNums(l);""")
rep(F + 'pages/messages/Thread.js', "        {!t.number.mobile && <button type=\"button\" onClick={call} className=\"civr-btn civr-btn-primary civr-btn-sm\"", "        {(t.number.kind !== 'esim' || t.number.mobile) && <button type=\"button\" onClick={call} className=\"civr-btn civr-btn-primary civr-btn-sm\"")
rep('js/cloudivr-web/messages.js', "caps: { send: d.kind === 'mobile' && d.status === 'active', receive: d.kind === 'mobile', pictures: false, calls: false }, old: null })", "caps: { send: d.kind === 'mobile' && d.status === 'active', receive: d.kind === 'mobile', pictures: false, calls: d.kind === 'mobile' && d.status === 'active' }, old: null })")
p = F + 'pages/number/MobileLines.js'
rep(p, "import { MessageSquare, Loader2 } from 'lucide-react';", "import { MessageSquare, Loader2, Phone, PhoneIncoming } from 'lucide-react';\nimport { useShell } from '../../Shell';\nimport { DIAL_FROM } from '../../Softphone';")
rep(p, """      {item.status === 'active' && <Link to={cp('/app/messages')} className="text-sm underline font-semibold text-[var(--c-accent)] inline-flex items-center gap-2" data-testid={`mobile-line-messages-${item.id}`}><MessageSquare className="w-4 h-4" />Open texts in Messages</Link>}""", """      {item.status === 'active' && <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <Link to={cp('/app/messages')} className="text-sm underline font-semibold text-[var(--c-accent)] inline-flex items-center gap-2" data-testid={`mobile-line-messages-${item.id}`}><MessageSquare className="w-4 h-4" />Open texts in Messages</Link>
        <button type="button" onClick={() => { window.dispatchEvent(new CustomEvent(DIAL_FROM, { detail: { from: item.phoneNumber } })); openPhone(); }} className="text-sm underline font-semibold text-[var(--c-accent)] inline-flex items-center gap-2" data-testid={`mobile-line-call-${item.id}`}><Phone className="w-4 h-4" />Call from this number</button>
      </div>}
      {item.status === 'active' && <div className="flex flex-wrap items-center gap-3 rounded-xl border border-[var(--c-line)] p-3 opacity-70" aria-disabled="true" data-testid={`mobile-line-ring-${item.id}`}>
        <PhoneIncoming className="w-4 h-4 text-[var(--c-muted)]" /><span className="text-sm font-semibold">Ring in CloudIVR</span>
        <span className="civr-pill" data-testid={`mobile-line-ring-status-${item.id}`}>Not active yet</span>
        <span className="text-xs text-[var(--c-muted)] basis-full">Calls to this number can’t ring in your browser yet: we’re waiting for the carrier to switch on call routing. Outgoing calls work: $0.15/min to the US and Canada, other countries at their rate, from your wallet.</span>
      </div>}""")
rep(p, """function MobileLine({ item, reload }) {
  const [busy, setBusy] = useState(false);""", """function MobileLine({ item, reload }) {
  const { openPhone } = useShell();
  const [busy, setBusy] = useState(false);""")
print('ok')
