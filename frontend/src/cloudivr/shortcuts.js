import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { pageOf } from './pages/help/topics';
import { appPath } from './nav';
import { confirmLeave } from './guard';

export const OPEN_HELP_CHAT = 'civr:open-help-chat';
export const openHelpChat = () => window.dispatchEvent(new Event(OPEN_HELP_CHAT));
export const SHORTCUTS = [['/', 'Jump to the search box on this page'], ['?', 'Open help for this page'], ['Esc', 'Close a dialog, a menu or the browser phone']];

// Help center link for the screen the user is on (opens the articles for that page first).
export function helpFor(pathname, search) {
  const { topic } = pageOf(pathname, search);
  return appPath(topic && topic !== 'help' && topic !== 'landing' ? `help?topic=${topic}` : 'help');
}

const typing = (el) => !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));

// Mounted once in the app shell: "/" search, "?" help, Esc closes the browser phone (dialogs handle their own Esc).
export function Shortcuts({ onEscape }) {
  const nav = useNavigate();
  const { pathname, search } = useLocation();
  useEffect(() => {
    const key = (e) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'Escape') { onEscape(); return; }
      if (typing(e.target) || document.querySelector('[role="alertdialog"]')) return;
      if (e.key === '/') {
        const box = [...document.querySelectorAll('[data-search-box]')].find(el => el.offsetParent !== null);
        if (box) { e.preventDefault(); box.focus(); box.select(); }
      } else if (e.key === '?') {
        e.preventDefault();
        confirmLeave().then(ok => { if (ok) nav(helpFor(pathname, search)); });
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [nav, pathname, search, onEscape]);
  return null;
}
