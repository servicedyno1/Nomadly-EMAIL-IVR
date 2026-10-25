import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { NAV_ITEMS } from './nav';
import { CIVR_BASE } from './paths';
import { tr, useLang } from './i18n';

export const HOME_TITLE = 'CloudIVR — Virtual phone numbers, IVR & AI voice agents';
const PAGES = { login: 'Sign in', signup: 'Create account', forgot: 'Reset password', 'reset-password': 'Choose a new password', app: 'Overview' };
const APP = [
  [/^numbers\/[^/]+$/, 'Number settings'], [/^orders\//, 'Order status'], [/^verification/, 'Number verification'],
  [/^ai-agents\/new$/, 'New agent'], [/^ai-agents\/[^/]+$/, 'Edit agent'], [/^campaigns\/new$/, 'New campaign'],
  [/^campaigns\/[^/]+$/, 'Campaign report'], [/^admin\/suggestions/, 'Suggestions inbox'],
];

export function pageName(pathname) {
  const p = pathname.slice(CIVR_BASE.length).replace(/^\/+|\/+$/g, '');
  if (PAGES[p]) return PAGES[p];
  if (!p.startsWith('app/')) return null;
  const sub = p.slice(4);
  const hit = APP.find(([re]) => re.test(sub));
  return hit ? hit[1] : NAV_ITEMS.find(([path]) => path === sub)?.[1] || null;
}

// Browser tab: "Page name · CloudIVR" in the page language; the landing page keeps the full product title.
export function PageTitle() {
  const { pathname } = useLocation();
  const { lang, ver } = useLang();
  useEffect(() => {
    const name = pageName(pathname);
    document.title = name ? `${tr(name)} · CloudIVR` : tr(HOME_TITLE);
  }, [pathname, lang, ver]);
  return null;
}
