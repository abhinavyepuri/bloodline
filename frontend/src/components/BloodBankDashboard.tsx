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
import {
  Droplet,
  Plus,
  RefreshCw,
  AlertTriangle,
  Building2,
  Truck,
  CheckCircle2,
  Clock,
  Activity,
  Package,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  ArrowUpDown,
  Search,
} from 'lucide-react';

interface HospitalOrder {
  request_id: string;
  hospital_name: string;
  hospital_address: string;
  patient_id_token: string;
  required_blood_group: string;
  component_type: string;
  units_requested: number;
  units_covered?: number;
  units_shortfall?: number;
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
  volunteer_donors?: {
    donor_id: string;
    blood_group: string;
    allocation_status: string;
    allocation_id: string;
    distance_km?: number;
    estimated_transit_minutes?: number;
  }[];
  available_compatible_units?: {
    unit_id: string;
    batch_number: string;
    blood_group: string;
    expiry_date: string;
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
  const [error, setError] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [dispatchingId, setDispatchingId] = useState<string | null>(null);
  const [acceptingId, setAcceptingId] = useState<string | null>(null);

  // Blood Bank Desk sorting, filter, and expansion state
  type DeskSortKey = 'urgency' | 'hospital' | 'blood_group' | 'units' | 'shortfall' | 'status' | 'created_at';
  const [deskSortKey, setDeskSortKey] = useState<DeskSortKey>('urgency');
  const [deskSortAsc, setDeskSortAsc] = useState<boolean>(false);
  const [expandedOrders, setExpandedOrders] = useState<Record<string, boolean>>({});
  const [deskFilter, setDeskFilter] = useState<'ALL' | 'ACTION_REQUIRED' | 'DISPATCHED'>('ALL');
  const [deskSearch, setDeskSearch] = useState('');

  // Inventory sorting state
  type InvSortKey = 'batch' | 'group' | 'type' | 'volume' | 'expiry' | 'status';
  const [invSortKey, setInvSortKey] = useState<InvSortKey>('expiry');
  const [invSortAsc, setInvSortAsc] = useState<boolean>(true);

  // New unit form
  const [newBatch, setNewBatch] = useState('');
  const [newBloodGroup, setNewBloodGroup] = useState('O-');
  const [newComponent, setNewComponent] = useState<BloodComponentType>('PRBC');
  const [newExpiryDays, setNewExpiryDays] = useState(42);
  const [newPacketsCount, setNewPacketsCount] = useState<number>(1);
  const [registering, setRegistering] = useState<boolean>(false);

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
      setError(null);
    } catch (err) {
      console.error('Failed to fetch inventory or orders:', err);
      setError(err instanceof Error ? err.message : 'Could not load blood-bank data.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchInventoryAndOrders();
    // Automated polling every 3 seconds ensures requests appear in real time on the desk
    const interval = setInterval(() => {
      fetchInventoryAndOrders();
    }, 3000);
    return () => clearInterval(interval);
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
        'BLOOD_BANK_ACCEPTED',
        'BLOOD_BANK_DISPATCHED',
        'ALLOCATION_CONFIRMED',
        'ALLOCATION_COMPLETED',
        'REQUEST_FULFILLED',
        'REQUEST_CANCELLED',
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
      setError('Error changing unit status: ' + (err instanceof Error ? err.message : String(err)));
    }
  };

  const handleAcceptOrder = async (requestId: string, autoDispatch: boolean = false) => {
    setAcceptingId(requestId);
    setError(null);
    try {
      await api.post(`/inventory/orders/${requestId}/accept`, { auto_dispatch: autoDispatch });
      await fetchInventoryAndOrders();
    } catch (err) {
      setError('Error accepting order: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setAcceptingId(null);
    }
  };

  const handleDispatchOrder = async (requestId: string) => {
    setDispatchingId(requestId);
    try {
      await api.post(`/inventory/orders/${requestId}/dispatch`);
      await fetchInventoryAndOrders();
    } catch (err) {
      setError('Error dispatching blood: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setDispatchingId(null);
    }
  };

  const handleAddUnit = async (e: React.FormEvent) => {
    e.preventDefault();
    const now = new Date();
    const expiry = new Date(Date.now() + newExpiryDays * 24 * 3600 * 1000);
    const count = Math.max(1, Math.min(100, Number(newPacketsCount) || 1));
    const baseBatch = newBatch.trim() || `BB-${Math.floor(1000 + Math.random() * 9000)}`;

    setRegistering(true);
    setError(null);
    try {
      await api.post('/inventory/units', {
        batch_number: baseBatch,
        blood_group: newBloodGroup,
        component_type: newComponent,
        volume_ml: DEFAULT_UNIT_VOLUME_ML,
        collection_date: now.toISOString(),
        expiry_date: expiry.toISOString(),
        quantity: count,
      });
      setShowAddModal(false);
      setNewBatch('');
      setNewPacketsCount(1);
      await fetchInventoryAndOrders();
    } catch (err) {
      setError('Error registering blood packet(s): ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setRegistering(false);
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

  const isOrderExpanded = (requestId: string) => {
    if (requestId in expandedOrders) {
      return expandedOrders[requestId];
    }
    // Default open so all order details, allocations, and dispatch options are readily visible
    return true;
  };

  const handleToggleExpand = (requestId: string) => {
    const current = isOrderExpanded(requestId);
    setExpandedOrders((prev) => ({
      ...prev,
      [requestId]: !current,
    }));
  };

  const handleToggleExpandAll = () => {
    const anyCollapsed = orders.some((o) => !isOrderExpanded(o.request_id));
    const nextState: Record<string, boolean> = {};
    orders.forEach((o) => {
      nextState[o.request_id] = anyCollapsed;
    });
    setExpandedOrders(nextState);
  };

  const handleDeskSort = (key: DeskSortKey) => {
    if (deskSortKey === key) {
      setDeskSortAsc(!deskSortAsc);
    } else {
      setDeskSortKey(key);
      setDeskSortAsc(['hospital', 'blood_group', 'status'].includes(key));
    }
  };

  const handleInvSort = (key: InvSortKey) => {
    if (invSortKey === key) {
      setInvSortAsc(!invSortAsc);
    } else {
      setInvSortKey(key);
      setInvSortAsc(true);
    }
  };

  const actionRequiredCount = orders.filter((order) => {
    const hasReserved = order.allocated_units.some((u) => u.unit_status === 'LOCKED_RESERVE');
    const hasCompatible = (order.available_compatible_units?.length ?? 0) > 0;
    const shortfall = order.units_shortfall ?? Math.max(0, order.units_requested - (order.units_covered ?? order.allocated_units.length));
    return hasReserved || (hasCompatible && shortfall > 0);
  }).length;

  const dispatchedCount = orders.filter((order) => {
    return (
      order.allocated_units.length > 0 &&
      order.allocated_units.every((u) => u.unit_status === 'DISPATCHED')
    );
  }).length;

  const filteredAndSortedOrders = [...orders]
    .filter((order) => {
      const hasReserved = order.allocated_units.some((u) => u.unit_status === 'LOCKED_RESERVE');
      const hasCompatible = (order.available_compatible_units?.length ?? 0) > 0;
      const shortfall = order.units_shortfall ?? Math.max(0, order.units_requested - (order.units_covered ?? order.allocated_units.length));
      const allDispatched =
        order.allocated_units.length > 0 &&
        order.allocated_units.every((u) => u.unit_status === 'DISPATCHED');

      if (deskFilter === 'ACTION_REQUIRED') {
        if (!hasReserved && !(hasCompatible && shortfall > 0)) return false;
      } else if (deskFilter === 'DISPATCHED') {
        if (!allDispatched) return false;
      }

      if (deskSearch.trim()) {
        const q = deskSearch.toLowerCase();
        const matchesHospital = order.hospital_name?.toLowerCase().includes(q);
        const matchesGroup = order.required_blood_group?.toLowerCase().includes(q);
        const matchesToken = order.patient_id_token?.toLowerCase().includes(q);
        const matchesStatus = order.status?.toLowerCase().includes(q);
        if (!matchesHospital && !matchesGroup && !matchesToken && !matchesStatus) {
          return false;
        }
      }

      return true;
    })
    .sort((a, b) => {
      let comparison = 0;
      switch (deskSortKey) {
        case 'urgency':
          comparison = a.calculated_urgency_score - b.calculated_urgency_score;
          break;
        case 'hospital':
          comparison = a.hospital_name.localeCompare(b.hospital_name);
          break;
        case 'blood_group':
          comparison = a.required_blood_group.localeCompare(b.required_blood_group);
          break;
        case 'units':
          comparison = a.units_requested - b.units_requested;
          break;
        case 'shortfall': {
          const sfA = a.units_shortfall ?? Math.max(0, a.units_requested - (a.units_covered ?? a.allocated_units.length));
          const sfB = b.units_shortfall ?? Math.max(0, b.units_requested - (b.units_covered ?? b.allocated_units.length));
          comparison = sfA - sfB;
          break;
        }
        case 'status':
          comparison = a.status.localeCompare(b.status);
          break;
        case 'created_at':
          comparison = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
          break;
      }
      return deskSortAsc ? comparison : -comparison;
    });

  const allOrdersExpanded = orders.length > 0 && orders.every((o) => isOrderExpanded(o.request_id));

  const sortedUnits = [...units].sort((a, b) => {
    let cmp = 0;
    switch (invSortKey) {
      case 'batch':
        cmp = a.batch_number.localeCompare(b.batch_number);
        break;
      case 'group':
        cmp = a.blood_group.localeCompare(b.blood_group);
        break;
      case 'type':
        cmp = a.component_type.localeCompare(b.component_type);
        break;
      case 'volume':
        cmp = a.volume_ml - b.volume_ml;
        break;
      case 'expiry':
        cmp = new Date(a.expiry_date).getTime() - new Date(b.expiry_date).getTime();
        break;
      case 'status':
        cmp = a.status.localeCompare(b.status);
        break;
    }
    return invSortAsc ? cmp : -cmp;
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

      {error && (
        <div
          style={{
            background: 'rgba(239, 68, 68, 0.12)',
            border: '1px solid var(--crimson-500)',
            padding: '0.75rem 1rem',
            borderRadius: '8px',
            marginBottom: '1rem',
            color: 'var(--crimson-500)',
            fontSize: '0.85rem',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '0.75rem',
          }}
        >
          <span>{error}</span>
          <button
            onClick={() => setError(null)}
            aria-label="Dismiss"
            style={{ background: 'transparent', border: 'none', color: 'inherit', cursor: 'pointer' }}
          >
            ✕
          </button>
        </div>
      )}

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
      {/* SECTION: Incoming Hospital Blood Orders Desk */}
      <div className="glass-panel highlight-cyan" style={{ marginBottom: '1.75rem', border: '1px solid rgba(6, 182, 212, 0.4)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.75rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <Building2 size={22} color="var(--cyan-400)" />
            <h2 style={{ fontSize: '1.2rem', fontWeight: 800 }}>
              Incoming Hospital Blood Orders Desk
            </h2>
            <span className="badge badge-cyan">{orders.length} Active Orders</span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
            {orders.length > 0 && (
              <button
                type="button"
                onClick={handleToggleExpandAll}
                className="btn btn-secondary"
                style={{ padding: '0.35rem 0.75rem', fontSize: '0.8rem' }}
              >
                {allOrdersExpanded ? 'Collapse All' : 'Expand All'}
              </button>
            )}
            <button onClick={fetchInventoryAndOrders} className="btn btn-secondary" style={{ padding: '0.35rem 0.75rem', fontSize: '0.8rem' }}>
              <RefreshCw size={14} className={loading ? 'spin' : ''} />
              Refresh
            </button>
          </div>
        </div>

        {/* Filter bar & Search */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.75rem' }}>
          <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
            <button
              onClick={() => setDeskFilter('ALL')}
              className={`badge ${deskFilter === 'ALL' ? 'badge-cyan' : ''}`}
              style={{
                background: deskFilter === 'ALL' ? 'var(--cyan-600, #0891b2)' : 'var(--color-surface)',
                color: '#fff',
                cursor: 'pointer',
                border: '1px solid var(--border-subtle)',
                padding: '0.35rem 0.75rem',
                fontSize: '0.78rem'
              }}
            >
              All Orders ({orders.length})
            </button>
            <button
              onClick={() => setDeskFilter('ACTION_REQUIRED')}
              className={`badge ${deskFilter === 'ACTION_REQUIRED' ? 'badge-amber' : ''}`}
              style={{
                background: deskFilter === 'ACTION_REQUIRED' ? 'var(--amber-500, #f59e0b)' : 'var(--color-surface)',
                color: deskFilter === 'ACTION_REQUIRED' ? '#000' : 'var(--text-muted)',
                cursor: 'pointer',
                border: '1px solid var(--border-subtle)',
                padding: '0.35rem 0.75rem',
                fontSize: '0.78rem'
              }}
            >
              Action Required ({actionRequiredCount})
            </button>
            <button
              onClick={() => setDeskFilter('DISPATCHED')}
              className={`badge ${deskFilter === 'DISPATCHED' ? 'badge-green' : ''}`}
              style={{
                background: deskFilter === 'DISPATCHED' ? 'var(--emerald-600, #059669)' : 'var(--color-surface)',
                color: '#fff',
                cursor: 'pointer',
                border: '1px solid var(--border-subtle)',
                padding: '0.35rem 0.75rem',
                fontSize: '0.78rem'
              }}
            >
              Dispatched ({dispatchedCount})
            </button>
          </div>

          <div style={{ position: 'relative', minWidth: '240px' }}>
            <Search size={14} style={{ position: 'absolute', left: '0.65rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-dim)' }} />
            <input
              type="text"
              placeholder="Filter hospital, token, blood group..."
              value={deskSearch}
              onChange={(e) => setDeskSearch(e.target.value)}
              className="input-field"
              style={{ paddingLeft: '2rem', paddingRight: '0.75rem', paddingTop: '0.35rem', paddingBottom: '0.35rem', fontSize: '0.8rem', width: '100%' }}
            />
          </div>
        </div>

        {orders.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '2.5rem', color: 'var(--text-muted)', background: 'var(--color-bg)', borderRadius: '8px' }}>
            <Clock size={32} color="var(--text-dim)" style={{ marginBottom: '0.5rem' }} />
            <p>No active hospital orders currently assigned to this blood bank.</p>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-dim)', marginTop: '0.25rem' }}>
              When a partner hospital places an emergency blood request, cold-chain matching automatically reserves matching units and routes the order here in real time.
            </p>
          </div>
        ) : filteredAndSortedOrders.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)', background: 'var(--color-bg)', borderRadius: '8px' }}>
            <p>No orders match the current filter or search criteria.</p>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--text-muted)', borderBottom: '1px solid var(--border-subtle)', userSelect: 'none' }}>
                  <th style={{ width: '38px', padding: '0.65rem 0.5rem', textAlign: 'center' }}></th>
                  <th style={{ padding: '0.65rem 0.75rem', cursor: 'pointer' }} onClick={() => handleDeskSort('hospital')}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                      HOSPITAL {deskSortKey === 'hospital' ? (deskSortAsc ? <ChevronUp size={13} /> : <ChevronDown size={13} />) : <ArrowUpDown size={12} style={{ opacity: 0.4 }} />}
                    </span>
                  </th>
                  <th style={{ padding: '0.65rem 0.75rem', cursor: 'pointer' }} onClick={() => handleDeskSort('blood_group')}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                      BLOOD GROUP {deskSortKey === 'blood_group' ? (deskSortAsc ? <ChevronUp size={13} /> : <ChevronDown size={13} />) : <ArrowUpDown size={12} style={{ opacity: 0.4 }} />}
                    </span>
                  </th>
                  <th style={{ padding: '0.65rem 0.75rem', cursor: 'pointer' }} onClick={() => handleDeskSort('units')}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                      PACKETS (REQ / SHORTFALL) {deskSortKey === 'units' ? (deskSortAsc ? <ChevronUp size={13} /> : <ChevronDown size={13} />) : <ArrowUpDown size={12} style={{ opacity: 0.4 }} />}
                    </span>
                  </th>
                  <th style={{ padding: '0.65rem 0.75rem', cursor: 'pointer' }} onClick={() => handleDeskSort('urgency')}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                      URGENCY SCORE {deskSortKey === 'urgency' ? (deskSortAsc ? <ChevronUp size={13} /> : <ChevronDown size={13} />) : <ArrowUpDown size={12} style={{ opacity: 0.4 }} />}
                    </span>
                  </th>
                  <th style={{ padding: '0.65rem 0.75rem', cursor: 'pointer' }} onClick={() => handleDeskSort('status')}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                      STATUS {deskSortKey === 'status' ? (deskSortAsc ? <ChevronUp size={13} /> : <ChevronDown size={13} />) : <ArrowUpDown size={12} style={{ opacity: 0.4 }} />}
                    </span>
                  </th>
                  <th style={{ padding: '0.65rem 0.75rem', cursor: 'pointer' }} onClick={() => handleDeskSort('created_at')}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                      TIME {deskSortKey === 'created_at' ? (deskSortAsc ? <ChevronUp size={13} /> : <ChevronDown size={13} />) : <ArrowUpDown size={12} style={{ opacity: 0.4 }} />}
                    </span>
                  </th>
                  <th style={{ padding: '0.65rem 0.75rem', textAlign: 'right' }}>QUICK ACTIONS</th>
                </tr>
              </thead>
              <tbody>
                {filteredAndSortedOrders.map((order) => {
                  const isExpanded = isOrderExpanded(order.request_id);
                  const hasReservedUnits = order.allocated_units.some((u) => u.unit_status === 'LOCKED_RESERVE');
                  const allDispatched =
                    order.allocated_units.length > 0 &&
                    order.allocated_units.every((u) => u.unit_status === 'DISPATCHED');
                  const compatibleUnits = order.available_compatible_units || [];
                  const shortfall = order.units_shortfall ?? Math.max(0, order.units_requested - (order.units_covered ?? order.allocated_units.length));
                  const isProcessing = dispatchingId === order.request_id || acceptingId === order.request_id;

                  return (
                    <React.Fragment key={order.request_id}>
                      {/* Summary Row */}
                      <tr
                        id={`order-row-${order.request_id.slice(0, 8)}`}
                        onClick={() => handleToggleExpand(order.request_id)}
                        style={{
                          borderBottom: isExpanded ? 'none' : '1px solid var(--border-subtle)',
                          background: isExpanded ? 'rgba(6, 182, 212, 0.07)' : 'transparent',
                          cursor: 'pointer',
                          transition: 'background 0.15s ease',
                        }}
                      >
                        <td style={{ padding: '0.75rem 0.5rem', textAlign: 'center' }}>
                          <button
                            type="button"
                            aria-label={isExpanded ? 'Collapse order' : 'Expand order'}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleToggleExpand(order.request_id);
                            }}
                            style={{
                              background: 'transparent',
                              border: 'none',
                              color: isExpanded ? 'var(--cyan-400)' : 'var(--text-muted)',
                              cursor: 'pointer',
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                            }}
                          >
                            {isExpanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                          </button>
                        </td>
                        <td style={{ padding: '0.75rem' }}>
                          <div style={{ fontWeight: 800, color: 'var(--text-main)', fontSize: '0.95rem' }}>
                            {order.hospital_name}
                          </div>
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)', marginTop: '0.1rem' }}>
                            Token: <code>{order.patient_id_token}</code>
                          </div>
                        </td>
                        <td style={{ padding: '0.75rem' }}>
                          <span style={{ fontWeight: 800, color: 'var(--crimson-500)', fontSize: '1rem' }}>
                            {order.required_blood_group}
                          </span>
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                            {order.component_type}
                          </div>
                        </td>
                        <td style={{ padding: '0.75rem' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                            <span style={{ fontWeight: 700 }}>{order.units_requested} Packets</span>
                            {shortfall > 0 ? (
                              <span className="badge badge-amber" style={{ fontSize: '0.7rem' }}>Shortfall: {shortfall}</span>
                            ) : (
                              <span className="badge badge-green" style={{ fontSize: '0.7rem' }}>Fully Covered</span>
                            )}
                          </div>
                          <div style={{ fontSize: '0.72rem', color: 'var(--text-dim)', marginTop: '0.15rem' }}>
                            {order.allocated_units.length} bag(s) allocated from storage
                          </div>
                        </td>
                        <td style={{ padding: '0.75rem' }}>
                          <span
                            className={`badge ${
                              order.calculated_urgency_score >= 80
                                ? 'badge-red'
                                : order.calculated_urgency_score >= 50
                                ? 'badge-amber'
                                : 'badge-cyan'
                            }`}
                            style={{ fontWeight: 700 }}
                          >
                            {order.calculated_urgency_score}/100
                          </span>
                        </td>
                        <td style={{ padding: '0.75rem' }}>
                          <span className={`badge ${allDispatched ? 'badge-green' : 'badge-amber'}`}>
                            {allDispatched ? 'DISPATCHED' : order.status}
                          </span>
                        </td>
                        <td style={{ padding: '0.75rem', color: 'var(--text-muted)', fontSize: '0.78rem' }}>
                          {new Date(order.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </td>
                        <td style={{ padding: '0.75rem', textAlign: 'right' }} onClick={(e) => e.stopPropagation()}>
                          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.4rem', alignItems: 'center' }}>
                            {hasReservedUnits && (
                              <button
                                id={`btn-dispatch-${order.request_id.slice(0, 8)}`}
                                onClick={() => handleDispatchOrder(order.request_id)}
                                disabled={isProcessing}
                                className="btn btn-cyan"
                                style={{ fontSize: '0.75rem', padding: '0.35rem 0.7rem' }}
                              >
                                <Truck size={13} />
                                {dispatchingId === order.request_id ? 'Handing Over...' : 'Dispatch'}
                              </button>
                            )}
                            {compatibleUnits.length > 0 && !hasReservedUnits && shortfall > 0 && (
                              <button
                                id={`btn-dispatch-ready-${order.request_id.slice(0, 8)}`}
                                onClick={() => handleAcceptOrder(order.request_id, true)}
                                disabled={isProcessing}
                                className="btn btn-cyan"
                                style={{ fontSize: '0.75rem', padding: '0.35rem 0.7rem' }}
                              >
                                <Truck size={13} />
                                {acceptingId === order.request_id ? 'Dispatching...' : 'Accept & Dispatch'}
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => handleToggleExpand(order.request_id)}
                              className="btn btn-secondary"
                              style={{ fontSize: '0.75rem', padding: '0.35rem 0.65rem' }}
                            >
                              {isExpanded ? 'Hide' : 'Details'}
                            </button>
                          </div>
                        </td>
                      </tr>

                      {/* Expandable Detail Drawer Row */}
                      {isExpanded && (
                        <tr
                          id={`order-card-${order.request_id.slice(0, 8)}`}
                          style={{
                            borderBottom: '1px solid var(--border-subtle)',
                            background: 'rgba(6, 182, 212, 0.03)',
                          }}
                        >
                          <td colSpan={8} style={{ padding: '0.85rem 1.25rem 1.25rem 2.75rem' }}>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
                              {/* Order Metadata (No triage word!) */}
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '0.5rem' }}>
                                <div>
                                  <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                                    Patient Token: <code>{order.patient_id_token}</code> | Severity Protocol: <b>{order.triage_level?.replace(/_/g, ' ')}</b> | Urgency: <b>{order.calculated_urgency_score}/100</b>
                                  </div>
                                  {order.hospital_address && (
                                    <div style={{ fontSize: '0.78rem', color: 'var(--text-dim)', marginTop: '0.2rem' }}>
                                      Destination: {order.hospital_address}
                                    </div>
                                  )}
                                </div>

                                <div style={{ textAlign: 'right' }}>
                                  <span style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--crimson-500)' }}>
                                    {order.units_requested} Packet(s) {order.required_blood_group} ({order.component_type})
                                  </span>
                                  <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>Requested Order Volume</div>
                                </div>
                              </div>

                              {/* Matched Units in this blood bank */}
                              <div style={{ background: 'var(--color-surface)', padding: '0.75rem', borderRadius: '8px', border: '1px solid var(--border-subtle)' }}>
                                <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)', fontWeight: 700, marginBottom: '0.4rem', textTransform: 'uppercase' }}>
                                  Blood Bags Allocated From Our Storage:
                                </div>
                                {order.allocated_units.length === 0 ? (
                                  compatibleUnits.length > 0 ? (
                                    <div style={{
                                      background: 'rgba(16, 185, 129, 0.08)',
                                      border: '1px solid rgba(16, 185, 129, 0.3)',
                                      borderRadius: '6px',
                                      padding: '0.65rem 0.85rem',
                                      display: 'flex',
                                      alignItems: 'center',
                                      gap: '0.6rem',
                                      fontSize: '0.82rem',
                                      color: 'var(--emerald-400)',
                                    }}>
                                      <CheckCircle2 size={16} />
                                      <span>
                                        <b>{compatibleUnits.length} Compatible Bag(s) In Cold Storage</b> ready to be accepted and dispatched for this hospital order.
                                      </span>
                                    </div>
                                  ) : (order.volunteer_donors && order.volunteer_donors.length > 0) ? (
                                    <div style={{
                                      background: 'rgba(16, 185, 129, 0.08)',
                                      border: '1px solid rgba(16, 185, 129, 0.3)',
                                      borderRadius: '6px',
                                      padding: '0.65rem 0.85rem',
                                      display: 'flex',
                                      alignItems: 'center',
                                      gap: '0.6rem',
                                      fontSize: '0.82rem',
                                      color: 'var(--emerald-400)',
                                    }}>
                                      <CheckCircle2 size={16} />
                                      <span>
                                        <b>{order.volunteer_donors.length} Volunteer Unit(s) Committed &amp; En Route</b> to hospital ward.
                                      </span>
                                    </div>
                                  ) : (
                                    <div style={{
                                      background: 'rgba(245, 158, 11, 0.1)',
                                      border: '1px dashed rgba(245, 158, 11, 0.4)',
                                      borderRadius: '6px',
                                      padding: '0.6rem 0.85rem',
                                      display: 'flex',
                                      alignItems: 'center',
                                      gap: '0.6rem',
                                      fontSize: '0.8rem',
                                      color: 'var(--amber-400)',
                                    }}>
                                      <AlertTriangle size={16} />
                                      <span>
                                        Storage Depleted for {order.required_blood_group} ({order.component_type}) — Automated Matching Engine routed this demand to <b>Live Volunteer Donors</b> across the city.
                                      </span>
                                    </div>
                                  )
                                ) : (
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
                                )}

                                {order.volunteer_donors && order.volunteer_donors.length > 0 && order.allocated_units.length > 0 && (
                                  <div style={{ marginTop: '0.6rem', display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }}>
                                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>En-Route Volunteers:</span>
                                    {order.volunteer_donors.map((v, i) => (
                                      <div
                                        key={v.allocation_id || i}
                                        style={{
                                          background: 'rgba(16, 185, 129, 0.1)',
                                          border: '1px solid rgba(16, 185, 129, 0.3)',
                                          padding: '0.3rem 0.6rem',
                                          borderRadius: '6px',
                                          fontSize: '0.75rem',
                                          color: 'var(--emerald-400)',
                                          display: 'flex',
                                          alignItems: 'center',
                                          gap: '0.4rem',
                                        }}
                                      >
                                        <span>🩸 {v.blood_group} Volunteer {v.donor_id.slice(0, 6)}</span>
                                        {v.estimated_transit_minutes != null && (
                                          <span style={{ color: 'var(--text-muted)' }}>(~{v.estimated_transit_minutes} min)</span>
                                        )}
                                        <span className="badge badge-green" style={{ fontSize: '0.6rem', padding: '0.1rem 0.35rem' }}>En Route</span>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>

                              {/* Ready Stock Available in Storage - Option to Accept and Dispatch */}
                              {compatibleUnits.length > 0 && shortfall > 0 && (
                                <div style={{
                                  background: 'rgba(6, 182, 212, 0.08)',
                                  border: '1px solid rgba(6, 182, 212, 0.3)',
                                  borderRadius: '8px',
                                  padding: '0.75rem 1rem',
                                  display: 'flex',
                                  justifyContent: 'space-between',
                                  alignItems: 'center',
                                  flexWrap: 'wrap',
                                  gap: '0.75rem',
                                }}>
                                  <div>
                                    <div style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--cyan-400)', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                      <Droplet size={15} />
                                      <span>Packets Ready in Storage: {compatibleUnits.length} Compatible Bag(s)</span>
                                    </div>
                                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>
                                      Available: {compatibleUnits.slice(0, 3).map(u => `${u.batch_number} (${u.blood_group})`).join(', ')}{compatibleUnits.length > 3 ? ` +${compatibleUnits.length - 3} more` : ''}
                                    </div>
                                  </div>

                                  <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                                    <button
                                      id={`btn-accept-reserve-${order.request_id.slice(0, 8)}`}
                                      onClick={() => handleAcceptOrder(order.request_id, false)}
                                      disabled={isProcessing}
                                      className="btn btn-secondary"
                                      style={{ fontSize: '0.8rem', padding: '0.4rem 0.8rem' }}
                                    >
                                      <CheckCircle2 size={14} />
                                      {acceptingId === order.request_id ? 'Reserving...' : `Accept & Reserve (${Math.min(shortfall, compatibleUnits.length)})`}
                                    </button>
                                    <button
                                      id={`btn-accept-dispatch-${order.request_id.slice(0, 8)}`}
                                      onClick={() => handleAcceptOrder(order.request_id, true)}
                                      disabled={isProcessing}
                                      className="btn btn-cyan"
                                      style={{ fontSize: '0.8rem', padding: '0.4rem 0.8rem' }}
                                    >
                                      <Truck size={14} />
                                      {acceptingId === order.request_id ? 'Dispatching...' : 'Accept & Dispatch Now'}
                                    </button>
                                  </div>
                                </div>
                              )}

                              {/* Dispatch Action status and handover button */}
                              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
                                {hasReservedUnits && (
                                  <button
                                    onClick={() => handleDispatchOrder(order.request_id)}
                                    disabled={isProcessing}
                                    className="btn btn-cyan"
                                    style={{ fontSize: '0.85rem', padding: '0.45rem 1rem' }}
                                  >
                                    <Truck size={15} />
                                    {dispatchingId === order.request_id ? 'Handing Over...' : 'Hand to Ambulance (Dispatch)'}
                                  </button>
                                )}
                                {allDispatched && shortfall === 0 && (
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: 'var(--emerald-400)', fontSize: '0.85rem', fontWeight: 600 }}>
                                    <CheckCircle2 size={16} />
                                    All blood bags handed to courier and on the way to hospital.
                                  </div>
                                )}
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
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
                    Urgency: <b>{req.calculated_urgency_score?.toFixed(0) ?? 0}/100</b> | Severity Protocol: <b>{req.triage_level?.replace(/_/g, ' ')}</b> | Covered: <b>{req.units_covered ?? 0} of {req.units_requested}</b>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
                  {(() => {
                    const corrOrder = orders.find((o) => o.request_id === req.id);
                    const hasCompatible = (corrOrder?.available_compatible_units?.length ?? 0) > 0;
                    const isShortfall = (req.units_covered ?? 0) < req.units_requested;
                    if (hasCompatible && isShortfall && req.status !== 'FULFILLED' && req.status !== 'CANCELLED') {
                      return (
                        <button
                          id={`btn-city-dispatch-${req.id.slice(0, 8)}`}
                          onClick={() => handleAcceptOrder(req.id, true)}
                          disabled={acceptingId === req.id || dispatchingId === req.id}
                          className="btn btn-cyan"
                          style={{ fontSize: '0.75rem', padding: '0.3rem 0.65rem' }}
                        >
                          <Truck size={13} />
                          {acceptingId === req.id ? 'Dispatching...' : 'Accept & Dispatch Stock'}
                        </button>
                      );
                    }
                    return null;
                  })()}
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
              <tr style={{ borderBottom: '1px solid var(--border-subtle)', textAlign: 'left', color: 'var(--text-muted)', userSelect: 'none' }}>
                <th style={{ padding: '0.75rem', cursor: 'pointer' }} onClick={() => handleInvSort('batch')}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                    BAG CODE {invSortKey === 'batch' ? (invSortAsc ? <ChevronUp size={13} /> : <ChevronDown size={13} />) : <ArrowUpDown size={12} style={{ opacity: 0.4 }} />}
                  </span>
                </th>
                <th style={{ padding: '0.75rem', cursor: 'pointer' }} onClick={() => handleInvSort('group')}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                    BLOOD GROUP {invSortKey === 'group' ? (invSortAsc ? <ChevronUp size={13} /> : <ChevronDown size={13} />) : <ArrowUpDown size={12} style={{ opacity: 0.4 }} />}
                  </span>
                </th>
                <th style={{ padding: '0.75rem', cursor: 'pointer' }} onClick={() => handleInvSort('type')}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                    TYPE {invSortKey === 'type' ? (invSortAsc ? <ChevronUp size={13} /> : <ChevronDown size={13} />) : <ArrowUpDown size={12} style={{ opacity: 0.4 }} />}
                  </span>
                </th>
                <th style={{ padding: '0.75rem', cursor: 'pointer' }} onClick={() => handleInvSort('volume')}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                    VOLUME {invSortKey === 'volume' ? (invSortAsc ? <ChevronUp size={13} /> : <ChevronDown size={13} />) : <ArrowUpDown size={12} style={{ opacity: 0.4 }} />}
                  </span>
                </th>
                <th style={{ padding: '0.75rem' }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                    NO. OF PACKETS
                  </span>
                </th>
                <th style={{ padding: '0.75rem', cursor: 'pointer' }} onClick={() => handleInvSort('expiry')}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                    EXPIRY DATE {invSortKey === 'expiry' ? (invSortAsc ? <ChevronUp size={13} /> : <ChevronDown size={13} />) : <ArrowUpDown size={12} style={{ opacity: 0.4 }} />}
                  </span>
                </th>
                <th style={{ padding: '0.75rem', cursor: 'pointer' }} onClick={() => handleInvSort('status')}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                    STATUS {invSortKey === 'status' ? (invSortAsc ? <ChevronUp size={13} /> : <ChevronDown size={13} />) : <ArrowUpDown size={12} style={{ opacity: 0.4 }} />}
                  </span>
                </th>
                <th style={{ padding: '0.75rem', textAlign: 'right' }}>TEST BAG DAMAGE / ACTIONS</th>
              </tr>
            </thead>
            <tbody>
              {sortedUnits.map((unit) => {
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
                    <td style={{ padding: '0.75rem' }}>
                      <span className="badge badge-cyan" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.78rem' }}>
                        <Package size={13} />
                        1 Packet
                      </span>
                    </td>
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
          <div className="glass-panel" style={{ maxWidth: '520px', width: '100%', border: '1px solid rgba(6, 182, 212, 0.4)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '1.25rem' }}>
              <Package size={22} color="var(--cyan-400)" />
              <h3 style={{ fontSize: '1.2rem', fontWeight: 800 }}>Log Verified Blood Packets</h3>
            </div>

            <form onSubmit={handleAddUnit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div>
                <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 600 }}>Batch Number Prefix (optional)</label>
                <input
                  type="text"
                  placeholder="e.g. BB-005"
                  className="input-field"
                  value={newBatch}
                  onChange={(e) => setNewBatch(e.target.value)}
                />
                <span style={{ fontSize: '0.72rem', color: 'var(--text-dim)', marginTop: '0.25rem', display: 'block' }}>
                  {newPacketsCount > 1
                    ? `Packets will be indexed sequentially (e.g. ${newBatch.trim() || 'BB-XXXX'}-01 to -${String(newPacketsCount).padStart(2, '0')}).`
                    : 'A unique batch code will be generated if left empty.'}
                </span>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <div>
                  <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 600 }}>Blood Group</label>
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
                  <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 600 }}>Component Type</label>
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

              {/* Number of Packets (Quantity to Keep in Storage) */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem' }}>
                  <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 600 }}>
                    Number of Packets (Bags to Keep)
                  </label>
                  <span style={{ fontSize: '0.75rem', color: 'var(--cyan-400)', fontWeight: 700 }}>
                    {newPacketsCount} {newPacketsCount === 1 ? 'Packet' : 'Packets'} ({newPacketsCount * DEFAULT_UNIT_VOLUME_ML} mL)
                  </span>
                </div>

                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  <input
                    id="input-packets-count"
                    type="number"
                    min="1"
                    max="100"
                    className="input-field"
                    style={{ fontWeight: 700, fontSize: '0.95rem', width: '100px' }}
                    value={newPacketsCount}
                    onChange={(e) => setNewPacketsCount(Math.max(1, Math.min(100, Number(e.target.value) || 1)))}
                  />

                  {/* Quick selection chips */}
                  <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                    {[1, 2, 5, 10, 20].map((qty) => (
                      <button
                        key={qty}
                        type="button"
                        onClick={() => setNewPacketsCount(qty)}
                        className={`badge ${newPacketsCount === qty ? 'badge-cyan' : ''}`}
                        style={{
                          background: newPacketsCount === qty ? 'var(--cyan-500, #06b6d4)' : 'var(--color-surface)',
                          color: newPacketsCount === qty ? '#000' : 'var(--text-muted)',
                          border: '1px solid var(--border-subtle)',
                          cursor: 'pointer',
                          padding: '0.35rem 0.65rem',
                          fontWeight: 700,
                          fontSize: '0.75rem',
                        }}
                      >
                        +{qty} {qty === 1 ? 'Pkt' : 'Pkts'}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div>
                <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 600 }}>Shelf Life (Days)</label>
                <input
                  type="number"
                  min="1"
                  max="365"
                  className="input-field"
                  value={newExpiryDays}
                  onChange={(e) => setNewExpiryDays(Number(e.target.value))}
                />
              </div>

              {/* Visual preview box */}
              <div style={{
                background: 'rgba(6, 182, 212, 0.08)',
                border: '1px solid rgba(6, 182, 212, 0.25)',
                borderRadius: '8px',
                padding: '0.65rem 0.85rem',
                fontSize: '0.8rem',
                color: 'var(--cyan-300)',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
              }}>
                <Package size={16} />
                <span>
                  Adding <b>{newPacketsCount} {newPacketsCount === 1 ? 'Packet' : 'Packets'}</b> of <b>{newBloodGroup}</b> ({newComponent === 'PRBC' ? 'Red Blood Cells' : newComponent}) into cold storage.
                </span>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.6rem', marginTop: '0.5rem' }}>
                <button
                  type="button"
                  onClick={() => {
                    setShowAddModal(false);
                    setNewPacketsCount(1);
                  }}
                  disabled={registering}
                  className="btn btn-secondary"
                >
                  Cancel
                </button>
                <button
                  id="btn-submit-register-unit"
                  type="submit"
                  disabled={registering}
                  className="btn btn-cyan"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}
                >
                  <Package size={15} />
                  {registering
                    ? 'Registering...'
                    : `Register ${newPacketsCount} ${newPacketsCount === 1 ? 'Packet' : 'Packets'}`}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
