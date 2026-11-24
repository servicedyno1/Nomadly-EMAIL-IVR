import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { cp } from '../paths';
import { Wordmark } from '../Brand';
import { Sidebar } from './apidocs/Sidebar';
import { Endpoint } from './apidocs/Endpoint';
import { Overview, Auth, Pricing, Webhooks, Errors } from './apidocs/Sections';
import * as D from './apidocs/content';

const G = ({ id, children }) => <h2 id={id} className="pt-12 text-xs font-semibold uppercase tracking-wider text-slate-400">{children}</h2>;
const C = ({ children }) => <code className="bg-slate-100 text-slate-900 px-1.5 py-0.5 rounded text-[0.85em]">{children}</code>;

const Calls = () => (
  <>
    <G>Calls</G>
    <Endpoint id="start-call" method="POST" path="/v1/calls" title="Start a call" params={D.CALL_PARAMS} body={D.CALL_BODY} response={D.CALL_REPLY} status={201}>
      <p>Rings the lead from your CloudIVR number. The moment they answer — no key to press — they are connected to <C>connectTo</C>.</p>
      <p>Each step (ringing, answered, connected, completed) is posted to your <a href="#webhooks" className="text-emerald-700 underline">webhook</a>.</p>
    </Endpoint>
    <Endpoint id="get-call" method="GET" path="/v1/calls/{id}" reqPath="/v1/calls/call_3f9a1c" title="Get a call" response={D.CALL_DONE}>
      <p>The latest state of a call you started. <C>outcome</C> is set once it ends: connected, voicemail, no_answer, busy, agent_no_answer or hung_up.</p>
    </Endpoint>
    <Endpoint id="list-numbers" method="GET" path="/v1/numbers" title="List your numbers" response={D.NUMBERS_REPLY}>
      <p>Your active CloudIVR numbers — any of them can be used as <C>from</C>.</p>
    </Endpoint>
  </>
);

const Texts = () => (
  <>
    <G>Texts · USA &amp; Canada</G>
    <Endpoint id="send-text" method="POST" path="/v1/sms" title="Send a text" params={D.SMS_PARAMS} body={D.SMS_BODY} response={D.SMS_REPLY} status={201}>
      <p>Sends one text from a real mobile number. <b>$1 per text</b>; your wallet needs at least $20. If it can’t be sent you get the $1 back straight away.</p>
    </Endpoint>
    <Endpoint id="start-campaign" method="POST" path="/v1/sms/campaigns" title="Start a campaign" params={D.CAMPAIGN_PARAMS} body={D.CAMPAIGN_BODY} response={D.CAMPAIGN_REPLY} status={201}>
      <p>Numbers and text in one request — the campaign is booked and paid in one go. <b>$0.10 a text, 500 minimum ($50)</b>, 10% off when <C>sendAt</C> is 24 h+ ahead.</p>
      <p>Refused requests are never charged (low balance, no free slot, scam text, under 500).</p>
    </Endpoint>
    <Endpoint id="get-campaign" method="GET" path="/v1/sms/campaigns/{id}" reqPath="/v1/sms/campaigns/cp_8d21" title="Campaign progress" response={D.CAMPAIGN_STATUS}>
      <p>How far a campaign has got: <C>status</C> (scheduled, running, completed or cancelled), texts sent and failed so far, and replies received.</p>
    </Endpoint>
  </>
);

export default function ApiDocs() {
  return (
    <div className="min-h-screen bg-white text-slate-700" data-testid="api-docs-page">
      <header className="sticky top-0 z-40 backdrop-blur-xl bg-white/80 border-b border-slate-200/80">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center gap-4">
          <Link to={cp()} className="font-display text-2xl font-extrabold flex items-center gap-2" data-testid="api-docs-logo-link"><Wordmark accent="#059669" iconClass="w-7 h-7" /></Link>
          <span className="hidden sm:inline text-sm text-slate-400 mr-auto">API docs</span>
          <Link to={cp('/app/settings#api')} className="ml-auto sm:ml-0 inline-flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-slate-900 py-3" data-testid="api-docs-settings-link"><ArrowLeft className="w-4 h-4" />Get a key</Link>
        </div>
      </header>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:flex lg:gap-10 pt-6 lg:pt-12 pb-24">
        <Sidebar />
        <main className="min-w-0 flex-1">
          <Overview />
          <Auth />
          <Pricing />
          <Calls />
          <Texts />
          <G>Reference</G>
          <Webhooks />
          <Errors />
        </main>
      </div>
    </div>
  );
}
