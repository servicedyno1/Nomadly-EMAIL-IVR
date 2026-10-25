import React, { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowRight, ChevronDown, Keyboard, LifeBuoy, MessageCircleQuestion, X } from 'lucide-react';
import { PageHeader } from '../ui';
import { appPath } from '../nav';
import { useShell } from '../Shell';
import { useSearch, SearchBox, NoMatches } from '../search';
import { openHelpChat, SHORTCUTS } from '../shortcuts';
import { ARTICLES, GROUPS, TOPIC_NAMES } from './help/topics';
import { faqItems } from './landing/PricingFaq';

// Landing FAQ answers about plans and prices (the first two are for visitors only).
const faqArticles = (catalog) => faqItems(catalog).slice(2).map(([q, a], i) => ({ id: `faq-${i}`, group: 'plans', topics: ['billing', 'buy', 'wallet'], q, a, to: null }));

function Article({ a, prefix, open, onToggle }) {
  const id = `${prefix}-${a.id}`;
  return (
    <div className="border-b border-[#1f1f1f] last:border-0" data-testid={id}>
      <button type="button" aria-expanded={open} aria-controls={`${id}-body`} onClick={onToggle} className="w-full flex items-center justify-between gap-4 py-4 min-h-[52px] text-left font-semibold text-[#f3f4f6] hover:text-[#34d399] transition-colors" data-testid={`${id}-toggle`}>
        <span>{a.q}</span><ChevronDown className={`w-4 h-4 shrink-0 transition-transform ${open ? 'rotate-180 text-[#34d399]' : 'text-[#a1a1aa]'}`} />
      </button>
      {open && (
        <div id={`${id}-body`} className="pb-5 space-y-4 civr-rise" data-testid={`${id}-body`}>
          <p className="text-sm leading-relaxed text-[#d4d4d8] max-w-2xl">{a.a}</p>
          {a.to && <Link to={appPath(a.to[0])} className="civr-btn civr-btn-ghost civr-btn-sm" data-testid={`${id}-link`}>{a.to[1]}<ArrowRight className="w-4 h-4" /></Link>}
        </div>
      )}
    </div>
  );
}

function Section({ title, items, prefix, open, toggle, testid, children }) {
  return (
    <section data-testid={testid}>
      <div className="flex items-center justify-between gap-3 mb-2"><h2 className="civr-label">{title}</h2>{children}</div>
      <div className="civr-card px-6">{items.map(a => <Article key={a.id} a={a} prefix={prefix} open={open === `${prefix}-${a.id}`} onToggle={() => toggle(`${prefix}-${a.id}`)} />)}</div>
    </section>
  );
}

function Contact({ supportLink }) {
  return (
    <div className="civr-card p-6 space-y-4" data-testid="help-contact-card">
      <div className="font-display text-2xl font-bold">Still stuck?</div>
      <p className="text-sm text-[#a1a1aa]">The help assistant answers right away, in your language. A person from our team can take over on Telegram.</p>
      <button type="button" className="civr-btn civr-btn-primary w-full" onClick={openHelpChat} data-testid="help-open-assistant-button"><MessageCircleQuestion className="w-4 h-4" />Ask the help assistant</button>
      {supportLink && <a href={supportLink} target="_blank" rel="noopener noreferrer" className="civr-btn civr-btn-ghost w-full" data-testid="help-support-link"><LifeBuoy className="w-4 h-4" />Message support</a>}
    </div>
  );
}

function ShortcutList() {
  return (
    <div className="civr-card p-6 hidden md:block" data-testid="help-shortcuts-card">
      <div className="flex items-center gap-2 font-display text-2xl font-bold mb-4"><Keyboard className="w-5 h-5 text-[#38bdf8]" />Keyboard shortcuts</div>
      <div className="space-y-3">
        {SHORTCUTS.map(([k, d]) => <div key={k} className="flex items-center gap-3 text-sm text-[#d4d4d8]"><kbd className="min-w-[2.25rem] h-7 px-2 inline-flex items-center justify-center rounded-md border border-[#2a2a2a] bg-[#151515] font-mono text-xs text-[#f3f4f6]" data-no-translate>{k}</kbd>{d}</div>)}
      </div>
    </div>
  );
}

export default function Help() {
  const [params, setParams] = useSearchParams();
  const topic = params.get('topic');
  const { catalog } = useShell();
  const all = [...ARTICLES, ...faqArticles(catalog)];
  const s = useSearch(all, a => [a.q, a.a]);
  const here = topic ? all.filter(a => a.topics.includes(topic)) : [];
  const [open, setOpen] = useState(() => (here.length === 1 ? `page-${here[0].id}` : null));
  const toggle = (k) => setOpen(o => (o === k ? null : k));
  const common = { open, toggle };
  return (
    <div data-testid="help-page">
      <PageHeader label="Help" title="Help center" sub="Short answers to common questions. Search, or open a topic below." testid="help-header" />
      <div className="grid lg:grid-cols-3 gap-6 items-start">
        <div className="lg:col-span-2 flex flex-col gap-10">
          <SearchBox s={s} placeholder="Search help articles" testid="help-search" />
          {s.active ? <>
            <NoMatches s={s} testid="help-no-matches" />
            {!!s.list.length && <Section title="Search results" items={s.list} prefix="help-result" testid="help-results" {...common} />}
          </> : <>
            {!!here.length && (
              <Section title={`For this page: ${TOPIC_NAMES[topic] || topic}`} items={here} prefix="page" testid="help-for-page" {...common}>
                <button type="button" onClick={() => setParams({}, { replace: true })} className="text-xs text-[#a1a1aa] hover:text-[#34d399] inline-flex items-center gap-1 min-h-[36px]" data-testid="help-clear-topic"><X className="w-3.5 h-3.5" />Show all topics</button>
              </Section>
            )}
            {GROUPS.map(([g, name]) => <Section key={g} title={name} items={all.filter(a => a.group === g)} prefix="help-article" testid={`help-group-${g}`} {...common} />)}
          </>}
        </div>
        <aside className="space-y-4 lg:sticky lg:top-24"><Contact supportLink={catalog?.supportLink} /><ShortcutList /></aside>
      </div>
    </div>
  );
}
