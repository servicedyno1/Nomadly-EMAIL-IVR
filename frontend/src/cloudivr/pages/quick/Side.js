import React from 'react';
import { toast } from 'sonner';
import { History, RotateCcw, CalendarClock, X, BarChart3, Bookmark, Trash2 } from 'lucide-react';
import { api, useApi, when } from '../../api';
import { usePrivacy } from '../../privacy';

const Box = ({ icon: Icon, title, children, testid }) => (
  <div className="civr-card p-5" data-testid={testid}>
    <div className="flex items-center gap-2 font-display text-xl font-bold mb-3"><Icon className="w-4 h-4 text-[#38bdf8]" />{title}</div>
    {children}
  </div>
);
const none = (t) => <div className="text-sm text-[#8a8a8a]">{t}</div>;

export function RecentCalls({ isBiz, onDone, stamp }) {
  const { data, reload } = useApi(`/calls/history?s=${stamp}`);
  const pv = usePrivacy();
  const redial = async (id) => {
    try { const d = await api(`/calls/history/${id}/redial`, { method: 'POST' }); toast.success(d.dryRun ? d.message : `Calling again · ${d.started} call(s)`); reload(); onDone(); } catch (e) { toast.error(e.message); }
  };
  const list = data?.calls || [];
  return (
    <Box icon={History} title="Recent calls" testid="quick-history">
      {!list.length ? none('Your Quick IVR calls show up here.') : list.slice(0, 6).map((c, i) => (
        <div key={c.id} className="flex items-center gap-2 py-2 border-b border-[#1c1c1c] last:border-0" data-testid={`quick-history-row-${i}`}>
          <div className="flex-1 min-w-0">
            <div className="font-mono text-xs truncate">{c.targets.map(t => pv.phone(t)).join(', ')}</div>
            <div className="text-[11px] text-[#8a8a8a]">{when(c.at)} · {c.mode === 'otp' ? 'Code' : c.hasMenu ? 'Menu' : 'Transfer'}{c.dryRun ? ' · preview' : ''}{c.trial ? ' · free trial' : ''}</div>
          </div>
          {isBiz && !c.trial && <button type="button" className="civr-btn civr-btn-ghost civr-btn-sm" onClick={() => redial(c.id)} data-testid={`quick-history-redial-${i}`}><RotateCcw className="w-3.5 h-3.5" />Redial</button>}
        </div>
      ))}
    </Box>
  );
}

export function ScheduledCalls({ stamp }) {
  const { data, reload } = useApi(`/calls/scheduled?s=${stamp}`);
  const pv = usePrivacy();
  const cancel = async (id) => { try { await api(`/calls/scheduled/${id}`, { method: 'DELETE' }); toast.success('Scheduled call cancelled'); reload(); } catch (e) { toast.error(e.message); } };
  const list = (data?.calls || []).slice(0, 6);
  if (!list.length) return null;
  return (
    <Box icon={CalendarClock} title="Scheduled" testid="quick-scheduled">
      {list.map((c, i) => (
        <div key={c.id} className="flex items-center gap-2 py-2 border-b border-[#1c1c1c] last:border-0" data-testid={`quick-scheduled-row-${i}`}>
          <div className="flex-1 min-w-0"><div className="font-mono text-xs">{pv.phone(c.to)}</div><div className="text-[11px] text-[#8a8a8a]">{when(c.scheduledFor)} · {c.status}</div></div>
          {['pending', 'preview'].includes(c.status) && <button type="button" className="p-2 text-[#888] hover:text-[#fb7185]" onClick={() => cancel(c.id)} aria-label="Cancel scheduled call" data-testid={`quick-scheduled-cancel-${i}`}><X className="w-4 h-4" /></button>}
        </div>
      ))}
    </Box>
  );
}

export function MenuStats() {
  const { data } = useApi('/calls/menu-stats');
  const rows = data?.keyBreakdown || [];
  return (
    <Box icon={BarChart3} title="Key presses · 30 days" testid="quick-menu-stats">
      {!rows.length ? none('No key presses yet.') : rows.map((k, i) => (
        <div key={i} className="mb-2" data-testid={`quick-menu-stats-row-${i}`}>
          <div className="flex justify-between text-sm"><span>Key {k.digit} · {k.action}</span><span className="font-mono">{k.count} · {k.percent}%</span></div>
          <div className="h-1.5 bg-[#1c1c1c] rounded-full mt-1"><div className="h-full bg-[#38bdf8] rounded-full" style={{ width: `${k.percent}%` }} /></div>
        </div>
      ))}
    </Box>
  );
}

export function Presets({ onLoad, current, stamp }) {
  const { data, reload } = useApi(`/calls/presets?s=${stamp}`);
  const [name, setName] = React.useState('');
  const save = async () => {
    try { await api('/calls/presets', { method: 'POST', body: { name, setup: current() } }); toast.success('Preset saved'); setName(''); reload(); } catch (e) { toast.error(e.message); }
  };
  const del = async (id) => { try { await api(`/calls/presets/${id}`, { method: 'DELETE' }); reload(); } catch (e) { toast.error(e.message); } };
  const list = data?.presets || [];
  return (
    <Box icon={Bookmark} title="Presets" testid="quick-presets">
      {list.map((p, i) => (
        <div key={p.id} className="flex items-center gap-2 py-1.5" data-testid={`quick-preset-row-${i}`}>
          <button type="button" className="flex-1 text-left text-sm hover:text-[#34d399] truncate" onClick={() => onLoad(p)} data-testid={`quick-preset-load-${i}`}>{p.name}</button>
          <button type="button" className="p-1.5 text-[#888] hover:text-[#fb7185]" onClick={() => del(p.id)} aria-label="Delete preset" data-testid={`quick-preset-delete-${i}`}><Trash2 className="w-3.5 h-3.5" /></button>
        </div>
      ))}
      <div className="flex gap-2 mt-2"><input className="civr-input !h-10" value={name} onChange={e => setName(e.target.value)} placeholder="Preset name" data-testid="quick-preset-name-input" />
        <button type="button" className="civr-btn civr-btn-ghost civr-btn-sm" disabled={!name.trim()} onClick={save} data-testid="quick-preset-save-button">Save</button></div>
      <p className="text-[11px] text-[#8a8a8a] mt-2">Saves this setup — everything except the numbers to call.</p>
    </Box>
  );
}
