import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useWebSocket } from '../context/WebSocketContext';
import { BloodRequest, AllocationAuditLog } from '../types';
import { Radio, Play, RotateCcw, Activity, ShieldCheck, ArrowRight, Zap, Info } from 'lucide-react';

export const CoordinatorDashboard: React.FC = () => {
  const { token } = useAuth();
  const { events, lastEvent } = useWebSocket();

  const [requests, setRequests] = useState<BloodRequest[]>([]);
  const [loading, setLoading] = useState(false);
  const [demoStep, setDemoStep] = useState<number>(0);
  const [demoLog, setDemoLog] = useState<string[]>([]);
  const [isAutoRunning, setIsAutoRunning] = useState(false);

  // Selected audit inspection
  const [selectedAuditLog, setSelectedAuditLog] = useState<AllocationAuditLog[] | null>(null);

  const fetchRequests = async () => {
    setLoading(true);
    try {
      const res = await fetch('http://localhost:8000/api/v1/requests');
      if (res.ok) {
        const data = await res.json();
        setRequests(data);
      }
    } catch (err) {
      console.error('Failed to fetch requests:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRequests();
  }, []);

  useEffect(() => {
    if (lastEvent) {
      fetchRequests();
    }
  }, [lastEvent]);

  const addDemoLog = (msg: string) => {
    setDemoLog((prev) => [`[${new Date().toLocaleTimeString()}] ${msg}`, ...prev.slice(0, 20)]);
  };

  const handleResetSeed = async () => {
    try {
      const res = await fetch('http://localhost:8000/api/v1/admin/reset-seed', { method: 'POST' });
      if (res.ok) {
        setDemoStep(0);
        addDemoLog('Database reset to clean Section 14 synthetic state.');
        await fetchRequests();
      }
    } catch (err) {
      console.error('Failed to reset database:', err);
    }
  };

  // Section 14 Demo Flow Steps
  const executeStep1 = async () => {
    addDemoLog('Demo Step 1: Submitting Request RA (MTP, 2 units O-)...');
    try {
      const res = await fetch('http://localhost:8000/api/v1/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          patient_id_token: 'PT-DEMO-RA-TRAUMA',
          required_blood_group: 'O-',
          component_type: 'PRBC',
          units_requested: 2,
          triage_level: 'MASSIVE_TRANSFUSION_PROTOCOL',
          deadline_at: new Date(Date.now() + 12 * 60000).toISOString(),
        }),
      });
      const data = await res.json();
      addDemoLog(`Request RA created (${data.id.slice(0, 8)}...). Status: ${data.status}. Units BB-001 & BB-002 FEFO hard-locked!`);
      setDemoStep(1);
    } catch (err) {
      addDemoLog(`Error in Step 1: ${err}`);
    }
  };

  const executeStep2 = async () => {
    addDemoLog('Demo Step 2: Submitting Request RB (Active Trauma, 1 unit O-)...');
    try {
      const res = await fetch('http://localhost:8000/api/v1/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          patient_id_token: 'PT-DEMO-RB-SURGERY',
          required_blood_group: 'O-',
          component_type: 'PRBC',
          units_requested: 1,
          triage_level: 'ACTIVE_TRAUMA',
          deadline_at: new Date(Date.now() + 45 * 60000).toISOString(),
        }),
      });
      const data = await res.json();
      addDemoLog(`Request RB created. O- inventory depleted by RA -> Broadcast to D1 (2.1km) & D2 (3.8km)! Status: ${data.status}`);
      setDemoStep(2);
    } catch (err) {
      addDemoLog(`Error in Step 2: ${err}`);
    }
  };

  const executeStep3 = async () => {
    addDemoLog('Demo Step 3: Quarantining Unit BB-001 (simulating contamination)...');
    try {
      // Find BB-001 unit id
      const invRes = await fetch('http://localhost:8000/api/v1/inventory', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const invData = await invRes.json();
      const bb001 = invData.find((u: any) => u.batch_number === 'BB-001');

      if (!bb001) throw new Error('BB-001 unit not found');

      await fetch(`http://localhost:8000/api/v1/inventory/units/${bb001.id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ status: 'QUARANTINED' }),
      });

      addDemoLog('Unit BB-001 quarantined! Re-planning engine triggered for RA -> broadcasts for 1 missing unit to D1 & D2!');
      setDemoStep(3);
    } catch (err) {
      addDemoLog(`Error in Step 3: ${err}`);
    }
  };

  const executeStep4 = async () => {
    addDemoLog('Demo Step 4: Donor Alice (D1) accepts dispatch for RA...');
    try {
      // Find Request RA
      const reqRes = await fetch('http://localhost:8000/api/v1/requests');
      const allReqs = await reqRes.json();
      const reqRA = allReqs.find((r: any) => r.patient_id_token === 'PT-DEMO-RA-TRAUMA');

      if (!reqRA) throw new Error('Request RA not found');

      // Login as Alice to get her token
      const loginRes = await fetch('http://localhost:8000/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'alice@donor.org', password: 'password123' }),
      });
      const loginData = await loginRes.json();

      const respondRes = await fetch(`http://localhost:8000/api/v1/donors/requests/${reqRA.id}/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${loginData.access_token}` },
        body: JSON.stringify({ action: 'ACCEPT' }),
      });
      const resData = await respondRes.json();

      addDemoLog(`First-Ack Hard Lock committed by D1! RA restored to COMMITTED_IN_TRANSIT (Hybrid: BB-002 + D1). Other donors stood down.`);
      setDemoStep(4);
    } catch (err) {
      addDemoLog(`Error in Step 4: ${err}`);
    }
  };

  const runFullDemoSequence = async () => {
    setIsAutoRunning(true);
    await handleResetSeed();
    await new Promise((r) => setTimeout(r, 1000));

    await executeStep1();
    await new Promise((r) => setTimeout(r, 1800));

    await executeStep2();
    await new Promise((r) => setTimeout(r, 2000));

    await executeStep3();
    await new Promise((r) => setTimeout(r, 2000));

    await executeStep4();
    setIsAutoRunning(false);
  };

  const inspectExplanation = async (id: string) => {
    try {
      const res = await fetch(`http://localhost:8000/api/v1/audit/requests/${id}/explanation`);
      if (res.ok) {
        const data = await res.json();
        setSelectedAuditLog(data);
      }
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div>
      {/* Automated Section 14 Scenario Runner Widget */}
      <div className="glass-panel highlight-cyan" style={{ marginBottom: '1.5rem', border: '1px solid rgba(6, 182, 212, 0.4)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem', marginBottom: '1rem' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
              <Zap size={20} color="var(--cyan-400)" />
              <h2 style={{ fontSize: '1.2rem', fontWeight: 800 }}>
                Section 14 End-to-End Synthetic Demo Controller
              </h2>
              <span className="badge badge-cyan">Workflow.md Reference</span>
            </div>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
              Demonstrates multi-unit FEFO reservation, inventory depletion donor broadcast, contamination failure, and real-time re-planning.
            </p>
          </div>

          <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
            <button
              id="btn-reset-demo"
              onClick={handleResetSeed}
              className="btn btn-secondary"
              style={{ fontSize: '0.8rem' }}
              disabled={isAutoRunning}
            >
              <RotateCcw size={14} />
              Reset Seed
            </button>
            <button
              id="btn-run-full-demo"
              onClick={runFullDemoSequence}
              className="btn btn-cyan"
              style={{ fontSize: '0.8rem' }}
              disabled={isAutoRunning}
            >
              <Play size={14} />
              {isAutoRunning ? 'Running Sequence...' : '▶ Run Full Section 14 Flow'}
            </button>
          </div>
        </div>

        {/* Step-by-Step Control Strip */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.75rem', marginBottom: '1rem' }}>
          <button
            id="btn-step-1"
            onClick={executeStep1}
            disabled={isAutoRunning}
            className={`btn ${demoStep >= 1 ? 'btn-cyan' : 'btn-secondary'}`}
            style={{ fontSize: '0.75rem', padding: '0.5rem', justifyContent: 'flex-start' }}
          >
            <b>1.</b> Submit RA (MTP 2x O-)
          </button>
          <button
            id="btn-step-2"
            onClick={executeStep2}
            disabled={isAutoRunning || demoStep < 1}
            className={`btn ${demoStep >= 2 ? 'btn-cyan' : 'btn-secondary'}`}
            style={{ fontSize: '0.75rem', padding: '0.5rem', justifyContent: 'flex-start' }}
          >
            <b>2.</b> Submit RB (Trauma 1x O-)
          </button>
          <button
            id="btn-step-3"
            onClick={executeStep3}
            disabled={isAutoRunning || demoStep < 2}
            className={`btn ${demoStep >= 3 ? 'btn-danger-outline' : 'btn-secondary'}`}
            style={{ fontSize: '0.75rem', padding: '0.5rem', justifyContent: 'flex-start' }}
          >
            <b>3.</b> Quarantine BB-001
          </button>
          <button
            id="btn-step-4"
            onClick={executeStep4}
            disabled={isAutoRunning || demoStep < 3}
            className={`btn ${demoStep >= 4 ? 'btn-primary' : 'btn-secondary'}`}
            style={{ fontSize: '0.75rem', padding: '0.5rem', justifyContent: 'flex-start' }}
          >
            <b>4.</b> Donor D1 Accepts RA
          </button>
        </div>

        {/* Live Step Execution Console */}
        <div style={{
          background: 'rgba(5, 7, 12, 0.85)',
          padding: '0.75rem',
          borderRadius: '8px',
          fontFamily: 'var(--font-mono)',
          fontSize: '0.75rem',
          maxHeight: '120px',
          overflowY: 'auto',
          border: '1px solid rgba(255,255,255,0.06)'
        }}>
          {demoLog.length === 0 ? (
            <span style={{ color: 'var(--text-dim)' }}>Ready to run demo sequence. Click "Run Full Section 14 Flow" to execute automatically.</span>
          ) : (
            demoLog.map((log, idx) => (
              <div key={idx} style={{ color: idx === 0 ? 'var(--cyan-400)' : 'var(--text-muted)', marginBottom: '0.2rem' }}>
                {log}
              </div>
            ))
          )}
        </div>
      </div>

      {/* Main Operational Split View */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: '1.5rem' }}>
        {/* City-Wide Emergency Queue */}
        <div className="glass-panel">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <h2 style={{ fontSize: '1.15rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Activity size={18} color="var(--crimson-500)" />
              City-Wide Emergency Blood Allocation Queue
            </h2>
            <span className="badge badge-purple">{requests.length} Requests Total</span>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-subtle)', textAlign: 'left', color: 'var(--text-muted)' }}>
                  <th style={{ padding: '0.65rem' }}>PATIENT / REQ</th>
                  <th style={{ padding: '0.65rem' }}>BLOOD</th>
                  <th style={{ padding: '0.65rem' }}>URGENCY</th>
                  <th style={{ padding: '0.65rem' }}>STATUS</th>
                  <th style={{ padding: '0.65rem' }}>SOURCING ALLOCATION</th>
                  <th style={{ padding: '0.65rem', textAlign: 'right' }}>AUDIT</th>
                </tr>
              </thead>
              <tbody>
                {requests.map((req) => (
                  <tr key={req.id} style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.04)' }}>
                    <td style={{ padding: '0.65rem' }}>
                      <div style={{ fontWeight: 700, color: 'white' }}>{req.patient_id_token}</div>
                      <div style={{ fontSize: '0.7rem', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>
                        {req.id.slice(0, 8)}...
                      </div>
                    </td>
                    <td style={{ padding: '0.65rem' }}>
                      <span style={{ fontWeight: 700, color: 'var(--crimson-500)' }}>
                        {req.units_requested}x {req.required_blood_group}
                      </span>
                    </td>
                    <td style={{ padding: '0.65rem', fontWeight: 800, color: req.calculated_urgency_score >= 80 ? 'var(--crimson-500)' : 'var(--cyan-400)' }}>
                      {req.calculated_urgency_score.toFixed(0)}
                    </td>
                    <td style={{ padding: '0.65rem' }}>
                      <span className={`badge ${
                        req.status === 'COMMITTED_IN_TRANSIT'
                          ? 'badge-green'
                          : req.status === 'RE_PLANNING'
                          ? 'badge-red'
                          : req.status === 'PROXIMITY_ZONE_NOTIFIED'
                          ? 'badge-amber'
                          : 'badge-cyan'
                      }`}>
                        {req.status}
                      </span>
                    </td>
                    <td style={{ padding: '0.65rem', fontSize: '0.75rem' }}>
                      {req.allocations && req.allocations.length > 0 ? (
                        req.allocations.map((a, i) => (
                          <div key={i} style={{ color: a.source_type === 'BLOOD_BANK_INVENTORY' ? '#93c5fd' : '#86efac' }}>
                            • {a.source_type === 'BLOOD_BANK_INVENTORY' ? 'Inventory FEFO' : 'Live Donor (First-Ack)'}
                          </div>
                        ))
                      ) : (
                        <span style={{ color: 'var(--text-dim)' }}>Searching...</span>
                      )}
                    </td>
                    <td style={{ padding: '0.65rem', textAlign: 'right' }}>
                      <button
                        onClick={() => inspectExplanation(req.id)}
                        className="btn btn-secondary"
                        style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }}
                      >
                        <Info size={12} />
                        Explain
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Live Real-Time Event Telemetry Stream */}
        <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', height: '600px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <h2 style={{ fontSize: '1.15rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Radio size={18} color="var(--emerald-400)" />
              Live Real-Time Event Stream
            </h2>
            <span className="pulse-dot" />
          </div>

          <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
            {events.length === 0 ? (
              <div style={{ textAlign: 'center', color: 'var(--text-dim)', padding: '2rem' }}>
                Listening for real-time WebSocket events...
              </div>
            ) : (
              events.map((ev, i) => (
                <div
                  key={i}
                  style={{
                    background: 'rgba(10, 13, 20, 0.7)',
                    padding: '0.6rem 0.8rem',
                    borderRadius: '8px',
                    border: '1px solid var(--border-subtle)',
                    fontSize: '0.8rem',
                    animation: 'badgePop 0.2s ease',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
                    <span className={`badge ${
                      ev.type.includes('ALERT') || ev.type.includes('RE_PLANNING')
                        ? 'badge-red'
                        : ev.type.includes('SUCCESS') || ev.type.includes('LOCKED')
                        ? 'badge-green'
                        : 'badge-cyan'
                    }`} style={{ fontSize: '0.65rem' }}>
                      {ev.type}
                    </span>
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>
                      {new Date().toLocaleTimeString()}
                    </span>
                  </div>
                  <div style={{ color: '#d1d5db', fontSize: '0.78rem', lineHeight: 1.3 }}>
                    {ev.message || JSON.stringify(ev)}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Audit Modal */}
      {selectedAuditLog && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0, 0, 0, 0.75)',
          backdropFilter: 'blur(8px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 100,
          padding: '1rem',
        }}>
          <div className="glass-panel" style={{ maxWidth: '600px', width: '100%', maxHeight: '80vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h3 style={{ fontSize: '1.1rem', fontWeight: 700 }}>Allocation Audit Justification</h3>
              <button onClick={() => setSelectedAuditLog(null)} className="btn btn-secondary" style={{ padding: '0.2rem 0.5rem' }}>
                ✕
              </button>
            </div>
            {selectedAuditLog.map((log) => (
              <div key={log.id} style={{ background: 'rgba(10, 13, 20, 0.7)', padding: '0.75rem', borderRadius: '8px', marginBottom: '0.75rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.35rem' }}>
                  <span className="badge badge-cyan">{log.decision_type}</span>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>{new Date(log.created_at).toLocaleTimeString()}</span>
                </div>
                <p style={{ fontSize: '0.85rem', color: '#f3f4f6', marginBottom: '0.5rem' }}>{log.rationale_summary}</p>
                <pre style={{ background: 'rgba(0,0,0,0.5)', padding: '0.5rem', borderRadius: '6px', fontSize: '0.7rem', color: 'var(--cyan-400)', whiteSpace: 'pre-wrap' }}>
                  {JSON.stringify(log.candidate_scores_json, null, 2)}
                </pre>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
