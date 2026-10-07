// report-view.html page script
import {
  collection, query, where, orderBy, limit, getDocs, Timestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { mountBottomNav } from '../components/bottom-nav.js';
import { db } from './lib/firebase.js';
import { requireSession } from './lib/session.js';
mountBottomNav('reports');

/* ---------- Firebase ---------- */

/* ---------- Config ---------- */
const TYPES = {
  deposits:    { title: 'Deposit report',        sub: 'All deposits in the period' },
  withdrawals: { title: 'Withdrawal report',     sub: 'All withdrawals in the period' },
  net:         { title: 'Net savings movement',  sub: 'Deposits vs withdrawals by day' },
  collectors:  { title: 'Collector performance', sub: 'Activity breakdown per collector' },
  customers:   { title: 'Customer activity',     sub: 'Who saved the most this period' }
};

/* ---------- Refs ---------- */
const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const type = params.get('type') || 'deposits';
let currentPeriod = params.get('scope') || 'day';

if (!TYPES[type]) window.location.replace('reports.html');

const pageTitle = $('pageTitle'), pageSubtitle = $('pageSubtitle');
const printTitle = $('printTitle'), printPeriod = $('printPeriod');
const printGeneratedAt = $('printGeneratedAt'), printGeneratedBy = $('printGeneratedBy');

const loadError = $('loadError'), loadErrorMsg = $('loadErrorMsg'), retryBtn = $('retryBtn');
const refreshBtn = $('refreshBtn'), printBtn = $('printBtn');
const periodPills = document.querySelectorAll('.period-pill');
const customRange = $('customRange');
const fromInput = $('fromInput'), toInput = $('toInput'), applyCustomBtn = $('applyCustom');
const activeRangeEl = $('activeRange');
const reportContent = $('reportContent');
const exportCsvBtn = $('exportCsvBtn'), shareBtn = $('shareBtn');

/* ---------- State ---------- */
let currentUser = null;
let range = { start: null, end: null, label: '' };
let tx = [];

/* ---------- Helpers ---------- */
function formatGHS(n) { const v = Number(n)||0; return v.toLocaleString('en-GH',{minimumFractionDigits:2,maximumFractionDigits:2}); }
function round2(n) { return Math.round(Number(n)*100)/100; }
function escapeHtml(s){ return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function tsToDate(v){ if(!v) return null; if(v.toDate) return v.toDate(); if(v instanceof Date) return v; return new Date(v); }
function ymd(d){ return new Date(d).toISOString().slice(0,10); }
function parseYmdLocal(s){ const [y,m,dd]=s.split('-').map(Number); return new Date(y,m-1,dd); }
function startOfDay(d){ const x=new Date(d); x.setHours(0,0,0,0); return x; }
function endOfDay(d){ const x=new Date(d); x.setHours(23,59,59,999); return x; }
function startOfWeek(d){ const x=startOfDay(d); const day=x.getDay()||7; if(day!==1) x.setDate(x.getDate()-(day-1)); return x; }
function fmtDateShort(d){ return d.toLocaleDateString('en-GB',{day:'2-digit',month:'short'}); }
function fmtDateFull(d){ return d.toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'}); }
function fmtTime(d){ return d.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'}); }

function computeRange(period) {
  const now = new Date();
  switch (period) {
    case 'day':   return { start: startOfDay(now), end: endOfDay(now), label: 'Today · ' + fmtDateFull(now) };
    case 'week':  { const s = startOfWeek(now); return { start: s, end: endOfDay(now), label: `Week · ${fmtDateShort(s)} – ${fmtDateFull(now)}` }; }
    case 'month': { const s = new Date(now.getFullYear(), now.getMonth(), 1); return { start: s, end: endOfDay(now), label: now.toLocaleDateString('en-GB',{month:'long',year:'numeric'}) }; }
    case 'last3': { const s = new Date(now.getFullYear(), now.getMonth()-2, 1); return { start: s, end: endOfDay(now), label: `Last 3 months · ${fmtDateFull(s)} – ${fmtDateFull(now)}` }; }
    case 'custom': {
      const s = fromInput.value ? startOfDay(parseYmdLocal(fromInput.value)) : startOfDay(now);
      const e = toInput.value ? endOfDay(parseYmdLocal(toInput.value)) : endOfDay(now);
      return { start: s, end: e, label: `${fmtDateFull(s)} – ${fmtDateFull(e)}` };
    }
    default: return computeRange('day');
  }
}

function setActivePill() {
  periodPills.forEach(b => {
    const active = b.getAttribute('data-period') === currentPeriod;
    b.className = 'period-pill shrink-0 px-3.5 py-2 rounded-full text-[12px] font-semibold ' + (
      active ? 'bg-[#212121] text-white shadow' : 'bg-white border border-stone-200 text-stone-600 hover:text-stone-900'
    );
  });
  customRange.classList.toggle('hidden', currentPeriod !== 'custom');
}

function showError(msg) { loadErrorMsg.textContent = msg || 'Check your connection and retry.'; loadError.classList.remove('hidden'); }
function hideError() { loadError.classList.add('hidden'); }

pageTitle.textContent = TYPES[type].title;
pageSubtitle.textContent = TYPES[type].sub;
printTitle.textContent = `${TYPES[type].title} · Area Supa Ventures`;

/* ---------- Load ---------- */
async function load() {
  hideError();
  range = computeRange(currentPeriod);
  activeRangeEl.innerHTML = `<i class="fa-regular fa-clock mr-1"></i> ${escapeHtml(range.label)}`;

  reportContent.innerHTML = `
    <div class="rounded-2xl bg-white border border-stone-200 p-5 print-card fade-up">
      <div class="space-y-3">
        <div class="skeleton h-6 w-1/3"></div>
        <div class="skeleton h-4 w-full"></div>
        <div class="skeleton h-4 w-5/6"></div>
        <div class="skeleton h-4 w-4/6"></div>
      </div>
    </div>`;

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
    console.error('Report load failed:', e);
    if (String(e?.message || '').toLowerCase().includes('index')) {
      showError('A Firestore index is building for this query. Retry in ~1 minute.');
    } else if (!navigator.onLine) {
      showError('You’re offline. Reconnect to load this report.');
    } else {
      showError('Could not load report. Check your connection and retry.');
    }
  }
}

/* ---------- Router ---------- */
function render() {
  printPeriod.textContent = range.label;
  const now = new Date();
  printGeneratedAt.textContent = `${fmtDateFull(now)} · ${fmtTime(now)}`;
  printGeneratedBy.textContent = currentUser?.email || currentUser?.phoneNumber || '—';

  switch (type) {
    case 'deposits':    return renderDeposits();
    case 'withdrawals': return renderWithdrawals();
    case 'net':         return renderNet();
    case 'collectors':  return renderCollectors();
    case 'customers':   return renderCustomers();
  }
}

/* ---------- Shared: hero card ---------- */
function heroCard(label, value, accent, sub, extras = '') {
  const valueColor = accent === 'gold' ? 'text-brand-gold' : 'text-white';
  return `
    <section class="bg-[#20201E] text-white rounded-2xl p-5 mb-5 relative overflow-hidden print-card fade-up">
      <div class="absolute -right-8 -top-8 w-32 h-32 bg-[#C59A3F]/10 rounded-full blur-2xl pointer-events-none"></div>
      <div class="relative">
        <p class="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-stone-400">${escapeHtml(label)}</p>
        <p class="text-3xl font-extrabold ${valueColor} mt-1.5 tabular-nums">${value}</p>
        ${sub ? `<p class="text-[12px] text-stone-400 mt-2">${sub}</p>` : ''}
        ${extras}
      </div>
    </section>`;
}

/* ---------- Shared: transactions table ---------- */
function transactionsTable(items, emptyMsg = 'No transactions in this period.') {
  if (!items.length) {
    return `<div class="rounded-2xl bg-white border border-stone-200 p-8 text-center print-card">
      <i class="fa-solid fa-receipt text-3xl text-stone-300"></i>
      <p class="mt-3 text-[13px] font-semibold text-stone-700">${escapeHtml(emptyMsg)}</p>
    </div>`;
  }
  return `
    <div class="rounded-2xl bg-white border border-stone-200 overflow-hidden print-card">
      <table class="w-full" style="border-collapse: collapse; font-size: 12.5px;">
        <thead>
          <tr style="border-bottom: 1px solid #e5e3de;">
            <th class="text-left py-3 px-4 font-semibold text-stone-500 text-[10.5px] uppercase tracking-wider">Date</th>
            <th class="text-left py-3 px-4 font-semibold text-stone-500 text-[10.5px] uppercase tracking-wider">Customer</th>
            <th class="text-right py-3 px-4 font-semibold text-stone-500 text-[10.5px] uppercase tracking-wider">Amount</th>
          </tr>
        </thead>
        <tbody>
          ${items.map((t, i) => {
            const d = tsToDate(t.createdAt);
            const isDep = t.type === 'deposit';
            const sign = isDep ? '+' : '−';
            const color = isDep ? 'text-emerald-600' : 'text-red-600';
            const border = i < items.length - 1 ? 'border-bottom: 1px solid #f1efea;' : '';
            return `
              <tr style="${border}">
                <td class="py-2.5 px-4 align-top">
                  <span class="font-semibold text-stone-800">${d ? fmtDateShort(d) : '—'}</span>
                  <span class="block text-[10.5px] text-stone-400 mt-0.5">${d ? fmtTime(d) : ''}</span>
                </td>
                <td class="py-2.5 px-4 align-top">
                  <a href="customer.html?id=${encodeURIComponent(t.customerId || '')}" class="font-medium text-stone-800 hover:text-brand-gold">
                    ${escapeHtml(t.customerName || '—')}
                  </a>
                  <span class="block text-[10.5px] font-mono text-stone-400 mt-0.5">${escapeHtml(t.accountNumber || '')}</span>
                </td>
                <td class="py-2.5 px-4 align-top text-right font-bold ${color} whitespace-nowrap">
                  ${sign}GH₵${formatGHS(t.amount)}
                </td>
              </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>`;
}

/* ---------- Shared: payment method breakdown ---------- */
function paymentBreakdown(items) {
  if (!items.length) return '';
  const methods = new Map();
  let total = 0;
  for (const t of items) {
    const m = t.paymentMethod || 'cash';
    const amt = Number(t.amount) || 0;
    const e = methods.get(m) || { method: m, amount: 0, count: 0 };
    e.amount += amt; e.count++;
    methods.set(m, e);
    total += amt;
  }
  const labels = { cash: 'Cash', momo: 'Mobile Money', other: 'Other' };
  const colors = { cash: 'bg-amber-500', momo: 'bg-emerald-500', other: 'bg-stone-400' };
  const entries = Array.from(methods.values()).sort((a,b) => b.amount - a.amount);

  return `
    <div class="rounded-2xl bg-white border border-stone-200 p-5 mb-5 print-card fade-up">
      <h2 class="text-sm font-bold text-stone-900 tracking-tight mb-4">Payment method</h2>
      <div class="space-y-3">
        ${entries.map(e => {
          const pct = total > 0 ? (e.amount/total)*100 : 0;
          return `
            <div>
              <div class="flex items-center justify-between mb-1.5">
                <span class="flex items-center gap-2 text-[12.5px] font-semibold text-stone-800">
                  <span class="w-2 h-2 rounded-full ${colors[e.method] || colors.other}"></span>
                  ${escapeHtml(labels[e.method] || e.method)}
                  <span class="text-[11px] text-stone-400 font-normal">· ${e.count} txn</span>
                </span>
                <span class="text-[12.5px] font-bold text-stone-900">GH₵${formatGHS(e.amount)}</span>
              </div>
              <div class="w-full h-1.5 bg-stone-100 rounded-full overflow-hidden">
                <div class="${colors[e.method] || colors.other} h-full rounded-full" style="width: ${pct}%"></div>
              </div>
              <p class="text-[10.5px] text-stone-400 mt-1">${pct.toFixed(1)}% of volume</p>
            </div>`;
        }).join('')}
      </div>
    </div>`;
}

/* ========================================================================
   RUNNING BALANCE CHART (SVG)
   ======================================================================== */

let chartResizeTimer = null;
let chartResizeHandler = null;

function renderBalanceChart(containerId, transactions, rangeObj) {
  const container = document.getElementById(containerId);
  if (!container) return;

  // Sort chronologically (oldest → newest)
  const sorted = [...transactions].sort((a, b) => {
    const da = tsToDate(a.createdAt);
    const db2 = tsToDate(b.createdAt);
    return (da ? da.getTime() : 0) - (db2 ? db2.getTime() : 0);
  });

  if (sorted.length === 0) {
    container.innerHTML = `
      <div class="flex items-start justify-between mb-4">
        <div>
          <h2 class="text-sm font-bold text-stone-900 tracking-tight">Running balance</h2>
          <p class="text-[11px] text-stone-500 mt-0.5">Balance after each transaction</p>
        </div>
      </div>
      <div class="py-12 text-center">
        <i class="fa-solid fa-chart-line text-3xl text-stone-300"></i>
        <p class="mt-3 text-[12.5px] text-stone-500">No transactions in this period to plot.</p>
      </div>`;
    return;
  }

  // Opening balance = balance right before the first transaction in the period
  const first = sorted[0];
  const firstAmt = Number(first.amount) || 0;
  const firstBalAfter = Number(first.balanceAfter) || 0;
  const firstNet = first.type === 'deposit' ? firstAmt : -firstAmt;
  const opening = round2(firstBalAfter - firstNet);

  // Data points: opening (at range start) + each transaction's balanceAfter
  const points = [{ t: rangeObj.start.getTime(), v: opening }];
  for (const t of sorted) {
    const d = tsToDate(t.createdAt);
    if (!d) continue;
    points.push({ t: d.getTime(), v: Number(t.balanceAfter) || 0 });
  }

  // Measure container so SVG renders 1:1 pixels (crisp text)
  const W = Math.max(300, Math.round(container.clientWidth || 800));
  const H = 240;
  const PAD_L = 58, PAD_R = 18, PAD_T = 18, PAD_B = 32;
  const plotW = W - PAD_L - PAD_R;
  const plotH = H - PAD_T - PAD_B;

  let minV = Math.min(...points.map(p => p.v));
  let maxV = Math.max(...points.map(p => p.v));
  if (minV === maxV) { minV = Math.max(0, minV - 50); maxV = maxV + 50; }
  const pad = (maxV - minV) * 0.1 || 10;
  minV = Math.max(0, minV - pad);
  maxV = maxV + pad;

  const tMin = points[0].t;
  const tMax = points[points.length - 1].t;
  const tRange = Math.max(1, tMax - tMin);

  const toX = (t) => PAD_L + ((t - tMin) / tRange) * plotW;
  const toY = (v) => PAD_T + plotH - ((v - minV) / (maxV - minV)) * plotH;

  // Step-after path: balance holds flat, then jumps at each transaction
  let path = `M ${toX(points[0].t).toFixed(1)} ${toY(points[0].v).toFixed(1)}`;
  for (let i = 1; i < points.length; i++) {
    const x = toX(points[i].t).toFixed(1);
    const yPrev = toY(points[i - 1].v).toFixed(1);
    const y = toY(points[i].v).toFixed(1);
    path += ` L ${x} ${yPrev} L ${x} ${y}`;
  }

  const xFirst = toX(points[0].t).toFixed(1);
  const xLast = toX(points[points.length - 1].t).toFixed(1);
  const yLast = toY(points[points.length - 1].v).toFixed(1);
  const yBase = (PAD_T + plotH).toFixed(1);
  const areaPath = `${path} L ${xLast} ${yBase} L ${xFirst} ${yBase} Z`;

  // Ticks
  const yTicks = [maxV, (maxV + minV) / 2, minV];
  const xTicks = [];
  const n = W < 500 ? 3 : 5;
  for (let i = 0; i < n; i++) {
    const t = tMin + (i / (n - 1)) * tRange;
    xTicks.push({ t, x: toX(t) });
  }

  const fmtShort = (num) => {
    const a = Math.abs(num);
    if (a >= 1_000_000) return (num / 1_000_000).toFixed(1) + 'M';
    if (a >= 1000) return (num / 1000).toFixed(1) + 'k';
    return Math.round(num).toString();
  };
  const dFmt = (t) => new Date(t).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });

  const latest = points[points.length - 1].v;
  const change = round2(latest - opening);
  const changeColor = change >= 0 ? 'text-emerald-600' : 'text-red-600';
  const changeSign = change >= 0 ? '+' : '−';

  const svg = `
    <svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg"
         style="width:100%; height:${H}px; display:block;" preserveAspectRatio="xMidYMid meet">
      <defs>
        <linearGradient id="asvBalanceGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#C59A3F" stop-opacity="0.32"/>
          <stop offset="100%" stop-color="#C59A3F" stop-opacity="0"/>
        </linearGradient>
      </defs>

      ${yTicks.map(v => {
        const y = toY(v);
        return `
          <line x1="${PAD_L}" y1="${y.toFixed(1)}" x2="${W - PAD_R}" y2="${y.toFixed(1)}"
                stroke="#ecebe8" stroke-width="1" stroke-dasharray="3,4"/>
          <text x="${PAD_L - 8}" y="${(y + 4).toFixed(1)}"
                text-anchor="end" fill="#a8a29e" font-size="11"
                font-family="-apple-system, BlinkMacSystemFont, sans-serif">
            ${fmtShort(v)}
          </text>
        `;
      }).join('')}

      <path d="${areaPath}" fill="url(#asvBalanceGrad)"/>
      <path d="${path}" fill="none" stroke="#C59A3F" stroke-width="2"
            stroke-linecap="round" stroke-linejoin="round"/>

      <circle cx="${xLast}" cy="${yLast}" r="4.5"
              fill="#C59A3F" stroke="#ffffff" stroke-width="2"/>

      ${xTicks.map((tk, i) => `
        <text x="${tk.x.toFixed(1)}" y="${H - 8}"
              text-anchor="${i === 0 ? 'start' : i === xTicks.length - 1 ? 'end' : 'middle'}"
              fill="#a8a29e" font-size="11"
              font-family="-apple-system, BlinkMacSystemFont, sans-serif">
          ${dFmt(tk.t)}
        </text>
      `).join('')}
    </svg>`;

  container.innerHTML = `
    <div class="flex items-start justify-between mb-4 gap-3">
      <div class="min-w-0">
        <h2 class="text-sm font-bold text-stone-900 tracking-tight">Running balance</h2>
        <p class="text-[11px] text-stone-500 mt-0.5">Balance after each transaction</p>
      </div>
      <div class="text-right shrink-0">
        <p class="text-[10.5px] uppercase tracking-wider text-stone-400">Closing</p>
        <p class="text-[15px] font-bold text-brand-gold tabular-nums">GH₵${formatGHS(latest)}</p>
      </div>
    </div>
    ${svg}
    <div class="mt-3 flex items-center justify-between text-[11.5px] gap-2">
      <span class="text-stone-500 truncate">
        Opening:
        <span class="font-semibold text-stone-700 tabular-nums">GH₵${formatGHS(opening)}</span>
      </span>
      <span class="font-semibold ${changeColor} tabular-nums whitespace-nowrap">
        ${changeSign}GH₵${formatGHS(Math.abs(change))}
      </span>
    </div>
  `;
}

function setupChartResize(containerId) {
  if (chartResizeHandler) window.removeEventListener('resize', chartResizeHandler);
  chartResizeHandler = () => {
    clearTimeout(chartResizeTimer);
    chartResizeTimer = setTimeout(() => {
      if (document.getElementById(containerId)) {
        renderBalanceChart(containerId, tx, range);
      }
    }, 200);
  };
  window.addEventListener('resize', chartResizeHandler);
}

/* ========================================================================
   VIEWS
   ======================================================================== */

/* ---------- Deposits ---------- */
function renderDeposits() {
  const deposits = tx.filter(t => t.type === 'deposit');
  let total = 0, count = deposits.length;
  const customers = new Set();
  for (const t of deposits) {
    total += Number(t.amount) || 0;
    if (t.customerId) customers.add(t.customerId);
  }
  const avg = count ? total / count : 0;

  const extras = `
    <div class="grid grid-cols-3 gap-3 mt-4 pt-4 border-t border-stone-700/60">
      <div>
        <p class="text-[10.5px] uppercase tracking-wider text-stone-400">Transactions</p>
        <p class="text-[15px] font-bold text-white mt-0.5">${count}</p>
      </div>
      <div>
        <p class="text-[10.5px] uppercase tracking-wider text-stone-400">Customers</p>
        <p class="text-[15px] font-bold text-white mt-0.5">${customers.size}</p>
      </div>
      <div class="text-right">
        <p class="text-[10.5px] uppercase tracking-wider text-stone-400">Average</p>
        <p class="text-[15px] font-bold text-white mt-0.5">GH₵${formatGHS(avg)}</p>
      </div>
    </div>`;

  reportContent.innerHTML = `
    ${heroCard('Total deposits', `GH₵${formatGHS(total)}`, 'green', '', extras)}
    ${paymentBreakdown(deposits)}
    ${transactionsTable(deposits, 'No deposits in this period.')}
  `;
}

/* ---------- Withdrawals ---------- */
function renderWithdrawals() {
  const withdrawals = tx.filter(t => t.type === 'withdrawal');
  let total = 0, count = withdrawals.length;
  const customers = new Set();
  for (const t of withdrawals) {
    total += Number(t.amount) || 0;
    if (t.customerId) customers.add(t.customerId);
  }
  const avg = count ? total / count : 0;

  const extras = `
    <div class="grid grid-cols-3 gap-3 mt-4 pt-4 border-t border-stone-700/60">
      <div>
        <p class="text-[10.5px] uppercase tracking-wider text-stone-400">Transactions</p>
        <p class="text-[15px] font-bold text-white mt-0.5">${count}</p>
      </div>
      <div>
        <p class="text-[10.5px] uppercase tracking-wider text-stone-400">Customers</p>
        <p class="text-[15px] font-bold text-white mt-0.5">${customers.size}</p>
      </div>
      <div class="text-right">
        <p class="text-[10.5px] uppercase tracking-wider text-stone-400">Average</p>
        <p class="text-[15px] font-bold text-white mt-0.5">GH₵${formatGHS(avg)}</p>
      </div>
    </div>`;

  reportContent.innerHTML = `
    ${heroCard('Total withdrawals', `GH₵${formatGHS(total)}`, 'red', '', extras)}
    ${paymentBreakdown(withdrawals)}
    ${transactionsTable(withdrawals, 'No withdrawals in this period.')}
  `;
}

/* ---------- Net movement ---------- */
function renderNet() {
  let dep = 0, wd = 0;
  const byDay = new Map();
  for (const t of tx) {
    const amt = Number(t.amount) || 0;
    const d = tsToDate(t.createdAt);
    const dayKey = d ? ymd(d) : null;
    if (t.type === 'deposit') dep += amt; else wd += amt;
    if (dayKey) {
      const e = byDay.get(dayKey) || { day: dayKey, deposits: 0, withdrawals: 0, net: 0 };
      if (t.type === 'deposit') e.deposits += amt; else e.withdrawals += amt;
      e.net = e.deposits - e.withdrawals;
      byDay.set(dayKey, e);
    }
  }
  const net = dep - wd;

  // Build day list for bar chart
  const days = [];
  const startMid = startOfDay(range.start);
  const endMid = startOfDay(range.end);
  for (let d = new Date(startMid); d <= endMid; d.setDate(d.getDate() + 1)) days.push(new Date(d));

  const bucketed = days.map(d => {
    const e = byDay.get(ymd(d)) || { deposits: 0, withdrawals: 0, net: 0 };
    return { date: d, ...e };
  });

  const maxBar = Math.max(...bucketed.map(b => Math.max(b.deposits, b.withdrawals)), 1);
  const labelStep = Math.max(1, Math.ceil(bucketed.length / 7));

  const barChartHtml = bucketed.length === 0 ? '' : `
    <div class="rounded-2xl bg-white border border-stone-200 p-5 mb-5 print-card fade-up">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-sm font-bold text-stone-900 tracking-tight">Daily movement</h2>
        <div class="flex items-center gap-3 text-[11px]">
          <span class="flex items-center gap-1.5 text-stone-500">
            <span class="w-2.5 h-2.5 rounded-sm bg-emerald-500"></span> Deposits
          </span>
          <span class="flex items-center gap-1.5 text-stone-500">
            <span class="w-2.5 h-2.5 rounded-sm bg-red-500"></span> Withdrawals
          </span>
        </div>
      </div>
      <div class="overflow-x-auto">
        <div class="flex items-end gap-1.5" style="height: 180px; min-width: 100%;">
          ${bucketed.map((b, i) => `
            <div class="flex-1 flex flex-col items-center min-w-[24px]">
              <div class="flex items-end gap-0.5 w-full justify-center" style="height: 150px;">
                <div class="w-2 bg-emerald-500 rounded-t-sm"
                     title="Deposits: GH₵${formatGHS(b.deposits)}"
                     style="height: ${Math.max(4, (b.deposits / maxBar) * 100)}%;"></div>
                <div class="w-2 bg-red-500 rounded-t-sm"
                     title="Withdrawals: GH₵${formatGHS(b.withdrawals)}"
                     style="height: ${Math.max(4, (b.withdrawals / maxBar) * 100)}%;"></div>
              </div>
              <span class="text-[9.5px] text-stone-400 font-medium text-center whitespace-nowrap mt-1.5">
                ${i % labelStep === 0 ? escapeHtml(fmtDateShort(b.date)) : ''}
              </span>
            </div>
          `).join('')}
        </div>
      </div>
    </div>`;

  // Day-by-day table
  const tableRows = bucketed.filter(b => b.deposits > 0 || b.withdrawals > 0);
  const tableHtml = tableRows.length === 0 ? '' : `
    <div class="rounded-2xl bg-white border border-stone-200 overflow-hidden print-card fade-up">
      <table class="w-full" style="border-collapse: collapse; font-size: 12.5px;">
        <thead>
          <tr style="border-bottom: 1px solid #e5e3de;">
            <th class="text-left py-3 px-4 font-semibold text-stone-500 text-[10.5px] uppercase tracking-wider">Date</th>
            <th class="text-right py-3 px-4 font-semibold text-stone-500 text-[10.5px] uppercase tracking-wider">Deposits</th>
            <th class="text-right py-3 px-4 font-semibold text-stone-500 text-[10.5px] uppercase tracking-wider">Withdrawals</th>
            <th class="text-right py-3 px-4 font-semibold text-stone-500 text-[10.5px] uppercase tracking-wider">Net</th>
          </tr>
        </thead>
        <tbody>
          ${tableRows.map((b, i) => {
            const border = i < tableRows.length - 1 ? 'border-bottom: 1px solid #f1efea;' : '';
            const netClass = b.net >= 0 ? 'text-emerald-600' : 'text-red-600';
            const netSign = b.net >= 0 ? '+' : '−';
            return `
              <tr style="${border}">
                <td class="py-2.5 px-4 font-semibold text-stone-800">${fmtDateShort(b.date)}</td>
                <td class="py-2.5 px-4 text-right text-emerald-600 font-semibold tabular-nums">+GH₵${formatGHS(b.deposits)}</td>
                <td class="py-2.5 px-4 text-right text-red-600 font-semibold tabular-nums">−GH₵${formatGHS(b.withdrawals)}</td>
                <td class="py-2.5 px-4 text-right font-bold ${netClass} tabular-nums">${netSign}GH₵${formatGHS(Math.abs(b.net))}</td>
              </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>`;

  const extras = `
    <div class="grid grid-cols-2 gap-3 mt-4 pt-4 border-t border-stone-700/60">
      <div>
        <p class="text-[10.5px] uppercase tracking-wider text-stone-400">Total deposits</p>
        <p class="text-[15px] font-bold text-emerald-400 mt-0.5">+GH₵${formatGHS(dep)}</p>
      </div>
      <div class="text-right">
        <p class="text-[10.5px] uppercase tracking-wider text-stone-400">Total withdrawals</p>
        <p class="text-[15px] font-bold text-red-400 mt-0.5">−GH₵${formatGHS(wd)}</p>
      </div>
    </div>`;

  reportContent.innerHTML = `
    ${heroCard('Net movement', (net >= 0 ? '+' : '−') + `GH₵${formatGHS(Math.abs(net))}`, 'gold', '', extras)}
    <div id="balanceChartContainer" class="rounded-2xl bg-white border border-stone-200 p-5 mb-5 print-card fade-up">
      <div class="flex items-start justify-between mb-4">
        <div>
          <div class="skeleton h-4 w-32 mb-2"></div>
          <div class="skeleton h-3 w-48"></div>
        </div>
        <div class="skeleton h-5 w-24"></div>
      </div>
      <div class="skeleton w-full" style="height: 240px;"></div>
    </div>
    ${barChartHtml}
    ${tableHtml}
  `;

  requestAnimationFrame(() => {
    renderBalanceChart('balanceChartContainer', tx, range);
    setupChartResize('balanceChartContainer');
  });
}

/* ---------- Collectors ---------- */
function renderCollectors() {
  const byUser = new Map();
  for (const t of tx) {
    const uid = t.createdBy || 'unknown';
    const e = byUser.get(uid) || { uid, name: t.createdByName || 'Unknown', deposits: 0, withdrawals: 0, count: 0 };
    const amt = Number(t.amount) || 0;
    if (t.type === 'deposit') e.deposits += amt; else e.withdrawals += amt;
    e.count++;
    byUser.set(uid, e);
  }
  const entries = Array.from(byUser.values()).sort((a,b) => b.count - a.count);
  const totalTx = tx.length;

  const tableHtml = entries.length === 0 ? `
    <div class="rounded-2xl bg-white border border-stone-200 p-8 text-center print-card">
      <i class="fa-solid fa-user-tie text-3xl text-stone-300"></i>
      <p class="mt-3 text-[13px] font-semibold text-stone-700">No collector activity in this period.</p>
    </div>` : `
    <div class="rounded-2xl bg-white border border-stone-200 overflow-hidden print-card fade-up">
      <table class="w-full" style="border-collapse: collapse; font-size: 12.5px;">
        <thead>
          <tr style="border-bottom: 1px solid #e5e3de;">
            <th class="text-left py-3 px-4 font-semibold text-stone-500 text-[10.5px] uppercase tracking-wider">Collector</th>
            <th class="text-right py-3 px-4 font-semibold text-stone-500 text-[10.5px] uppercase tracking-wider">Deposits</th>
            <th class="text-right py-3 px-4 font-semibold text-stone-500 text-[10.5px] uppercase tracking-wider">Withdrawals</th>
            <th class="text-right py-3 px-4 font-semibold text-stone-500 text-[10.5px] uppercase tracking-wider">Txns</th>
          </tr>
        </thead>
        <tbody>
          ${entries.map((u, i) => {
            const border = i < entries.length - 1 ? 'border-bottom: 1px solid #f1efea;' : '';
            return `
              <tr style="${border}">
                <td class="py-3 px-4 text-stone-800 font-semibold">${escapeHtml(u.name)}</td>
                <td class="py-3 px-4 text-right text-emerald-600 font-semibold tabular-nums whitespace-nowrap">GH₵${formatGHS(u.deposits)}</td>
                <td class="py-3 px-4 text-right text-red-600 font-semibold tabular-nums whitespace-nowrap">GH₵${formatGHS(u.withdrawals)}</td>
                <td class="py-3 px-4 text-right font-bold text-stone-900">${u.count}</td>
              </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>`;

  const extras = `
    <div class="grid grid-cols-2 gap-3 mt-4 pt-4 border-t border-stone-700/60">
      <div>
        <p class="text-[10.5px] uppercase tracking-wider text-stone-400">Collectors active</p>
        <p class="text-[15px] font-bold text-white mt-0.5">${entries.length}</p>
      </div>
      <div class="text-right">
        <p class="text-[10.5px] uppercase tracking-wider text-stone-400">Total transactions</p>
        <p class="text-[15px] font-bold text-white mt-0.5">${totalTx}</p>
      </div>
    </div>`;

  reportContent.innerHTML = `
    ${heroCard('Collector activity', `${entries.length} active`, 'gold', '', extras)}
    ${tableHtml}
  `;
}

/* ---------- Customers ---------- */
function renderCustomers() {
  const byCust = new Map();
  for (const t of tx) {
    if (t.type !== 'deposit') continue;
    const id = t.customerId;
    if (!id) continue;
    const e = byCust.get(id) || { id, name: t.customerName || '—', accountNumber: t.accountNumber || '', deposits: 0, count: 0 };
    e.deposits += Number(t.amount) || 0;
    e.count++;
    byCust.set(id, e);
  }
  const entries = Array.from(byCust.values()).sort((a,b) => b.deposits - a.deposits);
  const topEntries = entries.slice(0, 10);
  const totalDeposits = entries.reduce((s,e) => s + e.deposits, 0);

  const tableHtml = topEntries.length === 0 ? `
    <div class="rounded-2xl bg-white border border-stone-200 p-8 text-center print-card">
      <i class="fa-solid fa-users text-3xl text-stone-300"></i>
      <p class="mt-3 text-[13px] font-semibold text-stone-700">No deposits in this period.</p>
    </div>` : `
    <div class="rounded-2xl bg-white border border-stone-200 overflow-hidden print-card fade-up">
      <div class="px-4 py-3 border-b border-stone-100 flex items-center justify-between">
        <p class="text-[12.5px] font-bold text-stone-900">Top depositors</p>
        <p class="text-[10.5px] text-stone-500">by deposit volume</p>
      </div>
      <table class="w-full" style="border-collapse: collapse; font-size: 12.5px;">
        <tbody>
          ${topEntries.map((c, i) => {
            const border = i < topEntries.length - 1 ? 'border-bottom: 1px solid #f1efea;' : '';
            return `
              <tr style="${border}">
                <td class="py-3 px-4 align-middle" style="width: 32px;">
                  <span class="w-6 h-6 rounded-full bg-brand-gold/15 text-brand-gold text-[11px] font-bold flex items-center justify-center">
                    ${i + 1}
                  </span>
                </td>
                <td class="py-3 px-2 align-middle">
                  <a href="customer.html?id=${encodeURIComponent(c.id)}" class="font-semibold text-stone-800 hover:text-brand-gold">
                    ${escapeHtml(c.name)}
                  </a>
                  <span class="block text-[10.5px] font-mono text-stone-400 mt-0.5">${escapeHtml(c.accountNumber)}</span>
                </td>
                <td class="py-3 px-4 align-middle text-right">
                  <span class="font-bold text-emerald-600 tabular-nums">GH₵${formatGHS(c.deposits)}</span>
                  <span class="block text-[10.5px] text-stone-400 mt-0.5">${c.count} deposit${c.count === 1 ? '' : 's'}</span>
                </td>
              </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>`;

  const extras = `
    <div class="grid grid-cols-2 gap-3 mt-4 pt-4 border-t border-stone-700/60">
      <div>
        <p class="text-[10.5px] uppercase tracking-wider text-stone-400">Customers served</p>
        <p class="text-[15px] font-bold text-white mt-0.5">${entries.length}</p>
      </div>
      <div class="text-right">
        <p class="text-[10.5px] uppercase tracking-wider text-stone-400">Total deposits</p>
        <p class="text-[15px] font-bold text-emerald-400 mt-0.5">GH₵${formatGHS(totalDeposits)}</p>
      </div>
    </div>`;

  reportContent.innerHTML = `
    ${heroCard('Customer activity', `${entries.length} served`, 'gold', '', extras)}
    ${tableHtml}
  `;
}

/* ---------- Period pills ---------- */
periodPills.forEach(btn => {
  btn.addEventListener('click', () => {
    currentPeriod = btn.getAttribute('data-period');
    setActivePill();
    if (currentPeriod === 'custom') {
      if (!fromInput.value) { const s = new Date(); s.setDate(1); fromInput.value = ymd(s); }
      if (!toInput.value) toInput.value = ymd(new Date());
      fromInput.focus();
    } else {
      load();
    }
  });
});

applyCustomBtn.addEventListener('click', () => {
  if (!fromInput.value || !toInput.value) { showError('Please pick both dates.'); return; }
  if (new Date(fromInput.value) > new Date(toInput.value)) { showError('Start must be before end.'); return; }
  load();
});

/* ---------- CSV ---------- */
exportCsvBtn.addEventListener('click', () => {
  if (!tx.length) { alert('Nothing to export.'); return; }
  const headers = ['Date','Time','Type','Customer','Account','Amount','Method','Reference','Balance After','Collector'];
  const rows = tx.map(t => {
    const d = tsToDate(t.createdAt);
    return [
      d ? d.toLocaleDateString('en-GB') : '',
      d ? d.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'}) : '',
      t.type === 'deposit' ? 'Deposit' : 'Withdrawal',
      t.customerName || '', t.accountNumber || '',
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
  a.download = `ASV-${type}-${ymd(range.start)}-to-${ymd(range.end)}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

/* ---------- Share ---------- */
shareBtn.addEventListener('click', async () => {
  const text = `${TYPES[type].title} — ${range.label}\n\nArea Supa Ventures\nGenerated ${new Date().toLocaleString('en-GB')}`;
  if (navigator.share) {
    try { await navigator.share({ title: TYPES[type].title, text }); return; }
    catch (e) { if (e?.name === 'AbortError') return; }
  }
  window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
});

/* ---------- Print ---------- */
printBtn.addEventListener('click', () => window.print());

/* ---------- Refresh ---------- */
refreshBtn.addEventListener('click', () => {
  refreshBtn.querySelector('i').classList.add('fa-spin');
  load().finally(() => setTimeout(() => refreshBtn.querySelector('i').classList.remove('fa-spin'), 400));
});

retryBtn.addEventListener('click', load);

/* ---------- Init ---------- */
const __session = await requireSession({ permission: 'reports.view' });
{
  const u = __session.user;
  currentUser = u;
  setActivePill();
  load();
}
