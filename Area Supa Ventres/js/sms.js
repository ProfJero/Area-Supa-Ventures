// sms.html page script — send personalised SMS, manage automatic alerts and
// greetings, see history, and buy SMS units from ProfJero Connect.
import {
  collection, doc, getDoc, getDocs, query, orderBy, limit, startAfter
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db } from './lib/firebase.js';
import { requireSession } from './lib/session.js';
import { call, newRequestId } from './lib/api.js';
import { $, escapeHtml, formatGHS, toast, confirmDialog, setBusy, debounce, tsToDate, prettyIsoDate } from './lib/ui.js';
import { searchCustomers } from './lib/customer-search.js';
import {
  CUSTOMER_FIELDS, TRANSACTION_FIELDS, renderTemplate, sampleValues, unknownFields, smsPages
} from './lib/sms-template.js';
import { mountBottomNav } from '../components/bottom-nav.js';

mountBottomNav('sms');
const session = await requireSession({ permission: 'sms.send' });
const params = new URLSearchParams(location.search);
const businessName = session.settings.businessName || 'Area Supa Ventures';

/* ------------------------------ Tabs ------------------------------ */
const loaded = {};
function showTab(name) {
  if (!document.querySelector(`.tab-btn[data-tab="${name}"]`)) name = 'send';
  document.querySelectorAll('.tab-btn').forEach((b) => {
    const on = b.dataset.tab === name;
    b.className = 'tab-btn flex-1 whitespace-nowrap px-3 py-2 rounded-lg text-[12.5px] font-semibold ' +
      (on ? 'bg-[#212121] text-white' : 'text-stone-500 hover:text-stone-800');
    b.setAttribute('aria-selected', String(on));
  });
  document.querySelectorAll('[data-panel]').forEach((p) => p.classList.toggle('hidden', p.dataset.panel !== name));
  if (!loaded[name]) {
    loaded[name] = true;
    ({ auto: loadAuto, history: () => loadHistory(true), billing: loadBilling })[name]?.();
  }
}
document.querySelectorAll('.tab-btn').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
document.querySelectorAll('[data-tab-go]').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tabGo)));

/* ------------------------------ Wallet ------------------------------ */
let senderIds = [];
async function loadWallet() {
  try {
    const { wallet, senderIds: ids } = await call('smsOverview');
    senderIds = ids || [];
    $('units').textContent = Number(wallet?.availableUnits || 0).toLocaleString('en-GH');
    const reserved = Number(wallet?.reservedUnits || 0);
    $('unitsSub').textContent = (wallet?.lowBalance ? 'Low balance — top up soon. ' : '') +
      (reserved ? `${reserved.toLocaleString('en-GH')} units reserved for messages in progress.` : '1 unit = 1 SMS page to 1 person');
    if (wallet?.lowBalance) $('unitsSub').className = 'text-[11px] text-amber-300 mt-0.5 font-semibold';
    $('walletError').classList.add('hidden');
  } catch (e) {
    $('units').textContent = '—';
    $('walletError').textContent = e.message;
    $('walletError').classList.remove('hidden');
  }
  return senderIds;
}
const walletReady = loadWallet();

/* ------------------------------ Send ------------------------------ */
const messageEl = $('message');
const chosen = new Map(); // id -> customer

function fieldChipsHtml(fields) {
  return fields.map((f) => `<button type="button" data-field="${f.key}" class="chip hover:border-brand-gold hover:text-brand-gold">
      <i class="fa-solid fa-plus text-[9px]"></i>${escapeHtml(f.label)}</button>`).join('');
}

function insertAtCursor(textarea, text) {
  const start = textarea.selectionStart ?? textarea.value.length;
  const end = textarea.selectionEnd ?? textarea.value.length;
  textarea.value = textarea.value.slice(0, start) + text + textarea.value.slice(end);
  textarea.focus();
  textarea.selectionStart = textarea.selectionEnd = start + text.length;
  textarea.dispatchEvent(new Event('input'));
}

$('fieldChips').innerHTML = fieldChipsHtml(CUSTOMER_FIELDS);
$('fieldChips').addEventListener('click', (e) => {
  const b = e.target.closest('[data-field]');
  if (b) insertAtCursor(messageEl, `{${b.dataset.field}}`);
});

function previewValues() {
  const c = chosen.values().next().value;
  if (!c) return { values: sampleValues(), who: '(sample customer)' };
  const parts = String(c.fullName || '').split(/\s+/);
  return {
    who: `(for ${c.fullName})`,
    values: {
      ...sampleValues(),
      first_name: c.firstName || parts[0] || 'Customer',
      last_name: c.lastName || parts[parts.length - 1] || '-',
      full_name: c.fullName || 'Customer',
      customer_id: c.accountNumber || '-',
      phone: c.phone || '-',
      tel2: c.tel2 || '-',
      branch: c.branch || '-',
      balance: formatGHS(c.balance),
      registration_date: prettyIsoDate(c.registrationDate) || '-',
      company: businessName
    }
  };
}

function updatePreview() {
  const text = messageEl.value;
  const { values, who } = previewValues();
  const rendered = renderTemplate(text, values);
  $('preview').textContent = rendered || '—';
  $('previewWho').textContent = who;
  const p = smsPages(rendered);
  $('msgCount').textContent = `${p.length} characters · ${p.pages} page${p.pages === 1 ? '' : 's'} per person${p.unicode ? ' · Unicode' : ''}`;
  const unknown = unknownFields(text);
  $('msgWarn').textContent = unknown.length
    ? `Unknown field: ${unknown.map((k) => `{${k}}`).join(', ')}`
    : (p.unicode ? 'Symbols like ₵ or emoji make each page shorter (70 characters).' : '');
  $('estimateBox').classList.add('hidden');
}
messageEl.addEventListener('input', updatePreview);

function audienceType() {
  return document.querySelector('input[name="audience"]:checked')?.value || 'customers';
}
function onAudienceChange() {
  const t = audienceType();
  $('pickCustomers').classList.toggle('hidden', t !== 'customers');
  $('pickBranch').classList.toggle('hidden', t !== 'branch');
  $('allNote').classList.toggle('hidden', t !== 'all');
  $('estimateBox').classList.add('hidden');
}
document.querySelectorAll('input[name="audience"]').forEach((r) => r.addEventListener('change', onAudienceChange));

const branches = session.settings.branches || [];
$('branchSel').innerHTML = branches.length
  ? branches.map((b) => `<option value="${escapeHtml(b)}">${escapeHtml(b)}</option>`).join('')
  : '<option value="">No branches set up (Settings)</option>';

function renderChosen() {
  $('chosen').innerHTML = [...chosen.values()].map((c) => `
    <span class="chip !py-1.5">${escapeHtml(c.fullName)} <span class="font-mono text-stone-400">${escapeHtml(c.accountNumber || '')}</span>
      ${c.smsOptOut ? '<span class="text-amber-700">(opted out)</span>' : ''}
      <button type="button" data-remove="${escapeHtml(c.id)}" class="ml-1 text-stone-400 hover:text-red-700" aria-label="Remove"><i class="fa-solid fa-xmark"></i></button>
    </span>`).join('') || '<span class="text-[12px] text-stone-400">No customers chosen yet.</span>';
  updatePreview();
}
$('chosen').addEventListener('click', (e) => {
  const b = e.target.closest('[data-remove]');
  if (b) { chosen.delete(b.dataset.remove); renderChosen(); }
});

let lastResults = [];
const runPickerSearch = debounce(async () => {
  const q = $('custSearch').value.trim();
  const box = $('custResults');
  if (q.length < 2) { box.classList.add('hidden'); return; }
  try {
    lastResults = (await searchCustomers(q)).slice(0, 20);
    box.innerHTML = lastResults.map((c) => `
      <button type="button" data-pick="${escapeHtml(c.id)}" class="w-full text-left px-4 py-2.5 hover:bg-stone-50">
        <span class="block text-[13px] font-semibold text-stone-900">${escapeHtml(c.fullName)}</span>
        <span class="block text-[11px] text-stone-500 font-mono">${escapeHtml([c.accountNumber, c.phone].filter(Boolean).join(' · '))}</span>
      </button>`).join('') || '<p class="px-4 py-3 text-[12px] text-stone-500">No matches.</p>';
    box.classList.remove('hidden');
  } catch {
    box.innerHTML = '<p class="px-4 py-3 text-[12px] text-red-700">Search failed.</p>';
    box.classList.remove('hidden');
  }
}, 300);
$('custSearch').addEventListener('input', runPickerSearch);
$('custResults').addEventListener('click', (e) => {
  const b = e.target.closest('[data-pick]');
  if (!b) return;
  const c = lastResults.find((x) => x.id === b.dataset.pick);
  if (c) chosen.set(c.id, c);
  $('custSearch').value = '';
  $('custResults').classList.add('hidden');
  renderChosen();
});
document.addEventListener('click', (e) => {
  if (!e.target.closest('#pickCustomers')) $('custResults').classList.add('hidden');
});

$('scheduleOn').addEventListener('change', () => {
  $('scheduleAt').classList.toggle('hidden', !$('scheduleOn').checked);
  if ($('scheduleOn').checked && !$('scheduleAt').value) {
    const d = new Date(Date.now() + 3600_000);
    d.setMinutes(0, 0, 0);
    $('scheduleAt').value = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  }
});

function buildAudience() {
  const t = audienceType();
  if (t === 'customers') {
    if (!chosen.size) throw new Error('Choose at least one customer.');
    return { type: 'customers', ids: [...chosen.keys()] };
  }
  if (t === 'branch') {
    if (!$('branchSel').value) throw new Error('Choose a branch.');
    return { type: 'branch', branch: $('branchSel').value };
  }
  return { type: 'all' };
}

function sendError(msg) {
  $('sendError').textContent = msg;
  $('sendError').classList.toggle('hidden', !msg);
}

let estimate = null;
async function runEstimate() {
  sendError('');
  const audience = buildAudience();
  const message = messageEl.value.trim();
  if (!message) throw new Error('Write a message first.');
  if (unknownFields(message).length) throw new Error('Remove the unknown {fields} from the message.');
  const est = await call('smsEstimate', { message, audience });
  estimate = { ...est, key: JSON.stringify([message, audience]) };
  const box = $('estimateBox');
  const ok = est.sufficient !== false;
  box.className = `rounded-xl border px-4 py-3 text-[12.5px] ${ok ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-red-200 bg-red-50 text-red-800'}`;
  box.innerHTML = `<p class="font-semibold">${est.recipients.toLocaleString('en-GH')} recipient${est.recipients === 1 ? '' : 's'} · ${est.units.toLocaleString('en-GH')} unit${est.units === 1 ? '' : 's'}</p>
    ${est.skipped ? `<p class="mt-0.5">${est.skipped} skipped (no valid phone or opted out).</p>` : ''}
    ${est.availableUnits != null ? `<p class="mt-0.5">You have ${Number(est.availableUnits).toLocaleString('en-GH')} units.${ok ? '' : ' Buy more units before sending.'}</p>` : ''}`;
  box.classList.remove('hidden');
  return estimate;
}

$('estimateBtn').addEventListener('click', async () => {
  const btn = $('estimateBtn');
  setBusy(btn, true, 'Checking…');
  try { await runEstimate(); } catch (e) { sendError(e.message); } finally { setBusy(btn, false); }
});

let sendRequestId = newRequestId();
$('sendBtn').addEventListener('click', async () => {
  const btn = $('sendBtn');
  sendError('');
  try {
    const audience = buildAudience();
    const message = messageEl.value.trim();
    let scheduleAt = null;
    if ($('scheduleOn').checked) {
      const t = new Date($('scheduleAt').value);
      if (Number.isNaN(t.getTime())) throw new Error('Choose when to send.');
      scheduleAt = t.toISOString();
    }
    setBusy(btn, true, 'Checking cost…');
    const est = estimate?.key === JSON.stringify([message, audience]) ? estimate : await runEstimate();
    setBusy(btn, false);
    if (!est.recipients) throw new Error('None of the chosen customers can receive SMS (no valid phone or opted out).');
    if (est.sufficient === false) throw new Error('Not enough SMS units. Buy more units first.');
    const ok = await confirmDialog({
      title: scheduleAt ? 'Schedule this SMS?' : 'Send this SMS now?',
      message: `${est.recipients.toLocaleString('en-GH')} recipient(s), about ${est.units.toLocaleString('en-GH')} unit(s)` +
        (scheduleAt ? `, on ${new Date(scheduleAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}` : '') + '.',
      confirmLabel: scheduleAt ? 'Schedule' : 'Send now'
    });
    if (!ok) return;
    setBusy(btn, true, scheduleAt ? 'Scheduling…' : 'Sending…');
    const res = await call('smsSend', { requestId: sendRequestId, message, audience, scheduleAt });
    sendRequestId = newRequestId();
    toast(res.status === 'scheduled'
      ? `Scheduled for ${res.recipients} recipient(s).`
      : `Sent to ${res.recipients} recipient(s).${res.status === 'partial' ? ' Some batches failed — see History.' : ''}`,
    { type: res.status === 'partial' ? 'error' : 'success', ms: 5000 });
    messageEl.value = '';
    chosen.clear();
    renderChosen();
    $('estimateBox').classList.add('hidden');
    loadWallet();
    loaded.history = false;
  } catch (e) {
    if (e.code !== 'cancelled') sendError(e.message);
  } finally {
    setBusy(btn, false);
  }
});

// Opened from a customer's page: pre-select them.
if (params.get('customerId')) {
  try {
    const snap = await getDoc(doc(db, 'customers', params.get('customerId')));
    if (snap.exists()) chosen.set(snap.id, { id: snap.id, ...snap.data() });
  } catch { /* ignore */ }
}
renderChosen();

/* ------------------------------ Automatic ------------------------------ */
const AUTO = [
  { key: 'deposit', title: 'Deposit alert', desc: 'Sent to the customer each time a deposit is recorded.', tx: true },
  { key: 'withdrawal', title: 'Withdrawal alert', desc: 'Sent to the customer each time a withdrawal is recorded.', tx: true },
  { key: 'welcome', title: 'Welcome message', desc: 'Sent when a new customer is registered.', tx: false }
];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
let occasions = [];

function templateCard({ id, title, desc, enabled, template, tx }) {
  return `
    <div class="bg-white rounded-2xl border border-stone-200 p-5 space-y-3" data-tpl="${id}">
      <div class="flex items-start justify-between gap-3">
        <div>
          <p class="text-[13.5px] font-bold text-stone-900">${escapeHtml(title)}</p>
          <p class="text-[11.5px] text-stone-500">${escapeHtml(desc)}</p>
        </div>
        <label class="inline-flex items-center gap-2 text-[12px] font-semibold text-stone-700 shrink-0">
          <input type="checkbox" data-enabled ${enabled ? 'checked' : ''} class="rounded border-stone-300 text-brand-charcoal focus:ring-0" /> On
        </label>
      </div>
      <div class="flex flex-wrap gap-1.5" data-chips>${fieldChipsHtml(tx ? [...CUSTOMER_FIELDS, ...TRANSACTION_FIELDS] : CUSTOMER_FIELDS)}</div>
      <textarea data-template rows="3" maxlength="1600" class="field-input">${escapeHtml(template)}</textarea>
      <p class="text-[11px] text-stone-500" data-preview></p>
    </div>`;
}

function wireTemplate(card) {
  const ta = card.querySelector('[data-template]');
  const pv = card.querySelector('[data-preview]');
  const upd = () => {
    const r = renderTemplate(ta.value, sampleValues());
    const p = smsPages(r);
    pv.textContent = `Preview: ${r} — ${p.pages} page${p.pages === 1 ? '' : 's'}`;
  };
  card.querySelector('[data-chips]').addEventListener('click', (e) => {
    const b = e.target.closest('[data-field]');
    if (b) insertAtCursor(ta, `{${b.dataset.field}}`);
  });
  ta.addEventListener('input', upd);
  upd();
}

function occasionHtml(o, i) {
  return `
    <div class="rounded-xl border border-stone-200 p-4 space-y-2" data-occ="${i}">
      <div class="grid grid-cols-1 sm:grid-cols-[1fr_auto_auto_auto] gap-2 items-center">
        <input data-name class="field-input !py-2" maxlength="40" placeholder="Occasion name" value="${escapeHtml(o.name || '')}" />
        <select data-month class="field-input !py-2">${MONTHS.map((m, k) => `<option value="${k + 1}" ${o.month === k + 1 ? 'selected' : ''}>${m}</option>`).join('')}</select>
        <input data-day type="number" min="1" max="31" class="field-input !py-2 w-20" value="${o.day || 1}" />
        <label class="inline-flex items-center gap-1.5 text-[12px] font-semibold text-stone-700">
          <input type="checkbox" data-enabled ${o.enabled ? 'checked' : ''} class="rounded border-stone-300 text-brand-charcoal focus:ring-0" /> On</label>
      </div>
      <div class="flex flex-wrap gap-1.5" data-chips>${fieldChipsHtml(CUSTOMER_FIELDS)}</div>
      <textarea data-template rows="2" maxlength="1600" class="field-input">${escapeHtml(o.template || '')}</textarea>
      <p class="text-[11px] text-stone-500" data-preview></p>
      <div class="flex items-center gap-3">
        ${o.id ? `<button type="button" data-send-now="${escapeHtml(o.id)}" class="text-[12px] font-semibold text-brand-gold hover:underline"><i class="fa-solid fa-paper-plane text-[10px]"></i> Send to all customers now</button>` : ''}
        <button type="button" data-del-occ="${i}" class="ml-auto text-[12px] font-semibold text-red-700 hover:underline">Remove</button>
      </div>
    </div>`;
}

function readOccasions() {
  return [...document.querySelectorAll('[data-occ]')].map((el) => ({
    id: occasions[Number(el.dataset.occ)]?.id,
    name: el.querySelector('[data-name]').value.trim(),
    month: Number(el.querySelector('[data-month]').value),
    day: Number(el.querySelector('[data-day]').value),
    enabled: el.querySelector('[data-enabled]').checked,
    template: el.querySelector('[data-template]').value.trim()
  }));
}

function renderOccasions() {
  $('occasions').innerHTML = occasions.map(occasionHtml).join('') || '<p class="text-[12px] text-stone-400">No occasions yet.</p>';
  document.querySelectorAll('[data-occ]').forEach(wireTemplate);
  document.querySelectorAll('[data-del-occ]').forEach((b) => b.addEventListener('click', () => {
    occasions = readOccasions();
    occasions.splice(Number(b.dataset.delOcc), 1);
    renderOccasions();
  }));
  document.querySelectorAll('[data-send-now]').forEach((b) => b.addEventListener('click', () => sendOccasionNow(b.dataset.sendNow)));
}

async function sendOccasionNow(id) {
  const o = occasions.find((x) => x.id === id);
  const ok = await confirmDialog({
    title: `Send “${o?.name}” now?`,
    message: 'The saved message goes to every active customer who can receive SMS. Save first if you changed the text.',
    confirmLabel: 'Send now'
  });
  if (!ok) return;
  try {
    const r = await call('smsSendOccasionNow', { occasionId: id, requestId: newRequestId() });
    toast(`Sent to ${r.recipients} customer(s).`, { type: 'success' });
    loadWallet();
  } catch (e) {
    if (e.code !== 'cancelled') toast(e.message, { type: 'error', ms: 6000 });
  }
}

async function loadAuto() {
  let s = {};
  try {
    const snap = await getDoc(doc(db, 'settings', 'sms'));
    s = snap.exists() ? snap.data() : {};
  } catch { /* use defaults */ }
  const auto = s.autoSms || {};
  const defaults = {
    deposit: 'Dear {first_name}, GHS {amount} has been deposited into your Area Supa account {customer_id} on {transaction_date}. New balance: GHS {balance}. Thank you.',
    withdrawal: 'Dear {first_name}, GHS {amount} has been withdrawn from your Area Supa account {customer_id} on {transaction_date}. New balance: GHS {balance}.',
    welcome: 'Welcome to Area Supa Ventures, {first_name}! Your customer ID is {customer_id}. Secure savings, trusted service.'
  };
  $('autoTemplates').innerHTML = AUTO.map((a) => templateCard({
    id: a.key, title: a.title, desc: a.desc, tx: a.tx,
    enabled: auto[a.key] ? auto[a.key].enabled === true : a.key !== 'welcome',
    template: auto[a.key]?.template || defaults[a.key]
  })).join('') + templateCard({
    id: 'birthday', title: 'Birthday wishes', desc: 'Sent at 8:00 AM on each customer’s birthday (needs their date of birth).', tx: false,
    enabled: s.birthday?.enabled === true,
    template: s.birthday?.template || 'Happy birthday {first_name}! Everyone at Area Supa Ventures wishes you a wonderful year ahead.'
  });
  document.querySelectorAll('#autoTemplates [data-tpl]').forEach(wireTemplate);

  occasions = Array.isArray(s.occasions) ? s.occasions : [
    { id: 'christmas', name: 'Christmas', month: 12, day: 25, enabled: false, template: 'Merry Christmas {first_name}! Thank you for saving with Area Supa Ventures. Have a blessed season.' },
    { id: 'newyear', name: 'New Year', month: 1, day: 1, enabled: false, template: 'Happy New Year {first_name}! Area Supa Ventures wishes you a prosperous year. Keep saving!' },
    { id: 'independence', name: 'Independence Day', month: 3, day: 6, enabled: false, template: 'Happy Independence Day {first_name}! From all of us at Area Supa Ventures.' }
  ];
  renderOccasions();

  const ids = await walletReady;
  const approved = ids.filter((x) => x.status === 'approved');
  const current = s.senderId || '';
  $('senderId').innerHTML = '<option value="">Choose a Sender ID</option>' +
    approved.map((x) => `<option value="${escapeHtml(x.senderId)}" ${x.senderId === current ? 'selected' : ''}>${escapeHtml(x.senderId)}</option>`).join('') +
    (current && !approved.some((x) => x.senderId === current) ? `<option value="${escapeHtml(current)}" selected>${escapeHtml(current)} (not approved)</option>` : '') +
    ids.filter((x) => x.status !== 'approved').map((x) => `<option disabled>${escapeHtml(x.senderId)} (${escapeHtml(x.status)})</option>`).join('');
}

$('addOccasion').addEventListener('click', () => {
  occasions = readOccasions();
  occasions.push({ name: '', month: new Date().getMonth() + 1, day: new Date().getDate(), enabled: true, template: 'Dear {first_name}, ' });
  renderOccasions();
});

$('saveAuto').addEventListener('click', async () => {
  const btn = $('saveAuto');
  $('autoError').classList.add('hidden');
  const card = (id) => document.querySelector(`#autoTemplates [data-tpl="${id}"]`);
  const val = (id) => ({ enabled: card(id).querySelector('[data-enabled]').checked, template: card(id).querySelector('[data-template]').value.trim() });
  setBusy(btn, true, 'Saving…');
  try {
    occasions = readOccasions();
    await call('saveSmsSettings', {
      senderId: $('senderId').value,
      autoSms: { deposit: val('deposit'), withdrawal: val('withdrawal'), welcome: val('welcome') },
      birthday: val('birthday'),
      occasions
    });
    toast('SMS settings saved', { type: 'success' });
    loaded.auto = false;
    loadAuto();
    loaded.auto = true;
  } catch (e) {
    $('autoError').textContent = e.message;
    $('autoError').classList.remove('hidden');
  } finally {
    setBusy(btn, false);
  }
});

/* ------------------------------ History ------------------------------ */
const KIND = {
  manual: 'Message', deposit: 'Deposit alert', withdrawal: 'Withdrawal alert', welcome: 'Welcome',
  birthday: 'Birthday', occasion: 'Occasion'
};
const STATUS_CLS = {
  sent: 'text-emerald-700', scheduled: 'text-blue-700', partial: 'text-amber-700',
  failed: 'text-red-700', skipped: 'text-stone-400', cancelled: 'text-stone-400'
};
let historyCursor = null;

function historyRow(id, l) {
  const when = tsToDate(l.createdAt);
  const d = l.delivery;
  return `
    <div class="p-4" data-log="${escapeHtml(id)}">
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0">
          <p class="text-[13px] font-bold text-stone-900">${escapeHtml(l.title || KIND[l.kind] || 'SMS')}
            <span class="font-medium text-stone-500">· ${l.customerName ? escapeHtml(l.customerName) : `${l.recipientCount || 0} recipient(s)`}</span></p>
          <p class="text-[11px] text-stone-400">${escapeHtml(l.createdByName || '')}${when ? ' · ' + when.toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''}
            ${l.scheduleAt ? ` · for ${new Date(l.scheduleAt).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}` : ''}</p>
        </div>
        <span class="text-[11px] font-bold uppercase ${STATUS_CLS[l.status] || 'text-stone-500'}">${escapeHtml(l.status || '')}</span>
      </div>
      <p class="mt-1.5 text-[12px] text-stone-600 whitespace-pre-wrap break-words line-clamp-3">${escapeHtml(l.message || '')}</p>
      ${l.error ? `<p class="mt-1 text-[11.5px] text-red-700">${escapeHtml(l.error)}</p>` : ''}
      ${d ? `<p class="mt-1 text-[11.5px] text-stone-500">Delivered ${d.delivered} · Accepted ${d.submitted} · Failed ${d.failed} · Pending ${d.unknown} · ${d.charged} unit(s) charged</p>` : ''}
      <div class="mt-2 flex gap-3">
        ${(l.batches || []).some((b) => b.batchId) ? '<button type="button" data-check class="text-[12px] font-semibold text-brand-gold hover:underline">Check delivery</button>' : ''}
        ${l.status === 'scheduled' ? '<button type="button" data-cancel class="text-[12px] font-semibold text-red-700 hover:underline">Cancel</button>' : ''}
      </div>
    </div>`;
}

async function loadHistory(reset) {
  const clauses = [orderBy('createdAt', 'desc')];
  if (!reset && historyCursor) clauses.push(startAfter(historyCursor));
  clauses.push(limit(25));
  try {
    const snap = await getDocs(query(collection(db, 'smsLogs'), ...clauses));
    const html = snap.docs.map((d) => historyRow(d.id, d.data())).join('');
    if (reset) $('historyList').innerHTML = html || '<p class="p-8 text-center text-sm text-stone-500">No messages sent yet.</p>';
    else $('historyList').insertAdjacentHTML('beforeend', html);
    historyCursor = snap.docs[snap.docs.length - 1] || historyCursor;
    $('historyMore').classList.toggle('hidden', snap.docs.length < 25);
  } catch (e) {
    $('historyList').innerHTML = '<p class="p-8 text-center text-sm text-red-700">Could not load history.</p>';
  }
}
$('historyMore').addEventListener('click', () => loadHistory(false));
$('historyList').addEventListener('click', async (e) => {
  const row = e.target.closest('[data-log]');
  if (!row) return;
  const logId = row.dataset.log;
  try {
    if (e.target.closest('[data-check]')) {
      const r = await call('smsBatchStatus', { logId });
      const d = r.delivery;
      toast(`Delivered ${d.delivered}, accepted ${d.submitted}, failed ${d.failed}, pending ${d.unknown}.`, { type: 'success', ms: 5000 });
      loadHistory(true);
    } else if (e.target.closest('[data-cancel]')) {
      if (!(await confirmDialog({ title: 'Cancel scheduled SMS?', message: 'It will not be sent. Reserved units are returned.', confirmLabel: 'Cancel SMS', danger: true }))) return;
      await call('smsCancelScheduled', { logId });
      toast('Scheduled SMS cancelled', { type: 'success' });
      loadHistory(true);
      loadWallet();
    }
  } catch (err) {
    toast(err.message, { type: 'error', ms: 6000 });
  }
});

/* ------------------------------ Billing ------------------------------ */
let unitPrice = null;

function pkgFields(p) {
  return {
    id: p.id || p.packageId || p.key,
    name: p.name || p.label || p.id || 'Package',
    units: Number(p.units ?? p.unitCount ?? 0),
    amount: Number(p.amountGhs ?? p.priceGhs ?? p.price ?? p.amount ?? 0)
  };
}

async function buy(body, btn) {
  setBusy(btn, true, 'Opening checkout…');
  try {
    const r = await call('smsBuyUnits', { ...body, method: $('payMethod').value || undefined, requestId: newRequestId() });
    try { sessionStorage.setItem('asv.lastPayment', r.reference); } catch { /* ignore */ }
    const url = new URL(r.checkoutUrl);
    if (url.protocol !== 'https:') throw new Error('Unexpected checkout link.');
    window.location.assign(url.href);
  } catch (e) {
    setBusy(btn, false);
    if (e.code !== 'cancelled') toast(e.message, { type: 'error', ms: 6000 });
  }
}

async function loadBilling() {
  try {
    const pricing = await call('smsPricing');
    unitPrice = Number(pricing?.unitPriceGhs ?? pricing?.unitPrice ?? pricing?.pricePerUnit ?? NaN);
    $('unitPrice').textContent = Number.isFinite(unitPrice) ? `Current price: GH₵${unitPrice.toFixed(3).replace(/0+$/, '').replace(/\.$/, '')} per unit` : '';
    const pkgs = (pricing?.packages || []).map(pkgFields);
    $('packages').innerHTML = pkgs.map((p) => `
      <div class="rounded-xl border border-stone-200 p-4 flex items-center justify-between gap-3">
        <div>
          <p class="text-[13.5px] font-bold text-stone-900">${escapeHtml(p.name)}</p>
          <p class="text-[12px] text-stone-500">${p.units.toLocaleString('en-GH')} units${p.amount ? ` · GH₵${formatGHS(p.amount)}` : ''}</p>
        </div>
        <button type="button" data-buy="${escapeHtml(p.id)}" class="btn-dark px-3.5 py-2 text-[12px]">Buy</button>
      </div>`).join('') || '<p class="text-[12px] text-stone-500">No packages listed. Use a custom amount below.</p>';
    $('packages').querySelectorAll('[data-buy]').forEach((b) => b.addEventListener('click', () => buy({ packageId: b.dataset.buy }, b)));
  } catch (e) {
    $('packages').innerHTML = `<p class="text-[12px] text-red-700">${escapeHtml(e.message)}</p>`;
  }
  loadPayments();
}

$('customUnits').addEventListener('input', () => {
  const u = Number($('customUnits').value);
  $('customPrice').textContent = Number.isFinite(unitPrice) && u > 0 ? `About GH₵${formatGHS(u * unitPrice)}` : 'Minimum 50 units';
});
$('buyCustom').addEventListener('click', () => {
  const units = Number($('customUnits').value);
  if (!Number.isInteger(units) || units < 50) { toast('Enter at least 50 units.', { type: 'error' }); return; }
  buy({ units }, $('buyCustom'));
});

async function loadPayments() {
  try {
    const snap = await getDocs(query(collection(db, 'smsPayments'), orderBy('createdAt', 'desc'), limit(20)));
    $('payments').innerHTML = snap.docs.map((d) => {
      const p = d.data();
      const when = tsToDate(p.createdAt);
      const paid = p.status === 'paid' || p.status === 'success' || p.walletCreditedAt;
      return `
        <div class="p-4 flex items-center justify-between gap-3">
          <div class="min-w-0">
            <p class="text-[13px] font-bold text-stone-900">${Number(p.units || 0).toLocaleString('en-GH')} units${p.amountGhs != null ? ` · GH₵${formatGHS(p.amountGhs)}` : ''}</p>
            <p class="text-[11px] text-stone-400 font-mono truncate">${escapeHtml(p.reference)}${when ? ' · ' + when.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : ''}</p>
          </div>
          <div class="text-right shrink-0">
            <p class="text-[11px] font-bold uppercase ${paid ? 'text-emerald-700' : p.status === 'failed' ? 'text-red-700' : 'text-amber-700'}">${escapeHtml(paid ? 'Paid' : (p.status || 'pending'))}</p>
            ${paid ? '' : `<button type="button" data-ref="${escapeHtml(p.reference)}" class="text-[11.5px] font-semibold text-brand-gold hover:underline">Check status</button>`}
          </div>
        </div>`;
    }).join('') || '<p class="p-6 text-center text-sm text-stone-500">No purchases yet.</p>';
    $('payments').querySelectorAll('[data-ref]').forEach((b) => b.addEventListener('click', () => checkPayment(b.dataset.ref)));
  } catch {
    $('payments').innerHTML = '<p class="p-6 text-center text-sm text-red-700">Could not load purchases.</p>';
  }
}

async function checkPayment(reference, { quiet = false } = {}) {
  try {
    const r = await call('smsPaymentStatus', { reference });
    const paid = r.status === 'paid' || r.status === 'success' || r.walletCreditedAt;
    const box = $('paymentNotice');
    box.className = `rounded-xl border px-4 py-3 text-[12.5px] ${paid ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-amber-200 bg-amber-50 text-amber-900'}`;
    box.textContent = paid
      ? `Payment received. ${Number(r.units || 0).toLocaleString('en-GH')} units have been added to your balance.`
      : `Payment ${r.status || 'pending'}. If you completed payment, check again in a minute.`;
    box.classList.remove('hidden');
    loadPayments();
    loadWallet();
  } catch (e) {
    if (!quiet) toast(e.message, { type: 'error' });
  }
}

/* ------------------------------ Start ------------------------------ */
onAudienceChange();
updatePreview();
showTab(params.get('tab') || 'send');
if (params.get('payment') === 'return') {
  let ref = null;
  try { ref = sessionStorage.getItem('asv.lastPayment'); } catch { /* ignore */ }
  if (ref) checkPayment(ref, { quiet: true });
}
