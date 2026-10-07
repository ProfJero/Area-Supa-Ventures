// customers.html page script
// Lists every customer, alphabetically by default, a page at a time. The sort
// order and branch filter are remembered on this device.
import {
  collection, query, where, orderBy, limit, startAfter, getDocs, getCountFromServer
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db } from './lib/firebase.js';
import { requireSession } from './lib/session.js';
import { $, formatGHS, escapeHtml, avatarHtml, debounce } from './lib/ui.js';
import { searchCustomers } from './lib/customer-search.js';
import { mountBottomNav } from '../components/bottom-nav.js';

mountBottomNav('customers');

const PAGE_SIZE = 30;
const SORTS = {
  name_asc:  { field: 'fullNameLower',    dir: 'asc',  label: 'A → Z' },
  name_desc: { field: 'fullNameLower',    dir: 'desc', label: 'Z → A' },
  acct_asc:  { field: 'accountSeq',       dir: 'asc',  label: 'Customer ID' },
  acct_desc: { field: 'accountSeq',       dir: 'desc', label: 'Customer ID' },
  reg_desc:  { field: 'registrationDate', dir: 'desc', label: 'Newest' },
  reg_asc:   { field: 'registrationDate', dir: 'asc',  label: 'Oldest' },
  bal_desc:  { field: 'balance',          dir: 'desc', label: 'Highest balance' },
  bal_asc:   { field: 'balance',          dir: 'asc',  label: 'Lowest balance' }
};
const PREFS_KEY = 'asv.customers.prefs.v2';

const searchInput = $('searchInput');
const clearSearch = $('clearSearch');
const sortSelect = $('sortSelect');
const branchSelect = $('branchSelect');
const resultsList = $('resultsList');
const resultsCount = $('resultsCount');
const loadMoreWrap = $('loadMoreWrap');
const loadMoreBtn = $('loadMoreBtn');
const loadError = $('loadError');
const loadErrorMsg = $('loadErrorMsg');

const params = new URLSearchParams(location.search);
const pick = ['deposit', 'withdraw'].includes(params.get('pick')) ? params.get('pick') : null;

function readPrefs() {
  try { return JSON.parse(localStorage.getItem(PREFS_KEY) || '{}'); } catch { return {}; }
}
function savePrefs() {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify({ sort: sortSelect.value, branch: branchSelect.value })); } catch { /* ignore */ }
}

function showError(msg) {
  loadErrorMsg.textContent = msg || 'Check your connection and retry.';
  loadError.classList.remove('hidden');
}
function hideError() { loadError.classList.add('hidden'); }

function rowHref(c) {
  if (pick === 'deposit') return `deposit.html?customerId=${encodeURIComponent(c.id)}`;
  if (pick === 'withdraw') return `withdraw.html?customerId=${encodeURIComponent(c.id)}`;
  return `customer.html?id=${encodeURIComponent(c.id)}`;
}

function rowHtml(c) {
  const inactive = c.status === 'inactive';
  const meta = [c.accountNumber || '—', c.branch].filter(Boolean).map(escapeHtml).join(' · ');
  return `
    <a href="${rowHref(c)}" class="block p-4 hover:bg-stone-50/70 transition-colors">
      <div class="flex items-center gap-3">
        ${avatarHtml(c, { size: 40 })}
        <div class="min-w-0 flex-1">
          <p class="text-[13.5px] font-bold text-stone-900 truncate">${escapeHtml(c.fullName || 'Unnamed')}
            ${inactive ? '<span class="ml-1 align-middle text-[9.5px] font-semibold uppercase tracking-wide text-stone-400 border border-stone-200 rounded px-1">Inactive</span>' : ''}</p>
          <p class="text-[11px] font-mono text-stone-500 tracking-tight truncate">${meta}</p>
        </div>
        <div class="text-right shrink-0">
          <p class="text-[13px] font-bold text-[#1B7F4B]">GH₵${formatGHS(c.balance)}</p>
          <p class="text-[10.5px] text-stone-400 mt-0.5">Balance</p>
        </div>
        <i class="fa-solid fa-chevron-right text-stone-300 text-[12px] ml-1"></i>
      </div>
    </a>`;
}

function emptyHtml(searching) {
  return searching
    ? `<div class="p-10 text-center">
         <i class="fa-solid fa-magnifying-glass text-3xl text-stone-300"></i>
         <p class="mt-3 text-sm font-semibold text-stone-700">No matches found</p>
         <p class="text-xs text-stone-500 mt-1">Check the spelling, or try a customer ID or phone number.</p>
       </div>`
    : `<div class="p-10 text-center">
         <i class="fa-solid fa-users text-3xl text-stone-300"></i>
         <p class="mt-3 text-sm font-semibold text-stone-700">No customers yet</p>
         <p class="text-xs text-stone-500 mt-1">Registered customers will be listed here.</p>
       </div>`;
}

/* ------------------------------ Browse ------------------------------ */

let cursor = null;
let exhausted = false;
let loading = false;
let generation = 0; // ignores results from an outdated sort/filter

function baseClauses() {
  const out = [];
  if (branchSelect.value) out.push(where('branch', '==', branchSelect.value));
  return out;
}

async function loadPage(reset) {
  if (loading && !reset) return;
  if (!reset && exhausted) return;
  const gen = reset ? ++generation : generation;
  loading = true;
  hideError();
  if (reset) {
    cursor = null;
    exhausted = false;
    loadMoreWrap.classList.add('hidden');
  }
  const sort = SORTS[sortSelect.value] || SORTS.name_asc;
  const clauses = [...baseClauses(), orderBy(sort.field, sort.dir)];
  if (cursor) clauses.push(startAfter(cursor));
  clauses.push(limit(PAGE_SIZE));
  try {
    const snap = await getDocs(query(collection(db, 'customers'), ...clauses));
    if (gen !== generation) return;
    const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    cursor = snap.docs[snap.docs.length - 1] || cursor;
    exhausted = snap.docs.length < PAGE_SIZE;
    if (reset) resultsList.innerHTML = items.length ? items.map(rowHtml).join('') : emptyHtml(false);
    else resultsList.insertAdjacentHTML('beforeend', items.map(rowHtml).join(''));
    loadMoreWrap.classList.toggle('hidden', exhausted);
  } catch (e) {
    console.error('Customer list failed', e);
    if (gen === generation) {
      showError(navigator.onLine ? 'Could not load customers. Retry in a moment.' : 'You’re offline. Reconnect to load customers.');
      if (reset) resultsList.innerHTML = '';
    }
  } finally {
    if (gen === generation) loading = false;
  }
}

// Total count, and a hint when older records are missing the sort field.
async function updateCount() {
  const gen = generation;
  try {
    const sort = SORTS[sortSelect.value] || SORTS.name_asc;
    const base = query(collection(db, 'customers'), ...baseClauses());
    const sorted = query(collection(db, 'customers'), ...baseClauses(), orderBy(sort.field, sort.dir));
    const [all, inSort] = await Promise.all([getCountFromServer(base), getCountFromServer(sorted)]);
    if (gen !== generation) return;
    const total = all.data().count;
    const shown = inSort.data().count;
    resultsCount.textContent = `${total.toLocaleString('en-GH')} customer${total === 1 ? '' : 's'}`;
    if (shown < total) {
      resultsCount.textContent += ` · ${total - shown} need the data upgrade (Settings) to appear in this order`;
    }
  } catch {
    resultsCount.textContent = '';
  }
}

function refresh() {
  savePrefs();
  if (searchInput.value.trim()) { runSearch(); return; }
  loadPage(true);
  updateCount();
}

/* ------------------------------ Search ------------------------------ */

let searchGen = 0;
async function runSearch() {
  const q = searchInput.value.trim();
  clearSearch.classList.toggle('hidden', !q);
  if (!q) { refresh(); return; }
  if (q.length < 2) return;
  const gen = ++searchGen;
  ++generation; // stop any paging in flight
  loadMoreWrap.classList.add('hidden');
  exhausted = true;
  resultsList.innerHTML = '<div class="p-4"><div class="skeleton h-3.5 w-40"></div></div>';
  try {
    hideError();
    const items = await searchCustomers(q, { branch: branchSelect.value });
    if (gen !== searchGen) return;
    resultsCount.textContent = `${items.length} result${items.length === 1 ? '' : 's'}`;
    resultsList.innerHTML = items.length ? items.map(rowHtml).join('') : emptyHtml(true);
  } catch (e) {
    console.error('Search failed', e);
    if (gen === searchGen) showError('Search failed. Check your connection and retry.');
  }
}

/* ------------------------------ Wiring ------------------------------ */

searchInput.addEventListener('input', debounce(runSearch, 300));
clearSearch.addEventListener('click', () => { searchInput.value = ''; runSearch(); searchInput.focus(); });
sortSelect.addEventListener('change', refresh);
branchSelect.addEventListener('change', refresh);
loadMoreBtn.addEventListener('click', () => loadPage(false));
$('retryBtn').addEventListener('click', refresh);

// Load the next page automatically when the end of the list scrolls into view.
if ('IntersectionObserver' in window) {
  new IntersectionObserver((entries) => {
    if (entries.some((e) => e.isIntersecting) && !exhausted && !loading && cursor && !searchInput.value.trim()) loadPage(false);
  }, { rootMargin: '400px' }).observe($('sentinel'));
}

const session = await requireSession({ permission: 'customers.view' });

const branches = session.settings.branches || [];
if (branches.length) {
  branchSelect.insertAdjacentHTML('beforeend', branches.map((b) => `<option value="${escapeHtml(b)}">${escapeHtml(b)}</option>`).join(''));
  $('branchWrap').classList.remove('hidden');
}
const prefs = readPrefs();
if (prefs.sort && SORTS[prefs.sort]) sortSelect.value = prefs.sort;
if (prefs.branch && branches.includes(prefs.branch)) branchSelect.value = prefs.branch;

if (pick) {
  $('pickText').textContent = pick === 'deposit'
    ? 'Choose the customer to record a deposit for.'
    : 'Choose the customer who is withdrawing.';
  $('pickBanner').classList.remove('hidden');
}

refresh();
