// profile.html page script
import {
  EmailAuthProvider, reauthenticateWithCredential, updatePassword
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { waitForPendingWrites } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db } from './lib/firebase.js';
import { requireSession, logout } from './lib/session.js';
import { call } from './lib/api.js';
import { mountBottomNav } from '../components/bottom-nav.js';
mountBottomNav('profile');

/* ---------- Refs ---------- */
const $ = (id) => document.getElementById(id);
const avatar = $('avatar'), pName = $('pName'), pMeta = $('pMeta'), pRoleText = $('pRoleText');
const accountMeta = $('accountMeta');

const rowChangePassword = $('rowChangePassword');
const rowBiometric = $('rowBiometric');
const biometricToggle = $('biometricToggle');
const biometricHint = $('biometricHint');
const rowLanguage = $('rowLanguage');
const currentLanguage = $('currentLanguage');

const syncDot = $('syncDot'), syncLabel = $('syncLabel'), syncPendingBadge = $('syncPendingBadge');
const lastSyncTime = $('lastSyncTime'), connectionStatus = $('connectionStatus'), cacheStatus = $('cacheStatus');
const forceSyncBtn = $('forceSyncBtn'), forceSyncIcon = $('forceSyncIcon'), forceSyncLabel = $('forceSyncLabel');

const rowHelp = $('rowHelp'), rowPrivacy = $('rowPrivacy');
const logoutBtn = $('logoutBtn');

const notifToggles = document.querySelectorAll('.notif-toggle');

// Modals
const passwordModal = $('passwordModal'), closePasswordModal = $('closePasswordModal');
const passwordFormBody = $('passwordFormBody');
const passwordUnavailable = $('passwordUnavailable');
const closePasswordModal2 = $('closePasswordModal2');
const currentPwdEl = $('currentPwd'), newPwdEl = $('newPwd'), confirmPwdEl = $('confirmPwd');
const currentPwdError = $('currentPwdError'), newPwdError = $('newPwdError'), confirmPwdError = $('confirmPwdError');
const passwordError = $('passwordError'), passwordErrorMsg = $('passwordErrorMsg');
const savePasswordBtn = $('savePasswordBtn'), savePasswordLabel = $('savePasswordLabel'), savePasswordSpinner = $('savePasswordSpinner');

const languageModal = $('languageModal'), closeLanguageModal = $('closeLanguageModal'), languageList = $('languageList');
const helpModal = $('helpModal'), closeHelpModal = $('closeHelpModal');
const helpCall = $('helpCall'), helpWhatsApp = $('helpWhatsApp'), helpEmail = $('helpEmail');
const privacyModal = $('privacyModal'), closePrivacyModal = $('closePrivacyModal'), privacyBody = $('privacyBody');

const logoutModal = $('logoutModal'), cancelLogout = $('cancelLogout');
const confirmLogout = $('confirmLogout'), confirmLogoutLabel = $('confirmLogoutLabel'), confirmLogoutSpinner = $('confirmLogoutSpinner');

const toast = $('toast');

/* ---------- Config ---------- */
const SUPPORT_PHONE = '+233240000000';           // ← change to real number
const SUPPORT_WHATSAPP = '233240000000';         // ← change to real number (no + or spaces)
const SUPPORT_EMAIL = 'support@areasupa.com';    // ← change to real email
const LANGUAGES = [
  { code: 'en', name: 'English', native: 'English' },
  { code: 'tw', name: 'Twi', native: 'Twi (Akan)' },
  { code: 'ga', name: 'Ga', native: 'Gã' },
  { code: 'ee', name: 'Ewe', native: 'Eʋegbe' }
];
const PREF_KEY = 'asv.profile.prefs.v1';
const SYNC_KEY = 'asv.profile.lastSync.v1';

/* ---------- Helpers ---------- */
function escapeHtml(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function initialsFrom(name, fallback = '?') {
  if (!name) return fallback;
  const p = String(name).trim().split(/\s+/);
  return ((p[0]?.[0] || '') + (p[1]?.[0] || '')).toUpperCase() || fallback;
}
function toastMsg(msg, tone = 'default') {
  toast.textContent = msg;
  toast.className = 'fixed bottom-6 left-1/2 -translate-x-1/2 z-[60] px-4 py-2.5 rounded-xl text-white text-[12.5px] font-medium shadow-lg fade-up ' +
    (tone === 'error' ? 'bg-[#B93838]' : tone === 'success' ? 'bg-[#1B7F4B]' : 'bg-stone-900');
  toast.classList.remove('hidden');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => toast.classList.add('hidden'), 2600);
}

/* ---------- Preferences (localStorage) ---------- */
function readPrefs() {
  try { return JSON.parse(localStorage.getItem(PREF_KEY) || '{}'); } catch { return {}; }
}
function writePrefs(p) {
  try { localStorage.setItem(PREF_KEY, JSON.stringify(p)); } catch {}
}
let prefs = readPrefs();
const DEFAULT_NOTIFS = { notifyDeposits: true, notifyWithdrawals: true, notifySync: true, notifySystem: false };

/* ---------- Profile load ---------- */
let currentUser = null;

function metaFromUser(u) {
  const created = u.metadata?.creationTime ? new Date(u.metadata.creationTime) : null;
  const lastSignIn = u.metadata?.lastSignInTime ? new Date(u.metadata.lastSignInTime) : null;
  const parts = [];
  if (created) parts.push(`Account created ${created.toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'})}`);
  if (lastSignIn) parts.push(`Last sign-in ${lastSignIn.toLocaleDateString('en-GB',{day:'2-digit',month:'short'})}`);
  return parts.join(' · ');
}

let session = null;

async function loadProfile() {
  const u = currentUser;
  if (!u) return;
  const name = session.profile.name || u.displayName || (u.email ? u.email.split('@')[0] : 'Staff');
  avatar.textContent = initialsFrom(name, 'AS');
  pName.textContent = name;
  pMeta.textContent = u.email || u.phoneNumber || '—';
  pRoleText.textContent = session.roleLabel + (session.profile.branch ? ` · ${session.profile.branch}` : '');
  accountMeta.textContent = metaFromUser(u);
  $('passwordHint').textContent = u.email
    ? 'Update your sign-in password'
    : 'Not available for phone-only accounts';
}

/* ---------- Change password ---------- */
function openPasswordModal() {
  currentPwdEl.value = '';
  newPwdEl.value = '';
  confirmPwdEl.value = '';
  [currentPwdError, newPwdError, confirmPwdError].forEach(el => el.classList.remove('show'));
  passwordError.classList.add('hidden');

  const u = currentUser;
  if (!u) return;

  if (!u.email) {
    passwordFormBody.classList.add('hidden');
    passwordUnavailable.classList.remove('hidden');
  } else {
    passwordFormBody.classList.remove('hidden');
    passwordUnavailable.classList.add('hidden');
  }
  passwordModal.classList.remove('hidden');
}
rowChangePassword.addEventListener('click', openPasswordModal);
closePasswordModal.addEventListener('click', () => passwordModal.classList.add('hidden'));
closePasswordModal2.addEventListener('click', () => passwordModal.classList.add('hidden'));

function showPasswordError(msg) {
  passwordErrorMsg.textContent = msg;
  passwordError.classList.remove('hidden');
}
function hidePasswordError() { passwordError.classList.add('hidden'); }

savePasswordBtn.addEventListener('click', async () => {
  hidePasswordError();
  [currentPwdError, newPwdError, confirmPwdError].forEach(el => el.classList.remove('show'));

  const cur = currentPwdEl.value;
  const nw = newPwdEl.value;
  const conf = confirmPwdEl.value;
  let ok = true;

  if (!cur) { currentPwdError.classList.add('show'); ok = false; }
  if (!nw || nw.length < 10 || !/[A-Za-z]/.test(nw) || !/\d/.test(nw)) { newPwdError.classList.add('show'); ok = false; }
  if (nw && nw === cur) { newPwdError.textContent = 'Choose a password different from the current one.'; newPwdError.classList.add('show'); ok = false; }
  if (nw !== conf) { confirmPwdError.classList.add('show'); ok = false; }
  if (!ok) return;

  const u = currentUser;
  if (!u || !u.email) { showPasswordError('Password change is not available for this account.'); return; }

  savePasswordBtn.disabled = true;
  savePasswordSpinner.classList.remove('hidden');
  savePasswordLabel.textContent = 'Updating…';

  try {
    const cred = EmailAuthProvider.credential(u.email, cur);
    await reauthenticateWithCredential(u, cred);
    await updatePassword(u, nw);
    await u.getIdToken(true);
    try { await call('passwordChanged'); } catch (err) { console.warn('passwordChanged failed', err); }
    if (session?.profile?.mustChangePassword) {
      session.profile.mustChangePassword = false;
      toastMsg('Password updated. Loading your dashboard…', 'success');
      setTimeout(() => window.location.replace('dashboard.html'), 900);
      return;
    }

    savePasswordLabel.textContent = 'Updated';
    toastMsg('Password updated successfully.', 'success');
    setTimeout(() => passwordModal.classList.add('hidden'), 900);
  } catch (e) {
    console.error('Password change failed:', e);
    const code = e?.code || '';
    if (code === 'auth/wrong-password' || code === 'auth/invalid-credential') {
      currentPwdError.classList.add('show');
    } else if (code === 'auth/weak-password') {
      newPwdError.textContent = 'Password is too weak. Use at least 10 characters with letters and numbers.';
      newPwdError.classList.add('show');
    } else if (code === 'auth/requires-recent-login') {
      showPasswordError('Please sign out and sign in again, then try.');
    } else if (code === 'auth/network-request-failed') {
      showPasswordError('Network error. Check your connection.');
    } else {
      showPasswordError(e?.message || 'Could not update password.');
    }
  } finally {
    savePasswordBtn.disabled = false;
    savePasswordSpinner.classList.add('hidden');
    savePasswordLabel.textContent = 'Update password';
  }
});

/* ---------- Biometric login (WebAuthn) ---------- */
async function checkBiometric() {
  try {
    if (!window.PublicKeyCredential || !navigator.credentials) {
      biometricHint.textContent = 'Not supported on this device';
      biometricToggle.disabled = true;
      return;
    }
    const available = await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    if (!available) {
      biometricHint.textContent = 'No biometric sensor available';
      biometricToggle.disabled = true;
      return;
    }
    biometricToggle.disabled = false;
    const enabled = !!prefs.biometricEnabled;
    biometricToggle.setAttribute('aria-checked', String(enabled));
    biometricHint.textContent = enabled ? 'Enabled · Face / fingerprint unlock' : 'Tap to enable';
  } catch (e) {
    console.warn('Biometric check failed:', e);
    biometricHint.textContent = 'Unavailable';
    biometricToggle.disabled = true;
  }
}

biometricToggle.addEventListener('click', async () => {
  const u = currentUser;
  if (!u) return;

  const isOn = biometricToggle.getAttribute('aria-checked') === 'true';

  if (isOn) {
    // Disable
    prefs.biometricEnabled = false;
    delete prefs.biometricCredentialId;
    writePrefs(prefs);
    biometricToggle.setAttribute('aria-checked', 'false');
    biometricHint.textContent = 'Tap to enable';
    toastMsg('Biometric login disabled.');
    return;
  }

  // Enable — prompt biometric registration
  biometricToggle.disabled = true;
  biometricHint.textContent = 'Waiting for biometric…';

  try {
    const challenge = crypto.getRandomValues(new Uint8Array(32));
    const userId = new TextEncoder().encode(u.uid);
    const cred = await navigator.credentials.create({
      publicKey: {
        challenge,
        rp: { name: 'Area Supa Ventures' },
        user: {
          id: userId,
          name: u.email || u.phoneNumber || u.uid,
          displayName: pName.textContent || 'Collector'
        },
        pubKeyCredParams: [
          { type: 'public-key', alg: -7 },
          { type: 'public-key', alg: -257 }
        ],
        authenticatorSelection: {
          authenticatorAttachment: 'platform',
          userVerification: 'required',
          residentKey: 'preferred'
        },
        timeout: 60000,
        attestation: 'none'
      }
    });

    if (!cred) throw new Error('Biometric registration cancelled.');

    // Store credential ID (base64) locally
    const credId = btoa(String.fromCharCode(...new Uint8Array(cred.rawId)));
    prefs.biometricEnabled = true;
    prefs.biometricCredentialId = credId;
    writePrefs(prefs);

    biometricToggle.setAttribute('aria-checked', 'true');
    biometricHint.textContent = 'Enabled · Face / fingerprint unlock';
    toastMsg('Biometric login enabled.', 'success');
  } catch (e) {
    console.warn('Biometric enable failed:', e);
    biometricHint.textContent = 'Enable failed — try again';
    toastMsg('Could not enable biometric login.', 'error');
  } finally {
    biometricToggle.disabled = false;
  }
});

/* ---------- Language ---------- */
function openLanguageModal() {
  languageList.innerHTML = LANGUAGES.map(l => {
    const active = (prefs.language || 'en') === l.code;
    return `
      <button class="w-full flex items-center gap-3 px-6 py-4 hover:bg-stone-50 transition-colors text-left"
              data-lang="${l.code}">
        <div class="w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${active ? 'bg-brand-gold text-white' : 'bg-stone-100 text-stone-500'}">
          <i class="fa-solid fa-language text-[14px]"></i>
        </div>
        <div class="flex-1 min-w-0">
          <p class="text-[13.5px] font-semibold text-stone-900">${escapeHtml(l.name)}</p>
          <p class="text-[11px] text-stone-500 mt-0.5">${escapeHtml(l.native)}</p>
        </div>
        ${active ? '<i class="fa-solid fa-check text-brand-gold text-[14px]"></i>' : ''}
      </button>`;
  }).join('');

  languageList.querySelectorAll('button[data-lang]').forEach(btn => {
    btn.addEventListener('click', () => {
      const code = btn.getAttribute('data-lang');
      prefs.language = code;
      writePrefs(prefs);
      const chosen = LANGUAGES.find(l => l.code === code);
      currentLanguage.textContent = chosen ? chosen.name : code;
      languageModal.classList.add('hidden');
      toastMsg(`Language set to ${chosen ? chosen.name : code}.`);
      // Note: full localisation is a future enhancement.
    });
  });

  languageModal.classList.remove('hidden');
}
rowLanguage.addEventListener('click', openLanguageModal);
closeLanguageModal.addEventListener('click', () => languageModal.classList.add('hidden'));

/* ---------- Notifications preferences ---------- */
function applyNotifPrefs() {
  notifToggles.forEach(t => {
    const key = t.getAttribute('data-key');
    const v = key in prefs ? !!prefs[key] : (DEFAULT_NOTIFS[key] ?? true);
    t.setAttribute('aria-checked', String(v));
  });
}

notifToggles.forEach(t => {
  t.addEventListener('click', () => {
    const key = t.getAttribute('data-key');
    const cur = t.getAttribute('aria-checked') === 'true';
    const nxt = !cur;
    t.setAttribute('aria-checked', String(nxt));
    prefs[key] = nxt;
    writePrefs(prefs);
    saveNotifToFirestore();

    // Human-friendly label
    const label = key.replace(/^notify/, '').replace(/([A-Z])/g, ' $1').trim().toLowerCase();
    toastMsg(`${nxt ? 'Enabled' : 'Disabled'} ${label} notifications.`);
  });
});

// Preferences are kept on this device. (Staff profiles are written only by the server.)
function saveNotifToFirestore() {}

/* ---------- Data synchronization ---------- */
function setSyncState(state, label, dotClass) {
  syncDot.className = 'w-2.5 h-2.5 rounded-full ' + (dotClass || 'bg-stone-300');
  syncLabel.textContent = label;
}
function fmtRelative(ts) {
  if (!ts) return '—';
  const diff = Date.now() - ts;
  const sec = Math.floor(diff / 1000);
  if (sec < 5) return 'Just now';
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} min${min === 1 ? '' : 's'} ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hr${hr === 1 ? '' : 's'} ago`;
  const d = new Date(ts);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) + ' · ' +
         d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

function updateConnectionUI() {
  const online = navigator.onLine;
  connectionStatus.textContent = online ? 'Online' : 'Offline';
  connectionStatus.className = 'font-medium text-right ' + (online ? 'text-emerald-600' : 'text-amber-600');

  // Cache status
  try {
    let bytes = 0;
    for (const key in localStorage) {
      if (Object.prototype.hasOwnProperty.call(localStorage, key)) {
        bytes += (localStorage[key] || '').length + key.length;
      }
    }
    if (bytes < 1024) cacheStatus.textContent = `${bytes} B`;
    else if (bytes < 1024 * 1024) cacheStatus.textContent = `${(bytes/1024).toFixed(1)} KB`;
    else cacheStatus.textContent = `${(bytes/1024/1024).toFixed(1)} MB`;
  } catch { cacheStatus.textContent = '—'; }

  const lastSync = Number(localStorage.getItem(SYNC_KEY)) || 0;
  lastSyncTime.textContent = lastSync ? fmtRelative(lastSync) : 'Not yet synced';

  if (online) {
    setSyncState('online', 'Connected', 'bg-emerald-500 animate-pulse');
  } else {
    setSyncState('offline', 'Offline · writes queued', 'bg-amber-500');
    syncPendingBadge.classList.remove('hidden');
    syncPendingBadge.textContent = 'Offline';
  }

  // If online and last sync older than 30s, mark as "stale"
  if (online && lastSync && (Date.now() - lastSync) > 60 * 1000) {
    setSyncState('stale', 'Connected · last sync ' + fmtRelative(lastSync), 'bg-emerald-500');
  }

  forceSyncBtn.disabled = !online;
  forceSyncLabel.textContent = online ? 'Force sync now' : 'Offline — reconnect to sync';
}

async function forceSync() {
  if (!navigator.onLine) {
    toastMsg('You are offline. Reconnect and try again.', 'error');
    return;
  }

  forceSyncBtn.disabled = true;
  forceSyncIcon.classList.add('fa-spin');
  forceSyncLabel.textContent = 'Syncing…';
  setSyncState('syncing', 'Syncing pending writes…', 'bg-amber-500 animate-pulse');

  try {
    // Wait for pending writes to commit
    await waitForPendingWrites(db);

    // Record success
    localStorage.setItem(SYNC_KEY, String(Date.now()));

    setSyncState('online', 'All data synced', 'bg-emerald-500 animate-pulse');
    syncPendingBadge.classList.add('hidden');
    toastMsg('All data is synced.', 'success');
  } catch (e) {
    console.error('Force sync failed:', e);
    setSyncState('error', 'Sync failed — retry', 'bg-red-500');
    toastMsg('Sync failed. Check your connection.', 'error');
  } finally {
    forceSyncIcon.classList.remove('fa-spin');
    forceSyncBtn.disabled = false;
    forceSyncLabel.textContent = 'Force sync now';
    updateConnectionUI();
  }
}
forceSyncBtn.addEventListener('click', forceSync);

window.addEventListener('online', () => { updateConnectionUI(); });
window.addEventListener('offline', () => { updateConnectionUI(); });

/* ---------- Help & support ---------- */
rowHelp.addEventListener('click', () => {
  helpCall.href = `tel:${SUPPORT_PHONE}`;
  helpWhatsApp.href = `https://wa.me/${SUPPORT_WHATSAPP}`;
  helpEmail.href = `mailto:${SUPPORT_EMAIL}`;
  helpModal.classList.remove('hidden');
});
closeHelpModal.addEventListener('click', () => helpModal.classList.add('hidden'));

/* ---------- Privacy & security ---------- */
rowPrivacy.addEventListener('click', () => {
  const u = currentUser;
  const created = u?.metadata?.creationTime ? new Date(u.metadata.creationTime).toLocaleString('en-GB') : '—';
  const lastSignIn = u?.metadata?.lastSignInTime ? new Date(u.metadata.lastSignInTime).toLocaleString('en-GB') : '—';
  const provider = u?.providerData?.[0]?.providerId || (u?.phoneNumber ? 'phone' : 'email');

  privacyBody.innerHTML = `
    <div class="space-y-3">
      <div class="flex items-start justify-between gap-3 text-[12.5px] py-2 border-b border-stone-100">
        <span class="text-stone-500">Sign-in method</span>
        <span class="font-semibold text-stone-900 text-right capitalize">${escapeHtml(provider)}</span>
      </div>
      <div class="flex items-start justify-between gap-3 text-[12.5px] py-2 border-b border-stone-100">
        <span class="text-stone-500">Account created</span>
        <span class="font-semibold text-stone-900 text-right">${escapeHtml(created)}</span>
      </div>
      <div class="flex items-start justify-between gap-3 text-[12.5px] py-2 border-b border-stone-100">
        <span class="text-stone-500">Last sign-in</span>
        <span class="font-semibold text-stone-900 text-right">${escapeHtml(lastSignIn)}</span>
      </div>
      <div class="flex items-start justify-between gap-3 text-[12.5px] py-2 border-b border-stone-100">
        <span class="text-stone-500">Biometric unlock</span>
        <span class="font-semibold ${prefs.biometricEnabled ? 'text-emerald-600' : 'text-stone-500'} text-right">
          ${prefs.biometricEnabled ? 'Enabled' : 'Disabled'}
        </span>
      </div>
    </div>

    <div class="rounded-xl bg-stone-50 border border-stone-200 p-4 text-[12px] text-stone-600 leading-relaxed">
      <p class="font-semibold text-stone-800 mb-1.5">Your data is protected</p>
      <p>Customer information is stored securely in the cloud and only accessible
         to signed-in staff, according to their role. Balances can only change through
         recorded deposits and withdrawals, checked on the server. Only the owner and
         administrators can permanently delete a customer, and every deletion is
         recorded in the audit log.</p>
    </div>

    <div class="rounded-xl bg-blue-50 border border-blue-200 p-4 text-[12px] text-blue-900 leading-relaxed">
      <p class="font-semibold mb-1.5">Data Protection Act (Act 843)</p>
      <p>Your business operates in compliance with Ghana's Data Protection Act.
         Customer personal data is used only for susu management purposes.</p>
    </div>
  `;

  privacyModal.classList.remove('hidden');
});
closePrivacyModal.addEventListener('click', () => privacyModal.classList.add('hidden'));

/* ---------- Logout ---------- */
logoutBtn.addEventListener('click', () => {
  logoutModal.classList.remove('hidden');
});
cancelLogout.addEventListener('click', () => logoutModal.classList.add('hidden'));

confirmLogout.addEventListener('click', async () => {
  confirmLogout.disabled = true;
  confirmLogoutSpinner.classList.remove('hidden');
  confirmLogoutLabel.textContent = 'Logging out…';

  try {
    // Best effort: flush pending writes before signing out
    if (navigator.onLine) {
      try { await waitForPendingWrites(db); } catch {}
    }
    await logout();
  } catch (e) {
    console.error('Logout failed:', e);
    confirmLogout.disabled = false;
    confirmLogoutSpinner.classList.add('hidden');
    confirmLogoutLabel.textContent = 'Log out';
    toastMsg('Could not log out. Try again.', 'error');
  }
});

/* ---------- Backdrop click to close modals ---------- */
[
  [passwordModal, closePasswordModal],
  [languageModal, closeLanguageModal],
  [helpModal, closeHelpModal],
  [privacyModal, closePrivacyModal],
  [logoutModal, cancelLogout]
].forEach(([modal, closer]) => {
  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.classList.add('hidden');
  });
});

/* ---------- Session + init ---------- */
{
  session = await requireSession();
  currentUser = session.user;
  if (session.profile.mustChangePassword || new URLSearchParams(location.search).get('changePassword') === '1') {
    if (session.profile.mustChangePassword) $('mustChangeBanner').classList.remove('hidden');
    if (currentUser.email) setTimeout(openPasswordModal, 200);
  }
  await loadProfile();
  applyNotifPrefs();
  checkBiometric();
  updateConnectionUI();

  // Language display
  const lang = LANGUAGES.find(l => l.code === (prefs.language || 'en'));
  currentLanguage.textContent = lang ? lang.name : 'English';

  // Update last sync time display periodically
  setInterval(updateConnectionUI, 30000);
}
