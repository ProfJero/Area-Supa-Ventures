// reports.html page script
import {
  collection, query, where, orderBy, limit, getDocs, Timestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { mountBottomNav } from '../components/bottom-nav.js';
import { db } from './lib/firebase.js';
import { requireSession } from './lib/session.js';
mountBottomNav('reports');

/* ---------- Firebase ---------- */

/* ---------- Refs ---------- */
const $ = (id) => document.getElementById(id);
const loadError = $('loadError'), loadErrorMsg = $('loadErrorMsg'), retryBtn = $('retryBtn');
const refreshBtn = $('refreshBtn');
const scopeTabs = document.querySelectorAll('.scope-tab');
const activeRangeEl = $('activeRange');
const netMovement = $('netMovement'), totalDeposits = $('totalDeposits'), totalWithdrawals = $('totalWithdrawals');
const reportRows = document.querySelectorAll('.report-row[data-type]');
const exportAllBtn = $('exportAllBtn'), shareBtn = $('shareBtn');
const lastUpdatedEl = $('lastUpdated');

/* ---------- State ---------- */
let currentScope = 'day';
let range = { start: null, end: null, label: '' };
let tx = [];
let currentUser = null;

/* ---------- Helpers ---------- */
function formatGHS(n) { const v = Number(n)||0; return v.toLocaleString('en-GH',{minimumFractionDigits:2,maximumFractionDigits:2}); }
function escapeHtml(s){ return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function tsToDate(v){ if(!v) return null; if(v.toDate) return v.toDate(); if(v instanceof Date) return v; return new Date(v); }
function ymd(d){ return new Date(d).toISOString().slice(0,10); }
function startOfDay(d){ const x = new Date(d); x.setHours(0,0,0,0); return x; }
function endOfDay(d){ const x = new Date(d); x.setHours(23,59,59,999); return x; }
function startOfWeek(d){ const x = startOfDay(d); const day = x.getDay() || 7; if (day !== 1) x.setDate(x.getDate() - (day - 1)); return x; }

function computeRange(scope) {
  const now = new Date();
  if (scope === 'day') {
    return { start: startOfDay(now), end: endOfDay(now),
             label: 'Today · ' + now.toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'}) };
  }
  if (scope === 'week') {
    const s = startOfWeek(now);
    return { start: s, end: endOfDay(now),
             label: 'This week · ' + s.toLocaleDateString('en-GB',{day:'numeric',month:'short'}) + ' – ' + now.toLocaleDateString('en-GB',{day:'numeric',month:'short'}) };
  }
  // month
  const s = new Date(now.getFullYear(), now.getMonth(), 1);
  return { start: s, end: endOfDay(now),
           label: now.toLocaleDateString('en-GB',{month:'long', year:'numeric'}) };
}

function setActiveScope() {
  scopeTabs.forEach(b => {
    const active = b.getAttribute('data-scope') === currentScope;
    b.className = 'scope-tab px-4 py-2 rounded-lg text-[12px] font-semibold ' + (
      active ? 'bg-[#212121] text-white shadow' : 'text-stone-600 hover:text-stone-900'
    );
  });
}

function showError(msg) { loadErrorMsg.textContent = msg || 'Check your connection and retry.'; loadError.classList.remove('hidden'); }
function hideError() { loadError.classList.add('hidden'); }

/* ---------- Load ---------- */
async function loadSummary() {
  hideError();
  range = computeRange(currentScope);
  activeRangeEl.innerHTML = `<i class="fa-regular fa-clock mr-1"></i> ${escapeHtml(range.label)}`;

  // Reset previews to skeletons
  reportRows.forEach(row => {
    const p = row.querySelector('[data-preview]');
    if (p) p.innerHTML = '<span class="skeleton inline-block w-32 h-3 align-middle"></span>';
  });
  netMovement.innerHTML = '<span class="skeleton-dark w-32 h-7 inline-block"></span>';
  totalDeposits.innerHTML = '<span class="skeleton-dark w-24 h-4 inline-block"></span>';
  totalWithdrawals.innerHTML = '<span class="skeleton-dark w-24 h-4 inline-block"></span>';

  try {
    const q = query(
      collection(db, 'transactions'),
      where('createdAt', '>=', Timestamp.fromDate(range.start)),
      where('createdAt', '<=', Timestamp.fromDate(range.end)),
      orderBy('createdAt', 'desc'),
      limit(2000)
    );
    const snap = await getDocs(q);
    tx = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    render();
  } catch (e) {
    console.error('Reports hub load failed:', e);
    if (String(e?.message || '').toLowerCase().includes('index')) {
      showError('A Firestore index is building for this query. Retry in ~1 minute.');
    } else if (!navigator.onLine) {
      showError('You’re offline. Reconnect to load reports.');
    } else {
      showError('Could not load reports. Check your connection and retry.');
    }
  }
}

function render() {
  let dep = 0, wd = 0, depCount = 0, wdCount = 0;
  const customers = new Set();
  const collectors = new Set();

  for (const t of tx) {
    const amt = Number(t.amount) || 0;
    if (t.type === 'deposit') { dep += amt; depCount++; }
    else { wd += amt; wdCount++; }
    if (t.customerId) customers.add(t.customerId);
    if (t.createdBy) collectors.add(t.createdBy);
  }

  const net = dep - wd;

  netMovement.textContent = (net >= 0 ? '+' : '−') + `GH₵${formatGHS(Math.abs(net))}`;
  netMovement.className = 'text-2xl font-extrabold mt-1.5 ' + (net >= 0 ? 'text-brand-gold' : 'text-red-400');
  totalDeposits.textContent = `GH₵${formatGHS(dep)}`;
  totalWithdrawals.textContent = `GH₵${formatGHS(wd)}`;

  // Row previews
  setPreview('deposits',    `${depCount} transaction${depCount === 1 ? '' : 's'} · GH₵${formatGHS(dep)}`);
  setPreview('withdrawals', `${wdCount} transaction${wdCount === 1 ? '' : 's'} · GH₵${formatGHS(wd)}`);
  setPreview('net',         net >= 0 ? `+GH₵${formatGHS(net)} net increase` : `−GH₵${formatGHS(Math.abs(net))} net decrease`);
  setPreview('collectors',  `${collectors.size} collector${collectors.size === 1 ? '' : 's'} active · ${tx.length} txns`);
  setPreview('customers',   `${customers.size} customer${customers.size === 1 ? '' : 's'} served`);

  // Row links
  reportRows.forEach(row => {
    const type = row.getAttribute('data-type');
    row.href = `report-view.html?type=${type}&scope=${currentScope}`;
  });

  const now = new Date();
  lastUpdatedEl.innerHTML = `<i class="fa-regular fa-clock mr-1"></i> Updated ${now.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'})}`;
}

function setPreview(type, text) {
  const el = document.querySelector(`[data-preview="${type}"]`);
  if (el) el.textContent = text;
}

/* ---------- Scope tabs ---------- */
scopeTabs.forEach(btn => {
  btn.addEventListener('click', () => {
    currentScope = btn.getAttribute('data-scope');
    setActiveScope();
    loadSummary();
  });
});

/* ---------- Export all (CSV of the period) ---------- */
exportAllBtn.addEventListener('click', () => {
  if (!tx.length) { alert('Nothing to export in this period.'); return; }
  const headers = ['Date','Time','Type','Customer','Account','Amount','Method','Reference','Balance After','Collector'];
  const rows = tx.map(t => {
    const d = tsToDate(t.createdAt);
    return [
      d ? d.toLocaleDateString('en-GB') : '',
      d ? d.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'}) : '',
      t.type === 'deposit' ? 'Deposit' : 'Withdrawal',
      t.customerName || '',
      t.accountNumber || '',
      (Number(t.amount)||0).toFixed(2),
      t.paymentMethod || 'cash',
      t.reference || '',
      (Number(t.balanceAfter)||0).toFixed(2),
      t.createdByName || ''
    ];
  });
  const csv = [headers, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(',')).join('\r\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `ASV-report-${currentScope}-${ymd(range.start)}-to-${ymd(range.end)}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

/* ---------- Share summary ---------- */
shareBtn.addEventListener('click', async () => {
  const dep = totalDeposits.textContent;
  const wd = totalWithdrawals.textContent;
  const net = netMovement.textContent;
  const text = [
    `Area Supa Ventures — ${currentScope === 'day' ? 'Daily' : currentScope === 'week' ? 'Weekly' : 'Monthly'} Report`,
    `${range.label}`,
    ``,
    `Deposits:     ${dep}`,
    `Withdrawals:  ${wd}`,
    `Net movement: ${net}`,
    ``,
    `Generated ${new Date().toLocaleString('en-GB')}`
  ].join('\n');

  if (navigator.share) {
    try { await navigator.share({ title: 'Area Supa Ventures Report', text }); return; }
    catch (e) { if (e?.name === 'AbortError') return; }
  }
  window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
});

/* ---------- Refresh / Retry ---------- */
refreshBtn.addEventListener('click', () => {
  refreshBtn.querySelector('i').classList.add('fa-spin');
  loadSummary().finally(() => {
    setTimeout(() => refreshBtn.querySelector('i').classList.remove('fa-spin'), 400);
  });
});
retryBtn.addEventListener('click', loadSummary);

/* ---------- Init ---------- */
const __session = await requireSession({ permission: 'reports.view' });
{
  const u = __session.user;
  currentUser = u;
  setActiveScope();
  loadSummary();
}
