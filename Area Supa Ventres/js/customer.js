// customer.html page script
import {
  collection, query, where, orderBy, limit, getDocs, getDoc, doc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db } from './lib/firebase.js';
import { requireSession } from './lib/session.js';
import { call } from './lib/api.js';
import { avatarHtml, confirmDialog, prettyIsoDate, toast, photoUrl } from './lib/ui.js';
import { ID_TYPE_LABEL, GENDER_LABEL, MARITAL_LABEL } from './lib/customer-form.js';
import { mountBottomNav } from '../components/bottom-nav.js';
mountBottomNav('customers');

/* ---------- Refs ---------- */
const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const customerId = params.get('id');
const isWelcome = params.get('welcome') === '1';

if (!customerId) window.location.replace('customers.html');

const loadError = $('loadError'), loadErrorMsg = $('loadErrorMsg'), retryBtn = $('retryBtn');
const welcomeBanner = $('welcomeBanner');
const headerName = $('headerName'), headerAcct = $('headerAcct');
const customerName = $('customerName'), customerAcct = $('customerAcct');
const customerStatus = $('customerStatus'), customerPhone = $('customerPhone');
const balanceEl = $('balance');
const depositBtn = $('depositBtn'), withdrawBtn = $('withdrawBtn');
const statementBtn = $('statementBtn'), callBtn = $('callBtn'), copyAcctBtn2 = $('copyAcctBtn2');
const copyAcctLabel = $('copyAcctLabel');
const totalDepositsEl = $('totalDeposits'), totalWithdrawalsEl = $('totalWithdrawals'), registeredAtEl = $('registeredAt');
const bioList = $('bioList');
const notesRow = $('notesRow'), detailNotes = $('detailNotes');
const recentTxList = $('recentTxList'), viewAllTx = $('viewAllTx');
const copyAcctBtn = $('copyAcctBtn'), editBtn = $('editBtn');
const smsBtn = $('smsBtn'), deleteBtn = $('deleteBtn');

/* ---------- Helpers ---------- */
function formatGHS(n) { const v = Number(n) || 0; return v.toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function escapeHtml(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function tsToDate(v) { if (!v) return null; if (v.toDate) return v.toDate(); if (v instanceof Date) return v; return new Date(v); }
function dash(v) { return v && String(v).trim() ? escapeHtml(v) : '<span class="text-stone-400 font-normal">—</span>'; }

function showError(msg) { loadErrorMsg.textContent = msg || 'Check your connection and retry.'; loadError.classList.remove('hidden'); }
function hideError() { loadError.classList.add('hidden'); }

/* ---------- Copy account number ---------- */
let copyResetTimer = null;

async function copyAccountNumber(showLabel = false) {
  const acct = currentCustomer?.accountNumber;
  if (!acct) return;
  try {
    await navigator.clipboard.writeText(acct);
  } catch {
    // Fallback for older browsers
    const ta = document.createElement('textarea');
    ta.value = acct; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); } catch {}
    ta.remove();
  }

  // Visual confirmation
  if (showLabel && copyAcctLabel) {
    copyAcctLabel.textContent = 'Copied';
    clearTimeout(copyResetTimer);
    copyResetTimer = setTimeout(() => { copyAcctLabel.textContent = 'Copy'; }, 1500);
  } else {
    const old = copyAcctBtn.innerHTML;
    copyAcctBtn.innerHTML = '<i class="fa-solid fa-check text-[14px] text-emerald-600"></i>';
    setTimeout(() => { copyAcctBtn.innerHTML = old; }, 1400);
  }
}

copyAcctBtn.addEventListener('click', () => copyAccountNumber(false));
copyAcctBtn2?.addEventListener('click', () => copyAccountNumber(true));

/* ---------- Edit (placeholder) ---------- */
editBtn?.addEventListener('click', () => {
  if (!customerId) return;
  window.location.href = `edit-customer.html?id=${encodeURIComponent(customerId)}`;
});

/* ---------- Load ---------- */
let currentCustomer = null;

async function load() {
  hideError();
  try {
    const snap = await getDoc(doc(db, 'customers', customerId));
    if (!snap.exists()) {
      showError('This customer could not be found. They may have been removed.');
      return;
    }
    currentCustomer = { id: snap.id, ...snap.data() };
    renderCustomer(currentCustomer);
    await loadRecentTransactions();
  } catch (e) {
    console.error('Customer load failed:', e);
    if (!navigator.onLine) {
      showError('You’re offline. Reconnect to load this customer.');
    } else {
      showError('Could not reach the server. Check your connection and retry.');
    }
  }
}

function renderCustomer(c) {
  const name = c.fullName || 'Unnamed';
  const acct = c.accountNumber || '—';
  const status = c.status || 'active';

  // Header
  headerName.textContent = name;
  headerAcct.textContent = acct;

  // Profile card
  document.getElementById('avatar').outerHTML = `<div id="avatar">${avatarHtml(c, { size: 56, cls: 'bg-brand-gold text-[#1A1A18]', text: 'text-lg' })}</div>`;
  if (c.photoUrl) {
    const img = document.querySelector('#avatar img');
    img?.classList.add('cursor-zoom-in');
    img?.addEventListener('click', () => window.open(photoUrl(c.photoUrl, 600), '_blank', 'noopener'));
  }
  customerName.textContent = name;
  customerAcct.textContent = acct;
  customerStatus.textContent = status;
  customerStatus.className = status === 'active'
    ? 'text-emerald-400 font-medium text-[11px] uppercase tracking-wide'
    : 'text-stone-400 font-medium text-[11px] uppercase tracking-wide';
  customerPhone.textContent = [c.phone, c.tel2].filter(Boolean).join(' · ') || '—';

  // Balance
  balanceEl.innerHTML = `GH₵${formatGHS(c.balance)}`;

  // Primary links
  if (depositBtn) depositBtn.href = `deposit.html?customerId=${encodeURIComponent(c.id)}`;
  if (withdrawBtn) withdrawBtn.href = `withdraw.html?customerId=${encodeURIComponent(c.id)}`;
  if (smsBtn) smsBtn.href = `sms.html?customerId=${encodeURIComponent(c.id)}`;

  // Secondary links
  statementBtn.href = `statement.html?id=${encodeURIComponent(c.id)}`;
  callBtn.href = c.phone ? `tel:${String(c.phone).replace(/[^\d+]/g, '')}` : '#';
  if (!c.phone) {
    callBtn.classList.add('opacity-40', 'pointer-events-none');
    callBtn.setAttribute('aria-disabled', 'true');
  }

  // View all transactions
  viewAllTx.href = `transactions.html?customerId=${encodeURIComponent(c.id)}`;

  // Summary
  totalDepositsEl.textContent = `GH₵${formatGHS(c.totalDeposits)}`;
  totalWithdrawalsEl.textContent = `GH₵${formatGHS(c.totalWithdrawals)}`;
  const created = tsToDate(c.createdAt);
  registeredAtEl.textContent = c.registrationDate
    ? prettyIsoDate(c.registrationDate)
    : (created ? created.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');

  // Bio data
  const age = c.dateOfBirth ? Math.floor((Date.now() - new Date(c.dateOfBirth + 'T00:00:00Z')) / 31557600000) : null;
  const rows = [
    ['Customer ID', c.accountNumber + (c.legacyAccountNumber ? ` (formerly ${c.legacyAccountNumber})` : '')],
    ['Branch', c.branch],
    ['Date of registration', c.registrationDate ? prettyIsoDate(c.registrationDate) : ''],
    ['Tel 1', c.phone],
    ['Tel 2', c.tel2],
    ['Email', c.email],
    ['Gender', GENDER_LABEL[c.gender]],
    ['Date of birth', c.dateOfBirth ? `${prettyIsoDate(c.dateOfBirth)}${age !== null ? ` (${age} yrs)` : ''}` : ''],
    ['Marital status', MARITAL_LABEL[c.maritalStatus]],
    ['Occupation', c.occupation],
    ['Nationality', c.nationality],
    ['Hometown', c.hometown],
    ['Residential address', c.residentialAddress],
    ['Digital address', c.digitalAddress],
    ['ID', c.idType ? `${ID_TYPE_LABEL[c.idType] || c.idType}${c.idNumber ? ' · ' + c.idNumber : ''}` : c.idNumber],
    ['Next of kin', [c.nextOfKin, c.nextOfKinRelationship ? `(${c.nextOfKinRelationship})` : ''].filter(Boolean).join(' ')],
    ['Next of kin phone', c.nextOfKinPhone],
    ['SMS messages', c.smsOptOut ? 'Opted out' : 'Allowed'],
    ['Registered by', c.createdByName]
  ];
  bioList.innerHTML = rows.map(([k, v]) => `
    <div class="flex items-start justify-between gap-3 px-4 py-3">
      <dt class="text-[12.5px] text-stone-500 shrink-0">${escapeHtml(k)}</dt>
      <dd class="text-[12.5px] font-semibold text-stone-900 text-right break-words min-w-0">${dash(v)}</dd>
    </div>`).join('');

  if (c.notes && String(c.notes).trim()) {
    notesRow.classList.remove('hidden');
    detailNotes.textContent = c.notes;
  } else {
    notesRow.classList.add('hidden');
  }

  // Welcome banner
  if (isWelcome) welcomeBanner.classList.remove('hidden');
}

async function loadRecentTransactions() {
  try {
    const q = query(
      collection(db, 'transactions'),
      where('customerId', '==', customerId),
      orderBy('createdAt', 'desc'),
      limit(5)
    );
    const snap = await getDocs(q);
    const items = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    if (!items.length) {
      recentTxList.innerHTML = `
        <div class="p-8 text-center">
          <i class="fa-solid fa-receipt text-2xl text-stone-300"></i>
          <p class="mt-2 text-sm font-semibold text-stone-700">No transactions yet</p>
          <p class="text-xs text-stone-500 mt-0.5">Record their first deposit to see it here.</p>
        </div>`;
      return;
    }

    recentTxList.innerHTML = items.map(t => {
      const isDep = t.type === 'deposit';
      const sign = isDep ? '+' : '−';
      const color = isDep ? 'text-[#1B7F4B]' : 'text-[#B93838]';
      const label = isDep ? 'Deposit' : 'Withdrawal';
      const when = tsToDate(t.createdAt);
      const whenStr = when
        ? when.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) +
          ' · ' +
          when.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
        : '';
      return `
        <div class="p-3.5 flex items-center justify-between hover:bg-stone-50/70 transition-colors">
          <div class="min-w-0 flex-1 pr-3">
            <p class="text-[13px] font-bold text-stone-900">${label}</p>
            <p class="text-[11px] text-stone-400 truncate">${whenStr}</p>
          </div>
          <div class="text-right">
            <p class="text-[13px] font-bold ${color} whitespace-nowrap">${sign}GH₵${formatGHS(t.amount)}</p>
            <p class="text-[10.5px] text-stone-400 mt-0.5">Bal. GH₵${formatGHS(t.balanceAfter)}</p>
          </div>
        </div>`;
    }).join('');
  } catch (e) {
    console.error('Recent tx load failed:', e);
    recentTxList.innerHTML = `
      <div class="p-6 text-center">
        <p class="text-sm text-stone-500">Transactions unavailable</p>
        <p class="text-xs text-stone-400 mt-0.5">Check your connection.</p>
      </div>`;
  }
}

/* ---------- Delete (permanent) ---------- */
deleteBtn?.addEventListener('click', async () => {
  const c = currentCustomer;
  if (!c) return;
  const balance = Number(c.balance) || 0;
  const balanceWarning = balance !== 0
    ? `<div class="rounded-xl border border-red-300 bg-red-50 p-3 text-red-800 font-semibold">
         This customer still has GH₵${formatGHS(balance)} in their account. Pay it out (withdrawal) before deleting,
         or the money will no longer be recorded anywhere.
         <label class="mt-2 flex items-start gap-2 font-normal"><input id="ackBalance" type="checkbox" class="mt-0.5 rounded border-red-400 text-red-700 focus:ring-0" />
         I confirm this balance has been settled with the customer.</label>
       </div>`
    : '';
  const html = `
    <ul class="list-disc pl-5 space-y-1 text-[12.5px] text-stone-700">
      <li>The customer’s profile, bio data and photo are erased.</li>
      <li><strong>All of their deposits and withdrawals are erased</strong>; statements can no longer be printed.</li>
      <li>Dashboard and report totals will drop by their amounts.</li>
      <li>This <strong>cannot be undone</strong>. Only a summary is kept in the audit log.</li>
    </ul>
    <div class="mt-3">${balanceWarning}</div>
    <label class="block mt-3 text-[12px] font-medium text-stone-600">Reason for deleting</label>
    <input id="deleteReason" type="text" maxlength="300" placeholder="e.g. Duplicate registration"
           class="mt-1.5 w-full px-3.5 py-2.5 rounded-xl border border-stone-300 text-sm outline-none focus:ring-1 focus:ring-red-600 focus:border-red-600" />`;

  let ack = false;
  let reason = '';
  const capture = () => {
    ack = document.getElementById('ackBalance')?.checked === true;
    reason = document.getElementById('deleteReason')?.value.trim() || '';
  };
  document.addEventListener('input', capture, true);
  document.addEventListener('change', capture, true);
  const ok = await confirmDialog({
    title: `Delete ${c.fullName}?`,
    message: 'You are about to permanently delete this customer.',
    html,
    confirmLabel: 'Delete permanently',
    danger: true,
    requireText: c.accountNumber
  });
  document.removeEventListener('input', capture, true);
  document.removeEventListener('change', capture, true);
  if (!ok) return;
  if (reason.length < 5) { toast('Please give a reason (at least 5 characters).', { type: 'error' }); return; }
  if (balance !== 0 && !ack) { toast('Confirm the balance has been settled to continue.', { type: 'error' }); return; }

  deleteBtn.disabled = true;
  deleteBtn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Deleting…';
  try {
    const res = await call('deleteCustomer', {
      id: c.id, confirmAccountNumber: c.accountNumber, acknowledgeBalance: ack, reason
    });
    toast(`${c.fullName} deleted (${res.deletedTransactions} transactions removed).`, { type: 'success' });
    setTimeout(() => window.location.replace('customers.html'), 900);
  } catch (e) {
    if (e.code !== 'cancelled') toast(e.message, { type: 'error', ms: 6000 });
    deleteBtn.disabled = false;
    deleteBtn.innerHTML = '<i class="fa-solid fa-trash-can text-[11px]"></i> Delete customer permanently';
  }
});

/* ---------- Retry ---------- */
retryBtn.addEventListener('click', load);

/* ---------- Session ---------- */
await requireSession({ permission: 'customers.view' });
load();
