import React, { createContext, useContext, useEffect, useLayoutEffect, useState } from 'react';
import { Globe } from 'lucide-react';
import { setDictionary, tr } from './engine';

export { tr };
export const LANGS = [['en', 'English'], ['fr', 'Français'], ['es', 'Español']];
const KEY = 'civr.lang';
const LOADERS = { fr: () => import('./fr.json'), es: () => import('./es.json') };

// Saved choice first, then the browser's languages, else English.
export function detectLang() {
  try { const s = localStorage.getItem(KEY); if (LOADERS[s] || s === 'en') return s; } catch (_) { /* private mode */ }
  const prefs = (navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || 'en']);
  for (const p of prefs) { const c = String(p).slice(0, 2).toLowerCase(); if (c === 'en' || LOADERS[c]) return c; }
  return 'en';
}

const initial = detectLang();
const early = LOADERS[initial] ? LOADERS[initial]() : null;
const LangCtx = createContext({ lang: 'en', setLang: () => {} });
export const useLang = () => useContext(LangCtx);
export const ask = (msg) => window.confirm(tr(msg));

export function LangProvider({ children }) {
  const [lang, setLangState] = useState(initial);
  const [ready, setReady] = useState(initial === 'en');
  useLayoutEffect(() => {
    let live = true;
    document.documentElement.lang = lang;
    if (lang === 'en') { setDictionary(null); setReady(true); return undefined; }
    const timer = setTimeout(() => live && setReady(true), 2500);
    ((lang === initial && early) || LOADERS[lang]()).then(m => { if (live) { setDictionary(m.default || m); setReady(true); } }).catch(() => live && setReady(true));
    return () => { live = false; clearTimeout(timer); };
  }, [lang]);
  useEffect(() => () => setDictionary(null), []);
  const setLang = (l) => { try { localStorage.setItem(KEY, l); } catch (_) { /* ignore */ } setLangState(l); };
  return (
    <LangCtx.Provider value={{ lang, setLang }}>
      <div style={ready ? undefined : { visibility: 'hidden' }}>{children}</div>
    </LangCtx.Provider>
  );
}

export function LangSwitcher({ testid = 'lang-switcher', className = '', tone = 'app' }) {
  const { lang, setLang } = useLang();
  const dark = tone === 'landing' ? 'bg-transparent text-[#FEFDF5]/80 hover:text-[#00E3AA]' : 'bg-transparent text-[#a1a1aa] hover:text-white';
  return (
    <label className={`relative inline-flex items-center gap-1 h-11 px-2 rounded-full cursor-pointer ${dark} ${className}`} data-no-translate title="Language">
      <Globe className="w-4 h-4 shrink-0" />
      <select value={lang} onChange={e => setLang(e.target.value)} aria-label="Language" className="bg-transparent text-sm font-medium cursor-pointer outline-none appearance-none pr-1" data-testid={testid}>
        {LANGS.map(([c, name]) => <option key={c} value={c} className="bg-[#111] text-white normal-case">{name}</option>)}
      </select>
    </label>
  );
}
