import React, { createContext, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { FileUp, Loader2, Printer, Plus, Trash2 } from 'lucide-react';
import { api } from '../../api';
import { cp } from '../../paths';

// Shared with every key editor: number context (phone app login, ring group, hours), your AI agents and fax numbers.
export const IvrCtx = createContext({});

// Keypad keys that reach your own phones, team, AI agent, a fax, or a call back — plus department mailboxes.
const Hint = ({ children }) => <p className="text-xs text-[#71717a]">{children}</p>;
const Need = ({ children, to, cta, testid }) => (
  <div className="rounded-xl border border-[#fbbf24]/40 bg-[#fbbf24]/5 p-3 text-sm flex flex-wrap items-center gap-3" data-testid={testid}>
    <span className="flex-1 min-w-[200px]">{children}</span>
    {to && <Link to={cp(to)} className="civr-btn civr-btn-primary civr-btn-sm" data-testid={`${testid}-cta`}>{cta}</Link>}
  </div>
);

export function BoxFields({ o, set, prefix }) {
  const b = o.box || {};
  const put = (p) => set({ box: { ...b, ...p } });
  return (
    <div className="grid md:grid-cols-2 gap-2" data-testid={`${prefix}-box`}>
      <input className="civr-input" value={b.name || ''} onChange={e => put({ name: e.target.value })} placeholder="Mailbox name, e.g. Billing (optional)" data-testid={`${prefix}-box-name`} />
      <input className="civr-input" type="email" value={b.email || ''} onChange={e => put({ email: e.target.value })} placeholder="Email copies to (optional)" data-testid={`${prefix}-box-email`} />
    </div>
  );
}

export function DevicesFields({ o, set, prefix, ctx }) {
  const na = o.noAnswer || 'voicemail';
  return (
    <div className="space-y-2">
      {ctx?.sipLogin === false && <Need to={`/app/numbers/${encodeURIComponent(ctx.number || '')}?tab=sip`} cta="Open Phone apps" testid={`${prefix}-devices-need`}>This number has no browser phone / phone app login yet. Set it up in the number’s Phone apps tab first.</Need>}
      <div className="grid md:grid-cols-2 gap-2">
        <label className="text-xs text-[#a1a1aa]">Ring for (seconds)<input className="civr-input mt-1" type="number" min="10" max="60" value={o.ringSecs || 25} onChange={e => set({ ringSecs: Number(e.target.value) })} data-testid={`${prefix}-devices-secs`} /></label>
        <label className="text-xs text-[#a1a1aa]">If nobody answers<select className="civr-input mt-1" value={na} onChange={e => set({ noAnswer: e.target.value })} data-testid={`${prefix}-devices-noanswer`}><option value="voicemail">Take a voicemail</option><option value="menu">Back to the menu</option><option value="message">Play a sorry message</option></select></label>
      </div>
      {na === 'voicemail' && <BoxFields o={o} set={set} prefix={prefix} />}
      {na === 'message' && <input className="civr-input" value={o.noAnswerMessage || ''} onChange={e => set({ noAnswerMessage: e.target.value })} placeholder="Sorry message (optional)" data-testid={`${prefix}-devices-message`} />}
      <Hint>Rings your browser phone (keep CloudIVR open) and any phone app signed in to this number. The caller hears ringing.</Hint>
    </div>
  );
}

export function RingGroupFields({ prefix, ctx }) {
  if (!ctx?.ringGroupMembers) return <Need to={`/app/numbers/${encodeURIComponent(ctx?.number || '')}?tab=ringgroup`} cta="Open Ring group" testid={`${prefix}-ringgroup-need`}>Add your team’s phones in this number’s Ring group tab first. The ring group itself can stay switched off.</Need>;
  return <Hint>{`Your ${ctx.ringGroupMembers} team phone${ctx.ringGroupMembers === 1 ? '' : 's'} from the Ring group tab ring together. First to answer gets the call. The group’s own “nobody answers” choice applies.`}</Hint>;
}

export function AiFields({ o, set, prefix, agents }) {
  if (agents && !agents.length) return <Need to="/app/ai-agents" cta="Create an AI agent" testid={`${prefix}-ai-need`}>You have no AI agent yet. Create one (it can answer questions and book appointments), then pick it here.</Need>;
  return (
    <div className="space-y-2">
      <select className="civr-input" value={o.agentId || ''} onChange={e => set({ agentId: e.target.value })} data-testid={`${prefix}-ai-agent`}>
        <option value="">Pick an AI agent…</option>
        {(agents || []).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
      </select>
      <input className="civr-input" value={o.message || ''} onChange={e => set({ message: e.target.value })} placeholder="Say before connecting (optional), e.g. Connecting you to our assistant" data-testid={`${prefix}-ai-message`} />
      <Hint>The agent takes the call from here and is billed per minute like an AI-answered call.</Hint>
    </div>
  );
}

function FaxDoc({ o, set, prefix }) {
  const [busy, setBusy] = useState(false);
  const pick = async (file) => {
    if (!file) return;
    setBusy(true);
    try { const form = new FormData(); form.append('file', file); const r = await api('/fax/ivr-doc', { method: 'POST', form }); set({ fileId: r.fileId, pages: r.pages, docName: r.docName }); toast.success(`${r.docName} ready (${r.pages} page${r.pages === 1 ? '' : 's'})`); } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };
  return (
    <label className="civr-btn civr-btn-ghost civr-btn-sm cursor-pointer w-fit" data-testid={`${prefix}-fax-upload`}>
      {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileUp className="w-4 h-4" />}{o.fileId ? `${o.docName || 'Document'} · ${o.pages || 1} page(s) — replace` : 'Upload the document'}
      <input type="file" className="hidden" accept=".pdf,.doc,.docx,.png,.jpg,.jpeg" onChange={e => pick(e.target.files?.[0])} data-testid={`${prefix}-fax-file`} />
    </label>
  );
}

export function FaxFields({ o, set, prefix, faxNumbers }) {
  const nums = faxNumbers || [];
  return (
    <div className="space-y-2">
      {faxNumbers && !nums.length ? <Need to="/app/buy?purpose=fax" cta="Get a fax number" testid={`${prefix}-fax-need`}><Printer className="w-4 h-4 inline mr-1" />You need a fax number to send from. Get one, then pick it here.</Need>
        : <select className="civr-input font-mono" value={o.faxFrom || ''} onChange={e => set({ faxFrom: e.target.value })} data-testid={`${prefix}-fax-from`}><option value="">Send from which fax number…</option>{nums.map(n => <option key={n} value={n}>{n}</option>)}</select>}
      <FaxDoc o={o} set={set} prefix={prefix} />
      <input className="civr-input" value={o.prompt || ''} onChange={e => set({ prompt: e.target.value })} placeholder="What to ask (optional), e.g. Enter your fax number, then press pound" data-testid={`${prefix}-fax-prompt`} />
      <input className="civr-input" value={o.message || ''} onChange={e => set({ message: e.target.value })} placeholder="Say after sending (optional)" data-testid={`${prefix}-fax-message`} />
      <Hint>Your free fax pages are used first, then the usual page price from your wallet. Up to 20 pages.</Hint>
    </div>
  );
}

export function CallbackFields({ o, set, prefix }) {
  return (
    <div className="space-y-2">
      <input className="civr-input" value={o.message || ''} onChange={e => set({ message: e.target.value })} placeholder="What the caller hears (optional), e.g. We will call you back shortly" data-testid={`${prefix}-callback-message`} />
      <label className="flex items-center gap-2 text-sm text-[#d4d4d8]"><input type="checkbox" checked={o.auto === true} onChange={e => set({ auto: e.target.checked })} data-testid={`${prefix}-callback-auto`} />Ring my phone right away. Press 1 to call them back.</label>
      {o.auto && <input className="civr-input font-mono" value={o.callbackTo || ''} onChange={e => set({ callbackTo: e.target.value })} placeholder="Your phone, e.g. +14155550100" data-testid={`${prefix}-callback-to`} />}
      <Hint>{o.auto ? 'A few seconds after they hang up, your phone rings. Both legs bill per minute from the wallet.' : 'You get a notification with their number to call back.'}</Hint>
    </div>
  );
}

const LANGS = [['', 'Same as the main menu'], ['en', 'English'], ['es', 'Spanish'], ['fr', 'French']];
export function SubLang({ sub, set, prefix }) {
  return (
    <label className="flex flex-wrap items-center gap-2 text-xs text-[#a1a1aa]">Callers in this sub-menu hear
      <select className="civr-input w-full sm:!w-auto" value={sub.language || ''} onChange={e => set({ language: e.target.value || undefined })} data-testid={`${prefix}-language`}>{LANGS.map(([c, l]) => <option key={c} value={c}>{l}</option>)}</select>
      <span>Use it for “press 2 para español”. Write this sub-menu in that language.</span>
    </label>
  );
}

// Staff extensions: callers dial a 2-5 digit code any time during the main greeting.
export function Extensions({ list, setList, ctx }) {
  const put = (i, p) => setList(list.map((e, j) => (j === i ? { ...e, ...p } : e)));
  return (
    <div className="space-y-3" data-testid="ivr-extensions">
      <div><div className="font-display text-lg font-bold">Extensions</div><Hint>Callers can dial a person’s code (e.g. 101) at any time during the main greeting. Say so in the greeting: “If you know your party’s extension, dial it now.” A single key then waits about 2 seconds.</Hint></div>
      {list.map((e, i) => (
        <div key={i} className="flex flex-wrap md:flex-nowrap gap-2 items-center" data-testid={`ivr-ext-${i}`}>
          <input className="civr-input !w-20 font-mono shrink-0" value={e.code || ''} onChange={ev => put(i, { code: ev.target.value.replace(/\D/g, '').slice(0, 5) })} placeholder="101" data-testid={`ivr-ext-${i}-code`} />
          <input className="civr-input flex-1 min-w-[8rem] md:min-w-0 md:basis-32" value={e.name || ''} onChange={ev => put(i, { name: ev.target.value })} placeholder="Name, e.g. Anna" data-testid={`ivr-ext-${i}-name`} />
          <select className="civr-input w-full sm:!w-auto md:shrink-0 md:max-w-[15rem]" value={e.action || 'forward'} onChange={ev => put(i, { action: ev.target.value })} data-testid={`ivr-ext-${i}-action`}><option value="forward">Ring a phone</option>{ctx?.sipLogin !== false && <option value="devices">Ring my browser phone / apps</option>}</select>
          {(e.action || 'forward') === 'forward' && <input className="civr-input flex-1 min-w-[10rem] md:min-w-0 md:basis-40 font-mono" value={e.forwardTo || ''} onChange={ev => put(i, { forwardTo: ev.target.value })} placeholder="+14155550100" data-testid={`ivr-ext-${i}-phone`} />}
          <button type="button" onClick={() => setList(list.filter((_, j) => j !== i))} className="p-2 shrink-0 text-[#a1a1aa] hover:text-[#fb7185]" aria-label="Remove extension" data-testid={`ivr-ext-${i}-remove`}><Trash2 className="w-4 h-4" /></button>
        </div>
      ))}
      {list.length < 30 && <button type="button" className="civr-btn civr-btn-ghost civr-btn-sm" onClick={() => setList([...list, { code: String(101 + list.length), name: '', action: 'forward', forwardTo: '' }])} data-testid="ivr-ext-add"><Plus className="w-4 h-4" />Add an extension</button>}
    </div>
  );
}
