import React, { useState } from 'react';
import { Phone, MessageSquare, Shield, Settings, CreditCard, ChevronRight, ChevronDown, ArrowRight, Check, Headphones, Mail, Globe, Mic, BarChart3, RefreshCw, X, Zap, Users, ArrowLeft } from 'lucide-react';

const FLOWS = {
  OVERVIEW: 'overview',
  BUY: 'buy',
  MY_NUMBERS: 'my_numbers',
  FORWARDING: 'forwarding',
  SMS: 'sms',
  VOICEMAIL: 'voicemail',
  SIP: 'sip',
  USAGE: 'usage',
  RENEW: 'renew',
  RELEASE: 'release',
};

/* ─── Telegram-style chat bubble ─── */
function TgBubble({ from, children, buttons, isBot = true }) {
  return (
    <div className={`tg-bubble ${isBot ? 'tg-bubble--bot' : 'tg-bubble--user'}`} data-testid="tg-bubble">
      {from && <span className="tg-bubble__from">{from}</span>}
      <div className="tg-bubble__body">{children}</div>
      {buttons && (
        <div className="tg-bubble__buttons">
          {buttons.map((row, ri) => (
            <div key={ri} className="tg-btn-row">
              {(Array.isArray(row) ? row : [row]).map((btn, bi) => (
                <span key={bi} className="tg-btn">{btn}</span>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─── Step indicator ─── */
function StepBadge({ num, label, active }) {
  return (
    <div className={`step-badge ${active ? 'step-badge--active' : ''}`} data-testid={`step-${num}`}>
      <span className="step-badge__num">{num}</span>
      <span className="step-badge__label">{label}</span>
    </div>
  );
}

/* ─── Flow section wrapper ─── */
function FlowSection({ icon: Icon, title, accent, children, id }) {
  const [open, setOpen] = useState(true);
  return (
    <section className="flow-section" data-testid={`flow-${id}`}>
      <button className="flow-section__header" onClick={() => setOpen(!open)}>
        <div className="flow-section__left">
          <div className={`flow-section__icon flow-section__icon--${accent}`}><Icon size={20} /></div>
          <h3 className="flow-section__title">{title}</h3>
        </div>
        {open ? <ChevronDown size={18} className="flow-section__chevron" /> : <ChevronRight size={18} className="flow-section__chevron" />}
      </button>
      {open && <div className="flow-section__content">{children}</div>}
    </section>
  );
}

/* ─── Connector arrow between steps ─── */
function StepConnector() {
  return (
    <div className="step-connector">
      <div className="step-connector__line" />
      <ArrowRight size={14} className="step-connector__arrow" />
    </div>
  );
}

/* ─── Phone screen mockup ─── */
function PhoneScreen({ title, children }) {
  return (
    <div className="phone-screen" data-testid="phone-screen">
      <div className="phone-screen__notch" />
      <div className="phone-screen__header">
        <span className="phone-screen__title">{title}</span>
      </div>
      <div className="phone-screen__body">{children}</div>
    </div>
  );
}

/* ─── Main Journey Component ─── */
export default function CloudPhoneJourney() {
  const [activeFlow, setActiveFlow] = useState(FLOWS.OVERVIEW);
  const [activeBuyStep, setActiveBuyStep] = useState(1);

  return (
    <div className="journey-root" data-testid="cloud-phone-journey">
      {/* ── Header ── */}
      <div className="journey-header">
        <div className="journey-header__top">
          <div className="journey-header__icon-wrap">
            <Phone size={28} />
          </div>
          <div>
            <h1 className="journey-header__title">Cloud Phone Service</h1>
            <p className="journey-header__sub">Complete UI/UX User Journey &mdash; Telegram Bot Flow</p>
          </div>
        </div>

        {/* ── Nav tabs ── */}
        <nav className="journey-nav" data-testid="journey-nav">
          {[
            { id: FLOWS.OVERVIEW, label: 'Overview', icon: Zap },
            { id: FLOWS.BUY, label: 'Buy Number', icon: CreditCard },
            { id: FLOWS.MY_NUMBERS, label: 'My Numbers', icon: Phone },
            { id: FLOWS.FORWARDING, label: 'Call Forward', icon: ArrowRight },
            { id: FLOWS.SMS, label: 'SMS', icon: MessageSquare },
            { id: FLOWS.VOICEMAIL, label: 'Voicemail', icon: Mic },
            { id: FLOWS.SIP, label: 'SIP', icon: Globe },
            { id: FLOWS.USAGE, label: 'Usage', icon: BarChart3 },
          ].map(tab => (
            <button
              key={tab.id}
              className={`journey-nav__tab ${activeFlow === tab.id ? 'journey-nav__tab--active' : ''}`}
              onClick={() => setActiveFlow(tab.id)}
              data-testid={`tab-${tab.id}`}
            >
              <tab.icon size={15} />
              <span>{tab.label}</span>
            </button>
          ))}
        </nav>
      </div>

      {/* ── Content ── */}
      <div className="journey-content">

        {/* ═══════ OVERVIEW ═══════ */}
        {activeFlow === FLOWS.OVERVIEW && (
          <div className="journey-panel" data-testid="panel-overview">
            <h2 className="panel-title">Main Menu Integration</h2>
            <p className="panel-desc">The Cloud Phone button is added to the Telegram bot main keyboard. When tapped, it opens the Cloud Phone hub submenu.</p>

            <div className="overview-grid">
              {/* Main menu mockup */}
              <PhoneScreen title="NomadlyBot">
                <TgBubble from="Nomadly Bot" buttons={[
                  ['🔗✂️ URL Shortener — 5 Free Links'],
                  ['🌐 Offshore Hosting'],
                  ['📞☁️ Cloud Phone'],
                  ['🎯 Targeted Leads & Validation'],
                  ['🌐 Domain Names'],
                  [['👛 My Wallet', '🔔 My Plan']],
                  ['🔔 Subscribe Here'],
                  [['🌍 Change Settings', '💬 Get Support']],
                ]}>
                  Welcome to Nomadly Bot! Please choose an option below:
                </TgBubble>
              </PhoneScreen>

              {/* Submenu mockup */}
              <PhoneScreen title="Cloud Phone">
                <TgBubble from="Nomadly Bot" buttons={[
                  ['🛒 Buy Phone Number'],
                  ['📱 My Numbers'],
                  ['⚙️ SIP Settings'],
                  ['📊 Usage & Billing'],
                  [['Back', 'Cancel']],
                ]}>
                  📞 <b>Cloud Phone Service</b>{'\n\n'}
                  Buy virtual phone numbers, receive SMS in Telegram, configure call forwarding, voicemail, and connect via SIP.{'\n\n'}
                  Select an option:
                </TgBubble>
              </PhoneScreen>

              {/* Service cards */}
              <div className="overview-services">
                <h3 className="overview-services__title">Service Capabilities</h3>
                {[
                  { icon: CreditCard, label: 'Buy Numbers', desc: 'Search & purchase from 40+ countries', color: 'emerald' },
                  { icon: MessageSquare, label: 'SMS to Telegram', desc: 'Inbound SMS forwarded to your chat', color: 'sky' },
                  { icon: ArrowRight, label: 'Call Forwarding', desc: 'Always / Busy / No Answer modes', color: 'violet' },
                  { icon: Mic, label: 'Voicemail', desc: 'Record & forward to Telegram/email', color: 'amber' },
                  { icon: Globe, label: 'SIP Access', desc: 'Connect softphones via sip.nomadly.com', color: 'rose' },
                  { icon: BarChart3, label: 'Usage Logs', desc: 'Call & SMS history with analytics', color: 'cyan' },
                ].map((s, i) => (
                  <div key={i} className={`overview-svc-card overview-svc-card--${s.color}`}>
                    <s.icon size={18} />
                    <div>
                      <span className="overview-svc-card__label">{s.label}</span>
                      <span className="overview-svc-card__desc">{s.desc}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Plans */}
            <h2 className="panel-title" style={{ marginTop: 48 }}>Pricing Plans</h2>
            <div className="plans-grid">
              {[
                { name: 'Starter', price: '$5', features: ['100 inbound min/mo', '50 SMS/mo', 'Call forwarding', 'SMS to Telegram'], color: 'emerald', tag: null },
                { name: 'Pro', price: '$15', features: ['500 inbound min/mo', '200 SMS/mo', 'Forwarding + Voicemail', 'SIP access', 'SMS to Telegram & Email', 'Quick IVR Call', 'Bulk IVR Campaign'], color: 'sky', tag: 'Popular' },
                { name: 'Business', price: '$30', features: ['Unlimited inbound', '1,000 SMS/mo', 'All Pro features', 'Call recording', 'OTP Collection via IVR', 'IVR / Auto-attendant', 'Custom OTP Messages'], color: 'amber', tag: 'Best Value' },
              ].map((plan, i) => (
                <div key={i} className={`plan-card plan-card--${plan.color}`} data-testid={`plan-${plan.name.toLowerCase()}`}>
                  {plan.tag && <span className={`plan-card__tag plan-card__tag--${plan.color}`}>{plan.tag}</span>}
                  <h4 className="plan-card__name">{plan.name}</h4>
                  <div className="plan-card__price">{plan.price}<span>/mo</span></div>
                  <ul className="plan-card__features">
                    {plan.features.map((f, fi) => (
                      <li key={fi}><Check size={14} /> {f}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ═══════ BUY NUMBER FLOW ═══════ */}
        {activeFlow === FLOWS.BUY && (
          <div className="journey-panel" data-testid="panel-buy">
            <h2 className="panel-title">Buy Phone Number — 9-Step Flow</h2>
            <p className="panel-desc">The primary revenue flow. User selects country, type, area, picks a number, chooses a plan, pays, and receives SIP credentials instantly.</p>

            {/* Step progress bar */}
            <div className="buy-steps-bar" data-testid="buy-steps-bar">
              {['Country', 'Type', 'Area', 'Numbers', 'Plan', 'Add-ons', 'Summary', 'Payment', 'Active'].map((s, i) => (
                <React.Fragment key={i}>
                  <StepBadge num={i + 1} label={s} active={activeBuyStep === i + 1} />
                  {i < 8 && <StepConnector />}
                </React.Fragment>
              ))}
            </div>

            {/* Step selector */}
            <div className="buy-step-nav">
              {[1,2,3,4,5,6,7,8,9].map(n => (
                <button key={n} className={`buy-step-btn ${activeBuyStep === n ? 'buy-step-btn--active' : ''}`} onClick={() => setActiveBuyStep(n)}>
                  {n}
                </button>
              ))}
            </div>

            {/* Step content */}
            <div className="buy-step-content">
              {activeBuyStep === 1 && (
                <div className="buy-step-pair">
                  <PhoneScreen title="Buy Number">
                    <TgBubble from="Nomadly Bot" buttons={[
                      [['🇺🇸 United States', '🇬🇧 United Kingdom']],
                      [['🇨🇦 Canada', '🇦🇺 Australia']],
                      [['🇩🇪 Germany', '🇫🇷 France']],
                      ['🌍 More Countries'],
                      [['Back', 'Cancel']],
                    ]}>
                      📍 Select country for your new phone number:
                    </TgBubble>
                  </PhoneScreen>
                  <div className="buy-step-info">
                    <h3>Step 1 — Select Country</h3>
                    <p>User picks from top countries with the most available inventory. "More Countries" expands to 40+ supported regions.</p>
                    <div className="step-tech">
                      <span className="step-tech__label">API Call</span>
                      <code>GET /v2/available_phone_numbers?filter[country_code]=US&filter[limit]=1</code>
                    </div>
                    <div className="step-tech">
                      <span className="step-tech__label">State</span>
                      <code>action: buyPhoneSelectCountry</code>
                    </div>
                  </div>
                </div>
              )}

              {activeBuyStep === 2 && (
                <div className="buy-step-pair">
                  <PhoneScreen title="Number Type">
                    <TgBubble from="Nomadly Bot" buttons={[
                      ['📍 Local Number'],
                      ['🆓 Toll-Free Number'],
                      [['Back', 'Cancel']],
                    ]}>
                      📱 Select number type for <b>United States</b>:{'\n\n'}
                      <b>Local</b> — Geographic number with area code{'\n'}
                      <b>Toll-Free</b> — 800/888/877 prefix, nationwide reach
                    </TgBubble>
                  </PhoneScreen>
                  <div className="buy-step-info">
                    <h3>Step 2 — Select Number Type</h3>
                    <p>Local numbers are tied to a city/area code. Toll-free numbers are nationwide and typically used for business lines.</p>
                    <div className="step-tech">
                      <span className="step-tech__label">State</span>
                      <code>action: buyPhoneSelectType</code>
                    </div>
                    <div className="step-tech">
                      <span className="step-tech__label">Saved</span>
                      <code>info.phoneCountry = "US", info.phoneType = "local"</code>
                    </div>
                  </div>
                </div>
              )}

              {activeBuyStep === 3 && (
                <div className="buy-step-pair">
                  <PhoneScreen title="Select Area">
                    <TgBubble from="Nomadly Bot" buttons={[
                      [['New York (212)', 'Los Angeles (310)']],
                      [['Chicago (312)', 'Miami (305)']],
                      [['Houston (713)', 'Dallas (214)']],
                      ['🔍 Search by Area Code'],
                      [['Back', 'Cancel']],
                    ]}>
                      🏙️ Select area or enter your preferred area code:
                    </TgBubble>
                  </PhoneScreen>
                  <div className="buy-step-info">
                    <h3>Step 3 — Select Area / City</h3>
                    <p>Shows popular cities for the chosen country. User can also type a custom area code to search specific localities.</p>
                    <div className="step-tech">
                      <span className="step-tech__label">API Call</span>
                      <code>GET /v2/available_phone_numbers?filter[country_code]=US&filter[national_destination_code]=212&filter[limit]=5</code>
                    </div>
                    <div className="step-tech">
                      <span className="step-tech__label">State</span>
                      <code>action: buyPhoneSelectArea</code>
                    </div>
                  </div>
                </div>
              )}

              {activeBuyStep === 4 && (
                <div className="buy-step-pair">
                  <PhoneScreen title="Available Numbers">
                    <TgBubble from="Nomadly Bot" buttons={[
                      [['1', '2', '3', '4', '5']],
                      ['🔄 Show More Numbers'],
                      [['Back', 'Cancel']],
                    ]}>
                      📞 Available numbers in <b>New York (212)</b>:{'\n\n'}
                      1️⃣  +1 (212) 555-0142{'\n'}
                      2️⃣  +1 (212) 555-0198{'\n'}
                      3️⃣  +1 (212) 555-0234{'\n'}
                      4️⃣  +1 (212) 555-0301{'\n'}
                      5️⃣  +1 (212) 555-0456
                    </TgBubble>
                  </PhoneScreen>
                  <div className="buy-step-info">
                    <h3>Step 4 — Browse Available Numbers</h3>
                    <p>5 numbers displayed at a time from Telnyx inventory. User picks by tapping the number index. "Show More" fetches the next batch with offset.</p>
                    <div className="step-tech">
                      <span className="step-tech__label">API</span>
                      <code>GET /v2/available_phone_numbers?filter[features][]=voice&filter[features][]=sms</code>
                    </div>
                    <div className="step-tech">
                      <span className="step-tech__label">State</span>
                      <code>action: buyPhoneResults</code>
                    </div>
                  </div>
                </div>
              )}

              {activeBuyStep === 5 && (
                <div className="buy-step-pair">
                  <PhoneScreen title="Select Plan">
                    <TgBubble from="Nomadly Bot" buttons={[
                      ['💡 Starter — $5/mo'],
                      ['⭐ Pro — $15/mo'],
                      ['👑 Business — $30/mo'],
                      [['Back', 'Cancel']],
                    ]}>
                      ✅ You selected: <b>+1 (212) 555-0142</b>{'\n\n'}
                      📋 Select your plan:{'\n\n'}
                      <b>💡 Starter</b> — 100 min · 50 SMS · Forwarding{'\n'}
                      <b>⭐ Pro</b> — 500 min · 200 SMS · Voicemail + SIP{'\n'}
                      <b>👑 Business</b> — Unlimited · 1000 SMS · All features
                    </TgBubble>
                  </PhoneScreen>
                  <div className="buy-step-info">
                    <h3>Step 5 — Select Plan</h3>
                    <p>Three tiers with clear feature differentiation. Pro is the recommended tier (most margin, most useful features).</p>
                    <div className="step-tech">
                      <span className="step-tech__label">State</span>
                      <code>action: buyPhoneConfirm</code>
                    </div>
                    <div className="step-tech">
                      <span className="step-tech__label">Saved</span>
                      <code>info.selectedNumber, info.phonePlan, info.phonePrice</code>
                    </div>
                  </div>
                </div>
              )}

              {activeBuyStep === 6 && (
                <div className="buy-step-pair">
                  <PhoneScreen title="Add-ons">
                    <TgBubble from="Nomadly Bot" buttons={[
                      ['🎙️ Add Voicemail — $2/mo'],
                      ['🔑 Add SIP Access — $3/mo'],
                      ['🎧 Add Recording — $5/mo'],
                      ['➡️ Continue'],
                      [['Back', 'Cancel']],
                    ]}>
                      ⚡ Add-ons for <b>+1 (212) 555-0142</b>:{'\n\n'}
                      ✅ SMS to Telegram — <b>FREE</b>{'\n'}
                      ✅ Call Forwarding — <b>FREE</b>{'\n\n'}
                      Optional extras:
                    </TgBubble>
                  </PhoneScreen>
                  <div className="buy-step-info">
                    <h3>Step 6 — Feature Add-ons</h3>
                    <p>Shown for Starter plan only. Pro/Business plans include all features, so this step is skipped and the user goes directly to the summary.</p>
                    <div className="step-tech">
                      <span className="step-tech__label">State</span>
                      <code>action: buyPhoneFeatures</code>
                    </div>
                    <div className="step-tech">
                      <span className="step-tech__label">Logic</span>
                      <code>if (plan !== 'starter') skip → buyPhoneSummary</code>
                    </div>
                  </div>
                </div>
              )}

              {activeBuyStep === 7 && (
                <div className="buy-step-pair">
                  <PhoneScreen title="Order Summary">
                    <TgBubble from="Nomadly Bot" buttons={[
                      ['🎟️ Apply Coupon'],
                      ['✅ Proceed to Payment'],
                      [['Back', 'Cancel']],
                    ]}>
                      📋 <b>Order Summary</b>{'\n\n'}
                      📞 Number: +1 (212) 555-0142{'\n'}
                      📍 Location: New York, US{'\n'}
                      📦 Plan: Pro — $15/mo{'\n'}
                      📩 SMS: 200/mo included{'\n'}
                      📞 Minutes: 500 inbound/mo{'\n'}
                      ⚡ Add-ons: Voicemail, SIP Access{'\n\n'}
                      💰 Total: <b>$15.00/mo</b>{'\n'}
                      First month billed now
                    </TgBubble>
                  </PhoneScreen>
                  <div className="buy-step-info">
                    <h3>Step 7 — Order Summary</h3>
                    <p>Full order review before payment. Coupon system reuses the existing <code>discountOn</code> + daily coupon logic from the bot.</p>
                    <div className="step-tech">
                      <span className="step-tech__label">State</span>
                      <code>action: buyPhoneSummary</code>
                    </div>
                    <div className="step-tech">
                      <span className="step-tech__label">Coupon</span>
                      <code>resolveCoupon(code, chatId) → discount %</code>
                    </div>
                  </div>
                </div>
              )}

              {activeBuyStep === 8 && (
                <div className="buy-step-pair">
                  <PhoneScreen title="Payment">
                    <TgBubble from="Nomadly Bot" buttons={[
                      [['Crypto', '👛 Wallet']],
                      ['Bank ₦aira + Card🏦💳'],
                      [['Back', 'Cancel']],
                    ]}>
                      Price of Cloud Phone (Pro) is <b>$15.00</b>.{'\n'}Please choose payment method.
                    </TgBubble>
                  </PhoneScreen>
                  <div className="buy-step-info">
                    <h3>Step 8 — Payment</h3>
                    <p>Reuses the existing payment infrastructure — same <code>goto['phone-pay']</code> pattern as domain/VPS/hosting payments. Supports wallet (USD/NGN), crypto (8 currencies), and bank transfer.</p>
                    <div className="step-tech">
                      <span className="step-tech__label">State</span>
                      <code>action: phone-pay → crypto-pay-phone | wallet-pay</code>
                    </div>
                    <div className="step-tech">
                      <span className="step-tech__label">Pattern</span>
                      <code>Same as domain-pay / vps-plan-pay / hosting-pay</code>
                    </div>
                  </div>
                </div>
              )}

              {activeBuyStep === 9 && (
                <div className="buy-step-pair">
                  <PhoneScreen title="Activated!">
                    <TgBubble from="Nomadly Bot">
                      🎉 <b>Your Cloud Phone is Active!</b>{'\n\n'}
                      📞 Number: +1 (212) 555-0142{'\n'}
                      📍 Location: New York, US{'\n'}
                      📦 Plan: Pro ($15/mo){'\n'}
                      📅 Renewal: March 18, 2026{'\n\n'}
                      ━━━ <b>SIP Credentials</b> ━━━{'\n'}
                      🌐 Server: sip.nomadly.com{'\n'}
                      👤 Username: user_a7k2m9{'\n'}
                      🔑 Password: ●●●●●●●●{'\n'}
                      📡 Port: 5060 (UDP/TCP) | 5061 (TLS){'\n\n'}
                      ━━━ <b>Quick Setup</b> ━━━{'\n'}
                      • Softphone: Download Zoiper, enter above credentials{'\n'}
                      • SMS: Inbound SMS forwarded to this chat{'\n'}
                      • Forwarding: 📱 My Numbers → Call Forwarding
                    </TgBubble>
                  </PhoneScreen>
                  <div className="buy-step-info">
                    <h3>Step 9 — Activation</h3>
                    <p>Number is instantly activated. SIP credentials are generated and displayed. SMS forwarding to Telegram is enabled by default. Admin group gets a purchase notification.</p>
                    <div className="step-tech">
                      <span className="step-tech__label">Telnyx</span>
                      <code>POST /v2/number_orders → assign SIP connection → set messaging profile</code>
                    </div>
                    <div className="step-tech">
                      <span className="step-tech__label">DB</span>
                      <code>phoneNumbersOf.insert + phoneTransactions.insert</code>
                    </div>
                    <div className="step-tech">
                      <span className="step-tech__label">Notify</span>
                      <code>notifyGroup("🎉 New Phone Number Purchase! ...")</code>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ═══════ MY NUMBERS ═══════ */}
        {activeFlow === FLOWS.MY_NUMBERS && (
          <div className="journey-panel" data-testid="panel-my-numbers">
            <h2 className="panel-title">My Numbers — Management Hub</h2>
            <p className="panel-desc">Users manage all their purchased numbers from a single menu. Each number opens a full management panel.</p>

            <div className="my-numbers-grid">
              <PhoneScreen title="My Numbers">
                <TgBubble from="Nomadly Bot" buttons={[
                  ['1', '2'],
                  [['Back', 'Cancel']],
                ]}>
                  📱 <b>Your Cloud Phone Numbers:</b>{'\n\n'}
                  1️⃣  +1 (212) 555-0142  ✅ Active{'\n'}
                  {'    '}Pro Plan · Renews Mar 18{'\n\n'}
                  2️⃣  +44 (20) 7946-0958  ✅ Active{'\n'}
                  {'    '}Starter Plan · Renews Apr 2
                </TgBubble>
              </PhoneScreen>

              <PhoneScreen title="Manage Number">
                <TgBubble from="Nomadly Bot" buttons={[
                  ['📞 Call Forwarding'],
                  ['📩 SMS Settings'],
                  ['🎙️ Voicemail'],
                  ['🔑 SIP Credentials'],
                  ['📊 Call & SMS Logs'],
                  ['🔄 Renew / Change Plan'],
                  ['❌ Release Number'],
                  [['Back', 'Cancel']],
                ]}>
                  ⚙️ Managing: <b>+1 (212) 555-0142</b>{'\n\n'}
                  Status: ✅ Active{'\n'}
                  Plan: Pro ($15/mo){'\n'}
                  SMS this month: 47/200{'\n'}
                  Minutes used: 123/500
                </TgBubble>
              </PhoneScreen>

              <div className="my-numbers-info">
                <h3>Management Actions</h3>
                <div className="mgmt-action-list">
                  {[
                    { icon: ArrowRight, label: 'Call Forwarding', desc: 'Always / Busy / No Answer / Disable', flow: FLOWS.FORWARDING },
                    { icon: MessageSquare, label: 'SMS Settings', desc: 'Telegram, Email, Webhook forwarding', flow: FLOWS.SMS },
                    { icon: Mic, label: 'Voicemail', desc: 'Enable, greeting, delivery method', flow: FLOWS.VOICEMAIL },
                    { icon: Shield, label: 'SIP Credentials', desc: 'Server, username, password, ports', flow: FLOWS.SIP },
                    { icon: BarChart3, label: 'Call & SMS Logs', desc: 'Recent activity, full history', flow: FLOWS.USAGE },
                    { icon: RefreshCw, label: 'Renew / Change Plan', desc: 'Upgrade, downgrade, auto-renew', flow: FLOWS.RENEW },
                    { icon: X, label: 'Release Number', desc: 'Permanently release the number', flow: FLOWS.RELEASE },
                  ].map((a, i) => (
                    <button key={i} className="mgmt-action" onClick={() => setActiveFlow(a.flow)}>
                      <a.icon size={16} />
                      <div>
                        <span className="mgmt-action__label">{a.label}</span>
                        <span className="mgmt-action__desc">{a.desc}</span>
                      </div>
                      <ChevronRight size={14} className="mgmt-action__arrow" />
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ═══════ CALL FORWARDING ═══════ */}
        {activeFlow === FLOWS.FORWARDING && (
          <div className="journey-panel" data-testid="panel-forwarding">
            <button className="panel-back" onClick={() => setActiveFlow(FLOWS.MY_NUMBERS)} data-testid="back-to-numbers"><ArrowLeft size={16} /> Back to My Numbers</button>
            <h2 className="panel-title">Call Forwarding Flow</h2>
            <p className="panel-desc">Users choose a forwarding mode, enter a destination number, and get instant confirmation. Implemented via Telnyx Call Control webhooks.</p>
            <div className="forwarding-grid">
              <PhoneScreen title="Call Forwarding">
                <TgBubble from="Nomadly Bot" buttons={[
                  ['📞 Always Forward'],
                  ['📵 Forward When Busy'],
                  ['⏰ Forward No Answer'],
                  ['🚫 Disable Forwarding'],
                  ['Back'],
                ]}>
                  📞 Call Forwarding for <b>+1 (212) 555-0142</b>{'\n\n'}Current: ❌ Disabled{'\n\n'}Select forwarding mode:
                </TgBubble>
              </PhoneScreen>
              <PhoneScreen title="Enter Number">
                <TgBubble from="Nomadly Bot" buttons={[['Back', 'Cancel']]}>
                  📞 Enter the number to forward calls to:{'\n'}(Include country code, e.g. +14155551234)
                </TgBubble>
                <TgBubble isBot={false}>+14155551234</TgBubble>
                <TgBubble from="Nomadly Bot">
                  ✅ <b>Call Forwarding Updated!</b>{'\n\n'}
                  📞 +1 (212) 555-0142{'\n'}
                  📲 Forward to: +1 (415) 555-1234{'\n'}
                  📋 Mode: Always Forward{'\n\n'}
                  All incoming calls will ring your forwarding number.
                </TgBubble>
              </PhoneScreen>
              <div className="buy-step-info">
                <h3>Technical Flow</h3>
                <div className="step-tech"><span className="step-tech__label">Webhook</span><code>POST /telnyx/voice-webhook → event: call.initiated</code></div>
                <div className="step-tech"><span className="step-tech__label">Action</span><code>telnyx.calls.transfer(callControlId, forwardTo)</code></div>
                <div className="step-tech"><span className="step-tech__label">Modes</span><code>always: instant transfer | busy: if 486 SIP | no_answer: after ringTimeout</code></div>
                <div className="step-tech"><span className="step-tech__label">DB</span><code>phoneNumbersOf → features.callForwarding.{'{mode, forwardTo, ringTimeout}'}</code></div>
              </div>
            </div>
          </div>
        )}

        {/* ═══════ SMS SETTINGS ═══════ */}
        {activeFlow === FLOWS.SMS && (
          <div className="journey-panel" data-testid="panel-sms">
            <button className="panel-back" onClick={() => setActiveFlow(FLOWS.MY_NUMBERS)}><ArrowLeft size={16} /> Back to My Numbers</button>
            <h2 className="panel-title">SMS Settings Flow</h2>
            <p className="panel-desc">The killer feature — inbound SMS to your virtual number appears directly in your Telegram chat. Also supports email and webhook forwarding.</p>
            <div className="sms-grid">
              <PhoneScreen title="SMS Settings">
                <TgBubble from="Nomadly Bot" buttons={[
                  ['📲 SMS to Telegram: ✅ ON'],
                  ['📧 SMS to Email: ❌ OFF'],
                  ['🔗 Webhook URL: Not Set'],
                  ['Back'],
                ]}>
                  📩 SMS Settings for <b>+1 (212) 555-0142</b>{'\n\n'}Configure how incoming SMS messages are delivered:
                </TgBubble>
              </PhoneScreen>
              <PhoneScreen title="SMS Received!">
                <TgBubble from="Nomadly Bot">
                  📩 <b>SMS Received</b>{'\n\n'}
                  📞 To: +1 (212) 555-0142{'\n'}
                  👤 From: +1 (415) 555-7890{'\n\n'}
                  💬 "Hi, I saw your listing. Is the apartment still available? I'd like to schedule a viewing this weekend."
                </TgBubble>
                <TgBubble from="Nomadly Bot">
                  📩 <b>SMS Received</b>{'\n\n'}
                  📞 To: +1 (212) 555-0142{'\n'}
                  👤 From: +1 (310) 555-1234{'\n\n'}
                  💬 "Your verification code is 847291"
                </TgBubble>
              </PhoneScreen>
              <div className="buy-step-info">
                <h3>SMS Delivery Pipeline</h3>
                <div className="step-tech"><span className="step-tech__label">Webhook</span><code>POST /telnyx/sms-webhook → event: message.received</code></div>
                <div className="step-tech"><span className="step-tech__label">Lookup</span><code>phoneNumbersOf.find(number) → get chatId + config</code></div>
                <div className="step-tech"><span className="step-tech__label">Telegram</span><code>bot.sendMessage(chatId, formatted SMS)</code></div>
                <div className="step-tech"><span className="step-tech__label">Email</span><code>nodemailer.sendMail(to: user email, subject: SMS from...)</code></div>
                <div className="step-tech"><span className="step-tech__label">Webhook</span><code>axios.post(user.webhookUrl, payload)</code></div>
              </div>
            </div>
          </div>
        )}

        {/* ═══════ VOICEMAIL ═══════ */}
        {activeFlow === FLOWS.VOICEMAIL && (
          <div className="journey-panel" data-testid="panel-voicemail">
            <button className="panel-back" onClick={() => setActiveFlow(FLOWS.MY_NUMBERS)}><ArrowLeft size={16} /> Back to My Numbers</button>
            <h2 className="panel-title">Voicemail Flow</h2>
            <p className="panel-desc">Missed calls are greeted with a custom message, recorded, and sent as audio files to Telegram or email.</p>
            <div className="voicemail-grid">
              <PhoneScreen title="Voicemail Setup">
                <TgBubble from="Nomadly Bot" buttons={[
                  ['🔊 Greeting: Default'],
                  ['📲 Send to Telegram: ✅ ON'],
                  ['📧 Send to Email: ❌ OFF'],
                  ['⏰ Ring Time: 25 seconds'],
                  ['🚫 Disable Voicemail'],
                  ['Back'],
                ]}>
                  🎙️ Voicemail for <b>+1 (212) 555-0142</b>{'\n\n'}Status: ✅ Enabled
                </TgBubble>
              </PhoneScreen>
              <PhoneScreen title="Voicemail Received!">
                <TgBubble from="Nomadly Bot">
                  🎙️ <b>New Voicemail</b>{'\n\n'}
                  📞 To: +1 (212) 555-0142{'\n'}
                  👤 From: +1 (415) 555-7890{'\n'}
                  ⏱️ Duration: 0:23{'\n'}
                  🕐 Today at 3:42 PM{'\n\n'}
                  🔊 [Audio Message Attached]
                </TgBubble>
              </PhoneScreen>
              <div className="buy-step-info">
                <h3>Voicemail Pipeline</h3>
                <div className="step-tech"><span className="step-tech__label">Trigger</span><code>call.initiated → no answer after ringTimeout</code></div>
                <div className="step-tech"><span className="step-tech__label">Greeting</span><code>telnyx.calls.playback(greetingUrl) or TTS default</code></div>
                <div className="step-tech"><span className="step-tech__label">Record</span><code>telnyx.calls.record_start(callControlId)</code></div>
                <div className="step-tech"><span className="step-tech__label">Deliver</span><code>recording.completed → bot.sendAudio(chatId, url)</code></div>
              </div>
            </div>
          </div>
        )}

        {/* ═══════ SIP ═══════ */}
        {activeFlow === FLOWS.SIP && (
          <div className="journey-panel" data-testid="panel-sip">
            <button className="panel-back" onClick={() => setActiveFlow(FLOWS.MY_NUMBERS)}><ArrowLeft size={16} /> Back to My Numbers</button>
            <h2 className="panel-title">SIP Credentials & Settings</h2>
            <p className="panel-desc">Users get branded SIP credentials to connect any softphone, IP phone, or PBX to their virtual number.</p>
            <div className="sip-grid">
              <PhoneScreen title="SIP Credentials">
                <TgBubble from="Nomadly Bot" buttons={[
                  ['👁️ Reveal Password'],
                  ['🔄 Reset Password'],
                  ['📋 Softphone Setup Guide'],
                  ['Back'],
                ]}>
                  🔑 SIP Credentials for <b>+1 (212) 555-0142</b>{'\n\n'}
                  🌐 SIP Server:  <code>sip.nomadly.com</code>{'\n'}
                  👤 Username:   <code>user_a7k2m9</code>{'\n'}
                  🔑 Password:    ●●●●●●●●{'\n'}
                  📡 Ports:         5060 (UDP/TCP) · 5061 (TLS){'\n'}
                  🎵 Codecs:      G.711μ, G.711a, Opus
                </TgBubble>
              </PhoneScreen>
              <PhoneScreen title="Global SIP">
                <TgBubble from="Nomadly Bot" buttons={[
                  ['📱 Softphone Setup Guide'],
                  ['💻 IP Phone Config'],
                  ['🔧 PBX Integration'],
                  ['Back'],
                ]}>
                  ⚙️ <b>SIP Configuration</b>{'\n\n'}
                  🌐 SIP Domain: sip.nomadly.com{'\n'}
                  📡 Status: ✅ Connected{'\n\n'}
                  ━━━ Connection Details ━━━{'\n'}
                  Protocol: SIP over UDP/TCP/TLS{'\n'}
                  Ports: 5060 (UDP/TCP) · 5061 (TLS){'\n'}
                  Codecs: G.711μ, G.711a, G.729, Opus{'\n'}
                  DTMF: RFC 2833
                </TgBubble>
              </PhoneScreen>
              <div className="buy-step-info">
                <h3>SIP Architecture</h3>
                <div className="step-tech"><span className="step-tech__label">Domain</span><code>sip.nomadly.com → Elastic SIP Trunk on Telnyx</code></div>
                <div className="step-tech"><span className="step-tech__label">Auth</span><code>FQDN-based or credential-based per user</code></div>
                <div className="step-tech"><span className="step-tech__label">Reveal</span><code>/reveal_sip_xxxxx → show decrypted password once</code></div>
                <div className="step-tech"><span className="step-tech__label">Reset</span><code>Generate new credentials → update Telnyx → notify user</code></div>
              </div>
            </div>
          </div>
        )}

        {/* ═══════ USAGE ═══════ */}
        {activeFlow === FLOWS.USAGE && (
          <div className="journey-panel" data-testid="panel-usage">
            <button className="panel-back" onClick={() => setActiveFlow(FLOWS.MY_NUMBERS)}><ArrowLeft size={16} /> Back to My Numbers</button>
            <h2 className="panel-title">Usage & Call/SMS Logs</h2>
            <p className="panel-desc">Users see recent call and SMS activity with direction indicators, timestamps, and duration.</p>
            <div className="usage-grid">
              <PhoneScreen title="Activity Log">
                <TgBubble from="Nomadly Bot" buttons={[
                  ['📞 Full Call History'],
                  ['📩 Full SMS History'],
                  ['Back'],
                ]}>
                  📊 <b>Recent Activity</b>{'\n'}+1 (212) 555-0142{'\n\n'}
                  📞 <b>Calls (Last 7 days):</b>{'\n'}
                  {'  '}↙️ +1 (415) 555-1234  2m 15s  Today 14:32{'\n'}
                  {'  '}↗️ +1 (408) 555-9876  0m 45s  Today 11:20{'\n'}
                  {'  '}↙️ +1 (212) 555-4321  5m 03s  Yesterday{'\n'}
                  {'  '}🎙️ +1 (310) 555-0000  Voicemail  Yesterday{'\n\n'}
                  📩 <b>SMS (Last 7 days):</b>{'\n'}
                  {'  '}↙️ +1 (415) 555-1234  "Hey, is this..."  Today{'\n'}
                  {'  '}↙️ +1 (310) 555-1234  "Your code: 847291"  Today{'\n'}
                  {'  '}↙️ +1 (650) 555-5678  "Confirmed for..."  Yest.
                </TgBubble>
              </PhoneScreen>
              <PhoneScreen title="Usage Summary">
                <TgBubble from="Nomadly Bot" buttons={[
                  ['🔄 Renew / Change Plan'],
                  ['Back'],
                ]}>
                  📊 <b>Usage Summary — February 2026</b>{'\n\n'}
                  📞 <b>Calls</b>{'\n'}
                  {'  '}Inbound: 47 calls · 2h 13m{'\n'}
                  {'  '}Forwarded: 31 calls{'\n'}
                  {'  '}Voicemail: 8 recordings{'\n'}
                  {'  '}Missed: 3{'\n\n'}
                  📩 <b>SMS</b>{'\n'}
                  {'  '}Received: 123 messages{'\n'}
                  {'  '}Forwarded to TG: 123{'\n'}
                  {'  '}Forwarded to Email: 0{'\n\n'}
                  📦 <b>Plan: Pro ($15/mo)</b>{'\n'}
                  {'  '}Minutes: 123/500 used{'\n'}
                  {'  '}SMS: 123/200 used{'\n'}
                  {'  '}Renews: Mar 18, 2026
                </TgBubble>
              </PhoneScreen>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
