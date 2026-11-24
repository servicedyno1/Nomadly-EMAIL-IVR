import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { MessagesSquare, ArrowRight, X } from 'lucide-react';
import { cp } from '../../paths';

const KEY = 'civr-bulksms-banner-off';

// "New: Bulk SMS" launch banner — dismissible; the first test text to your own phone is free.
export function BulkSmsBanner() {
  const [off, setOff] = useState(() => { try { return localStorage.getItem(KEY) === '1'; } catch { return false; } });
  if (off) return null;
  const hide = () => { try { localStorage.setItem(KEY, '1'); } catch { /* private mode */ } setOff(true); };
  return (
    <div className="civr-card civr-rise p-5 mb-6 flex flex-col sm:flex-row sm:items-center gap-4 border border-[#34d399]/40" data-testid="dashboard-bulksms-banner">
      <span className="w-11 h-11 rounded-xl grid place-items-center bg-[#34d399]/15 shrink-0"><MessagesSquare className="w-5 h-5 text-[#34d399]" /></span>
      <div className="flex-1 min-w-0">
        <div className="font-semibold flex items-center gap-2"><span className="civr-pill civr-pill-ok text-[10px] uppercase tracking-wider">New</span>Bulk SMS to USA &amp; Canada</div>
        <p className="text-sm text-[var(--c-muted)] mt-1">Text 500+ mobiles from real mobile numbers for $0.10 a text. Your first test text is free — see it land on your phone before you pay.</p>
      </div>
      <Link to={cp('/app/bulk-sms')} className="civr-btn civr-btn-primary shrink-0" data-testid="dashboard-bulksms-banner-cta">Try it free<ArrowRight className="w-4 h-4" /></Link>
      <button type="button" onClick={hide} className="civr-btn civr-btn-ghost civr-btn-sm shrink-0 self-start sm:self-center" aria-label="Hide" data-testid="dashboard-bulksms-banner-close"><X className="w-4 h-4" /></button>
    </div>
  );
}
