import React, { createContext, useContext, useEffect, useLayoutEffect, useState } from 'react';
import { Globe, ChevronDown } from 'lucide-react';
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

// The native <select> covers the whole pill, so a tap on the globe, the name or the arrow opens the list.
export function LangSwitcher({ testid = 'lang-switcher', className = '', tone = 'app' }) {
  const { lang, setLang } = useLang();
  const color = tone === 'landing' ? 'text-[#FEFDF5]/85 hover:text-[#00E3AA] hover:bg-white/5' : 'text-[#d4d4d8] hover:text-white hover:bg-white/5';
  const name = (LANGS.find(([c]) => c === lang) || LANGS[0])[1];
  return (
    <div className={`relative inline-flex items-center gap-1.5 h-11 px-2.5 rounded-full transition-colors focus-within:ring-2 focus-within:ring-[#34d399]/50 ${color} ${className}`} data-no-translate title="Language">
      <Globe className="w-4 h-4 shrink-0" />
      <span className="text-sm font-medium hidden sm:inline">{name}</span><span className="text-sm font-semibold uppercase sm:hidden">{lang}</span>
      <ChevronDown className="w-3.5 h-3.5 opacity-70" />
      <select value={lang} onChange={e => setLang(e.target.value)} aria-label="Language" className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" data-testid={testid}>
        {LANGS.map(([c, n]) => <option key={c} value={c} className="bg-[#111] text-white">{n}</option>)}
      </select>
    </div>
  );
}
