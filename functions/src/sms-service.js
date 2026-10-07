// Builds personalised recipients from customer records and sends them through
// ProfJero, logging every batch to smsLogs.

import { db, FieldValue, HttpsError, logger, formatGhs, prettyDate } from './common.js';
import { profjero, smsNumber, toHttpsError } from './profjero.js';
import { CUSTOMER_FIELDS, unknownFields } from './sms-template.js';

export const MAX_MESSAGE = 1600;
const CHUNK = 1000; // ProfJero allows 10,000; smaller chunks keep requests fast.

export const DEFAULT_SMS_SETTINGS = {
  senderId: '',
  autoSms: {
    deposit: {
      enabled: true,
      template: 'Dear {first_name}, GHS {amount} has been deposited into your Area Supa account {customer_id} on {transaction_date}. New balance: GHS {balance}. Thank you.'
    },
    withdrawal: {
      enabled: true,
      template: 'Dear {first_name}, GHS {amount} has been withdrawn from your Area Supa account {customer_id} on {transaction_date}. New balance: GHS {balance}.'
    },
    welcome: {
      enabled: false,
      template: 'Welcome to Area Supa Ventures, {first_name}! Your customer ID is {customer_id}. Secure savings, trusted service.'
    }
  },
  birthday: {
    enabled: false,
    template: 'Happy birthday {first_name}! Everyone at Area Supa Ventures wishes you a wonderful year ahead.'
  },
  occasions: [
    { id: 'christmas', name: 'Christmas', month: 12, day: 25, enabled: false,
      template: 'Merry Christmas {first_name}! Thank you for saving with Area Supa Ventures. Have a blessed season.' },
    { id: 'newyear', name: 'New Year', month: 1, day: 1, enabled: false,
      template: 'Happy New Year {first_name}! Area Supa Ventures wishes you a prosperous year. Keep saving!' },
    { id: 'independence', name: 'Independence Day', month: 3, day: 6, enabled: false,
      template: 'Happy Independence Day {first_name}! From all of us at Area Supa Ventures.' }
  ]
};

export function mergeSmsSettings(saved) {
  const d = DEFAULT_SMS_SETTINGS;
  const s = saved || {};
  return {
    senderId: s.senderId || d.senderId,
    autoSms: {
      deposit:    { ...d.autoSms.deposit,    ...(s.autoSms?.deposit || {}) },
      withdrawal: { ...d.autoSms.withdrawal, ...(s.autoSms?.withdrawal || {}) },
      welcome:    { ...d.autoSms.welcome,    ...(s.autoSms?.welcome || {}) }
    },
    birthday: { ...d.birthday, ...(s.birthday || {}) },
    occasions: Array.isArray(s.occasions) ? s.occasions : d.occasions
  };
}

function firstLast(c) {
  const parts = String(c.fullName || '').trim().split(/\s+/).filter(Boolean);
  return {
    first: c.firstName || parts[0] || '',
    last: c.lastName || (parts.length > 1 ? parts[parts.length - 1] : '')
  };
}

// Every field gets a non-empty value so ProfJero never refuses a send.
export function customerFields(c, businessName, extra = {}) {
  const { first, last } = firstLast(c);
  const values = {
    first_name: first || 'Customer',
    last_name: last || '-',
    full_name: c.fullName || first || 'Customer',
    customer_id: c.accountNumber || '-',
    phone: c.phone || '-',
    tel2: c.tel2 || '-',
    branch: c.branch || '-',
    balance: formatGhs(c.balance),
    registration_date: prettyDate(c.registrationDate) || '-',
    company: businessName || 'Area Supa Ventures',
    ...extra
  };
  for (const k of Object.keys(values)) {
    if (values[k] === null || values[k] === undefined || String(values[k]).trim() === '') values[k] = '-';
    else values[k] = String(values[k]);
  }
  return values;
}

export function assertTemplate(template, { allowTransaction = false, label = 'Message' } = {}) {
  if (typeof template !== 'string' || !template.trim()) throw new HttpsError('invalid-argument', `${label} cannot be empty.`);
  if (template.length > MAX_MESSAGE) throw new HttpsError('invalid-argument', `${label} must be at most ${MAX_MESSAGE} characters.`);
  const unknown = unknownFields(template, { allowTransaction });
  if (unknown.length) {
    throw new HttpsError('invalid-argument',
      `${label} uses unknown field${unknown.length > 1 ? 's' : ''}: ${unknown.map((k) => `{${k}}`).join(', ')}. ` +
      `Available: ${CUSTOMER_FIELDS.map((f) => `{${f.key}}`).join(' ')}`);
  }
  return template.trim();
}

/**
 * Sends `template` to customers. Each customer object needs at least the
 * fields read by customerFields(). Returns { log id, recipients, skipped }.
 *
 * keyBase makes the send idempotent: re-running with the same keyBase returns
 * ProfJero's original result instead of sending twice.
 */
export async function sendToCustomers({
  customers, template, senderId, businessName, keyBase, kind, actor = null,
  extraFor = null, scheduleAt = null, title = ''
}) {
  if (!senderId) {
    throw new HttpsError('failed-precondition', 'Choose an approved Sender ID in SMS settings before sending.');
  }

  const recipients = [];
  let skipped = 0;
  const seen = new Set();
  for (const c of customers) {
    const phone = smsNumber(c.phone);
    if (!phone || c.smsOptOut === true || seen.has(phone + '|' + c.id)) { skipped++; continue; }
    seen.add(phone + '|' + c.id);
    recipients.push({ phone, fields: customerFields(c, businessName, extraFor ? extraFor(c) : {}) });
  }

  const logRef = db.collection('smsLogs').doc(keyBase.slice(0, 120));
  const base = {
    kind,
    title: title || null,
    message: template,
    senderId,
    recipientCount: recipients.length,
    skipped,
    customerId: customers.length === 1 ? customers[0].id : null,
    customerName: customers.length === 1 ? (customers[0].fullName || null) : null,
    scheduleAt: scheduleAt || null,
    createdBy: actor?.uid || 'system',
    createdByName: actor?.name || 'Automatic',
    createdAt: FieldValue.serverTimestamp()
  };

  if (!recipients.length) {
    await logRef.set({ ...base, status: 'skipped', batches: [], error: 'No recipients with a valid phone number.' }, { merge: true });
    return { logId: logRef.id, recipients: 0, skipped, status: 'skipped' };
  }

  const batches = [];
  let unitsReserved = 0;
  let status = 'sent';
  let error = null;
  for (let i = 0; i < recipients.length; i += CHUNK) {
    const chunk = recipients.slice(i, i + CHUNK);
    const body = { senderId, message: template, recipients: chunk };
    if (scheduleAt) body.scheduleAt = scheduleAt;
    try {
      const res = await profjero('POST', '/v1/sms/send', {
        body,
        idempotencyKey: `${keyBase}-${i / CHUNK}`.slice(0, 120)
      });
      if (res?.scheduled) {
        batches.push({ campaignId: res.campaign?.id || null, status: res.campaign?.status || 'scheduled', units: res.campaign?.estimate?.units || 0 });
        unitsReserved += Number(res.campaign?.estimate?.units) || 0;
        status = 'scheduled';
      } else {
        batches.push({ batchId: res?.batch?.id || null, status: res?.batch?.status || 'submitting', units: res?.batch?.totalUnitsReserved || 0 });
        unitsReserved += Number(res?.batch?.totalUnitsReserved) || 0;
      }
    } catch (e) {
      logger.error('SMS send failed', { kind, keyBase, chunk: i / CHUNK, error: e.message });
      error = toHttpsError(e).message;
      status = batches.length ? 'partial' : 'failed';
      break;
    }
  }

  await logRef.set({ ...base, status, batches, unitsReserved, error }, { merge: true });

  if (status === 'failed') {
    const he = new HttpsError('unavailable', error || 'SMS could not be sent.');
    he.logId = logRef.id;
    throw he;
  }
  return { logId: logRef.id, recipients: recipients.length, skipped, status, unitsReserved, error };
}

// Pulls every active customer's SMS-relevant fields, optionally by branch.
export async function loadAudience({ type, ids, branch }) {
  const cols = ['fullName', 'firstName', 'lastName', 'accountNumber', 'phone', 'tel2', 'branch',
    'balance', 'registrationDate', 'smsOptOut', 'status'];
  let docs = [];
  if (type === 'customers') {
    if (!Array.isArray(ids) || !ids.length) throw new HttpsError('invalid-argument', 'Choose at least one customer.');
    if (ids.length > 500) throw new HttpsError('invalid-argument', 'Pick at most 500 customers, or send to all customers instead.');
    const refs = ids.map((id) => {
      if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(id)) throw new HttpsError('invalid-argument', 'Invalid customer.');
      return db.doc(`customers/${id}`);
    });
    const snaps = await db.getAll(...refs, { fieldMask: cols });
    docs = snaps.filter((s) => s.exists);
  } else if (type === 'branch') {
    if (typeof branch !== 'string' || !branch) throw new HttpsError('invalid-argument', 'Choose a branch.');
    docs = (await db.collection('customers').where('branch', '==', branch).select(...cols).get()).docs;
  } else if (type === 'all') {
    docs = (await db.collection('customers').select(...cols).get()).docs;
  } else {
    throw new HttpsError('invalid-argument', 'Choose who to send to.');
  }
  return docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((c) => c.status !== 'inactive');
}
