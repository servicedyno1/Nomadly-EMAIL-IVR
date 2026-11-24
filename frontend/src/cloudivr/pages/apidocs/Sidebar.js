import React, { useEffect, useState } from 'react';
import { NAV } from './content';

const IDS = NAV.flatMap(([, items]) => items.map(([id]) => id));

// Section list with scroll-spy (desktop sidebar; on mobile a horizontal chip bar).
export function Sidebar() {
  const [active, setActive] = useState(IDS[0]);
  useEffect(() => {
    const obs = new IntersectionObserver((entries) => {
      const vis = entries.filter(e => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (vis) setActive(vis.target.id);
    }, { rootMargin: '-80px 0px -65% 0px' });
    IDS.forEach(id => { const el = document.getElementById(id); if (el) obs.observe(el); });
    const atEnd = () => { if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4) setActive(IDS[IDS.length - 1]); };
    window.addEventListener('scroll', atEnd, { passive: true });
    return () => { obs.disconnect(); window.removeEventListener('scroll', atEnd); };
  }, []);
  useEffect(() => { document.querySelector(`[data-testid="api-docs-chip-${active}"]`)?.scrollIntoView({ block: 'nearest', inline: 'center' }); }, [active]);
  const link = (id, label) => (
    <a key={id} href={`#${id}`} onClick={() => setActive(id)} className={`block text-sm px-3 py-1.5 rounded-md transition-colors ${active === id ? 'bg-emerald-50 text-emerald-800 font-medium' : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'}`} data-testid={`api-docs-nav-${id}`}>{label}</a>
  );
  return (
    <>
      <nav className="hidden lg:block sticky top-24 self-start w-56 shrink-0 space-y-6" data-testid="api-docs-sidebar">
        {NAV.map(([group, items]) => (
          <div key={group}><div className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold px-3 mb-1.5">{group}</div>{items.map(([id, l]) => link(id, l))}</div>
        ))}
      </nav>
      <nav className="lg:hidden sticky top-16 z-30 -mx-4 px-4 py-2 bg-white/90 backdrop-blur border-b border-slate-200 flex gap-1 overflow-x-auto" data-testid="api-docs-mobile-nav">
        {NAV.flatMap(([, items]) => items).map(([id, l]) => <a key={id} href={`#${id}`} onClick={() => setActive(id)} className={`shrink-0 text-xs px-3 py-1.5 rounded-full ${active === id ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-600'}`} data-testid={`api-docs-chip-${id}`}>{l}</a>)}
      </nav>
    </>
  );
}
