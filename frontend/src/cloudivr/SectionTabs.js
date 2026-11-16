import React, { useEffect, useRef } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { groupOf, appPath, isSideActive } from './nav';
import { pageName } from './PageTitle';
import { CIVR_BASE } from './paths';

// Phones/tablets (no sidebar): the other pages of the current menu group as a tab strip.
export default function SectionTabs() {
  const { pathname, search } = useLocation();
  const [g] = groupOf(pathname, search);
  const ref = useRef(null);
  useEffect(() => { ref.current?.querySelector('[aria-current="page"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }, [pathname, search]);
  const items = g ? g[2].filter(i => i[0] !== '#phone') : [];
  if (!g || g[0] === 'home' || g[0] === 'account' || items.length < 2) return null;
  return (
    <div className="lg:hidden relative -mt-2 mb-6">
      <span aria-hidden className="md:hidden pointer-events-none absolute right-0 top-0 bottom-px w-10 z-10 bg-gradient-to-l from-[var(--c-bg,#0a0a0a)] to-[color-mix(in_srgb,var(--c-bg,#0a0a0a)_0%,transparent)]" />
      <nav ref={ref} aria-label={`${g[1]} pages`} className="civr-tabs flex pr-8 md:pr-0 gap-1 overflow-x-auto border-b border-[#1f1f1f] [scrollbar-width:none]" data-testid={`section-tabs-${g[0]}`}>
        {items.map((it) => { const [to, label, Icon, id] = it; const on = isSideActive(it, pathname, search); return (
          <NavLink key={id} to={appPath(to)} aria-current={on ? 'page' : undefined} className={`shrink-0 inline-flex items-center gap-2 px-3.5 min-h-[44px] text-sm font-medium border-b-2 -mb-px transition-colors ${on ? 'border-[var(--c-accent-strong,#6366f1)] text-[var(--c-text,#f4f4f5)]' : 'border-transparent text-[#a1a1aa] hover:text-[var(--c-text,#f4f4f5)]'}`} data-testid={`tab-${id.replace('nav-', '')}`}>
            <Icon className="w-4 h-4" />{label}
          </NavLink>
        ); })}
      </nav>
    </div>
  );
}

// "Phone numbers › My numbers › +1 334…" — items are [label, to?].
export function Crumbs({ items, testid = 'breadcrumbs' }) {
  return (
    <nav aria-label="Breadcrumb" className="civr-crumbs flex flex-wrap items-center gap-1 text-sm text-[#a1a1aa] mb-4 -mt-2" data-testid={testid}>
      {items.map(([label, to], i) => (
        <React.Fragment key={`${label}-${i}`}>
          {i > 0 && <ChevronRight className="w-3.5 h-3.5 opacity-60 shrink-0" aria-hidden="true" />}
          {to ? <Link to={to} className="inline-flex items-center min-h-[32px] hover:text-[var(--c-accent)] transition-colors" data-testid={`${testid}-${i}`}>{label}</Link>
            : <span aria-current={i === items.length - 1 ? 'page' : undefined} className="text-[var(--c-text)] font-medium break-words max-w-[60vw]" data-testid={`${testid}-${i}`}>{label}</span>}
        </React.Fragment>
      ))}
    </nav>
  );
}

// Sub-pages (a campaign, an agent, an order…) get "Group › Page › This item". Number settings render their own.
export function AutoCrumbs() {
  const { pathname, search } = useLocation();
  const sub = pathname.slice(CIVR_BASE.length).replace(/^\/+|\/+$/g, '').replace(/^app\/?/, '');
  const [g, it] = groupOf(pathname, search);
  if (!g || !sub.includes('/') || /^(numbers|esim)\//.test(sub) || /^answer\//.test(sub)) return null;
  return <Crumbs items={[[g[1]], [it[1], appPath(it[0])], [pageName(pathname) || '']]} />;
}
