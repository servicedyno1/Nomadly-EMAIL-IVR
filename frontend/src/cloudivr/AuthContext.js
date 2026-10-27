import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api } from './api';

const Ctx = createContext(null);
const CFG_KEY = 'civr.authConfig';
// Last known public config (Google client id) so the sign-in page can draw the Google button before /auth/config answers.
const cachedConfig = () => { try { return JSON.parse(localStorage.getItem(CFG_KEY)) || null; } catch (_) { return null; } };

export function CivrAuthProvider({ children }) {
  const [account, setAccount] = useState(undefined);
  const [config, setConfig] = useState(() => ({ googleClientId: null, brand: 'Nomadly', ...cachedConfig(), loaded: false }));

  const refresh = useCallback(() => api('/auth/me').then(r => setAccount(r.account)).catch(() => setAccount(null)), []);
  useEffect(() => {
    refresh();
    api('/auth/config').then((c) => {
      setConfig({ ...c, loaded: true });
      try { localStorage.setItem(CFG_KEY, JSON.stringify({ googleClientId: c.googleClientId || null, brand: c.brand })); } catch (_) { /* private mode */ }
    }).catch(() => setConfig((c) => ({ ...c, loaded: true })));
  }, [refresh]);

  const logout = useCallback(async () => {
    await api('/auth/logout', { method: 'POST' }).catch(() => {});
    try { for (const s of [localStorage, sessionStorage]) Object.keys(s).filter(k => k.startsWith('civr.quickDraft.') || k === 'civr.relayPrefs').forEach(k => s.removeItem(k)); } catch (_) { /* private mode */ }
    setAccount(null);
  }, []);

  return <Ctx.Provider value={{ account, setAccount, refresh, logout, config }}>{children}</Ctx.Provider>;
}

export const useCivrAuth = () => useContext(Ctx);
