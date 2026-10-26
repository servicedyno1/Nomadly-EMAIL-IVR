import React, { useEffect, useMemo, useRef, useState } from 'react';
import { geoPath } from 'd3-geo';
import { feature } from 'topojson-client';
import { Globe2, Flame } from 'lucide-react';

const NAME = { 'Washington DC': 'District of Columbia' };
const SHADES = ['#1a1a24', '#241b40', '#3b206e', '#581c87', '#6d28d9'];
const path = geoPath();
const slug = (s) => s.toLowerCase().replace(/[^a-z]+/g, '-').replace(/^-|-$/g, '');
let atlas = null;

// US states, pre-projected (Albers USA, 975×610), loaded once on first use.
function useStates() {
  const [states, setStates] = useState(atlas);
  useEffect(() => {
    if (atlas) return undefined;
    let on = true;
    import('us-atlas/states-albers-10m.json').then((m) => {
      const t = m.default || m;
      atlas = feature(t, t.objects.states).features.map(f => ({ name: f.properties.name, d: path(f), c: path.centroid(f) }));
      if (on) setStates(atlas);
    }).catch(() => {});
    return () => { on = false; };
  }, []);
  return states;
}

const rate = (a) => (a.calls ? `${Math.round((a.answered / a.calls) * 100)}% answered` : 'No finished calls yet');

// Written with createElement (no JSX): the dev visual-edits babel plugin wraps mapped JSX in <span>s, which break SVG.
const h = React.createElement;
function MapSvg({ states, by, shade, live, move, focus, blur }) {
  const paths = states.map((s) => {
    const a = by[s.name];
    return h('path', { key: s.name, d: s.d, fill: shade(a?.calls || 0), stroke: '#0a0a0a', strokeWidth: 0.9, className: 'civr-map-state', tabIndex: a ? 0 : -1, 'aria-label': a ? `${s.name}: ${a.calls} calls today` : s.name, onMouseMove: (e) => move(e, s), onFocus: () => focus(s), onBlur: blur, 'data-testid': `live-map-state-${slug(s.name)}` });
  });
  const dots = live.map(s => h('g', { key: s.name, transform: `translate(${s.c[0]} ${s.c[1]})`, 'data-testid': `live-map-dot-${slug(s.name)}` },
    h('circle', { r: 6, fill: '#34d399', className: 'civr-map-ping' }),
    h('circle', { r: 5, fill: '#34d399', stroke: '#0a0a0a', strokeWidth: 1.5 })));
  return h('svg', { viewBox: '0 0 975 610', className: 'w-full h-auto', role: 'img', 'aria-label': 'Map of today’s calls by US state', 'data-testid': 'live-map' },
    h('g', null, paths), h('g', { pointerEvents: 'none' }, dots));
}

function Tip({ tip }) {
  const a = tip.a || { calls: 0, answered: 0, live: 0 };
  return (
    <div className="absolute z-10 pointer-events-none -translate-x-1/2 -translate-y-[calc(100%+14px)] rounded-xl border border-[#2a2a2a] bg-[#111]/95 backdrop-blur px-3 py-2.5 shadow-xl min-w-[11rem] civr-pop" style={{ left: `${tip.x}%`, top: `${tip.y}%` }} data-testid="live-map-tooltip">
      <div className="text-sm font-semibold">{tip.name}</div>
      <div className="text-xs text-[#a1a1aa] mt-1 font-mono">{`${a.calls} calls today · ${rate(a)}`}</div>
      {a.live > 0 && <div className="text-xs text-[#34d399] mt-1 flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-[#34d399] civr-pulse" />{`${a.live} calling now`}</div>}
    </div>
  );
}

function Side({ title, Icon, list, empty, testid }) {
  return (
    <div data-testid={testid}>
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[.12em] text-[#a1a1aa]"><Icon className="w-3.5 h-3.5" />{title}</div>
      {!list.length ? <div className="text-xs text-[#71717a] mt-3">{empty}</div> : (
        <ul className="mt-3 flex flex-col gap-2">
          {list.map((a, i) => (
            <li key={a.area} className="flex items-center gap-2 text-sm min-w-0" data-testid={`${testid}-${i}`}>
              <span className={`w-2 h-2 rounded-full shrink-0 ${a.live ? 'bg-[#34d399] civr-live-dot' : 'bg-[#6d28d9]'}`} />
              <span className="truncate">{a.area}</span>
              <span className="ml-auto font-mono text-xs text-[#a1a1aa] shrink-0">{a.calls}{a.live ? <span className="text-[#34d399]">{` · ${a.live} live`}</span> : ''}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// Live page map: states shaded by today's calls, pulsing dots where calls are ringing or talking now.
export function LiveMap({ map = [] }) {
  const states = useStates();
  const box = useRef(null);
  const [tip, setTip] = useState(null);
  const by = useMemo(() => Object.fromEntries(map.map(a => [NAME[a.area] || a.area, a])), [map]);
  const us = useMemo(() => new Set((states || []).map(s => s.name)), [states]);
  const max = Math.max(1, ...map.map(a => a.calls));
  const shade = (n) => (n ? SHADES[Math.min(4, 1 + Math.floor((n / max) * 3.999))] : SHADES[0]);
  const move = (e, s) => { const r = box.current.getBoundingClientRect(); setTip({ name: s.name, a: by[s.name], x: ((e.clientX - r.left) / r.width) * 100, y: ((e.clientY - r.top) / r.height) * 100 }); };
  const focus = (s) => setTip({ name: s.name, a: by[s.name], x: (s.c[0] / 975) * 100, y: (s.c[1] / 610) * 100 });
  const live = (states || []).filter(s => by[s.name]?.live > 0);
  const outside = states ? map.filter(a => !us.has(NAME[a.area] || a.area)) : [];
  return (
    <div className="civr-card p-5 sm:p-6 mb-6 civr-rise" data-testid="live-map-card">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3 mb-4">
        <div>
          <div className="font-display text-xl font-bold">Where your calls are</div>
          <div className="text-xs text-[#a1a1aa] mt-1">Today, by state — from each number’s area code. Hover a state for details.</div>
        </div>
        <div className="flex items-center gap-4 text-xs text-[#a1a1aa]" data-testid="live-map-legend">
          <span className="flex items-center gap-2">Fewer<span className="flex">{SHADES.map(c => <i key={c} className="w-4 h-2.5 first:rounded-l last:rounded-r" style={{ background: c }} />)}</span>More calls</span>
          <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-[#34d399] civr-live-dot" />Calling now</span>
        </div>
      </div>
      <div className="grid lg:grid-cols-[minmax(0,3fr)_minmax(0,1fr)] gap-6 items-start">
        <div ref={box} className="relative" onMouseLeave={() => setTip(null)}>
          {!states ? <div className="aspect-[975/610] rounded-xl bg-[#0d0d0d] animate-pulse" data-testid="live-map-loading" /> : (
            <MapSvg states={states} by={by} shade={shade} live={live} move={move} focus={focus} blur={() => setTip(null)} />
          )}
          {tip && <Tip tip={tip} />}
        </div>
        <div className="flex flex-col gap-6">
          <Side title="Busiest today" Icon={Flame} list={map.slice(0, 5)} empty="No calls today yet — the map lights up as calls go out." testid="live-map-busiest" />
          <Side title="Outside the US" Icon={Globe2} list={outside.slice(0, 6)} empty="No calls outside the US today." testid="live-map-outside" />
        </div>
      </div>
    </div>
  );
}
