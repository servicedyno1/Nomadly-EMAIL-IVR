import React, { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useApi } from '../api';
import { cp } from '../paths';
import { Wordmark } from '../Brand';
import { Footer } from './landing/PricingFaq';
import { TERMS, UPDATED } from './terms/content';

function Header() {
  return (
    <header className="sticky top-0 z-40 backdrop-blur-xl bg-white/80 border-b border-slate-200/80" data-testid="terms-header">
      <div className="max-w-6xl mx-auto px-6 md:px-8 h-16 flex items-center gap-4">
        <Link to={cp()} className="font-display text-2xl font-extrabold mr-auto min-h-[44px] flex items-center" data-testid="terms-logo-link"><Wordmark accent="#059669" iconClass="w-7 h-7" /></Link>
        <Link to={cp()} className="hidden sm:inline-flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-slate-900 py-3" data-testid="terms-home-link"><ArrowLeft className="w-4 h-4" />Home</Link>
        <Link to={cp('/signup')} className="civr-l-btn civr-l-btn-sm" data-testid="terms-signup-link">Get your number</Link>
      </div>
    </header>
  );
}

function Contents() {
  return (
    <nav className="lg:sticky lg:top-24" aria-label="On this page" data-testid="terms-contents">
      <div className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-3">On this page</div>
      <ol className="flex flex-col gap-1 text-sm">
        {TERMS.map((s, i) => <li key={s.id}><a href={`#${s.id}`} className="block py-1.5 text-slate-600 hover:text-[#4f46e5] transition-colors" data-testid={`terms-contents-${s.id}`}>{`${i + 1}. `}<span>{s.title}</span></a></li>)}
      </ol>
    </nav>
  );
}

function Section({ s, i, supportLink }) {
  return (
    <section id={s.id} className="scroll-mt-24 py-8 border-t border-slate-200 first:border-t-0 first:pt-0" data-testid={`terms-section-${s.id}`}>
      <h2 className="text-xl md:text-2xl font-semibold text-slate-900">{`${i + 1}. `}<span>{s.title}</span></h2>
      <div className="mt-4 space-y-3 text-[15px] leading-relaxed text-slate-600">
        {s.body.map((p) => <p key={p}>{p}</p>)}
        {s.list && <ul className="list-disc pl-5 space-y-2">{s.list.map((p) => <li key={p}>{p}</li>)}</ul>}
        {s.id === 'contact' && supportLink && <p><a href={supportLink} target="_blank" rel="noopener noreferrer" className="text-[#4f46e5] font-medium hover:underline" data-testid="terms-support-link">Message CloudIVR support on Telegram</a></p>}
      </div>
    </section>
  );
}

export default function Terms() {
  const { data: catalog } = useApi('/public/catalog');
  useEffect(() => { if (!window.location.hash) window.scrollTo(0, 0); }, []);
  return (
    <div className="civr-l min-h-screen" data-testid="terms-page">
      <Header />
      <main className="max-w-6xl mx-auto px-6 md:px-8 py-16 md:py-24">
        <div className="max-w-3xl">
          <div className="civr-l-eyebrow text-[#4f46e5]">Legal</div>
          <h1 className="civr-l-h text-4xl sm:text-5xl lg:text-6xl text-slate-900 mt-4" data-testid="terms-title">Terms of Service</h1>
          <p className="text-base text-slate-500 mt-4" data-testid="terms-updated">Last updated {UPDATED}</p>
          <p className="text-base md:text-lg text-slate-600 mt-6">These terms explain what you can expect from CloudIVR and what we expect from you. Please read them before you create an account, buy a number or place a call.</p>
        </div>
        <div className="grid lg:grid-cols-12 gap-12 mt-16">
          <aside className="lg:col-span-4 order-2 lg:order-1 hidden lg:block"><Contents /></aside>
          <article className="lg:col-span-8 order-1 lg:order-2" data-testid="terms-body">
            {TERMS.map((s, i) => <Section key={s.id} s={s} i={i} supportLink={catalog?.supportLink} />)}
          </article>
        </div>
      </main>
      <Footer catalog={catalog} />
    </div>
  );
}
