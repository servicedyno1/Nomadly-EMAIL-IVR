# JujuCloud copy brief (to match CloudIVR, 2026-11-16)

Paste this to the agent working on jujucloud.com.

---

Rewrite the JujuCloud website copy so it speaks to named audiences and stops leading with crypto, consistent with what was just done on cloudivr.net. JujuCloud and CloudIVR are both products of Dynotech Innovations, Lda and should read like siblings. Ask me before changing prices, product names, or anything outside copy and page structure.

## 1. Say who it is for
JujuCloud sells domains, cPanel hosting, Linux VPS and Windows RDP. The site currently describes features without naming a customer. Use these five audiences everywhere, in this order:

1. Digital nomads and travellers: run sites and servers from any browser, anywhere.
2. Entrepreneurs and solo founders: domain, hosting and server in one sign-up, live the same day.
3. Small businesses and shops: a real website on a real domain, SSL and DNS set up for them.
4. Remote teams and agencies: every client domain and server in one account.
5. Sales and marketing teams: landing pages and servers ready in minutes.

## 2. Page structure
- Home hero: one headline that fits all five audiences (CloudIVR uses "One business number, wherever you work."). Under it, one sentence that names the audiences and the products.
- A "Who it's for" row of five cards on the home page, each linking to its own page.
- One page per audience at `/for/nomads`, `/for/founders`, `/for/small-business`, `/for/teams`, `/for/sales`. Same slugs as CloudIVR.
- Each audience page has, in this order: a two-part headline, one sentence of explanation, three "problem → what we do about it" pairs, the four features that audience uses most, two first questions with answers, one call to action, then cards for the other four audiences.
- Add the audience pages to the nav, the footer, the sitemap, and give each its own page title and meta description.

## 3. Voice
- Short and smart. Headline under about 60 characters. One idea per sentence.
- Start from the reader's problem, then the fix. Example pattern: "Your site goes down when you travel" → "Manage it from any browser, on any Wi-Fi."
- Plain words, sentence case, "you" and "your". No exclamation marks, no all caps, no emoji in headings.
- Only claim what the product does today, with real prices pulled from config. No invented testimonials, customer counts, "trusted by", urgency or "limited spots".
- If a feature is plan-specific, say which plan.

## 4. Payments: crypto is a payment method, not the pitch
- Remove crypto from the hero, trust badges, feature lists, audience tiles, meta descriptions and structured data.
- Do not show a row of coin logos. Show payment methods as small neutral chips; "Crypto" is one chip among the others.
- Mention crypto only where someone asks how to pay: one factual line in the "How do I pay?" answer and at checkout.
- Lead with what the customer cares about instead: month to month, no contract, cancel any time, live in minutes.
- State card payments exactly as they really are on jujucloud.com today. Do not say "coming soon" if cards work, and do not say they work if they do not.

## 5. Translations
- Every new string needs French and Spanish, or whichever languages the site already offers.
- Write the headlines by hand in each language. Machine-translated two-part headlines read badly.

## 6. Before you finish
- Search the rendered home page and each audience page for "crypto", "bitcoin", "USDT", "BTC": the only hits should be the single payment chip and the one FAQ line.
- Check all five audience pages load, an unknown `/for/...` address goes back to the home page, and nothing overflows on a phone.
- Tell me what you changed, what is live, and what you did not verify.

## Reference: CloudIVR wording to stay consistent with
- Nomads: "Your number stays put. You don't have to."
- Founders: "One founder. A whole front desk."
- Small business: "Every customer call gets an answer."
- Teams: "Your team is everywhere. Your phone line is in one place."
- Sales: "Call 500 leads before lunch. Talk to the ones who press 1."
- Card titles: Nomads & travellers / Founders / Small businesses / Remote teams / Sales teams.
- Section titles on audience pages: "Sound familiar?", "What you will use most", "Questions people ask first", "Not quite you?"
