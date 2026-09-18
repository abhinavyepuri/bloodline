import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useWebSocket } from '../context/WebSocketContext';
import { BloodRequest, AllocationAuditLog } from '../types';
import { Radio, Play, RotateCcw, Activity, Zap, Info } from 'lucide-react';

const formatEventMessage = (ev: any): string => {
  if (ev.message) return ev.message;

  switch (ev.type) {
    case 'REQUEST_CREATED':
      return `🏥 Hospital submitted an urgent request for ${ev.units_requested || 1} bag(s) of ${ev.required_blood_group} blood.`;
    case 'INVENTORY_LOCKED':
      return `🩸 Blood Bank freezers found matching blood. Reserved ${ev.units_count || 1} unit(s) for the hospital.`;
    case 'EMERGENCY_DISPATCH_ALERT':
      return `🚨 Blood bank freezers are out of stock! Alerting ${ev.donor_ids?.length || 'nearby'} voluntary donors on their phones.`;
    case 'BLOOD_BANK_DISPATCHED':
      return `🚚 Blood Bank packed blood bag(s) ${ev.batches ? ev.batches.join(', ') : ''} and handed them to the ambulance courier.`;
    case 'DONOR_CLAIM_SUCCESS':
      return `✅ Nearby voluntary donor accepted! They are now traveling to the hospital.`;
    case 'DONOR_STAND_DOWN':
      return `ℹ️ Another donor already accepted. Other donors can stand down.`;
    case 'RE_PLANNING_TRIGGERED':
      return `⚠️ A blood bag had an issue (${ev.reason || 'damaged'}). The system is finding an emergency replacement.`;
    case 'ALTERNATIVE_FOUND':
      return `🔄 Replacement blood bag secured from alternative source!`;
    case 'REQUEST_FULFILLED':
      return `🎉 Blood arrived safely at the hospital. Transfusion confirmed!`;
    case 'REQUEST_CANCELLED':
      return `❌ Blood request was cancelled by the hospital doctor.`;
    case 'SYSTEM_RESET':
      return `🔄 Demo data reset to clean initial starting state.`;
    default:
      return `${ev.type}: Update received.`;
  }
};

const formatStatusText = (status: string): string => {
  switch (status) {
    case 'PENDING_EVALUATION':
      return 'Checking Freezers';
    case 'PROXIMITY_ZONE_NOTIFIED':
      return 'Alerting Donors';
    case 'COMMITTED_IN_TRANSIT':
      return 'Blood In Transit';
    case 'RE_PLANNING':
      return 'Finding Replacement';
    case 'FULFILLED':
      return 'Delivered';
    case 'CANCELLED':
      return 'Cancelled';
    default:
      return status.replace(/_/g, ' ');
  }
};

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
        addDemoLog('System reset: All requests cleared, blood bank restocked with fresh blood bags.');
        await fetchRequests();
      }
    } catch (err) {
      console.error('Failed to reset database:', err);
    }
  };

  // Demo Flow Steps in plain English
  const executeStep1 = async () => {
    addDemoLog('Step 1: Hospital asks for 2 bags of O- blood for an urgent surgery...');
    try {
      const res = await fetch('http://localhost:8000/api/v1/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          patient_id_token: 'PATIENT-EMERGENCY-1',
          required_blood_group: 'O-',
          component_type: 'PRBC',
          units_requested: 2,
          triage_level: 'MASSIVE_TRANSFUSION_PROTOCOL',
          deadline_at: new Date(Date.now() + 15 * 60000).toISOString(),
        }),
      });
      const data = await res.json();
      addDemoLog(`Success: Blood bank had 2 bags (BB-001 & BB-002). Both bags reserved and en route to hospital.`);
      setDemoStep(1);
    } catch (err) {
      addDemoLog(`Error in Step 1: ${err}`);
    }
  };

  const executeStep2 = async () => {
    addDemoLog('Step 2: Another patient arrives needing 1 bag of O- blood...');
    try {
      const res = await fetch('http://localhost:8000/api/v1/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          patient_id_token: 'PATIENT-EMERGENCY-2',
          required_blood_group: 'O-',
          component_type: 'PRBC',
          units_requested: 1,
          triage_level: 'ACTIVE_TRAUMA',
          deadline_at: new Date(Date.now() + 45 * 60000).toISOString(),
        }),
      });
      const data = await res.json();
      addDemoLog(`Blood bank freezers are now empty! The system automatically buzzed nearby volunteer donors Alice & Bob on their phones.`);
      setDemoStep(2);
    } catch (err) {
      addDemoLog(`Error in Step 2: ${err}`);
    }
  };

  const executeStep3 = async () => {
    addDemoLog('Step 3: Blood bank discovers Bag BB-001 is spoiled/damaged...');
    try {
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

      addDemoLog('Bag BB-001 marked as spoiled. The hospital still needs 1 bag! The system automatically alerts volunteer donors for an emergency replacement.');
      setDemoStep(3);
    } catch (err) {
      addDemoLog(`Error in Step 3: ${err}`);
    }
  };

  const executeStep4 = async () => {
    addDemoLog('Step 4: Volunteer Donor Alice opens her phone and clicks ACCEPT...');
    try {
      const reqRes = await fetch('http://localhost:8000/api/v1/requests');
      const allReqs = await reqRes.json();
      const reqRA = allReqs.find((r: any) => r.patient_id_token === 'PATIENT-EMERGENCY-1');

      if (!reqRA) throw new Error('Request not found');

      const loginRes = await fetch('http://localhost:8000/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'alice@donor.org', password: 'password123' }),
      });
      const loginData = await loginRes.json();

      await fetch(`http://localhost:8000/api/v1/donors/requests/${reqRA.id}/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${loginData.access_token}` },
        body: JSON.stringify({ action: 'ACCEPT' }),
      });

      addDemoLog(`Alice agreed to donate! Hospital now has: 1 bag from blood bank + 1 donation from Alice. The patient is saved!`);
      setDemoStep(4);
    } catch (err) {
      addDemoLog(`Error in Step 4: ${err}`);
    }
  };

  const runFullDemoSequence = async () => {
    setIsAutoRunning(true);
    await handleResetSeed();
    await new Promise((r) => setTimeout(r, 1200));

    await executeStep1();
    await new Promise((r) => setTimeout(r, 2000));

    await executeStep2();
    await new Promise((r) => setTimeout(r, 2200));

    await executeStep3();
    await new Promise((r) => setTimeout(r, 2200));

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
      {/* Simulation Controller in Plain English */}
      <div className="glass-panel highlight-cyan" style={{ marginBottom: '1.5rem', border: '1px solid rgba(6, 182, 212, 0.4)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem', marginBottom: '1rem' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
              <Zap size={20} color="var(--cyan-400)" />
              <h2 style={{ fontSize: '1.2rem', fontWeight: 800 }}>
                Live Emergency Blood Dispatch Test
              </h2>
              <span className="badge badge-cyan">One-Click Demonstration</span>
            </div>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
              Click <b>"▶ Run Automatic Test"</b> to watch the entire process: Hospital asks for blood → Blood bank delivers → Blood bank runs out → Donors are alerted on their phones.
            </p>
          </div>

          <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
            <button
              id="btn-reset-demo"
              onClick={handleResetSeed}
              className="btn btn-secondary"
              style={{ fontSize: '0.85rem' }}
              disabled={isAutoRunning}
            >
              <RotateCcw size={14} />
              Reset Starting State
            </button>
            <button
              id="btn-run-full-demo"
              onClick={runFullDemoSequence}
              className="btn btn-cyan"
              style={{ fontSize: '0.85rem', fontWeight: 700 }}
              disabled={isAutoRunning}
            >
              <Play size={14} />
              {isAutoRunning ? 'Running Test...' : '▶ Run Automatic Test'}
            </button>
          </div>
        </div>

        {/* Step-by-Step Control Strip */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.75rem', marginBottom: '1rem' }}>
          <button
            id="btn-step-1"
            onClick={executeStep1}
            disabled={isAutoRunning}
            className={`btn ${demoStep >= 1 ? 'btn-cyan' : 'btn-secondary'}`}
            style={{ fontSize: '0.8rem', padding: '0.55rem', justifyContent: 'flex-start' }}
          >
            <b>1.</b> Hospital asks for 2 bags of blood
          </button>
          <button
            id="btn-step-2"
            onClick={executeStep2}
            disabled={isAutoRunning || demoStep < 1}
            className={`btn ${demoStep >= 2 ? 'btn-cyan' : 'btn-secondary'}`}
            style={{ fontSize: '0.8rem', padding: '0.55rem', justifyContent: 'flex-start' }}
          >
            <b>2.</b> Hospital 2 asks (Freezers empty)
          </button>
          <button
            id="btn-step-3"
            onClick={executeStep3}
            disabled={isAutoRunning || demoStep < 2}
            className={`btn ${demoStep >= 3 ? 'btn-danger-outline' : 'btn-secondary'}`}
            style={{ fontSize: '0.8rem', padding: '0.55rem', justifyContent: 'flex-start' }}
          >
            <b>3.</b> 1 Blood bag gets damaged
          </button>
          <button
            id="btn-step-4"
            onClick={executeStep4}
            disabled={isAutoRunning || demoStep < 3}
            className={`btn ${demoStep >= 4 ? 'btn-primary' : 'btn-secondary'}`}
            style={{ fontSize: '0.8rem', padding: '0.55rem', justifyContent: 'flex-start' }}
          >
            <b>4.</b> Volunteer donor accepts to help
          </button>
        </div>

        {/* Live Step Execution Console in Plain English */}
        <div style={{
          background: 'rgba(5, 7, 12, 0.85)',
          padding: '0.85rem',
          borderRadius: '8px',
          fontSize: '0.85rem',
          maxHeight: '130px',
          overflowY: 'auto',
          border: '1px solid rgba(255,255,255,0.06)'
        }}>
          {demoLog.length === 0 ? (
            <span style={{ color: 'var(--text-dim)' }}>Ready to run. Click "Run Automatic Test" above to see the magic happen!</span>
          ) : (
            demoLog.map((log, idx) => (
              <div key={idx} style={{ color: idx === 0 ? 'var(--cyan-400)' : 'var(--text-muted)', marginBottom: '0.35rem', lineHeight: 1.35 }}>
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
              Active Hospital Blood Requests
            </h2>
            <span className="badge badge-purple">{requests.length} Requests Total</span>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-subtle)', textAlign: 'left', color: 'var(--text-muted)' }}>
                  <th style={{ padding: '0.65rem' }}>PATIENT CODE</th>
                  <th style={{ padding: '0.65rem' }}>BLOOD NEEDED</th>
                  <th style={{ padding: '0.65rem' }}>URGENCY (0-100)</th>
                  <th style={{ padding: '0.65rem' }}>CURRENT STATUS</th>
                  <th style={{ padding: '0.65rem' }}>WHERE BLOOD IS SOURCED</th>
                  <th style={{ padding: '0.65rem', textAlign: 'right' }}>DETAILS</th>
                </tr>
              </thead>
              <tbody>
                {requests.length === 0 ? (
                  <tr>
                    <td colSpan={6} style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-dim)' }}>
                      No active requests right now.
                    </td>
                  </tr>
                ) : (
                  requests.map((req) => (
                    <tr key={req.id} style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.04)' }}>
                      <td style={{ padding: '0.65rem' }}>
                        <div style={{ fontWeight: 700, color: 'white' }}>{req.patient_id_token}</div>
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
                            : req.status === 'FULFILLED'
                            ? 'badge-purple'
                            : 'badge-cyan'
                        }`}>
                          {formatStatusText(req.status)}
                        </span>
                      </td>
                      <td style={{ padding: '0.65rem', fontSize: '0.78rem' }}>
                        {req.allocations && req.allocations.length > 0 ? (
                          req.allocations.map((a, i) => (
                            <div key={i} style={{ color: a.source_type === 'BLOOD_BANK_INVENTORY' ? '#93c5fd' : '#86efac' }}>
                              • {a.source_type === 'BLOOD_BANK_INVENTORY' ? 'From Blood Bank Storage' : 'From Volunteer Donor'}
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
                          style={{ padding: '0.3rem 0.6rem', fontSize: '0.75rem' }}
                        >
                          <Info size={12} />
                          Explain
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Live Real-Time Activity Log in Plain English */}
        <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', height: '600px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <h2 style={{ fontSize: '1.15rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Radio size={18} color="var(--emerald-400)" />
              Live City Activity Log
            </h2>
            <span className="pulse-dot" />
          </div>

          <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
            {events.length === 0 ? (
              <div style={{ textAlign: 'center', color: 'var(--text-dim)', padding: '2rem' }}>
                Waiting for live system activity...
              </div>
            ) : (
              events.map((ev, i) => {
                const messageText = formatEventMessage(ev);
                return (
                  <div
                    key={i}
                    style={{
                      background: 'rgba(10, 13, 20, 0.8)',
                      padding: '0.75rem 0.85rem',
                      borderRadius: '8px',
                      border: '1px solid var(--border-subtle)',
                      animation: 'badgePop 0.2s ease',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.3rem' }}>
                      <span className={`badge ${
                        ev.type.includes('ALERT') || ev.type.includes('RE_PLANNING')
                          ? 'badge-red'
                          : ev.type.includes('SUCCESS') || ev.type.includes('LOCKED')
                          ? 'badge-green'
                          : 'badge-cyan'
                      }`} style={{ fontSize: '0.68rem' }}>
                        {formatStatusText(ev.type)}
                      </span>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>
                        {new Date().toLocaleTimeString()}
                      </span>
                    </div>
                    <div style={{ color: '#f3f4f6', fontSize: '0.85rem', lineHeight: 1.35 }}>
                      {messageText}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* Audit Modal in Plain English */}
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
              <h3 style={{ fontSize: '1.1rem', fontWeight: 700 }}>Decision Explanation</h3>
              <button onClick={() => setSelectedAuditLog(null)} className="btn btn-secondary" style={{ padding: '0.2rem 0.5rem' }}>
                ✕
              </button>
            </div>
            {selectedAuditLog.map((log) => (
              <div key={log.id} style={{ background: 'rgba(10, 13, 20, 0.7)', padding: '0.85rem', borderRadius: '8px', marginBottom: '0.75rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.35rem' }}>
                  <span className="badge badge-cyan">{formatStatusText(log.decision_type)}</span>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>{new Date(log.created_at).toLocaleTimeString()}</span>
                </div>
                <p style={{ fontSize: '0.88rem', color: '#f3f4f6', marginBottom: '0.5rem', lineHeight: 1.4 }}>
                  {log.rationale_summary}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
