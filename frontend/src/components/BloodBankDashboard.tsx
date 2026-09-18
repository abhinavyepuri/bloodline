import React, { useState, useEffect, useCallback } from 'react';
import { useWebSocket } from '../context/WebSocketContext';
import { api } from '../lib/api';
import {
  InventoryUnit,
  UnitStatus,
  BloodComponentType,
  BloodRequest,
  DonorPublic,
} from '../types';
import { Droplet, Plus, RefreshCw, AlertTriangle, Building2, Truck, CheckCircle2, Clock, Activity } from 'lucide-react';

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
  const [loading, setLoading] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [dispatchingId, setDispatchingId] = useState<string | null>(null);

  // New unit form
  const [newBatch, setNewBatch] = useState('');
  const [newBloodGroup, setNewBloodGroup] = useState('O-');
  const [newComponent, setNewComponent] = useState<BloodComponentType>('PRBC');
  const [newExpiryDays, setNewExpiryDays] = useState(42);

  const fetchInventoryAndOrders = useCallback(async () => {
    setLoading(true);
    try {
      const [invData, ordersData, reqData, donorsData] = await Promise.all([
        api.get<InventoryUnit[]>('/inventory'),
        api.get<HospitalOrder[]>('/inventory/orders'),
        api.get<BloodRequest[]>('/requests'),
        api.get<DonorPublic[]>('/donors'),
      ]);
      setUnits(invData);
      setOrders(ordersData);
      setActiveRequests(reqData);
      setActiveDonors(donorsData.filter((d) => d.is_available));
    } catch (err) {
      console.error('Failed to fetch inventory or orders:', err);
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
              Switch to <b>Hospital Desk</b> and send an emergency blood request to see it arrive here in real time!
            </p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {orders.map((order) => {
              const hasReservedUnits = order.allocated_units.some((u) => u.unit_status === 'LOCKED_RESERVE');
              // `[].every()` is true, so an order with no allocated units would claim
              // to be fully dispatched. Require at least one unit.
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
                      <span style={{ fontSize: '1.15rem', fontWeight: 800, color: 'var(--text-main)' }}>
                          {order.hospital_name}
                        </span>
                        <span className={`badge ${allDispatched ? 'badge-green' : 'badge-amber'}`}>
                          {allDispatched ? 'DISPATCHED' : order.status}
                        </span>
                      </div>
                      <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                        Patient Token: <code>{order.patient_id_token}</code> | Triage: <b>{order.triage_level}</b> | Urgency: <b>{order.calculated_urgency_score}/100</b>
                      </div>
                    </div>

                    <div style={{ textAlign: 'right' }}>
                      <span style={{ fontSize: '1.2rem', fontWeight: 800, color: 'var(--crimson-500)' }}>
                        {order.units_requested}x {order.required_blood_group} ({order.component_type})
                      </span>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>Requested Quantity</div>
                    </div>
                  </div>

                  {/* Matched Units in this blood bank */}
                  <div style={{ background: 'var(--color-surface)', padding: '0.75rem', borderRadius: '8px', border: '1px solid var(--border-subtle)' }}>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)', fontWeight: 700, marginBottom: '0.4rem', textTransform: 'uppercase' }}>
                      Blood Bags Allocated From Our Storage:
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                      {order.allocated_units.map((u) => (
                        <div
                          key={u.unit_id}
                          style={{
                            background: 'var(--color-bg)',
                            padding: '0.4rem 0.75rem',
                            borderRadius: '6px',
                            border: '1px solid rgba(255, 255, 255, 0.1)',
                            fontSize: '0.8rem',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.5rem',
                          }}
                        >
                          <Droplet size={13} color="var(--crimson-500)" />
                          <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700 }}>Bag {u.batch_number}</span>
                          <span>({u.blood_group})</span>
                          <span className={`badge ${u.unit_status === 'LOCKED_RESERVE' ? 'badge-amber' : u.unit_status === 'DISPATCHED' ? 'badge-green' : 'badge-red'}`} style={{ fontSize: '0.65rem' }}>
                            {u.unit_status === 'LOCKED_RESERVE' ? 'Reserved' : u.unit_status === 'DISPATCHED' ? 'Dispatched' : 'Damaged'}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Dispatch Action */}
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', alignItems: 'center' }}>
                    {hasReservedUnits && (
                      <button
                        id={`btn-dispatch-${order.request_id.slice(0, 8)}`}
                        onClick={() => handleDispatchOrder(order.request_id)}
                        disabled={dispatchingId === order.request_id}
                        className="btn btn-cyan"
                        style={{ fontSize: '0.85rem', padding: '0.45rem 1rem' }}
                      >
                        <Truck size={15} />
                        {dispatchingId === order.request_id ? 'Handing Over...' : 'Hand to Ambulance (Dispatch)'}
                      </button>
                    )}
                    {allDispatched && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: 'var(--emerald-400)', fontSize: '0.85rem', fontWeight: 600 }}>
                        <CheckCircle2 size={16} />
                        All blood bags handed to courier and on the way to hospital.
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
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
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
            {activeRequests.map((req) => (
              <div
                key={req.id}
                style={{
                  background: 'var(--color-bg)',
                  padding: '1rem',
                  borderRadius: '8px',
                  border: '1px solid var(--border-subtle)',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: '0.5rem',
                }}
              >
                <div>
                  <div style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-main)', marginBottom: '0.2rem' }}>
                    {req.hospital_name || 'Hospital'} — {req.units_requested}x {req.required_blood_group} ({req.component_type === 'PRBC' ? 'Red Blood Cells' : req.component_type})
                  </div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                    Urgency: <b>{req.calculated_urgency_score?.toFixed(0) ?? 0}/100</b> | Triage: <b>{req.triage_level?.replace(/_/g, ' ')}</b> | Covered: <b>{req.units_covered ?? 0} of {req.units_requested}</b>
                  </div>
                </div>
                <div>
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
              </div>
            ))}
          </div>
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
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
            {displayedDonors.map(({ donor, activeDispatch }) => (
              <div key={donor.id} style={{ background: 'var(--color-bg)', padding: '1rem', borderRadius: '8px', border: '1px solid var(--color-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-main)', marginBottom: '0.2rem' }}>
                    {donor.blood_group} Volunteer (Reliability: {Math.round(donor.reliability_score * 100)}%)
                  </div>
                  {activeDispatch ? (
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                      Matched for Request {activeDispatch.request.id.slice(0, 8)} | Status: <b style={{ color: 'var(--color-success)' }}>{activeDispatch.allocation.status.replace('_', ' ')}</b>
                    </div>
                  ) : (
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                      Currently On Standby
                    </div>
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
              {units.map((unit) => {
                const isLocked = unit.status === 'LOCKED_RESERVE';

                return (
                  <tr
                    key={unit.id}
                    id={`unit-row-${unit.batch_number.toLowerCase()}`}
                    style={{
                      borderBottom: '1px solid var(--color-border)',
                      background: isLocked ? 'rgba(217, 119, 6, 0.06)' : 'transparent',
                    }}
                  >
                    <td style={{ padding: '0.75rem', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
                    {unit.batch_number}
                  </td>
                    <td style={{ padding: '0.75rem', fontWeight: 700, color: 'var(--text-main)' }}>{unit.blood_group}</td>
                    <td style={{ padding: '0.75rem', color: 'var(--text-muted)' }}>{unit.component_type === 'PRBC' ? 'Red Blood Cells' : unit.component_type}</td>
                    <td style={{ padding: '0.75rem', color: 'var(--text-muted)' }}>{unit.volume_ml} mL</td>
                    <td style={{ padding: '0.75rem', color: 'var(--text-muted)' }}>
                      {new Date(unit.expiry_date).toLocaleDateString()}
                    </td>
                    <td style={{ padding: '0.75rem' }}>
                      <span className={`badge ${
                        unit.status === 'AVAILABLE'
                          ? 'badge-green'
                          : unit.status === 'LOCKED_RESERVE'
                          ? 'badge-amber'
                          : unit.status === 'DISPATCHED'
                          ? 'badge-cyan'
                          : 'badge-red'
                      }`}>
                        {unit.status === 'AVAILABLE'
                          ? 'Ready'
                          : unit.status === 'LOCKED_RESERVE'
                          ? 'Reserved'
                          : unit.status === 'DISPATCHED'
                          ? 'Dispatched'
                          : unit.status === 'EXPIRED'
                          ? 'Expired'
                          : 'Damaged'}
                      </span>
                    </td>
                    <td style={{ padding: '0.75rem', textAlign: 'right' }}>
                      {unit.status !== 'QUARANTINED' && unit.status !== 'EXPIRED' && (
                        <button
                          id={`btn-quarantine-${unit.batch_number.toLowerCase()}`}
                          onClick={() => handleStatusChange(unit.id, 'QUARANTINED')}
                          className="btn btn-danger-outline"
                          style={{ fontSize: '0.75rem', padding: '0.35rem 0.7rem' }}
                          title="Simulate bag damage to see system find replacement"
                        >
                          <AlertTriangle size={13} />
                          Mark Damaged
                        </button>
                      )}
                      {unit.status === 'QUARANTINED' && (
                        <button
                          onClick={() => handleStatusChange(unit.id, 'AVAILABLE')}
                          className="btn btn-secondary"
                          style={{ fontSize: '0.75rem', padding: '0.35rem 0.7rem' }}
                        >
                          Restore to Ready
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
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
