// Thin client for the ProfJero Connect SMS API.
// The secret API key never leaves the server: it is stored in Google Secret
// Manager (firebase functions:secrets:set PROFJERO_API_KEY).

import { defineSecret } from 'firebase-functions/params';
import { HttpsError, logger } from './common.js';

export const PROFJERO_API_KEY = defineSecret('PROFJERO_API_KEY');
// PROFJERO_BASE_URL is only for local testing against a mock server.
export const PROFJERO_BASE = process.env.PROFJERO_BASE_URL || 'https://profjero-sms-api-prod.amoakob947.workers.dev';

const RETRYABLE = new Set([429, 500, 502, 503, 504]);

export class ProfJeroError extends Error {
  constructor(status, code, message, requestId) {
    super(message);
    this.status = status;
    this.code = code;
    this.requestId = requestId;
  }
}

/**
 * Calls ProfJero. Send/charge requests must pass an idempotencyKey; they are
 * retried with the same key on 429/5xx, which ProfJero guarantees will never
 * send or charge twice.
 */
export async function profjero(method, path, { body, idempotencyKey, auth = true, retries = 2 } = {}) {
  const headers = { Accept: 'application/json' };
  if (auth) headers.Authorization = `Bearer ${PROFJERO_API_KEY.value()}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;

  let attempt = 0;
  for (;;) {
    let res;
    try {
      res = await fetch(PROFJERO_BASE + path, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(20_000)
      });
    } catch (e) {
      if (attempt < retries && (method === 'GET' || idempotencyKey)) {
        attempt++;
        await sleep(800 * attempt);
        continue;
      }
      throw new ProfJeroError(0, 'network', 'Could not reach the SMS provider. Try again shortly.');
    }

    const raw = await res.text();
    let json = null;
    try { json = raw ? JSON.parse(raw) : null; } catch { /* non-JSON error page */ }

    if (res.ok) return json;

    if (RETRYABLE.has(res.status) && attempt < retries && (method === 'GET' || idempotencyKey)) {
      attempt++;
      const retryAfter = Math.min(Number(res.headers.get('Retry-After')) || attempt, 10);
      await sleep(retryAfter * 1000);
      continue;
    }

    const err = json?.error || {};
    logger.warn('ProfJero error', { path, status: res.status, code: err.code, requestId: err.requestId });
    throw new ProfJeroError(res.status, err.code || `http_${res.status}`,
      err.message || `SMS provider returned ${res.status}.`, err.requestId);
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// Maps provider errors to messages the admin can act on.
export function toHttpsError(e) {
  if (!(e instanceof ProfJeroError)) return e instanceof HttpsError ? e : new HttpsError('internal', 'SMS request failed.');
  const ref = e.requestId ? ` (ref ${e.requestId})` : '';
  switch (e.status) {
    case 400: return new HttpsError('invalid-argument', e.message + ref);
    case 401: return new HttpsError('failed-precondition', 'The ProfJero API key is missing, revoked or expired. Update it in the server settings.' + ref);
    case 402: return new HttpsError('resource-exhausted', 'Not enough SMS units. Buy more units and try again. Nothing was sent.' + ref);
    case 403: return new HttpsError('permission-denied', (e.message || 'The SMS provider refused this request.') + ref);
    case 404: return new HttpsError('not-found', e.message + ref);
    case 409: return new HttpsError('already-exists', e.message + ref);
    case 429: return new HttpsError('resource-exhausted', 'The SMS provider is busy. Wait a minute and try again.' + ref);
    default:  return new HttpsError('unavailable', 'The SMS provider is unavailable right now. Try again shortly.' + ref);
  }
}

// ProfJero accepts 0241234567 or 233241234567.
export function smsNumber(localPhone) {
  const d = String(localPhone || '').replace(/\D/g, '');
  if (/^0[2-5]\d{8}$/.test(d)) return d;
  if (/^233[2-5]\d{8}$/.test(d)) return d;
  if (/^[2-5]\d{8}$/.test(d)) return '0' + d;
  return null;
}
