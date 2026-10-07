// statement.html page script
import {
  doc, collection, query, where, orderBy, getDocs, getDoc, Timestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { mountBottomNav } from '../components/bottom-nav.js';
import { db } from './lib/firebase.js';
import { requireSession } from './lib/session.js';
mountBottomNav('customers');

/* ---------- Firebase ---------- */

/* ---------- Config ---------- */
const COMPANY_NAME = 'Area Supa Ventures';
const COMPANY_PHONE = '+233 24 000 0000';   // ← change to real

/* ---------- Refs ---------- */
const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const customerId = params.get('id');
if (!customerId) window.location.replace('customers.html');

const backBtn = $('backBtn'), subHeader = $('subHeader');
const loadError = $('loadError'), loadErrorMsg = $('loadErrorMsg'), retryBtn = $('retryBtn');

const periodPills = document.querySelectorAll('.period-pill');
const customRange = $('customRange');
const fromInput = $('fromInput'), toInput = $('toInput'), applyCustomBtn = $('applyCustom');
const activeRangeEl = $('activeRange');

const custName = $('custName'), custAcct = $('custAcct'), custPhone = $('custPhone');
const periodLine = $('periodLine'), periodMeta = $('periodMeta');
const openingBalance = $('openingBalance'), closingBalance = $('closingBalance');
const sumDeposits = $('sumDeposits'), sumWithdrawals = $('sumWithdrawals'), sumNet = $('sumNet');
const txContainer = $('txContainer');
const generatedAt = $('generatedAt');
const shareBtn = $('shareBtn'), shareBtn2 = $('shareBtn2');
const pdfBtn = $('pdfBtn'), pdfBtn2 = $('pdfBtn2');

const printGeneratedAt = $('printGeneratedAt'), printGeneratedBy = $('printGeneratedBy'), printCollector = $('printCollector');

/* ---------- State ---------- */
let currentUser = null;
let customer = null;
let currentPeriod = 'thismonth';
let range = { start: null, end: null, label: '', code: '' };
let tx = [];

/* ---------- Helpers ---------- */
function formatGHS(n) { const v = Number(n)||0; return v.toLocaleString('en-GH',{minimumFractionDigits:2,maximumFractionDigits:2}); }
function round2(n) { return Math.round(Number(n)*100)/100; }
function escapeHtml(s){ return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function tsToDate(v){ if(!v) return null; if(v.toDate) return v.toDate(); if(v instanceof Date) return v; return new Date(v); }
function ymd(d){ return new Date(d).toISOString().slice(0,10); }
function parseYmdLocal(s){ const [y,m,dd] = s.split('-').map(Number); return new Date(y, m-1, dd); }
function startOfDay(d){ const x = new Date(d); x.setHours(0,0,0,0); return x; }
function endOfDay(d){ const x = new Date(d); x.setHours(23,59,59,999); return x; }
function fmtDateShort(d){ return d.toLocaleDateString('en-GB',{day:'2-digit', month:'short'}); }
function fmtDateFull(d){ return d.toLocaleDateString('en-GB',{day:'2-digit', month:'short', year:'numeric'}); }
function fmtTime(d){ return d.toLocaleTimeString('en-GB',{hour:'2-digit', minute:'2-digit'}); }

/* ---------- Period computation ---------- */
function computeRange(period) {
  const now = new Date();
  switch (period) {
    case 'thismonth': {
      const s = new Date(now.getFullYear(), now.getMonth(), 1);
      return { start: startOfDay(s), end: endOfDay(now),
               label: now.toLocaleDateString('en-GB',{month:'long', year:'numeric'}),
               code: 'thismonth' };
    }
    case 'lastmonth': {
      const s = new Date(now.getFullYear(), now.getMonth()-1, 1);
      const e = new Date(now.getFullYear(), now.getMonth(), 0); // last day of prev month
      return { start: startOfDay(s), end: endOfDay(e),
               label: s.toLocaleDateString('en-GB',{month:'long', year:'numeric'}),
               code: 'lastmonth' };
    }
    case 'last3': {
      const s = new Date(now.getFullYear(), now.getMonth()-2, 1);
      return { start: startOfDay(s), end: endOfDay(now),
               label: `${fmtDateFull(s)} – ${fmtDateFull(now)}`,
               code: 'last3' };
    }
    case 'year': {
      const s = new Date(now.getFullYear(), 0, 1);
      return { start: startOfDay(s), end: endOfDay(now),
               label: `Year ${now.getFullYear()}`,
               code: 'year' };
    }
    case 'all':
      return { start: null, end: null,
               label: 'All time',
               code: 'all' };
    case 'custom': {
      const s = fromInput.value ? startOfDay(parseYmdLocal(fromInput.value)) : startOfDay(new Date());
      const e = toInput.value ? endOfDay(parseYmdLocal(toInput.value)) : endOfDay(new Date());
      return { start: s, end: e,
               label: `${fmtDateFull(s)} – ${fmtDateFull(e)}`,
               code: 'custom' };
    }
    default:
      return computeRange('thismonth');
  }
}

function setActivePill() {
  periodPills.forEach(b => {
    const active = b.getAttribute('data-period') === currentPeriod;
    b.className = 'period-pill shrink-0 px-3.5 py-2 rounded-full text-[12px] font-semibold ' + (
      active
        ? 'bg-[#212121] text-white shadow'
        : 'bg-white border border-stone-200 text-stone-600 hover:text-stone-900'
    );
  });
  customRange.classList.toggle('hidden', currentPeriod !== 'custom');
}

/* ---------- Error handling ---------- */
function showError(msg) { loadErrorMsg.textContent = msg || 'Check your connection and retry.'; loadError.classList.remove('hidden'); }
function hideError() { loadError.classList.add('hidden'); }

/* ---------- Load + render ---------- */
async function loadStatement() {
  hideError();

  range = computeRange(currentPeriod);
  activeRangeEl.innerHTML = `<i class="fa-regular fa-clock mr-1"></i> ${escapeHtml(range.label)}`;

  // Reset to skeletons
  [custName, custAcct, custPhone, periodLine, periodMeta, openingBalance, closingBalance,
   sumDeposits, sumWithdrawals, sumNet].forEach(el => {
    el.innerHTML = '<span class="skeleton inline-block w-32 h-4 align-middle"></span>';
  });
  txContainer.innerHTML = `
    <div class="space-y-3">
      <div class="skeleton h-4 w-full"></div>
      <div class="skeleton h-4 w-5/6"></div>
      <div class="skeleton h-4 w-4/6"></div>
      <div class="skeleton h-4 w-full"></div>
      <div class="skeleton h-4 w-3/6"></div>
    </div>`;

  try {
    // 1. Customer doc
    const cSnap = await getDoc(doc(db, 'customers', customerId));
    if (!cSnap.exists()) {
      showError('Customer not found.');
      return;
    }
    customer = { id: cSnap.id, ...cSnap.data() };

    // 2. Transactions in range
    let txQuery;
    if (range.code === 'all' || !range.start || !range.end) {
      txQuery = query(
        collection(db, 'transactions'),
        where('customerId', '==', customerId),
        orderBy('createdAt', 'asc')
      );
    } else {
      txQuery = query(
        collection(db, 'transactions'),
        where('customerId', '==', customerId),
        where('createdAt', '>=', Timestamp.fromDate(range.start)),
        where('createdAt', '<=', Timestamp.fromDate(range.end)),
        orderBy('createdAt', 'asc')
      );
    }
    const txSnap = await getDocs(txQuery);
    tx = txSnap.docs.map(d => ({ id: d.id, ...d.data() }));

    renderStatement();
  } catch (e) {
    console.error('Statement load failed:', e);
    if (String(e?.message || '').toLowerCase().includes('index')) {
      showError('A Firestore index is being built for this query. Retry in ~1 minute.');
    } else if (!navigator.onLine) {
      showError('You’re offline. Reconnect to load the statement.');
    } else {
      showError('Could not load statement. Check your connection and retry.');
    }
  }
}

function renderStatement() {
  // Customer
  const name = customer.fullName || 'Customer';
  custName.textContent = name;
  custAcct.textContent = customer.accountNumber || '—';
  custPhone.textContent = customer.phone || '—';

  // Period
  periodLine.textContent = range.label;
  periodMeta.textContent = range.code === 'all'
    ? `All transactions`
    : `${range.start ? fmtDateFull(range.start) : ''} – ${range.end ? fmtDateFull(range.end) : ''}`;

  // Opening / closing balance
  let opening = 0, closing = 0;
  let dep = 0, wd = 0;

  if (tx.length === 0) {
    opening = Number(customer.balance) || 0;
    closing = opening;
  } else {
    const first = tx[0];
    const firstNet = first.type === 'deposit' ? (Number(first.amount) || 0) : -(Number(first.amount) || 0);
    opening = round2((Number(first.balanceAfter) || 0) - firstNet);

    const last = tx[tx.length - 1];
    closing = Number(last.balanceAfter) || 0;

    for (const t of tx) {
      const amt = Number(t.amount) || 0;
      if (t.type === 'deposit') dep += amt;
      else wd += amt;
    }
  }

  openingBalance.textContent = `GH₵${formatGHS(opening)}`;
  closingBalance.textContent = `GH₵${formatGHS(closing)}`;
  sumDeposits.textContent = `+GH₵${formatGHS(dep)}`;
  sumWithdrawals.textContent = `−GH₵${formatGHS(wd)}`;
  const net = dep - wd;
  sumNet.textContent = (net >= 0 ? '+' : '−') + `GH₵${formatGHS(Math.abs(net))}`;

  // Transactions table
  if (tx.length === 0) {
    txContainer.innerHTML = `
      <div class="py-10 text-center">
        <i class="fa-solid fa-receipt text-3xl text-stone-300"></i>
        <p class="mt-3 text-[13px] font-semibold text-stone-700">No transactions in this period</p>
        <p class="text-[11.5px] text-stone-500 mt-1">Try a different date range.</p>
      </div>`;
  } else {
    txContainer.innerHTML = `
      <table class="w-full print-table" style="border-collapse: collapse; font-size: 12.5px;">
        <thead>
          <tr style="border-bottom: 1px solid #e5e3de;">
            <th class="text-left py-2.5 font-semibold text-stone-500 text-[10.5px] uppercase tracking-wider">Date</th>
            <th class="text-left py-2.5 font-semibold text-stone-500 text-[10.5px] uppercase tracking-wider">Description</th>
            <th class="text-right py-2.5 font-semibold text-stone-500 text-[10.5px] uppercase tracking-wider">Amount</th>
            <th class="text-right py-2.5 font-semibold text-stone-500 text-[10.5px] uppercase tracking-wider whitespace-nowrap">Balance</th>
          </tr>
        </thead>
        <tbody>
          ${tx.map((t, i) => {
            const d = tsToDate(t.createdAt);
            const dateStr = d ? fmtDateShort(d) : '—';
            const timeStr = d ? fmtTime(d) : '';
            const isDep = t.type === 'deposit';
            const sign = isDep ? '+' : '−';
            const amountColor = isDep ? 'text-emerald-600' : 'text-red-600';
            const desc = isDep ? 'Deposit' : 'Withdrawal';
            const method = t.paymentMethod === 'momo' ? ' · MoMo' : '';
            const ref = t.reference ? `<span class="block text-[10px] text-stone-400 font-mono mt-0.5">${escapeHtml(t.reference)}</span>` : '';
            const borderStyle = i < tx.length - 1 ? 'border-bottom: 1px solid #f1efea;' : '';
            return `
              <tr style="${borderStyle}">
                <td class="py-2.5 align-top whitespace-nowrap" style="color: #333;">
                  <span class="font-semibold text-stone-800">${dateStr}</span>
                  <span class="block text-[10.5px] text-stone-400 mt-0.5">${timeStr}</span>
                </td>
                <td class="py-2.5 align-top">
                  <span class="font-medium text-stone-800">${desc}${method}</span>
                  ${ref}
                </td>
                <td class="py-2.5 align-top text-right whitespace-nowrap font-bold ${amountColor}" style="color: inherit;">
                  ${sign}GH₵${formatGHS(t.amount)}
                </td>
                <td class="py-2.5 align-top text-right whitespace-nowrap font-semibold text-stone-700 tabular-nums">
                  GH₵${formatGHS(t.balanceAfter)}
                </td>
              </tr>`;
          }).join('')}
        </tbody>
      </table>`;
  }

  // Footer
  const now = new Date();
  const collectorLabel = currentUser?.email || currentUser?.phoneNumber || '—';
  generatedAt.textContent = `${fmtDateFull(now)} · ${fmtTime(now)}`;
  printGeneratedAt.textContent = `${fmtDateFull(now)} · ${fmtTime(now)}`;
  printGeneratedBy.textContent = collectorLabel;
  printCollector.textContent = collectorLabel;
}

/* ---------- Period tab wiring ---------- */
periodPills.forEach(btn => {
  btn.addEventListener('click', () => {
    currentPeriod = btn.getAttribute('data-period');
    setActivePill();
    if (currentPeriod === 'custom') {
      if (!fromInput.value) {
        const s = new Date(); s.setDate(1);
        fromInput.value = ymd(s);
      }
      if (!toInput.value) toInput.value = ymd(new Date());
      fromInput.focus();
    } else {
      loadStatement();
    }
  });
});

applyCustomBtn.addEventListener('click', () => {
  if (!fromInput.value || !toInput.value) {
    showError('Please pick both a start and end date.');
    return;
  }
  if (new Date(fromInput.value) > new Date(toInput.value)) {
    showError('Start date must be before end date.');
    return;
  }
  loadStatement();
});

/* ---------- Share ---------- */
function buildShareText() {
  const lines = [];
  lines.push(`${COMPANY_NAME}`);
  lines.push(`Savings Statement`);
  lines.push('');
  lines.push(`Customer: ${customer.fullName || '—'}`);
  lines.push(`Account:  ${customer.accountNumber || '—'}`);
  lines.push(`Period:   ${range.label}`);
  lines.push('');
  lines.push(`Opening balance:  GH₵${openingBalance.textContent.replace('GH₵','')}`);
  lines.push(`Total deposits:   ${sumDeposits.textContent}`);
  lines.push(`Total withdrawals:${sumWithdrawals.textContent}`);
  lines.push(`Closing balance:  GH₵${closingBalance.textContent.replace('GH₵','')}`);
  lines.push('');
  lines.push(`Generated ${fmtDateFull(new Date())} at ${fmtTime(new Date())}`);
  lines.push(`Questions? Call ${COMPANY_PHONE}`);
  return lines.join('\n');
}

async function shareStatement() {
  if (!customer) return;
  const text = buildShareText();

  // Try native share first (mobile)
  if (navigator.share) {
    try {
      await navigator.share({
        title: `Statement — ${customer.fullName || ''}`,
        text
      });
      return;
    } catch (e) {
      if (e?.name === 'AbortError') return; // user cancelled
      // fall through to WhatsApp link
    }
  }

  // Fallback: WhatsApp web link with prefilled text
  const url = `https://wa.me/?text=${encodeURIComponent(text)}`;
  window.open(url, '_blank', 'noopener');
}

shareBtn.addEventListener('click', shareStatement);
shareBtn2.addEventListener('click', shareStatement);

/* ---------- PDF (uses browser print → Save as PDF) ---------- */
function downloadPDF() {
  if (!customer) return;
  // Print styles handle the A4 layout; browser offers "Save as PDF" in the print dialog.
  window.print();
}

pdfBtn.addEventListener('click', downloadPDF);
pdfBtn2.addEventListener('click', downloadPDF);

retryBtn.addEventListener('click', loadStatement);

/* ---------- Init ---------- */
const __session = await requireSession({ permission: 'transactions.view' });
{
  const u = __session.user;
  currentUser = u;

  // Back button destination: if we know the customer, go to customer profile.
  // Else fall back to customers list.
  if (customerId) backBtn.href = `customer.html?id=${encodeURIComponent(customerId)}`;

  // Honour URL params if provided
  const urlFrom = params.get('from');
  const urlTo = params.get('to');
  const urlPeriod = params.get('period');
  if (urlFrom || urlTo) {
    currentPeriod = 'custom';
    if (urlFrom) fromInput.value = urlFrom;
    if (urlTo) toInput.value = urlTo;
  } else if (urlPeriod && ['thismonth','lastmonth','last3','year','all'].includes(urlPeriod)) {
    currentPeriod = urlPeriod;
  }
  setActivePill();

  await loadStatement();
}
