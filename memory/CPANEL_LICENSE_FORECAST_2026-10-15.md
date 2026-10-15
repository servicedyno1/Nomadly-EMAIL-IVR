# cPanel license forecast — 2026-10-15 19:00Z (read-only analysis)

- WHM 68.183.77.106: `get_current_users_count` = 27 / 30 (Pro Cloud license), 0 suspended. Shared by Nomadly/SMADAV/Voodoo.
- Ghost row: Nomadly DB `cpanelAccounts` _id `nbaykkd4zh` (testingbays.sbs, owner test chat ..3715) is live in DB but NOT on WHM;
  autoRenew on → would charge $100 from the test wallet on 2026-10-29. Candidate to mark deleted/terminatedOnWhm.
- Orders/month (all brands): Apr 12, May 14, Jun 29, Jul 26, Aug 21, Sep 26, Oct 19 in 15 days (pace ~38 = record).
  Last 4 weeks ≈ 7.5–8/week; SMADAV now ~40% of orders.
- Live count: ~14–15 (Aug) → 27–29 (Oct). Plan mix last 30d: 73% monthly / 27% weekly (was ~50/50 in Jun–Aug).
- Lifetimes (incl. renewals): monthly mean 34–38 d, weekly 10–12 d → blended W ≈ 29 d. First-term renewal rate ≈ 27–31%.
- Steady state L = λ·W: 4/wk→17, 5.5/wk→23, 7.5/wk→31.5, 10/wk→42 accounts.
- Monte Carlo (3000 runs, next 5 wks, real deletion schedule): at current pace P(hit 30)=99%, first full ≈ Oct 18,
  ~8 days at cap, ~8 lost orders (p90 15). Only survives comfortably if sales fall to ≤ ~4/wk.
- Precedent: 2026-09-29 12:00–14:00Z — 23× "Creating the account would exceed the number of licensed users".
- Pricing (cPanel store 2026, approx): Pro Cloud 30 ≈ $54/mo, Premier Cloud 100 ≈ $77/mo → +$23/mo (< one $75 order).
- Recommendation: upgrade to Premier Cloud 100 now; after upgrade run `/usr/local/cpanel/cpkeyclt` on WHM and set
  `WHM_LICENSE_LIMIT=100` in the 3 `/opt/nomadly/shared/*/backend.env` (+ vault) so the 27/30 alerts move to 97/100.
