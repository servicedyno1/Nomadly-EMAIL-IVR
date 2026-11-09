import React from 'react';

// Hand-drawn style decorations for the landing page (JujuCloud-inspired). All decorative: aria-hidden.
const STAR = 'M12 0C13 7 17 11 24 12C17 13 13 17 12 24C11 17 7 13 0 12C7 11 11 7 12 0Z';

export const Sparkle = ({ className = '', delay = 0 }) => (
  <span className={`civr-twinkle absolute ${className}`} style={{ animationDelay: `${delay}s` }} aria-hidden="true">
    <svg viewBox="0 0 24 24" className="w-full h-full"><path d={STAR} fill="currentColor" /></svg>
  </span>
);

export const Squiggle = ({ className = 'text-[#a3e635]' }) => (
  <svg viewBox="0 0 200 16" preserveAspectRatio="none" className={`absolute left-0 -bottom-[0.14em] h-[0.24em] w-full ${className}`} fill="none" aria-hidden="true">
    <path d="M3 11C35 3 62 15 96 8S160 3 197 9" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
  </svg>
);

export const Circled = ({ children }) => (
  <span className="relative inline-block px-1 whitespace-nowrap">{children}
    <svg viewBox="0 0 220 70" preserveAspectRatio="none" className="absolute -inset-x-3 -inset-y-2 w-[calc(100%+1.5rem)] h-[calc(100%+1rem)] text-pink-500" fill="none" aria-hidden="true">
      <path d="M18 40C12 14 200 6 208 30C216 54 44 66 16 46C2 34 50 14 120 12" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  </span>
);

const S = { strokeWidth: 3, strokeLinecap: 'round', strokeLinejoin: 'round' };
const Handset = () => (
  <svg viewBox="0 0 120 120" className="w-full h-auto"><circle cx="63" cy="63" r="44" fill="rgba(15,23,42,.08)" />
    <circle cx="57" cy="57" r="44" fill="#e0edff" stroke="#1d4ed8" {...S} />
    <path d="M40 36c4-3 9-2 11 2l5 10c1 3 0 6-2 8l-4 3c3 7 8 12 15 15l3-4c2-2 5-3 8-2l10 5c4 2 5 7 2 11-4 5-10 8-17 6-18-5-31-18-36-36-2-7 1-14 5-18z" fill="#1d6fd8" stroke="#0f3a7a" strokeWidth="2.5" strokeLinejoin="round" />
  </svg>
);
const Keypad = () => (
  <svg viewBox="0 0 110 130" className="w-full h-auto"><rect x="22" y="18" width="78" height="104" rx="16" fill="rgba(15,23,42,.08)" />
    <rect x="16" y="12" width="78" height="104" rx="16" fill="#ecfccb" stroke="#3f6212" {...S} />
    {[0, 1, 2].flatMap(r => [0, 1, 2].map(c => <circle key={`${r}${c}`} cx={34 + c * 21} cy={36 + r * 22} r="7" fill={r === 1 && c === 1 ? '#ec4899' : '#65a30d'} />))}
    <rect x="34" y="96" width="42" height="9" rx="4.5" fill="#1d6fd8" />
  </svg>
);
const Bubble = () => (
  <svg viewBox="0 0 130 110" className="w-full h-auto"><path d="M22 20h88a10 10 0 0 1 10 10v44a10 10 0 0 1-10 10H58l-22 16 4-16H22a10 10 0 0 1-10-10V30a10 10 0 0 1 10-10z" fill="rgba(15,23,42,.08)" transform="translate(5 5)" />
    <path d="M22 20h88a10 10 0 0 1 10 10v44a10 10 0 0 1-10 10H58l-22 16 4-16H22a10 10 0 0 1-10-10V30a10 10 0 0 1 10-10z" fill="#fce7f3" stroke="#be185d" {...S} />
    <path d="M34 42h62M34 58h40" stroke="#be185d" {...S} /><circle cx="104" cy="24" r="6" fill="#a3e635" />
  </svg>
);
const Sim = () => (
  <svg viewBox="0 0 100 120" className="w-full h-auto"><path d="M26 16h40l20 20v68a8 8 0 0 1-8 8H26a8 8 0 0 1-8-8V24a8 8 0 0 1 8-8z" fill="rgba(15,23,42,.08)" transform="translate(5 5)" />
    <path d="M26 16h40l20 20v68a8 8 0 0 1-8 8H26a8 8 0 0 1-8-8V24a8 8 0 0 1 8-8z" fill="#e0f2fe" stroke="#0369a1" {...S} />
    <rect x="32" y="52" width="40" height="40" rx="6" fill="#38bdf8" stroke="#0369a1" strokeWidth="2.5" /><path d="M52 52v40M32 72h40" stroke="#0369a1" strokeWidth="2.5" />
  </svg>
);

const ART = [
  [Handset, 'left-[3%] top-24 w-24 xl:left-[7%] xl:w-28', '-8deg', 0],
  [Keypad, 'left-[8%] top-[25rem] w-14 xl:left-[11%] xl:w-16', '10deg', -2],
  [Bubble, 'right-[3%] top-24 w-24 xl:right-[7%] xl:w-28', '8deg', -1],
  [Sim, 'right-[7%] top-[24rem] w-16 xl:right-[11%] xl:w-20', '-6deg', -3],
];

// Blobs, floating telecom drawings and sparkles behind the hero.
export function HeroDecor() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true" data-testid="hero-decor">
      <div className="absolute inset-x-0 top-0 h-[32rem] bg-gradient-to-b from-[#edf4ff] via-[#f5f9ff] to-transparent" />
      <div className="absolute -right-24 -top-24 h-96 w-96 rounded-full bg-[#d9f99d]/40 blur-3xl" />
      <div className="absolute -left-24 top-24 h-96 w-96 rounded-full bg-[#bfdbfe]/50 blur-3xl" />
      {ART.map(([A, pos, r, d], i) => <span key={i} className={`civr-float absolute hidden lg:block ${pos}`} style={{ '--r': r, animationDelay: `${d}s` }}><A /></span>)}
      <Sparkle className="hidden sm:block left-[18%] top-28 w-4 h-4 text-lime-500" />
      <Sparkle className="hidden sm:block left-[5%] top-72 w-3 h-3 text-pink-400" delay={-1.2} />
      <Sparkle className="hidden sm:block right-[20%] top-32 w-5 h-5 text-[#1d6fd8]" delay={-0.6} />
      <Sparkle className="hidden sm:block right-[4%] top-[21rem] w-3 h-3 text-lime-500" delay={-1.8} />
      <Sparkle className="left-[24%] top-[30rem] hidden lg:block w-3 h-3 text-sky-400" delay={-2.4} />
      <Sparkle className="right-[24%] top-[31rem] hidden lg:block w-4 h-4 text-pink-400" delay={-0.3} />
    </div>
  );
}
