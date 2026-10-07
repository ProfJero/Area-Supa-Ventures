// Page guard: waits for sign-in, loads the staff profile (role), hides what the
// role cannot use, and signs out after a period of inactivity.
//
// Hiding buttons is only a convenience. The real checks happen in
// firestore.rules and the Cloud Functions.

import { onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { doc, getDoc } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { auth, db } from './firebase.js';
import { ROLES, hasPermission } from './roles.js';

const DEFAULT_IDLE_MINUTES = 15;
let session = null;

function waitForUser() {
  return new Promise((resolve) => {
    const stop = onAuthStateChanged(auth, (user) => { stop(); resolve(user); });
  });
}

export async function logout(reason = '') {
  try { await signOut(auth); } catch { /* ignore */ }
  try { sessionStorage.clear(); } catch { /* ignore */ }
  window.location.replace('index.html' + (reason ? `?reason=${encodeURIComponent(reason)}` : ''));
}

/**
 * @param {object} opts
 * @param {string} [opts.permission] - required permission for this page
 * @returns {Promise<{user, profile, role, roleLabel, can: (p:string)=>boolean, settings}>}
 */
export async function requireSession({ permission } = {}) {
  if (session) return session;

  const user = await waitForUser();
  if (!user) {
    window.location.replace('index.html');
    return new Promise(() => {}); // never resolves; page is navigating away
  }

  let profile = null;
  let settings = {};
  try {
    const [p, s] = await Promise.all([
      getDoc(doc(db, 'users', user.uid)),
      getDoc(doc(db, 'settings', 'general')).catch(() => null)
    ]);
    profile = p.exists() ? p.data() : null;
    settings = s?.exists() ? s.data() : {};
  } catch (e) {
    console.warn('Profile load failed', e);
  }

  if (!profile || profile.status !== 'active' || !ROLES[profile.role]) {
    await logout(profile && profile.status !== 'active' ? 'suspended' : 'no-access');
    return new Promise(() => {});
  }

  const page = location.pathname.split('/').pop() || 'index.html';
  if (profile.mustChangePassword && page !== 'profile.html') {
    window.location.replace('profile.html?changePassword=1');
    return new Promise(() => {});
  }

  const can = (p) => hasPermission(profile.role, p);
  session = {
    user,
    profile,
    role: profile.role,
    roleLabel: ROLES[profile.role].label,
    can,
    settings
  };

  applyPermissions(document, can);
  startIdleTimer(Number(settings.idleTimeoutMinutes) || DEFAULT_IDLE_MINUTES);

  if (permission && !can(permission)) {
    showNoAccess();
    return new Promise(() => {});
  }
  return session;
}

// Elements marked data-perm="x" (or "x|y" for any-of) are removed unless allowed.
export function applyPermissions(root, can) {
  root.querySelectorAll('[data-perm]').forEach((el) => {
    const any = el.getAttribute('data-perm').split('|');
    if (!any.some((p) => can(p))) el.remove();
  });
  document.documentElement.classList.add('perms-ready');
}

function showNoAccess() {
  const main = document.querySelector('main') || document.body;
  main.innerHTML = `
    <div class="max-w-md mx-auto mt-16 text-center px-6">
      <i class="fa-solid fa-lock text-3xl text-stone-300"></i>
      <p class="mt-3 text-sm font-semibold text-stone-800">You don’t have access to this page</p>
      <p class="text-xs text-stone-500 mt-1">Ask the owner or an administrator if you need it.</p>
      <a href="dashboard.html" class="mt-5 inline-flex px-4 py-2 bg-[#212121] text-white text-[12px] font-semibold rounded-lg">Back to dashboard</a>
    </div>`;
}

/* Auto sign-out after inactivity: protects accounts on shared phones. */
function startIdleTimer(minutes) {
  const KEY = 'asv.lastActivity';
  const limit = minutes * 60_000;
  const touch = () => { try { localStorage.setItem(KEY, String(Date.now())); } catch { /* ignore */ } };
  const last = () => { try { return Number(localStorage.getItem(KEY)) || Date.now(); } catch { return Date.now(); } };

  if (Date.now() - last() > limit) { logout('idle'); return; }
  touch();
  let pending = false;
  const onActivity = () => {
    if (pending) return;
    pending = true;
    setTimeout(() => { pending = false; touch(); }, 5000);
  };
  ['pointerdown', 'keydown', 'scroll', 'touchstart'].forEach((ev) =>
    window.addEventListener(ev, onActivity, { passive: true }));
  setInterval(() => { if (Date.now() - last() > limit) logout('idle'); }, 30_000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && Date.now() - last() > limit) logout('idle');
  });
}

// Called right after a successful sign-in so the idle timer starts fresh.
export function markActive() {
  try { localStorage.setItem('asv.lastActivity', String(Date.now())); } catch { /* ignore */ }
}
