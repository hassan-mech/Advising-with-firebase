import { useEffect, useRef, useState } from 'react';
import { DataProvider, useData } from './data/DataContext';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { ThemeProvider } from './components/ThemeContext';
import Shell from './components/Shell';
import EmptyState from './components/EmptyState';
import RosterTable from './components/RosterTable';
import AdvisingPanel from './components/AdvisingPanel';
import PrereqMapScreen from './components/PrereqMapScreen';
import DataManagerPage from './components/DataManagerPage';
import ScheduleManagerPage from './components/ScheduleManagerPage';
import SisSyncReviewPage from './components/SisSyncReviewPage';
import TimetableScreen from './components/TimetableScreen';
import MasterDashboardScreen from './components/MasterDashboardScreen';
import StudentGridPanel from './components/StudentGridPanel';
import AuthScreen from './auth/AuthScreen';
import { pullMyDataFromCloud, fetchAllStudentsForMaster, pullScheduleFromCloud, pushMyDataToCloudSkipExisting, pushMasterDataToCloud } from './data/cloudSync';

type View = 'roster' | 'map' | 'manage' | 'schedule' | 'timetable' | 'master' | 'auth' | 'students' | 'sis-review';

function RosterView({ onJumpToPrereq }: { onJumpToPrereq: (studentId: string) => void }) {
  const { state } = useData();
  if (state.rows.length === 0) {
    return (
      <main className="flex-1 flex min-h-0">
        <EmptyState />
      </main>
    );
  }
  return (
    <main className="flex-1 flex min-h-0">
      <RosterTable onJumpToPrereq={onJumpToPrereq} />
      <AdvisingPanel />
    </main>
  );
}

function AppShell() {
  const [view, setView] = useState<View>('students');
  const [prevView, setPrevView] = useState<View>('students');
  const [viewBeforeAuth, setViewBeforeAuth] = useState<View>('students');
  const [mapStudentId, setMapStudentId] = useState<string | undefined>(undefined);
  const [timetableStudentId, setTimetableStudentId] = useState<string | undefined>(undefined);
  const { cloudEnabled, user, profile } = useAuth();

  const [appliedAdvisorDefault, setAppliedAdvisorDefault] = useState(false);
  const [cloudDataLoaded, setCloudDataLoaded] = useState(false);
  const { mergeCloudData, setMasterSchedule, setScheduleTerm, state } = useData();

  // Use ref to avoid changing useEffect dependency array size
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    if (!appliedAdvisorDefault && cloudEnabled && user && profile?.role === 'advisor') {
      setView('students');
      setAppliedAdvisorDefault(true);
    }
    if (!user && appliedAdvisorDefault) {
      setAppliedAdvisorDefault(false);
    }
  }, [cloudEnabled, user, profile, appliedAdvisorDefault]);

  useEffect(() => {
    if (!cloudDataLoaded && cloudEnabled && user && profile) {
      const loadCloudData = async () => {
        try {
          // 1. Pull existing cloud data (includes shared terms)
          const pulled = profile.role === 'master'
            ? await fetchAllStudentsForMaster()
            : await pullMyDataFromCloud(user.uid);
          if (pulled) mergeCloudData(pulled);

          // 2. Push local students that don't exist in cloud yet (use ref to avoid stale closure)
          if (profile.role === 'master') {
            await pushMasterDataToCloud(stateRef.current);
          } else {
            await pushMyDataToCloudSkipExisting(stateRef.current, user.uid);
          }

          // 3. Pull shared schedule & link to the active shared term
          const schedule = await pullScheduleFromCloud();
          if (schedule) {
            setMasterSchedule(schedule);
            // Restore the term association stored with the schedule.
            if (schedule.termId) {
              setScheduleTerm(schedule.termId);
            }
          }
        } catch (err) {
          console.warn('[cloud] Failed to sync data', err);
        }
        setCloudDataLoaded(true);
      };
      loadCloudData();
    }
    if (!user && cloudDataLoaded) {
      setCloudDataLoaded(false);
    }
  }, [cloudEnabled, user, profile, cloudDataLoaded, mergeCloudData, setMasterSchedule]);

  const jumpToPrereq = (id: string) => { setPrevView(view); setMapStudentId(id); setView('map'); };

  return (
    <Shell
      view={view}
      onChangeView={setView}
      onOpenAuth={() => { setViewBeforeAuth(view); setView('auth'); }}
    >
      {view === 'roster' ? (
        <RosterView onJumpToPrereq={jumpToPrereq} />
      ) : view === 'students' ? (
        <StudentGridPanel onOpenPrereqMap={jumpToPrereq} />
      ) : view === 'map' ? (
        <PrereqMapScreen
          onBack={() => setView(prevView)}
          initialStudentId={mapStudentId}
          onOpenTimetable={(id) => { setTimetableStudentId(id); setView('timetable'); }}
        />
      ) : view === 'timetable' ? (
        <TimetableScreen
          initialStudentId={timetableStudentId ?? ''}
          onBack={() => setView('map')}
        />
      ) : view === 'schedule' ? (
        <ScheduleManagerPage onBack={() => setView('students')} onChangeView={setView as (v: View) => void} />
      ) : view === 'sis-review' ? (
        <SisSyncReviewPage onBack={() => setView('schedule')} />
      ) : view === 'master' ? (
        <MasterDashboardScreen onBack={() => setView('students')} />
      ) : view === 'auth' ? (
        <AuthScreen onBack={() => setView(viewBeforeAuth)} />
      ) : (
        <DataManagerPage onBack={() => setView('students')} />
      )}
    </Shell>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <DataProvider>
          <AppShell />
        </DataProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}