import sys
sys.path.insert(0, '/app/memory')
from ux_edit_helper import edit

R = '/app/frontend/src/cloudivr/'
edit(R + 'Shell.js', [
("import { NavLink, Navigate, Route, Routes, Link, useNavigate } from 'react-router-dom';",
 "import { NavLink, Navigate, Route, Routes, Link, useLocation, useNavigate } from 'react-router-dom';"),
("import { Bell, LogOut, Phone, Plus, LifeBuoy, Eye, EyeOff, Send, Lightbulb } from 'lucide-react';",
 "import { Bell, LogOut, Phone, Plus, LifeBuoy, Eye, EyeOff, Send, Lightbulb, HelpCircle } from 'lucide-react';"),
("import AdminSuggestions from './pages/AdminSuggestions';",
 "import AdminSuggestions from './pages/AdminSuggestions';\nimport Help from './pages/Help';\nimport { CrashGuard, CrashProbe, OfflineBanner } from './safety';\nimport { UnsavedGuard, confirmLeave } from './guard';\nimport { Shortcuts, helpFor } from './shortcuts';"),
("""  const { account, logout } = useCivrAuth();
  const nav = useNavigate();
  return (""",
"""  const { account, logout } = useCivrAuth();
  const nav = useNavigate();
  const { pathname, search } = useLocation();
  return ("""),
("""      <Link to={cp('/app/inbox')} className={ICON_BTN} data-testid="topbar-inbox-button" aria-label="Inbox">""",
"""      <Link to={helpFor(pathname, search)} className={`${ICON_BTN} hidden sm:flex`} data-testid="topbar-help-button" aria-label="Help for this page" title="Help for this page (?)"><HelpCircle className="w-5 h-5" /></Link>
      <Link to={cp('/app/inbox')} className={ICON_BTN} data-testid="topbar-inbox-button" aria-label="Inbox">"""),
("""<button onClick={async () => { nav(cp(), { replace: true }); await logout(); }} className={`${ICON_BTN} hidden lg:flex`}""",
 """<button onClick={async () => { if (!(await confirmLeave())) return; nav(cp(), { replace: true }); await logout(); }} className={`${ICON_BTN} hidden lg:flex`}"""),
("""  const openPhone = useCallback(() => setPhoneOpen(true), []);
  const { lang } = useLang();""",
"""  const openPhone = useCallback(() => setPhoneOpen(true), []);
  const closePhone = useCallback(() => setPhoneOpen(false), []);
  const { pathname } = useLocation();
  const { lang } = useLang();"""),
("""      <IncomingCalls openPhone={openPhone} />""",
"""      <IncomingCalls openPhone={openPhone} />
      <UnsavedGuard />
      <Shortcuts onEscape={closePhone} />"""),
("""          <PreviewBanner show={catalog?.dryRun} livePayments={catalog?.livePayments} />""",
"""          <PreviewBanner show={catalog?.dryRun} livePayments={catalog?.livePayments} />
          <OfflineBanner />"""),
("""          <main className="px-4 md:px-8 pt-8 md:pt-10 pb-40 lg:pb-12 max-w-7xl mx-auto" data-testid="app-main">
            <Routes>""",
"""          <main className="px-4 md:px-8 pt-8 md:pt-10 pb-40 lg:pb-12 max-w-7xl mx-auto" data-testid="app-main">
           <CrashGuard inApp resetKey={pathname} supportLink={catalog?.supportLink}>
            <CrashProbe />
            <Routes>"""),
("""              <Route path="admin/suggestions" element={<AdminSuggestions />} />
              <Route path="*" element={<Navigate to={cp('/app')} replace />} />
            </Routes>""",
"""              <Route path="admin/suggestions" element={<AdminSuggestions />} />
              <Route path="help" element={<Help />} />
              <Route path="*" element={<Navigate to={cp('/app')} replace />} />
            </Routes>
           </CrashGuard>"""),
("""      <Softphone open={phoneOpen} onClose={() => setPhoneOpen(false)} />""",
"""      <Softphone open={phoneOpen} onClose={closePhone} />"""),
])
edit(R + 'MobileNav.js', [
("import { cp } from './paths';", "import { cp } from './paths';\nimport { confirmLeave } from './guard';"),
("""<button type="button" onClick={async () => { nav(cp(), { replace: true }); await logout(); }} className="civr-nav-link w-full !text-[#fb7185]\"""",
 """<button type="button" onClick={async () => { if (!(await confirmLeave())) return; nav(cp(), { replace: true }); await logout(); }} className="civr-nav-link w-full !text-[#fb7185]\""""),
])
edit(R + 'SupportChat.js', [
("import { useLocation } from 'react-router-dom';", "import { Link, useLocation } from 'react-router-dom';"),
("import { MessageCircleQuestion, X, Send, Loader2, LifeBuoy, Trash2 } from 'lucide-react';",
 "import { MessageCircleQuestion, X, Send, Loader2, LifeBuoy, Trash2, BookOpen } from 'lucide-react';"),
("import { useLang } from './i18n';",
 "import { ask, useLang } from './i18n';\nimport { pageOf } from './pages/help/topics';\nimport { OPEN_HELP_CHAT } from './shortcuts';\nimport { appPath } from './nav';"),
("  const { pathname } = useLocation();\n  // Phones",
 "  const { pathname, search } = useLocation();\n  // Phones"),
("""  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [msgs, busy]);""",
"""  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [msgs, busy]);
  // The Help center's "Ask the help assistant" button opens this panel.
  useEffect(() => {
    if (visitor) return undefined;
    const o = () => setOpen(true);
    window.addEventListener(OPEN_HELP_CHAT, o);
    return () => window.removeEventListener(OPEN_HELP_CHAT, o);
  }, [visitor]);
  useEffect(() => {
    if (!open) return undefined;
    const k = (e) => { if (e.key === 'Escape' && !e.defaultPrevented) setOpen(false); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [open]);"""),
("""body: { message: t, lang, ...(vid ? { visitorId: vid } : {}) } });""",
 """body: { message: t, lang, ...(vid ? { visitorId: vid } : { page: pageOf(pathname, search).label }) } });"""),
("""  const clear = async () => { await api(`${base}${q}`, { method: 'DELETE' }).catch(() => {}); setMsgs([]); };""",
 """  const clear = async () => {
    if (!(await ask('Clear this chat? Your questions and the answers are deleted.', { danger: true, ok: 'Clear chat' }))) return;
    await api(`${base}${q}`, { method: 'DELETE' }).catch(() => {}); setMsgs([]);
  };"""),
("""<div className="font-semibold flex-1">Help assistant</div>""",
 """<div className="font-semibold flex-1">Help assistant</div>
            {!visitor && <Link to={appPath('help')} onClick={() => setOpen(false)} className="p-2 rounded-lg text-[#a1a1aa] hover:text-white hover:bg-white/5" aria-label="Help center" title="Help center" data-testid="support-chat-help-link"><BookOpen className="w-4 h-4" /></Link>}"""),
("""'Ask anything about numbers, IVR, campaigns, billing or SIP. I answer instantly, and a person can take over if needed.'}</div>}""",
 """'Ask anything about numbers, IVR, campaigns, billing or SIP. I answer instantly, and a person can take over if needed.'}{!visitor && <Link to={appPath('help')} onClick={() => setOpen(false)} className="block mt-3 text-[#34d399] hover:underline" data-testid="support-chat-browse-help">Browse help articles</Link>}</div>}"""),
])
edit('/app/js/cloudivr-web/support.js', [
("""    const lang = LANG_NAMES[req.body.lang] ? req.body.lang : 'en'
    if (!text)""",
"""    const lang = LANG_NAMES[req.body.lang] ? req.body.lang : 'en'
    // Screen the signed-in user is on (from the app's page map), so "how do I do this here?" makes sense.
    const page = String(req.body.page || '').replace(/[^\\p{L}\\p{N} &·—()-]/gu, '').trim().slice(0, 80)
    if (!text)"""),
("""      { role: 'system', content: `${await context(req)} Reply in""",
 """      { role: 'system', content: `${await context(req)}${page ? ` They are on this screen: ${page}.` : ''} Reply in"""),
])
