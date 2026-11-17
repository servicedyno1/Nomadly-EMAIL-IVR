import React, { useContext, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { cp } from '../../paths';
import { Plus, Trash2, BarChart3 } from 'lucide-react';
import { useApi, enc } from '../../api';
import { InstantToggle, AudioSelect } from '../../ui';
import { VoiceMaker } from '../../VoiceMaker';
import { IvrTemplates } from './IvrTemplates';
import { IvrSms } from './IvrSms';
import { IvrFlow } from './IvrFlow';
import { CheckWith, ConfirmAsk, PayFields } from './IvrLive';
import { IvrCtx, BoxFields, DevicesFields, RingGroupFields, AiFields, FaxFields, CallbackFields, SubLang, Extensions } from './IvrMore';
import { useSave, numContext } from './SettingsTabs';
import { OneAnswerNote } from './RouteSummary';
import { useUnsaved, SaveRow } from '../../guard';
import { LANGS, tr, useLang } from '../../i18n';
import { Assist } from '../../Assist';

const LABELS = { greeting: 'Greeting', options: 'Keys', extensions: 'Extensions', afterHours: 'After-hours menu' };
const EXAMPLES = ['Press 1 for sales at +14155550100, 2 for support at +14155550101, 3 to leave a voicemail', 'Add a key that reads our opening hours', 'Make the greeting warmer, we’re Bella’s Bakery'];

// Built-in IVR texts per language (same as js/voicemail-greeting.js).
const DEFAULTS = {
  en: { greeting: 'Thank you for calling. Please select an option.', fallback: 'Thank you for calling. Please listen to the following options.', sub: 'Please select an option.' },
  fr: { greeting: 'Merci de votre appel. Veuillez choisir une option.', fallback: 'Merci de votre appel. Veuillez écouter les options suivantes.', sub: 'Veuillez choisir une option.' },
  es: { greeting: 'Gracias por llamar. Por favor, seleccione una opción.', fallback: 'Gracias por llamar. Por favor, escuche las siguientes opciones.', sub: 'Por favor, seleccione una opción.' },
};
const defOf = (lang) => DEFAULTS[lang] || DEFAULTS.en;
const isDef = (text, keys) => !String(text || '').trim() || Object.values(DEFAULTS).some(d => keys.some(k => d[k] === String(text).trim()));

const ACTIONS = [['forward', 'Forward to a phone'], ['message', 'Play a message'], ['sms', 'Send the caller a text'], ['voicemail', 'Take a voicemail'], ['webhook', 'Live answer from your system or database'], ['collect', 'Collect digits (then route)'], ['pin', 'Ask for a PIN'], ['pay', 'Text a payment link'], ['queue', 'Call queue (team)'], ['devices', 'Ring my browser phone / desk phones'], ['ringgroup', 'Ring my team group'], ['ai', 'Talk to my AI assistant'], ['fax', 'Fax me a document'], ['callback', 'Call me back later'], ['submenu', 'Open a sub-menu / language choice']];
const DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];
const toList = (opts) => Object.entries(opts || {}).map(([digit, o]) => ({ digit, ...o, subMenu: o.subMenu ? { ...o.subMenu, options: toList(o.subMenu.options) } : undefined }));
const toObj = (list) => Object.fromEntries(list.map(({ digit, subMenu, ...o }) => [digit, { ...o, ...(o.action === 'submenu' ? { subMenu: { ...(subMenu || {}), options: toObj(subMenu?.options || []) } } : {}) }]));

function Greeting({ g, set, audios, prefix, label = 'Greeting', onAudio }) {
  const audio = !!g.greetingAudioUrl || g.mode === 'audio';
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-sm"><span className="text-[#d4d4d8] mr-2">{label}</span>
        {[['text', 'Spoken text'], ['audio', 'Audio file']].map(([m, l]) => <button key={m} type="button" onClick={() => set({ mode: m, greetingAudioUrl: m === 'text' ? null : g.greetingAudioUrl })} className={`civr-pill cursor-pointer whitespace-nowrap ${(audio ? 'audio' : 'text') === m ? 'civr-pill-on' : ''}`} data-testid={`${prefix}-greeting-mode-${m}`}>{l}</button>)}
      </div>
      {audio ? <AudioSelect value={g.greetingAudioUrl} onChange={v => set({ greetingAudioUrl: v || null, mode: 'audio' })} audios={audios} onAdded={onAudio} testid={`${prefix}-greeting-audio-select`} />
        : <><textarea rows={2} className="civr-input" value={g.greeting || ''} onChange={e => set({ greeting: e.target.value })} data-testid={`${prefix}-greeting-text-input`} />
          {onAudio && <VoiceMaker text={g.greeting} name={label} onMade={(a) => { onAudio(); set({ greetingAudioUrl: a.audioUrl, mode: 'audio' }); }} testid={`${prefix}-greeting-voice`} />}</>}
    </div>
  );
}

function RowHead({ o, set, onRemove, used, depth, prefix }) {
  return (
    <div className="flex flex-wrap gap-2 items-center">
      <select className="civr-input !w-20 font-mono" value={o.digit} onChange={e => set({ digit: e.target.value })} data-testid={`${prefix}-digit-select`}>{DIGITS.filter(d => d === o.digit || !used.includes(d)).map(d => <option key={d}>{d}</option>)}</select>
      <select className="civr-input !w-auto flex-1 min-w-0 max-w-full" value={o.action} onChange={e => set({ action: e.target.value, ...(['webhook', 'collect', 'pin'].includes(e.target.value) && o.confirm === undefined ? { confirm: true } : {}) })} data-testid={`${prefix}-action-select`}>{ACTIONS.filter(([a]) => depth < 3 || a !== 'submenu').map(([a, l]) => <option key={a} value={a}>{l}</option>)}</select>
      <input className="civr-input !w-40" value={o.label || ''} onChange={e => set({ label: e.target.value })} placeholder="Label (e.g. Sales)" data-testid={`${prefix}-label-input`} />
      <button type="button" onClick={onRemove} className="p-2 text-[#a1a1aa] hover:text-[#fb7185]" data-testid={`${prefix}-remove-button`} aria-label="Remove option"><Trash2 className="w-4 h-4" /></button>
    </div>
  );
}

function ActionFields({ o, set, audios, prefix, onAudio }) {
  const x = useContext(IvrCtx);
  if (o.action === 'voicemail') return <BoxFields o={o} set={set} prefix={prefix} />;
  if (o.action === 'devices') return <DevicesFields o={o} set={set} prefix={prefix} ctx={x.ctx} />;
  if (o.action === 'ringgroup') return <RingGroupFields prefix={prefix} ctx={x.ctx} />;
  if (o.action === 'ai') return <AiFields o={o} set={set} prefix={prefix} agents={x.agents} />;
  if (o.action === 'fax') return <FaxFields o={o} set={set} prefix={prefix} faxNumbers={x.faxNumbers} />;
  if (o.action === 'callback') return <CallbackFields o={o} set={set} prefix={prefix} />;
  if (o.action === 'sms') return <IvrSms o={o} set={set} prefix={prefix} />;
  if (o.action === 'message' && onAudio) return <div className="space-y-2"><div className="grid md:grid-cols-2 gap-2"><input className="civr-input" value={o.message || ''} onChange={e => set({ message: e.target.value })} placeholder="Text to read out" data-testid={`${prefix}-message-input`} /><AudioSelect value={o.audioUrl} onChange={v => set({ audioUrl: v || null })} audios={audios} placeholder="…or pick audio" onAdded={onAudio} compact testid={`${prefix}-message-audio-select`} /></div>{o.message && !o.audioUrl && <VoiceMaker text={o.message} name={o.label || `Key ${o.digit}`} onMade={(a) => { onAudio(); set({ audioUrl: a.audioUrl }); }} testid={`${prefix}-message-voice`} />}</div>;
  if (o.action === 'forward') return <input className="civr-input font-mono" value={o.forwardTo || ''} onChange={e => set({ forwardTo: e.target.value })} placeholder="+14155550100" data-testid={`${prefix}-forward-input`} />;
  if (o.action === 'webhook') return <div className="space-y-2">{o.check?.source !== 'db' && <input className="civr-input font-mono" value={o.url || ''} onChange={e => set({ url: e.target.value })} placeholder="https://your-system.com/hook" data-testid={`${prefix}-webhook-url`} />}<input className="civr-input" value={o.message || ''} onChange={e => set({ message: e.target.value })} placeholder={o.check?.source ? 'What to say when there is no live answer (optional)' : 'What to say after calling it (optional)'} data-testid={`${prefix}-webhook-message`} /><CheckWith o={o} set={set} prefix={prefix} kind="webhook" /><ConfirmAsk o={o} set={set} prefix={prefix} />{o.check?.source !== 'db' && <p className="text-xs text-[#71717a]">We POST who called, the number and the key to this secure https address.</p>}</div>;
  if (o.action === 'queue') { const ov = o.overflow || { action: 'message' }; return <div className="space-y-2">
    <textarea className="civr-input font-mono" rows={2} value={Array.isArray(o.agents) ? o.agents.join('\n') : (o.agents || '')} onChange={e => set({ agents: e.target.value.split(/[\n,;]+/).map(x => x.trimStart()) })} placeholder={'Team phones, one per line (up to 5)\n+14155550101'} data-testid={`${prefix}-queue-agents`} />
    <div className="grid md:grid-cols-2 gap-2">
      <label className="text-xs text-[#a1a1aa]">Longest wait (seconds)<input className="civr-input mt-1" type="number" min="30" max="900" value={o.maxWait || 180} onChange={e => set({ maxWait: Number(e.target.value) })} data-testid={`${prefix}-queue-maxwait`} /></label>
      <label className="text-xs text-[#a1a1aa]">If nobody answers<select className="civr-input mt-1" value={ov.action || 'message'} onChange={e => set({ overflow: { ...ov, action: e.target.value } })} data-testid={`${prefix}-queue-overflow`}><option value="message">Play a closing message</option><option value="voicemail">Take a voicemail</option><option value="forward">Try another phone</option></select></label>
    </div>
    {ov.action === 'forward' && <input className="civr-input font-mono" value={ov.forwardTo || ''} onChange={e => set({ overflow: { ...ov, forwardTo: e.target.value } })} placeholder="+14155550100" data-testid={`${prefix}-queue-overflow-forward`} />}
    {(ov.action || 'message') === 'message' && <input className="civr-input" value={ov.message || ''} onChange={e => set({ overflow: { ...ov, message: e.target.value } })} placeholder="Closing message (optional)" data-testid={`${prefix}-queue-overflow-message`} />}
    <label className="flex items-center gap-2 text-sm text-[#d4d4d8]"><input type="checkbox" checked={o.announcePosition !== false} onChange={e => set({ announcePosition: e.target.checked })} data-testid={`${prefix}-queue-announce`} />Tell callers their place in the queue</label>
    <label className="flex items-center gap-2 text-sm text-[#d4d4d8]"><input type="checkbox" checked={o.callback === true} onChange={e => set({ callback: e.target.checked })} data-testid={`${prefix}-queue-callback`} />Offer a call back while waiting (you get their number to ring back)</label>
    <p className="text-xs text-[#71717a]">Callers hear hold music while these phones ring one after another until someone answers.</p>
  </div>; }
  if (o.action === 'pay') return <PayFields o={o} set={set} prefix={prefix} />;
  if (o.action === 'collect') return <div className="space-y-2"><input className="civr-input" value={o.prompt || ''} onChange={e => set({ prompt: e.target.value })} placeholder="What to ask (e.g. Enter your order number)" data-testid={`${prefix}-collect-prompt`} /><div className="grid md:grid-cols-2 gap-2"><input className="civr-input" type="number" min="1" max="20" value={o.length || 6} onChange={e => set({ length: Number(e.target.value) })} placeholder="How many digits" data-testid={`${prefix}-collect-length`} /><input className="civr-input font-mono" value={o.forwardTo || ''} onChange={e => set({ forwardTo: e.target.value })} placeholder="Then connect to +1… (optional)" data-testid={`${prefix}-collect-forward`} /></div><input className="civr-input font-mono" value={o.webhook || ''} onChange={e => set({ webhook: e.target.value })} placeholder="Send digits to https://… (optional)" data-testid={`${prefix}-collect-webhook`} /><input className="civr-input" value={o.message || ''} onChange={e => set({ message: e.target.value })} placeholder="Say after (optional)" data-testid={`${prefix}-collect-message`} /><CheckWith o={o} set={set} prefix={prefix} kind="collect" /><ConfirmAsk o={o} set={set} prefix={prefix} /></div>;
  if (o.action === 'pin') return <div className="space-y-2"><input className="civr-input" value={o.prompt || ''} onChange={e => set({ prompt: e.target.value })} placeholder="What to ask (e.g. Enter your staff code)" data-testid={`${prefix}-pin-prompt`} /><CheckWith o={o} set={set} prefix={prefix} kind="pin" />{o.check?.source ? <label className="block text-xs text-[#a1a1aa]">Longest code (digits)<input className="civr-input mt-1" type="number" min="3" max="12" value={o.length || 6} onChange={e => set({ length: Number(e.target.value) })} data-testid={`${prefix}-pin-length`} /></label> : <input className="civr-input font-mono" value={o.pin || ''} onChange={e => set({ pin: e.target.value.replace(/\D/g, '') })} placeholder="PIN code, e.g. 4821" data-testid={`${prefix}-pin-code`} />}<input className="civr-input font-mono" value={o.onOk?.forwardTo || ''} onChange={e => set({ onOk: { ...(o.onOk || {}), action: 'forward', forwardTo: e.target.value } })} placeholder="If correct, connect to +1… (optional)" data-testid={`${prefix}-pin-forward`} /><input className="civr-input" value={o.failMessage || ''} onChange={e => set({ failMessage: e.target.value })} placeholder="Say if the code is wrong (optional)" data-testid={`${prefix}-pin-fail`} /><ConfirmAsk o={o} set={set} prefix={prefix} /><p className="text-xs text-[#71717a]">A simple access code for a members/staff path — not for bank-grade secrets.</p></div>;
  if (o.action === 'message') return <div className="grid md:grid-cols-2 gap-2"><input className="civr-input" value={o.message || ''} onChange={e => set({ message: e.target.value })} placeholder="Text to read out" data-testid={`${prefix}-message-input`} /><AudioSelect value={o.audioUrl} onChange={v => set({ audioUrl: v || null })} audios={audios} placeholder="…or pick audio" onAdded={onAudio} compact testid={`${prefix}-message-audio-select`} /></div>;
  return null;
}

// Generic list of menu keys; `render(o, i, used, onChange, onRemove)` draws each row.
function OptionList({ list, setList, prefix, render }) {
  const used = list.map(o => o.digit);
  const free = DIGITS.find(d => !used.includes(d));
  return (
    <div className="space-y-3">
      {list.map((o, i) => render(o, i, used, (n) => setList(list.map((x, j) => (j === i ? n : x))), () => setList(list.filter((_, j) => j !== i))))}
      {free && <button type="button" className="civr-btn civr-btn-ghost civr-btn-sm" onClick={() => setList([...list, { digit: free, action: 'forward', label: '' }])} data-testid={`${prefix}-add-option-button`}><Plus className="w-4 h-4" />Add key {free}</button>}
    </div>
  );
}

// Path helpers for editing a key straight from the Call flow view (path = digits, e.g. ['1','2']).
const rowAt = (l, [d, ...rest]) => { const r = (l || []).find(x => x.digit === d); return rest.length ? rowAt(r?.subMenu?.options, rest) : r; };
const mapAt = (l, [d, ...rest], fn) => (l || []).flatMap(x => (x.digit !== d ? [x] : rest.length ? [{ ...x, subMenu: { ...(x.subMenu || {}), options: mapAt(x.subMenu?.options, rest, fn) } }] : [fn(x)].filter(Boolean)));
const kidsAt = (l, p) => (p.length ? rowAt(l, p)?.subMenu?.options || [] : l);
const freeAt = (l, p) => DIGITS.find(d => !kidsAt(l, p).some(s => s.digit === d));

function FlowEditor({ path, setPath, list, setList, audios, onAudio }) {
  const o = rowAt(list, path);
  if (!o) return null;
  const used = kidsAt(list, path.slice(0, -1)).map(x => x.digit);
  const set = (patch) => { setList(mapAt(list, path, x => ({ ...x, ...patch }))); if (patch.digit) setPath([...path.slice(0, -1), patch.digit]); };
  return (
    <>
      <RowHead o={o} set={set} onRemove={() => { setList(mapAt(list, path, () => null)); setPath(null); }} used={used} depth={path.length - 1} prefix="ivr-flow-edit" />
      <ActionFields o={o} set={set} audios={audios} prefix="ivr-flow-edit" onAudio={onAudio} />
      {o.action === 'submenu' && <input className="civr-input" value={o.subMenu?.greeting || ''} onChange={e => set({ subMenu: { options: [], ...(o.subMenu || {}), greeting: e.target.value } })} placeholder="Sub-menu greeting, e.g. Press 1 for billing" data-testid="ivr-flow-edit-sub-greeting" />}
    </>
  );
}

// One menu key row; recurses into sub-menus (up to 3 levels deep, matching the call executor).
function MenuRow({ o, onChange, onRemove, used, audios, prefix, onAudio, depth = 0 }) {
  const { lang } = useLang();
  const set = (patch) => onChange({ ...o, ...patch });
  const sub = o.subMenu || { greeting: defOf(lang).sub, options: [] };
  const sp = `${prefix}-sub`;
  return (
    <div className="border border-[#222] rounded-xl p-4 space-y-3" data-testid={prefix}>
      <RowHead o={o} set={set} onRemove={onRemove} used={used} depth={depth} prefix={prefix} />
      <ActionFields o={o} set={set} audios={audios} prefix={prefix} onAudio={onAudio} />
      {o.action === 'submenu' && depth < 3 && (
        <div className="pl-4 border-l-2 border-[#818cf8]/30 space-y-3">
          <SubLang sub={sub} set={(p) => set({ subMenu: { ...sub, ...p } })} prefix={sp} />
          <Greeting g={sub} set={(p) => set({ subMenu: { ...sub, ...p } })} audios={audios} prefix={sp} label="Sub-menu greeting" onAudio={onAudio} />
          <OptionList list={sub.options || []} setList={(l) => set({ subMenu: { ...sub, options: l } })} prefix={sp}
            render={(so, i, u, ch, rm) => <MenuRow key={i} o={so} used={u} onChange={ch} onRemove={rm} audios={audios} prefix={`${sp}-option-${i}`} onAudio={onAudio} depth={depth + 1} />} />
        </div>
      )}
    </div>
  );
}

// Separate menu outside the Hours schedule (instead of the closed message).
function AfterHours({ ah, setAh, audios, onAudio, hoursOn, number }) {
  return (
    <div className="space-y-3 border-t border-[#222] pt-5" data-testid="ivr-after-hours">
      <label className="flex items-center gap-2 font-display text-lg font-bold"><input type="checkbox" checked={ah.enabled} onChange={e => setAh({ ...ah, enabled: e.target.checked })} data-testid="ivr-after-hours-toggle" />Different menu after hours</label>
      {ah.enabled && <>
        {!hoursOn && <div className="rounded-xl border border-[#fbbf24]/40 bg-[#fbbf24]/5 p-3 text-sm" data-testid="ivr-after-hours-need">This menu plays outside your business hours. Turn on the schedule in the <Link to={cp(`/app/numbers/${encodeURIComponent(number)}?tab=hours`)} className="underline" data-testid="ivr-after-hours-hours-link">Hours tab</Link> first.</div>}
        <Greeting g={ah} set={(p) => setAh({ ...ah, ...p })} audios={audios} prefix="ivr-ah" label="After-hours greeting" onAudio={onAudio} />
        <OptionList list={ah.options} setList={(l) => setAh({ ...ah, options: l })} prefix="ivr-ah"
          render={(o, i, used, ch, rm) => <MenuRow key={i} o={o} used={used} onChange={ch} onRemove={rm} audios={audios} prefix={`ivr-ah-option-${i}`} onAudio={onAudio} depth={0} />} />
      </>}
    </div>
  );
}

function Analytics({ num }) {
  const { data } = useApi(`/numbers/${enc(num.phoneNumber)}/ivr/analytics`);
  const keys = data?.keys || [];
  const max = Math.max(1, ...keys.map(k => k.count));
  return (
    <div className="civr-card p-6 h-fit" data-testid="ivr-analytics">
      <div className="flex items-center gap-2 font-display text-2xl font-bold mb-4"><BarChart3 className="w-5 h-5 text-[#38bdf8]" />Last 30 days</div>
      {!keys.length ? <div className="text-sm text-[#a1a1aa]">No key presses yet.</div> : keys.map((k, i) => (
        <div key={i} className="mb-3" data-testid={`ivr-analytics-row-${i}`}><div className="flex justify-between text-sm"><span>Key {k.digit} · {k.action}</span><span className="font-mono">{k.count}</span></div><div className="h-1.5 bg-[#1c1c1c] rounded-full mt-1"><div className="h-full bg-[#38bdf8] rounded-full" style={{ width: `${(k.count / max) * 100}%` }} /></div></div>
      ))}
    </div>
  );
}

// Built-in template texts are English; show them in the app language (callers hear that language).
const locOpts = (opts) => Object.fromEntries(Object.entries(opts || {}).map(([d, o]) => [d, { ...o, label: o.label && tr(o.label), message: o.message && tr(o.message), subMenu: o.subMenu ? { ...o.subMenu, greeting: tr(o.subMenu.greeting || ''), options: locOpts(o.subMenu.options) } : undefined }]));

export default function IvrTab({ num, reload }) {
  const { lang } = useLang();
  const langName = (LANGS.find(([c]) => c === lang) || LANGS[0])[1];
  const [params] = useSearchParams();
  const ivr = num.features.ivr || {};
  const { data, reload: reloadAudio } = useApi('/audio');
  const audios = data?.audios;
  const mn = useApi('/mobile-numbers');
  const textingNumbers = (mn.data?.items || []).filter(x => ['provisioning', 'active'].includes(x.status)).map(x => ({ id: x.id, phone: x.phoneNumber || 'being assigned', kind: x.kind === 'mobile' ? 'Texting Number' : 'USA eSIM' }));
  const enabled = !!ivr.enabled;
  const [g, setG] = useState({ greeting: ivr.greeting || defOf(lang).greeting, greetingAudioUrl: ivr.greetingAudioUrl || null });
  const [list, setList] = useState(toList(ivr.options));
  const [ah, setAh] = useState({ enabled: !!ivr.afterHours?.enabled, greeting: ivr.afterHours?.greeting || '', greetingAudioUrl: ivr.afterHours?.greetingAudioUrl || null, options: toList(ivr.afterHours?.options) });
  const [exts, setExts] = useState(ivr.extensions || []);
  const ag = useApi('/ai-agents');
  const fx = useApi('/fax');
  const agents = ag.data ? (ag.data.agents || []).map(a => ({ id: a.id, name: a.name })) : null;
  const faxNumbers = fx.data ? (fx.data.numbers || []).filter(n => n.eligible).map(n => n.phoneNumber) : null;
  const extra = { number: num.phoneNumber, textingNumbers, aiAgents: agents, faxNumbers, sipLogin: !!num.sipUsername, ringGroupMembers: (num.features?.ringGroup?.members || []).filter(Boolean).length, hoursOn: !!num.features?.hours?.enabled };
  // On a language switch, greetings still on a built-in default follow the new language; custom text stays.
  useEffect(() => {
    const d = defOf(lang);
    setG(x => (isDef(x.greeting, ['greeting', 'fallback']) && x.greeting !== d.greeting ? { ...x, greeting: d.greeting } : x));
    setList(l => l.map(o => (o.subMenu && isDef(o.subMenu.greeting, ['sub']) && o.subMenu.greeting !== d.sub ? { ...o, subMenu: { ...o.subMenu, greeting: d.sub } } : o)));
  }, [lang]);
  const [save, busy] = useSave(num, 'ivr', reload);
  const u = useUnsaved({ g, list, ah, exts });
  const current = () => ({ greeting: g.greeting, greetingAudioUrl: g.greetingAudioUrl || null, options: toObj(list), afterHours: { enabled: ah.enabled, greeting: ah.greeting, greetingAudioUrl: ah.greetingAudioUrl || null, options: toObj(ah.options) }, extensions: exts });
  const submit = async () => { if (await save({ enabled, ...current(), language: lang }, 'PUT', (r) => (r?.aiAgentTurnedOff ? 'Saved. The AI voice agent is now off on this number.' : enabled ? 'Saved' : 'Saved — flip the switch above to turn the menu on'))) u.reset(); };
  const prep = params.get('prep') === 'menu' && !enabled && !Object.keys(ivr.options || {}).length;
  const apply = (c) => { setG({ greeting: tr(c.greeting || ''), greetingAudioUrl: c.greetingAudioUrl || null }); setList(toList(locOpts(c.options))); };
  return (
    <IvrCtx.Provider value={{ ctx: extra, agents, faxNumbers }}>
    <div className="grid 2xl:grid-cols-3 gap-4" {...u.bind}>
      <div className="civr-card p-4 sm:p-6 2xl:col-span-2 space-y-6 min-w-0" data-testid="ivr-builder">
        <div className="flex items-center justify-between">
          <div><div className="font-display text-2xl font-bold">Keypad menu (IVR)</div><p className="text-sm text-[#a1a1aa]">For people who call this number: they hear your greeting, then press a key to reach the right place.</p></div>
          <InstantToggle num={num} feature="ivr" label="Keypad menu" checked={enabled} reload={reload} testid="ivr-enabled-toggle" />
        </div>
        {prep && <div className="rounded-xl border border-[#818cf8]/30 bg-[#818cf8]/5 p-3 text-sm" data-testid="ivr-prep-note">We prepared a “press 1 for sales” menu below. Add the phone numbers it should forward to, Save, then switch the menu on.</div>}
        {num.features.aiAgent?.enabled && <OneAnswerNote testid="ivr-ai-agent-note">Your AI voice agent answers this number now. Turning the keypad menu on switches the AI voice agent off — a number uses one or the other.</OneAnswerNote>}
        <Assist screen="ivr" title="Build this menu by chatting" hello="Tell me what callers should be able to do — I’ll write the greeting and set up each key." examples={EXAMPLES} labels={LABELS} testid="ivr-assist" context={numContext(num, extra)}
          current={{ greeting: g.greeting, options: list, afterHours: { ...ah }, extensions: exts }}
          onApply={({ greeting, options, afterHours, extensions }) => { u.touch(); if (greeting !== undefined) setG({ greeting, greetingAudioUrl: null }); if (options) setList(options); if (afterHours) setAh({ enabled: afterHours.enabled !== false, greeting: afterHours.greeting || '', greetingAudioUrl: null, options: afterHours.options || [] }); if (extensions) setExts(extensions); }} />
        <Greeting g={g} set={(p) => setG({ ...g, ...p })} audios={audios} prefix="ivr" onAudio={reloadAudio} />
        <p className="text-xs text-[#a1a1aa] -mt-3" data-testid="ivr-language-note">{`Callers hear typed text in ${langName}, the app's language. Change the app language to change it.`}</p>
        <OptionList list={list} setList={setList} prefix="ivr"
          render={(o, i, u, ch, rm) => <MenuRow key={i} o={o} used={u} onChange={ch} onRemove={rm} audios={audios} prefix={`ivr-option-${i}`} onAudio={reloadAudio} depth={0} />} />
        <Extensions list={exts} setList={setExts} ctx={extra} />
        <AfterHours ah={ah} setAh={setAh} audios={audios} onAudio={reloadAudio} hoursOn={extra.hoursOn} number={num.phoneNumber} />
        <SaveRow dirty={u.dirty} testid="ivr-unsaved-pill"><button className="civr-btn civr-btn-primary" disabled={busy} onClick={submit} data-testid="ivr-save-button">Save keypad menu</button></SaveRow>
      </div>
      <div className="space-y-4"><IvrFlow greeting={g.greeting} list={list} afterHours={ah} extensions={exts} context={numContext(num, extra)} edit={{
        canAdd: (p) => !!freeAt(list, p),
        onAdd: (p) => { const d = freeAt(list, p); if (!d) return null; const row = { digit: d, action: 'forward', label: '' }; u.touch(); setList(p.length ? mapAt(list, p, x => ({ ...x, subMenu: { greeting: '', ...(x.subMenu || {}), options: [...(x.subMenu?.options || []), row] } })) : [...list, row]); return [...p, d]; },
        renderEditor: (p, setPath) => <FlowEditor path={p} setPath={setPath} list={list} setList={(l) => { u.touch(); setList(l); }} audios={audios} onAudio={reloadAudio} />,
      }} /><IvrTemplates current={current} onApply={(c) => { if (prep) u.touch(); apply(c); }} auto={prep} /><Analytics num={num} /></div>
    </div>
    </IvrCtx.Provider>
  );
}
