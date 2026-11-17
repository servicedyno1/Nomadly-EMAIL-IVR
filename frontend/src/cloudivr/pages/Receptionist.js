import React, { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { BotMessageSquare, Plus, ArrowLeft, ChevronRight, CalendarCheck, MessageSquareText, PhoneCall, Check, RotateCcw, Clock, Hash, Inbox } from 'lucide-react';
import { api, useApi, when, enc } from '../api';
import { PageHeader, SkeletonRows, SkeletonPage, Empty, ErrorNote, TabStrip } from '../ui';
import { cp } from '../paths';
import { usePrivacy } from '../privacy';
import { AgentForm, EMPTY_AGENT } from './ai/AgentForm';
import { defaultHours } from './ai/HoursFields';
import { TestTalk } from './ai/TestTalk';
import { AiCalls } from './ai/AiCalls';
import AgentNumbers from './ai/AgentNumbers';

const NEW_RECEPTIONIST = () => ({ ...EMPTY_AGENT, role: 'receptionist', name: 'Receptionist', waitForHello: false, takeMessages: true, hours: defaultHours(), goal: 'Friendly receptionist. Answer callers’ questions from the FAQs, take a message with their name and number, and offer to have someone call them back.' });
const isReceptionist = (a) => a.role === 'receptionist' || a.numbers.length > 0;

function Steps() {
  const s = [[BotMessageSquare, 'Greeting & answers', 'What it says and what it knows'], [Hash, 'Pick a number', 'It answers every call to that number'], [Inbox, 'Read messages', 'By email and here, with a summary']];
  return (
    <ol className="grid sm:grid-cols-3 gap-3 mb-8" data-testid="rec-steps">
      {s.map(([Icon, t, sub], i) => (
        <li key={t} className="civr-card p-4 flex items-start gap-3" data-testid={`rec-step-${i}`}>
          <span className="w-8 h-8 rounded-full bg-[#818cf8]/15 text-[#818cf8] flex items-center justify-center text-sm font-bold shrink-0">{i + 1}</span>
          <span><span className="flex items-center gap-1.5 font-semibold text-sm"><Icon className="w-4 h-4 text-[#818cf8]" />{t}</span><span className="block text-xs text-[#a1a1aa] mt-0.5">{sub}</span></span>
        </li>
      ))}
    </ol>
  );
}

function HoursPill({ a }) {
  if (!a.hours?.enabled) return <span className="civr-pill" data-testid="rec-hours-pill">Answers 24/7</span>;
  const closed = a.hours.afterHours === 'voicemail' ? 'voicemail' : 'takes messages';
  return <span className={a.openNow ? 'civr-pill civr-pill-on' : 'civr-pill civr-pill-warn'} data-testid="rec-hours-pill">{a.openNow ? `Open now · closed: ${closed}` : `Closed now · ${closed}`}</span>;
}

function List({ agents }) {
  const pv = usePrivacy();
  const recs = agents.filter(isReceptionist);
  if (!recs.length) return <Empty icon={BotMessageSquare} title="No AI receptionist yet" sub="Set one up in a few minutes: a greeting, your FAQs and opening hours. Test it free in your browser, then give it a number." testid="rec-empty"><Link to={cp('/app/receptionist/new')} className="civr-btn civr-btn-primary" data-testid="rec-empty-create-button"><Plus className="w-4 h-4" />Set up a receptionist</Link></Empty>;
  return (
    <div className="flex flex-col gap-3" data-testid="rec-list">
      {recs.map((a, i) => (
        <Link key={a.id} to={cp(`/app/receptionist/${a.id}`)} className="civr-card civr-card-link p-4 sm:p-6 flex items-center gap-4" data-testid={`rec-row-${i}`}>
          <div className="w-11 h-11 rounded-full bg-[#818cf8]/15 flex items-center justify-center shrink-0"><BotMessageSquare className="w-5 h-5 text-[#818cf8]" /></div>
          <div className="flex-1 min-w-0">
            <div className="font-semibold truncate">{a.name}{a.businessName ? ` · ${a.businessName}` : ''}</div>
            <div className="text-xs text-[#a1a1aa] mt-0.5" data-testid={`rec-row-${i}-numbers`}>{a.numbers.length ? `Answers ${a.numbers.map(n => pv.phone(n)).join(', ')}` : 'Not answering a number yet'}</div>
            <div className="flex flex-wrap gap-2 mt-2"><HoursPill a={a} />{a.booking?.enabled && <span className="civr-pill civr-pill-on"><CalendarCheck className="w-3.5 h-3.5" />Books visits</span>}{a.transferTo && <span className="civr-pill">Transfers to a person</span>}</div>
          </div>
          <ChevronRight className="w-4 h-4 text-[#a1a1aa]" />
        </Link>
      ))}
    </div>
  );
}

function MessageRow({ m, i, onMark }) {
  const pv = usePrivacy();
  const done = !!m.handledAt;
  const back = m.message?.callback || m.other;
  return (
    <div className={`civr-card p-4 sm:p-6 ${done ? 'opacity-70' : ''}`} data-testid={`rec-msg-${i}`}>
      <div className="flex flex-wrap items-start gap-3">
        {m.booking ? <CalendarCheck className="w-5 h-5 text-[#34d399] mt-0.5" /> : <MessageSquareText className="w-5 h-5 text-[#fbbf24] mt-0.5" />}
        <div className="flex-1 min-w-0">
          <div className="font-semibold" data-testid={`rec-msg-${i}-from`}>{m.message?.name ? `${pv.text(m.message.name, '•••')} · ` : ''}{pv.phone(m.other)}</div>
          <div className="text-xs text-[#a1a1aa]">{`${when(m.startedAt)} · to ${pv.phone(m.number)} · ${m.agentName}${m.afterHours ? ' · after hours' : ''}`}</div>
        </div>
        {done && <span className="civr-pill civr-pill-on" data-testid={`rec-msg-${i}-done`}>Done</span>}
      </div>
      {m.message?.text && <p className="mt-3 text-sm border-l-2 border-[#fbbf24] pl-3" data-testid={`rec-msg-${i}-text`}>{pv.text(m.message.text, 'Message hidden')}</p>}
      {m.booking && <p className="mt-3 text-sm" data-testid={`rec-msg-${i}-booking`}>{`Booked ${m.booking.day} at ${m.booking.time}`}</p>}
      {m.summary && <p className="mt-2 text-sm text-[#a1a1aa]">{pv.text(m.summary, 'Summary hidden')}</p>}
      <div className="flex flex-wrap gap-2 mt-4">
        <a href={`tel:${back}`} className="civr-btn civr-btn-ghost civr-btn-sm" data-testid={`rec-msg-${i}-call`}><PhoneCall className="w-4 h-4" />Call back {pv.phone(back)}</a>
        <button type="button" className="civr-btn civr-btn-ghost civr-btn-sm" onClick={() => onMark(m, !done)} data-testid={`rec-msg-${i}-mark`}>{done ? <><RotateCcw className="w-4 h-4" />Reopen</> : <><Check className="w-4 h-4" />Mark done</>}</button>
      </div>
    </div>
  );
}

function Messages({ onChange }) {
  const [open, setOpen] = useState(true);
  const { data, loading, error, reload } = useApi(`/ai-receptionist/messages?open=${open ? 1 : 0}`);
  const mark = async (m, handled) => {
    try { await api(`/ai-receptionist/messages/${enc(m.id)}`, { method: 'PUT', body: { handled } }); toast.success(handled ? 'Marked as done' : 'Reopened'); reload(); onChange?.(); } catch (e) { toast.error(e.message); }
  };
  const list = data?.messages || [];
  return (
    <div className="flex flex-col gap-4" data-testid="rec-messages">
      <div className="flex gap-2" role="group" aria-label="Show">
        {[[true, `To do${data ? ` (${data.open})` : ''}`], [false, 'All']].map(([v, l]) => <button key={l} type="button" onClick={() => setOpen(v)} className={`civr-btn civr-btn-sm ${open === v ? 'civr-btn-primary' : 'civr-btn-ghost'}`} data-testid={`rec-messages-filter-${v ? 'open' : 'all'}`}>{l}</button>)}
      </div>
      <ErrorNote error={error} onRetry={reload} />
      {loading && !data ? <SkeletonRows rows={3} /> : !list.length ? <Empty icon={Inbox} title={open ? 'Nothing to do' : 'No messages yet'} sub="When a caller leaves a message, asks for a call back or books a visit, it shows up here and in your email." testid="rec-messages-empty" />
        : list.map((m, i) => <MessageRow key={m.id} m={m} i={i} onMark={mark} />)}
    </div>
  );
}

const TABS = [['receptionists', 'Receptionists'], ['messages', 'Messages'], ['calls', 'Call summaries']];

export default function Receptionist() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || 'receptionists';
  const { data, loading, error, reload } = useApi('/ai-agents');
  const { data: msgs, reload: reloadCount } = useApi('/ai-receptionist/messages?open=1&limit=1');
  return (
    <div data-testid="receptionist-page">
      <PageHeader label="Answer calls" title="AI receptionist" sub={`Picks up your number, answers questions, takes messages and books visits. $${data?.receptionRate ?? 0.1}/min from your wallet on any plan; browser tests are free.`} testid="receptionist-header">
        <Link to={cp('/app/receptionist/new')} className="civr-btn civr-btn-primary" data-testid="receptionist-new-button"><Plus className="w-4 h-4" />New receptionist</Link>
      </PageHeader>
      <Steps />
      <TabStrip active={tab} className="mb-6" testid="rec-tabstrip">
        {TABS.map(([id, name]) => <button key={id} role="tab" aria-selected={tab === id} onClick={() => setParams({ tab: id }, { replace: true })} data-testid={`rec-tab-${id}`} className={`px-4 py-3 text-sm font-medium border-b-2 -mb-px transition-colors shrink-0 ${tab === id ? 'border-[#818cf8] text-[#818cf8]' : 'border-transparent text-[#a1a1aa] hover:text-white'}`}>{name}{id === 'messages' && msgs?.open ? <span className="ml-2 civr-pill civr-pill-warn" data-testid="rec-tab-messages-count">{msgs.open}</span> : null}</button>)}
      </TabStrip>
      <ErrorNote error={error} onRetry={reload} className="mb-4" />
      {tab === 'messages' ? <Messages onChange={reloadCount} /> : tab === 'calls' ? <AiCalls direction="inbound" /> : loading && !data ? <SkeletonRows rows={2} /> : data && <List agents={data.agents} />}
    </div>
  );
}

export function ReceptionistEdit() {
  const { id } = useParams();
  const nav = useNavigate();
  const isNew = id === undefined;
  const { data: list } = useApi('/ai-agents');
  const { data, loading, error, setData } = useApi(isNew ? null : `/ai-agents/${id}`);
  const [params] = useSearchParams();
  const prepFor = isNew && params.get('prep') ? params.get('number') : null;
  const [fresh] = useState(NEW_RECEPTIONIST);
  const agent = isNew ? fresh : data?.agent;
  return (
    <div data-testid="receptionist-edit-page">
      <Link to={cp('/app/receptionist')} className="inline-flex items-center gap-2 min-h-[44px] text-sm text-[#a1a1aa] hover:text-[#818cf8] mb-3" data-testid="rec-back-link"><ArrowLeft className="w-4 h-4" />AI receptionist</Link>
      <PageHeader label="AI receptionist" title={isNew ? 'New receptionist' : agent?.name || 'Receptionist'} testid="rec-edit-header" />
      <ErrorNote error={error} />
      {prepFor && <div className="civr-card p-4 mb-4 text-sm" data-testid="rec-prep-note">{`Setting up a receptionist for ${prepFor}. Add your business name and answers, save, then assign the number on the right.`}</div>}
      {!isNew && loading && !agent ? <SkeletonPage header={false} cards={2} rows={0} /> : agent && (
        <div className="grid xl:grid-cols-5 gap-4 items-start">
          <div className="xl:col-span-3"><AgentForm mode="receptionist" key={agent.id || 'new'} initial={{ ...agent, role: 'receptionist', hours: agent.hours || defaultHours() }} voices={list?.voices} recordRate={list?.recordRate} recordingDays={list?.recordingDays} onSaved={(a) => (isNew ? nav(cp(`/app/receptionist/${a.id}`), { replace: true }) : setData({ agent: a }))} onDeleted={() => nav(cp('/app/receptionist'))} /></div>
          <div className="xl:col-span-2 space-y-4">{isNew ? <div className="civr-card p-6 text-sm text-[#a1a1aa] flex gap-3" data-testid="rec-save-first-note"><Clock className="w-5 h-5 text-[#818cf8] shrink-0" />Save the receptionist, then talk to it here in your browser and pick the number it answers.</div> : <><AgentNumbers agent={agent} agents={list?.agents || []} /><TestTalk agent={agent} /><AiCalls agentId={agent.id} /></>}</div>
        </div>
      )}
    </div>
  );
}
