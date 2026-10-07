// One-time setup: makes an existing sign-in account the Owner.
//
//   cd functions
//   GOOGLE_APPLICATION_CREDENTIALS=path/to/service-account.json \
//     node scripts/bootstrap-owner.mjs owner@example.com "Owner Name"
//
// Roles are now stored only by the server. Because the old app let any
// signed-in browser write its own users/{uid} profile (including "role"),
// every other existing profile is suspended until the owner re-activates it
// from the Staff page. Pass --keep-others to skip that step.

import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

const [email, name] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const keepOthers = process.argv.includes('--keep-others');
if (!email) {
  console.error('Usage: node scripts/bootstrap-owner.mjs <owner-email> ["Owner Name"] [--keep-others]');
  process.exit(1);
}

initializeApp({ credential: applicationDefault() });
const auth = getAuth();
const db = getFirestore();

const user = await auth.getUserByEmail(email);
await db.doc(`users/${user.uid}`).set({
  name: name || user.displayName || email,
  email,
  role: 'owner',
  status: 'active',
  mustChangePassword: false,
  createdBy: 'bootstrap',
  updatedAt: FieldValue.serverTimestamp()
}, { merge: true });
console.log(`✔ ${email} (${user.uid}) is now the Owner.`);

if (!keepOthers) {
  const others = await db.collection('users').get();
  for (const d of others.docs) {
    if (d.id === user.uid) continue;
    const u = d.data();
    if (u.createdBy && u.createdBy !== 'bootstrap') continue; // created by the new server code
    await d.ref.set({ status: 'suspended', role: u.role === 'owner' || u.role === 'admin' ? 'collector' : (u.role || 'collector') }, { merge: true });
    await auth.revokeRefreshTokens(d.id).catch(() => {});
    console.log(`  suspended ${u.email || u.name || d.id} — re-activate from the Staff page if this person should have access`);
  }
}
process.exit(0);
