import React, { useEffect, useState } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Toaster, toast } from 'sonner';
import './cloudivr.css';
import { CivrAuthProvider, useCivrAuth } from './AuthContext';
import { Spinner } from './ui';
import Landing from './pages/Landing';
import Terms from './pages/Terms';
import { AuthPage, ForgotPage, ResetPage } from './pages/AuthPages';
import Shell from './Shell';
import { cp, IS_CIVR_DOMAIN } from './paths';
import { LangProvider } from './i18n';
import { applyBrandHead } from './Brand';
import { PageTitle } from './PageTitle';
import { ConfirmHost } from './confirm';
import { CrashGuard } from './safety';
import { registerPwa } from './pwa';
import { UpdateWatcher } from './update';

// The same error twice in a row (e.g. pressing Save again) replaces the first one instead of stacking up.
if (!toast.error.civrDedupe) {
  const base = toast.error;
  const dedupe = (msg, opts) => base(msg, typeof msg === 'string' ? { id: `err:${msg}`, ...opts } : opts);
  dedupe.civrDedupe = true;
  toast.error = dedupe;
}

// Last line of defence: a crash outside the signed-in shell (landing, sign-in) shows a recovery card.
function Guarded({ children }) {
  const { pathname } = useLocation();
  return <CrashGuard resetKey={pathname}>{children}</CrashGuard>;
}

// Soft cross-fade between the landing, sign-in and sign-up pages (the signed-in app keeps its layout steady).
function PageFade({ children }) {
  const { pathname } = useLocation();
  const inApp = /(^|\/)app(\/|$)/.test(pathname);
  return <div key={inApp ? 'app' : pathname} className={inApp ? undefined : 'civr-page'}>{children}</div>;
}

function Protected({ children }) {
  const { account } = useCivrAuth();
  if (account === undefined) return <div className="px-8"><Spinner label="Checking your session…" /></div>;
  if (!account) return <Navigate to={cp('/login')} replace />;
  return children;
}

// On CloudIVR's own domain old /cloudivr/* links map to the same page at the root (the server also 301s them).
function LegacyPrefixRedirect() {
  const { pathname, search, hash } = useLocation();
  return <Navigate to={`${pathname.replace(/^\/cloudivr/, '') || '/'}${search}${hash}`} replace />;
}

export default function CloudIvrApp() {
  const [prevTitle] = useState(() => document.title);
  useEffect(() => {
    const restoreHead = applyBrandHead();
    registerPwa();
    return () => { document.title = prevTitle; restoreHead(); };
  }, [prevTitle]);
  return (
    <div className="civr" data-testid="cloudivr-app">
     <LangProvider>
      <PageTitle />
      <CivrAuthProvider>
        {/* Above the round help button (desktop 24 px + 56 px, phones 88 px + 56 px above the bottom bar). */}
        <Toaster theme="dark" position="bottom-right" offset={{ bottom: 92, right: 16 }} mobileOffset={{ bottom: 'calc(9.75rem + env(safe-area-inset-bottom))' }} richColors closeButton visibleToasts={3} />
        <ConfirmHost />
        <UpdateWatcher />
        <Guarded>
        <PageFade>
        <Routes>
          <Route index element={<Landing />} />
          <Route path="terms" element={<Terms />} />
          <Route path="login" element={<AuthPage mode="login" />} />
          <Route path="signup" element={<AuthPage mode="signup" />} />
          <Route path="forgot" element={<ForgotPage />} />
          <Route path="reset-password" element={<ResetPage />} />
          <Route path="app/*" element={<Protected><Shell /></Protected>} />
          {IS_CIVR_DOMAIN && <Route path="cloudivr/*" element={<LegacyPrefixRedirect />} />}
          <Route path="*" element={<Navigate to={cp()} replace />} />
        </Routes>
        </PageFade>
        </Guarded>
      </CivrAuthProvider>
     </LangProvider>
    </div>
  );
}
