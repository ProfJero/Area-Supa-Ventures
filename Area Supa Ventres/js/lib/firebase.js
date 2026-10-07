import './pwa.js';
// The one place the Firebase app is configured. Every page imports from here,
// so the SDK initialises once per page with a single config.
//
// The web config below is public by design; access is controlled by
// firestore.rules and the Cloud Functions, not by hiding these values.

import { initializeApp, getApps, getApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getAuth, connectAuthEmulator } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager, getFirestore, connectFirestoreEmulator
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { getFunctions, connectFunctionsEmulator } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js';

export const firebaseConfig = {
  apiKey: 'AIzaSyACzsITf1wON6R4vmJQR8cpA6qF7PDw2pY',
  authDomain: 'area-supa-ventures.firebaseapp.com',
  projectId: 'area-supa-ventures',
  storageBucket: 'area-supa-ventures.firebasestorage.app',
  messagingSenderId: '339989502774',
  appId: '1:339989502774:web:6cbf99587d4317af0a7197'
};

// Must match CALLABLE_OPTS.region in functions/src/common.js.
export const FUNCTIONS_REGION = 'us-central1';

export const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
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

export const functions = getFunctions(app, FUNCTIONS_REGION);

// Local development only: `firebase emulators:start` then open
// http://localhost:5002 . Never true on the live site.
export const USING_EMULATORS = ['localhost', '127.0.0.1'].includes(location.hostname) && location.port === '5002';
if (USING_EMULATORS) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
  connectFunctionsEmulator(functions, '127.0.0.1', 5001);
}
