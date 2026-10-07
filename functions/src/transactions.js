import { onCall } from 'firebase-functions/v2/https';
import {
  db, FieldValue, HttpsError, logger, CALLABLE_OPTS,
  requireStaff, audit, str, text, oneOf, docId, requestId, amountGhs,
  toPesewas, fromPesewas, formatGhs, todayAccra, prettyDateTime, loadSettings
} from './common.js';
import { PROFJERO_API_KEY } from './profjero.js';
import { mergeSmsSettings, sendToCustomers } from './sms-service.js';

const METHODS = ['cash', 'momo'];
const METHOD_LABEL = { cash: 'Cash', momo: 'Mobile Money' };

/**
 * Records a deposit or withdrawal. This is the only way money moves: the
 * browser cannot write balances or transactions directly (see firestore.rules).
 *
 * `requestId` is generated once per form submission and becomes the
 * transaction's document id, so a retry after a dropped connection returns the
 * original transaction instead of recording it twice.
 */
export const recordTransaction = onCall(
  { ...CALLABLE_OPTS, secrets: [PROFJERO_API_KEY] },
  async (request) => {
    const d = request.data || {};
    const type = oneOf(d.type, ['deposit', 'withdrawal'], { label: 'Transaction type', required: true });
    const actor = await requireStaff(request, type === 'deposit' ? 'transactions.deposit' : 'transactions.withdraw');

    const customerId = docId(d.customerId, 'Customer');
    const txId = requestId(d.requestId);
    const amount = amountGhs(d.amount);
    const paymentMethod = oneOf(d.paymentMethod || 'cash', METHODS, { label: 'Payment method' }) || 'cash';
    const reference = paymentMethod === 'momo' ? str(d.reference, { label: 'Reference', max: 60 }) : '';
    const notes = text(d.notes, { label: 'Notes', max: 300 });

    const customerRef = db.doc(`customers/${customerId}`);
    const txRef = db.doc(`transactions/${txId}`);
    const day = todayAccra();
    const amountP = toPesewas(amount);

    const result = await db.runTransaction(async (tx) => {
      const [cSnap, existing] = await Promise.all([tx.get(customerRef), tx.get(txRef)]);

      if (existing.exists) {
        const e = existing.data();
        if (e.customerId !== customerId || e.type !== type || toPesewas(e.amount) !== amountP) {
          throw new HttpsError('already-exists', 'This request was already used for a different transaction. Refresh and try again.');
        }
        return { replay: true, customer: cSnap.data() || {}, newBalance: e.balanceAfter };
      }
      if (!cSnap.exists) throw new HttpsError('not-found', 'This customer no longer exists.');

      const c = cSnap.data();
      if (c.status === 'inactive') {
        throw new HttpsError('failed-precondition', 'This customer account is inactive. Reactivate it before recording transactions.');
      }

      const balanceP = toPesewas(c.balance);
      let newBalanceP;
      if (type === 'deposit') {
        newBalanceP = balanceP + amountP;
      } else {
        if (amountP > balanceP) {
          throw new HttpsError('failed-precondition',
            `Insufficient balance. ${c.fullName || 'The customer'} has GH₵${formatGhs(fromPesewas(balanceP))}.`);
        }
        newBalanceP = balanceP - amountP;
      }
      const newBalance = fromPesewas(newBalanceP);

      tx.create(txRef, {
        customerId,
        accountNumber: c.accountNumber || null,
        customerName: c.fullName || null,
        branch: c.branch || null,
        type,
        amount,
        paymentMethod,
        reference: reference || null,
        notes: notes || null,
        balanceBefore: fromPesewas(balanceP),
        balanceAfter: newBalance,
        status: 'completed',
        day,
        createdAt: FieldValue.serverTimestamp(),
        createdBy: actor.uid,
        createdByName: actor.name
      });

      const totalsField = type === 'deposit' ? 'totalDeposits' : 'totalWithdrawals';
      tx.update(customerRef, {
        balance: newBalance,
        [totalsField]: fromPesewas(toPesewas(c[totalsField]) + amountP),
        lastTransactionAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp()
      });

      const signed = type === 'deposit' ? amountP : -amountP;
      tx.set(db.doc('stats/global'), {
        [type === 'deposit' ? 'depositsPesewas' : 'withdrawalsPesewas']: FieldValue.increment(amountP),
        totalBalancePesewas: FieldValue.increment(signed),
        updatedAt: FieldValue.serverTimestamp()
      }, { merge: true });
      tx.set(db.doc(`statsDaily/${day}`), {
        day,
        [type === 'deposit' ? 'depositsPesewas' : 'withdrawalsPesewas']: FieldValue.increment(amountP),
        [type === 'deposit' ? 'depositCount' : 'withdrawalCount']: FieldValue.increment(1),
        updatedAt: FieldValue.serverTimestamp()
      }, { merge: true });

      tx.set(db.collection('notifications').doc(), {
        userId: actor.uid,
        type,
        title: type === 'deposit' ? 'Deposit completed' : 'Withdrawal completed',
        body: `GH₵${formatGhs(amount)} ${type === 'deposit' ? 'deposited for' : 'withdrawn by'} ${c.fullName || 'customer'}. New balance GH₵${formatGhs(newBalance)}.`,
        iconType: type,
        read: false,
        createdAt: FieldValue.serverTimestamp(),
        customerId,
        customerName: c.fullName || null,
        accountNumber: c.accountNumber || null,
        amount,
        transactionId: txId
      });

      return { replay: false, customer: { id: customerId, ...c, balance: newBalance }, newBalance };
    });

    if (result.replay) {
      return { txId, newBalance: result.newBalance, replay: true, sms: null };
    }

    if (type === 'withdrawal' && amount >= 5000) {
      await audit(actor, 'transaction.large_withdrawal', {
        targetType: 'transaction', targetId: txId,
        summary: `Large withdrawal of GH₵${formatGhs(amount)} for ${result.customer.fullName} (${result.customer.accountNumber})`
      });
    }

    // SMS alert. A failure here is reported but never reverses the transaction.
    let sms = { status: 'off' };
    if (d.sendSms !== false) {
      try {
        const { general, sms: smsRaw } = await loadSettings();
        const s = mergeSmsSettings(smsRaw);
        const auto = s.autoSms[type];
        if (auto?.enabled && s.senderId) {
          sms = await sendToCustomers({
            customers: [result.customer],
            template: auto.template,
            senderId: s.senderId,
            businessName: general.businessName,
            keyBase: `txn-${txId}`,
            kind: type,
            actor,
            extraFor: () => ({
              amount: formatGhs(amount),
              transaction_type: type,
              transaction_date: prettyDateTime(),
              transaction_ref: txId.slice(0, 10).toUpperCase(),
              payment_method: METHOD_LABEL[paymentMethod]
            })
          });
        }
      } catch (e) {
        logger.warn('Transaction SMS failed', { txId, error: e.message });
        sms = { status: 'failed', error: e.message };
      }
      await txRef.update({ smsStatus: sms.status || 'off' }).catch(() => {});
    }

    return { txId, newBalance: result.newBalance, replay: false, sms };
  }
);
