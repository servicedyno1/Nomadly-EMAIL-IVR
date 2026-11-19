import React, { useEffect, useRef } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { groupOf, appPath, isTabActive, HUBS } from './nav';
import { pageName } from './PageTitle';
import { CIVR_BASE } from './paths';

// Pages that share one menu entry (e.g. My numbers · Answering rules · SIP logins) as tabs, on every screen size.
export default function SectionTabs() {
  const { pathname, search } = useLocation();
  const [, it] = groupOf(pathname, search);
  const ref = useRef(null);
  useEffect(() => { ref.current?.querySelector('[aria-current="page"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }, [pathname]);
  const tabs = it ? HUBS[it[3]] : null;
  const sub = pathname.slice(appPath('').length).replace(/^\/+/, '');
  // Only on the hub pages themselves, not inside one number, agent or campaign.
  if (!tabs || !tabs.some(([p]) => sub === p) ) return null;
  return (
    <div className="relative -mt-2 mb-6">
      <nav ref={ref} aria-label={`${it[1]} pages`} className="civr-tabs flex gap-1 overflow-x-auto border-b border-[var(--c-border,#1f1f1f)] [scrollbar-width:none]" data-testid={`hub-tabs-${it[3].replace('nav-', '')}`}>
        {tabs.map(([to, label, Icon]) => { const on = isTabActive(to, pathname); return (
          <NavLink key={to} to={appPath(to)} aria-current={on ? 'page' : undefined} className={`shrink-0 inline-flex items-center gap-2 px-3.5 min-h-[44px] text-sm font-medium border-b-2 -mb-px transition-colors ${on ? 'border-[var(--c-accent-strong,#6366f1)] text-[var(--c-text,#f4f4f5)]' : 'border-transparent text-[var(--c-muted,#a1a1aa)] hover:text-[var(--c-text,#f4f4f5)]'}`} data-testid={`hub-tab-${to.replace(/\//g, '-')}`}>
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
    <nav aria-label="Breadcrumb" className="civr-crumbs flex flex-wrap items-center gap-1 text-sm text-[var(--c-muted,#a1a1aa)] mb-4 -mt-2" data-testid={testid}>
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
