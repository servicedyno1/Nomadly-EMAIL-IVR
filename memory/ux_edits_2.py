import sys
sys.path.insert(0, '/app/memory')
from ux_edit_helper import edit

R = '/app/frontend/src/cloudivr/'
S = "import { useSearch, SearchBox, NoMatches } from '../search';"
S2 = "import { useSearch, SearchBox, NoMatches } from '../../search';"

edit(R + 'pages/Numbers.js', [
("import { usePrivacy } from '../privacy';", "import { usePrivacy } from '../privacy';\n" + S),
("  const nums = data?.numbers || [];", "  const nums = data?.numbers || [];\n  const s = useSearch(nums, n => [n.phoneNumber, n.countryName, n.country, n.planName, n.status, n.type?.replace('_', '-'), n.isSubNumber ? 'Extra' : '']);"),
("""        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
          {nums.map((n, i) => (""",
"""        <>
        <SearchBox s={s} placeholder="Search numbers" testid="numbers-search" className="mb-4 max-w-md" />
        <NoMatches s={s} testid="numbers-no-matches" />
        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
          {s.list.map((n, i) => ("""),
("""          ))}
        </div>
      )}
    </div>
  );""",
"""          ))}
        </div>
        </>
      )}
    </div>
  );"""),
])

edit(R + 'pages/Inbox.js', [
("import { useLangTick } from '../i18n';", "import { useLangTick } from '../i18n';\n" + S),
("const ICON = Object.fromEntries(KINDS.map(([k, , I]) => [k, I]));", "const ICON = Object.fromEntries(KINDS.map(([k, , I]) => [k, I]));\nconst NAME = Object.fromEntries(KINDS.map(([k, l]) => [k, l]));"),
("  const items = data?.notifications || [];", "  const items = data?.notifications || [];\n  const s = useSearch(items, n => [n.text, n.kind, NAME[n.kind], n.meta?.coupon]);"),
("""      <div className="flex flex-wrap gap-2 mb-6">{KINDS.map(([k, l]) => <button key={k || 'all'} onClick={() => setKind(k)} className={`civr-pill cursor-pointer ${kind === k ? 'civr-pill-on' : ''}`} data-testid={`inbox-filter-${k || 'all'}`}>{l}</button>)}</div>""",
"""      <div className="flex flex-col lg:flex-row lg:items-center gap-3 mb-6">
        <SearchBox s={s} placeholder="Search messages" testid="inbox-search" className="lg:w-72 shrink-0" />
        <div className="flex flex-wrap gap-2">{KINDS.map(([k, l]) => <button key={k || 'all'} onClick={() => setKind(k)} className={`civr-pill cursor-pointer ${kind === k ? 'civr-pill-on' : ''}`} data-testid={`inbox-filter-${k || 'all'}`}>{l}</button>)}</div>
      </div>"""),
("""        <div className="space-y-2">
          {items.map((n, i) => {""",
"""        <div className="space-y-2">
          <NoMatches s={s} testid="inbox-no-matches" />
          {s.list.map((n, i) => {"""),
])

edit(R + 'pages/Campaigns.js', [
("import { CampaignKind, AiCampaignFields } from './ai/AiCampaignFields';", "import { CampaignKind, AiCampaignFields } from './ai/AiCampaignFields';\n" + S + "\nimport { useUnsaved, UnsavedPill } from '../guard';"),
("  const list = data?.campaigns || [];", "  const list = data?.campaigns || [];\n  const s = useSearch(list, c => [c.audioName || 'Campaign', c.callerId, c.status, c.mode === 'ai' ? 'AI voice agent' : '']);"),
("""        <div className="space-y-3">
          {list.map((c, i) => (""",
"""        <div className="space-y-3">
          <SearchBox s={s} placeholder="Search campaigns" testid="campaigns-search" className="max-w-md" />
          <NoMatches s={s} testid="campaigns-no-matches" />
          {s.list.map((c, i) => ("""),
("""  const [error, setError] = useState(null);""",
"""  const [error, setError] = useState(null);
  const u = useUnsaved({ f, kind, script });"""),
("""      nav(cp(`/app/campaigns/${d.campaign.id}`));""", """      u.reset();
      nav(cp(`/app/campaigns/${d.campaign.id}`));"""),
("""      <form onSubmit={create} className="grid lg:grid-cols-2 gap-4">""", """      <form onSubmit={create} className="grid lg:grid-cols-2 gap-4" {...u.bind}>"""),
("""{busy === 'create' && <Loader2 className="w-4 h-4 animate-spin" />}Save campaign</button>""",
 """{busy === 'create' && <Loader2 className="w-4 h-4 animate-spin" />}Save campaign</button>
          <UnsavedPill show={u.dirty} testid="campaign-unsaved-pill" />"""),
])

edit(R + 'pages/AudioLibrary.js', [
("import { ask } from '../i18n';\n", ""),
("import { PageHeader, Field, Spinner, ErrorNote, Empty } from '../ui';", "import { PageHeader, Field, Spinner, ErrorNote, Empty } from '../ui';\nimport { undoable } from '../undo';\n" + S),
("function AudioRow({ a, i, reload }) {", "function AudioRow({ a, i, reload, hide }) {"),
("""  const remove = async () => { if (!(await ask(`Delete “${a.name}”? Numbers using it fall back to the default greeting.`, { danger: true, ok: 'Delete' }))) return; try { await api(`/audio/${a.id}`, { method: 'DELETE' }); toast.success('Deleted'); reload(); } catch (e) { toast.error(e.message); } };""",
"""  const remove = () => undoable('Audio deleted', {
    description: 'Numbers using it go back to the standard greeting.',
    hide: () => hide(a.id),
    restore: reload,
    run: async () => { await api(`/audio/${a.id}`, { method: 'DELETE' }); reload(); },
  });"""),
("""  const { data, error, loading, reload } = useApi('/audio');
  const audios = data?.audios || [];""",
"""  const { data, error, loading, reload, setData } = useApi('/audio');
  const audios = data?.audios || [];
  const s = useSearch(audios, a => [a.name, a.source === 'tts' ? 'Text to speech' : 'Upload']);
  const hide = (id) => setData(d => ({ ...d, audios: (d?.audios || []).filter(x => x.id !== id) }));"""),
("""audios.map((a, i) => <AudioRow key={a.id} a={a} i={i} reload={reload} />)}""",
 """<>
          <SearchBox s={s} placeholder="Search audio" testid="audio-search" className="max-w-md" />
          <NoMatches s={s} testid="audio-no-matches" />
          {s.list.map((a, i) => <AudioRow key={a.id} a={a} i={i} reload={reload} hide={hide} />)}
        </>}"""),
])

edit(R + 'pages/AiAgents.js', [
("import { DncList } from './ai/DncList';", "import { DncList } from './ai/DncList';\n" + S),
("""function AgentRows({ agents }) {
  const pv = usePrivacy();""",
"""function AgentRows({ agents }) {
  const pv = usePrivacy();
  const s = useSearch(agents, a => [a.name, a.businessName, a.voice, LANG_NAME[a.language], ...a.numbers]);"""),
("""    <div className="space-y-3">
      {agents.map((a, i) => (""",
"""    <div className="space-y-3">
      <SearchBox s={s} placeholder="Search agents" testid="ai-agents-search" className="max-w-md" />
      <NoMatches s={s} testid="ai-agents-no-matches" />
      {s.list.map((a, i) => ("""),
])

edit(R + 'pages/ai/AiCalls.js', [
("import { usePrivacy } from '../../privacy';", "import { usePrivacy } from '../../privacy';\n" + S2),
("""  if (loading && !data) return <Spinner />;
  const list = data?.calls || [];""",
"""  const list = data?.calls || [];
  const s = useSearch(list, c => [c.other, c.agentName, c.summary, outcomeLabel(c.outcome), c.direction === 'test' ? 'Browser test' : c.direction]);
  if (loading && !data) return <Spinner />;"""),
("""list.map((c, i) => <Row key={c.id} c={c} i={i} />)}""",
 """<>
        <SearchBox s={s} placeholder="Search calls" testid="ai-calls-search" />
        <NoMatches s={s} testid="ai-calls-no-matches" />
        {s.list.map((c, i) => <Row key={c.id} c={c} i={i} />)}
      </>}"""),
])

edit(R + 'pages/ai/DncList.js', [
("import { undoable } from '../../undo';", "import { undoable } from '../../undo';\n" + S2),
("  const list = data?.numbers || [];", "  const list = data?.numbers || [];\n  const s = useSearch(list, d => [d.number, d.reason === 'manual' ? 'added by you' : d.reason]);"),
("""        <div className="civr-card divide-y divide-[#1f1f1f]">
          {list.map((d, i) => (""",
"""        <>
        <SearchBox s={s} placeholder="Search the list" testid="ai-dnc-search" className="max-w-md" />
        <NoMatches s={s} testid="ai-dnc-no-matches" />
        {!!s.list.length && <div className="civr-card divide-y divide-[#1f1f1f]">
          {s.list.map((d, i) => ("""),
("""          ))}
        </div>
      )}
    </div>
  );
}""",
"""          ))}
        </div>}
        </>
      )}
    </div>
  );
}"""),
])

edit(R + 'LogTable.js', [("const labelOf = (t) =>", "export const labelOf = (t) =>")])

G = "import { useUnsaved, SaveRow } from '../../guard';"
edit(R + 'pages/number/SettingsTabs.js', [
("import { VoiceMaker } from '../../VoiceMaker';", "import { VoiceMaker } from '../../VoiceMaker';\n" + G),
("""export const Card = ({ title, sub, children }) => (
  <div className="civr-card p-6 max-w-2xl">""",
"""export const Card = ({ title, sub, children, bind }) => (
  <div className="civr-card p-6 max-w-2xl" {...bind}>"""),
("  const [save, busy] = useSave(num, 'forwarding', reload);", "  const [save, busy] = useSave(num, 'forwarding', reload);\n  const u = useUnsaved(f);"),
("""<Card title="Call forwarding" sub="Send calls to any phone. Forwarded minutes bill from your wallet.">""",
 """<Card title="Call forwarding" sub="Send calls to any phone. Forwarded minutes bill from your wallet." bind={u.bind}>"""),
("""      <button className="civr-btn civr-btn-primary" disabled={busy} onClick={() => save(f)} data-testid="forwarding-save-button">Save forwarding</button>""",
 """      <SaveRow dirty={u.dirty} testid="forwarding-unsaved-pill"><button className="civr-btn civr-btn-primary" disabled={busy} onClick={async () => { if (await save(f)) u.reset(); }} data-testid="forwarding-save-button">Save forwarding</button></SaveRow>"""),
("  const [save, busy] = useSave(num, 'voicemail', reload);", "  const [save, busy] = useSave(num, 'voicemail', reload);\n  const u = useUnsaved(f);"),
("""<Card title="Voicemail" sub="Unanswered callers can leave a message. Recordings land in your inbox.">""",
 """<Card title="Voicemail" sub="Unanswered callers can leave a message. Recordings land in your inbox." bind={u.bind}>"""),
("""      <button className="civr-btn civr-btn-primary" disabled={busy} onClick={() => save(f)} data-testid="voicemail-save-button">Save voicemail</button>""",
 """      <SaveRow dirty={u.dirty} testid="voicemail-unsaved-pill"><button className="civr-btn civr-btn-primary" disabled={busy} onClick={async () => { if (await save(f)) u.reset(); }} data-testid="voicemail-save-button">Save voicemail</button></SaveRow>"""),
("  const [save, busy] = useSave(num, 'sms', reload);", "  const [save, busy] = useSave(num, 'sms', reload);\n  const u = useUnsaved(f);"),
("""<Card title="SMS delivery" sub="Inbound texts always appear in your inbox. Add email or a webhook too (Pro and up).">""",
 """<Card title="SMS delivery" sub="Inbound texts always appear in your inbox. Add email or a webhook too (Pro and up)." bind={u.bind}>"""),
("""      <button className="civr-btn civr-btn-primary" disabled={busy} onClick={() => save(f)} data-testid="sms-save-button">Save SMS settings</button>""",
 """      <SaveRow dirty={u.dirty} testid="sms-unsaved-pill"><button className="civr-btn civr-btn-primary" disabled={busy} onClick={async () => { if (await save(f)) u.reset(); }} data-testid="sms-save-button">Save SMS settings</button></SaveRow>"""),
])

edit(R + 'pages/number/HoursTab.js', [
("import { Field, Toggle } from '../../ui';", "import { Field, Toggle } from '../../ui';\n" + G),
("  const [busy, setBusy] = useState(false);", "  const [busy, setBusy] = useState(false);\n  const u = useUnsaved(f);"),
("toast.success('Hours saved'); reload();", "toast.success('Hours saved'); u.reset(); reload();"),
("""<div className="civr-card p-6 max-w-2xl" data-testid="hours-card">""", """<div className="civr-card p-6 max-w-2xl" data-testid="hours-card" {...u.bind}>"""),
("""        <button className="civr-btn civr-btn-primary" disabled={busy} onClick={save} data-testid="hours-save-button">Save hours</button>""",
 """        <SaveRow dirty={u.dirty} testid="hours-unsaved-pill"><button className="civr-btn civr-btn-primary" disabled={busy} onClick={save} data-testid="hours-save-button">Save hours</button></SaveRow>"""),
])

edit(R + 'pages/number/IvrTab.js', [
("import { OneAnswerNote } from './RouteSummary';", "import { OneAnswerNote } from './RouteSummary';\n" + G),
("  const [save, busy] = useSave(num, 'ivr', reload);", "  const [save, busy] = useSave(num, 'ivr', reload);\n  const u = useUnsaved({ enabled, g, list });"),
("""  const submit = () => save({ enabled, ...current(), language: lang }, 'PUT', (r) => (r?.aiAgentTurnedOff ? 'Saved. The AI voice agent is now off on this number.' : 'Saved'));""",
 """  const submit = async () => { if (await save({ enabled, ...current(), language: lang }, 'PUT', (r) => (r?.aiAgentTurnedOff ? 'Saved. The AI voice agent is now off on this number.' : 'Saved'))) u.reset(); };"""),
("""    <div className="grid lg:grid-cols-3 gap-4">
      <div className="civr-card p-6 lg:col-span-2 space-y-6" data-testid="ivr-builder">""",
 """    <div className="grid lg:grid-cols-3 gap-4" {...u.bind}>
      <div className="civr-card p-6 lg:col-span-2 space-y-6" data-testid="ivr-builder">"""),
("""        <button className="civr-btn civr-btn-primary" disabled={busy} onClick={submit} data-testid="ivr-save-button">Save keypad menu</button>""",
 """        <SaveRow dirty={u.dirty} testid="ivr-unsaved-pill"><button className="civr-btn civr-btn-primary" disabled={busy} onClick={submit} data-testid="ivr-save-button">Save keypad menu</button></SaveRow>"""),
])

edit(R + 'pages/number/AiAgentTab.js', [
("import { OneAnswerNote } from './RouteSummary';", "import { OneAnswerNote } from './RouteSummary';\nimport { useUnsaved, UnsavedPill } from '../../guard';"),
("  const [save, busy] = useSave(num, 'ai-agent', reload);", "  const [save, busy] = useSave(num, 'ai-agent', reload);\n  const u = useUnsaved({ enabled, agentId });"),
("""<div className="civr-card p-6 max-w-2xl space-y-6" data-testid="number-ai-tab">""", """<div className="civr-card p-6 max-w-2xl space-y-6" data-testid="number-ai-tab" {...u.bind}>"""),
("""onClick={() => save({ enabled, agentId }, 'PUT', (r) => (r?.ivrTurnedOff ? 'Saved. The keypad menu is now off on this number.' : 'Saved'))}""",
 """onClick={async () => { if (await save({ enabled, agentId }, 'PUT', (r) => (r?.ivrTurnedOff ? 'Saved. The keypad menu is now off on this number.' : 'Saved'))) u.reset(); }}"""),
("""data-testid="number-ai-edit-agent-link">Edit or test the agent</Link>""", """data-testid="number-ai-edit-agent-link">Edit or test the agent</Link>
        <UnsavedPill show={u.dirty} testid="number-ai-unsaved-pill" />"""),
])

edit(R + 'pages/number/BrowserRingTab.js', [
("import { Card, useSave } from './SettingsTabs';", "import { Card, useSave } from './SettingsTabs';\n" + G),
("  const [save, busy] = useSave(num, 'browser-ring', reload);", "  const [save, busy] = useSave(num, 'browser-ring', reload);\n  const u = useUnsaved(f);"),
("  const submit = async () => { if (await save(f)) rtc.autoConnect(); };", "  const submit = async () => { if (await save(f)) { u.reset(); rtc.autoConnect(); } };"),
("""<Card title="Ring me in the browser" sub=""", """<Card bind={u.bind} title="Ring me in the browser" sub="""),
("""        <button className="civr-btn civr-btn-primary" disabled={busy} onClick={submit} data-testid="browser-ring-save-button">Save</button>""",
 """        <SaveRow dirty={u.dirty} testid="browser-ring-unsaved-pill"><button className="civr-btn civr-btn-primary" disabled={busy} onClick={submit} data-testid="browser-ring-save-button">Save</button></SaveRow>"""),
])

edit(R + 'pages/ai/AgentForm.js', [
("import { BookingFields, browserZone } from './BookingFields';", "import { BookingFields, browserZone } from './BookingFields';\nimport { useUnsaved, UnsavedPill } from '../../guard';"),
("  const [error, setError] = useState(null);", "  const [error, setError] = useState(null);\n  const u = useUnsaved(f);"),
("      toast.success('Agent saved'); onSaved(d.agent);", "      u.reset(); toast.success('Agent saved'); onSaved(d.agent);"),
("toast.success('Agent deleted'); onDeleted();", "toast.success('Agent deleted'); u.reset(); onDeleted();"),
("""<form onSubmit={save} className="civr-card p-6 space-y-6" data-testid="ai-agent-form">""", """<form onSubmit={save} className="civr-card p-6 space-y-6" data-testid="ai-agent-form" {...u.bind}>"""),
("""data-testid="ai-agent-delete-button"><Trash2 className="w-4 h-4" />Delete</button>}""", """data-testid="ai-agent-delete-button"><Trash2 className="w-4 h-4" />Delete</button>}
        <UnsavedPill show={u.dirty} testid="ai-agent-unsaved-pill" />"""),
])

edit(R + 'pages/Settings.js', [
("import { Referral, Suggest } from './settings/Rewards';", "import { Referral, Suggest } from './settings/Rewards';\nimport { useUnsaved, SaveRow } from '../guard';"),
("""  const [name, setName] = useState(account.name || '');
  const [busy, setBusy] = useState(false);""",
"""  const [name, setName] = useState(account.name || '');
  const [busy, setBusy] = useState(false);
  const u = useUnsaved(name);"""),
("setAccount(d.account); toast.success('Profile saved');", "setAccount(d.account); u.reset(); toast.success('Profile saved');"),
("""<form onSubmit={save} className="civr-card p-6 space-y-6" data-testid="settings-profile-form">""", """<form onSubmit={save} className="civr-card p-6 space-y-6" data-testid="settings-profile-form" {...u.bind}>"""),
("""      <button className="civr-btn civr-btn-primary" disabled={busy} data-testid="settings-profile-save-button">{busy && <Loader2 className="w-4 h-4 animate-spin" />}Save profile</button>""",
 """      <SaveRow dirty={u.dirty} testid="settings-profile-unsaved-pill"><button className="civr-btn civr-btn-primary" disabled={busy} data-testid="settings-profile-save-button">{busy && <Loader2 className="w-4 h-4 animate-spin" />}Save profile</button></SaveRow>"""),
("""  const [f, setF] = useState({ currentPassword: '', newPassword: '' });
  const [busy, setBusy] = useState(false);""",
"""  const [f, setF] = useState({ currentPassword: '', newPassword: '' });
  const [busy, setBusy] = useState(false);
  const u = useUnsaved(f);"""),
("setF({ currentPassword: '', newPassword: '' }); refresh();", "setF({ currentPassword: '', newPassword: '' }); u.reset(); refresh();"),
("""<form onSubmit={save} className="civr-card p-6 space-y-6" data-testid="settings-password-form">""", """<form onSubmit={save} className="civr-card p-6 space-y-6" data-testid="settings-password-form" {...u.bind}>"""),
("""      <button className="civr-btn civr-btn-primary" disabled={busy} data-testid="settings-password-save-button">{busy && <Loader2 className="w-4 h-4 animate-spin" />}Save password</button>""",
 """      <SaveRow dirty={u.dirty} testid="settings-password-unsaved-pill"><button className="civr-btn civr-btn-primary" disabled={busy} data-testid="settings-password-save-button">{busy && <Loader2 className="w-4 h-4 animate-spin" />}Save password</button></SaveRow>"""),
])

edit(R + 'pages/NumberDetail.js', [
("import { usePrivacy } from '../privacy';", "import { usePrivacy } from '../privacy';\nimport { confirmLeave } from '../guard';"),
("""onClick={() => setParams({ tab: id }, { replace: true })} data-testid={`number-tab-${id}`}""",
 """onClick={async () => { if (id !== tab && await confirmLeave()) setParams({ tab: id }, { replace: true }); }} data-testid={`number-tab-${id}`}"""),
])

edit(R + 'pages/textcall/History.js', [
("import { ask } from '../../i18n';", "import { undoable } from '../../undo';"),
("function Row({ c, onDeleted, onOpenLive }) {", "function Row({ c, onDelete, onOpenLive }) {"),
("""  const del = async () => { if (!(await ask('Delete this call and its transcript?', { danger: true, ok: 'Delete' }))) return; try { await api(`/relay/calls/${c.id}`, { method: 'DELETE' }); onDeleted(); } catch (err) { toast.error(err.message); } };""",
 """  const del = () => onDelete(c);"""),
("""  const { data, reload } = useApi('/relay/calls');""",
"""  const { data, reload, setData } = useApi('/relay/calls');
  const remove = (c) => undoable('Text call deleted', {
    hide: () => setData(d => ({ ...d, calls: (d?.calls || []).filter(x => x.id !== c.id) })),
    restore: reload,
    run: async () => { await api(`/relay/calls/${c.id}`, { method: 'DELETE' }); reload(); },
  });"""),
("onDeleted={reload}", "onDelete={remove}"),
])

edit('/app/js/cloudivr-web/support.js', [
("Settings (language, default voice, password); browser phone",
 "Settings (language, default voice, password); Help center (short how-to articles: book icon in the sidebar or the phone More menu, ? icon in the top bar opens help for the current page); browser phone"),
])
