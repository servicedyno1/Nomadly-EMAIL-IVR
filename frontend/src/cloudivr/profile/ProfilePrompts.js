import React, { useState } from 'react';
import { BadgeCheck, IdCard } from 'lucide-react';
import { api } from '../api';
import { useCivrAuth } from '../AuthContext';
import { Modal } from '../pages/contacts/Modal';
import { LegalProfileForm } from './LegalProfileForm';

// Right after sign-up (new accounts): one step to add personal or business details. "Later" is allowed.
export function ProfileSetupDialog() {
  const { account, setAccount } = useCivrAuth();
  const [open, setOpen] = useState(true);
  if (!account?.profileDue || !open) return null;
  const later = () => { setOpen(false); api('/profile/legal/later', { method: 'POST' }).then(() => setAccount({ ...account, profileDue: false })).catch(() => {}); };
  return (
    <Modal title="Who will use your numbers?" sub="Carriers register every number to a person or business. Takes a minute — the address fills in as you type." onClose={later} testid="profile-setup-dialog">
      <LegalProfileForm onSaved={() => setOpen(false)} onLater={later} submitLabel="Save and continue" testid="profile-setup-form" />
    </Modal>
  );
}

// Existing accounts without details: slim reminder until it's done.
export function ProfileBanner() {
  const { account } = useCivrAuth();
  const [open, setOpen] = useState(false);
  if (!account || account.profileComplete || account.profileDue) return null;
  return (
    <>
      <div role="region" aria-label="Profile reminder" className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-sm bg-[#818cf8]/10 border-b border-[#818cf8]/25 px-4 py-2" data-testid="profile-banner">
        <span className="flex items-center gap-2"><IdCard className="w-4 h-4 text-[#818cf8]" />Add your personal or business details — needed before your next number.</span>
        <button type="button" className="civr-btn civr-btn-primary civr-btn-sm" onClick={() => setOpen(true)} data-testid="profile-banner-button">Add details</button>
      </div>
      {open && <Modal title="Your details for numbers" sub="Carriers register every number to a person or business." onClose={() => setOpen(false)} testid="profile-banner-dialog">
        <LegalProfileForm onSaved={() => setOpen(false)} testid="profile-banner-form" />
      </Modal>}
    </>
  );
}

// Buy page: shown instead of payment until details are saved.
export function BuyProfileGate() {
  return (
    <div className="civr-card p-6 mb-6 civr-rise" data-testid="buy-profile-gate">
      <div className="flex items-start gap-3 mb-6">
        <IdCard className="w-6 h-6 text-[#818cf8] shrink-0" />
        <div><div className="font-display text-xl font-bold">First, who is this number for?</div>
          <p className="text-sm text-[#a1a1aa] mt-1">We register each number in your name with the carrier. Save this once and you can pay right after.</p></div>
      </div>
      <LegalProfileForm submitLabel="Save and continue to payment" testid="buy-profile-form" />
    </div>
  );
}

// Settings card.
export function ProfileDetailsCard() {
  const { account } = useCivrAuth();
  return (
    <div className="civr-card p-6 space-y-6 lg:col-span-2" id="settings-details" data-testid="settings-legal-profile">
      <div className="flex flex-wrap items-center gap-3">
        <div className="font-display text-2xl font-bold">Personal or business details</div>
        {account?.profileComplete ? <span className="civr-pill civr-pill-on inline-flex items-center gap-1" data-testid="settings-profile-complete"><BadgeCheck className="w-3.5 h-3.5" />Complete</span>
          : <span className="civr-pill civr-pill-warn" data-testid="settings-profile-missing">Needed to buy numbers</span>}
      </div>
      <LegalProfileForm testid="settings-legal-form" />
    </div>
  );
}
