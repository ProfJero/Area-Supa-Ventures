// components/notifications.js
// Helpers to read and manage notifications.
//
// Notifications are created by the Cloud Functions (e.g. after a deposit) in
// /notifications/{id}, scoped to a userId. The browser can only read them,
// mark them read, or delete its own.

import { auth, db } from '../js/lib/firebase.js';
import {
  collection, doc, setDoc, deleteDoc, query, where, onSnapshot, getDocs, writeBatch
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

export { auth, db };

/**
 * Subscribes to the unread count for the current user.
 * @returns unsubscribe function
 */
export function subscribeUnreadCount(callback) {
  let unsub = () => {};
  const stop = auth.onAuthStateChanged((user) => {
    unsub();
    if (!user) { callback(0); return; }
    const q = query(
      collection(db, 'notifications'),
      where('userId', '==', user.uid),
      where('read', '==', false)
    );
    unsub = onSnapshot(q,
      (snap) => callback(snap.size),
      (err) => { console.warn('Unread count subscription error:', err); callback(0); }
    );
  });
  return () => { unsub(); stop(); };
}

/**
 * Marks a single notification as read.
 */
export async function markAsRead(id) {
  const user = auth.currentUser;
  if (!user) return;
  try {
    await setDoc(doc(db, 'notifications', id), { read: true }, { merge: true });
  } catch (e) {
    console.warn('markAsRead failed:', e);
  }
}

/**
 * Marks every unread notification for the current user as read.
 */
export async function markAllAsRead() {
  const user = auth.currentUser;
  if (!user) return 0;
  const q = query(
    collection(db, 'notifications'),
    where('userId', '==', user.uid),
    where('read', '==', false)
  );
  const snap = await getDocs(q);
  if (snap.empty) return 0;
  const batch = writeBatch(db);
  snap.docs.forEach((d) => batch.update(d.ref, { read: true }));
  await batch.commit();
  return snap.size;
}

/**
 * Deletes a single notification.
 */
export async function deleteNotification(id) {
  const user = auth.currentUser;
  if (!user) return;
  await deleteDoc(doc(db, 'notifications', id));
}