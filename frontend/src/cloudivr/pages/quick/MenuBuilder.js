import React from 'react';
import { Plus, Trash2 } from 'lucide-react';

// Per-key outbound menu: forward / play a message / one level of sub-menu. Value = list of rows.
const DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];
const ACTIONS = [['forward', 'Connect to a phone'], ['message', 'Play a message'], ['submenu', 'Open a sub-menu']];

export const menuToApi = (rows) => Object.fromEntries((rows || []).map(r => [r.digit, r.action === 'forward' ? { action: 'forward', forwardTo: r.forwardTo, label: r.label }
  : r.action === 'message' ? { action: 'message', message: r.message, label: r.label }
    : { action: 'submenu', greeting: r.greeting, label: r.label, options: menuToApi(r.options) }]));
export const menuFromApi = (m) => Object.entries(m || {}).map(([digit, o]) => ({ digit, ...o, options: o.options ? menuFromApi(o.options) : [] }));

function Row({ r, set, remove, used, depth, testid }) {
  return (
    <div className="border border-[#222] rounded-xl p-3 space-y-2" data-testid={testid}>
      <div className="flex flex-wrap gap-2 items-center">
        <select className="civr-input !w-20 font-mono" value={r.digit} onChange={e => set({ digit: e.target.value })} data-testid={`${testid}-digit`} aria-label="Key">{DIGITS.filter(d => d === r.digit || !used.includes(d)).map(d => <option key={d}>{d}</option>)}</select>
        <select className="civr-input !w-auto flex-1 min-w-0 max-w-full" value={r.action} onChange={e => set({ action: e.target.value })} data-testid={`${testid}-action`} aria-label="Action">{ACTIONS.filter(([a]) => depth === 0 || a !== 'submenu').map(([a, l]) => <option key={a} value={a}>{l}</option>)}</select>
        <button type="button" onClick={remove} className="p-2 text-[#888] hover:text-[#fb7185]" data-testid={`${testid}-remove`} aria-label="Remove key"><Trash2 className="w-4 h-4" /></button>
      </div>
      {r.action === 'forward' && <input className="civr-input font-mono" value={r.forwardTo || ''} onChange={e => set({ forwardTo: e.target.value })} placeholder="+14155550100" data-testid={`${testid}-forward`} />}
      {r.action === 'message' && <input className="civr-input" value={r.message || ''} onChange={e => set({ message: e.target.value })} placeholder="Text to read out, then hang up" data-testid={`${testid}-message`} />}
      {r.action === 'submenu' && (
        <div className="pl-3 border-l-2 border-[#34d399]/30 space-y-2">
          <input className="civr-input" value={r.greeting || ''} onChange={e => set({ greeting: e.target.value })} placeholder="Sub-menu prompt, e.g. Press 1 for English" data-testid={`${testid}-greeting`} />
          <MenuBuilder value={r.options || []} onChange={(o) => set({ options: o })} depth={1} testid={`${testid}-sub`} />
        </div>
      )}
    </div>
  );
}

export function MenuBuilder({ value, onChange, depth = 0, testid = 'menu' }) {
  const rows = value || [];
  const used = rows.map(r => r.digit);
  const free = DIGITS.find(d => !used.includes(d));
  return (
    <div className="space-y-2" data-testid={testid}>
      {rows.map((r, i) => <Row key={i} r={r} used={used} depth={depth} testid={`${testid}-key-${i}`} set={(p) => onChange(rows.map((x, j) => (j === i ? { ...x, ...p } : x)))} remove={() => onChange(rows.filter((_, j) => j !== i))} />)}
      {free && <button type="button" className="civr-btn civr-btn-ghost civr-btn-sm" onClick={() => onChange([...rows, { digit: free, action: depth ? 'message' : 'forward', options: [] }])} data-testid={`${testid}-add`}><Plus className="w-4 h-4" />Add key {free}</button>}
    </div>
  );
}
