// withdraw.html page script
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db } from './lib/firebase.js';
import { requireSession } from './lib/session.js';
import { call, newRequestId } from './lib/api.js';
import { avatarHtml, toast } from './lib/ui.js';

// One id per submission: if the network drops and the collector taps again,
// the server recognises the repeat and does not record the money twice.
let requestId = newRequestId();
let session = null;

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const customerId = params.get('customerId');
if (!customerId) window.location.replace('customers.html');

const backBtn = $('backBtn'), subHeader = $('subHeader');
const loadError = $('loadError'), loadErrorMsg = $('loadErrorMsg'), loadErrorTitle = $('loadErrorTitle'), retryBtn = $('retryBtn');
const avatar = $('avatar'), custName = $('custName'), custMeta = $('custMeta'), custBal = $('custBal');
const amountEl = $('amount'), amountError = $('amountError'), balanceHint = $('balanceHint');
const referenceSection = $('referenceSection'), referenceEl = $('reference');
const notesEl = $('notes');
const submitBtn = $('submitBtn'), submitLabel = $('submitLabel'), submitSpinner = $('submitSpinner');
const submitError = $('submitError'), submitErrorMsg = $('submitErrorMsg');

const confirmDialog = $('confirmDialog'), confirmAmount = $('confirmAmount'), confirmName = $('confirmName');
const cancelConfirm = $('cancelConfirm'), confirmWithdraw = $('confirmWithdraw');

const receipt = $('receipt');
const receiptAmount = $('receiptAmount'), receiptName = $('receiptName'), receiptAcct = $('receiptAcct');
const receiptBalance = $('receiptBalance'), receiptRef = $('receiptRef'), receiptDate = $('receiptDate');
const anotherBtn = $('anotherBtn'), doneBtn = $('doneBtn');

let customer = null;
let paymentMethod = 'cash';

function formatGHS(n){ const v=Number(n)||0; return v.toLocaleString('en-GH',{minimumFractionDigits:2,maximumFractionDigits:2}); }
function escapeHtml(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function initialsFrom(name){if(!name)return'??';const p=String(name).trim().split(/\s+/);return((p[0]?.[0]||'')+(p[1]?.[0]||'')).toUpperCase()||'??';}
function round2(n){ return Math.round(Number(n) * 100) / 100; }

function showLoadError(msg, title){ loadErrorTitle.textContent = title || 'Couldn’t load customer'; loadErrorMsg.textContent = msg || 'Check your connection and retry.'; loadError.classList.remove('hidden'); }
function hideLoadError(){ loadError.classList.add('hidden'); }
function showSubmitError(msg){ submitErrorMsg.textContent = msg; submitError.classList.remove('hidden'); }
function hideSubmitError(){ submitError.classList.add('hidden'); }

function setPmButtonStyles() {
  document.querySelectorAll('.pm-btn').forEach(b => {
    const active = b.getAttribute('data-pm') === paymentMethod;
    b.className = 'pm-btn py-3 px-4 rounded-xl border-2 text-[13px] font-semibold transition-all flex items-center justify-center gap-2 '
      + (active
        ? 'border-brand-gold bg-brand-gold/10 text-stone-900'
        : 'border-stone-200 bg-white text-stone-500 hover:border-stone-300');
  });
  referenceSection.classList.toggle('hidden', paymentMethod !== 'momo');
}

document.querySelectorAll('.pm-btn').forEach(b => {
  b.addEventListener('click', () => { paymentMethod = b.getAttribute('data-pm'); setPmButtonStyles(); });
});

document.querySelectorAll('.quick-amt').forEach(b => {
  b.addEventListener('click', () => {
    const v = b.getAttribute('data-fill');
    if (v === 'full' && customer) {
      amountEl.value = String(Number(customer.balance) || 0);
    } else {
      amountEl.value = v;
    }
    onAmountChange();
  });
});

function sanitizeAmount(v) {
  let s = String(v).replace(/[^\d.]/g, '');
  const parts = s.split('.');
  if (parts.length > 2) s = parts[0] + '.' + parts.slice(1).join('');
  const p = s.split('.');
  if (p[1] && p[1].length > 2) s = p[0] + '.' + p[1].slice(0, 2);
  return s;
}
function currentAmount(){ const v = parseFloat(amountEl.value); return isFinite(v) && v > 0 ? round2(v) : 0; }

function onAmountChange() {
  amountEl.value = sanitizeAmount(amountEl.value);
  const amt = currentAmount();
  const bal = Number(customer?.balance) || 0;

  amountError.classList.toggle('hidden', amt > 0 || amountEl.value === '');
  const exceeds = amt > bal;
  balanceHint.classList.toggle('hidden', !exceeds);

  submitBtn.disabled = amt <= 0 || exceeds || !customer;
  submitLabel.textContent = amt > 0 ? `Withdraw GH₵${formatGHS(amt)}` : 'Withdraw';
  hideSubmitError();
}

amountEl.addEventListener('input', onAmountChange);

async function loadCustomer() {
  hideLoadError();
  try {
    const snap = await getDoc(doc(db, 'customers', customerId));
    if (!snap.exists()) { showLoadError('Customer not found.', 'Customer missing'); return; }
    customer = { id: snap.id, ...snap.data() };
    renderCustomer();
    onAmountChange();
  } catch (e) {
    console.error(e);
    showLoadError('Could not reach the server. Check your connection and retry.');
  }
}

function renderCustomer() {
  const name = customer.fullName || 'Customer';
  const acct = customer.accountNumber || '—';
  avatar.innerHTML = avatarHtml(customer, { size: 44, cls: 'bg-brand-gold/20 text-brand-gold', text: 'text-[13px]' });
  avatar.className = 'shrink-0';
  custName.textContent = name;
  custMeta.textContent = acct;
  custBal.textContent = `GH₵${formatGHS(customer.balance)}`;
  subHeader.textContent = `${name} • ${acct}`;
  backBtn.href = `customer.html?id=${encodeURIComponent(customer.id)}`;
}

function openConfirm() {
  const amt = currentAmount();
  if (!amt || !customer) return;
  const bal = Number(customer.balance) || 0;
  if (amt > bal) { balanceHint.classList.remove('hidden'); return; }
  confirmAmount.textContent = `GH₵${formatGHS(amt)}`;
  confirmName.textContent = customer.fullName || 'Customer';
  confirmDialog.classList.remove('hidden');
}

async function submitWithdrawal() {
  const amount = currentAmount();
  if (!amount || !customer) return;

  confirmDialog.classList.add('hidden');
  hideSubmitError();
  submitBtn.disabled = true;
  submitSpinner.classList.remove('hidden');
  submitLabel.textContent = 'Processing…';

  const reference = paymentMethod === 'momo' ? (referenceEl.value.trim() || null) : null;
  const notes = notesEl.value.trim() || null;
  const sendSms = document.getElementById('sendSms')?.checked !== false;

  try {
    const res = await call('recordTransaction', {
      requestId, type: 'withdrawal', customerId: customer.id, amount,
      paymentMethod, reference, notes, sendSms
    });
    requestId = newRequestId();
    showReceipt({
      txId: res.txId, newBalance: res.newBalance, amount, reference,
      customerName: customer.fullName, accountNumber: customer.accountNumber
    });
    if (res.sms?.status === 'failed') toast('Saved. The SMS alert could not be sent: ' + (res.sms.error || ''), { type: 'error', ms: 6000 });
    else if (res.sms && ['sent', 'scheduled'].includes(res.sms.status)) toast('SMS alert sent to the customer.', { type: 'success' });
  } catch (err) {
    console.error('withdrawal failed:', err);
    if (err.code === 'not-found') showSubmitError('Customer no longer exists.');
    else {
      showSubmitError(err.message || 'Could not record the withdrawal. Please try again.');
      if (err.code === 'failed-precondition') loadCustomer();
    }
  } finally {
    submitBtn.disabled = false;
    submitSpinner.classList.add('hidden');
    onAmountChange();
  }
}

function showReceipt({ txId, newBalance, amount, reference, customerName, accountNumber }) {
  receiptAmount.textContent = `GH₵${formatGHS(amount)}`;
  receiptName.textContent = customerName || '—';
  receiptAcct.textContent = accountNumber || '—';
  receiptBalance.textContent = `GH₵${formatGHS(newBalance)}`;
  receiptRef.textContent = reference || txId.slice(0, 10).toUpperCase();
  receiptDate.textContent = new Date().toLocaleString('en-GB', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' });
  receipt.classList.remove('hidden');
}

submitBtn.addEventListener('click', openConfirm);
confirmWithdraw.addEventListener('click', submitWithdrawal);
cancelConfirm.addEventListener('click', () => confirmDialog.classList.add('hidden'));
retryBtn.addEventListener('click', loadCustomer);

doneBtn.addEventListener('click', () => {
  window.location.replace(`customer.html?id=${encodeURIComponent(customerId)}`);
});

anotherBtn.addEventListener('click', () => {
  receipt.classList.add('hidden');
  amountEl.value = '';
  referenceEl.value = '';
  notesEl.value = '';
  onAmountChange();
  amountEl.focus();
  loadCustomer();
});

session = await requireSession({ permission: 'transactions.withdraw' });
  setPmButtonStyles();
  loadCustomer();
