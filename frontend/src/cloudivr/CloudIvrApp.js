import React, { useEffect } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Toaster } from 'sonner';
import './cloudivr.css';
import { CivrAuthProvider, useCivrAuth } from './AuthContext';
import { Spinner } from './ui';
import Landing from './pages/Landing';
import { AuthPage, ForgotPage, ResetPage } from './pages/AuthPages';
import Shell from './Shell';
import { cp, IS_CIVR_DOMAIN } from './paths';
import { LangProvider } from './i18n';

const TITLE = 'CloudIVR — Cloud phone numbers, IVR & SIP';

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
  useEffect(() => {
    const prev = document.title;
    document.title = TITLE;
    return () => { document.title = prev; };
  }, []);
  return (
    <div className="civr" data-testid="cloudivr-app">
     <LangProvider>
      <CivrAuthProvider>
        <Toaster theme="dark" position="bottom-right" mobileOffset={{ bottom: 88 }} richColors closeButton visibleToasts={3} />
        <Routes>
          <Route index element={<Landing />} />
          <Route path="login" element={<AuthPage mode="login" />} />
          <Route path="signup" element={<AuthPage mode="signup" />} />
          <Route path="forgot" element={<ForgotPage />} />
          <Route path="reset-password" element={<ResetPage />} />
          <Route path="app/*" element={<Protected><Shell /></Protected>} />
          {IS_CIVR_DOMAIN && <Route path="cloudivr/*" element={<LegacyPrefixRedirect />} />}
          <Route path="*" element={<Navigate to={cp()} replace />} />
        </Routes>
      </CivrAuthProvider>
     </LangProvider>
    </div>
  );
}
