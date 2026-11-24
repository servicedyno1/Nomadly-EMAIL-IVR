import React, { useState } from 'react';
import { toast } from 'sonner';
import { ArrowRight, Send, Loader2, Sparkles, Pencil } from 'lucide-react';
import { api, money } from '../../api';

// Step 3 — optional test to your own phone (first one free), then "did it arrive?"; spam / no → risky words + a safer rewrite.
export function StepTest({ campaign, test, onEdit, onRewrite, onNext }) {
  const [to, setTo] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(null);
  const [tips, setTips] = useState(null);
  const [ok, setOk] = useState(false);
  const send = async () => {
    setBusy(true);
    try { const r = await api(`/bulksms/campaigns/${campaign.id}/test`, { method: 'POST', body: { to } }); setSent(r); setTips(null); toast.success(r.charged ? `Test sent — ${money(r.charged)} (credited back when you pay)` : 'Test sent'); }
    catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };
  const answer = async (a) => {
    setBusy(true);
    try {
      const r = await api(`/bulksms/campaigns/${campaign.id}/test-feedback`, { method: 'POST', body: { messageId: sent.messageId, answer: a } });
      if (r.wait) return toast(r.message);
      if (a === 'yes') { setOk(true); return; }
      setTips(r);
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };
  return (
    <div className="space-y-4" data-testid="bulksms-test">
      <div>
        <h3 className="font-semibold text-lg">Test it on your phone first</h3>
        <p className="text-sm text-[var(--c-muted)]">{campaign.volume.toLocaleString()} numbers · {campaign.parts.toLocaleString()} texts · {money(campaign.price)}. {test?.free ? 'Your first test is free.' : 'Tests are charged per text and credited back when you pay.'}</p>
      </div>
      {!test?.on && !sent && <p className="text-sm text-[#fbbf24]" data-testid="bulksms-test-off">Tests are paused right now — you can continue without one.</p>}
      {!sent && test?.on && !test.barred && (
        <div className="flex flex-col sm:flex-row gap-2">
          <input className="civr-input sm:w-64" placeholder="+1 your mobile" value={to} onChange={e => setTo(e.target.value)} data-testid="bulksms-test-to" />
          <button type="button" className="civr-btn civr-btn-primary" disabled={busy || !to.trim()} onClick={send} data-testid="bulksms-test-send">{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}Send test</button>
        </div>
      )}
      {sent && !ok && !tips && (
        <div className="rounded-lg border border-[#262626] p-4" data-testid="bulksms-test-check">
          <div className="font-medium">Sent to {sent.to}. Did it arrive?</div>
          <div className="flex flex-wrap gap-2 mt-3">
            <button type="button" className="civr-btn civr-btn-sm civr-btn-primary" disabled={busy} onClick={() => answer('yes')} data-testid="bulksms-test-yes">Yes</button>
            <button type="button" className="civr-btn civr-btn-sm" disabled={busy} onClick={() => answer('spam')} data-testid="bulksms-test-spam">In spam</button>
            <button type="button" className="civr-btn civr-btn-sm" disabled={busy} onClick={() => answer('no')} data-testid="bulksms-test-no">Not yet</button>
          </div>
        </div>
      )}
      {ok && <p className="text-sm text-[#34d399]" data-testid="bulksms-test-ok">Great — it's landing. Pick when to send.</p>}
      {tips && (
        <div className="rounded-lg border border-[#fbbf24]/40 p-4 space-y-3 text-sm" data-testid="bulksms-test-tips">
          {tips.risky?.length > 0 && <div><div className="civr-label mb-1">Words carriers often filter</div><ul className="space-y-1">{tips.risky.map(x => <li key={x.word}><b>{x.word}</b> — <span className="text-[var(--c-muted)]">{x.why}</span></li>)}</ul></div>}
          {tips.rewrite && <div><div className="civr-label mb-1"><Sparkles className="w-3 h-3 inline" /> Safer version</div><p className="italic">{tips.rewrite}</p><button type="button" className="civr-btn civr-btn-sm civr-btn-primary mt-2" onClick={() => onRewrite(tips.rewrite)} data-testid="bulksms-test-use-rewrite">Use this text</button></div>}
          {!tips.risky?.length && !tips.rewrite && <p>Texts can take a few minutes. Try again, or change the wording.</p>}
          <button type="button" className="civr-btn civr-btn-sm" onClick={() => { setSent(null); setTips(null); }} data-testid="bulksms-test-again">Test again</button>
        </div>
      )}
      <div className="flex flex-wrap gap-2 pt-2">
        <button type="button" className="civr-btn civr-btn-ghost" onClick={onEdit} data-testid="bulksms-test-edit"><Pencil className="w-4 h-4" />Change the text</button>
        <button type="button" className="civr-btn civr-btn-primary" onClick={onNext} data-testid="bulksms-test-next">{sent || !test?.on ? 'Choose when to send' : 'Skip test'}<ArrowRight className="w-4 h-4" /></button>
      </div>
    </div>
  );
}
