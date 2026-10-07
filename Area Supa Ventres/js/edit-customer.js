// edit-customer.html page script
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db } from './lib/firebase.js';
import { requireSession } from './lib/session.js';
import { call } from './lib/api.js';
import { $, setBusy, toast } from './lib/ui.js';
import { renderCustomerForm } from './lib/customer-form.js';

const customerId = new URLSearchParams(location.search).get('id');
if (!customerId) window.location.replace('customers.html');

const session = await requireSession({ permission: 'customers.edit' });
$('backBtn').href = `customer.html?id=${encodeURIComponent(customerId)}`;

const form = renderCustomerForm($('formFields'), { branches: session.settings.branches || [] });

try {
  const snap = await getDoc(doc(db, 'customers', customerId));
  if (!snap.exists()) throw new Error('This customer could not be found. They may have been deleted.');
  const c = snap.data();
  $('headerSub').textContent = `${c.fullName || 'Customer'} • ${c.accountNumber || ''}`;
  $('displayName').textContent = c.fullName || 'Customer';
  $('displayAccount').textContent = c.accountNumber || '—';
  form.setValues(c);
  $('editForm').classList.remove('hidden');
} catch (e) {
  $('loadErrorMsg').textContent = e.message?.startsWith('This customer') ? e.message : 'Check your connection and retry.';
  $('loadError').classList.remove('hidden');
}

$('editForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('saveError').classList.add('hidden');
  if (!form.validate()) return;
  const btn = $('saveBtn');
  setBusy(btn, true, form.isUploading() ? 'Finishing photo upload…' : 'Saving…');
  try {
    await form.waitForUpload();
    await call('updateCustomer', { id: customerId, customer: form.getValues({ includeStatus: true }) });
    toast('Changes saved', { type: 'success' });
    window.location.replace(`customer.html?id=${encodeURIComponent(customerId)}`);
  } catch (err) {
    setBusy(btn, false);
    $('saveErrorMsg').textContent = err.message || 'Please try again.';
    $('saveError').classList.remove('hidden');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
});
