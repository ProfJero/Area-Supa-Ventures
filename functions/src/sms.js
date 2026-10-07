import { onCall } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { defineString } from 'firebase-functions/params';
import {
  db, FieldValue, HttpsError, logger, CALLABLE_OPTS,
  requireStaff, audit, bad, str, docId, requestId, loadSettings, todayAccra
} from './common.js';
import { PROFJERO_API_KEY, profjero, toHttpsError } from './profjero.js';
import {
  DEFAULT_SMS_SETTINGS, mergeSmsSettings, assertTemplate, sendToCustomers, loadAudience, customerFields
} from './sms-service.js';
import { smsNumber } from './profjero.js';

// Where ProfJero sends the payer back after checkout, e.g.
// https://area-supa-ventures.web.app  (set in functions/.env).
export const APP_URL = defineString('APP_URL', { default: 'https://area-supa-ventures.web.app' });

const SMS_OPTS = { ...CALLABLE_OPTS, secrets: [PROFJERO_API_KEY] };

async function call(fn) {
  try { return await fn(); } catch (e) { throw toHttpsError(e); }
}

/* ------------------------------ Overview ------------------------------ */

export const smsOverview = onCall(SMS_OPTS, async (request) => {
  await requireStaff(request, 'sms.send');
  const [wallet, senders] = await Promise.all([
    call(() => profjero('GET', '/v1/wallet')),
    call(() => profjero('GET', '/v1/sender-ids')).catch(() => ({ senderIds: [] }))
  ]);
  return {
    wallet,
    senderIds: (senders?.senderIds || []).map((s) => ({ senderId: s.senderId, status: s.status, purpose: s.purpose || '' }))
  };
});

/* ------------------------------ Settings ------------------------------ */

export const saveSmsSettings = onCall(SMS_OPTS, async (request) => {
  const actor = await requireStaff(request, 'sms.settings');
  const d = request.data || {};

  const senderId = str(d.senderId, { label: 'Sender ID', max: 11 });
  if (senderId) {
    const res = await call(() => profjero('GET', '/v1/sender-ids'));
    const ok = (res?.senderIds || []).some((s) => s.senderId === senderId && s.status === 'approved');
    if (!ok) throw bad(`Sender ID "${senderId}" is not approved on your ProfJero account yet.`);
  }

  const auto = {};
  for (const k of ['deposit', 'withdrawal', 'welcome']) {
    const v = d.autoSms?.[k] || {};
    auto[k] = {
      enabled: v.enabled === true,
      template: assertTemplate(v.template || DEFAULT_SMS_SETTINGS.autoSms[k].template,
        { allowTransaction: k !== 'welcome', label: `${k[0].toUpperCase() + k.slice(1)} message` })
    };
  }
  const birthday = {
    enabled: d.birthday?.enabled === true,
    template: assertTemplate(d.birthday?.template || DEFAULT_SMS_SETTINGS.birthday.template, { label: 'Birthday message' })
  };

  if (!Array.isArray(d.occasions) || d.occasions.length > 30) throw bad('Occasions must be a list of at most 30.');
  const ids = new Set();
  const occasions = d.occasions.map((o, i) => {
    const name = str(o?.name, { label: `Occasion ${i + 1} name`, max: 40, required: true });
    const month = Number(o?.month);
    const day = Number(o?.day);
    if (!Number.isInteger(month) || month < 1 || month > 12) throw bad(`${name}: choose a month.`);
    const maxDay = new Date(Date.UTC(2024, month, 0)).getUTCDate();
    if (!Number.isInteger(day) || day < 1 || day > maxDay) throw bad(`${name}: choose a valid day.`);
    let id = typeof o?.id === 'string' && /^[a-z0-9_-]{1,40}$/.test(o.id) ? o.id
      : name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || `occasion-${i}`;
    while (ids.has(id)) id += '-x';
    ids.add(id);
    return { id, name, month, day, enabled: o?.enabled === true, template: assertTemplate(o?.template, { label: `${name} message` }) };
  });

  await db.doc('settings/sms').set({
    senderId, autoSms: auto, birthday, occasions,
    updatedAt: FieldValue.serverTimestamp(), updatedBy: actor.uid
  });
  await audit(actor, 'settings.sms', { targetType: 'settings', targetId: 'sms', summary: 'Updated SMS settings and templates' });
  return { ok: true };
});

/* ------------------------------ Sending ------------------------------ */

function parseAudience(a) {
  if (!a || typeof a !== 'object') throw bad('Choose who to send to.');
  return { type: a.type, ids: a.ids, branch: a.branch };
}

function parseSchedule(v) {
  if (!v) return null;
  const t = new Date(v);
  if (typeof v !== 'string' || Number.isNaN(t.getTime())) throw bad('Choose a valid date and time.');
  if (t.getTime() < Date.now() + 60_000) throw bad('Scheduled time must be at least a minute from now.');
  if (t.getTime() > Date.now() + 366 * 86400_000) throw bad('You can schedule at most a year ahead.');
  return t.toISOString();
}

export const smsEstimate = onCall({ ...SMS_OPTS, timeoutSeconds: 120 }, async (request) => {
  await requireStaff(request, 'sms.send');
  const message = assertTemplate(request.data?.message);
  const customers = await loadAudience(parseAudience(request.data?.audience));
  const { general } = await loadSettings();
  const recipients = customers
    .filter((c) => smsNumber(c.phone) && c.smsOptOut !== true)
    .map((c) => ({ phone: smsNumber(c.phone), fields: customerFields(c, general.businessName) }));
  if (!recipients.length) return { recipients: 0, units: 0, sufficient: true, samples: [], skipped: customers.length };

  const total = { recipients: 0, units: 0, availableUnits: null, sufficient: true, samples: [] };
  for (let i = 0; i < recipients.length; i += 5000) {
    const res = await call(() => profjero('POST', '/v1/sms/estimate', { body: { message, recipients: recipients.slice(i, i + 5000) } }));
    total.recipients += Number(res.recipients) || 0;
    total.units += Number(res.units) || 0;
    total.availableUnits = res.availableUnits;
    if (!total.samples.length) total.samples = (res.samples || []).slice(0, 3);
  }
  total.sufficient = total.availableUnits === null || total.units <= total.availableUnits;
  total.skipped = customers.length - recipients.length;
  return total;
});

export const smsSend = onCall({ ...SMS_OPTS, timeoutSeconds: 300 }, async (request) => {
  const actor = await requireStaff(request, 'sms.send');
  const id = requestId(request.data?.requestId);
  const message = assertTemplate(request.data?.message);
  const scheduleAt = parseSchedule(request.data?.scheduleAt);
  const audience = parseAudience(request.data?.audience);
  const title = str(request.data?.title, { label: 'Title', max: 60 });

  // Bulk sends to everyone need the same rights as configuring SMS.
  if (audience.type === 'all' || audience.type === 'branch') {
    await requireStaff(request, 'sms.settings').catch(() => {
      throw new HttpsError('permission-denied', 'Only administrators can message all customers or a whole branch.');
    });
  }

  const customers = await loadAudience(audience);
  const { general, sms } = await loadSettings();
  const s = mergeSmsSettings(sms);

  const result = await call(() => sendToCustomers({
    customers, template: message, senderId: s.senderId, businessName: general.businessName,
    keyBase: `manual-${id}`, kind: 'manual', actor, scheduleAt, title
  }));

  await audit(actor, 'sms.send', {
    targetType: 'smsLog', targetId: result.logId,
    summary: `${scheduleAt ? 'Scheduled' : 'Sent'} SMS to ${result.recipients} customer(s)` +
      (audience.type === 'branch' ? ` in ${audience.branch}` : audience.type === 'all' ? ' (all customers)' : '')
  });
  return result;
});

// Sends an occasion message (e.g. Christmas) to all active customers right now.
export const smsSendOccasionNow = onCall({ ...SMS_OPTS, timeoutSeconds: 300 }, async (request) => {
  const actor = await requireStaff(request, 'sms.settings');
  const occasionId = docId(request.data?.occasionId, 'Occasion');
  const id = requestId(request.data?.requestId);
  const { general, sms } = await loadSettings();
  const s = mergeSmsSettings(sms);
  const occ = s.occasions.find((o) => o.id === occasionId);
  if (!occ) throw new HttpsError('not-found', 'Save the occasion first, then send it.');
  const customers = await loadAudience({ type: 'all' });
  const result = await call(() => sendToCustomers({
    customers, template: occ.template, senderId: s.senderId, businessName: general.businessName,
    keyBase: `occ-now-${occ.id}-${id}`, kind: 'occasion', actor, title: occ.name
  }));
  await audit(actor, 'sms.occasion', { targetType: 'smsLog', targetId: result.logId, summary: `Sent ${occ.name} message to ${result.recipients} customer(s)` });
  return result;
});

export const smsBatchStatus = onCall(SMS_OPTS, async (request) => {
  await requireStaff(request, 'sms.send');
  const logId = docId(request.data?.logId, 'Log');
  const ref = db.doc(`smsLogs/${logId}`);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Message not found.');
  const batches = snap.data().batches || [];
  const totals = { delivered: 0, submitted: 0, failed: 0, unknown: 0, charged: 0 };
  const updated = [];
  for (const b of batches) {
    if (!b.batchId) { updated.push(b); continue; }
    const res = await call(() => profjero('GET', `/v1/sms/batches/${encodeURIComponent(b.batchId)}`));
    const bt = res?.batch || {};
    totals.delivered += Number(bt.deliveredCount) || 0;
    totals.submitted += Number(bt.submittedCount) || 0;
    totals.failed += Number(bt.failedCount) || 0;
    totals.unknown += Number(bt.unknownCount) || 0;
    totals.charged += Number(bt.totalUnitsCharged) || 0;
    updated.push({ ...b, status: bt.status || b.status });
  }
  await ref.update({ batches: updated, delivery: totals, deliveryCheckedAt: FieldValue.serverTimestamp() });
  return { batches: updated, delivery: totals };
});

export const smsCancelScheduled = onCall(SMS_OPTS, async (request) => {
  const actor = await requireStaff(request, 'sms.send');
  const logId = docId(request.data?.logId, 'Log');
  const ref = db.doc(`smsLogs/${logId}`);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Message not found.');
  const batches = snap.data().batches || [];
  for (const b of batches) {
    if (b.campaignId) await call(() => profjero('POST', `/v1/campaigns/${encodeURIComponent(b.campaignId)}/cancel`, { idempotencyKey: `cancel-${b.campaignId}` }));
  }
  await ref.update({ status: 'cancelled', batches: batches.map((b) => ({ ...b, status: 'cancelled' })) });
  await audit(actor, 'sms.cancel', { targetType: 'smsLog', targetId: logId, summary: 'Cancelled a scheduled SMS' });
  return { ok: true };
});

/* ------------------------------ Billing ------------------------------ */

export const smsPricing = onCall(SMS_OPTS, async (request) => {
  await requireStaff(request, 'sms.billing');
  return call(() => profjero('GET', '/v1/pricing', { auth: false }));
});

export const smsBuyUnits = onCall(SMS_OPTS, async (request) => {
  const actor = await requireStaff(request, 'sms.billing');
  const d = request.data || {};
  const id = requestId(d.requestId);
  const body = {};
  if (d.packageId) {
    body.packageId = str(d.packageId, { label: 'Package', max: 60 });
  } else {
    const units = Number(d.units);
    if (!Number.isInteger(units) || units < 50 || units > 1_000_000) throw bad('Enter between 50 and 1,000,000 units.');
    body.units = units;
  }
  if (d.method) {
    if (!['mobile_money', 'card'].includes(d.method)) throw bad('Choose mobile money or card.');
    body.method = d.method;
  }
  if (actor.email) body.email = actor.email;
  // The return address is fixed on the server so it can never be redirected elsewhere.
  body.callbackUrl = `${APP_URL.value().replace(/\/$/, '')}/sms.html?tab=billing&payment=return`;

  const res = await call(() => profjero('POST', '/v1/payments', { body, idempotencyKey: `topup-${id}` }));
  const p = res?.payment || {};
  if (!p.reference || typeof res.checkoutUrl !== 'string' || !res.checkoutUrl.startsWith('https://')) {
    throw new HttpsError('unavailable', 'The SMS provider did not return a checkout link.');
  }
  await db.doc(`smsPayments/${p.reference}`).set({
    reference: p.reference, packageId: p.packageId || null, units: p.units || null,
    amountGhs: p.amountGhs ?? null, currency: p.currency || 'GHS', status: p.status || 'pending',
    createdBy: actor.uid, createdByName: actor.name, createdAt: FieldValue.serverTimestamp()
  }, { merge: true });
  await audit(actor, 'sms.buy_units', {
    targetType: 'smsPayment', targetId: p.reference,
    summary: `Started SMS top-up: ${p.units || '?'} units for GH₵${p.amountGhs ?? '?'}`
  });
  return { reference: p.reference, checkoutUrl: res.checkoutUrl, units: p.units, amountGhs: p.amountGhs };
});

export const smsPaymentStatus = onCall(SMS_OPTS, async (request) => {
  await requireStaff(request, 'sms.billing');
  const ref = str(request.data?.reference, { label: 'Reference', max: 80, required: true });
  if (!/^[A-Za-z0-9_-]+$/.test(ref)) throw bad('Invalid payment reference.');
  const res = await call(() => profjero('GET', `/v1/payments/${encodeURIComponent(ref)}`));
  const p = res?.payment || res || {};
  await db.doc(`smsPayments/${ref}`).set({
    reference: ref, status: p.status || 'unknown', units: p.units ?? null, amountGhs: p.amountGhs ?? null,
    paidAt: p.paidAt || null, walletCreditedAt: p.walletCreditedAt || null,
    checkedAt: FieldValue.serverTimestamp()
  }, { merge: true });
  return { reference: ref, status: p.status, units: p.units, amountGhs: p.amountGhs, paidAt: p.paidAt, walletCreditedAt: p.walletCreditedAt };
});

/* ------------------------- Birthdays & occasions ------------------------- */

function isLeap(y) { return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0; }

/**
 * Every morning at 08:00 Accra time: birthday wishes, plus any enabled
 * occasion (Christmas, New Year, ...) that falls on today. Idempotency keys
 * include the date, so a retried run never sends twice.
 */
export const dailyGreetings = onSchedule(
  { schedule: '0 8 * * *', timeZone: 'Africa/Accra', region: 'us-central1', secrets: [PROFJERO_API_KEY], timeoutSeconds: 540, retryCount: 2 },
  async () => {
    const today = todayAccra();
    const [y, m, d] = today.split('-').map(Number);
    const { general, sms } = await loadSettings();
    const s = mergeSmsSettings(sms);
    if (!s.senderId) { logger.info('dailyGreetings: no sender ID configured'); return; }

    if (s.birthday.enabled) {
      const days = [today.slice(5)];
      if (m === 2 && d === 28 && !isLeap(y)) days.push('02-29');
      const snaps = await Promise.all(days.map((md) =>
        db.collection('customers').where('dobMonthDay', '==', md).get()));
      const customers = snaps.flatMap((q) => q.docs.map((doc) => ({ id: doc.id, ...doc.data() })))
        .filter((c) => c.status !== 'inactive');
      if (customers.length) {
        try {
          const r = await sendToCustomers({
            customers, template: s.birthday.template, senderId: s.senderId, businessName: general.businessName,
            keyBase: `bday-${today}`, kind: 'birthday', title: 'Birthday wishes'
          });
          logger.info('Birthday SMS', r);
        } catch (e) { logger.error('Birthday SMS failed', { error: e.message }); }
      }
    }

    const due = s.occasions.filter((o) => o.enabled && o.month === m && o.day === d);
    if (due.length) {
      const customers = await loadAudience({ type: 'all' });
      for (const occ of due) {
        try {
          const r = await sendToCustomers({
            customers, template: occ.template, senderId: s.senderId, businessName: general.businessName,
            keyBase: `occ-${occ.id}-${today}`, kind: 'occasion', title: occ.name
          });
          logger.info('Occasion SMS', { occasion: occ.id, ...r });
        } catch (e) { logger.error('Occasion SMS failed', { occasion: occ.id, error: e.message }); }
      }
    }
  }
);
