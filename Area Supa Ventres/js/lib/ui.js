// Small UI helpers shared by every page.

export const $ = (id) => document.getElementById(id);

export function formatGHS(n) {
  const v = Number(n) || 0;
  return v.toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function initialsFrom(name) {
  if (!name) return '??';
  const p = String(name).trim().split(/\s+/);
  return ((p[0]?.[0] || '') + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase() || '??';
}

export function tsToDate(v) {
  if (!v) return null;
  if (v.toDate) return v.toDate();
  if (v instanceof Date) return v;
  return new Date(v);
}

// "2026-10-04" -> "04 Oct 2026"
export function prettyIsoDate(iso) {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00Z');
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

export function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export function debounce(fn, ms = 250) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

/**
 * Cloudinary delivery URL resized on their CDN: small, modern format, face-
 * centred. Keeps list pages fast even with hundreds of photos.
 */
export function photoUrl(url, size = 96) {
  if (!url || typeof url !== 'string') return '';
  if (!url.startsWith('https://res.cloudinary.com/')) return '';
  const px = Math.round(size * Math.min(window.devicePixelRatio || 1, 2));
  return url.replace('/image/upload/', `/image/upload/c_fill,g_face,w_${px},h_${px},f_auto,q_auto/`);
}

// Round avatar: the customer's photo when there is one, otherwise initials.
export function avatarHtml(c, { size = 40, cls = 'bg-brand-gold/15 text-brand-gold', text = 'text-[12px]' } = {}) {
  const src = photoUrl(c?.photoUrl, size);
  const style = `width:${size}px;height:${size}px`;
  if (src) {
    return `<img src="${escapeHtml(src)}" alt="" loading="lazy" decoding="async" style="${style}"
                 class="rounded-full object-cover shrink-0 bg-stone-200" />`;
  }
  return `<div style="${style}" class="rounded-full ${cls} font-bold ${text} flex items-center justify-center shrink-0">
            ${escapeHtml(initialsFrom(c?.fullName))}</div>`;
}

/* ------------------------------ Toasts ------------------------------ */

export function toast(message, { type = 'info', ms = 3200 } = {}) {
  let host = document.getElementById('asv-toasts');
  if (!host) {
    host = document.createElement('div');
    host.id = 'asv-toasts';
    host.className = 'fixed inset-x-0 top-3 z-[70] flex flex-col items-center gap-2 px-4 pointer-events-none';
    document.body.appendChild(host);
  }
  const colors = {
    info: 'bg-stone-900 text-white',
    success: 'bg-emerald-700 text-white',
    error: 'bg-red-700 text-white'
  };
  const icon = { info: 'fa-circle-info', success: 'fa-circle-check', error: 'fa-triangle-exclamation' }[type];
  const el = document.createElement('div');
  el.className = `pointer-events-auto max-w-md w-full sm:w-auto rounded-xl shadow-lg px-4 py-3 text-[13px] font-medium flex items-start gap-2 fade-up ${colors[type] || colors.info}`;
  el.setAttribute('role', type === 'error' ? 'alert' : 'status');
  el.innerHTML = `<i class="fa-solid ${icon} mt-0.5"></i><span></span>`;
  el.querySelector('span').textContent = message;
  host.appendChild(el);
  setTimeout(() => el.remove(), ms);
}

/* ------------------------------ Modals ------------------------------ */

function modalShell(inner) {
  const wrap = document.createElement('div');
  wrap.className = 'fixed inset-0 z-[60] bg-black/50 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4';
  wrap.setAttribute('role', 'dialog');
  wrap.setAttribute('aria-modal', 'true');
  wrap.innerHTML = `<div class="bg-white w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden fade-up max-h-[92vh] overflow-y-auto">${inner}</div>`;
  document.body.appendChild(wrap);
  return wrap;
}

/**
 * Confirmation dialog. Returns true/false.
 * danger: red button. requireText: user must type this exact text first.
 */
export function confirmDialog({ title, message = '', html = '', confirmLabel = 'Confirm', danger = false, requireText = '' } = {}) {
  return new Promise((resolve) => {
    const btn = danger ? 'bg-red-700 hover:bg-red-800' : 'bg-[#212121] hover:bg-black';
    const wrap = modalShell(`
      <div class="p-6">
        <div class="flex items-start gap-3">
          <div class="w-10 h-10 rounded-full ${danger ? 'bg-red-50 text-red-700' : 'bg-brand-gold/15 text-brand-gold'} flex items-center justify-center shrink-0">
            <i class="fa-solid ${danger ? 'fa-triangle-exclamation' : 'fa-circle-question'}"></i>
          </div>
          <div class="min-w-0">
            <h2 class="text-[16px] font-bold text-stone-900" data-title></h2>
            <p class="text-[13px] text-stone-600 mt-1 whitespace-pre-line" data-msg></p>
          </div>
        </div>
        <div class="mt-4 text-[13px] text-stone-700" data-html></div>
        ${requireText ? `
          <label class="block mt-4 text-[12px] font-medium text-stone-600">Type <span class="font-mono font-bold text-stone-900" data-req></span> to confirm</label>
          <input data-input type="text" autocomplete="off" spellcheck="false"
                 class="mt-1.5 w-full px-3.5 py-2.5 rounded-xl border border-stone-300 text-sm font-mono outline-none focus:ring-1 focus:ring-red-600 focus:border-red-600" />` : ''}
      </div>
      <div class="px-6 pb-6 grid grid-cols-2 gap-3">
        <button data-cancel type="button" class="py-3 bg-white border border-stone-300 text-stone-900 text-[13px] font-semibold rounded-xl hover:bg-stone-50">Cancel</button>
        <button data-ok type="button" class="py-3 ${btn} text-white text-[13px] font-semibold rounded-xl disabled:opacity-40 disabled:cursor-not-allowed"></button>
      </div>`);
    wrap.querySelector('[data-title]').textContent = title || 'Are you sure?';
    wrap.querySelector('[data-msg]').textContent = message;
    wrap.querySelector('[data-html]').innerHTML = html; // callers pass escaped HTML only
    wrap.querySelector('[data-ok]').textContent = confirmLabel;
    const ok = wrap.querySelector('[data-ok]');
    const input = wrap.querySelector('[data-input]');
    if (requireText) {
      wrap.querySelector('[data-req]').textContent = requireText;
      ok.disabled = true;
      input.addEventListener('input', () => {
        ok.disabled = input.value.trim().toUpperCase() !== requireText.toUpperCase();
      });
      setTimeout(() => input.focus(), 50);
    }
    const done = (v) => { wrap.remove(); resolve(v); };
    wrap.querySelector('[data-cancel]').addEventListener('click', () => done(false));
    ok.addEventListener('click', () => done(true));
    wrap.addEventListener('click', (e) => { if (e.target === wrap) done(false); });
  });
}

// Asks for the current password. Resolves to the password, or null if cancelled.
export function promptPassword({ title, message, error = '' }) {
  return new Promise((resolve) => {
    const wrap = modalShell(`
      <form class="p-6" data-form>
        <div class="flex items-start gap-3">
          <div class="w-10 h-10 rounded-full bg-brand-gold/15 text-brand-gold flex items-center justify-center shrink-0">
            <i class="fa-solid fa-shield-halved"></i>
          </div>
          <div>
            <h2 class="text-[16px] font-bold text-stone-900" data-title></h2>
            <p class="text-[13px] text-stone-600 mt-1" data-msg></p>
          </div>
        </div>
        <p data-err class="hidden mt-3 text-[12px] font-medium text-red-700"></p>
        <input data-pw type="password" autocomplete="current-password" placeholder="Password"
               class="mt-4 w-full px-3.5 py-3 rounded-xl border border-stone-300 text-sm outline-none focus:ring-1 focus:ring-brand-gold focus:border-brand-gold" />
        <div class="mt-5 grid grid-cols-2 gap-3">
          <button data-cancel type="button" class="py-3 bg-white border border-stone-300 text-stone-900 text-[13px] font-semibold rounded-xl hover:bg-stone-50">Cancel</button>
          <button type="submit" class="py-3 bg-[#212121] hover:bg-black text-white text-[13px] font-semibold rounded-xl">Confirm</button>
        </div>
      </form>`);
    wrap.querySelector('[data-title]').textContent = title;
    wrap.querySelector('[data-msg]').textContent = message;
    if (error) {
      const el = wrap.querySelector('[data-err]');
      el.textContent = error;
      el.classList.remove('hidden');
    }
    const pw = wrap.querySelector('[data-pw]');
    setTimeout(() => pw.focus(), 50);
    const done = (v) => { wrap.remove(); resolve(v); };
    wrap.querySelector('[data-cancel]').addEventListener('click', () => done(null));
    wrap.querySelector('[data-form]').addEventListener('submit', (e) => {
      e.preventDefault();
      if (pw.value) done(pw.value);
    });
  });
}

export function setBusy(button, busy, label) {
  if (!button) return;
  if (busy) {
    button.dataset.label = button.dataset.label || button.innerHTML;
    button.disabled = true;
    button.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin text-[12px]"></i> <span>${escapeHtml(label || 'Please wait…')}</span>`;
  } else {
    button.disabled = false;
    if (button.dataset.label) button.innerHTML = button.dataset.label;
    delete button.dataset.label;
  }
}
