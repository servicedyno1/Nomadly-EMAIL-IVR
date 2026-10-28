import React, { useEffect, useState } from 'react';
import './theme-light.css';
import './theme-clean.css';
import { Sun, Moon } from 'lucide-react';

// In-app light/dark: 'system' (follow the device) | 'light' | 'dark', kept on this device like language.
const KEY = 'civr.theme';
const subs = new Set();
const read = () => { try { return localStorage.getItem(KEY) || 'system'; } catch (_) { return 'system'; } };
let pref = read();
const mq = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-color-scheme: light)') : null;
const resolve = () => (pref === 'system' ? (mq?.matches ? 'light' : 'dark') : pref);

export function setThemePref(p) {
  pref = p;
  try { localStorage.setItem(KEY, p); } catch (_) { /* private browsing */ }
  subs.forEach(f => f());
}

export function useTheme() {
  const [, tick] = useState(0);
  useEffect(() => {
    const f = () => tick(x => x + 1);
    subs.add(f); mq?.addEventListener?.('change', f);
    return () => { subs.delete(f); mq?.removeEventListener?.('change', f); };
  }, []);
  return { pref, theme: resolve(), setPref: setThemePref };
}

// Mounted by the app shell only (the public site keeps its own look).
export function ThemeRoot() {
  const { theme } = useTheme();
  useEffect(() => {
    document.documentElement.dataset.civrTheme = theme;
    document.documentElement.style.colorScheme = theme;
    return () => { delete document.documentElement.dataset.civrTheme; document.documentElement.style.colorScheme = ''; };
  }, [theme]);
  return null;
}

export function ThemeButton({ className = '' }) {
  const { theme } = useTheme();
  const next = theme === 'light' ? 'dark' : 'light';
  const Icon = theme === 'light' ? Moon : Sun;
  const tip = `Switch to ${next} mode`;
  return <button type="button" onClick={() => setThemePref(next)} aria-label={tip} title={tip} className={className} data-testid="topbar-theme-button" data-theme={theme}><Icon className="w-5 h-5" /></button>;
}

export const THEME_OPTIONS = [['system', 'Match my device'], ['light', 'Light'], ['dark', 'Dark']];
