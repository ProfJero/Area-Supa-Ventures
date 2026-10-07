// staff.html page script — add sub-admins/staff and choose their roles.
import { collection, getDocs } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db } from './lib/firebase.js';
import { requireSession } from './lib/session.js';
import { call } from './lib/api.js';
import { ROLES, PERMISSIONS, assignableRoles, canManageRole } from './lib/roles.js';
import { $, escapeHtml, initialsFrom, toast, confirmDialog, setBusy, tsToDate } from './lib/ui.js';
import { mountBottomNav } from '../components/bottom-nav.js';

mountBottomNav('profile');
const session = await requireSession({ permission: 'staff.manage' });
const myRole = session.role;

const sheet = $('sheet');
const form = $('staffForm');
const formError = $('formError');
let editing = null; // staff record being edited, or null when adding
let staff = [];

/* ------------------------------ Role guide ------------------------------ */
$('roleGuide').innerHTML = Object.entries(ROLES).sort((a, b) => b[1].rank - a[1].rank).map(([key, r]) => `
  <div class="bg-white rounded-2xl border border-stone-200 p-4">
    <p class="text-[13px] font-bold text-stone-900">${escapeHtml(r.label)}</p>
    <p class="text-[11.5px] text-stone-500 mt-0.5">${escapeHtml(r.description)}</p>
    <ul class="mt-2 space-y-0.5">
      ${Object.keys(PERMISSIONS).map((p) => {
        const yes = r.permissions.includes(p);
        return `<li class="text-[11px] ${yes ? 'text-stone-700' : 'text-stone-300 line-through'}">
          <i class="fa-solid ${yes ? 'fa-check text-emerald-600' : 'fa-xmark'} w-3"></i> ${escapeHtml(PERMISSIONS[p])}</li>`;
      }).join('')}
    </ul>
  </div>`).join('');

/* ------------------------------ List ------------------------------ */
const STATUS_BADGE = {
  active: '<span class="chip !border-emerald-200 !bg-emerald-50 !text-emerald-700">Active</span>',
  suspended: '<span class="chip !border-amber-200 !bg-amber-50 !text-amber-700">Suspended</span>'
};

async function load() {
  try {
    const snap = await getDocs(collection(db, 'users'));
    staff = snap.docs.map((d) => ({ uid: d.id, ...d.data() }))
      .filter((u) => u.status !== 'removed')
      .sort((a, b) => (ROLES[b.role]?.rank || 0) - (ROLES[a.role]?.rank || 0) || String(a.name).localeCompare(String(b.name)));
    render();
  } catch (e) {
    console.error(e);
    $('staffList').innerHTML = '<p class="p-6 text-center text-sm text-red-700">Could not load staff. Check your connection.</p>';
  }
}

function render() {
  $('subHeader').textContent = `${staff.length} staff member${staff.length === 1 ? '' : 's'}`;
  $('staffList').innerHTML = staff.map((u) => {
    const me = u.uid === session.user.uid;
    const manageable = !me && canManageRole(myRole, u.role);
    const last = tsToDate(u.createdAt);
    return `
      <div class="p-4 flex items-center gap-3">
        <div class="w-10 h-10 rounded-full bg-brand-gold/15 text-brand-gold font-bold text-[12px] flex items-center justify-center shrink-0">${escapeHtml(initialsFrom(u.name))}</div>
        <div class="min-w-0 flex-1">
          <p class="text-[13.5px] font-bold text-stone-900 truncate">${escapeHtml(u.name || 'Unnamed')}${me ? ' <span class="text-stone-400 font-medium">(you)</span>' : ''}</p>
          <p class="text-[11px] text-stone-500 truncate">${escapeHtml([u.email, u.phone, u.branch].filter(Boolean).join(' · '))}</p>
          <div class="mt-1.5 flex flex-wrap items-center gap-1.5">
            <span class="chip">${escapeHtml(ROLES[u.role]?.label || u.role)}</span>
            ${STATUS_BADGE[u.status] || ''}
            ${u.mustChangePassword ? '<span class="chip">Temporary password</span>' : ''}
            ${last ? `<span class="text-[10.5px] text-stone-400">Added ${last.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</span>` : ''}
          </div>
        </div>
        ${manageable ? `<button type="button" data-edit="${escapeHtml(u.uid)}" class="btn-light px-3 py-2 text-[12px] shrink-0">Manage</button>` : ''}
      </div>`;
  }).join('') || '<p class="p-6 text-center text-sm text-stone-500">No staff yet.</p>';

  $('staffList').querySelectorAll('[data-edit]').forEach((b) =>
    b.addEventListener('click', () => openSheet(staff.find((u) => u.uid === b.dataset.edit))));
}

/* ------------------------------ Add / edit ------------------------------ */
const branches = session.settings.branches || [];
$('sBranch').insertAdjacentHTML('beforeend', branches.map((b) => `<option value="${escapeHtml(b)}">${escapeHtml(b)}</option>`).join(''));

function roleChoicesHtml(selected) {
  return assignableRoles(myRole).map((key) => `
    <label class="flex items-start gap-3 p-3 rounded-xl border border-stone-200 has-[:checked]:border-brand-gold has-[:checked]:bg-brand-gold/5 cursor-pointer">
      <input type="radio" name="role" value="${key}" ${key === selected ? 'checked' : ''} class="mt-0.5 text-brand-charcoal focus:ring-0" />
      <span>
        <span class="block text-[13px] font-bold text-stone-900">${escapeHtml(ROLES[key].label)}</span>
        <span class="block text-[11.5px] text-stone-500">${escapeHtml(ROLES[key].description)}</span>
      </span>
    </label>`).join('');
}

function generatePassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const a = new Uint32Array(12);
  crypto.getRandomValues(a);
  let pw = Array.from(a, (n) => chars[n % chars.length]).join('');
  if (!/\d/.test(pw)) pw = pw.slice(0, 11) + '7';
  return pw;
}

function openSheet(u = null) {
  editing = u;
  formError.classList.add('hidden');
  $('sheetTitle').textContent = u ? `Manage ${u.name}` : 'Add staff';
  $('sName').value = u?.name || '';
  $('sEmail').value = u?.email || '';
  $('sPhone').value = u?.phone || '';
  $('sBranch').value = u?.branch || '';
  $('emailRow').classList.toggle('hidden', !!u);
  $('passwordRow').classList.toggle('hidden', !!u);
  $('sPassword').value = u ? '' : generatePassword();
  $('roleChoices').innerHTML = roleChoicesHtml(u?.role || 'collector');

  // Extra actions when editing.
  document.getElementById('editActions')?.remove();
  if (u) {
    const suspended = u.status === 'suspended';
    $('saveStaff').insertAdjacentHTML('afterend', `
      <div id="editActions" class="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-2 border-t border-stone-100">
        <button type="button" data-act="status" class="btn-light py-2.5 text-[12px] ${suspended ? '' : '!text-amber-700'}">
          <i class="fa-solid ${suspended ? 'fa-play' : 'fa-pause'} text-[11px]"></i> ${suspended ? 'Re-activate' : 'Suspend'}</button>
        <button type="button" data-act="password" class="btn-light py-2.5 text-[12px]"><i class="fa-solid fa-key text-[11px]"></i> Reset password</button>
        <button type="button" data-act="remove" class="btn-light py-2.5 text-[12px] !text-red-700"><i class="fa-solid fa-user-xmark text-[11px]"></i> Remove</button>
      </div>`);
    document.querySelectorAll('#editActions [data-act]').forEach((b) => b.addEventListener('click', () => editAction(b.dataset.act)));
  }
  sheet.classList.remove('hidden');
  setTimeout(() => $('sName').focus(), 50);
}

function closeSheet() { sheet.classList.add('hidden'); editing = null; }
$('closeSheet').addEventListener('click', closeSheet);
sheet.addEventListener('click', (e) => { if (e.target === sheet) closeSheet(); });
$('addBtn').addEventListener('click', () => openSheet(null));
$('genPw').addEventListener('click', () => { $('sPassword').value = generatePassword(); });

function showFormError(msg) {
  formError.textContent = msg;
  formError.classList.remove('hidden');
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  formError.classList.add('hidden');
  const role = form.querySelector('input[name="role"]:checked')?.value;
  if (!role) { showFormError('Choose a role.'); return; }
  const btn = $('saveStaff');
  setBusy(btn, true, 'Saving…');
  try {
    if (editing) {
      const changes = {};
      if ($('sName').value.trim() !== (editing.name || '')) changes.name = $('sName').value.trim();
      if ($('sPhone').value.trim() !== (editing.phone || '')) changes.phone = $('sPhone').value.trim();
      if ($('sBranch').value !== (editing.branch || '')) changes.branch = $('sBranch').value;
      if (role !== editing.role) {
        const ok = await confirmDialog({
          title: 'Change role?',
          message: `${editing.name} will become ${ROLES[role].label}. They will be signed out of all devices and must sign in again.`,
          confirmLabel: 'Change role'
        });
        if (!ok) { setBusy(btn, false); return; }
        changes.role = role;
      }
      if (!Object.keys(changes).length) { closeSheet(); setBusy(btn, false); return; }
      await call('updateStaff', { uid: editing.uid, ...changes });
      toast('Staff member updated', { type: 'success' });
    } else {
      const password = $('sPassword').value;
      await call('createStaff', {
        name: $('sName').value.trim(),
        email: $('sEmail').value.trim(),
        phone: $('sPhone').value.trim(),
        branch: $('sBranch').value,
        role,
        password
      });
      await confirmDialog({
        title: 'Staff member added',
        message: `Give ${$('sName').value.trim()} these sign-in details in person:\n\nEmail: ${$('sEmail').value.trim()}\nTemporary password: ${password}\n\nThey will be asked to choose their own password when they first sign in.`,
        confirmLabel: 'Done'
      });
    }
    closeSheet();
    load();
  } catch (err) {
    if (err.code !== 'cancelled') showFormError(err.message);
  } finally {
    setBusy(btn, false);
  }
});

async function editAction(act) {
  const u = editing;
  if (!u) return;
  try {
    if (act === 'status') {
      const suspend = u.status !== 'suspended';
      const ok = await confirmDialog({
        title: suspend ? `Suspend ${u.name}?` : `Re-activate ${u.name}?`,
        message: suspend
          ? 'They will be signed out immediately and cannot sign in until re-activated.'
          : 'They will be able to sign in again with their current password.',
        confirmLabel: suspend ? 'Suspend' : 'Re-activate',
        danger: suspend
      });
      if (!ok) return;
      await call('updateStaff', { uid: u.uid, status: suspend ? 'suspended' : 'active' });
      toast(suspend ? 'Account suspended' : 'Account re-activated', { type: 'success' });
    } else if (act === 'password') {
      const pw = generatePassword();
      const ok = await confirmDialog({
        title: `Reset ${u.name}’s password?`,
        message: `Their new temporary password will be:\n\n${pw}\n\nThey will be signed out everywhere and must choose a new password at next sign-in.`,
        confirmLabel: 'Reset password'
      });
      if (!ok) return;
      await call('resetStaffPassword', { uid: u.uid, password: pw });
      toast('Password reset. Share the temporary password in person.', { type: 'success', ms: 5000 });
    } else if (act === 'remove') {
      const ok = await confirmDialog({
        title: `Remove ${u.name}?`,
        message: 'Their sign-in account is deleted and they lose access immediately. Transactions they recorded keep their name.',
        confirmLabel: 'Remove',
        danger: true,
        requireText: 'REMOVE'
      });
      if (!ok) return;
      await call('removeStaff', { uid: u.uid });
      toast('Staff member removed', { type: 'success' });
    }
    closeSheet();
    load();
  } catch (err) {
    if (err.code !== 'cancelled') showFormError(err.message);
  }
}

load();
