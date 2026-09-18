import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useWebSocket } from '../context/WebSocketContext';
import { InventoryUnit, UnitStatus, BloodComponentType } from '../types';
import { Droplet, ShieldAlert, Plus, RefreshCw, AlertTriangle } from 'lucide-react';

export const BloodBankDashboard: React.FC = () => {
  const { token } = useAuth();
  const { lastEvent } = useWebSocket();

  const [units, setUnits] = useState<InventoryUnit[]>([]);
  const [loading, setLoading] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);

  // New unit form
  const [newBatch, setNewBatch] = useState('');
  const [newBloodGroup, setNewBloodGroup] = useState('O-');
  const [newComponent, setNewComponent] = useState<BloodComponentType>('PRBC');
  const [newVolume, setNewVolume] = useState(300);
  const [newExpiryDays, setNewExpiryDays] = useState(42);

  const fetchInventory = async () => {
    setLoading(true);
    try {
      const res = await fetch('http://localhost:8000/api/v1/inventory', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setUnits(data);
      }
    } catch (err) {
      console.error('Failed to fetch inventory:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchInventory();
  }, [token]);

  useEffect(() => {
    if (
      lastEvent &&
      [
        'INVENTORY_UNIT_ADDED',
        'INVENTORY_UNIT_STATUS_CHANGED',
        'INVENTORY_LOCKED',
        'SYSTEM_RESET',
      ].includes(lastEvent.type)
    ) {
      fetchInventory();
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
      await fetchInventory();
    } catch (err) {
      alert('Error changing unit status: ' + err);
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
      await fetchInventory();
    } catch (err) {
      alert('Error registering blood unit: ' + err);
    }
  };

  const availableCount = units.filter((u) => u.status === 'AVAILABLE').length;
  const lockedCount = units.filter((u) => u.status === 'LOCKED_RESERVE').length;
  const quarantinedCount = units.filter((u) => u.status === 'QUARANTINED').length;

  return (
    <div>
      {/* Top Stat Row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
        <div className="glass-panel">
          <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)', fontWeight: 600 }}>AVAILABLE ON-SHELF</div>
          <div style={{ fontSize: '1.8rem', fontWeight: 800, color: 'var(--emerald-400)', marginTop: '0.25rem' }}>
            {availableCount} <span style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>Units</span>
          </div>
        </div>

        <div className="glass-panel">
          <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)', fontWeight: 600 }}>LOCKED IN RESERVE (FEFO)</div>
          <div style={{ fontSize: '1.8rem', fontWeight: 800, color: 'var(--amber-400)', marginTop: '0.25rem' }}>
            {lockedCount} <span style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>Units</span>
          </div>
        </div>

        <div className="glass-panel">
          <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)', fontWeight: 600 }}>QUARANTINED / EXPIRED</div>
          <div style={{ fontSize: '1.8rem', fontWeight: 800, color: 'var(--crimson-500)', marginTop: '0.25rem' }}>
            {quarantinedCount} <span style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>Units</span>
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
            Log New Verified Unit
          </button>
        </div>
      </div>

      {/* Inventory Stock Table */}
      <div className="glass-panel">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
          <h2 style={{ fontSize: '1.2rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Droplet size={20} color="var(--crimson-500)" />
            Cold-Chain Inventory & First-Expiring-First-Out (FEFO) Reserve
          </h2>
          <button onClick={fetchInventory} className="btn btn-secondary" style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem' }}>
            <RefreshCw size={14} className={loading ? 'spin' : ''} />
            Refresh
          </button>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-subtle)', textAlign: 'left', color: 'var(--text-muted)' }}>
                <th style={{ padding: '0.75rem' }}>BATCH NUMBER</th>
                <th style={{ padding: '0.75rem' }}>BLOOD GROUP</th>
                <th style={{ padding: '0.75rem' }}>COMPONENT</th>
                <th style={{ padding: '0.75rem' }}>VOLUME</th>
                <th style={{ padding: '0.75rem' }}>EXPIRY DATE</th>
                <th style={{ padding: '0.75rem' }}>CURRENT STATUS</th>
                <th style={{ padding: '0.75rem', textAlign: 'right' }}>SIMULATE FAILURE / ACTIONS</th>
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
                    <td style={{ padding: '0.75rem', color: 'var(--text-muted)' }}>{unit.component_type}</td>
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
                          : 'badge-red'
                      }`}>
                        {unit.status.replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td style={{ padding: '0.75rem', textAlign: 'right' }}>
                      {unit.status !== 'QUARANTINED' && (
                        <button
                          id={`btn-quarantine-${unit.batch_number.toLowerCase()}`}
                          onClick={() => handleStatusChange(unit.id, 'QUARANTINED')}
                          className="btn btn-danger-outline"
                          style={{ fontSize: '0.75rem', padding: '0.35rem 0.7rem' }}
                          title="Simulate contamination/quarantine to trigger automatic re-planning"
                        >
                          <AlertTriangle size={13} />
                          Quarantine Unit
                        </button>
                      )}
                      {unit.status === 'QUARANTINED' && (
                        <button
                          onClick={() => handleStatusChange(unit.id, 'AVAILABLE')}
                          className="btn btn-secondary"
                          style={{ fontSize: '0.75rem', padding: '0.35rem 0.7rem' }}
                        >
                          Restore to Available
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
