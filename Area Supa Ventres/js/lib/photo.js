// Customer photos on Cloudinary.
// The photo is shrunk on the phone before upload (faster on mobile data), then
// uploaded with a one-off signature from the server. The Cloudinary secret
// never reaches the browser.

import { call } from './api.js';

const MAX_SIDE = 800;
const MAX_INPUT_BYTES = 15 * 1024 * 1024;

async function loadImage(file) {
  if ('createImageBitmap' in window) {
    try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch { /* fall through */ }
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That file is not a picture we can read.')); };
    img.src = url;
  });
}

export async function shrinkImage(file) {
  if (!file || !/^image\//.test(file.type)) throw new Error('Choose a photo (JPG, PNG or WebP).');
  if (file.size > MAX_INPUT_BYTES) throw new Error('That photo is too large. Choose one under 15 MB.');
  const img = await loadImage(file);
  const w = img.width;
  const h = img.height;
  const scale = Math.min(1, MAX_SIDE / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.85));
  if (!blob) throw new Error('Could not process that photo.');
  return blob;
}

/**
 * Uploads a photo and returns { photoUrl, photoPublicId }.
 * onProgress receives 0..1.
 */
export async function uploadCustomerPhoto(file, onProgress = () => {}) {
  const blob = await shrinkImage(file);
  const sig = await call('getPhotoUploadSignature');

  const form = new FormData();
  form.append('file', blob, 'photo.jpg');
  form.append('api_key', sig.apiKey);
  form.append('timestamp', String(sig.timestamp));
  form.append('signature', sig.signature);
  form.append('folder', sig.folder);
  form.append('allowed_formats', sig.allowed_formats);

  const res = await new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', sig.uploadUrl);
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
    xhr.onload = () => {
      let body = null;
      try { body = JSON.parse(xhr.responseText); } catch { /* ignore */ }
      if (xhr.status >= 200 && xhr.status < 300 && body?.secure_url) resolve(body);
      else reject(new Error(body?.error?.message || 'Photo upload failed. Try again.'));
    };
    xhr.onerror = () => reject(new Error('Photo upload failed. Check your connection.'));
    xhr.send(form);
  });

  return { photoUrl: res.secure_url, photoPublicId: res.public_id };
}
