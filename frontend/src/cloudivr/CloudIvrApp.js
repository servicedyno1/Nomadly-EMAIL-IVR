import React from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { Toaster } from 'sonner';
import './cloudivr.css';
import { CivrAuthProvider, useCivrAuth } from './AuthContext';
import { Spinner } from './ui';
import Landing from './pages/Landing';
import { AuthPage, ForgotPage, ResetPage } from './pages/AuthPages';
import Shell from './Shell';

function Protected({ children }) {
  const { account } = useCivrAuth();
  if (account === undefined) return <div className="px-8"><Spinner label="Checking your session…" /></div>;
  if (!account) return <Navigate to="/cloudivr/login" replace />;
  return children;
}

export default function CloudIvrApp() {
  return (
    <div className="civr" data-testid="cloudivr-app">
      <CivrAuthProvider>
        <Toaster theme="dark" position="top-right" richColors closeButton />
        <Routes>
          <Route index element={<Landing />} />
          <Route path="login" element={<AuthPage mode="login" />} />
          <Route path="signup" element={<AuthPage mode="signup" />} />
          <Route path="forgot" element={<ForgotPage />} />
          <Route path="reset-password" element={<ResetPage />} />
          <Route path="app/*" element={<Protected><Shell /></Protected>} />
          <Route path="*" element={<Navigate to="/cloudivr" replace />} />
        </Routes>
      </CivrAuthProvider>
    </div>
  );
}
