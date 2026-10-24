import React, { useEffect } from 'react';
import { PhoneMissed } from 'lucide-react';
import { useApi, when } from './api';
import { usePrivacy } from './privacy';
import { TextBack } from './QuickReply';
import { RING_ENDED } from './Incoming';

// Inbox: recent missed callers (7 days) with a one-tap "Text back".
export function MissedCalls() {
  const pv = usePrivacy();
  const { data, reload } = useApi('/missed-calls');
  useEffect(() => { window.addEventListener(RING_ENDED, reload); return () => window.removeEventListener(RING_ENDED, reload); }, [reload]);
  const calls = data?.calls || [];
  if (!calls.length) return null;
  return (
    <section className="civr-card p-5 mb-6" data-testid="inbox-missed-calls">
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2"><div className="font-display text-xl font-bold">Missed calls</div><div className="text-xs text-[#a1a1aa]">Text a caller back within 7 days</div></div>
      <ul className="divide-y divide-white/10">
        {calls.slice(0, 8).map((c, i) => (
          <li key={c.id} className="py-3" data-testid={`inbox-missed-${i}`}>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              <PhoneMissed className="w-4 h-4 text-[#fb7185] shrink-0" />
              <span className="font-mono" data-no-translate data-testid={`inbox-missed-${i}-from`}>{pv.phone(c.from)}</span>
              <span className="text-xs text-[#a1a1aa]" data-testid={`inbox-missed-${i}-to`}>{`Called ${pv.phone(c.phone)} · ${when(c.timestamp)}`}</span>
              {c.type === 'voicemail' && <span className="civr-pill">Voicemail</span>}
            </div>
            <TextBack id={c.id} reply={c.reply} canReply={c.canReply} onDone={reload} testid={`inbox-missed-${i}-reply`} />
          </li>
        ))}
      </ul>
    </section>
  );
}
