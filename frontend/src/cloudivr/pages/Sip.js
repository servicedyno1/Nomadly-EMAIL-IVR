import React from 'react';
import { Link } from 'react-router-dom';
import { KeyRound, Lock, Phone, ShoppingCart } from 'lucide-react';
import { useApi, enc } from '../api';
import { useShell } from '../Shell';
import { usePrivacy } from '../privacy';
import { PageHeader, Spinner, Empty } from '../ui';
import { cp } from '../paths';
import { SipCredentials } from './number/SipTab';

const APPS = [
  ['Zoiper', 'Settings → Accounts → Add account → "Yes, I have a SIP account". Put the username, password and server, then Next.'],
  ['Linphone', 'Use a SIP account → enter username, password and domain, transport UDP. Tap Login.'],
  ['MicroSIP', 'Menu → Add account. SIP server and domain = the server, username + password, then Save.'],
];

function Guide({ domain }) {
  return (
    <div className="civr-card p-6 space-y-5 h-fit" data-testid="sip-guide">
      <div className="font-display text-2xl font-bold">Set up a softphone</div>
      <ol className="space-y-3 text-sm text-[#d4d4d8] list-decimal pl-5">
        <li>Install a softphone on your computer or phone (Zoiper, Linphone or MicroSIP are free).</li>
        <li>Add a SIP account with the username and password of the number you want to use.</li>
        <li>Server / domain: <code className="text-[#34d399]" data-testid="sip-guide-domain" data-no-translate>{domain}</code>, port 5060 (UDP or TCP) or 5061 for TLS.</li>
        <li>Save. When the account shows “Registered”, you can call out and answer calls to that number.</li>
      </ol>
      <div className="flex flex-col gap-3">
        {APPS.map(([app, how]) => <div key={app} className="rounded-xl border border-[#262626] p-4" data-testid={`sip-guide-${app.toLowerCase()}`}><div className="font-semibold text-sm" data-no-translate>{app}</div><div className="text-sm text-[#a1a1aa] mt-1">{how}</div></div>)}
      </div>
      <p className="text-xs text-[#a1a1aa]">Calls you make from a softphone bill from your wallet at the outbound rate. Keep your password private.</p>
    </div>
  );
}

function LockedList({ nums }) {
  const pv = usePrivacy();
  if (!nums.length) return null;
  return (
    <div className="civr-card p-6 space-y-3" data-testid="sip-page-locked">
      <div className="flex items-center gap-2 font-semibold"><Lock className="w-4 h-4 text-[#fbbf24]" />SIP needs the Pro plan or higher</div>
      {nums.map((n, i) => (
        <div key={n.phoneNumber} className="flex items-center justify-between gap-3 py-2 border-t border-[#262626]" data-testid={`sip-page-locked-${i}`}>
          <span className="min-w-0"><span className="block font-mono text-sm truncate">{pv.phone(n.phoneNumber)}</span><span className="block text-xs text-[#a1a1aa] mt-0.5">{n.planName}</span></span>
          <Link to={cp(`/app/numbers/${enc(n.phoneNumber)}?tab=billing`)} className="civr-btn civr-btn-ghost civr-btn-sm" data-testid={`sip-page-upgrade-${i}`}>Upgrade</Link>
        </div>
      ))}
    </div>
  );
}

// Every number's SIP login in one place, plus a setup guide.
export default function SipPage() {
  const { data, loading } = useApi('/numbers');
  const { catalog, openPhone } = useShell();
  const pv = usePrivacy();
  if (loading && !data) return <Spinner />;
  const nums = (data?.numbers || []).filter(n => n.status !== 'released');
  const withSip = nums.filter(n => n.access?.sipCredentials);
  return (
    <div data-testid="sip-page">
      <PageHeader label="Numbers" title="SIP & softphones" sub="Log in to any softphone with these details to call and answer on your numbers." testid="sip-header">
        {withSip.length > 0 && <button type="button" className="civr-btn civr-btn-primary" onClick={openPhone} data-testid="sip-page-open-phone"><Phone className="w-4 h-4" />Open browser phone</button>}
      </PageHeader>
      {!nums.length ? (
        <Empty icon={KeyRound} title="No numbers yet" sub="Buy a number on the Pro plan or higher to get SIP credentials." testid="sip-page-empty">
          <Link to={cp('/app/buy')} className="civr-btn civr-btn-primary" data-testid="sip-page-buy"><ShoppingCart className="w-4 h-4" />Buy a number</Link>
        </Empty>
      ) : (
        <div className="grid xl:grid-cols-3 gap-6 items-start">
          <div className="xl:col-span-2 flex flex-col gap-4">
            {withSip.map((n, i) => <SipCredentials key={n.phoneNumber} num={n} prefix={`sip-page-${i}`} heading={pv.phone(n.phoneNumber)} className="" />)}
            <LockedList nums={nums.filter(n => !n.access?.sipCredentials)} />
          </div>
          <Guide domain={catalog?.sipDomain || withSip[0]?.sipDomain} />
        </div>
      )}
    </div>
  );
}
