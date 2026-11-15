import React from 'react';
import { Link } from 'react-router-dom';
import { PhoneForwarded, Voicemail, Users, Workflow, PhoneOutgoing, Megaphone, KeyRound, BotMessageSquare, Bot, Captions, FileText, Disc, Printer, Webhook, Lock, ArrowUpRight } from 'lucide-react';
import { cp } from '../../paths';
import { TIERS } from './PlanHero';

// Platform features, grouped by job. [key (plan access), label, Icon, app path]
const GROUPS = [
  ['answer-calls', 'Answer calls', 'blue', [['callForwarding', 'Call forwarding', PhoneForwarded, 'answer/forwarding'], ['voicemail', 'Voicemail', Voicemail, 'answer/forwarding'], ['ivr', 'Keypad menu (IVR)', Workflow, 'answer/ivr'], ['ringGroup', 'Ring group', Users, 'numbers']]],
  ['make-calls', 'Make calls', 'teal', [['ivrOutbound', 'Quick IVR call', PhoneOutgoing, 'quick-call'], ['bulkCall', 'Bulk IVR campaigns', Megaphone, 'campaigns'], ['sipCredentials', 'Softphone logins (SIP)', KeyRound, 'sip'], ['callRecording', 'Call recording', Disc, 'numbers']]],
  ['ai', 'AI', 'violet', [['aiAgent', 'AI receptionist', BotMessageSquare, 'receptionist'], ['bulkCall', 'AI calling agents', Bot, 'ai-agents'], ['textRelay', 'Text-to-voice calls', Captions, 'text-call'], ['aiSummary', 'AI call summaries', FileText, 'numbers']]],
  ['connect', 'Connect', 'rose', [['fax', 'Fax (50 free pages)', Printer, 'fax'], ['smsWebhook', 'Webhooks', Webhook, 'settings']]],
];

const needs = (catalog, key) => catalog?.plans?.filter(p => TIERS.includes(p.id)).sort((a, b) => TIERS.indexOf(a.id) - TIERS.indexOf(b.id)).find(p => (key === 'fax' ? p.id === 'business' : p.access?.[key]));

function Tile({ f, tone, on, need, upgradeTo }) {
  const [key, label, Icon, to] = f;
  return (
    <Link to={cp(on ? `/app/${to}` : upgradeTo)} className={`civr-card civr-card-link p-4 flex items-center gap-3 ${on ? '' : 'opacity-80'}`} data-testid={`platform-feature-tile-${key}-${to.replace(/\W/g, '')}`}>
      <span className={`civr-chip civr-chip-${on ? tone : 'teal'} ${on ? '' : 'grayscale'}`} aria-hidden><Icon className="w-4 h-4" /></span>
      <span className="flex-1 min-w-0"><span className="block text-sm font-semibold truncate">{label}</span>
        <span className={`block text-xs ${on ? 'text-emerald-700 dark:text-emerald-400' : 'text-[var(--c-muted)]'}`}>{on ? 'Included · open' : need ? `Needs ${need.name}` : 'Not on your plan'}</span></span>
      {on ? <ArrowUpRight className="w-4 h-4 text-[var(--c-muted)]" /> : <Lock className="w-4 h-4 text-[var(--c-muted)]" />}
    </Link>
  );
}

// What the plan unlocks across the platform: included features open, the rest show the tier they need.
export function Platform({ line, catalog }) {
  const access = line ? { ...line.access, fax: line.plan === 'business' } : {};
  const upgradeTo = line ? `/app/numbers/${encodeURIComponent(line.phoneNumber)}?tab=billing` : '/app/buy';
  return (
    <section className="mt-10" data-testid="your-platform-section">
      <h2 className="font-display text-xl font-bold">{line ? `What your ${line.planName} plan includes` : 'What a plan includes'}</h2>
      <p className="text-sm text-[var(--c-muted)] mt-1">Every tool that works with your plan’s numbers. Locked ones show the plan that adds them.</p>
      <div className="grid md:grid-cols-2 gap-6 mt-6">
        {GROUPS.map(([gid, title, tone, items]) => (
          <div key={gid} data-testid={`platform-group-${gid}`}>
            <div className="text-xs font-semibold uppercase tracking-wider text-[var(--c-muted)] mb-3">{title}</div>
            <div className="grid sm:grid-cols-2 gap-3">{items.map(f => <Tile key={`${f[0]}-${f[3]}`} f={f} tone={tone} on={!!access[f[0]]} need={needs(catalog, f[0])} upgradeTo={upgradeTo} />)}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
