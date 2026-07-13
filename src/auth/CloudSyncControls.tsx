import { useState } from 'react';
import { Cloud, CloudUpload, CloudDownload, LogOut, ShieldCheck, Loader2 } from 'lucide-react';
import { useAuth } from './AuthContext';
import { useData } from '../data/DataContext';
import { pullMyDataFromCloud, pushMyDataToCloud } from '../data/cloudSync';

interface CloudSyncControlsProps {
  /** Called when the signed-in "master" account wants to open the
   *  cross-advisor management dashboard (reassign/edit/delete students,
   *  promote/demote advisors). */
  onOpenMasterDashboard: () => void;
  /** Called when a signed-out visitor wants to sign in — navigates to
   *  the full-screen auth view (see App.tsx / AuthScreen.tsx). */
  onOpenAuth: () => void;
}

/**
 * Header widget: "Sign in" when signed out; when signed in, shows the
 * account plus manual "Sync to Cloud" / "Load from Cloud" actions for
 * advisors, or a "Master Report" shortcut for the master role.
 *
 * Renders nothing at all if Firebase isn't configured, so the app is
 * unaffected until a developer sets up a project.
 */
export default function CloudSyncControls({ onOpenMasterDashboard, onOpenAuth }: CloudSyncControlsProps) {
  const { cloudEnabled, user, profile, loading, signOut } = useAuth();
  const { state, mergeCloudData } = useData();
  const [syncing, setSyncing] = useState<'push' | 'pull' | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  if (!cloudEnabled) return null;
  if (loading) {
    return <Loader2 className="w-4 h-4 text-slate-500 animate-spin" />;
  }

  if (!user || !profile) {
    return (
      <button
        onClick={onOpenAuth}
        className="flex items-center gap-2 bg-white/5 hover:bg-white/10 text-slate-200 px-3 py-1.5 rounded-md text-[10px] font-bold uppercase tracking-wider border border-white/10 transition-all cursor-pointer active:scale-95"
      >
        <Cloud className="w-3.5 h-3.5" />
        Sign in
      </button>
    );
  }

  const push = async () => {
    setSyncing('push');
    setStatus(null);
    try {
      const result = await pushMyDataToCloud(state, user.uid);
      setStatus(`Synced ${result.studentsWritten} student(s) to the cloud.`);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Sync failed.');
    } finally {
      setSyncing(null);
    }
  };

  const pull = async () => {
    setSyncing('pull');
    setStatus(null);
    try {
      const data = await pullMyDataFromCloud(user.uid);
      mergeCloudData(data);
      setStatus(`Loaded ${data.roster.length} student(s) from the cloud.`);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Load failed.');
    } finally {
      setSyncing(null);
    }
  };

  return (
    <div className="flex items-center gap-2">
      {status && <span className="text-[10px] text-slate-400 max-w-[220px] truncate">{status}</span>}

      {profile.role === 'master' && (
        <button
          onClick={onOpenMasterDashboard}
          className="flex items-center gap-2 bg-amber-500/15 hover:bg-amber-500/25 text-amber-200 px-3 py-1.5 rounded-md text-[10px] font-bold uppercase tracking-wider border border-amber-500/30 transition-all cursor-pointer active:scale-95"
          title="Manage every advisor's students, and promote/demote advisors"
        >
          <ShieldCheck className="w-3.5 h-3.5" />
          Master dashboard
        </button>
      )}

      <button
        onClick={push}
        disabled={syncing !== null}
        title="Push your local students up to the cloud"
        className="flex items-center gap-2 bg-white/5 hover:bg-white/10 text-slate-200 px-3 py-1.5 rounded-md text-[10px] font-bold uppercase tracking-wider border border-white/10 transition-all cursor-pointer active:scale-95 disabled:opacity-40"
      >
        {syncing === 'push' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CloudUpload className="w-3.5 h-3.5" />}
        Sync to cloud
      </button>
      <button
        onClick={pull}
        disabled={syncing !== null}
        title="Load your students down from the cloud (e.g. on a new device)"
        className="flex items-center gap-2 bg-white/5 hover:bg-white/10 text-slate-200 px-3 py-1.5 rounded-md text-[10px] font-bold uppercase tracking-wider border border-white/10 transition-all cursor-pointer active:scale-95 disabled:opacity-40"
      >
        {syncing === 'pull' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CloudDownload className="w-3.5 h-3.5" />}
        Load from cloud
      </button>

      <div className="flex items-center gap-2 pl-2 border-l border-white/10">
        <span className="text-[10px] text-slate-400 max-w-[140px] truncate">
          {profile.displayName || profile.email}
        </span>
        <button
          onClick={signOut}
          title="Sign out"
          className="flex items-center justify-center w-8 h-8 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 hover:text-white transition-all cursor-pointer active:scale-95"
        >
          <LogOut className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
