// notifications.html page script
import { requireSession } from './lib/session.js';
import { mountBottomNav } from '../components/bottom-nav.js';
import {
  auth, db,
  subscribeUnreadCount, markAllAsRead, deleteNotification
} from '../components/notifications.js';
import {
  collection, query, where, orderBy, limit, onSnapshot
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

mountBottomNav('profile');

/* ---------- Refs ---------- */
const $ = (id) => document.getElementById(id);
const subHeader = $('subHeader');
const loadError = $('loadError'), loadErrorMsg = $('loadErrorMsg'), retryBtn = $('retryBtn');
const offlineBanner = $('offlineBanner');
const filterButtons = document.querySelectorAll('.filter-pill');
const feed = $('feed');
const emptyState = $('emptyState'), emptyIcon = $('emptyIcon');
const emptyTitle = $('emptyTitle'), emptyBody = $('emptyBody');
const emptyClearFilter = $('emptyClearFilter');
const markAllBtn = $('markAllBtn'), refreshBtn = $('refreshBtn');
const lastUpdatedEl = $('lastUpdated');

/* ---------- State ---------- */
let currentUser = null;
let allNotifs = [];
let currentFilter = 'all';
let unsub = null;
let unreadCount = 0;

/* ---------- Helpers ---------- */
function formatGHS(n) { const v = Number(n)||0; return v.toLocaleString('en-GH',{minimumFractionDigits:2,maximumFractionDigits:2}); }
function escapeHtml(s){ return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function tsToDate(v){ if(!v) return null; if(v.toDate) return v.toDate(); if(v instanceof Date) return v; return new Date(v); }

function fmtRelative(d) {
  if (!d) return '';
  const diff = Date.now() - d.getTime();
  const sec = Math.floor(diff/1000);
  if (sec < 30) return 'Just now';
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec/60);
  if (min < 60) return `${min} min${min===1?'':'s'} ago`;
  const hr = Math.floor(min/60);
  if (hr < 24) return `${hr} hr${hr===1?'':'s'} ago`;
  const day = Math.floor(hr/24);
  if (day < 7) return `${day} day${day===1?'':'s'} ago`;
  return d.toLocaleDateString('en-GB',{day:'2-digit',month:'short'});
}

function startOfDay(d){ const x = new Date(d); x.setHours(0,0,0,0); return x; }
function dayLabel(d) {
  if (!d) return 'Earlier';
  const today = startOfDay(new Date()).getTime();
  const yesterday = today - 86400000;
  const t = startOfDay(d).getTime();
  if (t === today) return 'Today';
  if (t === yesterday) return 'Yesterday';
  if (t > today - 7 * 86400000) return 'This week';
  return d.toLocaleDateString('en-GB',{day:'2-digit',month:'long',year:'numeric'});
}

/* Type → visual mapping */
function typeMeta(t) {
  const map = {
    deposit:           { bg: 'bg-emerald-50',  fg: 'text-emerald-600', icon: 'fa-arrow-down-to-line' },
    withdrawal:        { bg: 'bg-red-50',      fg: 'text-red-600',     icon: 'fa-arrow-up-from-bracket' },
    withdrawal_failed: { bg: 'bg-red-50',      fg: 'text-red-600',     icon: 'fa-circle-exclamation' },
    sync_pending:      { bg: 'bg-amber-50',    fg: 'text-amber-600',   icon: 'fa-cloud-arrow-up' },
    sync_failed:       { bg: 'bg-red-50',      fg: 'text-red-600',     icon: 'fa-triangle-exclamation' },
    welcome:           { bg: 'bg-brand-gold/15', fg: 'text-brand-gold', icon: 'fa-user-plus' },
    system:            { bg: 'bg-blue-50',     fg: 'text-blue-600',    icon: 'fa-bullhorn' }
  };
  return map[t] || { bg: 'bg-stone-100', fg: 'text-stone-600', icon: 'fa-bell' };
}

/* ---------- Filtering ---------- */
function matchesFilter(n) {
  if (currentFilter === 'all') return true;
  if (currentFilter === 'unread') return !n.read;
  if (currentFilter === 'deposit') return n.type === 'deposit';
  if (currentFilter === 'withdrawal') return n.type === 'withdrawal' || n.type === 'withdrawal_failed';
  if (currentFilter === 'system') return n.type === 'system' || n.type === 'sync_pending' || n.type === 'sync_failed' || n.type === 'welcome';
  return true;
}

/* ---------- Rendering ---------- */
function render() {
  const items = allNotifs.filter(matchesFilter);

  if (!items.length) {
    feed.innerHTML = '';
    feed.classList.add('hidden');
    emptyState.classList.remove('hidden');

    if (allNotifs.length === 0) {
      emptyIcon.className = 'fa-solid fa-bell text-2xl text-brand-gold';
      emptyTitle.textContent = 'No notifications yet';
      emptyBody.textContent = 'Notifications about deposits, withdrawals and sync status will appear here.';
      emptyClearFilter.classList.add('hidden');
    } else {
      emptyIcon.className = 'fa-solid fa-filter-circle-xmark text-2xl text-brand-gold';
      emptyTitle.textContent = currentFilter === 'unread' ? 'You’re all caught up' : 'No notifications match this filter';
      emptyBody.textContent = currentFilter === 'unread'
        ? 'No unread notifications. Nice work!'
        : 'Try a different filter to see more.';
      emptyClearFilter.classList.toggle('hidden', currentFilter === 'all');
    }
    return;
  }

  feed.classList.remove('hidden');
  emptyState.classList.add('hidden');

  // Group by day
  const groups = new Map();
  for (const n of items) {
    const d = tsToDate(n.createdAt);
    const key = d ? dayLabel(d) : 'Earlier';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ ...n, _date: d });
  }

  feed.innerHTML = Array.from(groups.entries()).map(([label, list]) => `
    <div class="mb-4">
      <p class="text-[11px] font-semibold uppercase tracking-[0.14em] text-stone-400 mb-2 ml-1">${escapeHtml(label)}</p>
      <div class="rounded-2xl bg-white border border-stone-200 overflow-hidden">
        ${list.map(renderItem).join('')}
      </div>
    </div>
  `).join('');
}

function renderItem(n) {
  const meta = typeMeta(n.type);
  const isUnread = !n.read;
  const timeStr = n._date ? fmtRelative(n._date) : '';

  // Determine target URL
  let target = null;
  if (n.customerId) {
    target = `customer.html?id=${encodeURIComponent(n.customerId)}`;
  } else if (n.transactionId && !n.customerId) {
    target = `transactions.html`;
  }

  const row = `
    <div class="notif-item relative ${isUnread ? 'bg-brand-gold/[0.03]' : ''}"
         data-id="${escapeHtml(n.id)}"
         data-target="${target ? escapeHtml(target) : ''}">
      <div class="flex items-start gap-3 p-4 ${target ? 'cursor-pointer' : ''}" data-action="open">
        <div class="w-10 h-10 rounded-full ${meta.bg} ${meta.fg} flex items-center justify-center shrink-0 relative">
          <i class="fa-solid ${meta.icon} text-[15px]"></i>
          ${isUnread ? '<span class="unread-dot absolute -top-0.5 -right-0.5 ring-2 ring-white"></span>' : ''}
        </div>
        <div class="flex-1 min-w-0 pr-6">
          <div class="flex items-start justify-between gap-2">
            <p class="text-[13.5px] font-bold text-stone-900 leading-tight pr-2 ${isUnread ? '' : 'text-stone-700'}">
              ${escapeHtml(n.title)}
            </p>
            <span class="text-[10.5px] text-stone-400 whitespace-nowrap shrink-0">${timeStr}</span>
          </div>
          ${n.body ? `<p class="text-[12px] text-stone-500 mt-0.5 leading-relaxed">${escapeHtml(n.body)}</p>` : ''}
          ${n.amount ? `
            <p class="text-[12px] font-semibold mt-1 ${n.type === 'deposit' ? 'text-emerald-600' : 'text-red-600'}">
              ${n.type === 'deposit' ? '+' : '−'}GH₵${formatGHS(n.amount)}
            </p>` : ''}
        </div>
      </div>
      <button type="button" data-action="delete"
              aria-label="Delete notification"
              class="delete-btn absolute top-3 right-3 w-7 h-7 rounded-lg text-stone-400 hover:text-red-600 hover:bg-red-50 transition-colors flex items-center justify-center">
        <i class="fa-solid fa-xmark text-[13px]"></i>
      </button>
    </div>
  `;
  return row;
}

/* ---------- Interaction ---------- */
feed.addEventListener('click', async (e) => {
  const deleteBtn = e.target.closest('[data-action="delete"]');
  const openArea = e.target.closest('[data-action="open"]');
  const item = e.target.closest('.notif-item');
  if (!item) return;

  const id = item.getAttribute('data-id');
  const target = item.getAttribute('data-target');
  const notif = allNotifs.find(x => x.id === id);

  if (deleteBtn) {
    e.stopPropagation();
    item.style.transition = 'opacity 200ms, transform 200ms';
    item.style.opacity = '0';
    item.style.transform = 'translateX(-8px)';
    try {
      await deleteNotification(id);
      setTimeout(() => item.remove(), 200);
    } catch (err) {
      console.error('Delete failed:', err);
      item.style.opacity = '1';
      item.style.transform = 'none';
    }
    return;
  }

  if (openArea && notif) {
    // Mark as read (fire and forget — UI updates via subscription)
    if (!notif.read) {
      import('../components/notifications.js').then(({ markAsRead }) => markAsRead(id));
    }
    if (target) {
      window.location.href = target;
    }
  }
});

/* ---------- Filter buttons ---------- */
function setActiveFilter() {
  filterButtons.forEach(b => {
    const active = b.getAttribute('data-filter') === currentFilter;
    b.className = 'filter-pill shrink-0 px-3.5 py-2 rounded-full text-[12px] font-semibold ' + (
      active
        ? 'bg-[#212121] text-white shadow'
        : 'bg-white border border-stone-200 text-stone-600 hover:text-stone-900'
    );
  });
}

filterButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    currentFilter = btn.getAttribute('data-filter');
    setActiveFilter();
    render();
  });
});

emptyClearFilter.addEventListener('click', () => {
  currentFilter = 'all';
  setActiveFilter();
  render();
});

/* ---------- Mark all as read ---------- */
markAllBtn.addEventListener('click', async () => {
  if (unreadCount === 0) return;
  markAllBtn.disabled = true;
  markAllBtn.querySelector('i').classList.add('fa-spin');
  try {
    const count = await markAllAsRead();
    if (count > 0) showToast(`${count} notification${count === 1 ? '' : 's'} marked as read`);
  } catch (e) {
    console.error('Mark all failed:', e);
    showToast('Could not mark all as read', 'error');
  } finally {
    markAllBtn.disabled = false;
    markAllBtn.querySelector('i').classList.remove('fa-spin');
  }
});

/* ---------- Toast ---------- */
function showToast(msg, tone = 'default') {
  const el = document.createElement('div');
  el.className = 'fixed bottom-6 left-1/2 -translate-x-1/2 z-[60] px-4 py-2.5 rounded-xl text-white text-[12.5px] font-medium shadow-lg fade-up ' +
    (tone === 'error' ? 'bg-[#B93838]' : 'bg-stone-900');
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => {
    el.style.transition = 'opacity 250ms';
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 300);
  }, 2200);
}

/* ---------- Offline/online ---------- */
function updateOfflineBanner() {
  offlineBanner.classList.toggle('hidden', navigator.onLine);
}
window.addEventListener('online', updateOfflineBanner);
window.addEventListener('offline', updateOfflineBanner);

/* ---------- Live subscription ---------- */
function subscribeFeed(user) {
  if (unsub) { unsub(); unsub = null; }
  const q = query(
    collection(db, 'notifications'),
    where('userId', '==', user.uid),
    orderBy('createdAt', 'desc'),
    limit(100)
  );
  unsub = onSnapshot(q,
    (snap) => {
      allNotifs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      const now = new Date();
      lastUpdatedEl.innerHTML = `<i class="fa-regular fa-clock mr-1"></i> Live · ${now.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'})}`;
      render();
    },
    (err) => {
      console.error('Feed subscription error:', err);
      loadErrorMsg.textContent = err?.message?.toLowerCase().includes('permission')
        ? 'You don’t have permission to read notifications.'
        : 'Could not load notifications. Check your connection.';
      loadError.classList.remove('hidden');
    }
  );
}

/* ---------- Init ---------- */
{
  const u = (await requireSession()).user;
  currentUser = u;
  setActiveFilter();
  updateOfflineBanner();
  subscribeFeed(u);

  // Unread count for header label
  subscribeUnreadCount((count) => {
    unreadCount = count;
    subHeader.textContent = count > 0
      ? `${count} unread`
      : 'All caught up';
    markAllBtn.disabled = count === 0;
  });
}
