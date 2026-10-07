import { onCall } from 'firebase-functions/v2/https';
import { AggregateField } from 'firebase-admin/firestore';
import {
  db, FieldValue, HttpsError, CALLABLE_OPTS,
  requireStaff, requireRecentLogin, audit, bad, str, toPesewas, todayAccra, ghanaPhone
} from './common.js';
import { ACCOUNT_START, formatAccountNumber, nameKeywords } from './customers.js';

export const saveGeneralSettings = onCall(CALLABLE_OPTS, async (request) => {
  const actor = await requireStaff(request, 'settings.manage');
  const d = request.data || {};
  const businessName = str(d.businessName, { label: 'Business name', max: 60, required: true, min: 2 });

  if (!Array.isArray(d.branches) || d.branches.length > 50) throw bad('Branches must be a list of at most 50.');
  const branches = [...new Set(d.branches.map((b) => str(b, { label: 'Branch name', max: 60 })).filter(Boolean))];

  const idle = Number(d.idleTimeoutMinutes);
  if (!Number.isInteger(idle) || idle < 2 || idle > 240) throw bad('Auto sign-out must be between 2 and 240 minutes.');

  await db.doc('settings/general').set({
    businessName, branches, idleTimeoutMinutes: idle,
    updatedAt: FieldValue.serverTimestamp(), updatedBy: actor.uid
  }, { merge: true });
  await audit(actor, 'settings.general', { targetType: 'settings', targetId: 'general', summary: 'Updated business settings' });
  return { ok: true };
});

/**
 * Brings records created by the earlier version of the app up to date:
 * fills bio-data fields used for sorting/search, and recomputes dashboard
 * totals. With `renumber`, customers are renumbered ASV-10001, ASV-10002, ...
 * in order of registration; the old number is kept as legacyAccountNumber
 * and stays searchable.
 */
export const upgradeData = onCall({ ...CALLABLE_OPTS, timeoutSeconds: 540, memory: '512MiB' }, async (request) => {
  const actor = await requireStaff(request, 'settings.manage');
  if (actor.role !== 'owner') throw new HttpsError('permission-denied', 'Only the owner can run the data upgrade.');
  requireRecentLogin(request);
  const renumber = request.data?.renumber === true;

  const customers = (await db.collection('customers').get()).docs
    .map((d) => ({ ref: d.ref, id: d.id, ...d.data() }))
    .sort((a, b) => {
      const ta = a.createdAt?.toMillis?.() ?? 0;
      const tb = b.createdAt?.toMillis?.() ?? 0;
      return ta - tb || a.id.localeCompare(b.id);
    });

  const counterSnap = await db.doc('counters/customerAccounts').get();
  let seq = Math.max(ACCOUNT_START, Number(counterSnap.data()?.lastNumber) || 0);
  const newFormat = /^ASV-\d{5,}$/;
  const renumbered = new Map(); // customerId -> new account number

  let updated = 0;
  let writer = db.batch();
  let pending = 0;
  const flush = async () => { if (pending) { await writer.commit(); writer = db.batch(); pending = 0; } };

  let balanceP = 0;
  for (const c of customers) {
    balanceP += toPesewas(c.balance);
    const u = {};
    const parts = String(c.fullName || '').trim().split(/\s+/).filter(Boolean);
    if (!c.firstName && parts.length) u.firstName = parts[0];
    if (!c.lastName && parts.length > 1) u.lastName = parts.slice(1).join(' ');
    if (!c.fullNameLower && c.fullName) u.fullNameLower = c.fullName.toLowerCase();
    if (!Array.isArray(c.nameKeywords)) u.nameKeywords = nameKeywords(c.fullName);
    if (!c.registrationDate) {
      const created = c.createdAt?.toDate?.();
      u.registrationDate = created ? todayAccra(created) : todayAccra();
    }
    if (c.branch === undefined) u.branch = '';
    if (c.tel2 === undefined) u.tel2 = '';
    if (c.smsOptOut === undefined) u.smsOptOut = false;
    if (c.balance === undefined) u.balance = 0;
    const local = safePhone(c.phone);
    if (local && c.phoneNormalized !== local) u.phoneNormalized = local;

    // Already in the new ASV-10001 series (created by this version)?
    const inNewSeries = typeof c.accountSeq === 'number' && c.accountSeq > ACCOUNT_START &&
      c.accountSeq < 100000 && c.accountNumber === formatAccountNumber(c.accountSeq);
    if (renumber && !inNewSeries) {
      seq += 1;
      u.legacyAccountNumber = c.accountNumber || null;
      u.accountNumber = formatAccountNumber(seq);
      u.accountSeq = seq;
      renumbered.set(c.id, u.accountNumber);
    } else if (typeof c.accountSeq !== 'number') {
      const n = Number(String(c.accountNumber || '').replace(/\D/g, ''));
      u.accountSeq = Number.isFinite(n) ? n : 0;
    }

    if (Object.keys(u).length) {
      writer.update(c.ref, u);
      pending++;
      updated++;
      if (pending >= 400) await flush();
    }
  }
  await flush();

  if (renumber) {
    await db.doc('counters/customerAccounts').set({ lastNumber: seq, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    // Keep transaction history showing the current customer ID.
    for (const [customerId, acct] of renumbered) {
      const txs = await db.collection('transactions').where('customerId', '==', customerId).select().get();
      for (const t of txs.docs) {
        writer.update(t.ref, { accountNumber: acct });
        pending++;
        if (pending >= 400) await flush();
      }
    }
    await flush();
  }

  // Recompute dashboard totals from the source of truth.
  const [dep, wd] = await Promise.all([
    db.collection('transactions').where('type', '==', 'deposit').aggregate({ s: AggregateField.sum('amount') }).get(),
    db.collection('transactions').where('type', '==', 'withdrawal').aggregate({ s: AggregateField.sum('amount') }).get()
  ]);
  await db.doc('stats/global').set({
    customers: customers.length,
    depositsPesewas: toPesewas(dep.data().s),
    withdrawalsPesewas: toPesewas(wd.data().s),
    totalBalancePesewas: balanceP,
    recomputedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp()
  });

  await audit(actor, 'data.upgrade', {
    targetType: 'system', summary: `Data upgrade: ${updated} customer record(s) updated${renumber ? `, ${renumbered.size} renumbered` : ''}`
  });
  return { customers: customers.length, updated, renumbered: renumbered.size };
});

function safePhone(raw) {
  try { return ghanaPhone(raw, { label: 'Phone' }); } catch { return ''; }
}
