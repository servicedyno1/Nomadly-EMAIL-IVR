import React from 'react';
import { Link } from 'react-router-dom';
import { Hash, ShoppingCart, ChevronRight } from 'lucide-react';
import { useApi, day, money, enc } from '../api';
import { PageHeader, Spinner, ErrorNote, Empty, statusPill } from '../ui';
import { cp } from '../paths';

const on = (f) => f?.enabled;

export default function Numbers() {
  const { data, error, loading } = useApi('/numbers');
  const nums = data?.numbers || [];
  return (
    <div data-testid="numbers-page">
      <PageHeader label="Numbers" title="My numbers" sub="Tap a number to set up forwarding, IVR, voicemail, SMS and SIP." testid="numbers-header">
        <Link to={cp('/app/buy')} className="civr-btn civr-btn-primary" data-testid="numbers-buy-button"><ShoppingCart className="w-4 h-4" />Buy a number</Link>
      </PageHeader>
      <ErrorNote error={error} />
      {loading ? <Spinner /> : !nums.length ? (
        <Empty icon={Hash} title="No numbers yet" sub="Pick a country, choose a number and a plan — it’s live in under a minute." testid="numbers-empty">
          <Link to={cp('/app/buy')} className="civr-btn civr-btn-primary" data-testid="numbers-empty-buy-button">Buy your first number</Link>
        </Empty>
      ) : (
        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
          {nums.map((n, i) => (
            <Link key={n.phoneNumber} to={cp(`/app/numbers/${enc(n.phoneNumber)}`)} className={`civr-card civr-card-link p-5 civr-rise civr-d${(i % 4) + 1}`} data-testid={`number-card-${i}`}>
              <div className="flex items-start justify-between">
                <div>
                  <div className="font-mono text-xl" data-testid={`number-card-${i}-phone`}>{n.phoneNumber}</div>
                  <div className="text-xs text-[#777] mt-1">{n.countryName || n.country} · {n.type?.replace('_', '-')}</div>
                </div>
                <span className={statusPill(n.status)} data-testid={`number-card-${i}-status`}>{n.status}</span>
              </div>
              <div className="flex flex-wrap gap-1.5 mt-5">
                <span className="civr-pill">{n.planName} · {money(n.planPrice)}</span>
                {on(n.features.ivr) && <span className="civr-pill civr-pill-on">IVR</span>}
                {on(n.features.callForwarding) && <span className="civr-pill civr-pill-on">Forwarding</span>}
                {on(n.features.voicemail) && <span className="civr-pill civr-pill-on">Voicemail</span>}
                {n.features.recording && <span className="civr-pill civr-pill-on">Recording</span>}
                {n.dryRun && <span className="civr-pill civr-pill-warn">Preview</span>}
              </div>
              <div className="flex items-center justify-between mt-5 text-xs text-[#777]">
                <span>{n.autoRenew ? 'Renews' : 'Expires'} {day(n.expiresAt)}</span><ChevronRight className="w-4 h-4" />
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
