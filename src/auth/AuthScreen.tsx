import { useState } from 'react';
import { ArrowLeft, Mail, Lock, User as UserIcon, Loader2, GraduationCap } from 'lucide-react';
import { useAuth } from './AuthContext';

interface AuthScreenProps {
  /** Return to whatever view the user was on before pressing "Sign in". */
  onBack: () => void;
}

/**
 * Full-screen sign-in / sign-up. Rendered as its own top-level view
 * (like DataManagerPage / ScheduleManagerPage) instead of a floating
 * modal, so it always gets a clean, full-height layout regardless of
 * where in the app it was opened from.
 */
export default function AuthScreen({ onBack }: AuthScreenProps) {
  const { signInWithEmail, signUpWithEmail, signInWithGoogle, error, clearError } = useAuth();
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === 'signin') {
        await signInWithEmail(email, password);
      } else {
        await signUpWithEmail(email, password, displayName);
      }
      onBack();
    } catch {
      // error already surfaced via useAuth().error
    } finally {
      setBusy(false);
    }
  };

  const google = async () => {
    setBusy(true);
    try {
      await signInWithGoogle();
      onBack();
    } catch {
      // surfaced via error
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="flex-1 flex flex-col min-h-0 overflow-y-auto bg-slate-950">
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <button
            onClick={onBack}
            className="flex items-center gap-2 text-slate-400 hover:text-slate-200 text-xs font-bold mb-8 cursor-pointer transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Back to app
          </button>

          <div className="flex items-center gap-3 mb-1">
            <div className="p-2 bg-blue-500/15 rounded-lg ring-1 ring-blue-500/30">
              <GraduationCap className="w-5 h-5 text-blue-400" />
            </div>
            <h1 className="text-xl font-extrabold text-slate-100">
              {mode === 'signin' ? 'Sign in' : 'Create account'}
            </h1>
          </div>
          <p className="text-xs text-slate-500 mb-8">
            Optional — sign in to sync your students to the cloud. Everything still works offline without this.
          </p>

          <button
            onClick={google}
            disabled={busy}
            className="w-full flex items-center justify-center gap-2 bg-white/5 hover:bg-white/10 border border-white/10 text-slate-100 text-sm font-semibold py-2.5 rounded-lg transition-colors cursor-pointer disabled:opacity-50 mb-5"
          >
            <GoogleIcon />
            Continue with Google
          </button>

          <div className="flex items-center gap-3 mb-5">
            <div className="flex-1 h-px bg-white/10" />
            <span className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">or</span>
            <div className="flex-1 h-px bg-white/10" />
          </div>

          <form onSubmit={submit} className="space-y-3">
            {mode === 'signup' && (
              <div className="relative">
                <UserIcon className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Full name"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-lg py-2.5 pl-9 pr-3 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                />
              </div>
            )}
            <div className="relative">
              <Mail className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="email"
                required
                placeholder="Email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-lg py-2.5 pl-9 pr-3 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
              />
            </div>
            <div className="relative">
              <Lock className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="password"
                required
                minLength={6}
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-lg py-2.5 pl-9 pr-3 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
              />
            </div>

            {error && <p className="text-xs text-red-400">{error}</p>}

            <button
              type="submit"
              disabled={busy}
              className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-bold py-2.5 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
            >
              {busy && <Loader2 className="w-4 h-4 animate-spin" />}
              {mode === 'signin' ? 'Sign in' : 'Create account'}
            </button>
          </form>

          <button
            onClick={() => {
              clearError();
              setMode(mode === 'signin' ? 'signup' : 'signin');
            }}
            className="w-full text-center text-xs text-slate-400 hover:text-slate-200 mt-5 cursor-pointer"
          >
            {mode === 'signin' ? "Don't have an account? Sign up" : 'Already have an account? Sign in'}
          </button>
        </div>
      </div>
    </main>
  );
}

function GoogleIcon() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 24 24">
      <path
        fill="#4285F4"
        d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.47c-.29 1.48-1.14 2.73-2.4 3.58v2.98h3.89c2.28-2.1 3.53-5.2 3.53-8.8z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.95-1.08 7.93-2.92l-3.89-2.98c-1.08.72-2.45 1.16-4.04 1.16-3.13 0-5.78-2.11-6.73-4.96H1.26v3.09C3.25 21.3 7.31 24 12 24z"
      />
      <path
        fill="#FBBC05"
        d="M5.27 14.3c-.25-.72-.38-1.49-.38-2.3s.14-1.58.38-2.3V6.61H1.26A11.96 11.96 0 000 12c0 1.93.46 3.76 1.26 5.39l4.01-3.09z"
      />
      <path
        fill="#EA4335"
        d="M12 4.74c1.77 0 3.35.61 4.6 1.8l3.45-3.45C17.94 1.19 15.24 0 12 0 7.31 0 3.25 2.7 1.26 6.61l4.01 3.09C6.22 6.85 8.87 4.74 12 4.74z"
      />
    </svg>
  );
}
