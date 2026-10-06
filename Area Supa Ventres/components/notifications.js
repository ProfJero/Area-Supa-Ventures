// components/notifications.js
// Helpers to create and subscribe to notifications.
//
// Usage in a page:
//   import { pushNotification, subscribeUnreadCount } from './components/notifications.js';
//   await pushNotification({ type: 'deposit', title: 'Deposit completed', ... });
//
// All notifications live in /notifications/{id} and are scoped to a userId.

import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager, getFirestore,
  collection, doc, setDoc, serverTimestamp,
  query, where, orderBy, limit, onSnapshot, getDocs, writeBatch
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyACzsITf1wON6R4vmJQR8cpA6qF7PDw2pY",
  authDomain: "area-supa-ventures.firebaseapp.com",
  projectId: "area-supa-ventures",
  storageBucket: "area-supa-ventures.firebasestorage.app",
  messagingSenderId: "339989502774",
  appId: "1:339989502774:web:6cbf99587d4317af0a7197",
  measurementId: "G-WDJCSK78QE"
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
export const auth = getAuth(app);

let _db;
try {
  _db = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
  });
} catch {
  _db = getFirestore(app);
}
export const db = _db;

/**
 * Creates a notification document. Safe to call from anywhere.
 * @param {object} data - notification fields.
 *   Required: type, title.
 *   Optional: body, customerId, customerName, accountNumber, amount,
 *             transactionId, iconType, userId (defaults to current user)
 * @returns {Promise<string|null>} - doc id, or null if unauthenticated
 */
export async function pushNotification(data) {
  const user = auth.currentUser;
  if (!user) return null;

  const ref = doc(collection(db, 'notifications'));
  const payload = {
    userId: data.userId || user.uid,
    type: data.type || 'system',
    title: data.title || 'Notification',
    body: data.body || '',
    iconType: data.iconType || 'info',
    read: false,
    createdAt: serverTimestamp(),
    customerId: data.customerId || null,
    customerName: data.customerName || null,
    accountNumber: data.accountNumber || null,
    amount: typeof data.amount === 'number' ? data.amount : null,
    transactionId: data.transactionId || null
  };
  await setDoc(ref, payload);
  return ref.id;
}

/**
 * Returns a notification document payload that can be written inside a
 * Firestore transaction (runTransaction). Use this when you want the
 * notification to be atomically written alongside the underlying transaction.
 *
 * Example:
 *   const nRef = doc(collection(db, 'notifications'));
 *   await runTransaction(db, async (t) => {
 *     ...
 *     t.set(nRef, buildNotificationPayload({ type: 'deposit', ... }));
 *   });
 */
export function buildNotificationPayload(data) {
  const user = auth.currentUser;
  return {
    userId: data.userId || (user ? user.uid : null),
    type: data.type || 'system',
    title: data.title || 'Notification',
    body: data.body || '',
    iconType: data.iconType || 'info',
    read: false,
    createdAt: serverTimestamp(),
    customerId: data.customerId || null,
    customerName: data.customerName || null,
    accountNumber: data.accountNumber || null,
    amount: typeof data.amount === 'number' ? data.amount : null,
    transactionId: data.transactionId || null
  };
}

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
  const { deleteDoc } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");
  await deleteDoc(doc(db, 'notifications', id));
}