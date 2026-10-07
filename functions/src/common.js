import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { hasPermission, isRole } from './roles.js';

if (!getApps().length) initializeApp();

export const db = getFirestore();
export const adminAuth = getAuth();
export { FieldValue, Timestamp, HttpsError, logger };

// Every callable shares these options. enforceAppCheck can be switched on once
// App Check is configured for the web app (see README).
export const CALLABLE_OPTS = {
  region: 'us-central1',
  cors: true,
  enforceAppCheck: process.env.ENFORCE_APP_CHECK === 'true',
  maxInstances: 10
};

export const ACTIVE = 'active';

/**
 * Loads the caller's staff record and checks they are active and, when a
 * permission is given, allowed to do this. The users/{uid} document is only
 * ever written by these functions, so it is the source of truth for roles.
 */
export async function requireStaff(request, permission) {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Please sign in to continue.');
  const uid = request.auth.uid;
  const snap = await db.doc(`users/${uid}`).get();
  const u = snap.exists ? snap.data() : null;
  if (!u || u.status !== ACTIVE || !isRole(u.role)) {
    throw new HttpsError('permission-denied', 'Your account does not have access to Area Supa Ventures.');
  }
  if (permission && !hasPermission(u.role, permission)) {
    throw new HttpsError('permission-denied', 'Your role is not allowed to do this. Ask an administrator.');
  }
  return { uid, role: u.role, name: u.name || request.auth.token.email || 'Staff', email: u.email || null, branch: u.branch || null };
}

/**
 * For destructive or privileged actions: the caller must have signed in (or
 * re-entered their password) within the last `maxAgeSeconds`.
 */
export function requireRecentLogin(request, maxAgeSeconds = 10 * 60) {
  const authTime = Number(request.auth?.token?.auth_time) || 0;
  if (Date.now() / 1000 - authTime > maxAgeSeconds) {
    throw new HttpsError('failed-precondition', 'For your security, please confirm your password to continue.',
      { reason: 'recent-login-required' });
  }
}

export async function audit(actor, action, { targetType = null, targetId = null, summary = '', details = null } = {}) {
  try {
    await db.collection('auditLogs').add({
      action,
      actorUid: actor?.uid || 'system',
      actorName: actor?.name || 'System',
      actorRole: actor?.role || null,
      targetType,
      targetId,
      summary,
      details,
      at: FieldValue.serverTimestamp()
    });
  } catch (e) {
    logger.error('audit write failed', { action, error: e.message });
  }
}

/* ------------------------------------------------------------------ */
/* Input validation. Everything from the browser is untrusted.        */
/* ------------------------------------------------------------------ */

export function bad(message) {
  return new HttpsError('invalid-argument', message);
}

export function str(value, { label, max = 120, required = false, min = 0 } = {}) {
  if (value === undefined || value === null) value = '';
  if (typeof value !== 'string' && typeof value !== 'number') throw bad(`${label} is not valid.`);
  // Strip control characters; collapse runs of whitespace.
  const s = String(value).replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim();
  if (required && !s) throw bad(`${label} is required.`);
  if (s && s.length < min) throw bad(`${label} is too short.`);
  if (s.length > max) throw bad(`${label} must be at most ${max} characters.`);
  return s;
}

export function text(value, { label, max = 1000 } = {}) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') throw bad(`${label} is not valid.`);
  const s = value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();
  if (s.length > max) throw bad(`${label} must be at most ${max} characters.`);
  return s;
}

export function oneOf(value, options, { label, required = false } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) throw bad(`${label} is required.`);
    return '';
  }
  if (!options.includes(value)) throw bad(`${label} is not valid.`);
  return value;
}

export function digits(raw) {
  return String(raw || '').replace(/\D/g, '');
}

// Accepts 0241234567, 241234567, 233241234567 or +233 24 123 4567.
// Returns the local 10-digit form (0241234567) or '' when empty.
export function ghanaPhone(raw, { label, required = false } = {}) {
  const d = digits(raw);
  if (!d) {
    if (required) throw bad(`${label} is required.`);
    return '';
  }
  let local = null;
  if (d.length === 10 && d.startsWith('0')) local = d;
  else if (d.length === 9) local = '0' + d;
  else if (d.length === 12 && d.startsWith('233')) local = '0' + d.slice(3);
  if (!local || !/^0[2-5]\d{8}$/.test(local)) throw bad(`${label} must be a valid Ghana phone number.`);
  return local;
}

export function toE164(localPhone) {
  return localPhone ? '+233' + localPhone.slice(1) : null;
}

export function isoDate(value, { label, required = false, notFuture = false } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) throw bad(`${label} is required.`);
    return '';
  }
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw bad(`${label} must be a date.`);
  const d = new Date(value + 'T00:00:00Z');
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value) throw bad(`${label} is not a real date.`);
  if (d.getUTCFullYear() < 1900) throw bad(`${label} is too far in the past.`);
  if (notFuture && value > todayAccra()) throw bad(`${label} cannot be in the future.`);
  return value;
}

export function email(value, { label = 'Email', required = false } = {}) {
  const s = str(value, { label, max: 254, required }).toLowerCase();
  if (s && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) throw bad(`${label} doesn't look right.`);
  return s;
}

export function requestId(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{8,64}$/.test(value)) {
    throw bad('Missing request id. Refresh the page and try again.');
  }
  return value;
}

export function docId(value, label = 'ID') {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) throw bad(`${label} is not valid.`);
  return value;
}

/* ------------------------------------------------------------------ */
/* Money: always computed in pesewas (integers) to avoid float drift. */
/* ------------------------------------------------------------------ */

export const MAX_TRANSACTION_GHS = 1_000_000;

export function toPesewas(ghs) {
  return Math.round(Number(ghs || 0) * 100);
}
export function fromPesewas(p) {
  return Math.round(p) / 100;
}

export function amountGhs(value) {
  const n = typeof value === 'string' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isFinite(n)) throw bad('Enter a valid amount.');
  const p = toPesewas(n);
  if (Math.abs(p / 100 - n) > 1e-9) throw bad('Amounts can have at most 2 decimal places.');
  if (p <= 0) throw bad('Amount must be more than zero.');
  if (p > MAX_TRANSACTION_GHS * 100) throw bad(`A single transaction cannot exceed GH₵${MAX_TRANSACTION_GHS.toLocaleString('en-GH')}.`);
  return p / 100;
}

export function formatGhs(n) {
  return (Number(n) || 0).toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/* ------------------------------------------------------------------ */
/* Dates. Ghana is on GMT all year, so UTC dates are Accra dates.     */
/* ------------------------------------------------------------------ */

export function todayAccra(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

export function prettyDate(iso) {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00Z');
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

export function prettyDateTime(d = new Date()) {
  return d.toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Accra'
  });
}

export async function loadSettings() {
  const [general, sms] = await Promise.all([
    db.doc('settings/general').get(),
    db.doc('settings/sms').get()
  ]);
  return { general: general.data() || {}, sms: sms.data() || {} };
}
