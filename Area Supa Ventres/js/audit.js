// audit.html page script
import {
  collection, query, orderBy, limit, startAfter, getDocs
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db } from './lib/firebase.js';
import { requireSession } from './lib/session.js';
import { $, escapeHtml, tsToDate } from './lib/ui.js';
import { mountBottomNav } from '../components/bottom-nav.js';

mountBottomNav('profile');
await requireSession({ permission: 'audit.view' });

const ICONS = {
  customer: ['fa-user', 'bg-brand-gold/15 text-brand-gold'],
  'customer.delete': ['fa-trash-can', 'bg-red-50 text-red-700'],
  staff: ['fa-user-shield', 'bg-blue-50 text-blue-700'],
  sms: ['fa-comment-sms', 'bg-emerald-50 text-emerald-700'],
  transaction: ['fa-money-bill-transfer', 'bg-amber-50 text-amber-700'],
  settings: ['fa-gear', 'bg-stone-100 text-stone-600'],
  data: ['fa-database', 'bg-stone-100 text-stone-600']
};
const PAGE = 40;
let cursor = null;

function iconFor(action) {
  return ICONS[action] || ICONS[action.split('.')[0]] || ['fa-circle-info', 'bg-stone-100 text-stone-600'];
}

function row(a) {
  const [icon, cls] = iconFor(a.action || '');
  const when = tsToDate(a.at);
  const d = a.details || {};
  const extra = a.action === 'customer.delete' && d.reason ? `<p class="text-[11px] text-stone-500 mt-0.5">Reason: ${escapeHtml(d.reason)}</p>` : '';
  return `
    <div class="p-4 flex items-start gap-3">
      <div class="w-9 h-9 rounded-full ${cls} flex items-center justify-center shrink-0"><i class="fa-solid ${icon} text-[13px]"></i></div>
      <div class="min-w-0 flex-1">
        <p class="text-[13px] font-semibold text-stone-900">${escapeHtml(a.summary || a.action)}</p>
        ${extra}
        <p class="text-[11px] text-stone-400 mt-0.5">${escapeHtml(a.actorName || 'System')}${a.actorRole ? ` (${escapeHtml(a.actorRole)})` : ''}
          ${when ? ' · ' + when.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''}</p>
      </div>
    </div>`;
}

async function load(reset) {
  const clauses = [orderBy('at', 'desc')];
  if (!reset && cursor) clauses.push(startAfter(cursor));
  clauses.push(limit(PAGE));
  try {
    const snap = await getDocs(query(collection(db, 'auditLogs'), ...clauses));
    const html = snap.docs.map((d) => row(d.data())).join('');
    if (reset) $('auditList').innerHTML = html || '<p class="p-8 text-center text-sm text-stone-500">No activity recorded yet.</p>';
    else $('auditList').insertAdjacentHTML('beforeend', html);
    cursor = snap.docs[snap.docs.length - 1] || cursor;
    $('moreBtn').classList.toggle('hidden', snap.docs.length < PAGE);
  } catch (e) {
    console.error(e);
    $('auditList').innerHTML = '<p class="p-8 text-center text-sm text-red-700">Could not load the audit log.</p>';
  }
}

$('moreBtn').addEventListener('click', () => load(false));
load(true);
