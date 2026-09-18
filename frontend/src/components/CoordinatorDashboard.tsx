import React, { useCallback, useEffect, useState } from 'react';
import { useWebSocket } from '../context/WebSocketContext';
import { api, loginRequest } from '../lib/api';
import { BloodRequest, HospitalDirectoryEntry, AllocationAuditLog, InventoryUnit } from '../types';
import { Radio, Play, RotateCcw, Activity, Zap, Info, X } from 'lucide-react';

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

/** Plain-English summary of how much of a request is actually covered. */
const describeCoverage = (req: BloodRequest): string => {
  const covered = req.units_covered ?? 0;
  if (covered >= req.units_requested) return `all ${req.units_requested} bag(s) covered`;
  if (covered === 0) return `no bags covered yet (needs ${req.units_requested})`;
  return `${covered} of ${req.units_requested} bag(s) covered, ${req.units_shortfall} still needed`;
};

export const CoordinatorDashboard: React.FC = () => {
  const { events, lastEvent } = useWebSocket();

  const [requests, setRequests] = useState<BloodRequest[]>([]);
  const [hospitals, setHospitals] = useState<HospitalDirectoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [demoStep, setDemoStep] = useState<number>(0);
  const [demoLog, setDemoLog] = useState<string[]>([]);
  const [isAutoRunning, setIsAutoRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Selected audit inspection
  const [selectedAuditLog, setSelectedAuditLog] = useState<AllocationAuditLog[] | null>(null);

  const fetchRequests = useCallback(async () => {
    setLoading(true);
    try {
      setRequests(await api.get<BloodRequest[]>('/requests'));
    } catch (err) {
      console.error('Failed to fetch requests:', err);
      setError(err instanceof Error ? err.message : 'Could not load requests.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRequests();
    // Coordinators raise demo requests on behalf of a named facility, so the
    // directory has to be loaded before Step 1 can run.
    api
      .get<HospitalDirectoryEntry[]>('/hospitals')
      .then(setHospitals)
      .catch((err) => console.error('Failed to load hospital directory:', err));
  }, [fetchRequests]);

  useEffect(() => {
    if (lastEvent) {
      fetchRequests();
    }
  }, [lastEvent, fetchRequests]);

  const addDemoLog = (msg: string) => {
    setDemoLog((prev) => [`[${new Date().toLocaleTimeString()}] ${msg}`, ...prev.slice(0, 20)]);
  };

  const handleResetSeed = async () => {
    try {
      await api.post('/admin/reset-seed');
      setDemoStep(0);
      addDemoLog('System reset: All requests cleared, blood bank restocked with fresh blood bags.');
      await fetchRequests();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Reset failed.';
      addDemoLog(`Could not reset: ${message}`);
      setError(message);
    }
  };

  /**
   * Raise a request as a coordinator.
   *
   * Coordinators have no hospital profile of their own, so the server requires an
   * explicit `hospital_id`; we use the first facility in the directory.
   */
  const createDemoRequest = async (payload: Record<string, unknown>): Promise<BloodRequest> => {
    if (hospitals.length === 0) {
      throw new Error('No hospitals are registered yet, so the demo cannot raise a request.');
    }
    return api.post<BloodRequest>('/requests', { ...payload, hospital_id: hospitals[0].id });
  };

  // Demo Flow Steps in plain English
  const executeStep1 = async () => {
    addDemoLog('Step 1: Hospital asks for 2 bags of O- blood for an urgent surgery...');
    try {
      const created = await createDemoRequest({
        patient_id_token: 'PATIENT-EMERGENCY-1',
        required_blood_group: 'O-',
        component_type: 'PRBC',
        units_requested: 2,
        triage_level: 'MASSIVE_TRANSFUSION_PROTOCOL',
        deadline_at: new Date(Date.now() + 15 * 60000).toISOString(),
      });
      // Report what actually happened rather than assuming the pipeline succeeded.
      addDemoLog(`Blood bank response: ${describeCoverage(created)}.`);
      setDemoStep(1);
      await fetchRequests();
    } catch (err) {
      addDemoLog(`Error in Step 1: ${err instanceof Error ? err.message : err}`);
    }
  };

  const executeStep2 = async () => {
    addDemoLog('Step 2: Another patient arrives needing 1 bag of O- blood...');
    try {
      const created = await createDemoRequest({
        patient_id_token: 'PATIENT-EMERGENCY-2',
        required_blood_group: 'O-',
        component_type: 'PRBC',
        units_requested: 1,
        triage_level: 'ACTIVE_TRAUMA',
        deadline_at: new Date(Date.now() + 45 * 60000).toISOString(),
      });
      if ((created.units_covered ?? 0) === 0) {
        addDemoLog(
          'Blood bank freezers are empty. The system buzzed nearby volunteer donors on their phones.'
        );
      } else {
        addDemoLog(`Blood bank covered this one from storage: ${describeCoverage(created)}.`);
      }
      setDemoStep(2);
      await fetchRequests();
    } catch (err) {
      addDemoLog(`Error in Step 2: ${err instanceof Error ? err.message : err}`);
    }
  };

  const executeStep3 = async () => {
    addDemoLog('Step 3: Blood bank discovers Bag BB-001 is spoiled/damaged...');
    try {
      const inventory = await api.get<InventoryUnit[]>('/inventory');
      const bb001 = inventory.find((u) => u.batch_number === 'BB-001');
      if (!bb001) throw new Error('BB-001 unit not found in stock');

      await api.patch(`/inventory/units/${bb001.id}/status`, { status: 'QUARANTINED' });

      addDemoLog(
        'Bag BB-001 marked as spoiled. The system automatically alerts volunteer donors for an emergency replacement.'
      );
      setDemoStep(3);
      await fetchRequests();
    } catch (err) {
      addDemoLog(`Error in Step 3: ${err instanceof Error ? err.message : err}`);
    }
  };

  const executeStep4 = async () => {
    addDemoLog('Step 4: Volunteer Donor Alice opens her phone and clicks ACCEPT...');
    try {
      const allReqs = await api.get<BloodRequest[]>('/requests');
      const reqRA = allReqs.find((r) => r.patient_id_token === 'PATIENT-EMERGENCY-1');
      if (!reqRA) throw new Error('Request PATIENT-EMERGENCY-1 not found');

      // Sign in as the donor purely to obtain a donor token; the coordinator's own
      // session is left untouched because we pass this token per-request.
      const donorLogin = await loginRequest<{ access_token: string }>('/auth/login', {
        email: 'alice@donor.org',
        password: 'password123',
      });

      await api.post(
        `/donors/requests/${reqRA.id}/respond`,
        { action: 'ACCEPT' },
        { token: donorLogin.access_token }
      );

      const refreshed = await api.get<BloodRequest[]>('/requests');
      const updated = refreshed.find((r) => r.id === reqRA.id);
      addDemoLog(
        updated
          ? `Alice agreed to donate! Request now has ${describeCoverage(updated)}.`
          : 'Alice agreed to donate!'
      );
      setDemoStep(4);
      await fetchRequests();
    } catch (err) {
      addDemoLog(`Error in Step 4: ${err instanceof Error ? err.message : err}`);
    }
  };

  const runFullDemoSequence = async () => {
    setIsAutoRunning(true);
    setError(null);
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
      setSelectedAuditLog(await api.get<AllocationAuditLog[]>(`/audit/requests/${id}/explanation`));
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : 'Could not load the explanation.');
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
          background: 'var(--color-bg)',
          padding: '0.85rem',
          borderRadius: '8px',
          fontSize: '0.85rem',
          maxHeight: '130px',
          overflowY: 'auto',
          border: '1px solid var(--color-border)'
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

      {error && (
        <div style={{
          background: 'rgba(239, 68, 68, 0.15)',
          border: '1px solid var(--crimson-500)',
          padding: '0.75rem 1rem',
          borderRadius: '8px',
          marginBottom: '1.5rem',
          fontSize: '0.85rem',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '0.75rem',
        }}>
          <span>{error}</span>
          <button
            onClick={() => setError(null)}
            aria-label="Dismiss"
            style={{ background: 'transparent', border: 'none', color: 'inherit', cursor: 'pointer' }}
          >
            <X size={16} />
          </button>
        </div>
      )}

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
                  <th style={{ padding: '0.65rem' }}>BAGS COVERED</th>
                  <th style={{ padding: '0.65rem' }}>URGENCY (0-100)</th>
                  <th style={{ padding: '0.65rem' }}>CURRENT STATUS</th>
                  <th style={{ padding: '0.65rem' }}>WHERE BLOOD IS SOURCED</th>
                  <th style={{ padding: '0.65rem', textAlign: 'right' }}>DETAILS</th>
                </tr>
              </thead>
              <tbody>
                {requests.length === 0 ? (
                  <tr>
                    <td colSpan={7} style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-dim)' }}>
                      No active requests right now.
                    </td>
                  </tr>
                ) : (
                  requests.map((req) => {
                    const covered = req.units_covered ?? 0;
                    const complete = covered >= req.units_requested;
                    return (
                      <tr key={req.id} style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.04)' }}>
                        <td style={{ padding: '0.65rem' }}>
                          <div style={{ fontWeight: 700, color: 'white' }}>{req.patient_id_token}</div>
                          <div style={{ fontSize: '0.72rem', color: 'var(--text-dim)' }}>
                            {req.hospital_name ?? 'Unknown hospital'}
                          </div>
                        </td>
                        <td style={{ padding: '0.65rem' }}>
                          <span style={{ fontWeight: 700, color: 'var(--crimson-500)' }}>
                            {req.units_requested}x {req.required_blood_group}
                          </span>
                        </td>
                        <td style={{ padding: '0.65rem', fontWeight: 700, color: complete ? 'var(--emerald-400)' : 'var(--amber-500)' }}>
                          {covered} / {req.units_requested}
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
                              <div key={i} style={{ color: a.source_type === 'BLOOD_BANK_INVENTORY' ? 'var(--color-info)' : 'var(--color-success)' }}>
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
                    );
                  })
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
                      background: 'var(--color-bg)',
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
                    <div style={{ color: 'var(--color-text-main)', fontSize: '0.85rem', lineHeight: 1.35 }}>
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
        <div
          onClick={() => setSelectedAuditLog(null)}
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0, 0, 0, 0.5)',
            backdropFilter: 'blur(8px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100,
            padding: '1rem',
          }}
        >
          <div
            className="glass-panel"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: '600px', width: '100%', maxHeight: '80vh', overflowY: 'auto' }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h3 style={{ fontSize: '1.1rem', fontWeight: 700 }}>Decision Explanation</h3>
              <button onClick={() => setSelectedAuditLog(null)} className="btn btn-secondary" style={{ padding: '0.2rem 0.5rem' }}>
                ✕
              </button>
            </div>
            {selectedAuditLog.length === 0 ? (
              <p style={{ color: 'var(--text-muted)' }}>No audit trail entries recorded yet.</p>
            ) : (
              selectedAuditLog.map((log) => (
                <div key={log.id} style={{ background: 'var(--color-bg)', padding: '0.85rem', borderRadius: '8px', marginBottom: '0.75rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.35rem' }}>
                    <span className="badge badge-cyan">{formatStatusText(log.decision_type)}</span>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>{new Date(log.created_at).toLocaleTimeString()}</span>
                  </div>
                  <p style={{ fontSize: '0.88rem', color: 'var(--color-text-main)', marginBottom: '0.5rem', lineHeight: 1.4 }}>
                    {log.rationale_summary}
                  </p>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};
