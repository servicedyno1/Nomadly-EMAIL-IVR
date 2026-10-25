import React from 'react';
import { IS_CIVR_DOMAIN } from './paths';

export const BRAND = {
  icon: '/civr/brand/parrot-icon-128.png',
  mark: '/civr/brand/parrot-mark.webp',
  favicon: '/civr/brand/parrot-icon-48.png',
  touchIcon: '/civr/brand/apple-touch-icon.png',
  notifyIcon: '/civr/brand/icon-192.png',
};

// Parrot icon + CLOUDIVR wordmark; the parent link supplies font size and spacing.
export function Wordmark({ accent = '#34d399', iconClass = 'w-8 h-8' }) {
  return (
    <>
      <img src={BRAND.icon} alt="" aria-hidden="true" className={`${iconClass} shrink-0 civr-logo-icon`} />
      <span>CLOUD<span style={{ color: accent }}>IVR</span></span>
    </>
  );
}

const HEAD = [
  ['link', { rel: 'icon', type: 'image/png', href: BRAND.favicon }],
  ['link', { rel: 'apple-touch-icon', href: BRAND.touchIcon }],
  ['meta', { name: 'theme-color', content: '#0a0a0a' }],
  // Installable app (Add to Home Screen): the manifest matches where the app is mounted (own domain or /cloudivr).
  ['link', { rel: 'manifest', href: IS_CIVR_DOMAIN ? '/civr/manifest.webmanifest' : '/civr/manifest-prefixed.webmanifest' }],
  ['meta', { name: 'apple-mobile-web-app-capable', content: 'yes' }],
  ['meta', { name: 'mobile-web-app-capable', content: 'yes' }],
  ['meta', { name: 'apple-mobile-web-app-title', content: 'CloudIVR' }],
  ['meta', { name: 'apple-mobile-web-app-status-bar-style', content: 'black-translucent' }],
];

// CloudIVR tab icon / home-screen icon while its pages are open; the previous tags come back on leave.
export function applyBrandHead() {
  const added = [], removed = [];
  for (const [tag, attrs] of HEAD) {
    const sel = tag === 'meta' ? `meta[name="${attrs.name}"]` : `link[rel="${attrs.rel}"]`;
    document.head.querySelectorAll(sel).forEach((el) => { removed.push(el); el.remove(); });
    const el = document.createElement(tag);
    Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
    document.head.appendChild(el);
    added.push(el);
  }
  return () => { added.forEach((el) => el.remove()); removed.forEach((el) => document.head.appendChild(el)); };
}
