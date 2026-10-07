// The customer bio-data form, shared by register-customer.html and
// edit-customer.html. The server validates everything again; these checks
// only give quick feedback.

import { escapeHtml, photoUrl, initialsFrom, todayIso, toast } from './ui.js';
import { uploadCustomerPhoto } from './photo.js';

const GENDERS = [['', 'Select'], ['male', 'Male'], ['female', 'Female']];
const MARITAL = [['', 'Select'], ['single', 'Single'], ['married', 'Married'], ['divorced', 'Divorced'], ['widowed', 'Widowed'], ['other', 'Other']];
const ID_TYPES = [['', 'Select'], ['ghana_card', 'Ghana Card'], ['voter_id', 'Voter ID'], ['passport', 'Passport'],
  ['drivers_license', 'Driver’s licence'], ['nhis', 'NHIS card'], ['other', 'Other']];

export const ID_TYPE_LABEL = Object.fromEntries(ID_TYPES.filter(([v]) => v));
export const GENDER_LABEL = { male: 'Male', female: 'Female' };
export const MARITAL_LABEL = Object.fromEntries(MARITAL.filter(([v]) => v));

const opts = (list) => list.map(([v, l]) => `<option value="${v}">${escapeHtml(l)}</option>`).join('');

function field(id, label, { type = 'text', required = false, placeholder = '', hint = '', error = '', attrs = '' } = {}) {
  return `
    <div>
      <label class="field-label" for="${id}">${escapeHtml(label)}${required ? ' <span class="text-red-500">*</span>' : ''}</label>
      <input id="${id}" name="${id}" class="field-input" type="${type}" placeholder="${escapeHtml(placeholder)}" ${attrs} />
      ${hint ? `<p class="field-hint">${escapeHtml(hint)}</p>` : ''}
      <p class="field-error" id="${id}Error">${escapeHtml(error || `Please check ${label.toLowerCase()}.`)}</p>
    </div>`;
}

function select(id, label, list) {
  return `
    <div>
      <label class="field-label" for="${id}">${escapeHtml(label)}</label>
      <select id="${id}" name="${id}" class="field-input">${opts(list)}</select>
    </div>`;
}

function section(title, icon, body) {
  return `
    <section class="bg-white rounded-2xl border border-stone-200 p-5 space-y-4">
      <p class="section-title flex items-center gap-2"><i class="fa-solid ${icon} text-[10px]"></i><span>${escapeHtml(title)}</span></p>
      ${body}
    </section>`;
}

export function renderCustomerForm(container, { branches = [] } = {}) {
  const branchOptions = [['', branches.length ? 'Select branch' : 'No branches set up yet'], ...branches.map((b) => [b, b])];
  container.innerHTML = `
    ${section('Profile photo', 'fa-camera', `
      <div class="flex items-center gap-4">
        <div id="photoPreview" class="w-20 h-20 rounded-full bg-stone-100 border border-stone-200 flex items-center justify-center text-stone-400 overflow-hidden shrink-0">
          <i class="fa-solid fa-user text-2xl"></i>
        </div>
        <div class="flex-1 min-w-0">
          <div class="flex flex-wrap gap-2">
            <label class="btn-light px-3 py-2 text-[12px] cursor-pointer">
              <i class="fa-solid fa-camera text-[11px]"></i> Take photo
              <input id="photoCamera" type="file" accept="image/*" capture="user" class="hidden" />
            </label>
            <label class="btn-light px-3 py-2 text-[12px] cursor-pointer">
              <i class="fa-regular fa-image text-[11px]"></i> Choose
              <input id="photoFile" type="file" accept="image/jpeg,image/png,image/webp" class="hidden" />
            </label>
            <button id="photoRemove" type="button" class="hidden px-3 py-2 text-[12px] font-semibold text-red-700 hover:underline">Remove</button>
          </div>
          <p id="photoStatus" class="field-hint">Optional. Stored securely on Cloudinary.</p>
          <div id="photoBar" class="hidden mt-2 h-1.5 rounded-full bg-stone-100 overflow-hidden"><div class="h-full bg-brand-gold transition-all" style="width:0%"></div></div>
        </div>
      </div>`)}

    ${section('Personal details', 'fa-id-card', `
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
        ${field('firstName', 'First name', { required: true, placeholder: 'e.g. Ama', attrs: 'autocomplete="given-name" maxlength="60"', error: 'Enter the first name.' })}
        ${field('middleName', 'Middle name', { placeholder: 'Optional', attrs: 'autocomplete="additional-name" maxlength="60"' })}
        ${field('lastName', 'Surname', { required: true, placeholder: 'e.g. Boateng', attrs: 'autocomplete="family-name" maxlength="60"', error: 'Enter the surname.' })}
      </div>
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
        ${select('gender', 'Gender', GENDERS)}
        ${field('dateOfBirth', 'Date of birth', { type: 'date', hint: 'Used for birthday messages.', attrs: `max="${todayIso()}"`, error: 'Choose a real date in the past.' })}
        ${select('maritalStatus', 'Marital status', MARITAL)}
      </div>
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
        ${field('occupation', 'Occupation', { placeholder: 'e.g. Trader', attrs: 'maxlength="80"' })}
        ${field('nationality', 'Nationality', { placeholder: 'Ghanaian', attrs: 'maxlength="60"' })}
        ${field('hometown', 'Hometown', { placeholder: 'Optional', attrs: 'maxlength="80"' })}
      </div>`)}

    ${section('Contact', 'fa-phone', `
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        ${field('phone', 'Tel 1', { type: 'tel', required: true, placeholder: '024 555 0192', hint: 'Main number. SMS alerts go here.', attrs: 'autocomplete="tel" inputmode="tel"', error: 'Enter a valid Ghana phone number.' })}
        ${field('tel2', 'Tel 2', { type: 'tel', placeholder: 'Optional second number', attrs: 'inputmode="tel"', error: 'Enter a valid Ghana phone number.' })}
      </div>
      ${field('email', 'Email address', { type: 'email', placeholder: 'Optional', attrs: 'autocomplete="email"', error: 'That email doesn’t look right.' })}
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        ${field('residentialAddress', 'Residential address', { placeholder: 'House no., street, area', attrs: 'maxlength="200"' })}
        ${field('digitalAddress', 'Digital address', { placeholder: 'e.g. GA-123-4567', attrs: 'maxlength="20"', error: 'Should look like GA-123-4567.' })}
      </div>
      <label class="flex items-center gap-2 text-[12.5px] text-stone-700 pt-1">
        <input id="smsOptOut" type="checkbox" class="w-4 h-4 rounded border-stone-300 text-brand-charcoal focus:ring-0" />
        Customer does not want SMS messages
      </label>`)}

    ${section('Identification', 'fa-address-card', `
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        ${select('idType', 'ID type', ID_TYPES)}
        ${field('idNumber', 'ID number', { placeholder: 'e.g. GHA-123456789-0', attrs: 'maxlength="40"' })}
      </div>`)}

    ${section('Account', 'fa-building-columns', `
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label class="field-label" for="branch">Branch</label>
          <select id="branch" class="field-input">${opts(branchOptions)}</select>
          <p class="field-hint">Branches are managed in Settings.</p>
        </div>
        ${field('registrationDate', 'Date of registration', { type: 'date', required: true, attrs: `max="${todayIso()}"`, error: 'Choose the registration date.' })}
      </div>
      <div id="statusRow" class="hidden">
        <label class="field-label" for="status">Account status</label>
        <select id="status" class="field-input"><option value="active">Active</option><option value="inactive">Inactive (no transactions allowed)</option></select>
      </div>`)}

    ${section('Next of kin', 'fa-people-roof', `
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        ${field('nextOfKin', 'Full name', { required: true, placeholder: 'Next of kin', attrs: 'maxlength="100"', error: 'Enter the next of kin’s name.' })}
        ${field('nextOfKinRelationship', 'Relationship', { placeholder: 'e.g. Sister', attrs: 'maxlength="40"' })}
      </div>
      ${field('nextOfKinPhone', 'Phone', { type: 'tel', required: true, placeholder: '024 000 0000', attrs: 'inputmode="tel"', error: 'Enter a valid Ghana phone number.' })}`)}

    ${section('Notes', 'fa-note-sticky', `
      <textarea id="notes" class="field-input" rows="3" maxlength="1000" placeholder="Any additional information (optional)"></textarea>`)}
  `;

  const el = (id) => container.querySelector('#' + id);
  if (!el('registrationDate').value) el('registrationDate').value = todayIso();

  /* ---------- Photo ---------- */
  let photo = { photoUrl: null, photoPublicId: null };
  let photoChanged = false;
  let uploading = null;

  function showPhoto(url, name) {
    const prev = el('photoPreview');
    const src = photoUrl(url, 80);
    prev.innerHTML = src
      ? `<img src="${escapeHtml(src)}" alt="" class="w-full h-full object-cover" />`
      : (name ? `<span class="font-bold text-lg text-brand-gold">${escapeHtml(initialsFrom(name))}</span>` : '<i class="fa-solid fa-user text-2xl"></i>');
    el('photoRemove').classList.toggle('hidden', !url);
  }

  async function onFile(input) {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    const bar = el('photoBar');
    const status = el('photoStatus');
    bar.classList.remove('hidden');
    bar.firstElementChild.style.width = '5%';
    status.textContent = 'Uploading photo…';
    const local = URL.createObjectURL(file);
    el('photoPreview').innerHTML = `<img src="${local}" alt="" class="w-full h-full object-cover opacity-60" />`;
    uploading = uploadCustomerPhoto(file, (p) => { bar.firstElementChild.style.width = `${Math.max(5, p * 100)}%`; });
    try {
      photo = await uploading;
      photoChanged = true;
      status.textContent = 'Photo uploaded. It will be saved with the customer.';
      showPhoto(photo.photoUrl);
    } catch (e) {
      status.textContent = e.message || 'Photo upload failed.';
      toast(e.message || 'Photo upload failed.', { type: 'error' });
      showPhoto(photo.photoUrl);
    } finally {
      URL.revokeObjectURL(local);
      bar.classList.add('hidden');
      uploading = null;
    }
  }
  el('photoCamera').addEventListener('change', (e) => onFile(e.target));
  el('photoFile').addEventListener('change', (e) => onFile(e.target));
  el('photoRemove').addEventListener('click', () => {
    photo = { photoUrl: null, photoPublicId: null };
    photoChanged = true;
    el('photoStatus').textContent = 'Photo will be removed when you save.';
    showPhoto(null, [el('firstName').value, el('lastName').value].join(' ').trim());
  });

  /* ---------- Values ---------- */
  const TEXT_FIELDS = ['firstName', 'middleName', 'lastName', 'gender', 'dateOfBirth', 'maritalStatus', 'occupation',
    'nationality', 'hometown', 'phone', 'tel2', 'email', 'residentialAddress', 'digitalAddress', 'idType', 'idNumber',
    'branch', 'registrationDate', 'nextOfKin', 'nextOfKinRelationship', 'nextOfKinPhone', 'notes'];

  function setValues(c) {
    // Older records only have fullName; split it for the form.
    const parts = String(c.fullName || '').trim().split(/\s+/).filter(Boolean);
    const v = {
      ...c,
      firstName: c.firstName || parts[0] || '',
      lastName: c.lastName || (parts.length > 1 ? parts[parts.length - 1] : ''),
      middleName: c.middleName ?? (parts.length > 2 && !c.firstName ? parts.slice(1, -1).join(' ') : '')
    };
    for (const k of TEXT_FIELDS) {
      const input = el(k);
      if (!input) continue;
      const val = v[k] ?? '';
      if (input.tagName === 'SELECT' && val && ![...input.options].some((o) => o.value === val)) {
        input.add(new Option(val, val)); // e.g. a branch that was since renamed
      }
      input.value = val;
    }
    if (!el('registrationDate').value) {
      const created = c.createdAt?.toDate?.();
      el('registrationDate').value = created ? created.toISOString().slice(0, 10) : todayIso();
    }
    el('smsOptOut').checked = c.smsOptOut === true;
    el('statusRow').classList.remove('hidden');
    el('status').value = c.status === 'inactive' ? 'inactive' : 'active';
    photo = { photoUrl: c.photoUrl || null, photoPublicId: c.photoPublicId || null };
    showPhoto(photo.photoUrl, c.fullName);
  }

  function getValues({ includeStatus = false } = {}) {
    const out = {};
    for (const k of TEXT_FIELDS) out[k] = (el(k)?.value || '').trim();
    out.smsOptOut = el('smsOptOut').checked;
    if (includeStatus) out.status = el('status').value;
    if (photoChanged) Object.assign(out, photo);
    return out;
  }

  function showError(id, show) {
    container.querySelector('#' + id + 'Error')?.classList.toggle('show', show);
  }

  function validate() {
    const v = getValues();
    const phoneOk = (raw, required) => {
      const d = raw.replace(/\D/g, '');
      if (!d) return !required;
      return /^0[2-5]\d{8}$/.test(d) || /^[2-5]\d{8}$/.test(d) || /^233[2-5]\d{8}$/.test(d);
    };
    const checks = {
      firstName: v.firstName.length >= 2,
      lastName: v.lastName.length >= 2,
      phone: phoneOk(v.phone, true),
      tel2: phoneOk(v.tel2, false),
      email: !v.email || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email),
      digitalAddress: !v.digitalAddress || /^[A-Za-z]{2}-?\d{3,4}-?\d{3,5}$/.test(v.digitalAddress),
      dateOfBirth: !v.dateOfBirth || v.dateOfBirth <= todayIso(),
      registrationDate: !!v.registrationDate && v.registrationDate <= todayIso(),
      nextOfKin: v.nextOfKin.length >= 3,
      nextOfKinPhone: phoneOk(v.nextOfKinPhone, true)
    };
    let first = null;
    for (const [k, ok] of Object.entries(checks)) {
      showError(k, !ok);
      if (!ok && !first) first = k;
    }
    if (first) el(first).focus({ preventScroll: false });
    return !first;
  }

  return {
    setValues,
    getValues,
    validate,
    isUploading: () => !!uploading,
    waitForUpload: () => uploading || Promise.resolve(),
    photoChanged: () => photoChanged
  };
}
