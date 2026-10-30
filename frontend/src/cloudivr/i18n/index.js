import React, { createContext, useContext, useEffect, useLayoutEffect, useReducer, useState } from 'react';
import { Globe, ChevronDown, Check } from 'lucide-react';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '../../components/ui/dropdown-menu';
import { setDictionary, tr } from './engine';
import { Flag } from '../Pickers';
const LANG_FLAG = { en: 'us', fr: 'fr', es: 'es' };

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
// Styled confirm dialog (confirm.js); kept here so pages keep importing it from i18n.
export { ask } from '../confirm';
// Re-renders after the new page language is applied, so dates formatted with the page language follow it.
export function useLangTick() {
  const { lang } = useLang();
  const [, tick] = useReducer(n => n + 1, 0);
  useEffect(() => { tick(); }, [lang]);
  return lang;
}

export function LangProvider({ children }) {
  const [lang, setLangState] = useState(initial);
  const [ready, setReady] = useState(initial === 'en');
  const [ver, setVer] = useState(0);
  useLayoutEffect(() => {
    let live = true;
    document.documentElement.lang = lang;
    if (lang === 'en') { setDictionary(null); setReady(true); setVer(v => v + 1); return undefined; }
    const timer = setTimeout(() => live && setReady(true), 2500);
    ((lang === initial && early) || LOADERS[lang]()).then(m => { if (live) { setDictionary(m.default || m); setReady(true); setVer(v => v + 1); } }).catch(() => live && setReady(true));
    return () => { live = false; clearTimeout(timer); };
  }, [lang]);
  useEffect(() => () => setDictionary(null), []);
  const setLang = (l) => { try { localStorage.setItem(KEY, l); } catch (_) { /* ignore */ } setLangState(l); };
  return (
    <LangCtx.Provider value={{ lang, setLang, ver }}>
      <div style={ready ? undefined : { visibility: 'hidden' }}>{children}</div>
    </LangCtx.Provider>
  );
}

// A real menu (not a hidden native <select>, which some browsers never open): tap the pill, pick a language.
const TONES = {
  landing: { pill: 'text-slate-600 hover:text-slate-900 hover:bg-slate-100 data-[state=open]:bg-slate-100 data-[state=open]:text-slate-900 focus-visible:ring-slate-900/30', menu: 'bg-white text-slate-900 border-slate-200 shadow-[0_20px_50px_-20px_rgba(15,23,42,.35)]', item: 'focus:bg-slate-100 focus:text-slate-900', on: 'text-slate-900' },
  app: { pill: 'text-[#d4d4d8] hover:text-white hover:bg-white/5 data-[state=open]:bg-white/5 data-[state=open]:text-white focus-visible:ring-[#818cf8]/50', menu: 'civr !min-h-0 !bg-[var(--c-card)] !text-[var(--c-text)] !border-[var(--c-border)] shadow-xl', item: 'focus:!bg-[var(--c-accent-soft)] focus:!text-[var(--c-text)]', on: 'text-[var(--c-accent)]' },
};

export function LangSwitcher({ testid = 'lang-switcher', className = '', tone = 'app' }) {
  const { lang, setLang } = useLang();
  const t = TONES[tone] || TONES.app;
  const name = (LANGS.find(([c]) => c === lang) || LANGS[0])[1];
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button type="button" aria-label={`Language: ${name}`} title="Language" className={`group inline-flex items-center gap-1.5 h-11 px-2.5 rounded-full transition-colors outline-none focus-visible:ring-2 ${t.pill} ${className}`} data-no-translate data-testid={testid}>
          {LANG_FLAG[lang] ? <Flag code={LANG_FLAG[lang]} className="!w-5 !h-[15px]" /> : <Globe className="w-4 h-4 shrink-0" />}
          <span className={`text-sm font-medium hidden ${tone === 'landing' ? 'xl:inline' : 'sm:inline'}`}>{name}</span><span className={`text-sm font-semibold uppercase ${tone === 'landing' ? 'xl:hidden' : 'sm:hidden'}`}>{lang}</span>
          <ChevronDown className="w-3.5 h-3.5 opacity-70 transition-transform duration-200 group-data-[state=open]:rotate-180" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={8} className={`z-[100] min-w-[11rem] rounded-xl p-1.5 font-['DM_Sans',sans-serif] ${t.menu}`} data-no-translate data-testid={`${testid}-menu`}>
        {LANGS.map(([c, n]) => (
          <DropdownMenuItem key={c} onSelect={() => setLang(c)} aria-current={c === lang ? 'true' : undefined} className={`min-h-[40px] rounded-lg px-3 text-sm font-medium cursor-pointer ${t.item}`} data-testid={`${testid}-option-${c}`}>
            <Flag code={LANG_FLAG[c]} className="!w-5 !h-[15px] mr-2.5" /><span className="flex-1">{n}</span>{c === lang && <Check className={`w-4 h-4 ${t.on}`} />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
