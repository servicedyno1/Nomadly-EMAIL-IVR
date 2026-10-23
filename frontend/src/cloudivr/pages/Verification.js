import React, { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Upload, Send, Loader2, ShieldCheck } from 'lucide-react';
import { api, useApi, when } from '../api';
import { PageHeader, Spinner, ErrorNote, Empty, statusPill } from '../ui';
import { cp } from '../paths';

const Prompt = ({ html, testid }) => <div className="civr-prompt text-sm leading-relaxed text-[#ddd] whitespace-pre-line" data-testid={testid} dangerouslySetInnerHTML={{ __html: html || '' }} />;

function PendingOrders({ list }) {
  if (!list?.length) return null;
  return (
    <div className="civr-card p-6 mt-6" data-testid="verification-pending-orders">
      <div className="font-display text-xl font-bold mb-3">Submitted verifications</div>
      {list.map((o, i) => (
        <div key={i} className="flex items-center justify-between py-2 border-b border-[#1c1c1c] last:border-0 text-sm" data-testid={`verification-order-${i}`}>
          <span className="font-mono">{o.phoneNumber}</span><span className="text-[#888]">{o.countryName}</span><span className={statusPill(o.status)}>{o.status}</span><span className="text-xs text-[#8a8a8a]">{when(o.createdAt)}</span>
        </div>
      ))}
    </div>
  );
}

export default function Verification() {
  const { data, loading, error, setData } = useApi('/verification');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const fileRef = useRef(null);

  const send = async (payload) => {
    setBusy(true); setErr(null);
    try {
      const d = payload instanceof FormData ? await api('/verification/upload', { method: 'POST', form: payload }) : await api('/verification/input', { method: 'POST', body: { text: payload } });
      setData(p => ({ ...p, ...d })); setText('');
    } catch (e) { setErr(e); } finally { setBusy(false); }
  };
  const upload = (e) => { const f = e.target.files?.[0]; if (!f) return; const fd = new FormData(); fd.append('file', f); send(fd); e.target.value = ''; };

  if (loading && !data) return <Spinner />;
  const state = data?.state;
  return (
    <div data-testid="verification-page">
      <PageHeader label="Verification" title="Number verification" sub="Some countries require the carrier to check who owns the number. Your payment is held until it’s approved — cancel any time for a refund." testid="verification-header" />
      <ErrorNote error={error} />
      {state === 'none' && <Empty icon={ShieldCheck} title="Nothing to verify" sub="Buying a number in a country with an ID check starts the steps here." testid="verification-empty"><Link to={cp('/app/buy')} className="civr-btn civr-btn-primary" data-testid="verification-buy-link">Buy a number</Link></Empty>}
      {state && state !== 'none' && (
        <div className="civr-card p-6 max-w-3xl" data-testid="verification-session">
          {data.session && <div className="flex flex-wrap gap-2 mb-6"><span className="civr-pill civr-pill-on font-mono">{data.session.phoneNumber}</span><span className="civr-pill">{data.session.countryName}</span><span className="civr-pill">paid {data.session.paid}</span></div>}
          <Prompt html={data.html} testid="verification-prompt" />
          {data.dryRun && <div className="civr-pill civr-pill-warn mt-4" data-testid="verification-dry-run">Preview — nothing sent to the carrier</div>}
          {state === 'collecting' && (
            <>
              {data.options?.length > 0 && <div className="flex flex-wrap gap-2 mt-6">{data.options.map((o, i) => <button key={o} className="civr-btn civr-btn-ghost civr-btn-sm" disabled={busy} onClick={() => send(o)} data-testid={`verification-option-${i}`}>{o}</button>)}</div>}
              <form onSubmit={e => { e.preventDefault(); if (text.trim()) send(text); }} className="flex gap-2 mt-6">
                <input className="civr-input" value={text} onChange={e => setText(e.target.value)} placeholder="Type your answer" data-testid="verification-answer-input" />
                <button className="civr-btn civr-btn-primary" disabled={busy || !text.trim()} data-testid="verification-send-button">{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}Send</button>
              </form>
              <input ref={fileRef} type="file" accept="application/pdf,image/jpeg,image/png" className="hidden" onChange={upload} data-testid="verification-file-input" />
              <button className="civr-btn civr-btn-ghost civr-btn-sm mt-3" disabled={busy} onClick={() => fileRef.current?.click()} data-testid="verification-upload-button"><Upload className="w-4 h-4" />Upload document (PDF, JPG, PNG · 10 MB)</button>
            </>
          )}
          <div className="mt-4"><ErrorNote error={err} testid="verification-error" /></div>
        </div>
      )}
      <PendingOrders list={data?.pending} />
    </div>
  );
}
