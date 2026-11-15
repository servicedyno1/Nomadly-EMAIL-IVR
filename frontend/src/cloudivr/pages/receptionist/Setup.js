import React from 'react';
import { Link } from 'react-router-dom';
import { BotMessageSquare, Plus, ChevronRight } from 'lucide-react';
import { Empty } from '../../ui';
import { cp } from '../../paths';
import { AI_LANG_NAME } from '../ai/languages';

const whenLabel = (a) => (a.answerWhen === 'outside_hours' ? `Outside ${a.officeHours.start}–${a.officeHours.end}` : '24/7');

export function Setup({ receptionists }) {
  if (!receptionists.length) return <Empty icon={BotMessageSquare} title="No receptionist yet" sub="Tell it about your business, what callers usually ask and what to do with each call. Then test it free in your browser." testid="receptionist-setup-empty"><Link to={cp('/app/receptionist/new')} className="civr-btn civr-btn-primary" data-testid="receptionist-setup-create"><Plus className="w-4 h-4" />Set up receptionist</Link></Empty>;
  return (
    <div className="space-y-3" data-testid="receptionist-setup">
      {receptionists.map((a, i) => (
        <Link key={a.id} to={cp(`/app/receptionist/${a.id}`)} className="civr-card civr-card-link p-5 flex items-center gap-4" data-testid={`receptionist-row-${i}`}>
          <span className="w-11 h-11 rounded-full bg-[var(--c-accent)]/15 grid place-items-center"><BotMessageSquare className="w-5 h-5 text-[var(--c-accent)]" /></span>
          <span className="flex-1 min-w-0"><span className="block font-semibold truncate">{a.name}{a.businessName ? ` · ${a.businessName}` : ''}</span>
            <span className="block text-xs text-[var(--c-muted)]">{[whenLabel(a), AI_LANG_NAME[a.language] || a.language, a.takeMessages ? 'takes messages' : null, a.booking?.enabled ? 'books appointments' : null, a.transferTo ? 'transfers to you' : null].filter(Boolean).join(' · ')}</span></span>
          <span className="civr-pill">{a.numbers.length ? `${a.numbers.length} number${a.numbers.length === 1 ? '' : 's'}` : 'No number'}</span>
          <ChevronRight className="w-4 h-4 text-[var(--c-muted)]" />
        </Link>
      ))}
    </div>
  );
}
