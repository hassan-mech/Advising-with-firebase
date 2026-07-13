/**
 * AuthContext — optional Firebase sign-in layer.
 *
 * Design goals (per project requirements):
 *  - The app is fully usable offline, with zero registration. Nothing
 *    here gates any screen. `user` is simply `null` until someone signs
 *    in voluntarily (top-right "Sign in" button in Shell).
 *  - Two roles, stored on a `users/{uid}` Firestore profile doc:
 *      - "advisor" (default for every new account) — manages only the
 *        students assigned to them (`advisorId === uid`).
 *      - "master"  — can see every advisor's students + reports.
 *        Master accounts are NOT self-service: promote a user by
 *        hand-editing their `users/{uid}.role` field to "master" in
 *        the Firestore console. There is no UI to self-promote, on
 *        purpose — that's a security boundary, not an oversight.
 *  - Email/password AND Google sign-in are both supported.
 */
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import {
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut as firebaseSignOut,
  updateProfile,
  type User,
} from 'firebase/auth';
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { auth, db, isFirebaseConfigured } from '../firebase';

export type Role = 'advisor' | 'master';

export interface UserProfile {
  uid: string;
  email: string | null;
  displayName: string | null;
  role: Role;
}

interface AuthContextValue {
  /** Whether cloud features are configured at all (env vars present). */
  cloudEnabled: boolean;
  /** Firebase auth user, or null when signed out. */
  user: User | null;
  /** Role/profile loaded from Firestore, or null while loading / signed out. */
  profile: UserProfile | null;
  /** True while the initial auth-state check or profile fetch is running. */
  loading: boolean;
  error: string | null;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  signUpWithEmail: (email: string, password: string, displayName: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
  clearError: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/** Creates the profile doc on first sign-in (default role: advisor), or
 * loads the existing one. Never overwrites an existing role — that's
 * how "master" promotions (done by hand in Firestore) survive re-login. */
async function ensureProfile(user: User): Promise<UserProfile> {
  if (!db) {
    return { uid: user.uid, email: user.email, displayName: user.displayName, role: 'advisor' };
  }
  const ref = doc(db, 'users', user.uid);
  const snap = await getDoc(ref);
  if (snap.exists()) {
    const data = snap.data() as { role?: Role; email?: string; displayName?: string };
    return {
      uid: user.uid,
      email: user.email,
      displayName: user.displayName ?? data.displayName ?? null,
      role: data.role === 'master' ? 'master' : 'advisor',
    };
  }
  const fresh: UserProfile = {
    uid: user.uid,
    email: user.email,
    displayName: user.displayName,
    role: 'advisor',
  };
  await setDoc(ref, {
    email: user.email,
    displayName: user.displayName ?? null,
    role: 'advisor',
    createdAt: serverTimestamp(),
  });
  return fresh;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isFirebaseConfigured || !auth) {
      setLoading(false);
      return;
    }
    const unsubscribe = onAuthStateChanged(auth, async (fbUser) => {
      setUser(fbUser);
      if (fbUser) {
        try {
          const p = await ensureProfile(fbUser);
          setProfile(p);
        } catch (err) {
          console.warn('[auth] Failed to load profile:', err);
          setProfile({ uid: fbUser.uid, email: fbUser.email, displayName: fbUser.displayName, role: 'advisor' });
        }
      } else {
        setProfile(null);
      }
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  const clearError = () => setError(null);

  const signInWithEmail = async (email: string, password: string) => {
    if (!auth) return;
    setError(null);
    try {
      await signInWithEmailAndPassword(auth, email, password);
    } catch (err) {
      setError(friendlyAuthError(err));
      throw err;
    }
  };

  const signUpWithEmail = async (email: string, password: string, displayName: string) => {
    if (!auth) return;
    setError(null);
    try {
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      if (displayName) {
        await updateProfile(cred.user, { displayName });
      }
    } catch (err) {
      setError(friendlyAuthError(err));
      throw err;
    }
  };

  const signInWithGoogle = async () => {
    if (!auth) return;
    setError(null);
    try {
      await signInWithPopup(auth, new GoogleAuthProvider());
    } catch (err) {
      setError(friendlyAuthError(err));
      throw err;
    }
  };

  const signOut = async () => {
    if (!auth) return;
    await firebaseSignOut(auth);
  };

  return (
    <AuthContext.Provider
      value={{
        cloudEnabled: isFirebaseConfigured,
        user,
        profile,
        loading,
        error,
        signInWithEmail,
        signUpWithEmail,
        signInWithGoogle,
        signOut,
        clearError,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

const FALLBACK_AUTH: AuthContextValue = {
  cloudEnabled: false,
  user: null,
  profile: null,
  loading: false,
  error: null,
  signInWithEmail: async () => {},
  signUpWithEmail: async () => {},
  signInWithGoogle: async () => {},
  signOut: async () => {},
  clearError: () => {},
};

/**
 * Auth is an optional layer on top of a fully-functional offline app,
 * so losing it should never crash the UI. If this hook is ever called
 * outside <AuthProvider> — e.g. a stray import path, or a dev-mode
 * Fast Refresh edge case where this module's Context identity was
 * reset after a live edit — it logs a warning and returns an inert,
 * signed-out value instead of throwing.
 */
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    console.warn('[auth] useAuth() called outside <AuthProvider> — cloud features disabled for this render.');
    return FALLBACK_AUTH;
  }
  return ctx;
}

function friendlyAuthError(err: unknown): string {
  const code = (err as { code?: string })?.code ?? '';
  switch (code) {
    case 'auth/invalid-email':
      return 'That email address looks invalid.';
    case 'auth/user-not-found':
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
      return 'Incorrect email or password.';
    case 'auth/email-already-in-use':
      return 'An account with that email already exists — try signing in instead.';
    case 'auth/weak-password':
      return 'Password should be at least 6 characters.';
    case 'auth/popup-closed-by-user':
      return 'Sign-in was cancelled.';
    default:
      return err instanceof Error ? err.message : 'Something went wrong. Please try again.';
  }
}
