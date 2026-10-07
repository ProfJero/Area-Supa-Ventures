// dashboard.html page script
import {
  collection, query, where, orderBy, limit, getDocs, getDoc, doc, Timestamp,
  getCountFromServer, getAggregateFromServer, sum
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db } from './lib/firebase.js';
import { requireSession, logout } from './lib/session.js';
import { call } from './lib/api.js';
import { subscribeUnreadCount } from '../components/notifications.js';
import { mountBottomNav } from '../components/bottom-nav.js';

mountBottomNav('home');

const bellBadge = document.getElementById('bellBadge');
subscribeUnreadCount((count) => {
  if (count > 0) {
    bellBadge.textContent = count > 99 ? '99+' : String(count);
    bellBadge.classList.remove('hidden');
  } else {
    bellBadge.classList.add('hidden');
  }
});

/* ---------- Refs ---------- */
const $ = (id) => document.getElementById(id);

const greetingText          = $('greetingText');
const greetingWave          = $('greetingWave');
const todayDateText         = $('todayDateText');
const todayDepositsAmount   = $('todayDepositsAmount');
const todayDepositsSub      = $('todayDepositsSub');
const todayWithdrawalsAmount= $('todayWithdrawalsAmount');
const todayWithdrawalsSub   = $('todayWithdrawalsSub');
const totalCustomersEl      = $('totalCustomers');
const recentTxEl            = $('recentTx');
const totalDepositsEl       = $('totalDeposits');
const totalWithdrawalsEl    = $('totalWithdrawals');
const netSavingsEl          = $('netSavings');
const lastUpdatedEl         = $('lastUpdated');
const syncStatusEl          = $('syncStatus');

const loadError             = $('loadError');
const loadErrorMsg          = $('loadErrorMsg');
const retryBtn              = $('retryBtn');
const refreshBtn            = $('refreshBtn');
const logoutBtn             = $('logoutBtn');

/* ---------- Helpers ---------- */
function formatGHS(n) {
  const v = Number(n) || 0;
  return v.toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function tsToDate(v) {
  if (!v) return null;
  if (v.toDate) return v.toDate();
  if (v instanceof Date) return v;
  return new Date(v);
}
function greetingForNow() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}
function firstNameFrom(full) {
  if (!full) return 'Collector';
  return String(full).trim().split(/\s+/)[0];
}
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function setSyncStatus(state) {
  const map = {
    synced:  { cls: 'bg-emerald-50 border-emerald-200 text-emerald-700', dot: 'bg-emerald-500 animate-pulse', label: 'Synced' },
    syncing: { cls: 'bg-amber-50 border-amber-200 text-amber-700',       dot: 'bg-amber-500 animate-pulse',  label: 'Syncing' },
    offline: { cls: 'bg-stone-100 border-stone-200 text-stone-600',      dot: 'bg-stone-400',                 label: 'Offline' },
    error:   { cls: 'bg-red-50 border-red-200 text-red-700',             dot: 'bg-red-500',                   label: 'Error' }
  };
  const c = map[state] || map.offline;
  syncStatusEl.className = `inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border ${c.cls}`;
  syncStatusEl.innerHTML =
    `<span class="w-1.5 h-1.5 rounded-full ${c.dot}"></span>
     <span class="text-[11px] font-semibold">${c.label}</span>`;
}

function showError(msg) {
  loadErrorMsg.textContent = msg || 'Check your internet connection and try again.';
  loadError.classList.remove('hidden');
  setSyncStatus(navigator.onLine ? 'error' : 'offline');
}
function hideError() { loadError.classList.add('hidden'); }

/* ---------- Local cache for aggregates (so offline still shows values) ---------- */
const CACHE_KEY = 'asv.dashboard.totals.v1';
function readTotalsCache() {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY) || 'null'); }
  catch { return null; }
}
function writeTotalsCache(data) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(data)); } catch {}
}

/* ---------- Greeting & date rendering ---------- */
function renderDate() {
  todayDateText.classList.remove('skeleton');
  todayDateText.classList.remove('inline-block', 'w-40', 'h-3', 'align-middle');
  todayDateText.classList.add('inline');
  todayDateText.textContent = new Date().toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  });
}

function setGreeting(text) {
  greetingText.classList.remove('skeleton');
  greetingText.classList.remove('inline-block', 'w-56', 'h-8', 'align-middle');
  greetingText.classList.add('inline');

  // Highlight the name after the first comma in brand gold
  const commaIdx = text.indexOf(', ');
  if (commaIdx !== -1) {
    const before = text.slice(0, commaIdx + 2);
    const name   = text.slice(commaIdx + 2);
    greetingText.innerHTML =
      `${escapeHtml(before)}<span class="text-brand-gold">${escapeHtml(name)}</span>`;
  } else {
    greetingText.textContent = text;
  }
}

/* ---------- Rendering ---------- */
function renderTodayStats({ deposits, withdrawals, depositCustomers, withdrawalCount }) {
  const depParts = formatGHS(deposits).split('.');
  todayDepositsAmount.innerHTML =
    `<span class="text-brand-gold text-base">GH₵</span>${depParts[0]}` +
    `<span class="text-sm text-stone-400">.${depParts[1]}</span>`;
  todayDepositsSub.textContent =
    depositCustomers === 0 ? 'No deposits yet' :
    `${depositCustomers} deposit${depositCustomers === 1 ? '' : 's'} recorded`;

  const wdParts = formatGHS(withdrawals).split('.');
  todayWithdrawalsAmount.innerHTML =
    `<span class="text-brand-gold text-base">GH₵</span>${wdParts[0]}` +
    `<span class="text-sm text-stone-400">.${wdParts[1]}</span>`;
  todayWithdrawalsSub.textContent =
    withdrawalCount === 0 ? 'No withdrawals today' :
    `${withdrawalCount} transaction${withdrawalCount === 1 ? '' : 's'}`;
}

function renderRecentTransactions(items) {
  if (!items.length) {
    recentTxEl.innerHTML = `
      <div class="p-8 text-center">
        <i class="fa-solid fa-receipt text-2xl text-stone-300"></i>
        <p class="mt-2 text-sm font-semibold text-stone-700">No transactions yet</p>
        <p class="text-xs text-stone-500 mt-0.5">Record your first deposit to see it here.</p>
      </div>`;
    return;
  }

  recentTxEl.innerHTML = items.map((t) => {
    const isDeposit = t.type === 'deposit';
    const sign      = isDeposit ? '+' : '−';
    const color     = isDeposit ? 'text-[#1B7F4B]' : 'text-[#B93838]';
    const label     = isDeposit ? 'Deposit' : 'Withdrawal';
    const when      = tsToDate(t.createdAt);
    const whenStr   = when
      ? when.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) +
        ' · ' +
        when.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
      : '';
    const name      = t.customerName || t.accountNumber || 'Customer';

    return `
      <div class="p-3.5 flex items-center justify-between hover:bg-stone-50/70 transition-colors">
        <div class="min-w-0 flex-1 pr-3">
          <p class="text-[13px] font-bold text-stone-900 truncate">${escapeHtml(name)}</p>
          <p class="text-[11px] text-stone-400 truncate">
            ${label}${whenStr ? ' · ' + whenStr : ''}
          </p>
        </div>
        <span class="text-[13px] font-bold ${color} whitespace-nowrap">
          ${sign}GH₵${formatGHS(t.amount)}
        </span>
      </div>`;
  }).join('');
}

function renderAllTime({ deposits, withdrawals, customers }, { fromCache } = {}) {
  totalDepositsEl.innerHTML    = `GH₵ ${formatGHS(deposits)}`;
  totalWithdrawalsEl.innerHTML = `GH₵ ${formatGHS(withdrawals)}`;
  netSavingsEl.innerHTML       = `GH₵ ${formatGHS(deposits - withdrawals)}`;
  totalCustomersEl.textContent = Number(customers || 0).toLocaleString('en-GH');

  const now = new Date();
  lastUpdatedEl.innerHTML =
    `<i class="fa-regular fa-clock mr-1"></i> Updated ${now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}${fromCache ? ' · offline' : ''}`;
}

/* ---------- Data loading ---------- */
let session = null;

// Totals are maintained by the server on every transaction (stats/global and
// statsDaily/{day}), so the dashboard reads two small documents instead of
// scanning transactions. Older data without those documents falls back to
// aggregate queries until the owner runs the data upgrade in Settings.
async function loadTotals() {
  const statsSnap = await getDoc(doc(db, 'stats', 'global'));
  if (statsSnap.exists() && statsSnap.data().depositsPesewas !== undefined) {
    const s = statsSnap.data();
    return {
      deposits: (Number(s.depositsPesewas) || 0) / 100,
      withdrawals: (Number(s.withdrawalsPesewas) || 0) / 100,
      customers: Number(s.customers) || 0
    };
  }
  const [dep, wd, cust] = await Promise.all([
    getAggregateFromServer(query(collection(db, 'transactions'), where('type', '==', 'deposit')), { total: sum('amount') }),
    getAggregateFromServer(query(collection(db, 'transactions'), where('type', '==', 'withdrawal')), { total: sum('amount') }),
    getCountFromServer(collection(db, 'customers'))
  ]);
  return {
    deposits: Number(dep.data().total) || 0,
    withdrawals: Number(wd.data().total) || 0,
    customers: Number(cust.data().count) || 0
  };
}

async function loadToday() {
  const today = new Date().toISOString().slice(0, 10); // Ghana is on GMT
  const daily = await getDoc(doc(db, 'statsDaily', today));
  if (daily.exists()) {
    const d = daily.data();
    return {
      deposits: (Number(d.depositsPesewas) || 0) / 100,
      withdrawals: (Number(d.withdrawalsPesewas) || 0) / 100,
      depositCount: Number(d.depositCount) || 0,
      withdrawalCount: Number(d.withdrawalCount) || 0
    };
  }
  // No transactions yet today (or data from before the upgrade).
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  const snap = await getDocs(query(collection(db, 'transactions'),
    where('createdAt', '>=', Timestamp.fromDate(start)), orderBy('createdAt', 'desc'), limit(500)));
  const out = { deposits: 0, withdrawals: 0, depositCount: 0, withdrawalCount: 0 };
  snap.forEach((d) => {
    const t = d.data();
    const amt = Number(t.amount) || 0;
    if (t.type === 'deposit') { out.deposits += amt; out.depositCount++; }
    else if (t.type === 'withdrawal') { out.withdrawals += amt; out.withdrawalCount++; }
  });
  return out;
}

async function loadDashboard() {
  hideError();
  setSyncStatus(navigator.onLine ? 'syncing' : 'offline');
  renderDate();
  setGreeting(`${greetingForNow()}, ${firstNameFrom(session?.profile?.name)}`);
  greetingWave.classList.remove('hidden');

  // Show the last known numbers immediately, then refresh.
  const cache = readTotalsCache();
  if (cache) {
    renderAllTime(cache, { fromCache: true });
    if (cache.today && cache.day === new Date().toISOString().slice(0, 10)) renderTodayStats(cache.today);
  }

  const recentQ = query(collection(db, 'transactions'), orderBy('createdAt', 'desc'), limit(5));
  const [today, recent, totals] = await Promise.allSettled([
    loadToday(),
    getDocs(recentQ),
    loadTotals()
  ]);

  let failed = false;
  if (today.status === 'fulfilled') {
    renderTodayStats({
      deposits: today.value.deposits,
      withdrawals: today.value.withdrawals,
      depositCustomers: today.value.depositCount,
      withdrawalCount: today.value.withdrawalCount
    });
  } else { failed = true; console.error(today.reason); }

  if (recent.status === 'fulfilled') {
    renderRecentTransactions(recent.value.docs.map((d) => ({ id: d.id, ...d.data() })));
  } else { failed = true; console.error(recent.reason); renderRecentTransactions([]); }

  if (totals.status === 'fulfilled') {
    renderAllTime(totals.value, { fromCache: false });
    writeTotalsCache({
      ...totals.value,
      day: new Date().toISOString().slice(0, 10),
      today: today.status === 'fulfilled' ? {
        deposits: today.value.deposits, withdrawals: today.value.withdrawals,
        depositCustomers: today.value.depositCount, withdrawalCount: today.value.withdrawalCount
      } : null,
      savedAt: Date.now()
    });
  } else { failed = true; console.error(totals.reason); }

  if (failed) {
    showError('Some figures couldn’t be refreshed. Showing what we have. Check your connection and retry.');
  } else {
    setSyncStatus(navigator.onLine ? 'synced' : 'offline');
  }

  loadSmsUnits();
}

async function loadSmsUnits() {
  const el = document.getElementById('smsUnits');
  if (!el || !session?.can('sms.send')) return;
  try {
    const { wallet } = await call('smsOverview');
    el.textContent = `${Number(wallet?.availableUnits || 0).toLocaleString('en-GH')} units left`;
    if (wallet?.lowBalance) el.className = 'text-[11px] text-red-600 font-semibold mt-0.5';
  } catch {
    el.textContent = '';
  }
}

/* ---------- Network events ---------- */
window.addEventListener('online', () => {
  setSyncStatus('syncing');
  loadDashboard();
});
window.addEventListener('offline', () => {
  setSyncStatus('offline');
});

/* ---------- Session ---------- */
requireSession().then((sess) => {
  session = sess;
  loadDashboard();
});

/* ---------- Buttons ---------- */
refreshBtn.addEventListener('click', () => {
  refreshBtn.querySelector('i').classList.add('fa-spin');
  loadDashboard().finally(() => {
    setTimeout(() => refreshBtn.querySelector('i').classList.remove('fa-spin'), 400);
  });
});
retryBtn.addEventListener('click', () => loadDashboard());
logoutBtn.addEventListener('click', () => logout());
