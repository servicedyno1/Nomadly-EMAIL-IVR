import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api } from './api';

const Ctx = createContext(null);

export function CivrAuthProvider({ children }) {
  const [account, setAccount] = useState(undefined);
  const [config, setConfig] = useState({ googleClientId: null, brand: 'Nomadly' });

  const refresh = useCallback(() => api('/auth/me').then(r => setAccount(r.account)).catch(() => setAccount(null)), []);
  useEffect(() => {
    refresh();
    api('/auth/config').then(setConfig).catch(() => {});
  }, [refresh]);

  const logout = useCallback(async () => {
    await api('/auth/logout', { method: 'POST' }).catch(() => {});
    try { Object.keys(localStorage).filter(k => k.startsWith('civr.quickDraft.') || k === 'civr.relayPrefs').forEach(k => localStorage.removeItem(k)); } catch (_) { /* private mode */ }
    setAccount(null);
  }, []);

  return <Ctx.Provider value={{ account, setAccount, refresh, logout, config }}>{children}</Ctx.Provider>;
}

export const useCivrAuth = () => useContext(Ctx);
