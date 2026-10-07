// transactions.html page script
import {
  collection, query, where, orderBy, limit, getDocs, startAfter, getDoc, doc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { mountBottomNav } from '../components/bottom-nav.js';
import { db } from './lib/firebase.js';
import { requireSession } from './lib/session.js';
mountBottomNav('transactions');


const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const customerIdFilter = params.get('customerId');

const subHeader = $('subHeader');
const loadError = $('loadError'), loadErrorMsg = $('loadErrorMsg'), retryBtn = $('retryBtn');
const sumDeposits = $('sumDeposits'), sumWithdrawals = $('sumWithdrawals');
const txList = $('txList'), txCount = $('txCount'), loadMoreBtn = $('loadMoreBtn');
const filterButtons = document.querySelectorAll('.filter-pill');

const PAGE_SIZE = 20;

let currentFilter = 'all';
let lastDoc = null;
let loadedItems = [];
let customerName = null;

function formatGHS(n){ const v=Number(n)||0; return v.toLocaleString('en-GH',{minimumFractionDigits:2,maximumFractionDigits:2}); }
function escapeHtml(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function tsToDate(v){if(!v)return null;if(v.toDate)return v.toDate();if(v instanceof Date)return v;return new Date(v);}

function showError(msg){ loadErrorMsg.textContent = msg || 'Check your connection and retry.'; loadError.classList.remove('hidden'); }
function hideError(){ loadError.classList.add('hidden'); }

async function loadHeaderContext() {
  if (customerIdFilter) {
    try {
      const s = await getDoc(doc(db, 'customers', customerIdFilter));
      if (s.exists()) {
        const c = s.data();
        customerName = c.fullName || 'Customer';
        subHeader.innerHTML = `${escapeHtml(customerName)} <span class="text-stone-300">•</span> <span class="font-mono">${escapeHtml(c.accountNumber || '')}</span>`;
      } else {
        subHeader.textContent = 'All transactions';
      }
    } catch { subHeader.textContent = 'All transactions'; }
  } else {
    subHeader.textContent = 'All transactions';
  }
}

function buildQuery(afterDoc) {
  const clauses = [];
  if (customerIdFilter) clauses.push(where('customerId', '==', customerIdFilter));
  if (currentFilter !== 'all') clauses.push(where('type', '==', currentFilter));
  clauses.push(orderBy('createdAt', 'desc'));
  clauses.push(limit(PAGE_SIZE));
  if (afterDoc) clauses.push(startAfter(afterDoc));
  return query(collection(db, 'transactions'), ...clauses);
}

function renderItem(t) {
  const isDep = t.type === 'deposit';
  const sign = isDep ? '+' : '−';
  const color = isDep ? 'text-[#1B7F4B]' : 'text-[#B93838]';
  const bgIcon = isDep ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-600';
  const icon = isDep ? 'fa-arrow-down-to-line' : 'fa-arrow-up-from-bracket';
  const label = isDep ? 'Deposit' : 'Withdrawal';
  const when = tsToDate(t.createdAt);
  const whenStr = when ? when.toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'}) + ' · ' + when.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'}) : '';
  const nameLine = customerIdFilter ? '' :
    `<p class="text-[12px] font-semibold text-stone-700 truncate">${escapeHtml(t.customerName || t.accountNumber || '—')}</p>`;

  return `
    <div class="p-4 flex items-start gap-3">
      <div class="w-9 h-9 rounded-full ${bgIcon} flex items-center justify-center shrink-0">
        <i class="fa-solid ${icon} text-[12px]"></i>
      </div>
      <div class="min-w-0 flex-1">
        ${nameLine}
        <p class="text-[12.5px] font-bold text-stone-900">${label}</p>
        <p class="text-[11px] text-stone-400 truncate">${whenStr}</p>
        ${t.reference ? `<p class="text-[10.5px] font-mono text-stone-400 mt-0.5">${escapeHtml(t.reference)}</p>` : ''}
      </div>
      <div class="text-right shrink-0">
        <p class="text-[13px] font-bold ${color} whitespace-nowrap">${sign}GH₵${formatGHS(t.amount)}</p>
        <p class="text-[10.5px] text-stone-400 mt-0.5">Bal. GH₵${formatGHS(t.balanceAfter)}</p>
      </div>
    </div>`;
}

function computeSummaries(items) {
  let dep = 0, wd = 0;
  for (const t of items) {
    if (t.type === 'deposit') dep += Number(t.amount) || 0;
    if (t.type === 'withdrawal') wd += Number(t.amount) || 0;
  }
  sumDeposits.textContent = `GH₵${formatGHS(dep)}`;
  sumWithdrawals.textContent = `GH₵${formatGHS(wd)}`;
}

function renderList(items) {
  if (!items.length) {
    txList.innerHTML = `
      <div class="p-10 text-center">
        <i class="fa-solid fa-receipt text-3xl text-stone-300"></i>
        <p class="mt-3 text-sm font-semibold text-stone-700">No transactions found</p>
        <p class="text-xs text-stone-500 mt-1">${currentFilter === 'all' ? 'Transactions will appear here once recorded.' : 'Try a different filter.'}</p>
      </div>`;
    txCount.textContent = '';
    return;
  }
  txList.innerHTML = items.map(renderItem).join('');
  txCount.textContent = `${items.length} loaded`;
}

async function loadPage(reset = true) {
  if (reset) { lastDoc = null; loadedItems = []; }
  hideError();
  if (reset) {
    txList.innerHTML = `
      <div class="p-4 flex items-center justify-between">
        <div class="space-y-2 flex-1">
          <div class="skeleton h-3.5 w-32"></div>
          <div class="skeleton h-2.5 w-20"></div>
        </div>
        <div class="skeleton h-3.5 w-24"></div>
      </div>`;
    sumDeposits.innerHTML = '<span class="skeleton inline-block w-24 h-5 align-middle"></span>';
    sumWithdrawals.innerHTML = '<span class="skeleton inline-block w-24 h-5 align-middle"></span>';
  }

  try {
    const q = buildQuery(lastDoc);
    const snap = await getDocs(q);
    const items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    lastDoc = snap.docs[snap.docs.length - 1] || lastDoc;

    loadedItems = reset ? items : loadedItems.concat(items);
    renderList(loadedItems);
    computeSummaries(loadedItems);

    loadMoreBtn.classList.toggle('hidden', snap.docs.length < PAGE_SIZE);
  } catch (e) {
    console.error('Tx load failed:', e);
    if (String(e?.message || '').toLowerCase().includes('index')) {
      showError('A Firestore index is being built. This takes about 1 minute — retry shortly.');
    } else {
      showError('Could not load transactions. Check your connection and retry.');
    }
    renderList([]);
  }
}

filterButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    filterButtons.forEach((b) => {
      b.className = b === btn
        ? 'filter-pill shrink-0 px-3.5 py-1.5 rounded-full text-[12px] font-semibold bg-[#212121] text-white'
        : 'filter-pill shrink-0 px-3.5 py-1.5 rounded-full text-[12px] font-medium bg-white border border-stone-200 text-stone-600 hover:text-stone-900';
    });
    currentFilter = btn.getAttribute('data-filter');
    loadPage(true);
  });
});

loadMoreBtn.addEventListener('click', () => loadPage(false));
retryBtn.addEventListener('click', () => loadPage(true));

const __session = await requireSession({ permission: 'transactions.view' });
{
  const u = __session.user;
  await loadHeaderContext();
  loadPage(true);
}
