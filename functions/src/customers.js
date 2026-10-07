import { onCall } from 'firebase-functions/v2/https';
import {
  db, FieldValue, HttpsError, logger, CALLABLE_OPTS,
  requireStaff, requireRecentLogin, audit, bad,
  str, text, oneOf, ghanaPhone, isoDate, email, docId, todayAccra, loadSettings, toPesewas, fromPesewas
} from './common.js';
import {
  CLOUDINARY_API_SECRET, uploadSignature, validatePhoto, destroyPhoto
} from './cloudinary.js';
import { PROFJERO_API_KEY } from './profjero.js';
import { mergeSmsSettings, sendToCustomers } from './sms-service.js';
import { hasPermission } from './roles.js';

// First customer gets ASV-10001, then ASV-10002, ...
export const ACCOUNT_PREFIX = 'ASV-';
export const ACCOUNT_START = 10000;

const GENDERS = ['male', 'female'];
const MARITAL = ['single', 'married', 'divorced', 'widowed', 'other'];
const ID_TYPES = ['ghana_card', 'voter_id', 'passport', 'drivers_license', 'nhis', 'other'];

export function formatAccountNumber(seq) {
  return ACCOUNT_PREFIX + String(seq);
}

// Lowercase prefixes of every name part, so "boa" finds "Ama Boateng".
export function nameKeywords(fullName) {
  const out = new Set();
  for (const part of String(fullName || '').toLowerCase().split(/[\s-]+/).filter(Boolean)) {
    const clean = part.replace(/[^a-z0-9']/g, '');
    for (let i = 1; i <= Math.min(clean.length, 15); i++) out.add(clean.slice(0, i));
  }
  return [...out].slice(0, 120);
}

/**
 * Validates customer fields from the browser. With `partial`, only the keys
 * present are validated and returned (for edits).
 */
function cleanCustomer(input, { partial }) {
  if (!input || typeof input !== 'object') throw bad('Missing customer details.');
  const has = (k) => !partial || Object.prototype.hasOwnProperty.call(input, k);
  const out = {};

  if (has('firstName')) out.firstName = str(input.firstName, { label: 'First name', max: 60, required: true, min: 2 });
  if (has('middleName')) out.middleName = str(input.middleName, { label: 'Middle name', max: 60 });
  if (has('lastName')) out.lastName = str(input.lastName, { label: 'Surname', max: 60, required: true, min: 2 });
  if (has('gender')) out.gender = oneOf(input.gender, GENDERS, { label: 'Gender' });
  if (has('dateOfBirth')) out.dateOfBirth = isoDate(input.dateOfBirth, { label: 'Date of birth', notFuture: true });
  if (has('maritalStatus')) out.maritalStatus = oneOf(input.maritalStatus, MARITAL, { label: 'Marital status' });
  if (has('occupation')) out.occupation = str(input.occupation, { label: 'Occupation', max: 80 });
  if (has('nationality')) out.nationality = str(input.nationality, { label: 'Nationality', max: 60 });
  if (has('hometown')) out.hometown = str(input.hometown, { label: 'Hometown', max: 80 });
  if (has('residentialAddress')) out.residentialAddress = str(input.residentialAddress, { label: 'Residential address', max: 200 });
  if (has('digitalAddress')) {
    out.digitalAddress = str(input.digitalAddress, { label: 'Digital address', max: 20 }).toUpperCase();
    if (out.digitalAddress && !/^[A-Z]{2}-?\d{3,4}-?\d{3,5}$/.test(out.digitalAddress)) {
      throw bad('Digital address should look like GA-123-4567.');
    }
  }
  if (has('idType')) out.idType = oneOf(input.idType, ID_TYPES, { label: 'ID type' });
  if (has('idNumber')) out.idNumber = str(input.idNumber, { label: 'ID number', max: 40 }).toUpperCase();
  if (has('email')) out.email = email(input.email);
  if (has('phone')) out.phone = ghanaPhone(input.phone, { label: 'Tel 1', required: true });
  if (has('tel2')) out.tel2 = ghanaPhone(input.tel2, { label: 'Tel 2' });
  if (has('branch')) out.branch = str(input.branch, { label: 'Branch', max: 60 });
  if (has('registrationDate')) {
    out.registrationDate = isoDate(input.registrationDate, { label: 'Date of registration', notFuture: true }) || (partial ? '' : todayAccra());
    if (partial && !out.registrationDate) throw bad('Date of registration is required.');
  }
  if (has('nextOfKin')) out.nextOfKin = str(input.nextOfKin, { label: 'Next of kin', max: 100, required: true, min: 3 });
  if (has('nextOfKinRelationship')) out.nextOfKinRelationship = str(input.nextOfKinRelationship, { label: 'Relationship', max: 40 });
  if (has('nextOfKinPhone')) out.nextOfKinPhone = ghanaPhone(input.nextOfKinPhone, { label: 'Next of kin phone', required: true });
  if (has('notes')) out.notes = text(input.notes, { label: 'Notes', max: 1000 });
  if (has('smsOptOut')) out.smsOptOut = input.smsOptOut === true;
  if (partial && has('status')) out.status = oneOf(input.status, ['active', 'inactive'], { label: 'Status', required: true });

  if (has('photoUrl') || has('photoPublicId')) {
    const photo = validatePhoto(input.photoUrl || null, input.photoPublicId || null);
    if (!photo) throw bad('That photo upload is not valid. Please upload it again.');
    Object.assign(out, photo);
  }
  if (out.tel2 && out.phone && out.tel2 === out.phone) out.tel2 = '';
  return out;
}

// Fields derived from others, kept in step for search and sorting.
function derived(c) {
  const fullName = [c.firstName, c.middleName, c.lastName].filter(Boolean).join(' ');
  return {
    fullName,
    fullNameLower: fullName.toLowerCase(),
    nameKeywords: nameKeywords(fullName),
    phoneNormalized: c.phone || '',
    tel2Normalized: c.tel2 || '',
    nextOfKinPhoneNormalized: c.nextOfKinPhone || '',
    dobMonthDay: c.dateOfBirth ? c.dateOfBirth.slice(5) : ''
  };
}

async function assertBranch(branch) {
  if (!branch) return;
  const { general } = await loadSettings();
  const branches = Array.isArray(general.branches) ? general.branches : [];
  if (branches.length && !branches.includes(branch)) throw bad('Choose a branch from the list.');
}

export const getPhotoUploadSignature = onCall(
  { ...CALLABLE_OPTS, secrets: [CLOUDINARY_API_SECRET] },
  async (request) => {
    const actor = await requireStaff(request);
    if (!hasPermission(actor.role, 'customers.create') && !hasPermission(actor.role, 'customers.edit')) {
      throw new HttpsError('permission-denied', 'Your role cannot upload customer photos.');
    }
    return uploadSignature();
  }
);


export const createCustomer = onCall(
  { ...CALLABLE_OPTS, secrets: [CLOUDINARY_API_SECRET, PROFJERO_API_KEY] },
  async (request) => {
    const actor = await requireStaff(request, 'customers.create');
    const input = cleanCustomer(request.data?.customer, { partial: false });
    await assertBranch(input.branch);

    // Warn about duplicates unless the collector confirmed it is a different person.
    if (request.data?.allowDuplicatePhone !== true) {
      const dup = await db.collection('customers').where('phoneNormalized', '==', input.phone).limit(1).get();
      if (!dup.empty) {
        const d = dup.docs[0].data();
        throw new HttpsError('already-exists',
          `${d.fullName || 'Another customer'} (${d.accountNumber || ''}) already uses this phone number.`,
          { reason: 'duplicate-phone', customerId: dup.docs[0].id });
      }
    }

    const counterRef = db.doc('counters/customerAccounts');
    const customerRef = db.collection('customers').doc();
    const statsRef = db.doc('stats/global');
    const now = FieldValue.serverTimestamp();

    const customer = {
      ...input,
      ...derived(input),
      status: 'active',
      smsOptOut: input.smsOptOut === true,
      balance: 0,
      totalDeposits: 0,
      totalWithdrawals: 0,
      createdAt: now,
      updatedAt: now,
      createdBy: actor.uid,
      createdByName: actor.name
    };

    const accountNumber = await db.runTransaction(async (tx) => {
      const counter = await tx.get(counterRef);
      const last = counter.exists ? Number(counter.data().lastNumber) || 0 : 0;
      const seq = Math.max(ACCOUNT_START, last) + 1;
      const acct = formatAccountNumber(seq);
      tx.set(counterRef, { lastNumber: seq, updatedAt: now }, { merge: true });
      tx.create(customerRef, { ...customer, accountNumber: acct, accountSeq: seq });
      tx.set(statsRef, { customers: FieldValue.increment(1), updatedAt: now }, { merge: true });
      return acct;
    });

    await audit(actor, 'customer.create', {
      targetType: 'customer', targetId: customerRef.id,
      summary: `Registered ${customer.fullName} (${accountNumber})`
    });

    // Optional welcome SMS. A failure never undoes the registration.
    let sms = null;
    try {
      const { general, sms: smsRaw } = await loadSettings();
      const smsSettings = mergeSmsSettings(smsRaw);
      if (smsSettings.autoSms.welcome.enabled && smsSettings.senderId && request.data?.sendWelcomeSms !== false) {
        sms = await sendToCustomers({
          customers: [{ id: customerRef.id, ...customer, accountNumber }],
          template: smsSettings.autoSms.welcome.template,
          senderId: smsSettings.senderId,
          businessName: general.businessName,
          keyBase: `welcome-${customerRef.id}`,
          kind: 'welcome',
          actor
        });
      }
    } catch (e) {
      logger.warn('Welcome SMS failed', { customerId: customerRef.id, error: e.message });
      sms = { status: 'failed', error: e.message };
    }

    return { id: customerRef.id, accountNumber, sms };
  }
);

export const updateCustomer = onCall(
  { ...CALLABLE_OPTS, secrets: [CLOUDINARY_API_SECRET] },
  async (request) => {
    const actor = await requireStaff(request, 'customers.edit');
    const id = docId(request.data?.id, 'Customer');
    const changes = cleanCustomer(request.data?.customer, { partial: true });
    if (!Object.keys(changes).length) throw bad('Nothing to update.');
    if ('branch' in changes) await assertBranch(changes.branch);

    const ref = db.doc(`customers/${id}`);
    const before = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw new HttpsError('not-found', 'This customer no longer exists.');
      const prev = snap.data();
      const merged = { ...prev, ...changes };
      // Older records only had fullName; split it once so derived fields work.
      if (!merged.firstName && prev.fullName) {
        const parts = prev.fullName.trim().split(/\s+/);
        merged.firstName = parts[0];
        merged.lastName = merged.lastName || parts.slice(1).join(' ');
      }
      tx.update(ref, {
        ...changes,
        ...derived(merged),
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: actor.uid,
        updatedByName: actor.name
      });
      return prev;
    });

    // Remove the old photo from Cloudinary when it was replaced or removed.
    if ('photoPublicId' in changes && before.photoPublicId && before.photoPublicId !== changes.photoPublicId) {
      await destroyPhoto(before.photoPublicId);
    }

    const changed = Object.keys(changes).filter((k) => JSON.stringify(before[k] ?? '') !== JSON.stringify(changes[k] ?? ''));
    await audit(actor, 'customer.update', {
      targetType: 'customer', targetId: id,
      summary: `Edited ${before.fullName || id} (${before.accountNumber || ''})`,
      details: { fields: changed }
    });
    return { ok: true };
  }
);

/**
 * Permanently deletes a customer, their transaction history and their photo.
 * Requires: customers.delete, a password confirmation in the last 10 minutes,
 * the account number typed back, and an explicit acknowledgement when the
 * customer still has money in their account.
 */
export const deleteCustomer = onCall(
  { ...CALLABLE_OPTS, secrets: [CLOUDINARY_API_SECRET], timeoutSeconds: 300 },
  async (request) => {
    const actor = await requireStaff(request, 'customers.delete');
    requireRecentLogin(request);
    const id = docId(request.data?.id, 'Customer');
    const reason = str(request.data?.reason, { label: 'Reason', max: 300, required: true, min: 5 });

    const ref = db.doc(`customers/${id}`);
    const snap = await ref.get();
    if (!snap.exists) throw new HttpsError('not-found', 'This customer was already deleted.');
    const c = snap.data();

    if (String(request.data?.confirmAccountNumber || '').trim().toUpperCase() !== String(c.accountNumber).toUpperCase()) {
      throw bad(`Type the customer ID ${c.accountNumber} exactly to confirm.`);
    }
    const balance = Number(c.balance) || 0;
    if (balance !== 0 && request.data?.acknowledgeBalance !== true) {
      throw new HttpsError('failed-precondition',
        `This customer still has GH₵${balance.toFixed(2)}. Confirm that the balance has been settled before deleting.`,
        { reason: 'balance-not-zero' });
    }

    const txQuery = db.collection('transactions').where('customerId', '==', id);
    const txCount = (await txQuery.count().get()).data().count;

    // Record what is being destroyed before destroying it.
    await audit(actor, 'customer.delete', {
      targetType: 'customer', targetId: id,
      summary: `Permanently deleted ${c.fullName} (${c.accountNumber}) with ${txCount} transaction(s), balance GH₵${balance.toFixed(2)}`,
      details: {
        reason,
        accountNumber: c.accountNumber || null,
        fullName: c.fullName || null,
        phone: c.phone || null,
        branch: c.branch || null,
        balance,
        totalDeposits: Number(c.totalDeposits) || 0,
        totalWithdrawals: Number(c.totalWithdrawals) || 0,
        transactionCount: txCount
      }
    });

    // Delete the history in pages so very old customers do not time out.
    for (;;) {
      const page = await txQuery.limit(400).get();
      if (page.empty) break;
      const batch = db.batch();
      page.docs.forEach((d) => batch.delete(d.ref));
      await batch.commit();
    }

    await db.runTransaction(async (tx) => {
      const statsRef = db.doc('stats/global');
      tx.delete(ref);
      tx.set(statsRef, {
        customers: FieldValue.increment(-1),
        totalBalancePesewas: FieldValue.increment(-toPesewas(balance)),
        depositsPesewas: FieldValue.increment(-toPesewas(c.totalDeposits)),
        withdrawalsPesewas: FieldValue.increment(-toPesewas(c.totalWithdrawals)),
        updatedAt: FieldValue.serverTimestamp()
      }, { merge: true });
    });

    await destroyPhoto(c.photoPublicId);
    return { ok: true, deletedTransactions: txCount, balance: fromPesewas(toPesewas(balance)) };
  }
);
