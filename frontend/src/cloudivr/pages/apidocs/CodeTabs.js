import React, { useState } from 'react';
import { Check, Copy } from 'lucide-react';

const LANG_KEY = 'civr-api-docs-lang';

export function CopyBtn({ text, testid }) {
  const [done, setDone] = useState(false);
  const copy = () => navigator.clipboard?.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1500); });
  return (
    <button type="button" onClick={copy} className="inline-flex items-center gap-1.5 text-xs text-slate-300 hover:text-white px-2 py-1 rounded-md hover:bg-white/10 transition-colors" data-testid={testid} aria-label="Copy code">
      {done ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}{done ? 'Copied' : 'Copy'}
    </button>
  );
}

// Dark code panel; with several samples it shows language tabs (choice remembered across the page).
export function CodeTabs({ samples, title, testid }) {
  const langs = Object.keys(samples);
  const [lang, setLang] = useState(() => (langs.includes(localStorage.getItem(LANG_KEY)) ? localStorage.getItem(LANG_KEY) : langs[0]));
  const pick = (l) => { setLang(l); localStorage.setItem(LANG_KEY, l); window.dispatchEvent(new Event('civr-api-lang')); };
  React.useEffect(() => {
    const sync = () => { const l = localStorage.getItem(LANG_KEY); if (langs.includes(l)) setLang(l); };
    window.addEventListener('civr-api-lang', sync);
    return () => window.removeEventListener('civr-api-lang', sync);
  }, [langs.join()]); // eslint-disable-line react-hooks/exhaustive-deps
  const code = samples[lang] ?? samples[langs[0]];
  return (
    <div className="rounded-xl bg-slate-950 ring-1 ring-slate-800 overflow-hidden" data-testid={testid}>
      <div className="flex items-center gap-1 px-2 h-10 border-b border-slate-800">
        {title && <span className="text-xs text-slate-400 px-2 mr-auto">{title}</span>}
        {langs.length > 1 && <div className={`flex gap-1 ${title ? '' : 'mr-auto'}`}>{langs.map(l => (
          <button key={l} type="button" onClick={() => pick(l)} className={`text-xs px-2.5 py-1 rounded-md transition-colors ${l === lang ? 'bg-white/10 text-white' : 'text-slate-400 hover:text-slate-200'}`} data-testid={`${testid}-tab-${l.replace(/\W/g, '').toLowerCase()}`}>{l}</button>
        ))}</div>}
        <CopyBtn text={code} testid={`${testid}-copy`} />
      </div>
      <pre className="text-[12.5px] leading-relaxed text-slate-100 p-4 overflow-x-auto"><code>{code}</code></pre>
    </div>
  );
}
