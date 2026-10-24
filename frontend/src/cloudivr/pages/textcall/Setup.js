import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { Captions, Loader2, PhoneCall } from 'lucide-react';
import { api, money } from '../../api';
import { Field, Spinner, Empty, Locked, Toggle, ErrorNote } from '../../ui';
import { cp } from '../../paths';
import { useCallerNumbers } from '../QuickCall';

const LANGS = [['en', 'English'], ['es', 'Español'], ['fr', 'Français']];
const PREFS = 'civr.relayPrefs';
const load = () => { try { return JSON.parse(localStorage.getItem(PREFS) || '{}'); } catch (_) { return {}; } };

function Choice({ value, options, onChange, testid }) {
  return (
    <div className="flex flex-wrap gap-2" role="radiogroup">
      {options.map(([v, label]) => <button key={v} type="button" role="radio" aria-checked={value === v} onClick={() => onChange(v)} className={`civr-pill cursor-pointer !normal-case !tracking-normal !text-sm h-10 px-4 ${value === v ? 'civr-pill-on' : ''}`} data-testid={`${testid}-${v}`}>{label}</button>)}
    </div>
  );
}

export function Setup({ info, onStarted }) {
  const { numbers, all, loading } = useCallerNumbers('textRelay');
  const [f, setF] = useState(() => ({ callerId: '', to: '', lang: 'en', voice: 'female', name: '', announce: true, ...load() }));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const set = (k) => (v) => setF(p => ({ ...p, [k]: v?.target ? v.target.value : v }));
  if (loading) return <Spinner />;
  if (!all.length) return <Empty icon={Captions} title="Get a number first" sub="Text calls go out from your own CloudIVR number." testid="text-call-no-number"><Link to={cp('/app/buy')} className="civr-btn civr-btn-primary" data-testid="text-call-buy-link">Buy a number</Link></Empty>;
  if (!numbers.length) return <Locked feature="Text calls" phone={all[0].phoneNumber} need="Pro" />;
  const callerId = numbers.some(n => n.phoneNumber === f.callerId) ? f.callerId : numbers[0].phoneNumber;
  const start = async (e) => {
    e.preventDefault(); setBusy(true); setErr(null);
    try {
      const { to, ...prefs } = f;
      const d = await api('/relay/calls', { method: 'POST', body: { ...f, callerId } });
      localStorage.setItem(PREFS, JSON.stringify({ ...prefs, callerId }));
      toast.success('Calling…');
      onStarted(d.call.id);
    } catch (x) { setErr(x); } finally { setBusy(false); }
  };
  return (
    <form onSubmit={start} className="civr-card p-6 md:p-8 space-y-6 civr-rise" data-testid="text-call-setup">
      <div className="grid md:grid-cols-2 gap-5">
        <Field label="Call from"><select className="civr-input font-mono" value={callerId} onChange={set('callerId')} data-testid="text-call-caller-select">{numbers.map(n => <option key={n.phoneNumber} value={n.phoneNumber}>{n.phoneNumber}</option>)}</select></Field>
        <Field label="Number to call" hint="With country code, e.g. +14155550100."><input className="civr-input font-mono text-lg" required inputMode="tel" value={f.to} onChange={set('to')} placeholder="+14155550100" data-testid="text-call-to-input" /></Field>
      </div>
      <Field label="They speak"><Choice value={f.lang} options={LANGS} onChange={set('lang')} testid="text-call-lang" /></Field>
      <Field label="Voice that reads your messages"><Choice value={f.voice} options={[['female', 'Female'], ['male', 'Male']]} onChange={set('voice')} testid="text-call-voice" /></Field>
      <div className="grid md:grid-cols-2 gap-5 items-end">
        <Field label="Your name (optional)" hint="Read in the opening message."><input className="civr-input" maxLength={40} value={f.name} onChange={set('name')} placeholder="Maria" data-testid="text-call-name-input" /></Field>
        <label className="flex items-center justify-between gap-3 civr-card !bg-[#0f0f0f] px-4 h-[68px]"><span className="text-sm"><span className="block font-medium">Tell them it’s a typed call</span><span className="text-xs text-[#a1a1aa]">So they speak clearly and wait for your reply.</span></span><Toggle checked={f.announce} onChange={set('announce')} testid="text-call-announce-toggle" /></label>
      </div>
      <ErrorNote error={err} testid="text-call-error" />
      <div className="flex flex-wrap items-center gap-4">
        <button className="civr-btn civr-btn-primary h-12 px-6 text-base" disabled={busy} data-testid="text-call-start-button">{busy ? <Loader2 className="w-5 h-5 animate-spin" /> : <PhoneCall className="w-5 h-5" />}Start text call</button>
        {info && <span className="text-xs text-[#a1a1aa]" data-testid="text-call-rate-hint">From {money(info.usRate + info.relayRate)}/min, billed per started minute.</span>}
      </div>
    </form>
  );
}
