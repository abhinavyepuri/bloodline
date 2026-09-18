import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useWebSocket } from '../context/WebSocketContext';
import { InventoryUnit, UnitStatus, BloodComponentType } from '../types';
import { Droplet, Plus, RefreshCw, AlertTriangle, Building2, Truck, CheckCircle2, Clock } from 'lucide-react';

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

export const BloodBankDashboard: React.FC = () => {
  const { token } = useAuth();
  const { lastEvent } = useWebSocket();

  const [units, setUnits] = useState<InventoryUnit[]>([]);
  const [orders, setOrders] = useState<HospitalOrder[]>([]);
  const [loading, setLoading] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [dispatchingId, setDispatchingId] = useState<string | null>(null);

  // New unit form
  const [newBatch, setNewBatch] = useState('');
  const [newBloodGroup, setNewBloodGroup] = useState('O-');
  const [newComponent, setNewComponent] = useState<BloodComponentType>('PRBC');
  const [newVolume] = useState(300);
  const [newExpiryDays, setNewExpiryDays] = useState(42);

  const fetchInventoryAndOrders = async () => {
    setLoading(true);
    try {
      const [invRes, ordersRes] = await Promise.all([
        fetch('http://localhost:8000/api/v1/inventory', {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch('http://localhost:8000/api/v1/inventory/orders', {
          headers: { Authorization: `Bearer ${token}` },
        }),
      ]);

      if (invRes.ok) {
        const data = await invRes.json();
        setUnits(data);
      }
      if (ordersRes.ok) {
        const ordersData = await ordersRes.json();
        setOrders(ordersData);
      }
    } catch (err) {
      console.error('Failed to fetch inventory or orders:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchInventoryAndOrders();
  }, [token]);

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
  }, [lastEvent]);

  const handleStatusChange = async (unitId: string, newStatus: UnitStatus) => {
    try {
      const res = await fetch(`http://localhost:8000/api/v1/inventory/units/${unitId}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) throw new Error('Failed to update status');
      await fetchInventoryAndOrders();
    } catch (err) {
      alert('Error changing unit status: ' + err);
    }
  };

  const handleDispatchOrder = async (requestId: string) => {
    setDispatchingId(requestId);
    try {
      const res = await fetch(`http://localhost:8000/api/v1/inventory/orders/${requestId}/dispatch`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Failed to dispatch order');
      await fetchInventoryAndOrders();
    } catch (err) {
      alert('Error dispatching blood: ' + err);
    } finally {
      setDispatchingId(null);
    }
  };

  const handleAddUnit = async (e: React.FormEvent) => {
    e.preventDefault();
    const now = new Date();
    const expiry = new Date(Date.now() + newExpiryDays * 24 * 3600 * 1000);

    try {
      const res = await fetch('http://localhost:8000/api/v1/inventory/units', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          batch_number: newBatch || `BB-${Math.floor(1000 + Math.random() * 9000)}`,
          blood_group: newBloodGroup,
          component_type: newComponent,
          volume_ml: newVolume,
          collection_date: now.toISOString(),
          expiry_date: expiry.toISOString(),
        }),
      });
      if (!res.ok) throw new Error('Unit creation failed');
      setShowAddModal(false);
      setNewBatch('');
      await fetchInventoryAndOrders();
    } catch (err) {
      alert('Error registering blood unit: ' + err);
    }
  };

  const availableCount = units.filter((u) => u.status === 'AVAILABLE').length;
  const lockedCount = units.filter((u) => u.status === 'LOCKED_RESERVE').length;
  const quarantinedCount = units.filter((u) => u.status === 'QUARANTINED').length;

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
        color: '#a5f3fc',
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
          <div style={{ textAlign: 'center', padding: '2.5rem', color: 'var(--text-muted)', background: 'rgba(10, 13, 20, 0.5)', borderRadius: '8px' }}>
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
              const allDispatched = order.allocated_units.every((u) => u.unit_status === 'DISPATCHED');

              return (
                <div
                  key={order.request_id}
                  id={`order-card-${order.request_id.slice(0, 8)}`}
                  style={{
                    background: 'rgba(10, 13, 20, 0.85)',
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
                        <span style={{ fontSize: '1.15rem', fontWeight: 800, color: 'white' }}>
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
                  <div style={{ background: 'rgba(255, 255, 255, 0.03)', padding: '0.75rem', borderRadius: '8px', border: '1px solid var(--border-subtle)' }}>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)', fontWeight: 700, marginBottom: '0.4rem', textTransform: 'uppercase' }}>
                      Blood Bags Allocated From Our Storage:
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                      {order.allocated_units.map((u) => (
                        <div
                          key={u.unit_id}
                          style={{
                            background: 'rgba(10, 13, 20, 0.8)',
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
                const isBB001 = unit.batch_number === 'BB-001';
                const isLocked = unit.status === 'LOCKED_RESERVE';

                return (
                  <tr
                    key={unit.id}
                    id={`unit-row-${unit.batch_number.toLowerCase()}`}
                    style={{
                      borderBottom: '1px solid rgba(255, 255, 255, 0.04)',
                      background: isBB001 && isLocked ? 'rgba(239, 68, 68, 0.08)' : 'transparent',
                    }}
                  >
                    <td style={{ padding: '0.75rem', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
                      {unit.batch_number}
                      {isBB001 && (
                        <span style={{ marginLeft: '0.5rem', fontSize: '0.7rem', color: 'var(--amber-400)', fontWeight: 700 }}>
                          [DEMO TARGET]
                        </span>
                      )}
                    </td>
                    <td style={{ padding: '0.75rem', fontWeight: 700, color: 'white' }}>{unit.blood_group}</td>
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
                          : 'Damaged'}
                      </span>
                    </td>
                    <td style={{ padding: '0.75rem', textAlign: 'right' }}>
                      {unit.status !== 'QUARANTINED' && (
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
          background: 'rgba(0, 0, 0, 0.75)',
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
