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

const TRIAGE_DEFAULT_HOURS: Record<TriageLevel, number> = {
  MASSIVE_TRANSFUSION_PROTOCOL: 1, // Critical: 1-2 hours
  ACTIVE_TRAUMA: 5,                // High: 5-6 hours
  SCHEDULED_EMERGENCY_RESERVE: 10, // Medium: 10-12 hours
  ROUTINE_CLINICAL: 24,            // Standard: 18-24 hours
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
  const [deadlineHours, setDeadlineHours] = useState<number>(1);
  const [submitting, setSubmitting] = useState(false);

  const handleTriageChange = (newTriage: TriageLevel) => {
    setTriageLevel(newTriage);
    setDeadlineHours(TRIAGE_DEFAULT_HOURS[newTriage] ?? 1);
  };

  // Pagination
  const PAGE_SIZE = 5;
  const [reqsPage, setReqsPage] = useState(1);

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
    const interval = setInterval(fetchRequests, 4000);
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

    const deadlineAt = new Date(Date.now() + Number(deadlineHours) * 3600 * 1000).toISOString();
    const payload = {
      patient_id_token: patientIdToken.trim() || `PT-${Math.floor(100000 + Math.random() * 900000)}`,
      required_blood_group: bloodGroup,
      component_type: componentType,
      units_requested: Number(units),
      triage_level: triageLevel,
      deadline_at: deadlineAt,
      fulfillment_mode: 'AUTO',
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
              onChange={(e) => handleTriageChange(e.target.value as TriageLevel)}
            >
              <option value="MASSIVE_TRANSFUSION_PROTOCOL">🔴 Critical (1-2 hrs)</option>
              <option value="ACTIVE_TRAUMA">🟠 High (5-6 hrs)</option>
              <option value="SCHEDULED_EMERGENCY_RESERVE">🟡 Medium (10-12 hrs)</option>
              <option value="ROUTINE_CLINICAL">🟢 Standard (18-24 hrs)</option>
            </select>
          </div>

          <div>
            <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.35rem', display: 'block' }}>
              Needed Within (Hours)
            </label>
            <input
              id="intake-deadline"
              type="number"
              min="1"
              max="72"
              step="1"
              className="input-field"
              value={deadlineHours}
              onChange={(e) => setDeadlineHours(Math.max(1, Number(e.target.value)))}
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
          (() => {
            const sortedRequests = [...requests].sort(
              (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
            );
            const totalReqs = sortedRequests.length;
            const startIdx = (reqsPage - 1) * PAGE_SIZE;
            const visibleReqs = sortedRequests.slice(startIdx, startIdx + PAGE_SIZE);
            const totalReqPages = Math.ceil(totalReqs / PAGE_SIZE) || 1;
            return (
              <div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  {visibleReqs.map((req, index) => {
                    const covered = req.units_covered ?? 0;
                    const shortfall = req.units_shortfall ?? Math.max(req.units_requested - covered, 0);
                    const fullyCovered = shortfall === 0;
                    const isClosed = req.status === 'FULFILLED' || req.status === 'CANCELLED';

                    return (
                      <div key={req.id} id={`request-card-${req.id}`} className={`glass-panel ${req.status === 'RE_PLANNING' ? 'highlight-red' : ''}`} style={{ borderLeft: `4px solid ${ req.status === 'COMMITTED_IN_TRANSIT' ? 'var(--emerald-500)' : req.status === 'RE_PLANNING' ? 'var(--crimson-500)' : req.status === 'PROXIMITY_ZONE_NOTIFIED' ? 'var(--amber-500)' : 'var(--cyan-500)' }` }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '0.5rem' }}>
                          <div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.35rem', flexWrap: 'wrap' }}>
                              <span style={{ fontSize: '0.78rem', fontFamily: 'var(--font-mono)', color: 'var(--text-dim)', fontWeight: 700 }}>#{startIdx + index + 1}</span>
                              <span style={{ fontSize: '1.2rem', fontWeight: 800, color: 'var(--text-main)' }}>
                                {req.units_requested}x {req.required_blood_group} ({COMPONENT_LABELS[req.component_type] ?? req.component_type})
                              </span>
                              <span className={`badge ${ req.status === 'COMMITTED_IN_TRANSIT' ? 'badge-green' : req.status === 'RE_PLANNING' ? 'badge-red' : req.status === 'PROXIMITY_ZONE_NOTIFIED' ? 'badge-amber' : req.status === 'FULFILLED' ? 'badge-purple' : 'badge-cyan' }`}>
                                {req.status === 'COMMITTED_IN_TRANSIT' ? 'On The Way' : req.status === 'RE_PLANNING' ? 'Finding Replacement' : req.status === 'PROXIMITY_ZONE_NOTIFIED' ? 'Asking Donors' : req.status === 'FULFILLED' ? 'Delivered' : req.status}
                              </span>
                            </div>
                            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Patient: <code>{req.patient_id_token}</code></div>
                          </div>
                        </div>

                        <div style={{ marginTop: '0.9rem' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', marginBottom: '0.3rem' }}>
                            <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>Bags secured: {covered} of {req.units_requested}</span>
                            {!fullyCovered && !isClosed && (<span style={{ color: 'var(--amber-500)', fontWeight: 700 }}>Still need {shortfall}</span>)}
                          </div>
                          <div style={{ height: '6px', background: 'var(--color-bg)', borderRadius: '3px', overflow: 'hidden' }}>
                            <div style={{ height: '100%', width: `${Math.min(100, (covered / Math.max(req.units_requested, 1)) * 100)}%`, background: fullyCovered ? 'var(--emerald-500)' : 'var(--amber-500)', transition: 'width 0.3s ease' }} />
                          </div>
                        </div>

                        {req.allocations && req.allocations.length > 0 && (
                          <div style={{ marginTop: '1rem', paddingTop: '0.75rem', borderTop: '1px solid var(--border-subtle)' }}>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)', fontWeight: 700, marginBottom: '0.5rem', textTransform: 'uppercase' }}>Where This Blood Is Coming From:</div>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.6rem' }}>
                              {(() => {
                                const bankGroups: Record<string, { count: number; batches: string[]; alloc: typeof req.allocations[0] }> = {};
                                const donorGroups: Record<string, { count: number; alloc: typeof req.allocations[0] }> = {};

                                const sortedAllocations = [...req.allocations].sort(
                                  (a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime()
                                );
                                sortedAllocations.forEach((alloc) => {
                                  if (alloc.source_type === 'LIVE_DONOR' && alloc.donor_id) {
                                    if (!donorGroups[alloc.donor_id]) {
                                      donorGroups[alloc.donor_id] = { count: 0, alloc };
                                    }
                                    donorGroups[alloc.donor_id].count += 1;
                                  } else {
                                    const key = 'BLOOD_BANK_STORAGE';
                                    if (!bankGroups[key]) {
                                      bankGroups[key] = { count: 0, batches: [], alloc };
                                    }
                                    bankGroups[key].count += 1;
                                    if (alloc.batch_number && !bankGroups[key].batches.includes(alloc.batch_number)) {
                                      bankGroups[key].batches.push(alloc.batch_number);
                                    }
                                  }
                                });

                                return (
                                  <>
                                    {Object.entries(bankGroups).map(([key, group]) => {
                                      const distStr = group.alloc.distance_km != null ? ` (~${Number(group.alloc.distance_km).toFixed(2)}km away, ETA ~${group.alloc.estimated_transit_minutes} min)` : '';
                                      const batchesStr = group.batches.length > 0 ? ` (${group.batches.length > 1 ? 'Batches' : 'Batch'} ${group.batches.join(', ')})` : '';
                                      return (
                                        <div key={key} style={{ background: 'var(--color-bg)', padding: '0.5rem 0.8rem', borderRadius: '8px', border: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8rem' }}>
                                          <Truck size={14} color="var(--emerald-400)" />
                                          <span>
                                            <b>📦 {group.count} x {req.required_blood_group} ({COMPONENT_LABELS[req.component_type] || req.component_type}) From Blood Bank Storage</b>
                                            {batchesStr}
                                            {distStr}
                                          </span>
                                          <span className="badge badge-green" style={{ fontSize: '0.65rem' }}>
                                            {group.count > 1 ? `${group.count} Bags Confirmed` : 'Confirmed'}
                                          </span>
                                        </div>
                                      );
                                    })}

                                    {Object.entries(donorGroups).map(([donorId, group]) => {
                                      const distStr = group.alloc.distance_km != null ? ` (~${Number(group.alloc.distance_km).toFixed(2)}km away, ETA ~${group.alloc.estimated_transit_minutes} min)` : '';
                                      return (
                                        <div key={donorId} style={{ background: 'var(--color-bg)', padding: '0.5rem 0.8rem', borderRadius: '8px', border: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8rem' }}>
                                          <Truck size={14} color="var(--emerald-400)" />
                                          <span>
                                            <b>🙋 {group.count} x {req.required_blood_group} ({COMPONENT_LABELS[req.component_type] || req.component_type}) From Volunteer Donor</b>
                                            {distStr}
                                          </span>
                                          <span className="badge badge-green" style={{ fontSize: '0.65rem' }}>
                                            {group.count > 1 ? `${group.count} Bags Confirmed` : 'Confirmed'}
                                          </span>
                                        </div>
                                      );
                                    })}
                                  </>
                                );
                              })()}
                            </div>
                          </div>
                        )}

                        <div style={{ marginTop: '1rem', display: 'flex', justifyContent: 'flex-end', gap: '0.6rem', flexWrap: 'wrap' }}>
                          <button id={`btn-explain-${req.id}`} onClick={() => viewExplanation(req.id)} className="btn btn-secondary" style={{ fontSize: '0.8rem', padding: '0.35rem 0.75rem' }}>
                            <Info size={14} />
                          </button>
                          {!isClosed && (
                            <button id={`btn-cancel-${req.id}`} onClick={() => handleCancel(req.id)} className="btn btn-secondary" style={{ fontSize: '0.8rem', padding: '0.35rem 0.75rem' }}>Cancel Request</button>
                          )}
                          {!isClosed && covered > 0 && (
                            <button id={`btn-fulfill-${req.id}`} onClick={() => handleFulfill(req.id, !fullyCovered)} className="btn btn-cyan" style={{ fontSize: '0.8rem', padding: '0.35rem 0.75rem', display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                              <CheckCircle2 size={14} /> {fullyCovered ? 'Confirm Blood Received & Donated' : `Confirm Received (${covered}/${req.units_requested} Bags)`}
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
                {totalReqs > PAGE_SIZE && (
                  <div style={{ marginTop: '1rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' }}>
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                      Showing {startIdx + 1}–{Math.min(reqsPage * PAGE_SIZE, totalReqs)} of {totalReqs} requests
                    </span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                      {Array.from({ length: totalReqPages }, (_, i) => i + 1).map((p) => (
                        <button key={p} onClick={() => setReqsPage(p)} className={`btn ${reqsPage === p ? 'btn-primary' : 'btn-secondary'}`} style={{ minWidth: '32px', padding: '0.25rem 0.5rem', fontSize: '0.78rem' }}>{p}</button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })()
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
