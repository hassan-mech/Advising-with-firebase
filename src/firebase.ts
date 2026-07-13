/**
 * Firebase app initialization.
 *
 * All config values come from Vite env vars (see `.env.example`) so real
 * keys never get committed. Auth is optional at the app level — nothing
 * here forces a login; components decide whether to react to `user`.
 */
import { initializeApp, type FirebaseApp } from 'firebase/app';
import { getAuth, type Auth } from 'firebase/auth';
import { getFirestore, type Firestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

/** True once all required env vars are present. Lets the UI degrade
 * gracefully (offline-only) if the developer hasn't configured a
 * Firebase project yet, instead of crashing the whole app. */
export const isFirebaseConfigured = Boolean(
  firebaseConfig.apiKey && firebaseConfig.projectId && firebaseConfig.appId
);

let app: FirebaseApp | null = null;
let authInstance: Auth | null = null;
let dbInstance: Firestore | null = null;

if (isFirebaseConfigured) {
  app = initializeApp(firebaseConfig);
  authInstance = getAuth(app);
  dbInstance = getFirestore(app);
} else {
  // eslint-disable-next-line no-console
  console.warn(
    '[firebase] Missing VITE_FIREBASE_* env vars — cloud sign-in/sync is disabled. ' +
      'The app still works fully offline. See .env.example.'
  );
}

export const auth = authInstance;
export const db = dbInstance;
export default app;
