import React, { useState, useEffect, useCallback } from 'react';
import { useWebSocket } from '../context/WebSocketContext';
import { api } from '../lib/api';
import {
  InventoryUnit,
  UnitStatus,
  BloodComponentType,
  BloodRequest,
  DonorPublic,
  SeriesForecast,
  PredictionSummary,
} from '../types';
import { Droplet, Plus, RefreshCw, AlertTriangle, Building2, Truck, CheckCircle2, Clock, Activity, TrendingUp, Sparkles, ShieldAlert } from 'lucide-react';

interface HospitalOrder {
  request_id: string;
  hospital_name: string;
  hospital_address: string;
  patient_id_token: string;
  required_blood_group: string;
  component_type: string;
  units_requested: number;
  triage_level: string;
  calculated_urgency_score: number;
  status: string;
  created_at: string;
  allocated_units: {
    unit_id: string;
    batch_number: string;
    blood_group: string;
    unit_status: string;
    allocation_status: string;
    allocation_id: string;
  }[];
}

/** Volume logged for a newly registered bag; the form no longer keeps dead state for it. */
const DEFAULT_UNIT_VOLUME_ML = 300;

export const BloodBankDashboard: React.FC = () => {
  const { lastEvent } = useWebSocket();

  const [units, setUnits] = useState<InventoryUnit[]>([]);
  const [orders, setOrders] = useState<HospitalOrder[]>([]);
  const [activeRequests, setActiveRequests] = useState<BloodRequest[]>([]);
  const [activeDonors, setActiveDonors] = useState<DonorPublic[]>([]);
  const [forecasts, setForecasts] = useState<SeriesForecast[]>([]);
  const [forecastSummary, setForecastSummary] = useState<PredictionSummary | null>(null);
  const [componentFilter, setComponentFilter] = useState<string>('PRBC');
  const [loading, setLoading] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [dispatchingId, setDispatchingId] = useState<string | null>(null);

  // Pagination state for each list section
  const PAGE_SIZE = 5;
  const [ordersPage, setOrdersPage] = useState(1);
  const [requestsPage, setRequestsPage] = useState(1);
  const [donorsPage, setDonorsPage] = useState(1);
  const [unitsPage, setUnitsPage] = useState(1);

  // New unit form
  const [newBatch, setNewBatch] = useState('');
  const [newBloodGroup, setNewBloodGroup] = useState('O-');
  const [newComponent, setNewComponent] = useState<BloodComponentType>('PRBC');
  const [newExpiryDays, setNewExpiryDays] = useState(42);

  const fetchInventoryAndOrders = useCallback(async () => {
    setLoading(true);
    try {
      const [invData, ordersData, reqData, donorsData, forecastData, summaryData] = await Promise.all([
        api.get<InventoryUnit[]>('/inventory'),
        api.get<HospitalOrder[]>('/inventory/orders'),
        api.get<BloodRequest[]>('/requests'),
        api.get<DonorPublic[]>('/donors'),
        api.get<SeriesForecast[]>('/predictions/forecast').catch(() => []),
        api.get<PredictionSummary>('/predictions/summary').catch(() => null),
      ]);
      setUnits(invData);
      setOrders(ordersData);
      setActiveRequests(reqData);
      setActiveDonors(donorsData.filter((d) => d.is_available));
      setForecasts(forecastData);
      setForecastSummary(summaryData);
    } catch (err) {
      console.error('Failed to fetch inventory, orders, or forecasts:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchInventoryAndOrders();
  }, [fetchInventoryAndOrders]);

  useEffect(() => {
    if (
      lastEvent &&
      [
        'REQUEST_CREATED',
        'REQUEST_UPDATED',
        'EMERGENCY_BROADCAST_SENT',
        'INVENTORY_UNIT_ADDED',
        'INVENTORY_UNIT_STATUS_CHANGED',
        'INVENTORY_LOCKED',
        'BLOOD_BANK_DISPATCHED',
        'RE_PLANNING_TRIGGERED',
        'SYSTEM_RESET',
      ].includes(lastEvent.type)
    ) {
      fetchInventoryAndOrders();
    }
  }, [lastEvent, fetchInventoryAndOrders]);

  const handleStatusChange = async (unitId: string, newStatus: UnitStatus) => {
    try {
      await api.patch(`/inventory/units/${unitId}/status`, { status: newStatus });
      await fetchInventoryAndOrders();
    } catch (err) {
      alert('Error changing unit status: ' + (err instanceof Error ? err.message : err));
    }
  };

  const handleDispatchOrder = async (requestId: string) => {
    setDispatchingId(requestId);
    try {
      await api.post(`/inventory/orders/${requestId}/dispatch`);
      await fetchInventoryAndOrders();
    } catch (err) {
      alert('Error dispatching blood: ' + (err instanceof Error ? err.message : err));
    } finally {
      setDispatchingId(null);
    }
  };

  const handleAddUnit = async (e: React.FormEvent) => {
    e.preventDefault();
    const now = new Date();
    const expiry = new Date(Date.now() + newExpiryDays * 24 * 3600 * 1000);

    try {
      await api.post('/inventory/units', {
        batch_number: newBatch || `BB-${Math.floor(1000 + Math.random() * 9000)}`,
        blood_group: newBloodGroup,
        component_type: newComponent,
        volume_ml: DEFAULT_UNIT_VOLUME_ML,
        collection_date: now.toISOString(),
        expiry_date: expiry.toISOString(),
      });
      setShowAddModal(false);
      setNewBatch('');
      await fetchInventoryAndOrders();
    } catch (err) {
      alert('Error registering blood unit: ' + (err instanceof Error ? err.message : err));
    }
  };

  const availableCount = units.filter((u) => u.status === 'AVAILABLE').length;
  const lockedCount = units.filter((u) => u.status === 'LOCKED_RESERVE').length;
  const quarantinedCount = units.filter(
    (u) => u.status === 'QUARANTINED' || u.status === 'EXPIRED'
  ).length;

  const volunteerAllocations = activeRequests.flatMap(req =>
    (req.allocations || []).filter((a) => a.source_type === 'LIVE_DONOR').map((a) => ({
      request: req,
      allocation: a
    }))
  );

  // Map active donors, and attach allocation info if they have one.
  // AllocationOut exposes `donor_id`, not a nested `donor` object — comparing against
  // `allocation.donor?.id` always produced undefined, so every donor read "On Standby".
  const displayedDonors = activeDonors.map(donor => {
    const alloc = volunteerAllocations.find(va => va.allocation.donor_id === donor.id);
    return {
      donor,
      activeDispatch: alloc
    };
  });

  return (
    <div>
      {/* Informative Flow Notice */}
      <div style={{
        background: 'rgba(6, 182, 212, 0.1)',
        border: '1px solid rgba(6, 182, 212, 0.3)',
        borderRadius: '10px',
        padding: '0.85rem 1.25rem',
        marginBottom: '1.5rem',
        display: 'flex',
        alignItems: 'center',
        gap: '0.85rem',
        color: 'var(--color-info)',
        fontSize: '0.85rem',
      }}>
        <Building2 size={24} style={{ flexShrink: 0, color: 'var(--cyan-400)' }} />
        <div>
          <b>Hospital-to-Blood-Bank Pipeline:</b> Emergency requests created by <b>Hospital Admin</b> are automatically matched against this blood bank's stock. You can review incoming hospital orders, inspect locked cold-chain units, and confirm dispatch to the ambulance.
        </div>
      </div>

      {/* Top Stat Row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
        <div className="glass-panel">
          <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)', fontWeight: 600 }}>READY ON SHELVES</div>
          <div style={{ fontSize: '1.8rem', fontWeight: 800, color: 'var(--emerald-400)', marginTop: '0.25rem' }}>
            {availableCount} <span style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>Bags</span>
          </div>
        </div>

        <div className="glass-panel">
          <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)', fontWeight: 600 }}>RESERVED FOR HOSPITALS</div>
          <div style={{ fontSize: '1.8rem', fontWeight: 800, color: 'var(--amber-400)', marginTop: '0.25rem' }}>
            {lockedCount} <span style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>Bags</span>
          </div>
        </div>

        <div className="glass-panel">
          <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)', fontWeight: 600 }}>DAMAGED / EXPIRED</div>
          <div style={{ fontSize: '1.8rem', fontWeight: 800, color: 'var(--crimson-500)', marginTop: '0.25rem' }}>
            {quarantinedCount} <span style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>Bags</span>
          </div>
        </div>

        <div className="glass-panel" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <button
            id="btn-add-unit"
            onClick={() => setShowAddModal(true)}
            className="btn btn-cyan"
            style={{ width: '100%', height: '100%' }}
          >
            <Plus size={16} />
            + Add New Blood Bag
          </button>
        </div>
      </div>

      {/* SECTION: Incoming Hospital Blood Orders */}
      <div className="glass-panel highlight-cyan" style={{ marginBottom: '1.75rem', border: '1px solid rgba(6, 182, 212, 0.4)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <Building2 size={22} color="var(--cyan-400)" />
            <h2 style={{ fontSize: '1.2rem', fontWeight: 800 }}>
              Incoming Hospital Blood Orders
            </h2>
            <span className="badge badge-cyan">{orders.length} Active Orders</span>
          </div>

          <button onClick={fetchInventoryAndOrders} className="btn btn-secondary" style={{ padding: '0.35rem 0.75rem', fontSize: '0.8rem' }}>
            <RefreshCw size={14} className={loading ? 'spin' : ''} />
            Refresh
          </button>
        </div>

        {orders.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '2.5rem', color: 'var(--text-muted)', background: 'var(--color-bg)', borderRadius: '8px' }}>
            <Clock size={32} color="var(--text-dim)" style={{ marginBottom: '0.5rem' }} />
            <p>No active hospital orders currently assigned to this blood bank.</p>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-dim)', marginTop: '0.25rem' }}>
              When a partner hospital places an emergency blood request, cold-chain matching automatically reserves matching units and routes the order here in real time.
            </p>
          </div>
        ) : (
          (() => {
            const totalOrders = orders.length;
            const visibleOrders = orders.slice(0, ordersPage * PAGE_SIZE);
            const hasMoreOrders = totalOrders > visibleOrders.length;
            const totalOrderPages = Math.ceil(totalOrders / PAGE_SIZE);
            return (
              <div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  {visibleOrders.map((order, index) => {
                    const hasReservedUnits = order.allocated_units.some((u) => u.unit_status === 'LOCKED_RESERVE');
                    const allDispatched =
                      order.allocated_units.length > 0 &&
                      order.allocated_units.every((u) => u.unit_status === 'DISPATCHED');
                    return (
                      <div
                        key={order.request_id}
                        id={`order-card-${order.request_id.slice(0, 8)}`}
                        style={{
                          background: 'var(--color-bg)',
                          padding: '1.2rem',
                          borderRadius: '10px',
                          border: '1px solid var(--border-subtle)',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '0.85rem',
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '0.5rem' }}>
                          <div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.3rem' }}>
                              <span style={{ fontSize: '0.75rem', fontFamily: 'var(--font-mono)', color: 'var(--text-dim)', minWidth: '20px' }}>#{(ordersPage - 1) * PAGE_SIZE + index + 1}</span>
                              <span style={{ fontSize: '1.15rem', fontWeight: 800, color: 'var(--text-main)' }}>
                                {order.hospital_name}
                              </span>
                              <span className={`badge ${allDispatched ? 'badge-green' : 'badge-amber'}`}>
                                {allDispatched ? 'DISPATCHED' : order.status}
                              </span>
                            </div>
                            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                              Patient Token: <code>{order.patient_id_token}</code>
                            </div>
                          </div>
                          <div style={{ textAlign: 'right' }}>
                            <span style={{ fontSize: '1.2rem', fontWeight: 800, color: 'var(--crimson-500)' }}>
                              {order.units_requested}x {order.required_blood_group} ({order.component_type})
                            </span>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>Requested Quantity</div>
                          </div>
                        </div>

                        <div style={{ background: 'var(--color-surface)', padding: '0.75rem', borderRadius: '8px', border: '1px solid var(--border-subtle)' }}>
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)', fontWeight: 700, marginBottom: '0.4rem', textTransform: 'uppercase' }}>Blood Bags Allocated From Our Storage:</div>
                          {order.allocated_units.length === 0 ? (
                            <div style={{ background: 'rgba(245, 158, 11, 0.1)', border: '1px dashed rgba(245, 158, 11, 0.4)', borderRadius: '6px', padding: '0.6rem 0.85rem', display: 'flex', alignItems: 'center', gap: '0.6rem', fontSize: '0.8rem', color: 'var(--amber-400)' }}>
                              <AlertTriangle size={16} />
                              <span>Storage Depleted for {order.required_blood_group} ({order.component_type}) — Automated Matching Engine routed this demand to <b>Live Volunteer Donors</b> across the city.</span>
                            </div>
                          ) : (
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                              {order.allocated_units.map((u) => (
                                <div key={u.unit_id} style={{ background: 'var(--color-bg)', padding: '0.4rem 0.75rem', borderRadius: '6px', border: '1px solid rgba(255, 255, 255, 0.1)', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                  <Droplet size={13} color="var(--crimson-500)" />
                                  <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700 }}>Bag {u.batch_number}</span>
                                  <span>({u.blood_group})</span>
                                  <span className={`badge ${u.unit_status === 'LOCKED_RESERVE' ? 'badge-amber' : u.unit_status === 'DISPATCHED' ? 'badge-green' : 'badge-red'}`} style={{ fontSize: '0.65rem' }}>
                                    {u.unit_status === 'LOCKED_RESERVE' ? 'Reserved' : u.unit_status === 'DISPATCHED' ? 'Dispatched' : 'Damaged'}
                                  </span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>

                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', alignItems: 'center' }}>
                          {hasReservedUnits && (
                            <button id={`btn-dispatch-${order.request_id.slice(0, 8)}`} onClick={() => handleDispatchOrder(order.request_id)} disabled={dispatchingId === order.request_id} className="btn btn-cyan" style={{ fontSize: '0.85rem', padding: '0.45rem 1rem' }}>
                              <Truck size={15} />
                              {dispatchingId === order.request_id ? 'Handing Over...' : 'Hand to Ambulance (Dispatch)'}
                            </button>
                          )}
                          {allDispatched && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: 'var(--emerald-400)', fontSize: '0.85rem', fontWeight: 600 }}>
                              <CheckCircle2 size={16} /> All blood bags handed to courier and on the way to hospital.
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
                {/* Pagination Controls */}
                {(hasMoreOrders || totalOrders > PAGE_SIZE) && (
                  <div style={{ marginTop: '1rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' }}>
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Showing {visibleOrders.length} of {totalOrders} orders</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                      {totalOrders > 10 ? (
                        Array.from({ length: totalOrderPages }, (_, i) => i + 1).map((p) => (
                          <button key={p} onClick={() => setOrdersPage(p)} className={`btn ${ordersPage === p ? 'btn-primary' : 'btn-secondary'}`} style={{ minWidth: '32px', padding: '0.25rem 0.5rem', fontSize: '0.78rem' }}>{p}</button>
                        ))
                      ) : hasMoreOrders ? (
                        <button onClick={() => setOrdersPage(p => p + 1)} className="btn btn-secondary" style={{ fontSize: '0.8rem', padding: '0.3rem 0.85rem' }}>Show More</button>
                      ) : null}
                    </div>
                  </div>
                )}
              </div>
            );
          })()
        )}
      </div>

      {/* SECTION: Global Emergency Demand (All Active Requests) */}
      <div className="glass-panel" style={{ marginBottom: '1.75rem', border: '1px solid var(--border-subtle)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
            <h2 style={{ fontSize: '1.2rem', fontWeight: 800, display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <Activity size={22} color="var(--color-primary)" />
            City-Wide Hospital Requests
          </h2>
          <span className="badge badge-cyan">{activeRequests.length} Network Requests</span>
        </div>

        {activeRequests.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
            No active emergency requests across the network.
          </div>
        ) : (
          (() => {
            const totalReqs = activeRequests.length;
            const visibleReqs = activeRequests.slice(0, requestsPage * PAGE_SIZE);
            const hasMoreReqs = totalReqs > visibleReqs.length;
            const totalReqPages = Math.ceil(totalReqs / PAGE_SIZE);
            return (
              <div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
                  {visibleReqs.map((req, index) => (
                    <div key={req.id} style={{ background: 'var(--color-bg)', padding: '1rem', borderRadius: '8px', border: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.2rem' }}>
                          <span style={{ fontSize: '0.75rem', fontFamily: 'var(--font-mono)', color: 'var(--text-dim)' }}>#{(requestsPage - 1) * PAGE_SIZE + index + 1}</span>
                          <span style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-main)' }}>
                            {req.hospital_name || 'Hospital'} — {req.units_requested}x {req.required_blood_group} ({req.component_type === 'PRBC' ? 'Red Blood Cells' : req.component_type})
                          </span>
                        </div>
                        <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                          Covered: <b>{req.units_covered ?? 0} of {req.units_requested}</b>
                        </div>
                      </div>
                      <span className={`badge ${
                        req.status === 'FULFILLED' ? 'badge-green' :
                        req.status === 'COMMITTED_IN_TRANSIT' ? 'badge-cyan' :
                        req.status === 'PROXIMITY_ZONE_NOTIFIED' ? 'badge-amber' :
                        'badge-red'
                      }`}>
                        {req.status === 'FULFILLED' ? 'Delivered' :
                         req.status === 'COMMITTED_IN_TRANSIT' ? 'En Route' :
                         req.status === 'PROXIMITY_ZONE_NOTIFIED' ? 'Asking Donors' :
                         req.status === 'PENDING_EVALUATION' ? 'Searching...' :
                         req.status}
                      </span>
                    </div>
                  ))}
                </div>
                {(hasMoreReqs || totalReqs > PAGE_SIZE) && (
                  <div style={{ marginTop: '1rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' }}>
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Showing {visibleReqs.length} of {totalReqs} requests</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                      {totalReqs > 10 ? (
                        Array.from({ length: totalReqPages }, (_, i) => i + 1).map((p) => (
                          <button key={p} onClick={() => setRequestsPage(p)} className={`btn ${requestsPage === p ? 'btn-primary' : 'btn-secondary'}`} style={{ minWidth: '32px', padding: '0.25rem 0.5rem', fontSize: '0.78rem' }}>{p}</button>
                        ))
                      ) : hasMoreReqs ? (
                        <button onClick={() => setRequestsPage(p => p + 1)} className="btn btn-secondary" style={{ fontSize: '0.8rem', padding: '0.3rem 0.85rem' }}>Show More</button>
                      ) : null}
                    </div>
                  </div>
                )}
              </div>
            );
          })()
        )}
      </div>

      {/* SECTION: Active Volunteer Donors */}
      <div className="glass-panel" style={{ marginBottom: '1.75rem', border: '1px solid var(--color-success)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
          <h2 style={{ fontSize: '1.2rem', fontWeight: 800, display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <Droplet size={22} color="var(--color-success)" />
            Active Volunteer Donors
          </h2>
          <span className="badge badge-green">{displayedDonors.length} Active Volunteers</span>
        </div>

        {displayedDonors.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
            No volunteers are currently active and available.
          </div>
        ) : (
          (() => {
            const totalDonors = displayedDonors.length;
            const visibleDonors = displayedDonors.slice(0, donorsPage * PAGE_SIZE);
            const hasMoreDonors = totalDonors > visibleDonors.length;
            const totalDonorPages = Math.ceil(totalDonors / PAGE_SIZE);
            return (
              <div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
                  {visibleDonors.map(({ donor, activeDispatch }, index) => (
                    <div key={donor.id} style={{ background: 'var(--color-bg)', padding: '1rem', borderRadius: '8px', border: '1px solid var(--color-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.2rem' }}>
                          <span style={{ fontSize: '0.75rem', fontFamily: 'var(--font-mono)', color: 'var(--text-dim)' }}>#{(donorsPage - 1) * PAGE_SIZE + index + 1}</span>
                          <span style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-main)' }}>
                            {donor.blood_group} Volunteer (Reliability: {Math.round(donor.reliability_score * 100)}%)
                          </span>
                        </div>
                        {activeDispatch ? (
                          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                            Matched for Request {activeDispatch.request.id.slice(0, 8)} | Status: <b style={{ color: 'var(--color-success)' }}>{activeDispatch.allocation.status.replace('_', ' ')}</b>
                          </div>
                        ) : (
                          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Currently On Standby</div>
                        )}
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        {activeDispatch ? (
                          <div className="badge badge-green">Dispatched</div>
                        ) : (
                          <div className="badge" style={{ background: 'var(--color-surface)', color: 'var(--text-muted)' }}>Available</div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
                {(hasMoreDonors || totalDonors > PAGE_SIZE) && (
                  <div style={{ marginTop: '1rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' }}>
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Showing {visibleDonors.length} of {totalDonors} donors</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                      {totalDonors > 10 ? (
                        Array.from({ length: totalDonorPages }, (_, i) => i + 1).map((p) => (
                          <button key={p} onClick={() => setDonorsPage(p)} className={`btn ${donorsPage === p ? 'btn-primary' : 'btn-secondary'}`} style={{ minWidth: '32px', padding: '0.25rem 0.5rem', fontSize: '0.78rem' }}>{p}</button>
                        ))
                      ) : hasMoreDonors ? (
                        <button onClick={() => setDonorsPage(p => p + 1)} className="btn btn-secondary" style={{ fontSize: '0.8rem', padding: '0.3rem 0.85rem' }}>Show More</button>
                      ) : null}
                    </div>
                  </div>
                )}
              </div>
            );
          })()
        )}
      </div>

      {/* SECTION: AI Demand & Wastage Intelligence */}
      <div className="glass-panel" style={{ marginBottom: '1.75rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem', marginBottom: '1.25rem' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.35rem' }}>
              <Sparkles size={22} color="var(--color-info)" />
              <h2 style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--text-main)', margin: 0 }}>
                AI Demand & Wastage Intelligence
              </h2>
              <span className="badge badge-purple">
                {forecastSummary?.model_version || 'smartblood-ml-v1'}
              </span>
            </div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              Next-day predictive decision support across 4 frozen ML models (Demand Regressor, Spike Risk, Shortage Risk, Wastage Risk).
              <span style={{ color: 'var(--color-success)', fontWeight: 600, marginLeft: '0.5rem' }}>● Advisory Only (Zero Lock Impact)</span>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            {['ALL', 'PRBC', 'PLATELETS', 'FFP'].map((comp) => (
              <button
                key={comp}
                onClick={() => setComponentFilter(comp)}
                className={`btn ${componentFilter === comp ? 'btn-primary' : 'btn-secondary'}`}
                style={{ fontSize: '0.75rem', padding: '0.3rem 0.75rem' }}
              >
                {comp === 'ALL' ? 'All Components' : comp}
              </button>
            ))}
          </div>
        </div>

        {/* Prediction Summary KPI Strip */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.85rem', marginBottom: '1.25rem' }}>
          <div style={{ background: 'var(--color-bg)', padding: '0.85rem 1rem', borderRadius: '8px', border: '1px solid var(--border-subtle)' }}>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-dim)', fontWeight: 600 }}>NEXT-DAY PROJECTED DEMAND</div>
            <div style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--color-info)', marginTop: '0.2rem' }}>
              {Math.ceil(forecasts.reduce((sum, f) => sum + f.predicted_demand, 0))}{' '}
              <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Units</span>
            </div>
          </div>

          <div style={{ background: 'var(--color-bg)', padding: '0.85rem 1rem', borderRadius: '8px', border: '1px solid var(--border-subtle)' }}>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-dim)', fontWeight: 600 }}>CRITICAL SHORTAGE ALERTS</div>
            <div style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--crimson-500)', marginTop: '0.2rem' }}>
              {forecastSummary?.critical_shortage_count ?? forecasts.filter((f) => f.operational_status === 'Critical Shortage').length}
            </div>
          </div>

          <div style={{ background: 'var(--color-bg)', padding: '0.85rem 1rem', borderRadius: '8px', border: '1px solid var(--border-subtle)' }}>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-dim)', fontWeight: 600 }}>HIGH WASTAGE / EXPIRY RISKS</div>
            <div style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--amber-500)', marginTop: '0.2rem' }}>
              {forecastSummary?.high_wastage_risk_count ?? forecasts.filter((f) => f.operational_status === 'High Wastage Risk').length}
            </div>
          </div>

          <div style={{ background: 'var(--color-bg)', padding: '0.85rem 1rem', borderRadius: '8px', border: '1px solid var(--border-subtle)' }}>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-dim)', fontWeight: 600 }}>DEMAND SPIKE RISKS (&ge;10)</div>
            <div style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--amber-500)', marginTop: '0.2rem' }}>
              {forecastSummary?.demand_spike_risk_count ?? forecasts.filter((f) => f.is_spike_predicted).length}
            </div>
          </div>
        </div>

        {/* Forecast Table */}
        {forecasts.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)', background: 'var(--color-bg)', borderRadius: '8px', border: '1px dashed var(--border-subtle)' }}>
            <RefreshCw size={24} className="spin" style={{ marginBottom: '0.5rem', color: 'var(--text-dim)' }} />
            <div>Generating ML demand forecasts and coverage projections...</div>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid var(--border-subtle)', textAlign: 'left', color: 'var(--text-muted)' }}>
                  <th style={{ padding: '0.65rem' }}>SERIES</th>
                  <th style={{ padding: '0.65rem' }}>ON-SHELF READY</th>
                  <th style={{ padding: '0.65rem' }}>EST. DEMAND (D+1)</th>
                  <th style={{ padding: '0.65rem' }}>DAYS COVERAGE</th>
                  <th style={{ padding: '0.65rem' }}>RISK SCORES</th>
                  <th style={{ padding: '0.65rem' }}>OPERATIONAL STATUS</th>
                  <th style={{ padding: '0.65rem' }}>AI ACTION ADVISORY</th>
                </tr>
              </thead>
              <tbody>
                {forecasts
                  .filter((f) => componentFilter === 'ALL' || f.component_type === componentFilter)
                  .map((f) => {
                    const isCritical = f.operational_status === 'Critical Shortage';
                    const isHighShortage = f.operational_status === 'High Shortage Risk';
                    const isWastage = f.operational_status === 'High Wastage Risk';
                    const isSpike = f.operational_status === 'Demand Spike Risk';

                    const statusBadgeClass = isCritical
                      ? 'badge-red'
                      : isHighShortage
                      ? 'badge-amber'
                      : isWastage
                      ? 'badge-purple'
                      : isSpike
                      ? 'badge-amber'
                      : f.operational_status === 'Monitor Inventory'
                      ? 'badge-cyan'
                      : 'badge-green';

                    return (
                      <tr
                        key={`${f.blood_group}-${f.component_type}`}
                        style={{
                          borderBottom: '1px solid var(--border-subtle)',
                          background: isCritical
                            ? 'rgba(239, 68, 68, 0.04)'
                            : isWastage
                            ? 'rgba(126, 34, 206, 0.04)'
                            : 'transparent',
                        }}
                      >
                        <td style={{ padding: '0.65rem' }}>
                          <span style={{ fontWeight: 800, color: 'var(--text-main)', fontSize: '0.95rem' }}>
                            {f.blood_group}
                          </span>{' '}
                          <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>({f.component_type})</span>
                        </td>
                        <td style={{ padding: '0.65rem', fontWeight: 700 }}>
                          <span style={{ color: f.closing_inventory === 0 ? 'var(--crimson-500)' : 'var(--text-main)' }}>
                            {Math.round(f.closing_inventory)}
                          </span>{' '}
                          <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>units</span>
                        </td>
                        <td style={{ padding: '0.65rem' }}>
                          <div style={{ fontWeight: 700, color: 'var(--text-main)' }}>
                            {Math.ceil(f.predicted_demand)}{' '}
                            <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>units</span>
                          </div>
                          {f.is_spike_predicted && (
                            <div style={{ fontSize: '0.7rem', color: 'var(--amber-500)', display: 'flex', alignItems: 'center', gap: '0.2rem' }}>
                              <TrendingUp size={11} /> Surge Headroom: {Math.ceil(f.spike_headroom_demand)}u
                            </div>
                          )}
                        </td>
                        <td style={{ padding: '0.65rem' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <div style={{
                              width: '45px',
                              height: '6px',
                              background: 'var(--border-subtle)',
                              borderRadius: '3px',
                              overflow: 'hidden',
                            }}>
                              <div style={{
                                width: `${Math.min((f.predicted_coverage_days / 5) * 100, 100)}%`,
                                height: '100%',
                                background: f.predicted_coverage_days < 2 ? 'var(--crimson-500)' : f.predicted_coverage_days < 5 ? 'var(--amber-500)' : 'var(--emerald-500)',
                              }} />
                            </div>
                            <span style={{
                              fontSize: '0.78rem',
                              fontWeight: 700,
                              color: f.predicted_coverage_days < 2 ? 'var(--crimson-500)' : f.predicted_coverage_days < 5 ? 'var(--amber-500)' : 'var(--emerald-500)',
                            }}>
                              {f.predicted_coverage_days >= 99 ? '> 99d' : `${f.predicted_coverage_days.toFixed(1)}d`}
                            </span>
                          </div>
                        </td>
                        <td style={{ padding: '0.65rem', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                          <div>Spike: <b>{Math.round(f.spike_risk_score * 100)}%</b></div>
                          <div>Wastage: <b style={{ color: f.wastage_risk_score >= 0.75 ? 'var(--crimson-500)' : 'inherit' }}>{Math.round(f.wastage_risk_score * 100)}%</b></div>
                        </td>
                        <td style={{ padding: '0.65rem' }}>
                          <span className={`badge ${statusBadgeClass}`} style={{ fontSize: '0.72rem' }}>
                            {f.operational_status}
                          </span>
                        </td>
                        <td style={{ padding: '0.65rem', fontSize: '0.78rem', color: 'var(--text-main)', maxWidth: '280px' }}>
                          {f.recommended_action}
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Inventory Stock Table */}
      <div className="glass-panel">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
          <h2 style={{ fontSize: '1.2rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Droplet size={20} color="var(--crimson-500)" />
            All Blood Bags in Cold Storage
          </h2>
          <button onClick={fetchInventoryAndOrders} className="btn btn-secondary" style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem' }}>
            <RefreshCw size={14} className={loading ? 'spin' : ''} />
            Refresh
          </button>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-subtle)', textAlign: 'left', color: 'var(--text-muted)' }}>
                <th style={{ padding: '0.75rem' }}>#</th>
                <th style={{ padding: '0.75rem' }}>BAG CODE</th>
                <th style={{ padding: '0.75rem' }}>BLOOD GROUP</th>
                <th style={{ padding: '0.75rem' }}>TYPE</th>
                <th style={{ padding: '0.75rem' }}>VOLUME</th>
                <th style={{ padding: '0.75rem' }}>EXPIRY DATE</th>
                <th style={{ padding: '0.75rem' }}>STATUS</th>
                <th style={{ padding: '0.75rem', textAlign: 'right' }}>TEST BAG DAMAGE / ACTIONS</th>
              </tr>
            </thead>
            <tbody>
              {(() => {
                const totalUnits = units.length;
                const visibleUnits = unitsPage === -1 ? units : units.slice(0, unitsPage * PAGE_SIZE);
                const hasMoreUnits = unitsPage !== -1 && totalUnits > visibleUnits.length;
                const totalUnitPages = Math.ceil(totalUnits / PAGE_SIZE);
                return (
                  <>
                    {visibleUnits.map((unit, index) => {
                      const isLocked = unit.status === 'LOCKED_RESERVE';
                      return (
                        <tr key={unit.id} id={`unit-row-${unit.batch_number.toLowerCase()}`} style={{ borderBottom: '1px solid var(--color-border)', background: isLocked ? 'rgba(217, 119, 6, 0.06)' : 'transparent' }}>
                          <td style={{ padding: '0.75rem', fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--text-dim)', fontSize: '0.78rem' }}>#{(unitsPage === -1 ? 0 : (unitsPage - 1) * PAGE_SIZE) + index + 1}</td>
                          <td style={{ padding: '0.75rem', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{unit.batch_number}</td>
                          <td style={{ padding: '0.75rem', fontWeight: 700, color: 'var(--text-main)' }}>{unit.blood_group}</td>
                          <td style={{ padding: '0.75rem', color: 'var(--text-muted)' }}>{unit.component_type === 'PRBC' ? 'Red Blood Cells' : unit.component_type}</td>
                          <td style={{ padding: '0.75rem', color: 'var(--text-muted)' }}>{unit.volume_ml} mL</td>
                          <td style={{ padding: '0.75rem', color: 'var(--text-muted)' }}>{new Date(unit.expiry_date).toLocaleDateString()}</td>
                          <td style={{ padding: '0.75rem' }}>
                            <span className={`badge ${
                              unit.status === 'AVAILABLE' ? 'badge-green' :
                              unit.status === 'LOCKED_RESERVE' ? 'badge-amber' :
                              unit.status === 'DISPATCHED' ? 'badge-cyan' : 'badge-red'
                            }`}>
                              {unit.status === 'AVAILABLE' ? 'Ready' : unit.status === 'LOCKED_RESERVE' ? 'Reserved' : unit.status === 'DISPATCHED' ? 'Dispatched' : unit.status === 'EXPIRED' ? 'Expired' : 'Damaged'}
                            </span>
                          </td>
                          <td style={{ padding: '0.75rem', textAlign: 'right' }}>
                            {unit.status !== 'QUARANTINED' && unit.status !== 'EXPIRED' && (
                              <button id={`btn-quarantine-${unit.batch_number.toLowerCase()}`} onClick={() => handleStatusChange(unit.id, 'QUARANTINED')} className="btn btn-danger-outline" style={{ fontSize: '0.75rem', padding: '0.35rem 0.7rem' }} title="Simulate bag damage">
                                <AlertTriangle size={13} /> Mark Damaged
                              </button>
                            )}
                            {unit.status === 'QUARANTINED' && (
                              <button onClick={() => handleStatusChange(unit.id, 'AVAILABLE')} className="btn btn-secondary" style={{ fontSize: '0.75rem', padding: '0.35rem 0.7rem' }}>Restore to Ready</button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                    {(hasMoreUnits || totalUnits > PAGE_SIZE) && (
                      <tr>
                        <td colSpan={8} style={{ padding: '0.85rem', textAlign: 'center' }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' }}>
                            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Showing {visibleUnits.length} of {totalUnits} bags</span>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                              {totalUnits > 10 ? (
                                <>
                                  {Array.from({ length: totalUnitPages }, (_, i) => i + 1).map((p) => (
                                    <button key={p} onClick={() => setUnitsPage(p)} className={`btn ${unitsPage === p ? 'btn-primary' : 'btn-secondary'}`} style={{ minWidth: '32px', padding: '0.25rem 0.5rem', fontSize: '0.78rem' }}>{p}</button>
                                  ))}
                                  <button onClick={() => setUnitsPage(-1)} className={`btn ${unitsPage === -1 ? 'btn-primary' : 'btn-secondary'}`} style={{ padding: '0.25rem 0.6rem', fontSize: '0.78rem' }}>All</button>
                                </>
                              ) : hasMoreUnits ? (
                                <button onClick={() => setUnitsPage(p => p + 1)} className="btn btn-secondary" style={{ fontSize: '0.8rem', padding: '0.3rem 0.85rem' }}>Show More</button>
                              ) : null}
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                );
              })()}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add Unit Modal */}
      {showAddModal && (
        <div style={{
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
        }}>
          <div className="glass-panel" style={{ maxWidth: '480px', width: '100%' }}>
            <h3 style={{ fontSize: '1.15rem', fontWeight: 700, marginBottom: '1rem' }}>Log New Verified Blood Unit</h3>
            <form onSubmit={handleAddUnit} style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
              <div>
                <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Batch Number (optional)</label>
                <input
                  type="text"
                  placeholder="e.g. BB-005"
                  className="input-field"
                  value={newBatch}
                  onChange={(e) => setNewBatch(e.target.value)}
                />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <div>
                  <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Blood Group</label>
                  <select
                    className="select-field"
                    value={newBloodGroup}
                    onChange={(e) => setNewBloodGroup(e.target.value)}
                  >
                    {['O-', 'O+', 'A-', 'A+', 'B-', 'B+', 'AB-', 'AB+'].map((bg) => (
                      <option key={bg} value={bg}>{bg}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Component Type</label>
                  <select
                    className="select-field"
                    value={newComponent}
                    onChange={(e) => setNewComponent(e.target.value as BloodComponentType)}
                  >
                    <option value="PRBC">PRBC</option>
                    <option value="WHOLE_BLOOD">Whole Blood</option>
                    <option value="PLATELETS">Platelets</option>
                    <option value="FFP">FFP</option>
                    <option value="CRYOPRECIPITATE">Cryoprecipitate</option>
                  </select>
                </div>
              </div>
              <div>
                <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Shelf Life (Days)</label>
                <input
                  type="number"
                  min="1"
                  max="365"
                  className="input-field"
                  value={newExpiryDays}
                  onChange={(e) => setNewExpiryDays(Number(e.target.value))}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.6rem', marginTop: '0.5rem' }}>
                <button type="button" onClick={() => setShowAddModal(false)} className="btn btn-secondary">
                  Cancel
                </button>
                <button type="submit" className="btn btn-cyan">
                  Register Unit
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
