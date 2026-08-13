// Firebase auth + Firestore sync, isolated from render logic in app.js.
//
// Firebase's web API key is not a secret — access is enforced by the Firestore
// security rules (see README) plus the auth requirement below, not by hiding
// this config.
//
// This app uses its OWN Firebase project, deliberately separate from
// couch-to-novel and workout-tracker. Sharing one would mean editing live
// security rules protecting other data every time this app's schema changes.
//
// NOTE the asymmetry that catches people out: the Firebase key below is safe
// in client code, but an ANTHROPIC key never is — it's a bearer credential.
// That's why outfit composition runs on the Mac and syncs its result down,
// rather than the phone calling Claude directly.

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword,
  createUserWithEmailAndPassword, signOut,
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import {
  getFirestore, collection, doc, setDoc, deleteDoc, onSnapshot,
  enableIndexedDbPersistence,
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

const firebaseConfig = {
  apiKey: 'REPLACE_WITH_WEB_API_KEY',
  authDomain: 'REPLACE.firebaseapp.com',
  projectId: 'REPLACE',
  storageBucket: 'REPLACE.firebasestorage.app',
  messagingSenderId: 'REPLACE',
  appId: 'REPLACE',
};

export const isConfigured = !firebaseConfig.apiKey.startsWith('REPLACE');

const app = isConfigured ? initializeApp(firebaseConfig) : null;
const auth = app ? getAuth(app) : null;
const db = app ? getFirestore(app) : null;

// Adding an item in a changing room shouldn't depend on having signal.
if (db) {
  enableIndexedDbPersistence(db).catch(() => {
    /* multiple tabs open, or unsupported browser — sync still works online */
  });
}

export function watchAuth(fn) {
  if (!auth) return () => {};
  return onAuthStateChanged(auth, fn);
}
export const signIn = (email, pw) => signInWithEmailAndPassword(auth, email, pw);
export const register = (email, pw) => createUserWithEmailAndPassword(auth, email, pw);
export const leave = () => signOut(auth);

const path = (uid, ...rest) => ['users', uid, ...rest];

// Live closet. Images ride along as ~400px JPEG data URIs inside each item
// document — well under Firestore's 1 MiB per-document cap, and it avoids
// Firebase Storage, which now needs the paid Blaze plan for new projects.
export function watchCloset(uid, fn) {
  return onSnapshot(collection(db, ...path(uid, 'closet')), (snap) =>
    fn(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
  );
}
export const saveItem = (uid, item) =>
  setDoc(doc(db, ...path(uid, 'closet', item.id)), item, { merge: true });
export const removeItem = (uid, id) =>
  deleteDoc(doc(db, ...path(uid, 'closet', id)));

export function watchWearLog(uid, fn) {
  return onSnapshot(collection(db, ...path(uid, 'wearLog')), (snap) =>
    fn(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
  );
}
export const logWear = (uid, entry) =>
  setDoc(doc(db, ...path(uid, 'wearLog', entry.date)), entry, { merge: true });

// Written by scripts/outfit.py on the Mac each morning; read-only here.
export function watchComposed(uid, date, fn) {
  return onSnapshot(doc(db, ...path(uid, 'outfits', date)), (d) =>
    fn(d.exists() ? d.data() : null)
  );
}
