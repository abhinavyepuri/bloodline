import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useWebSocket } from '../context/WebSocketContext';
import { BloodRequest, BloodComponentType, TriageLevel, AllocationAuditLog } from '../types';
import { AlertCircle, Clock, CheckCircle2, RefreshCw, Send, Info, Truck, ShieldAlert } from 'lucide-react';

export const HospitalDashboard: React.FC = () => {
  const { token } = useAuth();
  const { lastEvent } = useWebSocket();

  const [requests, setRequests] = useState<BloodRequest[]>([]);
  const [loading, setLoading] = useState(false);

  // Form State
  const [bloodGroup, setBloodGroup] = useState('O-');
  const [componentType, setComponentType] = useState<BloodComponentType>('PRBC');
  const [units, setUnits] = useState(2);
  const [triageLevel, setTriageLevel] = useState<TriageLevel>('MASSIVE_TRANSFUSION_PROTOCOL');
  const [deadlineMinutes, setDeadlineMinutes] = useState(15);
  const [submitting, setSubmitting] = useState(false);

  // Audit Explanation State
  const [selectedAuditLog, setSelectedAuditLog] = useState<AllocationAuditLog[] | null>(null);
  const [inspectingReqId, setInspectingReqId] = useState<string | null>(null);

  const fetchRequests = async () => {
    setLoading(true);
    try {
      const res = await fetch('http://localhost:8000/api/v1/requests', {
        headers: { Authorization: `Bearer ${token}` },
      });
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
  }, [token]);

  // Refresh on relevant WebSocket events
  useEffect(() => {
    if (
      lastEvent &&
      [
        'REQUEST_CREATED',
        'INVENTORY_LOCKED',
        'DONOR_CLAIM_SUCCESS',
        'RE_PLANNING_TRIGGERED',
        'ALTERNATIVE_FOUND',
        'REQUEST_FULFILLED',
        'REQUEST_CANCELLED',
        'SYSTEM_RESET',
      ].includes(lastEvent.type)
    ) {
      fetchRequests();
    }
  }, [lastEvent]);

  const handleCreateRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);

    const deadlineAt = new Date(Date.now() + deadlineMinutes * 60000).toISOString();
    const payload = {
      patient_id_token: `PT-${Math.floor(100000 + Math.random() * 900000)}`,
      required_blood_group: bloodGroup,
      component_type: componentType,
      units_requested: Number(units),
      triage_level: triageLevel,
      deadline_at: deadlineAt,
    };

    try {
      const res = await fetch('http://localhost:8000/api/v1/requests', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error('Submission failed');
      await fetchRequests();
    } catch (err) {
      alert('Error creating emergency request: ' + err);
    } finally {
      setSubmitting(false);
    }
  };

  const handleFulfill = async (id: string) => {
    try {
      await fetch(`http://localhost:8000/api/v1/requests/${id}/fulfill`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      fetchRequests();
    } catch (err) {
      console.error('Error fulfilling request:', err);
    }
  };

  const viewExplanation = async (id: string) => {
    setInspectingReqId(id);
    try {
      const res = await fetch(`http://localhost:8000/api/v1/audit/requests/${id}/explanation`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setSelectedAuditLog(data);
      } else {
        setSelectedAuditLog([]);
      }
    } catch (err) {
      console.error('Failed to load audit logs:', err);
    }
  };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(320px, 420px) 1fr', gap: '1.5rem' }}>
      {/* Intake Form */}
      <div className="glass-panel highlight-red" style={{ height: 'fit-content' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '1.25rem' }}>
          <AlertCircle size={22} color="var(--crimson-500)" />
          <h2 style={{ fontSize: '1.15rem', fontWeight: 700 }}>Order Emergency Blood</h2>
        </div>

        <form onSubmit={handleCreateRequest} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div>
            <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.35rem', display: 'block' }}>
              Blood Group Needed
            </label>
            <select
              id="intake-blood-group"
              className="select-field"
              value={bloodGroup}
              onChange={(e) => setBloodGroup(e.target.value)}
            >
              {['O-', 'O+', 'A-', 'A+', 'B-', 'B+', 'AB-', 'AB+'].map((bg) => (
                <option key={bg} value={bg}>{bg}</option>
              ))}
            </select>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
            <div>
              <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.35rem', display: 'block' }}>
                Blood Product
              </label>
              <select
                id="intake-component"
                className="select-field"
                value={componentType}
                onChange={(e) => setComponentType(e.target.value as BloodComponentType)}
              >
                <option value="PRBC">Red Blood Cells</option>
                <option value="WHOLE_BLOOD">Whole Blood</option>
                <option value="PLATELETS">Platelets</option>
                <option value="FFP">Plasma</option>
              </select>
            </div>
            <div>
              <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.35rem', display: 'block' }}>
                Number of Bags
              </label>
              <input
                id="intake-units"
                type="number"
                min="1"
                max="10"
                className="input-field"
                value={units}
                onChange={(e) => setUnits(Number(e.target.value))}
              />
            </div>
          </div>

          <div>
            <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.35rem', display: 'block' }}>
              How Urgent Is This?
            </label>
            <select
              id="intake-triage"
              className="select-field"
              value={triageLevel}
              onChange={(e) => setTriageLevel(e.target.value as TriageLevel)}
            >
              <option value="MASSIVE_TRANSFUSION_PROTOCOL">🔴 Life-Threatening Emergency (Needed in &lt;15 mins)</option>
              <option value="ACTIVE_TRAUMA">🟠 Severe Injury / Accident (Needed in &lt;1 hour)</option>
              <option value="SCHEDULED_EMERGENCY_RESERVE">🟡 Urgent Surgery (Needed in &lt;4 hours)</option>
              <option value="ROUTINE_CLINICAL">🟢 Standard Delivery (Needed in &lt;24 hours)</option>
            </select>
          </div>

          <div>
            <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.35rem', display: 'block' }}>
              Needed Within (Minutes)
            </label>
            <input
              id="intake-deadline"
              type="number"
              min="5"
              max="1440"
              className="input-field"
              value={deadlineMinutes}
              onChange={(e) => setDeadlineMinutes(Number(e.target.value))}
            />
          </div>

          <button
            id="btn-submit-request"
            type="submit"
            className="btn btn-primary"
            disabled={submitting}
            style={{ marginTop: '0.5rem', width: '100%' }}
          >
            <Send size={16} />
            {submitting ? 'Sending Request...' : 'Send Emergency Request to Blood Bank'}
          </button>
        </form>
      </div>

      {/* Live Active Requests Feed */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
          <h2 style={{ fontSize: '1.25rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <Clock size={20} color="var(--cyan-400)" />
            Hospital Live Request Queue
          </h2>
          <button onClick={fetchRequests} className="btn btn-secondary" style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem' }}>
            <RefreshCw size={14} className={loading ? 'spin' : ''} />
            Refresh
          </button>
        </div>

        {requests.length === 0 ? (
          <div className="glass-panel" style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
            No active emergency blood requests. Submit an intake form to initiate automated matching.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {requests.map((req) => {
              const urgency = req.calculated_urgency_score;
              const isUrgent = urgency >= 80;

              return (
                <div
                  key={req.id}
                  id={`request-card-${req.id}`}
                  className={`glass-panel ${req.status === 'RE_PLANNING' ? 'highlight-red' : ''}`}
                  style={{
                    borderLeft: `4px solid ${
                      req.status === 'COMMITTED_IN_TRANSIT'
                        ? 'var(--emerald-500)'
                        : req.status === 'RE_PLANNING'
                        ? 'var(--crimson-500)'
                        : req.status === 'PROXIMITY_ZONE_NOTIFIED'
                        ? 'var(--amber-500)'
                        : 'var(--cyan-500)'
                    }`,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '0.5rem' }}>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.35rem' }}>
                        <span style={{ fontSize: '1.2rem', fontWeight: 800, color: 'white' }}>
                          {req.units_requested}x {req.required_blood_group} ({req.component_type === 'PRBC' ? 'Red Blood Cells' : req.component_type})
                        </span>
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
                          {req.status === 'COMMITTED_IN_TRANSIT'
                            ? 'On The Way'
                            : req.status === 'RE_PLANNING'
                            ? 'Finding Replacement'
                            : req.status === 'PROXIMITY_ZONE_NOTIFIED'
                            ? 'Asking Donors'
                            : req.status === 'FULFILLED'
                            ? 'Delivered'
                            : req.status}
                        </span>
                      </div>
                      <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                        Patient: <code>{req.patient_id_token}</code>
                      </div>
                    </div>

                    {/* Urgency Meter */}
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)', fontWeight: 600 }}>URGENCY LEVEL</div>
                      <div style={{ fontSize: '1.4rem', fontWeight: 800, color: isUrgent ? 'var(--crimson-500)' : 'var(--cyan-400)' }}>
                        {req.calculated_urgency_score.toFixed(0)} <span style={{ fontSize: '0.8rem', color: 'var(--text-dim)' }}>/ 100</span>
                      </div>
                    </div>
                  </div>

                  {/* Allocations Breakdown */}
                  {req.allocations && req.allocations.length > 0 && (
                    <div style={{ marginTop: '1rem', paddingTop: '0.75rem', borderTop: '1px solid var(--border-subtle)' }}>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)', fontWeight: 700, marginBottom: '0.5rem', textTransform: 'uppercase' }}>
                        Where This Blood Is Coming From:
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.6rem' }}>
                        {req.allocations.map((alloc) => (
                          <div
                            key={alloc.id}
                            style={{
                              background: 'rgba(10, 13, 20, 0.6)',
                              padding: '0.5rem 0.8rem',
                              borderRadius: '8px',
                              border: '1px solid var(--border-subtle)',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '0.5rem',
                              fontSize: '0.8rem',
                            }}
                          >
                            <Truck size={14} color="var(--emerald-400)" />
                            <span>
                              <b>{alloc.source_type === 'BLOOD_BANK_INVENTORY' ? '📦 From Blood Bank Storage' : '🙋 From Volunteer Donor'}</b>
                              {alloc.distance_km && ` (~${alloc.distance_km}km away, ETA ~${alloc.estimated_transit_minutes} min)`}
                            </span>
                            <span className="badge badge-green" style={{ fontSize: '0.65rem' }}>Confirmed</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Actions */}
                  <div style={{ marginTop: '1rem', display: 'flex', justifyContent: 'flex-end', gap: '0.6rem' }}>
                    <button
                      id={`btn-explain-${req.id}`}
                      onClick={() => viewExplanation(req.id)}
                      className="btn btn-secondary"
                      style={{ fontSize: '0.8rem', padding: '0.35rem 0.75rem' }}
                    >
                      <Info size={14} />
                      Why this choice?
                    </button>
                    {req.status === 'COMMITTED_IN_TRANSIT' && (
                      <button
                        id={`btn-fulfill-${req.id}`}
                        onClick={() => handleFulfill(req.id)}
                        className="btn btn-cyan"
                        style={{ fontSize: '0.8rem', padding: '0.35rem 0.75rem' }}
                      >
                        <CheckCircle2 size={14} />
                        Confirm Blood Received
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Explainability Modal */}
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
          <div className="glass-panel" style={{ maxWidth: '650px', width: '100%', maxHeight: '85vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '0.75rem' }}>
              <h3 style={{ fontSize: '1.15rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Info size={18} color="var(--cyan-400)" />
                Algorithmic Decision Justification
              </h3>
              <button onClick={() => setSelectedAuditLog(null)} className="btn btn-secondary" style={{ padding: '0.2rem 0.5rem' }}>
                ✕
              </button>
            </div>

            {selectedAuditLog.length === 0 ? (
              <p style={{ color: 'var(--text-muted)' }}>No audit trail entries recorded yet.</p>
            ) : (
              selectedAuditLog.map((log) => (
                <div key={log.id} style={{ marginBottom: '1.25rem', background: 'rgba(10, 13, 20, 0.7)', padding: '1rem', borderRadius: '8px', border: '1px solid var(--border-subtle)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                    <span className="badge badge-cyan">{log.decision_type}</span>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>{new Date(log.created_at).toLocaleTimeString()}</span>
                  </div>
                  <p style={{ fontSize: '0.9rem', color: '#e5e7eb', marginBottom: '0.75rem', lineHeight: 1.4 }}>
                    {log.rationale_summary}
                  </p>
                  <div style={{ background: 'rgba(0,0,0,0.4)', padding: '0.5rem', borderRadius: '6px', fontSize: '0.75rem', fontFamily: 'var(--font-mono)' }}>
                    <div style={{ color: 'var(--text-dim)', marginBottom: '0.25rem' }}>Candidate Evaluation Scores:</div>
                    <pre style={{ margin: 0, color: 'var(--cyan-400)', whiteSpace: 'pre-wrap' }}>
                      {JSON.stringify(log.candidate_scores_json, null, 2)}
                    </pre>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};
