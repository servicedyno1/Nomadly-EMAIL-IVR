export const NAV = [
  ['Get started', [['overview', 'Overview'], ['auth', 'Authentication'], ['pricing', 'Pricing']]],
  ['Calls', [['start-call', 'Start a call'], ['get-call', 'Get a call'], ['list-numbers', 'List your numbers']]],
  ['Texts', [['send-text', 'Send a text'], ['start-campaign', 'Start a campaign'], ['get-campaign', 'Campaign progress']]],
  ['Reference', [['webhooks', 'Webhooks'], ['errors', 'Errors']]],
];

export const CALL_BODY = { to: '+14155550123', connectTo: '+18005550100', from: '+14155550100', machine: 'hangup', metadata: { leadId: 'L-1042' } };
export const CALL_PARAMS = [
  ['to', 'required', 'The lead’s number with country code, e.g. +14155550123.'],
  ['connectTo', 'required*', 'Where the call goes the moment the lead answers — e.g. your agents’ toll-free number. *Optional if set in Settings → API.'],
  ['from', 'optional', 'One of your active CloudIVR numbers. Default: the one set in Settings → API.'],
  ['showAs', 'optional', 'A caller ID you verified in CloudIVR, shown instead of the from number.'],
  ['machine', 'optional', '"hangup" (default) ends the call when voicemail answers and reports it. "connect" connects every answered call.'],
  ['metadata', 'optional', 'Any JSON object (under 2,000 characters), returned in every update — e.g. your lead id.'],
];
export const CALL_REPLY = `{
  "id": "call_3f9a1c…",
  "status": "queued",
  "to": "+14155550123",
  "connectTo": "+18005550100",
  "from": "+14155550100",
  "showAs": null,
  "machine": "hangup",
  "metadata": { "leadId": "L-1042" },
  "createdAt": "2026-11-20T14:09:02.000Z"
}`;
export const CALL_DONE = `{
  "id": "call_3f9a1c…",
  "status": "completed",
  "outcome": "connected",
  "answeredBy": "human",
  "duration": 184,
  "connectedDuration": 181,
  "answeredAt": "2026-11-20T14:09:11.000Z",
  "endedAt": "2026-11-20T14:12:09.000Z",
  "metadata": { "leadId": "L-1042" }
}`;
export const NUMBERS_REPLY = `{
  "numbers": ["+14155550100", "+18005550100"]
}`;

export const SMS_BODY = { to: '+14155550123', text: 'Your appointment is tomorrow at 10am.' };
export const SMS_PARAMS = [
  ['to', 'required', 'A USA or Canada mobile number, +1 followed by 10 digits.'],
  ['text', 'required', 'The message. Long texts are split into parts automatically.'],
  ['optOut', 'optional', 'true (default) adds “Reply STOP to opt out”. Send false to leave it off.'],
];
export const SMS_REPLY = `{
  "status": "sent",
  "to": "+14155550123",
  "segments": 1,
  "charged": 1,
  "balance": 118.4
}`;

export const CAMPAIGN_BODY = { numbers: ['+14155550123', '+14165550199', '… 500+ numbers'], text: 'Hi! Your order is ready for pickup today.', consent: true, sendAt: 'now', name: 'Pickup reminder' };
export const CAMPAIGN_PARAMS = [
  ['numbers', 'required', 'Array (or newline-separated string) of USA/Canada mobiles. At least 500. Landlines and duplicates are skipped and not billed.'],
  ['text', 'required', 'The message every number gets.'],
  ['consent', 'required', 'Must be true — confirms every number agreed to get your texts.'],
  ['sendAt', 'optional', '"now" (default) or a whole UTC hour, e.g. 2026-12-01T15:00:00Z. 24 h+ ahead is 10% off.'],
  ['name', 'optional', 'A label for your records (up to 40 characters).'],
  ['optOut', 'optional', 'true (default) adds “Reply STOP to opt out”.'],
  ['replies', 'optional', 'true collects replies in your CloudIVR inbox (+$20).'],
];
export const CAMPAIGN_REPLY = `{
  "id": "cp_8d21…",
  "booking": "bk_51e0…",
  "status": "scheduled",
  "numbers": 520,
  "sendable": 512,
  "skipped": 8,
  "texts": 520,
  "price": 52,
  "startsAt": "2026-12-01T15:00:00.000Z",
  "estimatedEnd": "2026-12-01T17:10:00.000Z"
}`;
export const CAMPAIGN_STATUS = `{
  "id": "cp_8d21…",
  "status": "running",
  "texts": 520,
  "sent": 341,
  "failed": 6,
  "replies": 12,
  "price": 52
}`;

export const PRICES = [
  ['Single text', '$1 each', 'Keep at least $20 in the wallet. Refunded automatically if it isn’t sent.'],
  ['Campaign', '$0.10 a text', '500-text minimum ($50). 10% off when booked 24 h+ ahead. Replies inbox +$20.'],
  ['Calls', 'Per-minute', 'Both legs (lead + agent line) at your normal calling rates.'],
  ['API access', 'Enterprise', 'Included with Enterprise; on Business it’s a $99/month add-on.'],
];

export const EVENTS = [
  ['api_call.ringing', 'The lead’s phone is ringing.'],
  ['api_call.answered', 'The lead answered — answeredBy is human or machine.'],
  ['api_call.connected', 'Your agent line picked up and the two are talking.'],
  ['api_call.completed', 'The call ended. outcome: connected, voicemail, no_answer, busy, agent_no_answer or hung_up.'],
];
export const EVENT = `POST https://your-crm.example.com/cloudivr
X-CloudIVR-Event: api_call.completed
X-CloudIVR-Signature: 9c1f…  (hex HMAC-SHA256 of the raw body)

{
  "id": "evt_…",
  "type": "api_call.completed",
  "created": "2026-11-20T14:12:09.000Z",
  "data": { "id": "call_3f9a1c…", "status": "completed", "outcome": "connected", … }
}`;
export const VERIFY = {
  'Node.js': `const crypto = require("crypto");

function isFromCloudIVR(rawBody, signature, secret) {
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature || ""));
}`,
  Python: `import hmac, hashlib

def is_from_cloudivr(raw_body: bytes, signature: str, secret: str) -> bool:
    expected = hmac.new(secret.encode(), raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature or "")`,
};

export const ERRORS = [
  ['401', 'invalid_api_key', 'Missing or wrong key.'],
  ['403', 'api_not_enabled', 'This account has no API access (Enterprise, or Business + API add-on).'],
  ['400', 'invalid_to · invalid_connect_to · invalid_from', 'A number is missing, not in +country format, or not yours.'],
  ['400', 'invalid_text · too_few · no_mobile · send_at', 'Text missing, fewer than 500 mobiles, no textable numbers, or a bad sendAt.'],
  ['400', 'scam', 'The text looks like a scam (prize, refund, phishing link…) and is refused.'],
  ['402', 'insufficient_balance · low_balance', 'The wallet can’t cover it. Top up and retry.'],
  ['409', 'do_not_call', 'The lead is on your do-not-call list.'],
  ['409', 'slot errors', 'No free sending slot at that time — pick another hour. Not charged.'],
  ['428', 'consent_required', 'Send "consent": true with a campaign.'],
  ['424', 'call_failed', 'The call could not be placed — message says why.'],
  ['503', 'sms_unavailable', 'Texting is briefly unavailable. Retry later.'],
];
