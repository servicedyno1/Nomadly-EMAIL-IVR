const { networkLabel } = require('./sanitize-provider.js')
/**
 * Phone Number Health Monitor
 * - Runs every 30 minutes via setInterval
 * - Checks all active phone number accounts/statuses via provider APIs
 * - If a number is flagged/suspended: marks in MongoDB + notifies user via Telegram
 * - One-time notification with retry until delivered
 * 
 * USAGE: Import and call initPhoneMonitor(bot, db) during bot startup
 * 
 * Dependencies: axios (already in your project)
 */

const axios = require('axios');
const { translation } = require('./translation');

// Config from environment
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TELNYX_API_KEY = process.env.TELNYX_API_KEY;
const ADMIN_CHAT_ID = process.env.TELEGRAM_ADMIN_CHAT_ID;

const CHECK_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Check a Twilio subaccount's status
 */
async function checkTwilioSubaccount(subAccountSid) {
  try {
    const url = `https://api.twilio.com/2010-04-01/Accounts/${subAccountSid}.json`;
    const resp = await axios.get(url, {
      auth: { username: TWILIO_ACCOUNT_SID, password: TWILIO_AUTH_TOKEN },
      timeout: 15000,
    });
    return {
      sid: resp.data.sid,
      friendlyName: resp.data.friendly_name,
      status: resp.data.status,
    };
  } catch (err) {
    // HTTP 401 on a sub-account means Twilio is refusing parent-auth against it —
    // typically because Twilio CLOSED/SUSPENDED that sub-account.  Surface it as
    // 'auth_failed' so the suspension flow kicks in instead of looping forever
    // (this matters for paid customers — see /app/UX_ANOMALY_REPORT.md).
    if (err.response?.status === 401) {
      console.error(`[PhoneMonitor] AUTH_FAILED (likely sub-account suspended by provider): ${subAccountSid}`);
      return { sid: subAccountSid, status: 'auth_failed', error: '401 Unauthorized' };
    }
    console.error(`[PhoneMonitor] Error checking subaccount ${subAccountSid}:`, err.message);
    return { sid: subAccountSid, status: 'error', error: err.message };
  }
}

// Is the PARENT Twilio account itself usable? When Twilio deactivates it (error 20003 "is not active")
// every sub-account poll 401s, so we poll none of them and alert the admin once a day instead.
async function checkTwilioParent() {
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) return { ok: false, reason: 'not configured' };
  try {
    const resp = await axios.get(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}.json`, {
      auth: { username: TWILIO_ACCOUNT_SID, password: TWILIO_AUTH_TOKEN }, timeout: 15000,
    });
    return { ok: resp.data.status === 'active', reason: resp.data.status };
  } catch (err) {
    if (err.response?.status === 401) return { ok: false, reason: err.response?.data?.message || '401 Unauthorized' };
    return { ok: true, reason: `unverified: ${err.message}` }; // network blip: poll as usual
  }
}

/**
 * Check if a specific Twilio number SID still exists on its sub-account.
 * Uses the sub-account's own credentials (parent-auth returns 401 for
 * IncomingPhoneNumbers on some sub-accounts).
 * Returns { exists: true/false, error?: string }
 */
async function checkTwilioNumberExists(numberSid, subAccountSid, subAccountToken) {
  if (!subAccountToken) {
    // Can't verify without sub-account token — assume exists to avoid false positives
    return { exists: true, error: 'missing_sub_token' };
  }
  try {
    const url = `https://api.twilio.com/2010-04-01/Accounts/${subAccountSid}/IncomingPhoneNumbers/${numberSid}.json`;
    await axios.get(url, {
      auth: { username: subAccountSid, password: subAccountToken },
      timeout: 15000,
    });
    return { exists: true };
  } catch (err) {
    if (err.response?.status === 404) {
      return { exists: false };
    }
    // 401 or other errors — don't treat as "released", just skip
    console.error(`[PhoneMonitor] Error checking Twilio number SID ${numberSid}: ${err.response?.status || err.message}`);
    return { exists: true, error: err.message }; // default to exists on non-404 errors
  }
}

/**
 * Check a Telnyx number's status
 */
async function checkTelnyxNumber(phoneNumber) {
  try {
    const resp = await axios.get('https://api.telnyx.com/v2/phone_numbers', {
      headers: { Authorization: `Bearer ${TELNYX_API_KEY}`, Accept: 'application/json' },
      params: { 'filter[phone_number]': phoneNumber },
      timeout: 15000,
    });
    const numbers = resp.data?.data || [];
    if (numbers.length > 0) {
      return {
        id: numbers[0].id,
        phoneNumber: numbers[0].phone_number,
        status: numbers[0].status,
        connectionName: numbers[0].connection_name,
      };
    }
    // Number not found — removed/released from provider
    return { phoneNumber, status: 'removed' };
  } catch (err) {
    console.error(`[PhoneMonitor] Error checking number ${phoneNumber}:`, err.message);
    return { phoneNumber, status: 'error', error: err.message };
  }
}

/**
 * Build user notification (provider-neutral — no mention of Twilio/Telnyx).
 * Localised — pass user's preferred language ('en'|'fr'|'zh'|'hi').
 */
function buildUserMessage(phoneNumber, lang = 'en') {
  return (
    translation('t.phoneCallerIdFlaggedTitle', lang)
    + '\n\n'
    + translation('t.phoneCallerIdFlaggedBody', lang, phoneNumber)
  );
}

/**
 * Build admin notification (internal — includes provider details)
 */
function buildAdminMessage(chatId, phoneNumber, provider, detailId, friendlyName, userNotified) {
  const icon = userNotified ? '✅' : '❌ (will retry)';
  return (
    `🔴 <b>Number Suspended</b>\n\n` +
    `Provider: ${networkLabel(provider)}\n` +
    `ID: <code>${detailId}</code>\n` +
    `User: ${chatId} (${friendlyName})\n` +
    `Number: ${phoneNumber}\n` +
    `Detected: ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC\n` +
    `User notified: ${icon}`
  );
}

/**
 * Main health check routine
 */
async function runHealthCheck(bot, db) {
  console.log('[PhoneMonitor] === Health check started ===');

  const suspensionEvents = db.collection('suspensionEvents');
  const phoneNumbersOf = db.collection('phoneNumbersOf');

  let totalChecked = 0;
  let totalSuspended = 0;
  const authFailedSubs = [];  // sub-accounts returning 401 on parent-auth — needs admin investigation

  // Get all phone number records
  const allDocs = await phoneNumbersOf.find({}).toArray();

  // ----------------------------------------------------------
  // TWILIO: Check subaccount statuses
  // ----------------------------------------------------------
  const twilioNumbers = [];
  for (const doc of allDocs) {
    const numbers = doc.val?.numbers || [];
    for (const num of numbers) {
      if (num.provider === 'twilio' && num.twilioSubAccountSid) {
        twilioNumbers.push({
          chatId: doc._id,
          phoneNumber: num.phoneNumber,
          subAccountSid: num.twilioSubAccountSid,
          plan: num.plan,
        });
      }
    }
  }

  const authFailedEvents = db.collection('phoneMonitorAuthFailed');
  const today = new Date().toISOString().slice(0, 10);
  const parent = twilioNumbers.length ? await checkTwilioParent() : { ok: true };
  if (!parent.ok) {
    console.log(`[PhoneMonitor] Twilio main account unusable (${parent.reason}) — skipping ${twilioNumbers.length} sub-account checks`);
    await alertParentDown(bot, authFailedEvents, today, parent.reason, twilioNumbers.length);
  } else {
    console.log(`[PhoneMonitor] Checking ${twilioNumbers.length} Twilio subaccounts`);
  }

  for (const entry of parent.ok ? twilioNumbers : []) {
    const { subAccountSid: sid, chatId, phoneNumber } = entry;

    // Sub-account already reported as 401 today → don't poll (and log) it again until tomorrow.
    if (await authFailedEvents.findOne({ _id: `${today}:${sid}` })) { totalChecked++; continue; }

    // Skip if already fully notified
    const fullyNotified = await suspensionEvents.findOne({
      phoneNumber, provider: 'twilio', status: 'suspended',
      resolved: false, notifiedUser: true, notifiedAdmin: true,
    });
    if (fullyNotified) { totalChecked++; continue; }

    const statusInfo = await checkTwilioSubaccount(sid);
    totalChecked++;

    if (statusInfo.status === 'suspended') {
      console.log(`[PhoneMonitor] SUSPENDED: ${phoneNumber} | chatId=${chatId}`);
      const isNew = await handleSuspension(
        bot, db, suspensionEvents, phoneNumbersOf,
        chatId, phoneNumber, 'twilio', sid,
        statusInfo.friendlyName || '',
        { _id: chatId, 'val.numbers.twilioSubAccountSid': sid },
        'val.numbers.$.status',
      );
      if (isNew) totalSuspended++;
    } else if (statusInfo.status === 'auth_failed') {
      // 401 on the sub-account fetch — DO NOT alarm the user (number may still work
      // for live traffic; this could be a credentials / Twilio-side issue we need
      // to investigate first).  Track once + alert admin.
      authFailedSubs.push({ subAccountSid: sid, chatId, phoneNumber });
    } else if (statusInfo.status === 'active') {
      await handleReactivation(
        suspensionEvents, phoneNumbersOf, phoneNumber, 'twilio', chatId,
        { _id: chatId, 'val.numbers.twilioSubAccountSid': sid },
        'val.numbers.$.status',
      );
    }
  }

  // ----------------------------------------------------------
  // TWILIO: Check individual number SIDs still exist on sub-account
  // (Catches numbers silently released/removed by Twilio)
  // ----------------------------------------------------------
  let totalInactiveReleased = 0;
  const twilioActiveNumbers = [];
  for (const doc of allDocs) {
    const numbers = doc.val?.numbers || [];
    const topLevelSubToken = doc.val?.twilioSubAccountToken || null;
    for (const num of numbers) {
      if (num.provider === 'twilio' && num.status === 'active' && num.twilioNumberSid && num.twilioSubAccountSid) {
        twilioActiveNumbers.push({
          chatId: doc._id,
          phoneNumber: num.phoneNumber,
          numberSid: num.twilioNumberSid,
          subAccountSid: num.twilioSubAccountSid || doc.val?.twilioSubAccountSid,
          subAccountToken: num.subAccountAuthToken || topLevelSubToken,
        });
      }
    }
  }

  console.log(`[PhoneMonitor] Verifying ${twilioActiveNumbers.length} active Twilio number SIDs on sub-accounts`);

  for (const entry of parent.ok ? twilioActiveNumbers : []) {
    const { chatId, phoneNumber, numberSid, subAccountSid, subAccountToken } = entry;
    if (authFailedSubs.some(a => a.subAccountSid === subAccountSid) || await authFailedEvents.findOne({ _id: `${today}:${subAccountSid}` })) continue;

    // Skip numbers already marked inactive_released
    const doc = allDocs.find(d => d._id === chatId);
    const numRecord = (doc?.val?.numbers || []).find(n => n.phoneNumber === phoneNumber);
    if (numRecord?.status === 'inactive_released') continue;

    const result = await checkTwilioNumberExists(numberSid, subAccountSid, subAccountToken);
    if (!result.exists && !result.error) {
      // Number SID no longer on the sub-account — mark as inactive_released
      console.log(`[PhoneMonitor] RELEASED: ${phoneNumber} (SID ${numberSid}) no longer on sub-account ${subAccountSid} | chatId=${chatId}`);
      totalInactiveReleased++;

      const now = new Date().toISOString();
      await phoneNumbersOf.updateOne(
        { _id: chatId, 'val.numbers.phoneNumber': phoneNumber },
        { $set: {
          'val.numbers.$.status': 'inactive_released',
          'val.numbers.$._inactiveSince': now,
          'val.numbers.$._releaseDetectedBy': 'phone-monitor',
        } }
      );

      // Resolve user language for notification
      let userLang = 'en';
      try {
        const userState = await db.collection('state').findOne({ _id: String(chatId) });
        userLang = userState?.userLanguage || 'en';
      } catch (_) { /* fallback */ }

      // Notify user
      const userMsgs = {
        en: `🚫 <b>Number No Longer Active</b>\n\n📞 ${phoneNumber} is no longer active with the provider and has been marked <b>inactive</b>.\n\nThis number can no longer make or receive calls. It will be automatically removed from your account in <b>48 hours</b>.\n\nIf you believe this is an error, contact support before then.`,
        fr: `🚫 <b>Numéro Plus Actif</b>\n\n📞 ${phoneNumber} n'est plus actif chez le fournisseur et a été marqué <b>inactif</b>.\n\nCe numéro ne peut plus passer ni recevoir d'appels. Il sera automatiquement supprimé de votre compte dans <b>48 heures</b>.\n\nSi vous pensez qu'il s'agit d'une erreur, contactez le support.`,
        zh: `🚫 <b>号码已失效</b>\n\n📞 ${phoneNumber} 已被运营商停用，标记为<b>不活跃</b>。\n\n此号码无法再拨打或接听电话。将在 <b>48小时</b> 后自动从您的账户中移除。\n\n如有疑问，请联系客服。`,
        hi: `🚫 <b>नंबर अब सक्रिय नहीं</b>\n\n📞 ${phoneNumber} अब प्रदाता के पास सक्रिय नहीं है और <b>निष्क्रिय</b> चिह्नित किया गया है।\n\nयह नंबर अब कॉल नहीं कर सकता। <b>48 घंटे</b> में यह आपके खाते से स्वचालित रूप से हटा दिया जाएगा।\n\nकोई प्रश्न हो तो सहायता से संपर्क करें।`,
      };
      try {
        await bot.sendMessage(String(chatId), userMsgs[userLang] || userMsgs.en, { parse_mode: 'HTML' });
      } catch (err) {
        console.error(`[PhoneMonitor] User notification failed for ${chatId} (inactive_released):`, err.message);
      }

      // Notify admin
      if (ADMIN_CHAT_ID) {
        try {
          await bot.sendMessage(ADMIN_CHAT_ID,
            `🚫 <b>Number Released by Provider</b>\n\n` +
            `Provider: Twilio\n` +
            `Number SID: <code>${numberSid}</code>\n` +
            `Sub-Account: <code>${subAccountSid}</code>\n` +
            `User: <code>${chatId}</code>\n` +
            `Number: ${phoneNumber}\n` +
            `Detected: ${now.slice(0, 16).replace('T', ' ')} UTC\n` +
            `Status: <b>inactive_released</b> (auto-remove in 48h)`,
            { parse_mode: 'HTML' }
          );
        } catch (err) {
          console.error(`[PhoneMonitor] Admin notification failed (inactive_released):`, err.message);
        }
      }
    }
  }

  // ----------------------------------------------------------
  // TELNYX: Check number statuses
  // ----------------------------------------------------------
  const telnyxNumbers = [];
  for (const doc of allDocs) {
    const numbers = doc.val?.numbers || [];
    for (const num of numbers) {
      // dryRun = CloudIVR web preview number that was never ordered from the carrier.
      if (num.provider === 'telnyx' && num.phoneNumber && !num.dryRun &&
          !['released', 'expired', 'cancelled'].includes(num.status)) {
        telnyxNumbers.push({
          chatId: doc._id,
          phoneNumber: num.phoneNumber,
          connectionId: num.connectionId || '',
          plan: num.plan,
        });
      }
    }
  }

  console.log(`[PhoneMonitor] Checking ${telnyxNumbers.length} Telnyx numbers`);

  for (const entry of telnyxNumbers) {
    const { chatId, phoneNumber } = entry;

    const fullyNotified = await suspensionEvents.findOne({
      phoneNumber, provider: 'telnyx', status: 'suspended',
      resolved: false, notifiedUser: true, notifiedAdmin: true,
    });
    if (fullyNotified) { totalChecked++; continue; }

    const statusInfo = await checkTelnyxNumber(phoneNumber);
    totalChecked++;

    if (['removed', 'inactive', 'port_pending', 'deleted'].includes(statusInfo.status)) {
      console.log(`[PhoneMonitor] FLAGGED (${statusInfo.status}): ${phoneNumber} | chatId=${chatId}`);
      const isNew = await handleSuspension(
        bot, db, suspensionEvents, phoneNumbersOf,
        chatId, phoneNumber, 'telnyx', String(statusInfo.id || phoneNumber),
        statusInfo.connectionName || '',
        { _id: chatId, 'val.numbers.phoneNumber': phoneNumber },
        'val.numbers.$.status',
      );
      if (isNew) totalSuspended++;
    } else if (statusInfo.status === 'active') {
      await handleReactivation(
        suspensionEvents, phoneNumbersOf, phoneNumber, 'telnyx', chatId,
        { _id: chatId, 'val.numbers.phoneNumber': phoneNumber },
        'val.numbers.$.status',
      );
    }
  }

  console.log(`[PhoneMonitor] === Health check complete: ${totalChecked} checked, ${totalSuspended} newly suspended, ${totalInactiveReleased} inactive_released, ${authFailedSubs.length} auth-failed ===`);

  // Send a once-per-day admin digest about auth-failed sub-accounts (deduped per sub).
  // These are paid customers' lines we can no longer poll; admin needs to rotate
  // the sub-account auth token in Twilio console or open a ticket with Twilio.
  if (authFailedSubs.length > 0 && ADMIN_CHAT_ID) {
    try {
      const fresh = [];
      for (const entry of authFailedSubs) {
        const key = `${today}:${entry.subAccountSid}`;
        const existing = await authFailedEvents.findOne({ _id: key });
        if (existing) continue;
        await authFailedEvents.insertOne({
          _id: key,
          subAccountSid: entry.subAccountSid,
          chatId: entry.chatId,
          phoneNumber: entry.phoneNumber,
          notifiedAt: new Date(),
        });
        fresh.push(entry);
      }
      if (fresh.length > 0) {
        const lines = fresh.map(e => `• <code>${e.subAccountSid}</code>  →  ${e.phoneNumber}  (chat ${e.chatId})`);
        const msg =
          `🔧 <b>Twilio sub-account auth check failed (401)</b>\n\n` +
          `${fresh.length} sub-account(s) returning <b>401 Unauthorized</b> against parent-auth poll.\n` +
          `These are <i>paid customer lines</i> we cannot manage via API right now.\n\n` +
          lines.join('\n') +
          `\n\n<b>Action:</b> rotate each sub-account's auth token in the Twilio console, or open a Twilio support ticket for the closed sub-accounts.`;
        await bot.sendMessage(ADMIN_CHAT_ID, msg, { parse_mode: 'HTML', disable_web_page_preview: true });
        console.log(`[PhoneMonitor] Admin digest sent for ${fresh.length} auth-failed sub-account(s)`);
      }
    } catch (err) {
      console.error(`[PhoneMonitor] Auth-failed admin digest error:`, err.message);
    }
  }

  return { checked: totalChecked, suspended: totalSuspended, inactiveReleased: totalInactiveReleased, authFailed: authFailedSubs.length };
}

// One admin alert per day while the parent Twilio account is down.
async function alertParentDown(bot, authFailedEvents, today, reason, lines) {
  const key = `${today}:parent`;
  try {
    if (await authFailedEvents.findOne({ _id: key })) return;
    await authFailedEvents.insertOne({ _id: key, subAccountSid: TWILIO_ACCOUNT_SID, reason, notifiedAt: new Date() });
    if (!ADMIN_CHAT_ID) return;
    await bot.sendMessage(ADMIN_CHAT_ID,
      `🔴 <b>Twilio main account is not active</b>\n\n` +
      `Twilio rejects the main account (<code>${String(TWILIO_ACCOUNT_SID || '').slice(0, 10)}…</code>): ${reason}\n` +
      `${lines} customer Twilio line(s) cannot be managed (and may not work) until Twilio re-activates it.\n\n` +
      `<b>Action:</b> check the Twilio console / billing or contact Twilio support. Sub-account checks are paused until then (this alert repeats daily).`,
      { parse_mode: 'HTML', disable_web_page_preview: true });
  } catch (err) {
    console.error(`[PhoneMonitor] Parent-down admin alert error:`, err.message);
  }
}

/**
 * Handle a detected suspension — shared logic for both providers
 */
async function handleSuspension(
  bot, db, suspensionEvents, phoneNumbersOf,
  chatId, phoneNumber, provider, detailId, friendlyName,
  dbQueryFilter, dbStatusPath,
) {
  const chatIdStr = String(typeof chatId === 'number' ? Math.floor(chatId) : chatId);

  // Resolve user language for localised notification
  let userLang = 'en';
  try {
    const userState = await db.collection('state').findOne({ _id: chatIdStr });
    userLang = userState?.userLanguage || 'en';
  } catch (_) { /* fallback to en */ }

  // Check for existing unresolved event
  const existing = await suspensionEvents.findOne({
    phoneNumber, provider, status: 'suspended', resolved: false,
  });

  if (existing) {
    // Retry failed notifications only
    if (existing.notifiedUser && existing.notifiedAdmin) return false;

    const updates = {};

    if (!existing.notifiedUser) {
      try {
        await bot.sendMessage(chatIdStr, buildUserMessage(phoneNumber, userLang), { parse_mode: 'HTML' });
        updates.notifiedUser = true;
        console.log(`[PhoneMonitor] Retry: user notification succeeded for ${phoneNumber}`);
      } catch (err) {
        console.error(`[PhoneMonitor] Retry: user notification failed for ${phoneNumber}:`, err.message);
      }
    }

    if (!existing.notifiedAdmin && ADMIN_CHAT_ID) {
      try {
        const adminMsg = buildAdminMessage(chatId, phoneNumber, provider, detailId, friendlyName, updates.notifiedUser || existing.notifiedUser);
        await bot.sendMessage(ADMIN_CHAT_ID, adminMsg, { parse_mode: 'HTML' });
        updates.notifiedAdmin = true;
      } catch (err) {
        console.error(`[PhoneMonitor] Admin notification failed:`, err.message);
      }
    }

    if (Object.keys(updates).length > 0) {
      await suspensionEvents.updateOne({ _id: existing._id }, { $set: updates });
    }
    return false;
  }

  // NEW suspension — first detection

  // Mark number as suspended in DB
  await phoneNumbersOf.updateOne(dbQueryFilter, { $set: { [dbStatusPath]: 'suspended' } });
  console.log(`[PhoneMonitor] Marked ${phoneNumber} as suspended in DB`);

  // Record suspension event
  const event = {
    provider,
    detailId,
    chatId,
    phoneNumber,
    status: 'suspended',
    friendlyName,
    detectedAt: new Date(),
    notifiedUser: false,
    notifiedAdmin: false,
    resolved: false,
  };
  await suspensionEvents.insertOne(event);

  // Notify user (provider-neutral message)
  let userNotified = false;
  try {
    await bot.sendMessage(chatIdStr, buildUserMessage(phoneNumber, userLang), { parse_mode: 'HTML' });
    userNotified = true;
    console.log(`[PhoneMonitor] User ${chatIdStr} notified about ${phoneNumber}`);
  } catch (err) {
    console.error(`[PhoneMonitor] User notification failed for ${chatIdStr}:`, err.message);
  }

  // Notify admin (with internal provider details)
  let adminNotified = false;
  if (ADMIN_CHAT_ID) {
    try {
      await bot.sendMessage(ADMIN_CHAT_ID, buildAdminMessage(chatId, phoneNumber, provider, detailId, friendlyName, userNotified), { parse_mode: 'HTML' });
      adminNotified = true;
    } catch (err) {
      console.error(`[PhoneMonitor] Admin notification failed:`, err.message);
    }
  }

  // Update notification flags
  await suspensionEvents.updateOne(
    { phoneNumber, provider, resolved: false },
    { $set: { notifiedUser: userNotified, notifiedAdmin: adminNotified } },
  );

  return true;
}

/**
 * Handle reactivation of a previously suspended number
 */
async function handleReactivation(
  suspensionEvents, phoneNumbersOf, phoneNumber, provider, chatId,
  dbQueryFilter, dbStatusPath,
) {
  const existing = await suspensionEvents.findOne({
    phoneNumber, provider, status: 'suspended', resolved: false,
  });
  if (existing) {
    console.log(`[PhoneMonitor] ${phoneNumber} reactivated — resolving suspension event`);
    await suspensionEvents.updateOne(
      { _id: existing._id },
      { $set: { resolved: true, resolvedAt: new Date() } },
    );
    await phoneNumbersOf.updateOne(dbQueryFilter, { $set: { [dbStatusPath]: 'active' } });
  }
}

/**
 * Initialize the phone monitor — call this during bot startup
 * 
 * @param {Object} bot - Telegraf bot instance
 * @param {Object} db - MongoDB database instance
 */
function initPhoneMonitor(bot, db) {
  console.log('[PhoneMonitor] Initialized — checking every 30 minutes');

  // Run immediately on startup
  setTimeout(() => {
    runHealthCheck(bot, db).catch(err => {
      console.error('[PhoneMonitor] Startup check failed:', err.message);
    });
  }, 10000); // 10s delay to let other services initialize

  // Schedule recurring checks every 30 minutes
  setInterval(() => {
    runHealthCheck(bot, db).catch(err => {
      console.error('[PhoneMonitor] Scheduled check failed:', err.message);
    });
  }, CHECK_INTERVAL_MS);
}

module.exports = { initPhoneMonitor, runHealthCheck, checkTwilioParent };
