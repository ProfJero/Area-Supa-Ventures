// Calls to the Cloud Functions. Money, customers, staff and SMS all go through
// here; the browser never writes those records itself.

import { httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js';
import {
  EmailAuthProvider, reauthenticateWithCredential
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { auth, functions } from './firebase.js';
import { promptPassword } from './ui.js';

const cache = new Map();
function fn(name) {
  if (!cache.has(name)) cache.set(name, httpsCallable(functions, name, { timeout: 300_000 }));
  return cache.get(name);
}

export class ApiError extends Error {
  constructor(message, code, details) {
    super(message);
    this.code = code;
    this.details = details || null;
  }
}

function friendly(e) {
  const code = String(e?.code || '').replace(/^functions\//, '');
  if (code === 'unavailable' && !navigator.onLine) return new ApiError('You are offline. Reconnect and try again.', code);
  if (code === 'internal' && /^internal$/i.test(e?.message || '')) {
    return new ApiError('Something went wrong on the server. Please try again.', code);
  }
  if (code === 'deadline-exceeded') return new ApiError('The server took too long to respond. Check your connection and try again.', code);
  return new ApiError(e?.message || 'Something went wrong. Please try again.', code, e?.details);
}

/**
 * Calls a function. When the server asks for a recent sign-in (destructive or
 * privileged actions), the user is asked for their password once and the call
 * is retried.
 */
export async function call(name, data = {}) {
  try {
    return (await fn(name)(data)).data;
  } catch (e) {
    const err = friendly(e);
    if (err.details?.reason === 'recent-login-required') {
      await reauthenticate();
      try {
        return (await fn(name)(data)).data;
      } catch (e2) {
        throw friendly(e2);
      }
    }
    throw err;
  }
}

export async function reauthenticate() {
  const user = auth.currentUser;
  if (!user) throw new ApiError('Please sign in again.', 'unauthenticated');
  if (!user.email) {
    throw new ApiError('Please sign out and sign in again to confirm it is you, then retry.', 'failed-precondition');
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    const pw = await promptPassword({
      title: 'Confirm it’s you',
      message: `Enter the password for ${user.email} to continue.`,
      error: attempt ? 'That password is not correct. Try again.' : ''
    });
    if (pw === null) throw new ApiError('Cancelled.', 'cancelled');
    try {
      await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, pw));
      await user.getIdToken(true);
      return;
    } catch (e) {
      if (e?.code === 'auth/too-many-requests') {
        throw new ApiError('Too many attempts. Wait a few minutes and try again.', 'resource-exhausted');
      }
    }
  }
  throw new ApiError('Password confirmation failed.', 'permission-denied');
}

// A fresh id per form submission makes retries safe (no double posting).
export function newRequestId() {
  const a = new Uint8Array(12);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
}
