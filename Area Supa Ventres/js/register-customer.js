// register-customer.html page script
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db } from './lib/firebase.js';
import { requireSession } from './lib/session.js';
import { call } from './lib/api.js';
import { $, setBusy, toast } from './lib/ui.js';
import { renderCustomerForm } from './lib/customer-form.js';

const errorBox = $('errorBox');
const errorMsg = $('errorMsg');
const dupLink = $('dupLink');
const dupContinue = $('dupContinue');
const submitBtn = $('submitBtn');

function showBanner(msg) {
  errorMsg.textContent = msg;
  errorBox.classList.remove('hidden');
  dupLink.classList.add('hidden');
  dupContinue.classList.add('hidden');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
function hideBanner() { errorBox.classList.add('hidden'); }

const session = await requireSession({ permission: 'customers.create' });
const form = renderCustomerForm($('formFields'), { branches: session.settings.branches || [] });
if (session.profile.branch) {
  const b = document.getElementById('branch');
  if ([...b.options].some((o) => o.value === session.profile.branch)) b.value = session.profile.branch;
}

// Offer the welcome SMS only when it's switched on in SMS settings.
getDoc(doc(db, 'settings', 'sms')).then((s) => {
  if (s.exists() && s.data().autoSms?.welcome?.enabled) $('welcomeRow').classList.remove('hidden');
}).catch(() => {});

let allowDuplicatePhone = false;
dupContinue.addEventListener('click', () => {
  allowDuplicatePhone = true;
  hideBanner();
  $('customerForm').requestSubmit();
});

$('customerForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  hideBanner();
  if (!form.validate()) {
    showBanner('Please fix the highlighted fields.');
    return;
  }
  setBusy(submitBtn, true, form.isUploading() ? 'Finishing photo upload…' : 'Saving…');
  try {
    await form.waitForUpload();
    const res = await call('createCustomer', {
      customer: form.getValues(),
      allowDuplicatePhone,
      sendWelcomeSms: $('sendWelcome').checked
    });
    if (res.sms?.status === 'failed') toast('Customer saved, but the welcome SMS failed.', { type: 'error' });
    window.location.replace(`customer.html?id=${encodeURIComponent(res.id)}&welcome=1`);
  } catch (err) {
    setBusy(submitBtn, false);
    if (err.details?.reason === 'duplicate-phone') {
      showBanner(err.message);
      dupLink.href = `customer.html?id=${encodeURIComponent(err.details.customerId)}`;
      dupLink.classList.remove('hidden');
      dupContinue.classList.remove('hidden');
      return;
    }
    showBanner(err.message || 'We couldn’t save this customer. Please try again.');
  }
});
