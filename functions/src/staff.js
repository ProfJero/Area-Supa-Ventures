import { onCall } from 'firebase-functions/v2/https';
import {
  db, adminAuth, FieldValue, HttpsError, CALLABLE_OPTS,
  requireStaff, requireRecentLogin, audit, bad, str, email, ghanaPhone, toE164, docId, loadSettings
} from './common.js';
import { ROLES, isRole, canManageRole } from './roles.js';

const STATUSES = ['active', 'suspended'];

export function checkPassword(pw) {
  if (typeof pw !== 'string' || pw.length < 10 || pw.length > 128) {
    throw bad('Password must be at least 10 characters.');
  }
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) throw bad('Password must contain letters and numbers.');
  return pw;
}

async function loadTarget(uid) {
  const snap = await db.doc(`users/${uid}`).get();
  if (!snap.exists) throw new HttpsError('not-found', 'Staff member not found.');
  return snap.data();
}

function assertCanManage(actor, targetRole, action = 'manage') {
  if (!canManageRole(actor.role, targetRole)) {
    throw new HttpsError('permission-denied',
      `As ${ROLES[actor.role]?.label || actor.role} you cannot ${action} a ${ROLES[targetRole]?.label || targetRole}.`);
  }
}

async function validBranch(branch) {
  const b = str(branch, { label: 'Branch', max: 60 });
  if (!b) return '';
  const { general } = await loadSettings();
  if (Array.isArray(general.branches) && general.branches.length && !general.branches.includes(b)) {
    throw bad('Choose a branch from the list.');
  }
  return b;
}

export const createStaff = onCall(CALLABLE_OPTS, async (request) => {
  const actor = await requireStaff(request, 'staff.manage');
  requireRecentLogin(request);
  const d = request.data || {};

  const role = d.role;
  if (!isRole(role) || role === 'owner') throw bad('Choose a valid role.');
  assertCanManage(actor, role, 'create');

  const name = str(d.name, { label: 'Full name', max: 80, required: true, min: 3 });
  const mail = email(d.email, { required: true });
  const phone = ghanaPhone(d.phone, { label: 'Phone' });
  const password = checkPassword(d.password);
  const branch = await validBranch(d.branch);

  let user;
  try {
    user = await adminAuth.createUser({
      email: mail,
      password,
      displayName: name,
      phoneNumber: phone ? toE164(phone) : undefined,
      disabled: false
    });
  } catch (e) {
    if (e.code === 'auth/email-already-exists') throw new HttpsError('already-exists', 'An account with this email already exists.');
    if (e.code === 'auth/phone-number-already-exists') throw new HttpsError('already-exists', 'Another account already uses this phone number.');
    throw new HttpsError('internal', 'Could not create the account. ' + (e.message || ''));
  }

  await db.doc(`users/${user.uid}`).set({
    name,
    email: mail,
    phone: phone || null,
    role,
    branch: branch || null,
    status: 'active',
    mustChangePassword: true,
    createdAt: FieldValue.serverTimestamp(),
    createdBy: actor.uid,
    createdByName: actor.name
  });

  await audit(actor, 'staff.create', {
    targetType: 'user', targetId: user.uid, summary: `Added ${name} (${mail}) as ${ROLES[role].label}`
  });
  return { uid: user.uid };
});

export const updateStaff = onCall(CALLABLE_OPTS, async (request) => {
  const actor = await requireStaff(request, 'staff.manage');
  requireRecentLogin(request);
  const d = request.data || {};
  const uid = docId(d.uid, 'Staff member');
  if (uid === actor.uid && (d.role !== undefined || d.status !== undefined)) {
    throw bad('You cannot change your own role or status.');
  }

  const target = await loadTarget(uid);
  if (target.status === 'removed') throw bad('This account was removed.');
  assertCanManage(actor, target.role, 'change');

  const updates = {};
  const auth = {};
  if (d.role !== undefined) {
    if (!isRole(d.role) || d.role === 'owner') throw bad('Choose a valid role.');
    assertCanManage(actor, d.role, 'assign the role of');
    updates.role = d.role;
  }
  if (d.status !== undefined) {
    if (!STATUSES.includes(d.status)) throw bad('Choose a valid status.');
    updates.status = d.status;
    auth.disabled = d.status !== 'active';
  }
  if (d.name !== undefined) {
    updates.name = str(d.name, { label: 'Full name', max: 80, required: true, min: 3 });
    auth.displayName = updates.name;
  }
  if (d.branch !== undefined) updates.branch = (await validBranch(d.branch)) || null;
  if (d.phone !== undefined) {
    const phone = ghanaPhone(d.phone, { label: 'Phone' });
    updates.phone = phone || null;
    auth.phoneNumber = phone ? toE164(phone) : null;
  }
  if (!Object.keys(updates).length) throw bad('Nothing to update.');

  if (Object.keys(auth).length) {
    try {
      await adminAuth.updateUser(uid, auth);
    } catch (e) {
      if (e.code === 'auth/phone-number-already-exists') throw new HttpsError('already-exists', 'Another account already uses this phone number.');
      if (e.code !== 'auth/user-not-found') throw new HttpsError('internal', 'Could not update the sign-in account.');
    }
  }
  // Role or status changes take effect at once: existing sessions are cut off.
  if (updates.role || updates.status) await adminAuth.revokeRefreshTokens(uid).catch(() => {});

  await db.doc(`users/${uid}`).update({ ...updates, updatedAt: FieldValue.serverTimestamp(), updatedBy: actor.uid });

  const what = [];
  if (updates.role) what.push(`role ${ROLES[target.role]?.label} → ${ROLES[updates.role].label}`);
  if (updates.status) what.push(`status → ${updates.status}`);
  if (updates.name || updates.branch !== undefined || updates.phone !== undefined) what.push('details');
  await audit(actor, 'staff.update', {
    targetType: 'user', targetId: uid, summary: `Changed ${target.name}: ${what.join(', ')}`
  });
  return { ok: true };
});

export const resetStaffPassword = onCall(CALLABLE_OPTS, async (request) => {
  const actor = await requireStaff(request, 'staff.manage');
  requireRecentLogin(request);
  const uid = docId(request.data?.uid, 'Staff member');
  if (uid === actor.uid) throw bad('Change your own password from your profile.');
  const target = await loadTarget(uid);
  assertCanManage(actor, target.role, 'reset the password of');
  const password = checkPassword(request.data?.password);

  await adminAuth.updateUser(uid, { password });
  await adminAuth.revokeRefreshTokens(uid).catch(() => {});
  await db.doc(`users/${uid}`).update({ mustChangePassword: true, updatedAt: FieldValue.serverTimestamp() });
  await audit(actor, 'staff.reset_password', { targetType: 'user', targetId: uid, summary: `Reset password for ${target.name}` });
  return { ok: true };
});

export const removeStaff = onCall(CALLABLE_OPTS, async (request) => {
  const actor = await requireStaff(request, 'staff.manage');
  requireRecentLogin(request);
  const uid = docId(request.data?.uid, 'Staff member');
  if (uid === actor.uid) throw bad('You cannot remove yourself.');
  const target = await loadTarget(uid);
  assertCanManage(actor, target.role, 'remove');

  // The sign-in account is deleted; the profile is kept (marked removed) so
  // past transactions still show who recorded them.
  await adminAuth.deleteUser(uid).catch((e) => {
    if (e.code !== 'auth/user-not-found') throw new HttpsError('internal', 'Could not delete the sign-in account.');
  });
  await db.doc(`users/${uid}`).update({
    status: 'removed', removedAt: FieldValue.serverTimestamp(), removedBy: actor.uid
  });
  await audit(actor, 'staff.remove', { targetType: 'user', targetId: uid, summary: `Removed ${target.name} (${target.email || ''})` });
  return { ok: true };
});

// Called after a staff member changes their own password in the browser.
export const passwordChanged = onCall(CALLABLE_OPTS, async (request) => {
  const actor = await requireStaff(request);
  requireRecentLogin(request, 5 * 60);
  await db.doc(`users/${actor.uid}`).update({ mustChangePassword: false, passwordChangedAt: FieldValue.serverTimestamp() });
  await audit(actor, 'staff.password_changed', { targetType: 'user', targetId: actor.uid, summary: `${actor.name} changed their password` });
  return { ok: true };
});

// Staff can edit their own name and phone; nothing else about themselves.
export const updateMyProfile = onCall(CALLABLE_OPTS, async (request) => {
  const actor = await requireStaff(request);
  const d = request.data || {};
  const updates = {};
  const auth = {};
  if (d.name !== undefined) {
    updates.name = str(d.name, { label: 'Full name', max: 80, required: true, min: 3 });
    auth.displayName = updates.name;
  }
  if (d.phone !== undefined) updates.phone = ghanaPhone(d.phone, { label: 'Phone' }) || null;
  if (!Object.keys(updates).length) throw bad('Nothing to update.');
  if (Object.keys(auth).length) await adminAuth.updateUser(actor.uid, auth).catch(() => {});
  await db.doc(`users/${actor.uid}`).update({ ...updates, updatedAt: FieldValue.serverTimestamp() });
  return { ok: true };
});
