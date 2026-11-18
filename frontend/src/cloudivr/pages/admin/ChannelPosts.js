import React, { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Send, Loader2, Film, Image as ImageIcon, Sparkles } from 'lucide-react';
import { api } from '../../api';
import { Load } from './common';

const when = (d) => new Date(d).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const TONE = { posted: 'text-[#34d399]', simulated: 'text-[#a1a1aa]', failed: 'text-[#f87171]', claimed: 'text-[#fbbf24]' };
const VISUAL = { clip: ['Phone clip', Film], art: ['AI artwork', Sparkles], duo: ['Phone + desktop', ImageIcon], desk: ['Desktop screen', ImageIcon] };

function PostRow({ x, i }) {
  const [label, Icon] = VISUAL[x.visual] || [x.visual || '', ImageIcon];
  return (
    <li className="py-3 flex gap-3 text-sm" data-testid={`admin-channel-post-${i}`}>
      {x.thumb ? <img src={`data:image/jpeg;base64,${x.thumb}`} alt="" className="w-28 h-auto max-h-36 object-cover rounded-md border border-[#222] shrink-0" data-testid={`admin-channel-post-${i}-thumb`} /> : <div className="w-28 h-16 rounded-md bg-[#18181b] shrink-0" />}
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-3 text-xs text-[#a1a1aa]">
          <span>{when(x.at)}</span><span>{x.chat || '@CloudIVRNet'}</span><span>{x.pillar || '—'}</span>
          {label && <span className="inline-flex items-center gap-1"><Icon className="w-3 h-3" />{label}{x.live === false ? ' · saved screens' : ''}</span>}
          <span className={TONE[x.status] || ''} data-testid={`admin-channel-post-${i}-status`}>{x.status === 'claimed' ? 'making…' : x.status}</span>
        </div>
        {x.text && <div className="mt-1 whitespace-pre-line line-clamp-4" dangerouslySetInnerHTML={{ __html: x.text.replace(/<(?!\/?b>)[^>]*>/g, '') }} />}
        {x.error && <div className="mt-1 text-xs text-[#f87171]">{x.error}</div>}
      </div>
    </li>
  );
}

function Posts({ d, reload }) {
  const [busy, setBusy] = useState('');
  const making = d.items.some(x => x.status === 'claimed');
  const tick = useRef(null);
  useEffect(() => { if (making) { tick.current = setTimeout(reload, 8000); } return () => clearTimeout(tick.current); }, [making, d, reload]);
  const now = async (chat) => {
    setBusy(chat);
    try { const r = await api('/admin/channel-posts/now', { method: 'POST', body: { chat } }); r.error ? toast.error(r.error) : toast.success(`Making a new post for ${r.chat} — it shows up here in about a minute`); setTimeout(reload, 1500); } catch (e) { toast.error(e.message); } finally { setBusy(''); }
  };
  return (
    <div className="civr-card p-5 space-y-3" data-testid="admin-channel-posts">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-xs uppercase tracking-widest text-[#a1a1aa]" data-testid="admin-channel-posts-schedule">Telegram channel posts · {d.targets.map(t => `${t.chat} ${t.slots.length}×/day`).join(' · ')}</div>
        <div className="flex flex-wrap gap-2">
          {d.targets.map(t => (
            <button key={t.chat} className="civr-btn civr-btn-ghost text-sm" onClick={() => now(t.chat)} disabled={!!busy} data-testid={`admin-channel-post-now-${t.chat.replace('@', '').toLowerCase()}`}>{busy === t.chat ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}Post to {t.chat} now</button>
          ))}
        </div>
      </div>
      {!d.items.length ? <div className="text-sm text-[#a1a1aa]" data-testid="admin-channel-posts-empty">No posts yet — the first goes out at the next time slot.</div> : (
        <ul className="divide-y divide-[#222] max-h-[32rem] overflow-auto">{d.items.map((x, i) => <PostRow key={x.slot} x={x} i={i} />)}</ul>
      )}
    </div>
  );
}

// Telegram channel autoposter: every post gets a fresh visual (screens, AI artwork or phone clip).
export default function ChannelPosts() {
  return <Load path="/admin/channel-posts" testid="admin-channel-posts">{(d, reload) => <Posts d={d} reload={reload} />}</Load>;
}
