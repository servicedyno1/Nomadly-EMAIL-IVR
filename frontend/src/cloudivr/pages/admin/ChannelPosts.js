import React, { useState } from 'react';
import { toast } from 'sonner';
import { Send, Loader2 } from 'lucide-react';
import { api } from '../../api';
import { Load } from './common';

const when = (d) => new Date(d).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const TONE = { posted: 'text-[#34d399]', simulated: 'text-[#a1a1aa]', failed: 'text-[#f87171]', claimed: 'text-[#fbbf24]' };

// Telegram channel autoposter: 2 posts a day with real app screens; last posts + "Post one now".
export default function ChannelPosts() {
  const [busy, setBusy] = useState(false);
  return (
    <Load path="/admin/channel-posts" testid="admin-channel-posts">
      {(d, reload) => {
        const now = async () => {
          setBusy(true);
          try { const r = await api('/admin/channel-posts/now', { method: 'POST' }); r.error ? toast.error(r.error) : toast.success(r.simulated ? 'Preview: post simulated (nothing sent)' : 'Posted to the channel'); reload(); } catch (e) { toast.error(e.message); } finally { setBusy(false); }
        };
        return (
          <div className="civr-card p-5 space-y-3" data-testid="admin-channel-posts">
            <div className="flex items-center justify-between gap-3">
              <div className="text-xs uppercase tracking-widest text-[#a1a1aa]">Telegram channel posts · {d.channel} · 2 a day</div>
              <button className="civr-btn civr-btn-ghost text-sm" onClick={now} disabled={busy} data-testid="admin-channel-post-now">{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}Post one now</button>
            </div>
            {!d.items.length ? <div className="text-sm text-[#a1a1aa]" data-testid="admin-channel-posts-empty">No posts yet — the first goes out at the next time slot.</div> : (
              <ul className="divide-y divide-[#222] max-h-96 overflow-auto">
                {d.items.map((x, i) => (
                  <li key={x.slot} className="py-2 text-sm" data-testid={`admin-channel-post-${i}`}>
                    <div className="flex flex-wrap gap-x-3 text-xs text-[#a1a1aa]"><span>{when(x.at)}</span><span>{x.pillar || '—'}</span><span>{x.mediaId || ''}</span><span className={TONE[x.status] || ''} data-testid={`admin-channel-post-${i}-status`}>{x.status}</span></div>
                    {x.text && <div className="mt-1 whitespace-pre-line line-clamp-4" dangerouslySetInnerHTML={{ __html: x.text.replace(/<(?!\/?b>)[^>]*>/g, '') }} />}
                    {x.error && <div className="mt-1 text-xs text-[#f87171]">{x.error}</div>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      }}
    </Load>
  );
}
