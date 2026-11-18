import React, { useState } from 'react';
import { toast } from 'sonner';
import { CalendarPlus, Apple, Copy, RefreshCw, Loader2 } from 'lucide-react';
import { api, useApi } from '../../api';
import { ask } from '../../i18n';

// Private live link: Google / Apple / Outlook subscribe once and new charges appear on their own.
export function CalendarSubscribe() {
  const { data, reload } = useApi('/renewals/calendar/feed');
  const [busy, setBusy] = useState(false);
  const copy = () => navigator.clipboard?.writeText(data.url).then(() => toast.success('Link copied'));
  const reset = async () => {
    if (!(await ask('Make a new private link? Calendars using the current link stop updating until you add the new one.', { danger: true, ok: 'Make new link' }))) return;
    setBusy(true);
    try { await api('/renewals/calendar/feed/reset', { method: 'POST' }); await reload(); toast.success('New calendar link ready'); } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };
  return (
    <div className="civr-card p-5 mt-6" data-testid="renewal-subscribe-card">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 max-w-xl">
          <div className="flex items-center gap-2 font-semibold"><CalendarPlus className="w-4 h-4 text-[#818cf8]" />Add to your calendar</div>
          <p className="text-sm text-[var(--c-muted)] mt-1">Subscribe once and every renewal shows up in Google or Apple Calendar, with a reminder the day before. It keeps itself up to date. The link is private, so don’t share it.</p>
        </div>
        {data && <div className="flex flex-wrap gap-2">
          <a href={data.google} target="_blank" rel="noreferrer" className="civr-btn civr-btn-primary civr-btn-sm" data-testid="renewal-subscribe-google"><CalendarPlus className="w-4 h-4" />Google Calendar</a>
          <a href={data.webcal} className="civr-btn civr-btn-ghost civr-btn-sm" data-testid="renewal-subscribe-apple"><Apple className="w-4 h-4" />Apple Calendar</a>
        </div>}
      </div>
      {data && <div className="flex flex-wrap items-center gap-2 mt-4">
        <code className="flex-1 min-w-[14rem] truncate rounded-md border border-[var(--c-border)] px-3 py-2 text-xs text-[var(--c-muted)]" data-testid="renewal-subscribe-url" data-no-translate>{data.url}</code>
        <button type="button" className="civr-btn civr-btn-ghost civr-btn-sm" onClick={copy} data-testid="renewal-subscribe-copy"><Copy className="w-4 h-4" />Copy link</button>
        <button type="button" className="civr-btn civr-btn-ghost civr-btn-sm" onClick={reset} disabled={busy} data-testid="renewal-subscribe-reset">{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}New link</button>
      </div>}
      <p className="text-xs text-[var(--c-muted)] mt-3">Outlook or other apps: paste the link where they ask to subscribe to a calendar from the internet.</p>
    </div>
  );
}
