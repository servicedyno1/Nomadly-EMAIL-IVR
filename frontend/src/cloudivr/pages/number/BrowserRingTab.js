import React, { useState } from 'react';
import { toast } from 'sonner';
import { Link } from 'react-router-dom';
import { BellRing, Loader2 } from 'lucide-react';
import { api, enc, money, useApi } from '../../api';
import { Field, Toggle } from '../../ui';
import { cp } from '../../paths';
import { useShell } from '../../Shell';
import { useRtc } from '../../rtc';
import { askNotify, notifyState } from '../../ringAlerts';
import { Card, useSave } from './SettingsTabs';
import { useUnsaved, SaveRow } from '../../guard';

const MODES = [['ask', 'Ask each time: voice or text'], ['voice', 'Always voice'], ['text', 'Always text (answers by itself)']];
const LANGS = [['en', 'English'], ['es', 'Spanish'], ['fr', 'French']];
const ALERT = { granted: 'Alerts on — calls show a notification when this tab is in the background.', denied: 'Alerts are blocked in this browser’s site settings.', default: 'Allow alerts so a call reaches you when this tab is in the background.' };

function Alerts() {
  const [state, setState] = useState(notifyState());
  if (state === 'unsupported') return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border border-[#222] rounded-xl p-4" data-testid="browser-ring-alerts">
      <div className="text-sm text-[#d4d4d8] flex-1 min-w-[200px]" data-testid="browser-ring-alerts-status">{ALERT[state]}</div>
      {state === 'default' && <button type="button" className="civr-btn civr-btn-ghost civr-btn-sm" onClick={async () => setState(await askNotify())} data-testid="browser-ring-alerts-button"><BellRing className="w-4 h-4" />Allow alerts</button>}
    </div>
  );
}

// Why a call may not ring here right now, and whether voice answering is possible.
function Notes({ num }) {
  const rtc = useRtc();
  const f = num.features;
  const { data: info } = useApi('/relay/info');
  const blocked = [f.aiAgent?.enabled && num.access?.aiAgent && 'the AI voice agent answers calls', f.ivr?.enabled && 'the keypad menu is on', f.callForwarding?.enabled && f.callForwarding.mode === 'always' && 'calls are always forwarded'].filter(Boolean);
  const here = rtc.phone === num.phoneNumber;
  return (
    <ul className="text-xs text-[#a1a1aa] space-y-2 list-disc pl-4" data-testid="browser-ring-notes">
      {blocked.length > 0 && <li className="text-[#fbbf24]" data-testid="browser-ring-blocked-note">{`Right now ${blocked.join(' and ')}, so calls to this number will not ring in the browser.`}</li>}
      {num.sipUsername
        ? <li data-testid="browser-ring-voice-note"><span>Voice: the browser phone connects by itself while the app is open.</span>{here && <span className={`ml-1 ${rtc.status === 'ready' ? 'text-[#34d399]' : ''}`} data-testid="browser-ring-voice-status">{rtc.status === 'ready' ? 'Online now.' : 'Offline right now.'}</span>}{here && rtc.status !== 'ready' && rtc.msg && <span className="block mt-1">{rtc.msg}</span>}</li>
        : <li data-testid="browser-ring-voice-note">To also answer by voice, create a SIP login in the <Link to={cp(`/app/numbers/${enc(num.phoneNumber)}?tab=sip`)} className="text-[#34d399] underline">SIP tab</Link>.</li>}
      {info && <li>{`Text: same price as text calls — ${money(info.usRate + info.relayRate)}/min US & Canada, ${money(info.intlRate + info.relayRate)}/min international, from your wallet. Not counted in plan minutes.`}</li>}
      <li>{`Rings for ${f.callForwarding?.ringTimeout || 25} seconds. If nobody answers, the call goes to your usual fallback (forwarding when not answered, voicemail, or a missed call).`}</li>
      <li>Only rings while CloudIVR is open in a browser tab. The AI voice agent, keypad menus, always-forward and closed hours skip the browser.</li>
    </ul>
  );
}

function TryIt({ num, saved }) {
  const [from, setFrom] = useState('+14155550123');
  const [busy, setBusy] = useState(false);
  const ring = async () => {
    setBusy(true);
    try { await api('/incoming/simulate', { method: 'POST', body: { phone: num.phoneNumber, from } }); toast.success('Ringing — look at the top of the page'); } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };
  return (
    <div className="border border-dashed border-[#fbbf24]/40 rounded-xl p-4 space-y-3" data-testid="browser-ring-try">
      <div className="text-sm font-medium">Try it with a pretend call (preview)</div>
      <div className="flex flex-col sm:flex-row gap-2">
        <input className="civr-input font-mono" value={from} onChange={e => setFrom(e.target.value)} aria-label="Pretend caller" data-testid="browser-ring-try-from-input" />
        <button type="button" className="civr-btn civr-btn-ghost shrink-0" disabled={busy || !saved} onClick={ring} data-testid="browser-ring-try-button">{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <BellRing className="w-4 h-4" />}Ring me now</button>
      </div>
      {!saved && <p className="text-xs text-[#a1a1aa]">Switch ringing on and save first.</p>}
    </div>
  );
}

export default function BrowserRingTab({ num, reload }) {
  const br = num.features.browserRing;
  const { catalog } = useShell();
  const rtc = useRtc();
  const [f, setF] = useState({ enabled: !!br.enabled, answerMode: br.answerMode || 'ask', lang: br.lang || 'en', voice: br.voice || 'female', announce: br.announce !== false });
  const [save, busy] = useSave(num, 'browser-ring', reload);
  const u = useUnsaved(f);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const turn = (v) => { setF({ ...f, enabled: v }); if (v) askNotify(); };
  const submit = async () => { if (await save(f)) { u.reset(); rtc.autoConnect(); } };
  return (
    <div className="space-y-4">
      <Card bind={u.bind} title="Ring me in the browser" sub="While CloudIVR is open, calls to this number ring here with a big banner on every page. Answer by typing (text call) or by voice.">
        <div className="flex items-center justify-between gap-4"><span className="text-sm">Ring me in the browser</span><Toggle checked={f.enabled} onChange={turn} testid="browser-ring-enabled-toggle" /></div>
        <Field label="When it rings">
          <select className="civr-input" value={f.answerMode} onChange={set('answerMode')} data-testid="browser-ring-mode-select">{MODES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        </Field>
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="Text answer: language"><select className="civr-input" value={f.lang} onChange={set('lang')} data-testid="browser-ring-lang-select">{LANGS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
          <Field label="Text answer: voice"><select className="civr-input" value={f.voice} onChange={set('voice')} data-testid="browser-ring-voice-select"><option value="female">Female</option><option value="male">Male</option></select></Field>
        </div>
        <div className="flex items-start justify-between gap-4">
          <div><div className="text-sm">Tell the caller it is a typed call</div><div className="text-xs text-[#a1a1aa] mt-1">A short spoken note when you answer as text.</div></div>
          <Toggle checked={f.announce} onChange={v => setF({ ...f, announce: v })} testid="browser-ring-announce-toggle" />
        </div>
        <Alerts />
        <Notes num={num} />
        <SaveRow dirty={u.dirty} testid="browser-ring-unsaved-pill"><button className="civr-btn civr-btn-primary" disabled={busy} onClick={submit} data-testid="browser-ring-save-button">Save</button></SaveRow>
      </Card>
      {catalog?.dryRun && <div className="max-w-2xl"><TryIt num={num} saved={!!br.enabled} /></div>}
    </div>
  );
}
