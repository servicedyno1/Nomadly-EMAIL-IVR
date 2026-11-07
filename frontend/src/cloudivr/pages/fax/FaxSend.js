import React, { useState } from 'react';
import { toast } from 'sonner';
import { Send, FileUp, Loader2 } from 'lucide-react';
import { api, money } from '../../api';
import { Field } from '../../ui';

// Upload → price (pages, free vs paid) → send. Charged only once the fax is delivered.
function Quote({ q }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm" data-testid="fax-quote">
      <div><b data-testid="fax-quote-pages">{q.pages}</b> page{q.pages === 1 ? '' : 's'} · <span className="text-[#34d399]">{q.freePages} free</span> · {q.paidPages} paid</div>
      <div className="mt-1">Cost: <b data-testid="fax-quote-cost">{q.cost > 0 ? money(q.cost) : 'Free'}</b> <span className="text-xs text-[#a1a1aa]">— charged only when delivered</span></div>
    </div>
  );
}

export function FaxSend({ numbers, onSent }) {
  const [from, setFrom] = useState(numbers[0]?.phoneNumber || '');
  const [to, setTo] = useState('');
  const [file, setFile] = useState(null);
  const [staged, setStaged] = useState(null);
  const [busy, setBusy] = useState(false);
  const reset = () => setStaged(null);
  const check = async () => {
    if (!file) return toast.error('Choose a PDF or photo to fax.');
    setBusy(true);
    try {
      const form = new FormData(); form.append('from', from); form.append('file', file);
      setStaged(await api('/fax/stage', { method: 'POST', form }));
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };
  const send = async () => {
    setBusy(true);
    try {
      await api('/fax/send', { method: 'POST', body: { from, to, stageId: staged.stageId } });
      toast.success(`Fax to ${to} is on its way`);
      setStaged(null); setFile(null); setTo(''); onSent();
    } catch (e) { toast.error(e.message); if (e.code === 'expired') setStaged(null); } finally { setBusy(false); }
  };
  return (
    <div className="civr-card p-6 h-full flex flex-col gap-4" data-testid="fax-send-card">
      <div className="font-semibold">Send a fax</div>
      <div className="grid sm:grid-cols-2 gap-4">
        <Field label="From">
          <select className="civr-input w-full" value={from} onChange={e => { setFrom(e.target.value); reset(); }} data-testid="fax-from-select">
            {numbers.map(n => <option key={n.phoneNumber} value={n.phoneNumber}>{n.phoneNumber}</option>)}
          </select>
        </Field>
        <Field label="To (fax number)" hint="With country code, e.g. +14155550100">
          <input className="civr-input w-full" value={to} onChange={e => setTo(e.target.value)} placeholder="+14155550100" inputMode="tel" data-testid="fax-to-input" />
        </Field>
      </div>
      <Field label="Document" hint="PDF, JPG or PNG — up to 10 MB and 50 pages. A photo becomes one page.">
        <label className="civr-input w-full flex items-center gap-2 cursor-pointer" data-testid="fax-file-label">
          <FileUp className="w-4 h-4 shrink-0" /><span className="truncate">{file ? file.name : 'Choose a file…'}</span>
          <input type="file" accept="application/pdf,image/jpeg,image/png" className="hidden" onChange={e => { setFile(e.target.files?.[0] || null); reset(); }} data-testid="fax-file-input" />
        </label>
      </Field>
      {staged && <Quote q={staged.quote} />}
      <div className="flex flex-wrap gap-2 mt-auto">
        {!staged
          ? <button type="button" className="civr-btn civr-btn-primary" onClick={check} disabled={busy || !file} data-testid="fax-check-button">{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileUp className="w-4 h-4" />}Upload & check price</button>
          : <button type="button" className="civr-btn civr-btn-primary" onClick={send} disabled={busy || !to.trim()} data-testid="fax-send-button">{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}Send fax{staged.quote.cost > 0 ? ` — ${money(staged.quote.cost)}` : ''}</button>}
        {staged && <button type="button" className="civr-btn civr-btn-ghost" onClick={reset} disabled={busy} data-testid="fax-cancel-button">Cancel</button>}
      </div>
    </div>
  );
}
