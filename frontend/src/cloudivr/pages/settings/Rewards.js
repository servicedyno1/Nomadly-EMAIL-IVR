import React, { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { toast } from 'sonner';
import { Gift, Copy, Lightbulb, Loader2, Inbox as InboxIcon } from 'lucide-react';
import { api, useApi, money, day } from '../../api';
import { cp } from '../../paths';

const copy = (v) => navigator.clipboard?.writeText(v).then(() => toast.success('Link copied'));

export function Referral() {
  const { data } = useApi('/referrals');
  if (!data) return null;
  const link = `${window.location.origin}${cp('/signup')}?ref=${data.code}`;
  return (
    <div className="civr-card p-6 space-y-4" data-testid="settings-referral-card">
      <div className="flex items-center gap-3"><Gift className="w-6 h-6 text-[#34d399]" /><div className="font-display text-2xl font-bold">Invite friends, earn credit</div></div>
      <p className="text-sm text-[#a1a1aa]">Share your link. When a friend buys their first number you get <b className="text-[#f4f4f5]">{money(data.rewardUsd)}</b> in your wallet and they get <b className="text-[#f4f4f5]">{money(data.friendUsd)}</b>.</p>
      <div className="flex gap-2"><input className="civr-input font-mono text-xs" readOnly value={link} onFocus={e => e.target.select()} data-testid="referral-link" />
        <button type="button" className="civr-btn civr-btn-primary civr-btn-sm shrink-0" onClick={() => copy(link)} data-testid="referral-copy-button"><Copy className="w-4 h-4" />Copy</button></div>
      <div className="grid grid-cols-3 gap-2 text-center" data-testid="referral-stats">
        {[['Signed up', data.stats.signedUp, 'referral-signed-up'], ['Bought a number', data.stats.rewarded, 'referral-rewarded'], ['You earned', money(data.stats.earned), 'referral-earned']].map(([l, v, t]) => <div key={t} className="civr-card p-3"><div className="font-mono text-lg" data-testid={t}>{v}</div><div className="text-xs text-[#a1a1aa]">{l}</div></div>)}
      </div>
      {data.friends.length > 0 && <ul className="text-xs text-[#a1a1aa] space-y-1" data-testid="referral-friends">{data.friends.map((f, i) => <li key={i} className="flex justify-between"><span className="font-mono">{f.email}</span><span>{f.rewarded ? 'reward paid' : `joined ${day(f.joinedAt)}`}</span></li>)}</ul>}
    </div>
  );
}

export function Suggest({ admin }) {
  const { data, reload } = useApi('/suggestions');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const { hash } = useLocation();
  useEffect(() => { if (hash === '#suggest') setTimeout(() => document.getElementById('suggest')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 300); }, [hash]);
  const send = async (e) => {
    e.preventDefault(); setBusy(true);
    try { await api('/suggestions', { method: 'POST', body: { text } }); setText(''); toast.success('Thanks! We read every idea.'); reload(); } catch (err) { toast.error(err.message); } finally { setBusy(false); }
  };
  return (
    <form onSubmit={send} className="civr-card p-6 space-y-4 scroll-mt-28" id="suggest" data-testid="settings-suggest-card">
      <div className="flex items-center gap-3"><Lightbulb className="w-6 h-6 text-[#fbbf24]" /><div className="font-display text-2xl font-bold">Suggest a feature</div></div>
      <p className="text-sm text-[#a1a1aa]">Tell us what would make CloudIVR better. If we build your idea, you get <b className="text-[#f4f4f5]">{money(data?.rewardUsd || 10)}</b> free credit.</p>
      <textarea className="civr-input min-h-[96px]" required minLength={10} maxLength={2000} value={text} onChange={e => setText(e.target.value)} placeholder="I'd love to be able to…" data-testid="suggest-text-input" />
      <div className="flex flex-wrap gap-2 items-center">
        <button className="civr-btn civr-btn-primary civr-btn-sm" disabled={busy} data-testid="suggest-submit-button">{busy && <Loader2 className="w-4 h-4 animate-spin" />}Send idea</button>
        {admin && <Link to={cp('/app/admin/suggestions')} className="civr-btn civr-btn-ghost civr-btn-sm" data-testid="suggest-admin-link"><InboxIcon className="w-4 h-4" />Suggestions inbox (owner)</Link>}
      </div>
      {data?.suggestions?.length > 0 && <ul className="space-y-2" data-testid="suggest-list">{data.suggestions.map((s, i) => (
        <li key={s.id} className="text-sm flex gap-3 items-start" data-testid={`suggest-item-${i}`}>
          <span className={`civr-pill shrink-0 ${s.status === 'adopted' ? 'civr-pill-on' : ''}`} data-testid={`suggest-status-${i}`}>{s.status === 'adopted' ? `adopted · ${money(s.credit)}` : s.status === 'declined' ? 'not now' : 'received'}</span>
          <span className="text-[#a1a1aa] line-clamp-2">{s.text}</span>
        </li>))}</ul>}
    </form>
  );
}
