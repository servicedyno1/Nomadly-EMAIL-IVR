import React, { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { MessagesSquare } from 'lucide-react';
import { useApi } from '../api';
import { useShell } from '../Shell';
import { cp } from '../paths';
import { PageHeader, Empty, ErrorNote, SkeletonRows } from '../ui';
import { ThreadList } from './messages/ThreadList';
import { Thread } from './messages/Thread';

const useDebounced = (v, ms) => { const [d, setD] = useState(v); useEffect(() => { const t = setTimeout(() => setD(v), ms); return () => clearTimeout(t); }, [v, ms]); return d; };

export default function Messages() {
  const [params, setParams] = useSearchParams();
  const [filter, setFilter] = useState('all');
  const [q, setQ] = useState('');
  const [tag, setTag] = useState('');
  const dq = useDebounced(q, 300);
  const { data, error, reload } = useApi(`/messages?filter=${filter}&q=${encodeURIComponent(dq)}&tag=${encodeURIComponent(tag)}`);
  const { refreshSummary } = useShell();
  const sel = params.get('number') && params.get('contact') ? { number: params.get('number'), contact: params.get('contact') } : null;
  useEffect(() => { const t = setInterval(reload, 10000); return () => clearInterval(t); }, [reload]);
  const threadOpen = !!sel;
  useEffect(() => { document.body.classList.toggle('civr-thread-open', threadOpen); return () => document.body.classList.remove('civr-thread-open'); }, [threadOpen]);
  const pick = (t) => setParams({ number: t.number, contact: t.contact });
  const changed = () => { reload(); refreshSummary(); };
  const none = data && !data.numbers.length;
  const multi = (data?.numbers || []).filter(n => !n.old).length > 1;
  return (
    <div data-testid="messages-page">
      <div className={sel ? 'hidden md:block' : ''}><PageHeader label="Account" title="Messages" sub="Texts, pictures, voicemails and calls with each person, in one conversation." testid="messages-header" /></div>
      {error && <ErrorNote error={error} onRetry={reload} testid="messages-error" />}
      {none ? (
        <Empty icon={MessagesSquare} title="No numbers yet" sub="Get a number, a CloudIVR eSIM or Landline to Texting and conversations show up here." testid="messages-empty-numbers"><Link to={cp('/app/buy')} className="civr-btn civr-btn-primary mt-6" data-testid="messages-buy-link">Buy a number</Link></Empty>
      ) : (
        <div className="civr-card !p-0 overflow-hidden grid md:grid-cols-[340px_1fr] lg:grid-cols-[380px_1fr] h-[calc(100dvh-14rem)] md:h-[calc(100dvh-18rem)] min-h-[440px]" data-testid="messages-layout">
          <div className={`min-h-0 md:border-r border-[var(--c-border)] ${sel ? 'hidden md:block' : ''}`}>
            {!data ? <div className="p-4"><SkeletonRows rows={6} card={false} /></div> : <ThreadList data={data} sel={sel} onPick={pick} filter={filter} setFilter={setFilter} q={q} setQ={setQ} multi={multi} tag={tag} setTag={setTag} />}
            {data && !data.threads.length && <p className="px-6 py-10 text-center text-sm text-[var(--c-muted)]" data-testid="messages-empty">{q || tag || filter !== 'all' ? 'No conversations match.' : 'No conversations yet. When someone texts or calls your numbers, it shows up here.'}</p>}
          </div>
          <div className={`min-h-0 ${sel ? '' : 'hidden md:grid place-items-center'}`}>
            {sel ? <Thread key={`${sel.number}|${sel.contact}`} number={sel.number} contact={sel.contact} onBack={() => setParams({})} onChange={changed} />
              : <div className="text-center text-[var(--c-muted)] p-8" data-testid="messages-pick"><MessagesSquare className="w-10 h-10 mx-auto mb-3 opacity-50" />Pick a conversation</div>}
          </div>
        </div>
      )}
    </div>
  );
}
