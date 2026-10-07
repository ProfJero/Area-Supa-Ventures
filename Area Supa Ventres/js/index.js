// index.html page script
import {
  setPersistence,
  browserLocalPersistence,
  browserSessionPersistence,
  signInWithEmailAndPassword,
  signInWithPhoneNumber,
  sendPasswordResetEmail,
  RecaptchaVerifier,
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { auth, db } from './lib/firebase.js';
import { markActive } from './lib/session.js';

/* Only staff with an active profile get in. A sign-in account without a
   profile (e.g. someone who signed in with an unknown phone number) is signed
   straight back out. */
async function enterIfAllowed(user) {
  let profile = null;
  try {
    const snap = await getDoc(doc(db, 'users', user.uid));
    profile = snap.exists() ? snap.data() : null;
  } catch (e) {
    console.warn('Profile check failed', e);
  }
  if (!profile || profile.status !== 'active') {
    await signOut(auth);
    revealLogin();
    showError(profile && profile.status === 'suspended'
      ? 'Your account has been suspended. Contact the owner or an administrator.'
      : 'This account does not have access to Area Supa Ventures. Ask an administrator to add you.');
    return false;
  }
  markActive();
  window.location.replace(profile.mustChangePassword ? 'profile.html?changePassword=1' : 'dashboard.html');
  return true;
}

onAuthStateChanged(auth, async (user) => {
  if (user) {
    await enterIfAllowed(user);
  } else {
    revealLogin();
  }
});

/* ---------- UI refs ---------- */
const splash         = document.getElementById('splash');
const login          = document.getElementById('login');

const loginForm      = document.getElementById('loginForm');
const otpForm        = document.getElementById('otpForm');

const identifierEl   = document.getElementById('identifier');
const passwordEl     = document.getElementById('password');
const rememberEl     = document.getElementById('rememberMe');
const forgotLink     = document.getElementById('forgotLink');

const loginBtn       = document.getElementById('loginBtn');
const loginBtnLabel  = document.getElementById('loginBtnLabel');
const loginBtnSpin   = document.getElementById('loginBtnSpinner');

const verifyBtn      = document.getElementById('verifyBtn');
const verifyBtnLabel = document.getElementById('verifyBtnLabel');
const verifyBtnSpin  = document.getElementById('verifyBtnSpinner');
const otpCodeEl      = document.getElementById('otpCode');
const otpPhoneLabel  = document.getElementById('otpPhoneLabel');
const backToLogin    = document.getElementById('backToLogin');

const togglePassword = document.getElementById('togglePassword');
const togglePassIcon = document.getElementById('togglePasswordIcon');

const errorBox       = document.getElementById('errorBox');
const errorText      = document.getElementById('errorText');
const successBox     = document.getElementById('successBox');
const successText    = document.getElementById('successText');

/* ---------- Splash → Login transition ---------- */
let revealed = false;
function revealLogin() {
  if (revealed) return;
  revealed = true;
  splash.classList.add('opacity-0');
  setTimeout(() => {
    splash.remove();
    login.classList.remove('hidden');
  }, 250);
}

const reason = new URLSearchParams(location.search).get('reason');
const REASONS = {
  idle: 'You were signed out after a period of inactivity.',
  suspended: 'Your account has been suspended. Contact the owner or an administrator.',
  'no-access': 'This account does not have access. Ask an administrator to add you.'
};

/* ---------- Helpers ---------- */
function showError(message) {
  successBox.classList.add('hidden');
  errorText.textContent = message;
  errorBox.classList.remove('hidden');
}
function hideError() { errorBox.classList.add('hidden'); }

function showSuccess(message) {
  errorBox.classList.add('hidden');
  successText.textContent = message;
  successBox.classList.remove('hidden');
}

function setLoading(button, labelEl, spinnerEl, isLoading, originalLabel) {
  button.disabled = isLoading;
  spinnerEl.classList.toggle('hidden', !isLoading);
  labelEl.textContent = isLoading ? 'Please wait…' : originalLabel;
}

/* Convert Ghanaian numbers to E.164 (+233…) */
function toE164(raw) {
  let p = String(raw).replace(/[\s\-()]/g, '');
  if (p.startsWith('+')) return p;
  if (p.startsWith('00')) return '+' + p.slice(2);
  if (p.startsWith('0'))  return '+233' + p.slice(1);
  if (p.startsWith('233')) return '+' + p;
  return '+233' + p;
}
function looksLikeEmail(v) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v); }
function looksLikePhone(v) { return /^[+\d][\d\s\-()]{6,}$/.test(v); }

/* ---------- Password visibility toggle ---------- */
togglePassword.addEventListener('click', () => {
  const isPwd = passwordEl.type === 'password';
  passwordEl.type = isPwd ? 'text' : 'password';
  togglePassIcon.className = isPwd
    ? 'fa-regular fa-eye-slash text-[14px]'
    : 'fa-regular fa-eye text-[14px]';
  togglePassword.setAttribute('aria-label', isPwd ? 'Hide password' : 'Show password');
});

/* ---------- Forgot password (email flow) ---------- */
forgotLink.addEventListener('click', (e) => {
  e.preventDefault();
  const id = identifierEl.value.trim();
  if (!looksLikeEmail(id)) {
    showError('Enter your email address first, then tap "Forgot password?".');
    identifierEl.focus();
    return;
  }
  sendPasswordResetEmail(auth, id)
    .catch(() => {})
    // Same message either way, so the form can't be used to discover accounts.
    .finally(() => showSuccess(`If ${id} has an account, a password reset link has been sent to it.`));
});

/* ---------- Email / Password login ---------- */
loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  hideError();

  const raw = identifierEl.value.trim();
  const pwd = passwordEl.value;

  if (!raw) { showError('Please enter your phone number or email.'); return; }

  // Email path
  if (looksLikeEmail(raw)) {
    if (!pwd) { showError('Please enter your password.'); return; }

    try {
      setLoading(loginBtn, loginBtnLabel, loginBtnSpin, true);
      await setPersistence(auth,
        rememberEl.checked ? browserLocalPersistence : browserSessionPersistence);
      await signInWithEmailAndPassword(auth, raw, pwd);
      showSuccess('Signed in. Checking your access…');

    } catch (err) {
      console.error(err);
      showError(prettyAuthError(err));
    } finally {
      setLoading(loginBtn, loginBtnLabel, loginBtnSpin, false, 'Login');
    }
    return;
  }

  // Phone path
  if (looksLikePhone(raw)) {
    try {
      setLoading(loginBtn, loginBtnLabel, loginBtnSpin, true);

      if (!window.recaptchaVerifier) {
        window.recaptchaVerifier = new RecaptchaVerifier(auth, 'recaptcha-container', {
          size: 'invisible',
          callback: () => {}
        });
      }

      const phoneE164 = toE164(raw);
      const confirmation = await signInWithPhoneNumber(auth, phoneE164, window.recaptchaVerifier);
      window.confirmationResult = confirmation;

      otpPhoneLabel.textContent = phoneE164;
      loginForm.classList.add('hidden');
      otpForm.classList.remove('hidden');
      otpCodeEl.value = '';
      otpCodeEl.focus();
      hideError();

    } catch (err) {
      console.error(err);
      showError(prettyAuthError(err));
      if (window.recaptchaVerifier) {
        try { window.recaptchaVerifier.clear(); } catch (_) {}
        window.recaptchaVerifier = null;
      }
    } finally {
      setLoading(loginBtn, loginBtnLabel, loginBtnSpin, false, 'Login');
    }
    return;
  }

  showError('Enter a valid phone number or email address.');
});

/* ---------- OTP verification ---------- */
otpForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  hideError();

  const code = otpCodeEl.value.trim();
  if (code.length !== 6) { showError('Enter the 6-digit code we sent you.'); return; }

  try {
    setLoading(verifyBtn, verifyBtnLabel, verifyBtnSpin, true);
    await window.confirmationResult.confirm(code);
    showSuccess('Verified. Checking your access…');
  } catch (err) {
    console.error(err);
    showError('That code is incorrect or has expired. Please try again.');
  } finally {
    setLoading(verifyBtn, verifyBtnLabel, verifyBtnSpin, false, 'Verify & Sign in');
  }
});

/* ---------- Back to login ---------- */
backToLogin.addEventListener('click', () => {
  otpForm.classList.add('hidden');
  loginForm.classList.remove('hidden');
  hideError();
  passwordEl.value = '';
});

/* ---------- Friendly error messages ---------- */
function prettyAuthError(err) {
  const code = err?.code || '';
  switch (code) {
    case 'auth/invalid-email':            return 'That email address doesn’t look right.';
    case 'auth/user-disabled':            return 'This account has been disabled. Contact the owner.';
    case 'auth/user-not-found':
    case 'auth/invalid-credential':       return 'Incorrect phone/email or password.';
    case 'auth/too-many-requests':        return 'Too many attempts. Please wait a moment and try again.';
    case 'auth/invalid-phone-number':     return 'That phone number is not valid. Use a Ghana number, e.g. 024 555 0192.';
    case 'auth/quota-exceeded':           return 'SMS quota exceeded. Try again later.';
    case 'auth/network-request-failed':   return 'Network error. Check your internet connection.';
    case 'auth/captcha-check-failed':     return 'Security check failed. Please refresh the page.';
    default:                              return err?.message || 'Something went wrong. Please try again.';
  }
}

if (reason && REASONS[reason]) showError(REASONS[reason]);
