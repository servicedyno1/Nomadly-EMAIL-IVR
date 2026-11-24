import React, { useState } from 'react';
import { toast } from 'sonner';
import { MessagesSquare, Send, Loader2, ArrowLeft } from 'lucide-react';
import { api, useApi } from '../../api';
import { Empty, Spinner } from '../../ui';

// Replies to your texts (campaigns with replies on, and single texts) — read and answer.
export function Inbox() {
  const { data, loading, reload } = useApi('/bulksms/conversations');
  const [open, setOpen] = useState(null);
  if (open) return <Thread id={open} onBack={() => { setOpen(null); reload(); }} />;
  if (loading && !data) return <Spinner />;
  if (!data?.conversations?.length) return <Empty icon={MessagesSquare} title="No replies yet" sub="When someone answers your text, the conversation shows up here." testid="bulksms-inbox-empty" />;
  return (
    <div className="civr-card divide-y divide-[#1f1f1f]" data-testid="bulksms-inbox">
      {data.conversations.map(c => (
        <button key={c.id} type="button" onClick={() => setOpen(c.id)} className="w-full text-left p-4 hover:bg-[#1a1a1a] transition-colors flex items-center gap-3" data-testid={`bulksms-conv-${c.id}`}>
          <MessagesSquare className="w-4 h-4 text-[#818cf8] shrink-0" />
          <div className="min-w-0 flex-1"><div className="font-medium">{c.to}</div><div className="text-sm text-[var(--c-muted)] truncate">{c.last ? `${c.last.direction === 'in' ? '' : 'You: '}${c.last.body}` : '—'}</div></div>
          {c.last && <span className="text-xs text-[var(--c-muted)] shrink-0">{new Date(c.last.at).toLocaleString()}</span>}
        </button>
      ))}
    </div>
  );
}

function Thread({ id, onBack }) {
  const { data, loading, reload } = useApi(`/bulksms/conversations/${id}`);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const send = async () => { setBusy(true); try { await api(`/bulksms/conversations/${id}/reply`, { method: 'POST', body: { text } }); setText(''); reload(); } catch (e) { toast.error(e.message); } finally { setBusy(false); } };
  if (loading && !data) return <Spinner />;
  return (
    <div className="civr-card p-5 space-y-4" data-testid="bulksms-thread">
      <button type="button" className="civr-btn civr-btn-ghost civr-btn-sm" onClick={onBack} data-testid="bulksms-thread-back"><ArrowLeft className="w-4 h-4" />All replies</button>
      <div className="font-semibold">{data?.to}</div>
      <div className="space-y-2 max-h-[420px] overflow-y-auto">{(data?.messages || []).map(m => (
        <div key={m.id} className={`flex ${m.direction === 'in' ? 'justify-start' : 'justify-end'}`}>
          <div className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${m.direction === 'in' ? 'bg-[#1f1f1f]' : 'bg-[#818cf8]/20'}`}>{m.body}<div className="text-[10px] text-[var(--c-muted)] mt-1">{new Date(m.at).toLocaleString()}{m.direction === 'out' && m.status ? ` · ${m.status}` : ''}</div></div>
        </div>))}
      </div>
      {data?.canReply ? (
        <div className="flex gap-2">
          <input className="civr-input flex-1" placeholder="Write a reply" value={text} onChange={e => setText(e.target.value)} onKeyDown={e => e.key === 'Enter' && text.trim() && send()} data-testid="bulksms-thread-input" />
          <button type="button" className="civr-btn civr-btn-primary" disabled={busy || !text.trim()} onClick={send} data-testid="bulksms-thread-send">{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}</button>
        </div>
      ) : <p className="text-sm text-[var(--c-muted)]" data-testid="bulksms-thread-closed">{data?.why || 'Replies are closed for this conversation.'}</p>}
    </div>
  );
}
