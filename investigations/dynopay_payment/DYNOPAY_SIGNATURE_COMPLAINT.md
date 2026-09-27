# DynoPay webhook signature — verification request (send to DynoPay support)

Subject: Webhook HMAC signatures not validating — please confirm signing spec + secret binding

Hi DynoPay team,

We've enabled webhook signature verification and are seeing that **every** incoming
webhook carries an `X-Dynopay-Signature-V2` header, but **none** of them validate on
our side. Before assuming a bug, we've verified our end thoroughly and need you to
confirm a few specifics about how your platform signs webhooks.

## What we've confirmed on our end
- Our webhook endpoint is publicly reachable and receiving your calls in real time.
  Endpoint: `https://nomadly1.up.railway.app/api/store/crypto-webhook`
- The signing secret configured on our server is the exact `whsec_…` value shown once
  when we saved the webhook URL in your dashboard. It is 54 characters, begins with
  `whsec_`, and matches byte-for-byte (we masked it here: `whsec_33939b…f69c`).
- We verify using the scheme your docs describe: `X-Dynopay-Signature-V2: t=<ts>,v1=<hex>`,
  where `v1 = HMAC_SHA256(secret, "<t>.<raw_request_body>")` compared in constant time,
  with a ±300s replay window. This is the standard Stripe-style construction.
- We compute the HMAC over the **exact raw request bytes** as received (no
  re-serialization), and we've also tested every reasonable variation (see below) —
  none match your `v1`.

## Please confirm the EXACT signing specification
1. **Message construction** — is the signed string exactly `"{t}.{raw_body}"`, or is it
   something else (e.g. `"{webhook_id}.{t}.{raw_body}"`, or `t` + a re-serialized/
   canonicalized JSON body rather than the raw bytes we received)?
2. **HMAC key** — do you sign with:
   a. the **full** `whsec_…` string (used verbatim as the UTF-8 key, Stripe-style), or
   b. the portion **after** the `whsec_` prefix, or
   c. the **base64-decoded** bytes of the portion after `whsec_` (Svix-style)?
3. **Encoding of `v1`** — is `v1` **hex** or **base64**?
4. **Timestamp `t`** — is it Unix epoch **seconds** or **milliseconds**? (Please also
   confirm `X-Dynopay-Timestamp` uses the same unit.)
5. **Body** — is the signature computed over the exact bytes you transmit on the wire,
   or over a canonical/normalized JSON representation?
6. **Per-payment vs configured endpoints** — we set a per-payment `webhook_url` on some
   flows AND a dashboard/API-key default webhook URL. Are deliveries to a **per-payment
   `webhook_url`** signed with the **same** account secret as the dashboard-configured
   endpoint, or are per-payment deliveries sent unsigned?
7. **Secret binding** — please confirm the secret currently bound and ACTIVE for our
   endpoint is `whsec_33939b…f69c` (54 chars) and has not been rotated/superseded.

## Please also
8. **Send us a signed test webhook** (or re-send the last one) so we can validate against
   your confirmed spec. A dashboard "send test event" to the endpoint above is ideal.
9. If you provide a small **worked example** — a sample `raw_body`, the `t` you used, and
   the resulting `v1` — we can immediately reproduce and confirm we match.

## Sample of what we observe (most recent deliveries)
- Header present: `X-Dynopay-Signature-V2: t=<value>,v1=<hex>`
- Our HMAC over `"{t}.{raw_body}"` with the full `whsec_…` key (hex) ≠ your `v1`.
- Payments themselves are fine (we re-verify status server-to-server via
  `getPaymentStatus/{payment_id}`), so this is strictly about the **signature**.

Thanks — once you confirm items 1–7 (or send a worked example / test event), we can
enable signature enforcement immediately.

---
### Internal notes (do NOT send to DynoPay)
- Our side is confirmed correct: prod `DYNO_PAY_WEBHOOK_SECRET` set, matches the dashboard
  `whsec_`, 54 chars. Verification uses HMAC-SHA256 over `"{t}.{rawBody}"`, hex, full-key,
  ±300s (now ms-tolerant).
- We deployed a diagnostic (`diagnoseDynopaySignature`) that, on the next inbound webhook,
  logs `[Store][SIGDEBUG] {...}` comparing DynoPay's `v1` against 7 candidate schemes
  (full/stripped/base64 key × hex/base64 × raw/t.raw). If `matchedScheme` is non-null we
  know their exact scheme and can fix `verifyDynopayWebhookV2` without waiting on support.
  Requires: deploy + one real webhook (or a dashboard test event). Enforcement stays OFF
  (`DYNO_PAY_WEBHOOK_SIG_ENFORCE` unset) until a scheme matches.
