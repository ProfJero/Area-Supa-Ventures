// settings.html page script
import { requireSession } from './lib/session.js';
import { call } from './lib/api.js';
import { $, escapeHtml, toast, confirmDialog, setBusy } from './lib/ui.js';
import { mountBottomNav } from '../components/bottom-nav.js';

mountBottomNav('profile');
const session = await requireSession({ permission: 'settings.manage' });
const s = session.settings || {};

let branches = Array.isArray(s.branches) ? [...s.branches] : [];
$('businessName').value = s.businessName || 'Area Supa Ventures';
$('idleTimeout').value = s.idleTimeoutMinutes || 15;

function renderBranches() {
  $('branchList').innerHTML = branches.length
    ? branches.map((b, i) => `
        <div class="flex items-center gap-2">
          <input data-i="${i}" class="field-input branch-name" maxlength="60" value="${escapeHtml(b)}" />
          <button type="button" data-del="${i}" class="w-10 h-10 shrink-0 rounded-xl text-stone-400 hover:text-red-700 hover:bg-red-50" aria-label="Remove branch">
            <i class="fa-solid fa-trash-can text-[12px]"></i></button>
        </div>`).join('')
    : '<p class="text-[12px] text-stone-400">No branches yet.</p>';
  $('branchList').querySelectorAll('.branch-name').forEach((inp) =>
    inp.addEventListener('input', () => { branches[Number(inp.dataset.i)] = inp.value; }));
  $('branchList').querySelectorAll('[data-del]').forEach((b) =>
    b.addEventListener('click', () => { branches.splice(Number(b.dataset.del), 1); renderBranches(); }));
}
renderBranches();

$('addBranch').addEventListener('click', () => {
  const v = $('newBranch').value.trim();
  if (!v) return;
  if (branches.some((b) => b.toLowerCase() === v.toLowerCase())) { toast('That branch already exists.', { type: 'error' }); return; }
  branches.push(v);
  $('newBranch').value = '';
  renderBranches();
});
$('newBranch').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('addBranch').click(); } });

$('generalForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('saveError').classList.add('hidden');
  const btn = $('saveBtn');
  setBusy(btn, true, 'Saving…');
  try {
    await call('saveGeneralSettings', {
      businessName: $('businessName').value.trim(),
      branches: branches.map((b) => b.trim()).filter(Boolean),
      idleTimeoutMinutes: Number($('idleTimeout').value)
    });
    toast('Settings saved', { type: 'success' });
  } catch (err) {
    $('saveError').textContent = err.message;
    $('saveError').classList.remove('hidden');
  } finally {
    setBusy(btn, false);
  }
});

if (session.role === 'owner') {
  $('upgradeSection').classList.remove('hidden');
  $('upgradeBtn').addEventListener('click', async () => {
    const renumber = $('renumber').checked;
    const ok = await confirmDialog({
      title: 'Run data upgrade?',
      message: renumber
        ? 'Customers will be renumbered ASV-10001, ASV-10002, … in order of registration. Their old numbers stay searchable. This cannot be undone.'
        : 'Existing customer records will be prepared for sorting, search and birthday messages, and totals recalculated.',
      confirmLabel: 'Run upgrade',
      danger: renumber,
      requireText: renumber ? 'RENUMBER' : ''
    });
    if (!ok) return;
    const btn = $('upgradeBtn');
    setBusy(btn, true, 'Upgrading… this can take a minute');
    try {
      const r = await call('upgradeData', { renumber });
      $('upgradeResult').textContent = `Done: ${r.customers} customers checked, ${r.updated} updated${renumber ? `, ${r.renumbered} renumbered` : ''}.`;
      toast('Data upgrade complete', { type: 'success' });
    } catch (err) {
      if (err.code !== 'cancelled') $('upgradeResult').textContent = err.message;
    } finally {
      setBusy(btn, false);
    }
  });
}
