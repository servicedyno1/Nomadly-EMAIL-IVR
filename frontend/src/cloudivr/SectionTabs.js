import React from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { sectionOf, appPath } from './nav';

// Tab strip shown on merged sidebar sections (Numbers, Calls, Campaigns).
export default function SectionTabs() {
  const { pathname } = useLocation();
  const sec = sectionOf(pathname);
  if (!sec) return null;
  return (
    <nav aria-label={`${sec[1]} sections`} className="civr-tabs -mt-2 mb-6 flex gap-1 overflow-x-auto border-b border-[#1f1f1f] [scrollbar-width:none]" data-testid={`section-tabs-${sec[3].replace('nav-', '')}`}>
      {sec[4].map(([to, label, Icon, id]) => (
        <NavLink key={id} to={appPath(to)} className={({ isActive }) => `shrink-0 inline-flex items-center gap-2 px-3.5 min-h-[44px] text-sm font-medium border-b-2 -mb-px transition-colors ${isActive || pathname.startsWith(`${appPath(to)}/`) ? 'border-[var(--c-accent-strong,#6366f1)] text-[var(--c-text,#f4f4f5)]' : 'border-transparent text-[#a1a1aa] hover:text-[var(--c-text,#f4f4f5)]'}`} data-testid={id}>
          <Icon className="w-4 h-4" />{label}
        </NavLink>
      ))}
    </nav>
  );
}
