// Cloudinary signed uploads for customer photos.
// The API secret stays on the server; the browser only receives a one-off
// signature that lets it upload into our folder with our restrictions.

import crypto from 'node:crypto';
import { defineSecret, defineString } from 'firebase-functions/params';
import { logger } from './common.js';

export const CLOUDINARY_CLOUD_NAME = defineString('CLOUDINARY_CLOUD_NAME');
export const CLOUDINARY_API_KEY = defineString('CLOUDINARY_API_KEY');
export const CLOUDINARY_API_SECRET = defineSecret('CLOUDINARY_API_SECRET');

export const PHOTO_FOLDER = 'area-supa/customers';
export const ALLOWED_FORMATS = 'jpg,jpeg,png,webp';

export function sign(params) {
  const toSign = Object.keys(params)
    .filter((k) => params[k] !== undefined && params[k] !== null && params[k] !== '')
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join('&');
  return crypto.createHash('sha1').update(toSign + CLOUDINARY_API_SECRET.value()).digest('hex');
}

export function uploadSignature() {
  const params = {
    allowed_formats: ALLOWED_FORMATS,
    folder: PHOTO_FOLDER,
    timestamp: Math.floor(Date.now() / 1000)
  };
  return {
    ...params,
    signature: sign(params),
    apiKey: CLOUDINARY_API_KEY.value(),
    cloudName: CLOUDINARY_CLOUD_NAME.value(),
    uploadUrl: `https://api.cloudinary.com/v1_1/${encodeURIComponent(CLOUDINARY_CLOUD_NAME.value())}/image/upload`
  };
}

/**
 * Only accept photos that were uploaded into our own Cloudinary folder, so a
 * customer record can never point at an arbitrary URL.
 */
export function validatePhoto(photoUrl, photoPublicId) {
  if (!photoUrl && !photoPublicId) return { photoUrl: null, photoPublicId: null };
  if (typeof photoUrl !== 'string' || typeof photoPublicId !== 'string') return null;
  if (!/^[A-Za-z0-9_/-]{1,200}$/.test(photoPublicId) || !photoPublicId.startsWith(PHOTO_FOLDER + '/')) return null;
  const prefix = `https://res.cloudinary.com/${CLOUDINARY_CLOUD_NAME.value()}/image/upload/`;
  if (!photoUrl.startsWith(prefix) || photoUrl.length > 400) return null;
  if (!photoUrl.includes('/' + photoPublicId + '.')) return null;
  return { photoUrl, photoPublicId };
}

export async function destroyPhoto(publicId) {
  if (!publicId) return;
  try {
    const params = { public_id: publicId, timestamp: Math.floor(Date.now() / 1000), invalidate: 'true' };
    const body = new URLSearchParams({ ...params, api_key: CLOUDINARY_API_KEY.value(), signature: sign(params) });
    const res = await fetch(
      `https://api.cloudinary.com/v1_1/${encodeURIComponent(CLOUDINARY_CLOUD_NAME.value())}/image/destroy`,
      { method: 'POST', body, signal: AbortSignal.timeout(15_000) }
    );
    if (!res.ok) logger.warn('Cloudinary destroy failed', { publicId, status: res.status });
  } catch (e) {
    logger.warn('Cloudinary destroy error', { publicId, error: e.message });
  }
}
