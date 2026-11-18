import React from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { Workflow, PhoneForwarded, Voicemail, Clock, Lock, PlusCircle, ChevronRight, Hash } from 'lucide-react';
import { useApi, enc } from '../api';
import { PageHeader, SkeletonRows, Empty, ErrorNote } from '../ui';
import { cp } from '../paths';
import { usePrivacy } from '../privacy';
import { answering } from './NumberDetail';

const MODES = {
  ivr: {
    title: 'Phone menus (IVR)', label: 'Answer calls · IVR', Icon: Workflow,
    sub: 'Greet callers and let them press a key — "1 for sales, 2 for support". Pick a number to build or edit its menu.',
    links: [['ivr', 'Keypad menu', Workflow, 'ivr']],
  },
  forwarding: {
    title: 'Answering rules', label: 'Answer calls', Icon: PhoneForwarded,
    sub: 'Send calls to your mobile or team, take voicemail when nobody answers, and set your opening hours — per number.',
    links: [['forwarding', 'Forwarding', PhoneForwarded, 'callForwarding'], ['voicemail', 'Voicemail', Voicemail, 'voicemail'], ['hours', 'Hours', Clock, null]],
  },
};

function NumberRow({ n, mode, i }) {
  const pv = usePrivacy();
  const now = answering(n.features);
  return (
    <div className="civr-card p-4 sm:p-5 flex flex-col md:flex-row md:items-center gap-4" data-testid={`answer-row-${i}`}>
      <Link to={cp(`/app/numbers/${enc(n.phoneNumber)}`)} className="flex items-center gap-3 min-w-0 flex-1 group" data-testid={`answer-row-${i}-open`}>
        <span className="w-10 h-10 rounded-xl bg-[var(--c-accent-soft)] flex items-center justify-center shrink-0"><Hash className="w-5 h-5 text-[var(--c-accent)]" /></span>
        <span className="min-w-0">
          <span className="block font-mono text-lg truncate group-hover:text-[var(--c-accent)] transition-colors">{pv.phone(n.phoneNumber)}</span>
          <span className="block text-xs text-[#a1a1aa]">{n.planName}{n.isSubNumber ? ' · extra' : ''} · <span data-testid={`answer-row-${i}-now`}>{now ? `Answered by: ${now[1]}` : 'Rings normally'}</span></span>
        </span>
      </Link>
      <div className="flex flex-wrap gap-2">
        {mode.links.map(([tab, label, Icon, gate]) => {
          const locked = gate && !n.access?.[gate];
          return (
            <Link key={tab} to={cp(`/app/numbers/${enc(n.phoneNumber)}?tab=${tab}`)} className="civr-btn civr-btn-ghost civr-btn-sm" data-testid={`answer-row-${i}-${tab}`}>
              {locked ? <Lock className="w-4 h-4 text-[#fbbf24]" aria-label="Needs a higher plan" /> : <Icon className="w-4 h-4" />}{label}<ChevronRight className="w-3.5 h-3.5 opacity-60" />
            </Link>
          );
        })}
      </div>
    </div>
  );
}

// "Answer calls" hub: every number with how it is answered now, one tap into the right settings tab.
export default function AnswerCalls() {
  const { mode: m } = useParams();
  const mode = MODES[m];
  const { data, loading, error, reload } = useApi('/numbers');
  if (!mode) return <Navigate to={cp('/app/answer/ivr')} replace />;
  const nums = (data?.numbers || []).filter(n => n.status === 'active' && n.capabilities?.voice !== false);
  return (
    <div data-testid={`answer-page-${m}`}>
      <PageHeader label={mode.label} title={mode.title} sub={mode.sub} testid="answer-header">
        <Link to={cp('/app/buy?purpose=voice')} className="civr-btn civr-btn-primary" data-testid="answer-get-number-button"><PlusCircle className="w-4 h-4" />Get a Business Line</Link>
      </PageHeader>
      <ErrorNote error={error} onRetry={reload} className="mb-4" />
      {loading && !data ? <SkeletonRows rows={3} /> : !nums.length ? (
        <Empty icon={mode.Icon} title="No phone number yet" sub="Calls are answered on a number. Get one first, then come back here to choose how it answers." testid="answer-empty">
          <Link to={cp('/app/buy?purpose=voice')} className="civr-btn civr-btn-primary" data-testid="answer-empty-get-number"><PlusCircle className="w-4 h-4" />Get a Business Line</Link>
        </Empty>
      ) : (
        <div className="civr-list" data-testid="answer-list">
          {nums.map((n, i) => <NumberRow key={n.phoneNumber} n={n} mode={mode} i={i} />)}
          <p className="text-sm text-[#a1a1aa] mt-2 pb-20 lg:pb-0">Want an AI to pick up instead? <Link to={cp('/app/receptionist')} className="text-[var(--c-accent)] underline underline-offset-2" data-testid="answer-ai-link">Set up an AI receptionist</Link></p>
        </div>
      )}
    </div>
  );
}
