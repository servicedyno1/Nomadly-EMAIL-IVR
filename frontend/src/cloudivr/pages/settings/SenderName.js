import React, { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { api, useApi } from '../../api';

// The name shown instead of a number in countries that require one (UK, Germany, France, Portugal).
export function SenderName() {
  const { data } = useApi('/prefs/sender-name');
  const [v, setV] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (data) setV(data.senderName || ''); }, [data]);
  const save = async () => {
    setBusy(true);
    try { const d = await api('/prefs/sender-name', { method: 'PUT', body: { senderName: v } }); setV(d.senderName || ''); toast.success(d.senderName ? 'Sender name saved' : 'Sender name removed'); } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };
  return (
    <div id="settings-sender-name" className="civr-card p-6 space-y-4 scroll-mt-24" data-testid="settings-sender-name-card">
      <div className="font-display text-2xl font-bold">Text sender name</div>
      <p className="text-sm text-[#a1a1aa]">Some countries (UK, Germany, France, Portugal) show a name instead of a phone number on texts. People can’t reply to a name. Countries that need the name registered first aren’t offered.</p>
      <div className="flex flex-wrap gap-2">
        <input className="civr-input !w-56" maxLength={11} value={v} onChange={e => setV(e.target.value)} placeholder="e.g. ACME" data-testid="settings-sender-name-input" />
        <button type="button" className="civr-btn civr-btn-primary" disabled={busy || v === (data?.senderName || '')} onClick={save} data-testid="settings-sender-name-save-button">{busy && <Loader2 className="w-4 h-4 animate-spin" />}Save name</button>
      </div>
      <p className="text-xs text-[#a1a1aa]">3–11 letters or numbers, at least one letter.</p>
    </div>
  );
}
