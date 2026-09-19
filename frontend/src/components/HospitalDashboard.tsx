import React, { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useWebSocket } from '../context/WebSocketContext';
import { api } from '../lib/api';
import { BloodRequest, BloodComponentType, TriageLevel, AllocationAuditLog } from '../types';
import { AlertCircle, Clock, CheckCircle2, RefreshCw, Send, Info, Truck, ShieldAlert, X, Droplet, Package } from 'lucide-react';

const COMPONENT_LABELS: Record<BloodComponentType, string> = {
  PRBC: 'Red Blood Cells',
  WHOLE_BLOOD: 'Whole Blood',
  PLATELETS: 'Platelets',
  FFP: 'Plasma',
  CRYOPRECIPITATE: 'Cryoprecipitate',
};

export const HospitalDashboard: React.FC = () => {
  const { user } = useAuth();
  const { lastEvent } = useWebSocket();

  const [requests, setRequests] = useState<BloodRequest[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form State
  const [patientIdToken, setPatientIdToken] = useState(() => `PT-${Math.floor(100000 + Math.random() * 900000)}`);
  const [bloodGroup, setBloodGroup] = useState('O-');
  const [componentType, setComponentType] = useState<BloodComponentType>('PRBC');
  const [units, setUnits] = useState(2);
  const [triageLevel, setTriageLevel] = useState<TriageLevel>('MASSIVE_TRANSFUSION_PROTOCOL');
  const [deadlineMinutes, setDeadlineMinutes] = useState(15);
  const [submitting, setSubmitting] = useState(false);

  // Proximity Alert State (PRD Section 4.1: Trauma Bay Push Notification within 500m)
  const [wardAlert, setWardAlert] = useState<{ message: string; timestamp: string } | null>(null);

  // Audit Explanation State
  const [selectedAuditLog, setSelectedAuditLog] = useState<AllocationAuditLog[] | null>(null);
  const [inspectingReqId, setInspectingReqId] = useState<string | null>(null);

  const generateNewToken = () => {
    setPatientIdToken(`PT-${Math.floor(100000 + Math.random() * 900000)}`);
  };

  const fetchRequests = useCallback(async () => {
    setLoading(true);
    try {
      setRequests(await api.get<BloodRequest[]>('/requests'));
      setError(null);
    } catch (err) {
      console.error('Failed to fetch requests:', err);
      setError(err instanceof Error ? err.message : 'Could not load your requests.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRequests();
    const interval = setInterval(() => {
      fetchRequests();
    }, 3000);
    return () => clearInterval(interval);
  }, [fetchRequests, user]);

  // Refresh on relevant WebSocket events & handle 500m trauma bay approach alert
  useEffect(() => {
    if (!lastEvent) return;

    if (lastEvent.type === 'DONOR_APPROACHING_WARD' || lastEvent.type === 'COURIER_APPROACHING_WARD' || lastEvent.type === 'BLOOD_BANK_DISPATCHED') {
      setWardAlert({
        message: lastEvent.message || 'Inbound blood bags / courier has entered transit or is approaching ward. Pre-warm blood thawers and prepare patient transfusion line!',
        timestamp: new Date().toLocaleTimeString(),
      });
    }

    if (
      [
        'REQUEST_CREATED',
        'REQUEST_UPDATED',
        'INVENTORY_LOCKED',
        'DONOR_CLAIM_SUCCESS',
        'BLOOD_BANK_ACCEPTED',
        'BLOOD_BANK_DISPATCHED',
        'DONOR_APPROACHING_WARD',
        'RE_PLANNING_TRIGGERED',
        'ALTERNATIVE_FOUND',
        'REQUEST_FULFILLED',
        'REQUEST_CANCELLED',
        'SYSTEM_RESET',
      ].includes(lastEvent.type)
    ) {
      fetchRequests();
    }
  }, [lastEvent, fetchRequests]);

  const handleCreateRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    const deadlineAt = new Date(Date.now() + deadlineMinutes * 60000).toISOString();
    const payload = {
      patient_id_token: patientIdToken.trim() || `PT-${Math.floor(100000 + Math.random() * 900000)}`,
      required_blood_group: bloodGroup,
      component_type: componentType,
      units_requested: Number(units),
      triage_level: triageLevel,
      deadline_at: deadlineAt,
    };

    try {
      // Hospital accounts always order for their own facility, so no hospital_id is sent.
      await api.post<BloodRequest>('/requests', payload);
      generateNewToken();
      await fetchRequests();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not submit the request.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleFulfill = async (id: string, allowPartial: boolean = false) => {
    try {
      await api.post(`/requests/${id}/fulfill${allowPartial ? '?allow_partial=true' : ''}`);
      await fetchRequests();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not confirm receipt.');
    }
  };

  const handleCancel = async (id: string) => {
    try {
      await api.patch(`/requests/${id}/cancel`);
      await fetchRequests();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not cancel the request.');
    }
  };

  const viewExplanation = async (id: string) => {
    setInspectingReqId(id);
    try {
      setSelectedAuditLog(await api.get<AllocationAuditLog[]>(`/audit/requests/${id}/explanation`));
    } catch (err) {
      console.error('Failed to load audit logs:', err);
      setSelectedAuditLog([]);
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
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem' }}>
              <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                Patient MRN / Case Identifier
              </label>
              <button
                type="button"
                onClick={generateNewToken}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--cyan-400)',
                  fontSize: '0.75rem',
                  cursor: 'pointer',
                  textDecoration: 'underline',
                  padding: 0,
                }}
              >
                Auto-generate
              </button>
            </div>
            <input
              id="intake-patient-token"
              type="text"
              required
              className="input-field"
              placeholder="e.g. PT-904812"
              value={patientIdToken}
              onChange={(e) => setPatientIdToken(e.target.value)}
            />
          </div>

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
                {(Object.keys(COMPONENT_LABELS) as BloodComponentType[]).map((ct) => (
                  <option key={ct} value={ct}>{COMPONENT_LABELS[ct]}</option>
                ))}
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
        {/* Proximity 500m Ward Approach Alert */}
        {wardAlert && (
          <div
            style={{
              background: 'linear-gradient(135deg, rgba(220, 38, 38, 0.2), rgba(153, 27, 27, 0.3))',
              border: '2px solid var(--crimson-500)',
              borderRadius: '10px',
              padding: '1rem 1.25rem',
              marginBottom: '1.25rem',
              display: 'flex',
              alignItems: 'flex-start',
              gap: '0.85rem',
              boxShadow: '0 0 20px rgba(239, 68, 68, 0.25)',
              animation: 'pulseGlow 2s infinite',
            }}
          >
            <ShieldAlert size={26} color="var(--crimson-500)" style={{ flexShrink: 0, marginTop: '2px' }} />
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontWeight: 800, color: 'var(--crimson-500)', fontSize: '0.95rem', letterSpacing: '0.03em' }}>
                  🚨 TRAUMA BAY PROXIMITY ALERT (WITHIN 500M)
                </span>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>{wardAlert.timestamp}</span>
              </div>
              <p style={{ fontSize: '0.85rem', color: 'var(--text-main)', marginTop: '0.35rem', lineHeight: 1.4 }}>
                {wardAlert.message}
              </p>
              <div style={{ fontSize: '0.78rem', color: 'var(--amber-400)', marginTop: '0.4rem', fontWeight: 600 }}>
                ⚡ Action Required: Pre-warm rapid blood thawers and notify trauma surgical team.
              </div>
            </div>
            <button
              onClick={() => setWardAlert(null)}
              aria-label="Acknowledge alert"
              style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '0.2rem' }}
            >
              <X size={18} />
            </button>
          </div>
        )}

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

        {error && (
          <div style={{
            background: 'rgba(239, 68, 68, 0.15)',
            border: '1px solid var(--crimson-500)',
            padding: '0.75rem 1rem',
            borderRadius: '8px',
            marginBottom: '1rem',
            fontSize: '0.85rem',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '0.75rem',
          }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <ShieldAlert size={16} color="var(--crimson-500)" />
              {error}
            </span>
            <button
              onClick={() => setError(null)}
              aria-label="Dismiss"
              style={{ background: 'transparent', border: 'none', color: 'inherit', cursor: 'pointer' }}
            >
              <X size={16} />
            </button>
          </div>
        )}

        {requests.length === 0 ? (
          <div className="glass-panel" style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
            No active emergency blood requests. Submit an intake form to initiate automated matching.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {requests.map((req) => {
              const urgency = req.calculated_urgency_score;
              const isUrgent = urgency >= 80;
              const covered = req.units_covered ?? 0;
              const shortfall = req.units_shortfall ?? Math.max(req.units_requested - covered, 0);
              const fullyCovered = shortfall === 0;
              const isClosed = req.status === 'FULFILLED' || req.status === 'CANCELLED';
              const inTransitCount = (req.allocations || []).filter(a => a.status === 'IN_TRANSIT').length;
              const lockedCount = (req.allocations || []).filter(a => a.status === 'HARD_LOCKED').length;

              let statusBadgeClass = 'badge-cyan';
              let statusBadgeText: string = req.status;
              if (req.status === 'FULFILLED') {
                statusBadgeClass = 'badge-purple';
                statusBadgeText = 'Delivered & Transfused';
              } else if (req.status === 'COMMITTED_IN_TRANSIT') {
                statusBadgeClass = 'badge-green';
                statusBadgeText = 'All Units En Route';
              } else if (inTransitCount > 0) {
                statusBadgeClass = 'badge-green';
                statusBadgeText = `🚑 ${inTransitCount}/${req.units_requested} Bags In-Transit`;
              } else if (lockedCount > 0) {
                statusBadgeClass = 'badge-cyan';
                statusBadgeText = `📦 ${lockedCount}/${req.units_requested} Bags Reserved in Storage`;
              } else if (req.status === 'RE_PLANNING') {
                statusBadgeClass = 'badge-red';
                statusBadgeText = 'Finding Replacement';
              } else if (req.status === 'PROXIMITY_ZONE_NOTIFIED') {
                statusBadgeClass = 'badge-amber';
                statusBadgeText = 'Asking Donors';
              }

              return (
                <div
                  key={req.id}
                  id={`request-card-${req.id}`}
                  className={`glass-panel ${req.status === 'RE_PLANNING' ? 'highlight-red' : ''}`}
                  style={{
                    borderLeft: `4px solid ${
                      req.status === 'COMMITTED_IN_TRANSIT' || inTransitCount > 0
                        ? 'var(--emerald-500)'
                        : req.status === 'RE_PLANNING'
                        ? 'var(--crimson-500)'
                        : lockedCount > 0
                        ? 'var(--cyan-500)'
                        : 'var(--amber-500)'
                    }`,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '0.5rem' }}>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.35rem', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '1.2rem', fontWeight: 800, color: 'var(--text-main)' }}>
                          {req.units_requested}x {req.required_blood_group} ({COMPONENT_LABELS[req.component_type] ?? req.component_type})
                        </span>
                        <span className={`badge ${statusBadgeClass}`}>
                          {statusBadgeText}
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
                        {urgency.toFixed(0)} <span style={{ fontSize: '0.8rem', color: 'var(--text-dim)' }}>/ 100</span>
                      </div>
                    </div>
                  </div>

                  {/* Coverage — bags secured out of bags asked for. */}
                  <div style={{ marginTop: '0.9rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', marginBottom: '0.3rem' }}>
                      <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>
                        Bags secured: {covered} of {req.units_requested}
                      </span>
                      {!fullyCovered && !isClosed && (
                        <span style={{ color: 'var(--amber-500)', fontWeight: 700 }}>
                          Still need {shortfall}
                        </span>
                      )}
                    </div>
                    <div style={{ height: '6px', background: 'var(--color-bg)', borderRadius: '3px', overflow: 'hidden' }}>
                      <div style={{
                        height: '100%',
                        width: `${Math.min(100, (covered / Math.max(req.units_requested, 1)) * 100)}%`,
                        background: fullyCovered ? 'var(--emerald-500)' : 'var(--amber-500)',
                        transition: 'width 0.3s ease',
                      }} />
                    </div>
                  </div>

                  {/* Allocations Breakdown */}
                  {req.allocations && req.allocations.length > 0 && (
                    <div style={{ marginTop: '1rem', paddingTop: '0.75rem', borderTop: '1px solid var(--border-subtle)' }}>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)', fontWeight: 700, marginBottom: '0.5rem', textTransform: 'uppercase' }}>
                        Where This Blood Is Coming From:
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.6rem' }}>
                        {req.allocations.map((alloc) => {
                          const isInventory = alloc.source_type === 'BLOOD_BANK_INVENTORY';
                          const batchDisplay = alloc.batch_number || (alloc.inventory_unit_id ? `Bag-${alloc.inventory_unit_id.slice(0, 6)}` : null);
                          const bloodGroupDisplay = alloc.blood_group || req.required_blood_group;

                          let badgeText = 'Confirmed';
                          let badgeClass = 'badge-green';
                          if (alloc.status === 'IN_TRANSIT') {
                            badgeText = `In Transit (~${alloc.estimated_transit_minutes ?? 5} min)`;
                            badgeClass = 'badge-green';
                          } else if (alloc.status === 'HARD_LOCKED') {
                            badgeText = isInventory ? 'Packed in Cold Storage' : 'Donor Confirmed';
                            badgeClass = 'badge-cyan';
                          } else if (alloc.status === 'COMPLETED') {
                            badgeText = 'Received & Transfused';
                            badgeClass = 'badge-purple';
                          }

                          return (
                            <div
                              key={alloc.id}
                              style={{
                                background: 'var(--color-bg)',
                                padding: '0.55rem 0.85rem',
                                borderRadius: '8px',
                                border: alloc.status === 'IN_TRANSIT' ? '1px solid var(--emerald-500)' : '1px solid var(--border-subtle)',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '0.5rem',
                                fontSize: '0.8rem',
                              }}
                            >
                              {isInventory ? (
                                alloc.status === 'IN_TRANSIT' ? <Truck size={14} color="var(--emerald-400)" /> : <Package size={14} color="var(--cyan-400)" />
                              ) : (
                                <Droplet size={14} color="var(--crimson-400)" />
                              )}
                              <span>
                                <b>
                                  {isInventory ? (
                                    `📦 Blood Bank ${batchDisplay ? `(${batchDisplay})` : 'Storage'} [${bloodGroupDisplay}]`
                                  ) : (
                                    `🙋 Volunteer Donor [${bloodGroupDisplay}]`
                                  )}
                                </b>
                                {alloc.distance_km != null && ` (~${alloc.distance_km}km away)`}
                              </span>
                              <span className={`badge ${badgeClass}`} style={{ fontSize: '0.65rem' }}>
                                {badgeText}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Actions */}
                  <div style={{ marginTop: '1rem', display: 'flex', justifyContent: 'flex-end', gap: '0.6rem', flexWrap: 'wrap' }}>
                    <button
                      id={`btn-explain-${req.id}`}
                      onClick={() => viewExplanation(req.id)}
                      className="btn btn-secondary"
                      style={{ fontSize: '0.8rem', padding: '0.35rem 0.75rem' }}
                    >
                      <Info size={14} />
                      Why this choice?
                    </button>
                    {!isClosed && (
                      <button
                        id={`btn-cancel-${req.id}`}
                        onClick={() => handleCancel(req.id)}
                        className="btn btn-secondary"
                        style={{ fontSize: '0.8rem', padding: '0.35rem 0.75rem' }}
                      >
                        Cancel Request
                      </button>
                    )}
                    {!isClosed && (inTransitCount > 0 || covered > 0) && (
                      <button
                        id={`btn-fulfill-${req.id}`}
                        onClick={() => handleFulfill(req.id, !fullyCovered)}
                        className="btn btn-cyan"
                        style={{ fontSize: '0.8rem', padding: '0.35rem 0.75rem' }}
                      >
                        <CheckCircle2 size={14} />
                        {fullyCovered ? 'Confirm Blood Received' : `Confirm Receipt & Transfuse (${covered} Available)`}
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
            style={{ maxWidth: '650px', width: '100%', maxHeight: '85vh', overflowY: 'auto' }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '0.75rem' }}>
              <h3 style={{ fontSize: '1.15rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Info size={18} color="var(--cyan-400)" />
                Algorithmic Decision Justification
              </h3>
              <button onClick={() => setSelectedAuditLog(null)} className="btn btn-secondary" style={{ padding: '0.2rem 0.5rem' }}>
                ✕
              </button>
            </div>

            {inspectingReqId && (
              <p style={{ fontSize: '0.75rem', color: 'var(--text-dim)', marginBottom: '0.75rem', fontFamily: 'var(--font-mono)' }}>
                Request {inspectingReqId}
              </p>
            )}

            {selectedAuditLog.length === 0 ? (
              <p style={{ color: 'var(--text-muted)' }}>No audit trail entries recorded yet.</p>
            ) : (
              selectedAuditLog.map((log) => (
                <div key={log.id} style={{ marginBottom: '1.25rem', background: 'var(--color-bg)', padding: '1rem', borderRadius: '8px', border: '1px solid var(--border-subtle)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                    <span className="badge badge-cyan">{log.decision_type}</span>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>{new Date(log.created_at).toLocaleTimeString()}</span>
                  </div>
                  <p style={{ fontSize: '0.9rem', color: 'var(--color-text-main)', marginBottom: '0.75rem', lineHeight: 1.4 }}>
                    {log.rationale_summary}
                  </p>
                  <div style={{ background: 'var(--color-bg)', padding: '0.5rem', borderRadius: '6px', fontSize: '0.75rem', fontFamily: 'var(--font-mono)' }}>
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
