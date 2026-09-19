import React, { useState, useEffect, useCallback } from 'react';
import { useWebSocket } from '../context/WebSocketContext';
import { api } from '../lib/api';
import {
  BloodRequest,
  InventoryUnit,
  DonorPublic,
  AllocationAuditLog,
  TriageLevel,
  TransferRecommendation,
  PredictionSummary,
} from '../types';
import {
  Radio,
  Clock,
  RefreshCw,
  Sliders,
  Shield,
  FileText,
  Activity,
  Heart,
  Droplet,
  Building2,
  X,
  Send,
  Sparkles,
  Truck,
  ArrowRight,
  TrendingUp,
  MapPin,
  CheckCircle2,
} from 'lucide-react';

const TRIAGE_CONFIG: Record<TriageLevel, { label: string; color: string; bg: string }> = {
  MASSIVE_TRANSFUSION_PROTOCOL: {
    label: 'MTP (Life Threatening)',
    color: 'var(--crimson-500)',
    bg: 'rgba(239, 68, 68, 0.12)',
  },
  ACTIVE_TRAUMA: {
    label: 'Active Trauma Bay',
    color: 'var(--amber-500)',
    bg: 'rgba(245, 158, 11, 0.12)',
  },
  SCHEDULED_EMERGENCY_RESERVE: {
    label: 'Urgent Surgery',
    color: 'var(--cyan-500)',
    bg: 'rgba(59, 130, 246, 0.12)',
  },
  ROUTINE_CLINICAL: {
    label: 'Routine Clinical',
    color: 'var(--emerald-500)',
    bg: 'rgba(22, 163, 74, 0.12)',
  },
};

export const CoordinatorDashboard: React.FC = () => {
  const { events, lastEvent } = useWebSocket();

  const [requests, setRequests] = useState<BloodRequest[]>([]);
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [metrics, setMetrics] = useState<AdminMetrics | null>(null);
  const [auditLogs, setAuditLogs] = useState<AllocationAuditLog[]>([]);
  const [donors, setDonors] = useState<DonorPublic[]>([]);
  const [inventory, setInventory] = useState<InventoryUnit[]>([]);
  const [transfers, setTransfers] = useState<TransferRecommendation[]>([]);
  const [mlSummary, setMlSummary] = useState<PredictionSummary | null>(null);

  // Simulation State
  const [simMultiplier, setSimMultiplier] = useState<number>(1.2);
  const [simRunning, setSimRunning] = useState<boolean>(false);
  const [simOutput, setSimOutput] = useState<string | null>(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Modal State
  const [selectedAuditLog, setSelectedAuditLog] = useState<AllocationAuditLog[] | null>(null);
  const [inspectingReqId, setInspectingReqId] = useState<string | null>(null);
  const [overrideReq, setOverrideReq] = useState<BloodRequest | null>(null);
  const [overrideType, setOverrideType] = useState<'INVENTORY' | 'DONOR'>('INVENTORY');
  const [overrideResourceId, setOverrideResourceId] = useState<string>('');
  const [overrideReason, setOverrideReason] = useState<string>('');
  const [overriding, setOverriding] = useState<boolean>(false);

  // Pagination state
  const PAGE_SIZE = 5;
  const [reqsPage, setReqsPage] = useState(1);
  const [transfersPage, setTransfersPage] = useState(1);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [reqsData, overviewData, metricsData, logsData, donorsData, invData, transfersData, summaryData] = await Promise.all([
        api.get<BloodRequest[]>('/requests'),
        api.get<AdminOverview>('/admin/overview').catch(() => null),
        api.get<AdminMetrics>('/admin/metrics').catch(() => null),
        api.get<AllocationAuditLog[]>('/audit/logs').catch(() => []),
        api.get<DonorPublic[]>('/donors').catch(() => []),
        api.get<InventoryUnit[]>('/inventory').catch(() => []),
        api.get<TransferRecommendation[]>('/predictions/transfers').catch(() => []),
        api.get<PredictionSummary>('/predictions/summary').catch(() => null),
      ]);

      setRequests(reqsData);
      if (overviewData) setOverview(overviewData);
      if (metricsData) setMetrics(metricsData);
      setAuditLogs(logsData);
      setDonors(donorsData);
      setInventory(invData);
      setTransfers(transfersData);
      setMlSummary(summaryData);
      setError(null);
    } catch (err) {
      console.error('Failed to fetch coordinator data:', err);
      setError(err instanceof Error ? err.message : 'Could not refresh network data.');
    } finally {
      setLoading(false);
    }
  }, []);

  const handleRunSimulation = async () => {
    setSimRunning(true);
    setSimOutput(null);
    try {
      const res = await api.post<{ summary_impact: string }>('/predictions/simulate', {
        demand_multiplier: simMultiplier,
      });
      setSimOutput(res.summary_impact);
    } catch (err) {
      alert('Simulation error: ' + (err instanceof Error ? err.message : err));
    } finally {
      setSimRunning(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Real-time update on WebSocket push events
  useEffect(() => {
    if (lastEvent) {
      fetchData();
    }
  }, [lastEvent, fetchData]);

  const viewExplanation = async (id: string) => {
    setInspectingReqId(id);
    try {
      const logs = await api.get<AllocationAuditLog[]>(`/audit/requests/${id}/explanation`);
      setSelectedAuditLog(logs);
    } catch (err) {
      console.error('Failed to load audit explanation:', err);
      setSelectedAuditLog([]);
    }
  };

  const handleApplyOverride = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!overrideReq || !overrideResourceId) return;
    setOverriding(true);
    setError(null);

    const body: Record<string, unknown> = {
      reason: overrideReason.trim() || 'Coordinator manual clinical prioritization',
      inventory_unit_id: overrideType === 'INVENTORY' ? overrideResourceId : undefined,
      donor_id: overrideType === 'DONOR' ? overrideResourceId : undefined,
    };

    try {
      await api.post(`/admin/allocations/${overrideReq.id}/override`, body);
      setOverrideReq(null);
      setOverrideResourceId('');
      setOverrideReason('');
      await fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Allocation override failed.');
    } finally {
      setOverriding(false);
    }
  };

  const availableUnits = inventory.filter((u) => u.status === 'AVAILABLE');
  const availableDonors = donors.filter((d) => d.is_available);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {/* Network Operational Telemetry Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem' }}>
        <div className="glass-panel" style={{ padding: '1.25rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 600 }}>Active Emergency Requests</span>
            <Activity size={18} color="var(--crimson-500)" />
          </div>
          <div style={{ fontSize: '1.75rem', fontWeight: 800, marginTop: '0.4rem', color: 'var(--crimson-500)' }}>
            {overview?.active_requests_count ?? requests.filter((r) => r.status !== 'FULFILLED' && r.status !== 'CANCELLED').length}
          </div>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-dim)', marginTop: '0.25rem' }}>
            Requiring clinical matching or in-transit
          </div>
        </div>

        <div className="glass-panel" style={{ padding: '1.25rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 600 }}>Available Blood Units (FEFO)</span>
            <Droplet size={18} color="var(--cyan-500)" />
          </div>
          <div style={{ fontSize: '1.75rem', fontWeight: 800, marginTop: '0.4rem', color: 'var(--cyan-500)' }}>
            {overview?.available_inventory_units_count ?? availableUnits.length}
          </div>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-dim)', marginTop: '0.25rem' }}>
            Cold-chain storage across all blood banks
          </div>
        </div>

        <div className="glass-panel" style={{ padding: '1.25rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 600 }}>Active Volunteer Donors</span>
            <Heart size={18} color="var(--emerald-500)" />
          </div>
          <div style={{ fontSize: '1.75rem', fontWeight: 800, marginTop: '0.4rem', color: 'var(--emerald-500)' }}>
            {overview?.active_donors_count ?? availableDonors.length}
          </div>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-dim)', marginTop: '0.25rem' }}>
            Ready for live geofenced dispatch
          </div>
        </div>

        <div className="glass-panel" style={{ padding: '1.25rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 600 }}>Mean Sourcing Time (MTTS)</span>
            <Clock size={18} color="var(--amber-500)" />
          </div>
          <div style={{ fontSize: '1.75rem', fontWeight: 800, marginTop: '0.4rem', color: 'var(--amber-500)' }}>
            {metrics?.mean_time_to_secure_seconds != null
              ? `${(metrics.mean_time_to_secure_seconds / 60).toFixed(1)}m`
              : '—'}
          </div>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-dim)', marginTop: '0.25rem' }}>
            From clinical intake to resource hard-lock
          </div>
        </div>

        {/* AI Decision Support Telemetry */}
        <div className="glass-panel" style={{ padding: '1.25rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 600 }}>AI Transfer Rebalancing</span>
            <Sparkles size={18} color="var(--color-info)" />
          </div>
          <div style={{ fontSize: '1.75rem', fontWeight: 800, marginTop: '0.4rem', color: 'var(--color-info)' }}>
            {mlSummary?.active_transfer_recommendations_count ?? transfers.length}
          </div>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-dim)', marginTop: '0.25rem' }}>
            Inter-facility routes to prevent spoilage
          </div>
        </div>

        <div className="glass-panel" style={{ padding: '1.25rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 600 }}>Critical Shortages (D+1)</span>
            <Shield size={18} color="var(--crimson-500)" />
          </div>
          <div style={{ fontSize: '1.75rem', fontWeight: 800, marginTop: '0.4rem', color: 'var(--crimson-500)' }}>
            {mlSummary?.critical_shortage_count ?? 0}
          </div>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-dim)', marginTop: '0.25rem' }}>
            Series where stock &lt; next-day demand
          </div>
        </div>
      </div>

      {/* SECTION: AI Network Rebalancing & What-If Stress Simulation */}
      <div className="glass-panel" style={{ marginBottom: '1.75rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem', marginBottom: '1.25rem' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
              <Truck size={22} color="var(--color-info)" />
              <h2 style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--text-main)', margin: 0 }}>
                AI Inter-Facility Network Rebalancing
              </h2>
              <span className="badge badge-purple">
                {transfers.length} Actionable Recommendations
              </span>
            </div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
              Conservative algorithmic matching: Donors with wastage risk (&ge;50%) paired with facilities facing deficits.
              <span style={{ color: 'var(--color-success)', fontWeight: 600, marginLeft: '0.5rem' }}>● Advisory Only (Requires Coordinator Confirmation)</span>
            </div>
          </div>

          {/* What-if simulation launcher */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', background: 'var(--color-bg)', padding: '0.4rem 0.75rem', borderRadius: '8px', border: '1px solid var(--border-subtle)' }}>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>Stress Simulation:</span>
            {[
              { label: '+20%', mult: 1.2 },
              { label: '+50%', mult: 1.5 },
              { label: '2.0x', mult: 2.0 },
            ].map((s) => (
              <button
                key={s.label}
                onClick={() => setSimMultiplier(s.mult)}
                className={`btn ${simMultiplier === s.mult ? 'btn-primary' : 'btn-secondary'}`}
                style={{ fontSize: '0.7rem', padding: '0.2rem 0.55rem' }}
              >
                {s.label}
              </button>
            ))}
            <button
              onClick={handleRunSimulation}
              disabled={simRunning}
              className="btn btn-cyan"
              style={{ fontSize: '0.75rem', padding: '0.3rem 0.7rem' }}
            >
              <TrendingUp size={13} className={simRunning ? 'spin' : ''} />
              {simRunning ? 'Running...' : 'Run Simulation'}
            </button>
          </div>
        </div>

        {/* Simulation Output Banner */}
        {simOutput && (
          <div style={{
            background: '#EFF6FF',
            border: '1px solid #BFDBFE',
            borderRadius: '8px',
            padding: '0.85rem 1rem',
            marginBottom: '1.25rem',
            fontSize: '0.85rem',
            color: '#1E40AF',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
              <TrendingUp size={18} style={{ color: '#2563EB', flexShrink: 0 }} />
              <span><b>What-If Stress Scenario ({Math.round((simMultiplier - 1) * 100)}% Surge):</b> {simOutput}</span>
            </div>
            <button onClick={() => setSimOutput(null)} style={{ background: 'transparent', border: 'none', color: '#1E40AF', cursor: 'pointer' }}>
              <X size={15} />
            </button>
          </div>
        )}

        {/* Transfer Recommendations Table */}
        {transfers.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)', background: 'var(--color-bg)', borderRadius: '8px', border: '1px dashed var(--border-subtle)' }}>
            <CheckCircle2 size={24} style={{ color: 'var(--color-success)', marginBottom: '0.5rem' }} />
            <div>All facilities currently balanced. No inter-bank transfers required at this time.</div>
          </div>
        ) : (
          (() => {
            const totalT = transfers.length;
            const visibleT = transfers.slice(0, transfersPage * PAGE_SIZE);
            const hasMoreT = totalT > visibleT.length;
            const totalTPages = Math.ceil(totalT / PAGE_SIZE);
            return (
              <div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
                  {visibleT.map((t, idx) => (
                    <div key={idx} style={{ background: 'var(--color-bg)', padding: '1rem 1.25rem', borderRadius: '10px', border: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <span style={{ fontSize: '0.72rem', fontFamily: 'var(--font-mono)', color: 'var(--text-dim)', minWidth: '24px' }}>#{(transfersPage - 1) * PAGE_SIZE + idx + 1}</span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem', flexWrap: 'wrap' }}>
                          <div style={{ minWidth: '160px' }}>
                            <div style={{ fontSize: '0.72rem', color: 'var(--amber-500)', fontWeight: 700, textTransform: 'uppercase' }}>SOURCE FACILITY (Wastage Risk: {Math.round(t.donor_wastage_risk * 100)}%)</div>
                            <div style={{ fontSize: '1rem', fontWeight: 800, color: 'var(--text-main)' }}>{t.donor_bank_name}</div>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <ArrowRight size={20} color="var(--color-info)" />
                            <div style={{ textAlign: 'center' }}>
                              <span className="badge badge-purple" style={{ fontSize: '0.85rem', padding: '0.35rem 0.75rem', fontWeight: 700 }}>{t.recommended_units}x {t.blood_group} ({t.component_type})</span>
                              {t.distance_km && (<div style={{ fontSize: '0.7rem', color: 'var(--text-dim)', marginTop: '0.2rem' }}><MapPin size={10} style={{ display: 'inline', marginRight: '2px' }} />{t.distance_km} km transit</div>)}
                            </div>
                            <ArrowRight size={20} color="var(--color-info)" />
                          </div>
                          <div style={{ minWidth: '160px' }}>
                            <div style={{ fontSize: '0.72rem', color: 'var(--color-critical)', fontWeight: 700, textTransform: 'uppercase' }}>TARGET FACILITY (Deficit: {t.receiver_deficit.toFixed(0)}u)</div>
                            <div style={{ fontSize: '1rem', fontWeight: 800, color: 'var(--text-main)' }}>{t.receiver_bank_name}</div>
                          </div>
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem' }}>
                        <span className={`badge ${t.status === 'Resolved' ? 'badge-green' : 'badge-amber'}`} style={{ fontSize: '0.75rem' }}>{t.status}</span>
                        <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', maxWidth: '280px' }}>{t.recommended_action}</div>
                      </div>
                    </div>
                  ))}
                </div>
                {(hasMoreT || totalT > PAGE_SIZE) && (
                  <div style={{ marginTop: '1rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' }}>
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Showing {visibleT.length} of {totalT} recommendations</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                      {totalT > 10 ? (
                        Array.from({ length: totalTPages }, (_, i) => i + 1).map((p) => (
                          <button key={p} onClick={() => setTransfersPage(p)} className={`btn ${transfersPage === p ? 'btn-primary' : 'btn-secondary'}`} style={{ minWidth: '32px', padding: '0.25rem 0.5rem', fontSize: '0.78rem' }}>{p}</button>
                        ))
                      ) : hasMoreT ? (
                        <button onClick={() => setTransfersPage(p => p + 1)} className="btn btn-secondary" style={{ fontSize: '0.8rem', padding: '0.3rem 0.85rem' }}>Show More</button>
                      ) : null}
                    </div>
                  </div>
                )}
              </div>
            );
          })()
        )}
      </div>

      {error && (
        <div
          style={{
            background: 'rgba(239, 68, 68, 0.12)',
            border: '1px solid var(--crimson-500)',
            padding: '0.75rem 1rem',
            borderRadius: '8px',
            color: 'var(--crimson-500)',
            fontSize: '0.85rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <span>{error}</span>
          <button onClick={() => setError(null)} style={{ background: 'transparent', border: 'none', cursor: 'pointer' }}>
            <X size={16} />
          </button>
        </div>
      )}

      {/* Main Operations Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '1.5rem' }}>
        {/* City-Wide Active Priority Queue */}
        <div className="glass-panel">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
              <Radio size={20} color="var(--crimson-500)" />
              <h2 style={{ fontSize: '1.2rem', fontWeight: 700 }}>City-Wide Emergency Priority Queue</h2>
            </div>
            <button
              onClick={fetchData}
              className="btn btn-secondary"
              style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem' }}
            >
              <RefreshCw size={14} className={loading ? 'spin' : ''} />
              Sync Network
            </button>
          </div>

          {requests.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
              No active emergency requests across the network. All trauma bays are fully satisfied.
            </div>
          ) : (
            (() => {
              const totalReqs = requests.length;
              const visibleReqs = requests.slice(0, reqsPage * PAGE_SIZE);
              const hasMoreReqs = totalReqs > visibleReqs.length;
              const totalReqPages = Math.ceil(totalReqs / PAGE_SIZE);
              return (
                <div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    {visibleReqs.map((req, index) => {
                      const covered = req.units_covered ?? 0;
                      const shortfall = req.units_shortfall ?? Math.max(req.units_requested - covered, 0);
                      return (
                        <div key={req.id} style={{ border: '1px solid var(--border-subtle)', borderRadius: '10px', padding: '1rem', background: 'var(--color-bg)', borderLeft: `4px solid ${ req.status === 'COMMITTED_IN_TRANSIT' ? 'var(--emerald-500)' : req.status === 'RE_PLANNING' ? 'var(--crimson-500)' : req.status === 'PROXIMITY_ZONE_NOTIFIED' ? 'var(--amber-500)' : 'var(--cyan-500)' }` }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '0.5rem' }}>
                            <div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                                <span style={{ fontSize: '0.72rem', fontFamily: 'var(--font-mono)', color: 'var(--text-dim)' }}>#{(reqsPage - 1) * PAGE_SIZE + index + 1}</span>
                                <span style={{ fontWeight: 800, fontSize: '0.95rem' }}>{req.patient_id_token || req.id.slice(0, 8)}</span>
                                <span style={{ padding: '0.2rem 0.55rem', borderRadius: '6px', fontSize: '0.72rem', fontWeight: 700, background: 'rgba(100, 116, 139, 0.12)', color: 'var(--text-main)' }}>{req.status}</span>
                              </div>
                              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.35rem' }}>
                                <Building2 size={13} style={{ display: 'inline', marginRight: '4px' }} />
                                {req.hospital_name || 'Hospital Facility'} • Patient Case: <code>{req.patient_id_token}</code>
                              </div>
                            </div>
                          </div>

                          <div style={{ margin: '0.85rem 0' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', marginBottom: '0.3rem' }}>
                              <span>Required: <strong>{req.required_blood_group} {req.component_type}</strong> ({req.units_requested} Bags)</span>
                              <span style={{ color: shortfall === 0 ? 'var(--emerald-600)' : 'var(--crimson-500)', fontWeight: 700 }}>{covered} of {req.units_requested} Secured ({shortfall} Shortfall)</span>
                            </div>
                            <div style={{ width: '100%', height: '7px', background: 'rgba(0,0,0,0.06)', borderRadius: '4px', overflow: 'hidden' }}>
                              <div style={{ width: `${Math.min((covered / req.units_requested) * 100, 100)}%`, height: '100%', background: shortfall === 0 ? 'var(--emerald-500)' : 'var(--crimson-500)', transition: 'width 0.3s ease' }} />
                            </div>
                          </div>

                          <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', borderTop: '1px solid var(--border-subtle)', paddingTop: '0.65rem' }}>
                            <button onClick={() => viewExplanation(req.id)} className="btn btn-secondary" style={{ padding: '0.35rem 0.7rem', fontSize: '0.75rem' }}>
                              <FileText size={13} /> Explain Rationale
                            </button>
                            <button onClick={() => { setOverrideReq(req); setOverrideResourceId(''); setOverrideReason(''); }} className="btn btn-secondary" style={{ padding: '0.35rem 0.7rem', fontSize: '0.75rem', color: 'var(--amber-500)' }}>
                              <Sliders size={13} /> Manual Clinical Override
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  {(hasMoreReqs || totalReqs > PAGE_SIZE) && (
                    <div style={{ marginTop: '1rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' }}>
                      <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Showing {visibleReqs.length} of {totalReqs} requests</span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                        {totalReqs > 10 ? (
                          Array.from({ length: totalReqPages }, (_, i) => i + 1).map((p) => (
                            <button key={p} onClick={() => setReqsPage(p)} className={`btn ${reqsPage === p ? 'btn-primary' : 'btn-secondary'}`} style={{ minWidth: '32px', padding: '0.25rem 0.5rem', fontSize: '0.78rem' }}>{p}</button>
                          ))
                        ) : hasMoreReqs ? (
                          <button onClick={() => setReqsPage(p => p + 1)} className="btn btn-secondary" style={{ fontSize: '0.8rem', padding: '0.3rem 0.85rem' }}>Show More</button>
                        ) : null}
                      </div>
                    </div>
                  )}
                </div>
              );
            })()
          )}
        </div>

        {/* Live Network Stream & Event Telemetry */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          {/* Live WebSocket Event Ticker */}
          <div className="glass-panel">
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
              <Activity size={18} color="var(--cyan-500)" />
              <h3 style={{ fontSize: '1rem', fontWeight: 700 }}>Real-Time Coordination Ticker</h3>
            </div>
            {events.length === 0 ? (
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textAlign: 'center', padding: '1.5rem' }}>
                Awaiting real-time cluster events...
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '360px', overflowY: 'auto' }}>
                {events.slice(0, 15).map((evt, idx) => (
                  <div
                    key={idx}
                    style={{
                      padding: '0.6rem',
                      borderRadius: '6px',
                      background: 'var(--color-bg)',
                      border: '1px solid var(--border-subtle)',
                      fontSize: '0.75rem',
                      lineHeight: 1.3,
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, marginBottom: '0.2rem' }}>
                      <span style={{ color: evt.type.includes('EMERGENCY') ? 'var(--crimson-500)' : 'var(--cyan-500)' }}>
                        {evt.type}
                      </span>
                      <span style={{ color: 'var(--text-dim)', fontSize: '0.7rem' }}>
                        {new Date().toLocaleTimeString()}
                      </span>
                    </div>
                    <div style={{ color: 'var(--text-muted)' }}>
                      {evt.message || JSON.stringify(evt)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Audit Logs Summary */}
          <div className="glass-panel">
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
              <Shield size={18} color="var(--emerald-500)" />
              <h3 style={{ fontSize: '1rem', fontWeight: 700 }}>Immutable Decision Audit Trail</h3>
            </div>
            {auditLogs.length === 0 ? (
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textAlign: 'center', padding: '1.5rem' }}>
                No recent audit log entries recorded.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '300px', overflowY: 'auto' }}>
                {auditLogs.slice(0, 8).map((log) => (
                  <div
                    key={log.id}
                    style={{
                      padding: '0.55rem',
                      borderRadius: '6px',
                      borderLeft: '3px solid var(--emerald-500)',
                      background: 'var(--color-bg)',
                      fontSize: '0.72rem',
                    }}
                  >
                    <div style={{ fontWeight: 700, color: 'var(--text-main)' }}>
                      [{log.decision_type}] Request {log.request_id?.slice(0, 8)}
                    </div>
                    <div style={{ color: 'var(--text-muted)', marginTop: '0.2rem' }}>
                      {log.rationale_summary}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Manual Override Modal */}
      {overrideReq && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.5)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100,
            padding: '1rem',
          }}
        >
          <div
            style={{
              background: 'white',
              borderRadius: '14px',
              padding: '1.5rem',
              width: '100%',
              maxWidth: '520px',
              boxShadow: '0 20px 40px rgba(0,0,0,0.2)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h3 style={{ fontSize: '1.1rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Sliders size={18} color="var(--amber-500)" />
                Clinical Allocation Override
              </h3>
              <button onClick={() => setOverrideReq(null)} style={{ background: 'transparent', border: 'none', cursor: 'pointer' }}>
                <X size={18} />
              </button>
            </div>

            <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>
              Manually assign an inventory unit or verified volunteer donor to request{' '}
              <strong>{overrideReq.patient_id_token || overrideReq.id.slice(0, 8)}</strong> ({overrideReq.required_blood_group} {overrideReq.component_type}).
            </p>

            <form onSubmit={handleApplyOverride} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div>
                <label style={{ fontSize: '0.8rem', fontWeight: 700, display: 'block', marginBottom: '0.35rem' }}>
                  Override Target Resource Type
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                  <button
                    type="button"
                    onClick={() => {
                      setOverrideType('INVENTORY');
                      setOverrideResourceId('');
                    }}
                    style={{
                      padding: '0.5rem',
                      borderRadius: '6px',
                      fontSize: '0.8rem',
                      fontWeight: 700,
                      border: overrideType === 'INVENTORY' ? '2px solid var(--cyan-500)' : '1px solid var(--border-subtle)',
                      background: overrideType === 'INVENTORY' ? 'rgba(59, 130, 246, 0.1)' : 'transparent',
                      cursor: 'pointer',
                    }}
                  >
                    Blood Bank Unit
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setOverrideType('DONOR');
                      setOverrideResourceId('');
                    }}
                    style={{
                      padding: '0.5rem',
                      borderRadius: '6px',
                      fontSize: '0.8rem',
                      fontWeight: 700,
                      border: overrideType === 'DONOR' ? '2px solid var(--emerald-500)' : '1px solid var(--border-subtle)',
                      background: overrideType === 'DONOR' ? 'rgba(22, 163, 74, 0.1)' : 'transparent',
                      cursor: 'pointer',
                    }}
                  >
                    Volunteer Donor
                  </button>
                </div>
              </div>

              <div>
                <label style={{ fontSize: '0.8rem', fontWeight: 700, display: 'block', marginBottom: '0.35rem' }}>
                  Select Resource
                </label>
                <select
                  required
                  className="select-field"
                  value={overrideResourceId}
                  onChange={(e) => setOverrideResourceId(e.target.value)}
                  style={{ width: '100%', padding: '0.65rem' }}
                >
                  <option value="">-- Choose available resource --</option>
                  {overrideType === 'INVENTORY'
                    ? availableUnits.map((u) => (
                        <option key={u.id} value={u.id}>
                          Batch {u.batch_number} ({u.blood_group} {u.component_type}) • Expires in{' '}
                          {Math.max(0, Math.ceil((new Date(u.expiry_date).getTime() - Date.now()) / (24 * 3600 * 1000)))}d
                        </option>
                      ))
                    : availableDonors.map((d) => (
                        <option key={d.id} value={d.id}>
                          Donor {d.id.slice(0, 8)} ({d.blood_group}) • Rating: {(d.reliability_score * 100).toFixed(0)}%
                        </option>
                      ))}
                </select>
              </div>

              <div>
                <label style={{ fontSize: '0.8rem', fontWeight: 700, display: 'block', marginBottom: '0.35rem' }}>
                  Clinical Justification / Rationale
                </label>
                <textarea
                  required
                  rows={3}
                  value={overrideReason}
                  onChange={(e) => setOverrideReason(e.target.value)}
                  placeholder="State the medical reason for manual override (mandatory for audit trail)..."
                  style={{
                    width: '100%',
                    padding: '0.65rem',
                    borderRadius: '8px',
                    border: '1px solid var(--border-subtle)',
                    fontSize: '0.82rem',
                    outline: 'none',
                  }}
                />
              </div>

              <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', marginTop: '0.5rem' }}>
                <button
                  type="button"
                  onClick={() => setOverrideReq(null)}
                  className="btn btn-secondary"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={overriding}
                  className="btn btn-primary"
                  style={{ background: 'var(--amber-500)' }}
                >
                  <Send size={15} />
                  {overriding ? 'Applying...' : 'Enforce Clinical Override'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Decision Explainability Modal */}
      {selectedAuditLog && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.5)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100,
            padding: '1rem',
          }}
        >
          <div
            style={{
              background: 'white',
              borderRadius: '14px',
              padding: '1.5rem',
              width: '100%',
              maxWidth: '650px',
              maxHeight: '80vh',
              overflowY: 'auto',
              boxShadow: '0 20px 40px rgba(0,0,0,0.2)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h3 style={{ fontSize: '1.15rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <FileText size={20} color="var(--cyan-500)" />
                Audit Trail & Allocation Rationale ({inspectingReqId?.slice(0, 8)})
              </h3>
              <button onClick={() => setSelectedAuditLog(null)} style={{ background: 'transparent', border: 'none', cursor: 'pointer' }}>
                <X size={18} />
              </button>
            </div>

            {selectedAuditLog.length === 0 ? (
              <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>No explanation records found for this request.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
                {selectedAuditLog.map((log) => (
                  <div
                    key={log.id}
                    style={{
                      padding: '0.85rem',
                      borderRadius: '8px',
                      background: 'var(--color-bg)',
                      border: '1px solid var(--border-subtle)',
                      borderLeft: '4px solid var(--cyan-500)',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', fontWeight: 700 }}>
                      <span style={{ color: 'var(--cyan-500)' }}>{log.decision_type}</span>
                      <span style={{ color: 'var(--text-dim)', fontSize: '0.72rem' }}>
                        {new Date(log.created_at).toLocaleTimeString()}
                      </span>
                    </div>
                    <div style={{ fontSize: '0.82rem', color: 'var(--text-main)', marginTop: '0.35rem', lineHeight: 1.4 }}>
                      {log.rationale_summary}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
