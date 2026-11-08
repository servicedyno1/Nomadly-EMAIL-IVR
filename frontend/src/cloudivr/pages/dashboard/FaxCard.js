import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Printer, X } from 'lucide-react';
import { useCivrAuth } from '../../AuthContext';
import { cp } from '../../paths';
import { recall, remember } from '../../consent';

// One-time banner for accounts with an active Business number: fax is included, 50 free pages a month.
export function FaxCard({ numbers }) {
  const { account } = useCivrAuth();
  const key = `civr.faxCard.${account?.id || 'me'}`;
  const [closed, setClosed] = useState(() => recall(key) === '1');
  const biz = (numbers || []).filter(n => n.plan === 'business' && n.status === 'active');
  if (closed || !biz.length) return null;
  const close = () => { remember('preferences', key, '1'); setClosed(true); };
  return (
    <div className="civr-card civr-rise px-4 py-3 mb-6 flex flex-wrap items-center gap-x-4 gap-y-2" data-testid="dashboard-fax-card">
      <Printer className="w-5 h-5 text-[var(--c-accent)] shrink-0" />
      <div className="flex-1 min-w-[12rem] text-sm">
        <span className="font-semibold">{biz.length > 1 ? 'New: Fax on your Business numbers' : 'New: Fax on your Business number'}</span>
        <span className="text-[var(--c-muted)]"> · </span>
        <span className="text-[var(--c-muted)]">Send and receive faxes with 50 free pages every month per number, then $2 a page. Bulk fax and cover pages included.</span>
      </div>
      <Link to={cp('/app/fax')} onClick={close} className="civr-btn civr-btn-primary civr-btn-sm" data-testid="dashboard-fax-card-open">Open Fax</Link>
      <Link to={cp('/app/help?topic=fax')} className="civr-btn civr-btn-ghost civr-btn-sm" data-testid="dashboard-fax-card-help">How it works</Link>
      <button type="button" onClick={close} className="w-9 h-9 rounded-lg flex items-center justify-center text-[var(--c-muted)] hover:text-[var(--c-text)] hover:bg-[var(--c-accent-soft)]" aria-label="Dismiss" data-testid="dashboard-fax-card-dismiss"><X className="w-4 h-4" /></button>
    </div>
  );
}
