import { useEffect, useMemo } from 'react';
import { ArrowLeft } from 'lucide-react';
import { useData } from '../data/DataContext';
import { useAuth } from '../auth/AuthContext';
import { studentRoster, lastTermGpa } from '../data/metrics';
import { buildCreditByCode } from './shared/planStats';
import { normalizeCourseCodeLoose } from '../data/normalize';
import type { PrintTreeKind } from './PrintContext';

interface AdviserStatsPrintPayload {
  adviserId: string;
  adviserName: string;
  search?: string;
  sortConfig?: { key: string; direction: 'asc' | 'desc' } | null;
  advisers?: { uid: string; email: string | null; displayName: string | null; role: 'advisor' | 'master' }[];
}

export default function AdviserStatsPrint({
  activeTree,
  payload,
}: {
  activeTree: PrintTreeKind;
  payload: AdviserStatsPrintPayload;
}) {
  const { state, metricsByStudent } = useData();
  const { cloudEnabled, user, profile } = useAuth();

  useEffect(() => {
    document.title = `Adviser Stats - ${payload.adviserName} - ${new Date().toLocaleDateString('en-GB')}`;
    return () => {
      document.title = 'Academic Advisor';
    };
  }, [payload.adviserName]);

  const rosterById = useMemo(() => new Map(state.roster.map((r) => [r.studentId, r])), [state.roster]);
  const creditByCode = useMemo(() => buildCreditByCode(state.catalog), [state.catalog]);

  // Get all metas (same logic as master dashboard)
  const allMetas = useMemo(() => studentRoster(state.rows, state.roster), [state.rows, state.roster]);

  // Build rows for the selected adviser
  const allRows = useMemo(() => {
    if (!state) return [];
    return allMetas.map((m) => {
      const rosterEntry = rosterById.get(m.studentId);
      const advisorId = rosterEntry?.advisorId ?? 'unassigned';

      // Filter by adviser if not 'all'
      if (payload.adviserId !== 'all' && advisorId !== payload.adviserId) return null;

      const advisorName = payload.adviserName;

      // Compute GPA
      const gpa = lastTermGpa(state.rows, m.studentId);

      // Compute total hours from all terms
      const plannedCodes = new Set<string>();
      for (const t of state.terms) {
        const entry = t.entries.find((e) => e.studentId === m.studentId);
        if (entry) for (const c of entry.courseCodes) plannedCodes.add(normalizeCourseCodeLoose(c));
      }
      let totalHours = 0;
      for (const code of plannedCodes) {
        totalHours += creditByCode.get(code) ?? 0;
      }

      return {
        studentId: m.studentId,
        name: m.name,
        major: m.major,
        gpa: gpa > 0 ? gpa.toFixed(2) : '—',
        totalHours,
        advisorName,
        advisorId,
        sisRegistered: rosterEntry?.sisRegistered ?? false,
        sisPaid: rosterEntry?.sisPaid ?? false,
      };
    }).filter(Boolean);
  }, [state, allMetas, rosterById, creditByCode, payload.adviserId]);

  // Apply search filter
  const filteredRows = useMemo(() => {
    if (!payload.search) return allRows;
    const q = payload.search.toLowerCase();
    return allRows.filter((r) =>
      r.studentId.toLowerCase().includes(q) ||
      r.name.toLowerCase().includes(q) ||
      r.advisorName.toLowerCase().includes(q)
    );
  }, [allRows, payload.search]);

  // Apply sort
  const sortedRows = useMemo(() => {
    if (!payload.sortConfig) return filteredRows;
    return [...filteredRows].sort((a, b) => {
      const aVal = a[payload.sortConfig!.key as keyof typeof a];
      const bVal = b[payload.sortConfig!.key as keyof typeof b];
      if (aVal === bVal) return 0;
      const dir = payload.sortConfig!.direction === 'asc' ? 1 : -1;
      if (typeof aVal === 'number' && typeof bVal === 'number') {
        return (aVal - bVal) * dir;
      }
      return String(aVal).localeCompare(String(bVal)) * dir;
    });
  }, [filteredRows, payload.sortConfig]);

  // Stats
  const stats = useMemo(() => {
    const totalStudents = sortedRows.length;
    const totalHours = sortedRows.reduce((sum, r) => sum + r.totalHours, 0);
    const validGpas = sortedRows.filter(r => r.gpa !== '—').map(r => parseFloat(r.gpa));
    const avgGpa = validGpas.length > 0 ? (validGpas.reduce((s, v) => s + v, 0) / validGpas.length).toFixed(2) : '—';
    const sisRegistered = sortedRows.filter(r => r.sisRegistered).length;
    const sisPaid = sortedRows.filter(r => r.sisPaid).length;
    const notPaid = sortedRows.filter(r => !r.sisPaid).length;
    const regNotPaid = sortedRows.filter(r => r.sisRegistered && !r.sisPaid).length;
    const paidNotReg = sortedRows.filter(r => !r.sisRegistered && r.sisPaid).length;
    const notReg = sortedRows.filter(r => !r.sisRegistered).length;
    return { totalStudents, totalHours, avgGpa, sisRegistered, sisPaid, notPaid, regNotPaid, paidNotReg, notReg };
  }, [sortedRows]);

  const getStatusCell = (value: boolean, yesLabel = 'Yes', noLabel = 'No', yesColor = 'green', noColor = 'gray') => (
    <td style={cellStyle} className="text-center">
      <span style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '4px',
        padding: '2px 8px',
        borderRadius: '4px',
        fontSize: '11px',
        fontWeight: 'bold',
        backgroundColor: value ? `${yesColor}20` : `${noColor}20`,
        color: value ? yesColor : noColor,
        border: `1px solid ${value ? yesColor + '80' : noColor + '80'}`,
      }}>
        {value ? '✓' : '✗'} {value ? yesLabel : noLabel}
      </span>
    </td>
  );

  const cellStyle = {
    padding: '8px 12px',
    fontSize: '12px',
    border: '1px solid #e2e8f0',
    fontFamily: 'system-ui, sans-serif',
  };

  const headerStyle = {
    ...cellStyle,
    backgroundColor: '#f1f5f9',
    color: '#475569',
    fontWeight: 'bold',
    fontSize: '10px',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  };

  if (activeTree !== 'adviser-stats') return null;

  return (
    <div style={{ padding: '20px', fontFamily: 'system-ui, sans-serif', background: 'white', color: '#1e293b' }}>
      {/* Header */}
      <div style={{ marginBottom: '24px', paddingBottom: '16px', borderBottom: '2px solid #e2e8f0' }}>
        <h1 style={{ margin: 0, fontSize: '24px', fontWeight: 'bold', color: '#1e293b' }}>
          Adviser Statistics Report
        </h1>
        <p style={{ margin: '8px 0 0', color: '#64748b', fontSize: '14px' }}>
          Adviser: <strong>{payload.adviserName}</strong> | Generated: {new Date().toLocaleString('en-GB')}
        </p>
      </div>

      {/* Stats Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '12px', marginBottom: '24px' }}>
        {[
          { label: 'Students', value: stats.totalStudents, color: '#3b82f6' },
          { label: 'Total Hours', value: stats.totalHours, color: '#06b6d4' },
          { label: 'Avg GPA', value: stats.avgGpa, color: '#f59e0b' },
          { label: 'SIS Registered', value: stats.sisRegistered, color: '#10b981' },
          { label: 'SIS Paid', value: stats.sisPaid, color: '#10b981' },
        ].map((stat) => (
          <div key={stat.label} style={{
            background: `${stat.color}15`,
            border: `1px solid ${stat.color}60`,
            borderRadius: '8px',
            padding: '16px',
            textAlign: 'center',
          }}>
            <div style={{ fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.05em', color: stat.color, fontWeight: 'bold', marginBottom: '4px' }}>
              {stat.label}
            </div>
            <div style={{ fontSize: '24px', fontWeight: 'bold', color: stat.color }}>
              {stat.value}
            </div>
          </div>
        ))}
      </div>

      {/* Additional Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px', marginBottom: '24px' }}>
        {[
          { label: 'Not Paid', value: stats.notPaid, color: '#ef4444' },
          { label: 'Reg. Not Paid', value: stats.regNotPaid, color: '#f59e0b' },
          { label: 'Paid Not SIS', value: stats.paidNotReg, color: '#3b82f6' },
          { label: 'Not SIS', value: stats.notReg, color: '#ef4444' },
        ].map((stat) => (
          <div key={stat.label} style={{
            background: `${stat.color}15`,
            border: `1px solid ${stat.color}60`,
            borderRadius: '8px',
            padding: '16px',
            textAlign: 'center',
          }}>
            <div style={{ fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.05em', color: stat.color, fontWeight: 'bold', marginBottom: '4px' }}>
              {stat.label}
            </div>
            <div style={{ fontSize: '24px', fontWeight: 'bold', color: stat.color }}>
              {stat.value}
            </div>
          </div>
        ))}
      </div>

      {/* Table */}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px' }}>
          <thead>
            <tr>
              {[
                { key: 'studentId', label: 'ID' },
                { key: 'name', label: 'Name' },
                { key: 'gpa', label: 'GPA' },
                { key: 'totalHours', label: 'Hours' },
                { key: 'sisRegistered', label: 'SIS Reg.' },
                { key: 'sisPaid', label: 'SIS Paid' },
                { key: 'notPaid', label: 'Not Paid' },
                { key: 'regNotPaid', label: 'Reg Not Pd' },
                { key: 'paidNotReg', label: 'Pd Not SIS' },
                { key: 'notReg', label: 'Not SIS' },
                { key: 'paid', label: 'Paid' },
                { key: 'notRegistered', label: 'Not Reg.' },
                { key: 'advisorName', label: 'Advisor' },
              ].map((col) => (
                <th key={col.key} style={headerStyle}>{col.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sortedRows.length === 0 ? (
              <tr>
                <td colSpan={13} style={{ ...cellStyle, textAlign: 'center', padding: '32px', color: '#94a3b8' }}>
                  No students found.
                </td>
              </tr>
            ) : (
              sortedRows.map((r) => (
                <tr key={r.studentId} style={{ borderBottom: '1px solid #e2e8f0' }}>
                  <td style={{ ...cellStyle, fontFamily: 'monospace', fontSize: '10px' }}>{r.studentId}</td>
                  <td style={cellStyle}>{r.name}</td>
                  <td style={{ ...cellStyle, textAlign: 'right', fontFamily: 'monospace' }}>{r.gpa}</td>
                  <td style={{ ...cellStyle, textAlign: 'right', fontFamily: 'monospace' }}>{r.totalHours}</td>
                  <td style={cellStyle} className="text-center">
                    <span style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '4px',
                      padding: '2px 8px',
                      borderRadius: '4px',
                      fontSize: '10px',
                      fontWeight: 'bold',
                      backgroundColor: r.sisRegistered ? '#dcfce7' : '#fef2f2',
                      color: r.sisRegistered ? '#166534' : '#991b1b',
                      border: `1px solid ${r.sisRegistered ? '#86efac' : '#fca5a5'}`,
                    }}>
                      {r.sisRegistered ? '✓ Yes' : '✗ No'}
                    </span>
                  </td>
                  <td style={cellStyle} className="text-center">
                    <span style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '4px',
                      padding: '2px 8px',
                      borderRadius: '4px',
                      fontSize: '10px',
                      fontWeight: 'bold',
                      backgroundColor: r.sisPaid ? '#dcfce7' : '#fef2f2',
                      color: r.sisPaid ? '#166534' : '#991b1b',
                      border: `1px solid ${r.sisPaid ? '#86efac' : '#fca5a5'}`,
                    }}>
                      {r.sisPaid ? '✓ Yes' : '✗ No'}
                    </span>
                  </td>
                  {/* Not Paid */}
                  <td style={cellStyle} className="text-center">
                    <span style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '4px',
                      padding: '2px 8px',
                      borderRadius: '4px',
                      fontSize: '10px',
                      fontWeight: 'bold',
                      backgroundColor: !r.sisPaid ? '#fef2f2' : '#dcfce7',
                      color: !r.sisPaid ? '#991b1b' : '#166534',
                      border: `1px solid ${!r.sisPaid ? '#fca5a5' : '#86efac'}`,
                    }}>
                      {!r.sisPaid ? '✗ Not Paid' : '✓ Paid'}
                    </span>
                  </td>
                  {/* Reg Not Paid */}
                  <td style={cellStyle} className="text-center">
                    {r.sisRegistered && !r.sisPaid ? (
                      <span style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '4px',
                        padding: '2px 8px',
                        borderRadius: '4px',
                        fontSize: '10px',
                        fontWeight: 'bold',
                        backgroundColor: '#fef3c7',
                        color: '#92400e',
                        border: '1px solid #fcd34d',
                      }}>
                        ⚠ Reg Not Paid
                      </span>
                    ) : (
                      <span style={{ color: '#94a3b8', fontSize: '10px' }}>—</span>
                    )}
                  </td>
                  {/* Paid Not Reg */}
                  <td style={cellStyle} className="text-center">
                    {!r.sisRegistered && r.sisPaid ? (
                      <span style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '4px',
                        padding: '2px 8px',
                        borderRadius: '4px',
                        fontSize: '10px',
                        fontWeight: 'bold',
                        backgroundColor: '#dbeafe',
                        color: '#1e40af',
                        border: '1px solid #93c5fd',
                      }}>
                        ⚠ Paid Not SIS
                      </span>
                    ) : (
                      <span style={{ color: '#94a3b8', fontSize: '10px' }}>—</span>
                    )}
                  </td>
                  {/* Not Reg */}
                  <td style={cellStyle} className="text-center">
                    {!r.sisRegistered ? (
                      <span style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '4px',
                        padding: '2px 8px',
                        borderRadius: '4px',
                        fontSize: '10px',
                        fontWeight: 'bold',
                        backgroundColor: '#fef2f2',
                        color: '#991b1b',
                        border: '1px solid #fca5a5',
                      }}>
                        ✗ Not SIS
                      </span>
                    ) : (
                      <span style={{ color: '#94a3b8', fontSize: '10px' }}>—</span>
                    )}
                  </td>
                  {/* Paid */}
                  <td style={cellStyle} className="text-center">
                    {r.sisPaid ? (
                      <span style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '4px',
                        padding: '2px 8px',
                        borderRadius: '4px',
                        fontSize: '10px',
                        fontWeight: 'bold',
                        backgroundColor: '#dcfce7',
                        color: '#166534',
                        border: '1px solid #86efac',
                      }}>
                        ✓ Paid
                      </span>
                    ) : (
                      <span style={{ color: '#94a3b8', fontSize: '10px' }}>—</span>
                    )}
                  </td>
                  {/* Not Registered */}
                  <td style={cellStyle} className="text-center">
                    {!r.sisRegistered ? (
                      <span style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '4px',
                        padding: '2px 8px',
                        borderRadius: '4px',
                        fontSize: '10px',
                        fontWeight: 'bold',
                        backgroundColor: '#fef2f2',
                        color: '#991b1b',
                        border: '1px solid #fca5a5',
                      }}>
                        ✗ Not Reg.
                      </span>
                    ) : (
                      <span style={{ color: '#94a3b8', fontSize: '10px' }}>—</span>
                    )}
                  </td>
                  <td style={{ ...cellStyle, color: '#64748b' }}>{r.advisorName}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}