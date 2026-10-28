import React, { useState } from 'react';
import { Loader2, Send } from 'lucide-react';
import { toast } from 'sonner';
import { api, useApi } from '../../api';
import { ErrorNote } from '../../ui';

// Texts on a hosted number (newest last) + compose.
export function Thread({ item, meta }) {
  const { data, reload } = useApi(`/hosted-sms/${item.id}/messages`);
  const [to, setTo] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const rows = [...(data?.messages || [])].reverse();
  const send = async () => {
    setBusy(true); setErr(null);
    try { const r = await api(`/hosted-sms/${item.id}/send`, { method: 'POST', body: { to, text } }); toast.success(`Sent · $${r.charge.toFixed(2)}`); setText(''); reload(); } catch (e) { setErr(e); } finally { setBusy(false); }
  };
  return (
    <div className="space-y-4" data-testid="texting-thread">
      <div className="max-h-80 overflow-y-auto space-y-2 pr-1" data-testid="texting-messages">
        {!rows.length && <p className="text-sm text-[#a1a1aa]">No texts yet.</p>}
        {rows.map(m => (
          <div key={m.id || m.at} className={`flex ${m.direction === 'outbound' ? 'justify-end' : ''}`}>
            <button type="button" onClick={() => m.direction === 'inbound' && setTo(m.from)} className={`max-w-[80%] text-left rounded-2xl px-4 py-2 text-sm ${m.direction === 'outbound' ? 'bg-[#818cf8]/15' : 'bg-[#1a1a1a]'}`} data-testid="texting-message">
              <div className="text-[11px] text-[#a1a1aa] mb-0.5 font-mono">{m.direction === 'outbound' ? `to ${m.to}` : `from ${m.from}`} · {new Date(m.at).toLocaleString()}</div>
              {m.body}
            </button>
          </div>
        ))}
      </div>
      {item.status === 'active' && (
        <div className="grid sm:grid-cols-[200px_1fr_auto] gap-2">
          <input className="civr-input font-mono" value={to} onChange={e => setTo(e.target.value)} placeholder="To +1…" data-testid="texting-to-input" />
          <input className="civr-input" value={text} maxLength={meta.maxText} onChange={e => setText(e.target.value)} onKeyDown={e => e.key === 'Enter' && to && text && !busy && send()} placeholder={`Message (${meta.maxText - text.length} left)`} data-testid="texting-text-input" />
          <button type="button" onClick={send} disabled={busy || !to || !text.trim()} className="civr-btn civr-btn-primary" data-testid="texting-send-button">{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}Send</button>
        </div>
      )}
      <ErrorNote error={err} testid="texting-send-error" />
    </div>
  );
}
