import React from 'react';

const X_PATH = 'M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z';
const TG_PATH = 'M21.94 4.3 18.7 19.58c-.24 1.08-.88 1.35-1.79.84l-4.94-3.64-2.38 2.29c-.26.26-.48.48-.99.48l.35-5.02 9.14-8.26c.4-.35-.09-.55-.62-.2L6.17 13.2l-4.87-1.52c-1.06-.33-1.08-1.06.22-1.57L20.55 2.8c.88-.32 1.65.21 1.39 1.5z';

export const SOCIAL = [
  ['x', 'CloudIVR on X', 'https://x.com/CloudIVR', X_PATH],
  ['telegram', 'CloudIVR Telegram channel', 'https://t.me/CloudIVRNet', TG_PATH],
];

export function SocialLinks() {
  return (
    <div className="flex items-center gap-3 mt-6" data-testid="footer-social">
      {SOCIAL.map(([k, label, href, d]) => (
        <a key={k} href={href} target="_blank" rel="noopener noreferrer" aria-label={label} title={label}
          className="w-12 h-12 rounded-full border border-slate-300 text-slate-700 flex items-center justify-center hover:bg-slate-900 hover:text-white hover:border-slate-900 transition-colors"
          data-testid={`footer-social-${k}`}>
          <svg viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor" aria-hidden="true"><path d={d} /></svg>
        </a>
      ))}
    </div>
  );
}
