import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { ArrowRight, Loader2, Search as SearchIcon } from 'lucide-react';
import { api } from '../../api';
import { ask } from '../../confirm';
import { fmt, dt, Pill } from './common';

function NumberRow({ n, checked, onToggle, disabled }) {
  return (
    <label className={`flex flex-wrap items-center gap-3 py-2 border-t border-[#1f1f1f] text-sm ${disabled ? 'opacity-60' : 'cursor-pointer'}`} data-testid={`move-number-${n.phoneNumber.replace(/\D/g, '')}`}>
      <input type="checkbox" checked={checked} onChange={onToggle} disabled={disabled} className="w-4 h-4" data-testid={`move-number-check-${n.phoneNumber.replace(/\D/g, '')}`} />
      <span className="font-mono">{n.phoneNumber}</span>
      {n.isSubNumber ? <Pill>extra of {n.parentNumber}</Pill> : <Pill tone="on">{n.plan || 'plan'}</Pill>}
      <span className="text-xs text-[#a1a1aa]">{n.status} · renews {dt(n.expiresAt)}</span>
    </label>
  );
}

function History({ tick }) {
  const [items, setItems] = useState([]);
  useEffect(() => { api('/admin/plan-move/history').then(d => setItems(d.items || [])).catch(() => {}); }, [tick]);
  if (!items.length) return null;
  return (
    <div className="civr-card p-5" data-testid="move-history">
      <h3 className="font-semibold mb-3">Recent moves</h3>
      <ul className="space-y-2 text-sm">{items.map(m => (
        <li key={m._id} className="flex flex-wrap gap-2 items-center" data-testid={`move-history-${m._id}`}><span className="text-[#a1a1aa]">{dt(m.at)}</span><span>@{m.username}</span><ArrowRight className="w-3.5 h-3.5" /><span>{m.email}</span><span className="font-mono text-xs">{m.numbers.join(', ')}</span></li>
      ))}</ul>
    </div>
  );
}

export default function MovePlan() {
  const [bots, setBots] = useState([]);
  const [f, setF] = useState({ bot: 'nomadly', username: '', email: '' });
  const [found, setFound] = useState(null);
  const [pick, setPick] = useState({});
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);
  useEffect(() => { api('/admin/plan-move/bots').then(d => setBots(d.bots || [])).catch(() => {}); }, []);
  const set = (k) => (e) => { setF(x => ({ ...x, [k]: e.target.value })); setFound(null); };
  const lookup = async (e) => {
    e?.preventDefault(); setBusy(true);
    try {
      const d = await api(`/admin/plan-move/lookup?bot=${encodeURIComponent(f.bot)}&username=${encodeURIComponent(f.username)}&email=${encodeURIComponent(f.email)}`);
      setFound(d); setPick(Object.fromEntries(d.botNumbers.filter(n => !n.isSubNumber).map(n => [n.phoneNumber, true])));
    } catch (err) { setFound(null); toast.error(err.message); } finally { setBusy(false); }
  };
  const chosen = Object.keys(pick).filter(k => pick[k]);
  const go = async () => {
    if (!(await ask(`Move ${chosen.join(', ')} (and its extra numbers) from @${found.username} to ${found.email}? Calls and renewals will use the web wallet (${fmt(found.webWallet)}); the bot wallet (${fmt(found.botWallet)}) stays in the bot.`, { ok: 'Move plan' }))) return;
    setBusy(true);
    try { const d = await api('/admin/plan-move', { method: 'POST', body: { ...f, numbers: chosen } }); toast.success(`Moved ${d.moved.map(n => n.phoneNumber).join(', ')}`); setTick(t => t + 1); await lookup(); } catch (err) { toast.error(err.message); } finally { setBusy(false); }
  };
  return (
    <div className="space-y-6" data-testid="move-plan-page">
      <form onSubmit={lookup} className="civr-card p-5 grid md:grid-cols-4 gap-3 items-end" data-testid="move-plan-form">
        <label className="text-sm space-y-1"><span className="civr-label">Bot</span>
          <select className="civr-input" value={f.bot} onChange={set('bot')} data-testid="move-bot-select">{bots.map(b => <option key={b.key} value={b.key} disabled={!b.ready}>{b.name}{b.ready ? '' : ' — coming later'}</option>)}</select></label>
        <label className="text-sm space-y-1"><span className="civr-label">Telegram username</span><input className="civr-input" value={f.username} onChange={set('username')} placeholder="@username" data-testid="move-username-input" /></label>
        <label className="text-sm space-y-1"><span className="civr-label">CloudIVR web email</span><input className="civr-input" type="email" value={f.email} onChange={set('email')} placeholder="name@example.com" data-testid="move-email-input" /></label>
        <button type="submit" className="civr-btn civr-btn-ghost" disabled={busy || !f.username || !f.email} data-testid="move-lookup-btn">{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <SearchIcon className="w-4 h-4" />}Find</button>
      </form>
      {found && (
        <div className="civr-card p-5 space-y-4" data-testid="move-plan-found">
          <div className="grid md:grid-cols-2 gap-4 text-sm">
            <div data-testid="move-from"><div className="civr-label mb-1">From · {found.bot.name}</div><b>@{found.username}</b> <span className="text-[#a1a1aa]">({found.botChatId}) · wallet {fmt(found.botWallet)}</span></div>
            <div data-testid="move-to"><div className="civr-label mb-1">To · CloudIVR web</div><b>{found.email}</b> <span className="text-[#a1a1aa]">· {found.webNumbers.length} numbers · wallet {fmt(found.webWallet)}</span></div>
          </div>
          {found.botNumbers.length === 0 ? <p className="text-sm" data-testid="move-none">No active Cloud IVR numbers on this bot account.</p> : (
            <div>{found.botNumbers.map(n => <NumberRow key={n.phoneNumber} n={n} checked={n.isSubNumber ? !!pick[n.parentNumber] : !!pick[n.phoneNumber]} disabled={n.isSubNumber} onToggle={() => setPick(p => ({ ...p, [n.phoneNumber]: !p[n.phoneNumber] }))} />)}</div>
          )}
          {found.botNumbers.length > 0 && <button type="button" className="civr-btn civr-btn-primary" onClick={go} disabled={busy || !chosen.length} data-testid="move-plan-btn">{busy && <Loader2 className="w-4 h-4 animate-spin" />}Move to CloudIVR web</button>}
        </div>
      )}
      <History tick={tick} />
    </div>
  );
}
