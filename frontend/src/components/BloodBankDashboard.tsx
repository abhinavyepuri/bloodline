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
  Layers,
  Trash2,
  Sparkles,
  Check,
  Package,
  TrendingUp,
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

interface MultiRowItem {
  id: string;
  blood_group: string;
  component_type: BloodComponentType;
  quantity: number;
  volume_ml: number;
  expiry_days: number;
}

export const STANDARD_COMPONENT_SPEC: Record<BloodComponentType, { volume_ml: number; expiry_days: number; label: string }> = {
  PRBC: { volume_ml: 350, expiry_days: 42, label: 'Red Blood Cells (PRBC)' },
  WHOLE_BLOOD: { volume_ml: 450, expiry_days: 35, label: 'Whole Blood' },
  PLATELETS: { volume_ml: 250, expiry_days: 5, label: 'Platelets' },
  FFP: { volume_ml: 250, expiry_days: 365, label: 'Fresh Frozen Plasma (FFP)' },
  CRYOPRECIPITATE: { volume_ml: 20, expiry_days: 365, label: 'Cryoprecipitate' },
};

const DEFAULT_EXPIRY_BY_COMPONENT: Record<BloodComponentType, number> = {
  PRBC: 42,
  WHOLE_BLOOD: 35,
  PLATELETS: 5,
  FFP: 365,
  CRYOPRECIPITATE: 365,
};

type DeskSortKey = 'urgency' | 'hospital' | 'blood_group' | 'units' | 'shortfall' | 'status' | 'created_at';
type InvSortKey = 'batch' | 'group' | 'type' | 'volume' | 'expiry' | 'status';

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
  const [error, setError] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [modalTab, setModalTab] = useState<'BATCH_GENERATOR' | 'MULTI_ROW' | 'SINGLE'>('BATCH_GENERATOR');
  const [submitting, setSubmitting] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [newPacketsCount, setNewPacketsCount] = useState<number>(1);
  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  const [dispatchingId, setDispatchingId] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [liveAlert, setLiveAlert] = useState<{
    type: 'broadcast' | 'donor_claim' | 'donor_status' | 'order' | 'inventory_match';
    title: string;
    message: string;
    timestamp: string;
  } | null>(null);

  // Expanded orders & desk sorting/filtering
  const [expandedOrders, setExpandedOrders] = useState<Record<string, boolean>>({});
  const [deskSortKey, setDeskSortKey] = useState<DeskSortKey>('created_at');
  const [deskSortAsc, setDeskSortAsc] = useState<boolean>(false);
  const [deskFilter, setDeskFilter] = useState<'ALL' | 'ACTION_REQUIRED' | 'DISPATCHED'>('ALL');
  const [deskSearch, setDeskSearch] = useState<string>('');
  const [invSortKey, setInvSortKey] = useState<InvSortKey>('expiry');
  const [invSortAsc, setInvSortAsc] = useState<boolean>(true);

  // Pagination state for each list section
  const PAGE_SIZE = 5;
  const FORECAST_PAGE_SIZE = 8;
  const [ordersPage, setOrdersPage] = useState(1);
  const [requestsPage, setRequestsPage] = useState(1);
  const [donorsPage, setDonorsPage] = useState(1);
  const [unitsPage, setUnitsPage] = useState(1);
  const [forecastPage, setForecastPage] = useState(1);

  // Single unit form
  const [newBatch, setNewBatch] = useState('');
  const [newBloodGroup, setNewBloodGroup] = useState('O-');
  const [newComponent, setNewComponent] = useState<BloodComponentType>('PRBC');
  const [newExpiryDays, setNewExpiryDays] = useState(42);
  const [newVolume, setNewVolume] = useState(350);

  // Quick Batch Generator form
  const [batchBloodGroup, setBatchBloodGroup] = useState('O-');
  const [batchComponent, setBatchComponent] = useState<BloodComponentType>('PRBC');
  const [batchQuantity, setBatchQuantity] = useState(5);
  const [batchPrefix, setBatchPrefix] = useState('BB-DRIVE-');
  const [batchVolume, setBatchVolume] = useState(350);
  const [batchExpiryDays, setBatchExpiryDays] = useState(42);

  // Multi-Row Table form
  const [multiRows, setMultiRows] = useState<MultiRowItem[]>([
    { id: '1', blood_group: 'O-', component_type: 'PRBC', quantity: 4, volume_ml: 350, expiry_days: 42 },
    { id: '2', blood_group: 'O+', component_type: 'PRBC', quantity: 6, volume_ml: 350, expiry_days: 42 },
    { id: '3', blood_group: 'A+', component_type: 'PLATELETS', quantity: 3, volume_ml: 250, expiry_days: 5 },
  ]);

  // Ref to abort any in-flight fetch before starting a new one — prevents race-condition state overwrites
  const fetchAbortRef = React.useRef<AbortController | null>(null);

  const fetchInventoryAndOrders = useCallback(async () => {
    // Cancel any previous in-flight request before starting a new one
    if (fetchAbortRef.current) {
      fetchAbortRef.current.abort();
    }
    fetchAbortRef.current = new AbortController();
    const signal = fetchAbortRef.current.signal;

    setLoading(true);
    try {
      const [invData, ordersData, reqData, donorsData, forecastData, summaryData] = await Promise.all([
        api.get<InventoryUnit[]>('/inventory'),
        api.get<HospitalOrder[]>('/inventory/orders'),
        api.get<BloodRequest[]>('/requests'),
        // Use server-side filter — avoids loading all donors just to discard most client-side
        api.get<DonorPublic[]>('/donors', { params: { available_only: true } }),
        api.get<SeriesForecast[]>('/predictions/forecast').catch(() => [] as SeriesForecast[]),
        api.get<PredictionSummary>('/predictions/summary').catch(() => null),
      ]);

      if (signal.aborted) return; // discard result if a newer fetch already started

      setUnits(invData);
      setOrders(ordersData);
      setActiveRequests(reqData);
      setActiveDonors(donorsData.filter((d) => d.is_available));
      setForecasts(forecastData);
      setForecastSummary(summaryData);
      setError(null);
    } catch (err) {
      if (signal.aborted) return; // silently ignore aborted fetches
      console.error('Failed to fetch inventory or orders:', err);
      setError(err instanceof Error ? err.message : 'Could not load blood-bank data.');
    } finally {
      if (!signal.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Initial load on mount
    fetchInventoryAndOrders();
    // 30-second fallback heartbeat — WebSocket events drive real-time updates;
    // this only catches cases where the WebSocket connection drops silently.
    const interval = setInterval(() => {
      fetchInventoryAndOrders();
    }, 30_000);
    return () => {
      clearInterval(interval);
      // Abort any in-flight request on unmount
      fetchAbortRef.current?.abort();
    };
  }, [fetchInventoryAndOrders]);

  useEffect(() => {
    if (!lastEvent) return;

    const monitoredEvents = [
      'REQUEST_CREATED',
      'REQUEST_UPDATED',
      'EMERGENCY_BROADCAST_SENT',
      'EMERGENCY_DISPATCH_ALERT',
      'EMERGENCY_DONOR_ALERT',
      'DONOR_CLAIM_SUCCESS',
      'DONOR_AVAILABILITY_CHANGED',
      'DONOR_HEALTH_EVALUATED',
      'DONOR_REGISTERED',
      'DONOR_STAND_DOWN',
      'DONOR_PROXIMITY_ALERT',
      'DONOR_PROXIMITY_BROADCAST',
      'UNITS_STILL_NEEDED',
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
      'RE_PLAN_INVENTORY_REPLACEMENT',
      'INVENTORY_DEFICIT_COVERED',
      'ALTERNATIVE_FOUND',
      'INVENTORY_RESTOCKED_DEFICIT_UPDATED',
      'SYSTEM_RESET',
    ];

    if (monitoredEvents.includes(lastEvent.type)) {
      fetchInventoryAndOrders();

      // Capture real-time live alert for blood bank staff
      const nowStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      if (
        lastEvent.type === 'EMERGENCY_BROADCAST_SENT' ||
        lastEvent.type === 'EMERGENCY_DISPATCH_ALERT' ||
        lastEvent.type === 'EMERGENCY_DONOR_ALERT' ||
        lastEvent.type === 'DONOR_PROXIMITY_BROADCAST'
      ) {
        setLiveAlert({
          type: 'broadcast',
          title: '🚨 Live Emergency Broadcast Active',
          message: lastEvent.message || 'System dispatched emergency alerts to eligible nearby volunteer donors.',
          timestamp: nowStr,
        });
      } else if (lastEvent.type === 'DONOR_CLAIM_SUCCESS') {
        setLiveAlert({
          type: 'donor_claim',
          title: '✅ Volunteer Donor Accepted Request',
          message: lastEvent.message || 'A nearby volunteer donor agreed to donate and confirmed units.',
          timestamp: nowStr,
        });
      } else if (lastEvent.type === 'DONOR_AVAILABILITY_CHANGED') {
        const isAvail = (lastEvent as any).is_available;
        setLiveAlert({
          type: 'donor_status',
          title: '📍 Donor Availability Updated',
          message: (lastEvent as any).message || `Volunteer donor is now ${isAvail ? 'Active & Available' : 'Offline'}.`,
          timestamp: nowStr,
        });
      } else if (
        lastEvent.type === 'INVENTORY_DEFICIT_COVERED' ||
        lastEvent.type === 'ALTERNATIVE_FOUND' ||
        lastEvent.type === 'RE_PLAN_INVENTORY_REPLACEMENT' ||
        lastEvent.type === 'INVENTORY_RESTOCKED_DEFICIT_UPDATED'
      ) {
        setLiveAlert({
          type: 'inventory_match',
          title: '⚡ Stock Replenished & Matched (Previously Routed to Donors)',
          message:
            lastEvent.message ||
            `Newly added units matched a hospital request previously routed to donors. Stock reserved and ready for dispatch!`,
          timestamp: nowStr,
        });
      }
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

  // Add single unit
  const handleAddSingleUnit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
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
        volume_ml: newVolume,
        collection_date: now.toISOString(),
        expiry_date: expiry.toISOString(),
        quantity: count,
      });
      setShowAddModal(false);
      setNewBatch('');

      await fetchInventoryAndOrders();
      const updatedOrders = await api.get<HospitalOrder[]>('/inventory/orders');
      const matchedOrder = updatedOrders.find(
        (o) =>
          o.required_blood_group === newBloodGroup &&
          (o.allocated_units.some((u) => u.unit_status === 'LOCKED_RESERVE') || (o.volunteer_donors && o.volunteer_donors.length > 0))
      );
      if (matchedOrder) {
        setStatusMessage({
          type: 'success',
          text: `⚡ Update Response: Added 1 unit of ${newBloodGroup} (${newComponent}) matched Request for ${matchedOrder.hospital_name} (previously routed to donors). Stock reserved and ready for dispatch!`,
        });
      } else {
        setStatusMessage({
          type: 'success',
          text: `Successfully registered 1 unit of ${newBloodGroup} (${newComponent}) into storage!`,
        });
      }
      setTimeout(() => setStatusMessage(null), 6000);
    } catch (err) {
      alert('Error registering blood unit: ' + (err instanceof Error ? err.message : err));
    } finally {
      setSubmitting(false);
    }
  };

  // Batch generator submit
  const handleBatchGeneratorSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await api.post<InventoryUnit[]>('/inventory/batch', {
        blood_group: batchBloodGroup,
        component_type: batchComponent,
        quantity: batchQuantity,
        batch_prefix: batchPrefix.trim() || undefined,
        volume_ml: batchVolume,
        expiry_days: batchExpiryDays,
      });
      setShowAddModal(false);

      await fetchInventoryAndOrders();
      const updatedOrders = await api.get<HospitalOrder[]>('/inventory/orders');
      const matchedOrder = updatedOrders.find(
        (o) =>
          o.required_blood_group === batchBloodGroup &&
          (o.allocated_units.some((u) => u.unit_status === 'LOCKED_RESERVE') || (o.volunteer_donors && o.volunteer_donors.length > 0))
      );
      if (matchedOrder) {
        setStatusMessage({
          type: 'success',
          text: `⚡ Update Response: Batch added ${res.length} packets of ${batchBloodGroup} (${batchComponent})! Matched Request for ${matchedOrder.hospital_name} (previously routed to donors). Stock reserved for dispatch!`,
        });
      } else {
        setStatusMessage({
          type: 'success',
          text: `Successfully batch added ${res.length} packets of ${batchBloodGroup} (${batchComponent}) into storage!`,
        });
      }
      setTimeout(() => setStatusMessage(null), 6000);
    } catch (err) {
      alert('Error batch registering blood units: ' + (err instanceof Error ? err.message : err));
    } finally {
      setSubmitting(false);
    }
  };

  // Multi-row submit
  const handleMultiRowSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (multiRows.length === 0) {
      alert('Please add at least one row.');
      return;
    }
    setSubmitting(true);
    try {
      const items = multiRows.map((r) => ({
        blood_group: r.blood_group,
        component_type: r.component_type,
        quantity: r.quantity,
        volume_ml: r.volume_ml,
        expiry_days: r.expiry_days,
      }));
      const res = await api.post<InventoryUnit[]>('/inventory/batch', { items });
      setShowAddModal(false);

      await fetchInventoryAndOrders();
      const updatedOrders = await api.get<HospitalOrder[]>('/inventory/orders');
      const matchedOrders = updatedOrders.filter(
        (o) =>
          items.some((it) => it.blood_group === o.required_blood_group) &&
          (o.allocated_units.some((u) => u.unit_status === 'LOCKED_RESERVE') || (o.volunteer_donors && o.volunteer_donors.length > 0))
      );
      if (matchedOrders.length > 0) {
        setStatusMessage({
          type: 'success',
          text: `⚡ Update Response: Registered ${res.length} packets! Matched ${matchedOrders.length} active hospital order(s) previously routed to donors. Stock reserved for dispatch!`,
        });
      } else {
        setStatusMessage({
          type: 'success',
          text: `Successfully registered ${res.length} blood packets across ${multiRows.length} blood type categories!`,
        });
      }
      setTimeout(() => setStatusMessage(null), 6000);
    } catch (err) {
      alert('Error registering batch rows: ' + (err instanceof Error ? err.message : err));
    } finally {
      setSubmitting(false);
    }
  };

  // Helper to add row in multi-row table
  const addMultiRow = () => {
    setMultiRows((prev) => [
      ...prev,
      {
        id: Math.random().toString(36).substring(2, 9),
        blood_group: 'O+',
        component_type: 'PRBC',
        quantity: 5,
        volume_ml: 350,
        expiry_days: 42,
      },
    ]);
  };

  const removeMultiRow = (id: string) => {
    setMultiRows((prev) => prev.filter((r) => r.id !== id));
  };

  const updateMultiRow = (id: string, field: keyof MultiRowItem, value: any) => {
    setMultiRows((prev) =>
      prev.map((r) => {
        if (r.id === id) {
          const updated = { ...r, [field]: value };
          if (field === 'component_type') {
            const comp = value as BloodComponentType;
            const spec = STANDARD_COMPONENT_SPEC[comp];
            if (spec) {
              updated.volume_ml = spec.volume_ml;
              updated.expiry_days = spec.expiry_days;
            }
          }
          return updated;
        }
        return r;
      })
    );
  };

  const loadPreset = (presetName: 'DRIVE' | 'TRAUMA' | 'PLATELETS') => {
    if (presetName === 'DRIVE') {
      setMultiRows([
        { id: '1', blood_group: 'O-', component_type: 'PRBC', quantity: 4, volume_ml: 350, expiry_days: 42 },
        { id: '2', blood_group: 'O+', component_type: 'PRBC', quantity: 8, volume_ml: 350, expiry_days: 42 },
        { id: '3', blood_group: 'A+', component_type: 'PRBC', quantity: 6, volume_ml: 350, expiry_days: 42 },
        { id: '4', blood_group: 'B+', component_type: 'PRBC', quantity: 4, volume_ml: 350, expiry_days: 42 },
        { id: '5', blood_group: 'AB+', component_type: 'FFP', quantity: 2, volume_ml: 250, expiry_days: 365 },
      ]);
    } else if (presetName === 'TRAUMA') {
      setMultiRows([
        { id: '1', blood_group: 'O-', component_type: 'PRBC', quantity: 10, volume_ml: 350, expiry_days: 42 },
        { id: '2', blood_group: 'O+', component_type: 'PRBC', quantity: 10, volume_ml: 350, expiry_days: 42 },
        { id: '3', blood_group: 'AB-', component_type: 'FFP', quantity: 5, volume_ml: 250, expiry_days: 365 },
      ]);
    } else if (presetName === 'PLATELETS') {
      setMultiRows([
        { id: '1', blood_group: 'O+', component_type: 'PLATELETS', quantity: 4, volume_ml: 250, expiry_days: 5 },
        { id: '2', blood_group: 'A+', component_type: 'PLATELETS', quantity: 4, volume_ml: 250, expiry_days: 5 },
        { id: '3', blood_group: 'B+', component_type: 'PLATELETS', quantity: 2, volume_ml: 250, expiry_days: 5 },
      ]);
    }
  };

  const totalMultiRowBags = multiRows.reduce((sum, r) => sum + (Number(r.quantity) || 0), 0);


  const availableCount = units.filter((u) => u.status === 'AVAILABLE').length;
  const lockedCount = units.filter((u) => u.status === 'LOCKED_RESERVE').length;
  const quarantinedCount = units.filter(
    (u) => u.status === 'QUARANTINED' || u.status === 'EXPIRED'
  ).length;

  const volunteerAllocations = activeRequests.flatMap(req =>
    (req.allocations || [])
      .filter((a) => a.source_type === 'LIVE_DONOR')
      .sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())
      .map((a) => ({
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
      {/* Real-time Broadcast & Availability Alert Banner */}
      {liveAlert && (
        <div
          style={{
            background:
              liveAlert.type === 'broadcast'
                ? 'rgba(239, 68, 68, 0.15)'
                : liveAlert.type === 'donor_claim'
                ? 'rgba(16, 185, 129, 0.15)'
                : 'rgba(6, 182, 212, 0.15)',
            border: `1px solid ${
              liveAlert.type === 'broadcast'
                ? 'rgba(239, 68, 68, 0.4)'
                : liveAlert.type === 'donor_claim'
                ? 'rgba(16, 185, 129, 0.4)'
                : 'rgba(6, 182, 212, 0.4)'
            }`,
            borderRadius: '10px',
            padding: '0.85rem 1.25rem',
            marginBottom: '1.25rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '0.85rem',
            boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <span
              style={{
                display: 'inline-block',
                width: '10px',
                height: '10px',
                borderRadius: '50%',
                background:
                  liveAlert.type === 'broadcast'
                    ? 'var(--crimson-500)'
                    : liveAlert.type === 'donor_claim'
                    ? 'var(--emerald-400)'
                    : 'var(--cyan-400)',
                boxShadow: `0 0 8px ${
                  liveAlert.type === 'broadcast'
                    ? 'var(--crimson-500)'
                    : liveAlert.type === 'donor_claim'
                    ? 'var(--emerald-400)'
                    : 'var(--cyan-400)'
                }`,
              }}
            />
            <div>
              <div style={{ fontWeight: 800, fontSize: '0.9rem', color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span>{liveAlert.title}</span>
                <span style={{ fontSize: '0.72rem', color: 'var(--text-dim)', fontWeight: 500 }}>({liveAlert.timestamp})</span>
              </div>
              <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>
                {liveAlert.message}
              </div>
            </div>
          </div>
          <button
            onClick={() => setLiveAlert(null)}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--text-dim)',
              cursor: 'pointer',
              fontSize: '1rem',
              padding: '0.2rem',
            }}
          >
            ✕
          </button>
        </div>
      )}

      {/* Toast / Status Alert Banner */}
      {statusMessage && (
        <div
          style={{
            background: statusMessage.type === 'success' ? 'rgba(22, 163, 74, 0.15)' : 'rgba(239, 68, 68, 0.15)',
            border: `1px solid ${statusMessage.type === 'success' ? 'rgba(22, 163, 74, 0.4)' : 'rgba(239, 68, 68, 0.4)'}`,
            borderRadius: '10px',
            padding: '0.85rem 1.25rem',
            marginBottom: '1.25rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '0.85rem',
            color: statusMessage.type === 'success' ? 'var(--emerald-400)' : 'var(--crimson-500)',
            fontSize: '0.9rem',
            fontWeight: 600,
            boxShadow: '0 4px 12px rgba(0,0,0,0.05)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            {statusMessage.type === 'success' ? <CheckCircle2 size={20} /> : <AlertTriangle size={20} />}
            <span>{statusMessage.text}</span>
          </div>
          <button
            onClick={() => setStatusMessage(null)}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'inherit',
              cursor: 'pointer',
              fontSize: '1rem',
              padding: '0.2rem',
            }}
          >
            ✕
          </button>
        </div>
      )}

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
          <b>Hospital-to-Blood-Bank Pipeline:</b> Emergency requests created by <b>Hospital Admin</b> are automatically matched against this blood bank's stock. You can batch add packets in bulk, review incoming hospital orders, inspect locked cold-chain units, and confirm dispatch to the ambulance.
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
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
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
          <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)', fontWeight: 600 }}>LIVE VOLUNTEER DONORS</div>
          <div style={{ fontSize: '1.8rem', fontWeight: 800, color: 'var(--cyan-400)', marginTop: '0.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span>{activeDonors.length}</span>
            <span className="badge badge-green" style={{ fontSize: '0.7rem', padding: '0.15rem 0.45rem' }}>
              <span style={{ display: 'inline-block', width: '6px', height: '6px', borderRadius: '50%', background: '#10b981', marginRight: '4px' }} />
              Live Available
            </span>
          </div>
        </div>

        <div className="glass-panel">
          <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)', fontWeight: 600 }}>DAMAGED / EXPIRED</div>
          <div style={{ fontSize: '1.8rem', fontWeight: 800, color: 'var(--crimson-500)', marginTop: '0.25rem' }}>
            {quarantinedCount} <span style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>Bags</span>
          </div>
        </div>

        <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', justifyContent: 'center' }}>
          <button
            id="btn-batch-add"
            onClick={() => {
              setModalTab('BATCH_GENERATOR');
              setShowAddModal(true);
            }}
            className="btn btn-cyan"
            style={{ width: '100%', padding: '0.55rem 0.85rem', fontWeight: 700 }}
          >
            <Layers size={16} />
            + Batch Add Packets
          </button>
          <button
            id="btn-add-unit"
            onClick={() => {
              setModalTab('SINGLE');
              setShowAddModal(true);
            }}
            className="btn btn-secondary"
            style={{ width: '100%', fontSize: '0.8rem', padding: '0.35rem 0.6rem' }}
          >
            <Plus size={14} />
            + Single Unit Entry
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
                color: deskFilter === 'ALL' ? '#fff' : 'var(--text-main)',
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
                color: deskFilter === 'ACTION_REQUIRED' ? '#000' : 'var(--text-main)',
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
                color: deskFilter === 'DISPATCHED' ? '#fff' : 'var(--text-main)',
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
          (() => {
            const totalOrders = filteredAndSortedOrders.length;
            const startIdx = (ordersPage - 1) * PAGE_SIZE;
            const visibleOrders = filteredAndSortedOrders.slice(startIdx, startIdx + PAGE_SIZE);
            const totalOrderPages = Math.ceil(totalOrders / PAGE_SIZE) || 1;
            return (
              <div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  {visibleOrders.map((order, index) => {
                    const hasReservedUnits = order.allocated_units.some((u) => u.unit_status === 'LOCKED_RESERVE');
                    const allDispatched = order.allocated_units.length > 0 && order.allocated_units.every((u) => u.unit_status === 'DISPATCHED');
                    return (
                      <div key={order.request_id} id={`order-card-${order.request_id.slice(0, 8)}`} style={{ background: 'var(--color-bg)', padding: '1.2rem', borderRadius: '10px', border: '1px solid var(--border-subtle)', display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '0.5rem' }}>
                          <div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.3rem' }}>
                              <span style={{ fontSize: '0.75rem', fontFamily: 'var(--font-mono)', color: 'var(--text-dim)' }}>#{startIdx + index + 1}</span>
                              <span style={{ fontSize: '1.15rem', fontWeight: 800, color: 'var(--text-main)' }}>{order.hospital_name}</span>
                              <span className={`badge ${allDispatched ? 'badge-green' : 'badge-amber'}`}>{allDispatched ? 'DISPATCHED' : order.status}</span>
                            </div>
                            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                              Patient Token: <code>{order.patient_id_token}</code>
                            </div>
                          </div>
                          <div style={{ textAlign: 'right' }}>
                            <span style={{ fontSize: '1.2rem', fontWeight: 800, color: 'var(--crimson-500)' }}>{order.units_requested}x {order.required_blood_group} ({order.component_type})</span>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>Requested Quantity</div>
                          </div>
                        </div>
                        <div style={{ background: 'var(--color-surface)', padding: '0.75rem', borderRadius: '8px', border: '1px solid var(--border-subtle)' }}>
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)', fontWeight: 700, marginBottom: '0.4rem', textTransform: 'uppercase' }}>Blood Bags Sourced & Allocated:</div>
                          {order.allocated_units.length === 0 && (!order.volunteer_donors || order.volunteer_donors.length === 0) ? (
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
                                  <span>(1 x {u.blood_group})</span>
                                  <span className={`badge ${u.unit_status === 'LOCKED_RESERVE' ? 'badge-amber' : u.unit_status === 'DISPATCHED' ? 'badge-green' : 'badge-red'}`} style={{ fontSize: '0.65rem' }}>
                                    {u.unit_status === 'LOCKED_RESERVE' ? 'Reserved' : u.unit_status === 'DISPATCHED' ? 'Dispatched' : 'Damaged'}
                                  </span>
                                </div>
                              ))}

                              {(() => {
                                const donorMap: Record<string, { count: number; blood_group: string; distance_km?: number; estimated_transit_minutes?: number }> = {};
                                (order.volunteer_donors || []).forEach((vd) => {
                                  if (!donorMap[vd.donor_id]) {
                                    donorMap[vd.donor_id] = { count: 0, blood_group: vd.blood_group, distance_km: vd.distance_km, estimated_transit_minutes: vd.estimated_transit_minutes };
                                  }
                                  donorMap[vd.donor_id].count += 1;
                                });
                                return Object.entries(donorMap).map(([dId, dData]) => (
                                  <div key={dId} style={{ background: 'rgba(16, 185, 129, 0.08)', padding: '0.4rem 0.75rem', borderRadius: '6px', border: '1px solid rgba(16, 185, 129, 0.3)', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                    <Truck size={13} color="var(--emerald-400)" />
                                    <span style={{ fontWeight: 700, color: 'var(--text-main)' }}>
                                      {dData.count} x {dData.blood_group} ({order.component_type})
                                    </span>
                                    <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>
                                      Volunteer Donor {dId.slice(0, 6)}
                                    </span>
                                    <span className="badge badge-green" style={{ fontSize: '0.65rem' }}>
                                      Live Volunteer
                                    </span>
                                  </div>
                                ));
                              })()}
                            </div>
                          )}

                          {order.allocated_units.length > 0 && order.volunteer_donors && order.volunteer_donors.length > 0 && (
                            <div
                              style={{
                                background: 'rgba(6, 182, 212, 0.12)',
                                border: '1px solid rgba(6, 182, 212, 0.35)',
                                borderRadius: '6px',
                                padding: '0.5rem 0.85rem',
                                fontSize: '0.8rem',
                                color: 'var(--cyan-300)',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '0.5rem',
                                marginTop: '0.5rem',
                              }}
                            >
                              <Sparkles size={15} color="var(--cyan-400)" />
                              <span>
                                <b>Update Response:</b> Newly added units in storage matched this demand! Cold-chain stock is reserved for immediate ambulance dispatch alongside volunteer responses.
                              </span>
                            </div>
                          )}
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
                          {!hasReservedUnits && !allDispatched && (order.available_compatible_units?.length ?? 0) > 0 && (
                            <button
                              id={`btn-accept-${order.request_id.slice(0, 8)}`}
                              onClick={() => handleAcceptOrder(order.request_id, true)}
                              disabled={acceptingId === order.request_id}
                              className="btn btn-cyan"
                              style={{ fontSize: '0.85rem', padding: '0.45rem 1rem' }}
                            >
                              {acceptingId === order.request_id ? 'Matching Stock...' : 'Fulfill from Newly Added Stock & Dispatch'}
                            </button>
                          )}
                          {hasReservedUnits && (
                            <button id={`btn-dispatch-${order.request_id.slice(0, 8)}`} onClick={() => handleDispatchOrder(order.request_id)} disabled={dispatchingId === order.request_id} className="btn btn-cyan" style={{ fontSize: '0.85rem', padding: '0.45rem 1rem' }}>
                              <Truck size={15} />{dispatchingId === order.request_id ? 'Handing Over...' : 'Hand to Ambulance (Dispatch)'}
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
                {totalOrders > PAGE_SIZE && (
                  <div style={{ marginTop: '1rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' }}>
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                      Showing {startIdx + 1}–{Math.min(ordersPage * PAGE_SIZE, totalOrders)} of {totalOrders} orders
                    </span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                      {Array.from({ length: totalOrderPages }, (_, i) => i + 1).map((p) => (
                        <button key={p} onClick={() => setOrdersPage(p)} className={`btn ${ordersPage === p ? 'btn-primary' : 'btn-secondary'}`} style={{ minWidth: '32px', padding: '0.25rem 0.5rem', fontSize: '0.78rem' }}>{p}</button>
                      ))}
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
            const sortedActiveReqs = [...activeRequests].sort(
              (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
            );
            const totalReqs = sortedActiveReqs.length;
            const startIdx = (requestsPage - 1) * PAGE_SIZE;
            const visibleReqs = sortedActiveReqs.slice(startIdx, startIdx + PAGE_SIZE);
            const totalReqPages = Math.ceil(totalReqs / PAGE_SIZE) || 1;
            return (
              <div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
                  {visibleReqs.map((req, index) => (
                    <div key={req.id} style={{ background: 'var(--color-bg)', padding: '1rem', borderRadius: '8px', border: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.2rem' }}>
                          <span style={{ fontSize: '0.75rem', fontFamily: 'var(--font-mono)', color: 'var(--text-dim)' }}>#{startIdx + index + 1}</span>
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
                {totalReqs > PAGE_SIZE && (
                  <div style={{ marginTop: '1rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' }}>
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                      Showing {startIdx + 1}–{Math.min(requestsPage * PAGE_SIZE, totalReqs)} of {totalReqs} requests
                    </span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                      {Array.from({ length: totalReqPages }, (_, i) => i + 1).map((p) => (
                        <button key={p} onClick={() => setRequestsPage(p)} className={`btn ${requestsPage === p ? 'btn-primary' : 'btn-secondary'}`} style={{ minWidth: '32px', padding: '0.25rem 0.5rem', fontSize: '0.78rem' }}>{p}</button>
                      ))}
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
            const startIdx = (donorsPage - 1) * PAGE_SIZE;
            const visibleDonors = displayedDonors.slice(startIdx, startIdx + PAGE_SIZE);
            const totalDonorPages = Math.ceil(totalDonors / PAGE_SIZE) || 1;
            return (
              <div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
                  {visibleDonors.map(({ donor, activeDispatch }, index) => (
                    <div key={donor.id} style={{ background: 'var(--color-bg)', padding: '1rem', borderRadius: '8px', border: '1px solid var(--color-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.2rem' }}>
                          <span style={{ fontSize: '0.75rem', fontFamily: 'var(--font-mono)', color: 'var(--text-dim)' }}>#{startIdx + index + 1}</span>
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
                {totalDonors > PAGE_SIZE && (
                  <div style={{ marginTop: '1rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' }}>
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                      Showing {startIdx + 1}–{Math.min(donorsPage * PAGE_SIZE, totalDonors)} of {totalDonors} donors
                    </span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                      {Array.from({ length: totalDonorPages }, (_, i) => i + 1).map((p) => (
                        <button key={p} onClick={() => setDonorsPage(p)} className={`btn ${donorsPage === p ? 'btn-primary' : 'btn-secondary'}`} style={{ minWidth: '32px', padding: '0.25rem 0.5rem', fontSize: '0.78rem' }}>{p}</button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })()
        )}
      </div>

      {/* Inventory Stock Table */}
      <div className="glass-panel">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <h2 style={{ fontSize: '1.2rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Droplet size={20} color="var(--crimson-500)" />
              All Blood Bags in Cold Storage
            </h2>
            <span className="badge badge-cyan">{units.length} Total Units</span>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button
              onClick={() => {
                setModalTab('BATCH_GENERATOR');
                setShowAddModal(true);
              }}
              className="btn btn-cyan"
              style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem' }}
            >
              <Layers size={14} />
              + Batch Add
            </button>
            <button onClick={fetchInventoryAndOrders} className="btn btn-secondary" style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem' }}>
              <RefreshCw size={14} className={loading ? 'spin' : ''} />
              Refresh
            </button>
          </div>
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
                const startIdx = unitsPage === -1 ? 0 : (unitsPage - 1) * PAGE_SIZE;
                const visibleUnits = unitsPage === -1 ? units : units.slice(startIdx, startIdx + PAGE_SIZE);
                const totalUnitPages = Math.ceil(totalUnits / PAGE_SIZE) || 1;
                return (
                  <>
                    {visibleUnits.map((unit, index) => {
                      const isLocked = unit.status === 'LOCKED_RESERVE';
                      return (
                        <tr key={unit.id} id={`unit-row-${unit.batch_number.toLowerCase()}`} style={{ borderBottom: '1px solid var(--color-border)', background: isLocked ? 'rgba(217, 119, 6, 0.06)' : 'transparent' }}>
                          <td style={{ padding: '0.75rem', fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--text-dim)', fontSize: '0.78rem' }}>#{startIdx + index + 1}</td>
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
                    {totalUnits > PAGE_SIZE && (
                      <tr>
                        <td colSpan={8} style={{ padding: '0.85rem', textAlign: 'center' }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' }}>
                            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                              Showing {unitsPage === -1 ? `All ${totalUnits}` : `${startIdx + 1}–${Math.min(unitsPage * PAGE_SIZE, totalUnits)}`} of {totalUnits} bags
                            </span>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                              {Array.from({ length: totalUnitPages }, (_, i) => i + 1).map((p) => (
                                <button key={p} onClick={() => setUnitsPage(p)} className={`btn ${unitsPage === p ? 'btn-primary' : 'btn-secondary'}`} style={{ minWidth: '32px', padding: '0.25rem 0.5rem', fontSize: '0.78rem' }}>{p}</button>
                              ))}
                              <button onClick={() => setUnitsPage(unitsPage === -1 ? 1 : -1)} className={`btn ${unitsPage === -1 ? 'btn-primary' : 'btn-secondary'}`} style={{ padding: '0.25rem 0.6rem', fontSize: '0.78rem' }}>{unitsPage === -1 ? 'Paginate' : 'All'}</button>
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

      {/* SECTION: AI Demand & Wastage Intelligence */}
      <div className="glass-panel" style={{ marginBottom: '1.75rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem', marginBottom: '1.25rem' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
              <Sparkles size={22} color="var(--color-info)" />
              <h2 style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--text-main)', margin: 0 }}>AI Demand &amp; Wastage Intelligence</h2>
              <span className="badge badge-purple">{forecastSummary?.model_version || 'smartblood-ml-v1'}</span>
            </div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
              Next-day predictive decision support across 4 frozen ML models.
              <span style={{ color: 'var(--color-success)', fontWeight: 600, marginLeft: '0.5rem' }}>● Advisory Only (Zero Lock Impact)</span>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            {['ALL', 'PRBC', 'PLATELETS', 'FFP'].map((comp) => (
              <button
                key={comp}
                onClick={() => {
                  setComponentFilter(comp);
                  setForecastPage(1);
                }}
                className={`btn ${componentFilter === comp ? 'btn-primary' : 'btn-secondary'}`}
                style={{ fontSize: '0.75rem', padding: '0.3rem 0.75rem' }}
              >
                {comp === 'ALL' ? 'All Components' : comp}
              </button>
            ))}
          </div>
        </div>
        {/* KPI Strip */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.85rem', marginBottom: '1.25rem' }}>
          <div style={{ background: 'var(--color-bg)', padding: '0.85rem 1rem', borderRadius: '8px', border: '1px solid var(--border-subtle)' }}>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-dim)', fontWeight: 600 }}>NEXT-DAY PROJECTED DEMAND</div>
            <div style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--color-info)', marginTop: '0.2rem' }}>
              {Math.ceil(forecasts.reduce((sum, f) => sum + f.predicted_demand, 0))} <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Units</span>
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
        ) : (() => {
          const filteredForecasts = forecasts.filter((f) => componentFilter === 'ALL' || f.component_type === componentFilter);
          const totalForecastPages = Math.max(1, Math.ceil(filteredForecasts.length / FORECAST_PAGE_SIZE));
          const currentForecastPage = Math.min(forecastPage, totalForecastPages);
          const startIdx = (currentForecastPage - 1) * FORECAST_PAGE_SIZE;
          const displayedForecasts = filteredForecasts.slice(startIdx, startIdx + FORECAST_PAGE_SIZE);

          return (
            <div>
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
                    {displayedForecasts.map((f) => {
                      const isCritical = f.operational_status === 'Critical Shortage';
                      const isHighShortage = f.operational_status === 'High Shortage Risk';
                      const isWastage = f.operational_status === 'High Wastage Risk';
                      const isSpike = f.operational_status === 'Demand Spike Risk';
                      const statusBadgeClass = isCritical ? 'badge-red' : isHighShortage ? 'badge-amber' : isWastage ? 'badge-purple' : isSpike ? 'badge-amber' : f.operational_status === 'Monitor Inventory' ? 'badge-cyan' : 'badge-green';
                      return (
                        <tr key={`${f.blood_group}-${f.component_type}`} style={{ borderBottom: '1px solid var(--border-subtle)', background: isCritical ? 'rgba(239, 68, 68, 0.04)' : isWastage ? 'rgba(126, 34, 206, 0.04)' : 'transparent' }}>
                          <td style={{ padding: '0.65rem' }}>
                            <span style={{ fontWeight: 800, color: 'var(--text-main)', fontSize: '0.95rem' }}>{f.blood_group}</span>{' '}
                            <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>({f.component_type})</span>
                          </td>
                          <td style={{ padding: '0.65rem', fontWeight: 700 }}>
                            <span style={{ color: f.closing_inventory === 0 ? 'var(--crimson-500)' : 'var(--text-main)' }}>{Math.round(f.closing_inventory)}</span>{' '}
                            <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>units</span>
                          </td>
                          <td style={{ padding: '0.65rem' }}>
                            <div style={{ fontWeight: 700, color: 'var(--text-main)' }}>{Math.ceil(f.predicted_demand)}{' '}<span style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>units</span></div>
                            {f.is_spike_predicted && (
                              <div style={{ fontSize: '0.7rem', color: 'var(--amber-500)', display: 'flex', alignItems: 'center', gap: '0.2rem' }}>
                                <TrendingUp size={11} /> Surge Headroom: {Math.ceil(f.spike_headroom_demand)}u
                              </div>
                            )}
                          </td>
                          <td style={{ padding: '0.65rem' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                              <div style={{ width: '45px', height: '6px', background: 'var(--border-subtle)', borderRadius: '3px', overflow: 'hidden' }}>
                                <div style={{ width: `${Math.min((f.predicted_coverage_days / 5) * 100, 100)}%`, height: '100%', background: f.predicted_coverage_days < 2 ? 'var(--crimson-500)' : f.predicted_coverage_days < 5 ? 'var(--amber-500)' : 'var(--emerald-500)' }} />
                              </div>
                              <span style={{ fontSize: '0.78rem', fontWeight: 700, color: f.predicted_coverage_days < 2 ? 'var(--crimson-500)' : f.predicted_coverage_days < 5 ? 'var(--amber-500)' : 'var(--emerald-500)' }}>
                                {f.predicted_coverage_days >= 99 ? '> 99d' : `${f.predicted_coverage_days.toFixed(1)}d`}
                              </span>
                            </div>
                          </td>
                          <td style={{ padding: '0.65rem', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                            <div>Spike: <b>{Math.round(f.spike_risk_score * 100)}%</b></div>
                            <div>Wastage: <b style={{ color: f.wastage_risk_score >= 0.75 ? 'var(--crimson-500)' : 'inherit' }}>{Math.round(f.wastage_risk_score * 100)}%</b></div>
                          </td>
                          <td style={{ padding: '0.65rem' }}>
                            <span className={`badge ${statusBadgeClass}`} style={{ fontSize: '0.72rem' }}>{f.operational_status}</span>
                          </td>
                          <td style={{ padding: '0.65rem', fontSize: '0.78rem', color: 'var(--text-main)', maxWidth: '280px' }}>{f.recommended_action}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Forecast Pagination Bar */}
              {totalForecastPages > 1 && (
                <div style={{ marginTop: '1rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem', padding: '0.5rem 0.25rem', borderTop: '1px solid var(--border-subtle)' }}>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                    Showing <b>{startIdx + 1}–{Math.min(startIdx + FORECAST_PAGE_SIZE, filteredForecasts.length)}</b> of <b>{filteredForecasts.length}</b> series (Page {currentForecastPage} of {totalForecastPages})
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    <button
                      onClick={() => setForecastPage((p) => Math.max(1, p - 1))}
                      disabled={currentForecastPage === 1}
                      className="btn btn-secondary"
                      style={{ fontSize: '0.78rem', padding: '0.25rem 0.6rem', opacity: currentForecastPage === 1 ? 0.5 : 1, cursor: currentForecastPage === 1 ? 'not-allowed' : 'pointer' }}
                    >
                      &larr; Prev
                    </button>
                    {Array.from({ length: totalForecastPages }, (_, i) => i + 1).map((p) => (
                      <button
                        key={p}
                        onClick={() => setForecastPage(p)}
                        className={`btn ${currentForecastPage === p ? 'btn-primary' : 'btn-secondary'}`}
                        style={{ minWidth: '32px', padding: '0.25rem 0.55rem', fontSize: '0.78rem', fontWeight: currentForecastPage === p ? 700 : 500 }}
                      >
                        Page {p}
                      </button>
                    ))}
                    <button
                      onClick={() => setForecastPage((p) => Math.min(totalForecastPages, p + 1))}
                      disabled={currentForecastPage === totalForecastPages}
                      className="btn btn-secondary"
                      style={{ fontSize: '0.78rem', padding: '0.25rem 0.6rem', opacity: currentForecastPage === totalForecastPages ? 0.5 : 1, cursor: currentForecastPage === totalForecastPages ? 'not-allowed' : 'pointer' }}
                    >
                      Next &rarr;
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })()}
      </div>

      {/* Modern Batch & Single Blood Packets Modal */}
      {showAddModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0, 0, 0, 0.65)',
          backdropFilter: 'blur(8px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
          padding: '1rem',
        }}>
          <div
            className="glass-panel"
            style={{
              maxWidth: modalTab === 'MULTI_ROW' ? '740px' : '560px',
              width: '100%',
              maxHeight: '90vh',
              overflowY: 'auto',
              background: 'var(--color-surface)',
              border: '1px solid var(--border-subtle)',
              boxShadow: '0 20px 40px rgba(0,0,0,0.25)',
              borderRadius: '14px',
              padding: '1.5rem',
            }}
          >
            {/* Modal Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
              <div>
                <h3 style={{ fontSize: '1.3rem', fontWeight: 800, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <Package size={22} color="var(--cyan-400)" />
                  Add Blood Packets to Inventory
                </h3>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
                  Register cold-chain units into active storage. Batch additions trigger immediate re-planning for pending hospital requests.
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="btn btn-secondary"
                style={{ padding: '0.3rem 0.6rem', fontSize: '0.85rem' }}
              >
                ✕
              </button>
            </div>

            {/* Mode Tabs */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, 1fr)',
              gap: '0.5rem',
              background: 'var(--color-bg)',
              padding: '0.35rem',
              borderRadius: '8px',
              marginBottom: '1.25rem',
            }}>
              <button
                type="button"
                id="tab-batch-gen"
                onClick={() => setModalTab('BATCH_GENERATOR')}
                style={{
                  padding: '0.55rem 0.5rem',
                  fontSize: '0.8rem',
                  fontWeight: 700,
                  borderRadius: '6px',
                  border: 'none',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.35rem',
                  background: modalTab === 'BATCH_GENERATOR' ? 'var(--cyan-500)' : 'transparent',
                  color: modalTab === 'BATCH_GENERATOR' ? '#fff' : 'var(--text-muted)',
                  transition: 'all 0.15s ease',
                }}
              >
                <Layers size={14} />
                Quick Batch (Qty)
              </button>
              <button
                type="button"
                id="tab-multi-row"
                onClick={() => setModalTab('MULTI_ROW')}
                style={{
                  padding: '0.55rem 0.5rem',
                  fontSize: '0.8rem',
                  fontWeight: 700,
                  borderRadius: '6px',
                  border: 'none',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.35rem',
                  background: modalTab === 'MULTI_ROW' ? 'var(--cyan-500)' : 'transparent',
                  color: modalTab === 'MULTI_ROW' ? '#fff' : 'var(--text-muted)',
                  transition: 'all 0.15s ease',
                }}
              >
                <Sparkles size={14} />
                Multi-Type Batch
              </button>
              <button
                type="button"
                id="tab-single"
                onClick={() => setModalTab('SINGLE')}
                style={{
                  padding: '0.55rem 0.5rem',
                  fontSize: '0.8rem',
                  fontWeight: 700,
                  borderRadius: '6px',
                  border: 'none',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.35rem',
                  background: modalTab === 'SINGLE' ? 'var(--cyan-500)' : 'transparent',
                  color: modalTab === 'SINGLE' ? '#fff' : 'var(--text-muted)',
                  transition: 'all 0.15s ease',
                }}
              >
                <Plus size={14} />
                Single Packet
              </button>
            </div>

            {/* TAB 1: Quick Batch Generator */}
            {modalTab === 'BATCH_GENERATOR' && (
              <form onSubmit={handleBatchGeneratorSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <div style={{
                  background: 'rgba(6, 182, 212, 0.08)',
                  border: '1px solid rgba(6, 182, 212, 0.25)',
                  borderRadius: '8px',
                  padding: '0.75rem 1rem',
                  fontSize: '0.8rem',
                  color: 'var(--color-info)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                }}>
                  <Layers size={16} />
                  <span>Batch log multiple identical blood packets with sequential barcode generation.</span>
                </div>

                {/* Quantity with quick buttons */}
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem' }}>
                    <label style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-main)' }}>
                      Quantity of Bags to Add *
                    </label>
                    <span className="badge badge-cyan" style={{ fontSize: '0.75rem', fontWeight: 800 }}>
                      {batchQuantity} Bags
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                    <input
                      id="input-batch-quantity"
                      type="number"
                      min="1"
                      max="100"
                      className="input-field"
                      value={batchQuantity}
                      onChange={(e) => setBatchQuantity(Math.max(1, Math.min(100, Number(e.target.value) || 1)))}
                      style={{ maxWidth: '120px', fontWeight: 800, fontSize: '1.1rem' }}
                      required
                    />
                    <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                      {[1, 5, 10, 20, 50].map((qty) => (
                        <button
                          key={qty}
                          type="button"
                          onClick={() => setBatchQuantity(qty)}
                          className="btn btn-secondary"
                          style={{
                            padding: '0.3rem 0.6rem',
                            fontSize: '0.75rem',
                            fontWeight: batchQuantity === qty ? 800 : 500,
                            borderColor: batchQuantity === qty ? 'var(--cyan-400)' : 'var(--border-subtle)',
                            color: batchQuantity === qty ? 'var(--cyan-400)' : 'var(--text-muted)',
                          }}
                        >
                          +{qty}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.85rem' }}>
                  <div>
                    <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted)' }}>Blood Group</label>
                    <select
                      id="select-batch-blood-group"
                      className="select-field"
                      value={batchBloodGroup}
                      onChange={(e) => setBatchBloodGroup(e.target.value)}
                    >
                      {['O-', 'O+', 'A-', 'A+', 'B-', 'B+', 'AB-', 'AB+'].map((bg) => (
                        <option key={bg} value={bg}>{bg}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted)' }}>Component Type</label>
                    <select
                      id="select-batch-component"
                      className="select-field"
                      value={batchComponent}
                      onChange={(e) => {
                        const comp = e.target.value as BloodComponentType;
                        setBatchComponent(comp);
                        const spec = STANDARD_COMPONENT_SPEC[comp];
                        if (spec) {
                          setBatchVolume(spec.volume_ml);
                          setBatchExpiryDays(spec.expiry_days);
                        }
                      }}
                    >
                      <option value="PRBC">PRBC (Packed Red Blood Cells - 350 mL)</option>
                      <option value="WHOLE_BLOOD">Whole Blood (450 mL)</option>
                      <option value="PLATELETS">Platelets (250 mL)</option>
                      <option value="FFP">Fresh Frozen Plasma - FFP (250 mL)</option>
                      <option value="CRYOPRECIPITATE">Cryoprecipitate (20 mL)</option>
                    </select>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '0.75rem' }}>
                  <div>
                    <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted)' }}>Batch Code Prefix</label>
                    <input
                      id="input-batch-prefix"
                      type="text"
                      placeholder="e.g. BB-DRIVE-"
                      className="input-field"
                      value={batchPrefix}
                      onChange={(e) => setBatchPrefix(e.target.value)}
                    />
                  </div>
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted)' }}>Shelf Life (Days)</label>
                      <span className="badge" style={{ fontSize: '0.68rem', padding: '0.1rem 0.35rem', background: 'var(--color-surface)' }}>Auto</span>
                    </div>
                    <input
                      type="number"
                      min="1"
                      max="365"
                      className="input-field"
                      value={batchExpiryDays}
                      onChange={(e) => setBatchExpiryDays(Number(e.target.value))}
                    />
                  </div>
                </div>

                {/* Batch preview */}
                <div style={{
                  background: 'var(--color-bg)',
                  border: '1px dashed var(--border-subtle)',
                  borderRadius: '8px',
                  padding: '0.75rem',
                  fontSize: '0.8rem',
                }}>
                  <div style={{ color: 'var(--text-muted)', fontWeight: 600, marginBottom: '0.35rem' }}>
                    Summary Preview:
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-main)', fontWeight: 700 }}>
                    <span>{batchQuantity}x {batchBloodGroup} ({batchComponent}) @ {batchVolume} mL</span>
                    <span>Total: {(batchQuantity * batchVolume).toLocaleString()} mL</span>
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)', marginTop: '0.35rem' }}>
                    Codes: <code>{batchPrefix.trim() || 'BB-'}001</code> ... <code>{batchPrefix.trim() || 'BB-'}{batchQuantity < 10 ? `00${batchQuantity}` : `0${batchQuantity}`}</code> (expires in {batchExpiryDays} days)
                  </div>
                </div>

                {/* Actions */}
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '0.5rem' }}>
                  <button type="button" onClick={() => setShowAddModal(false)} className="btn btn-secondary">
                    Cancel
                  </button>
                  <button
                    id="btn-submit-batch-gen"
                    type="submit"
                    disabled={submitting}
                    className="btn btn-cyan"
                    style={{ fontWeight: 800, padding: '0.55rem 1.25rem' }}
                  >
                    {submitting ? 'Registering Batch...' : `+ Batch Register ${batchQuantity} Blood Packets`}
                  </button>
                </div>
              </form>
            )}

            {/* TAB 2: Multi-Type Donation Drive Table */}
            {modalTab === 'MULTI_ROW' && (
              <form onSubmit={handleMultiRowSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                    Add multiple blood types and quantities from donation drives or incoming shipments at once.
                  </div>
                  <div style={{ display: 'flex', gap: '0.35rem' }}>
                    <button
                      type="button"
                      onClick={() => loadPreset('DRIVE')}
                      className="btn btn-secondary"
                      style={{ fontSize: '0.75rem', padding: '0.25rem 0.5rem' }}
                      title="Load standard community drive distribution"
                    >
                      Drive Preset (24 Bags)
                    </button>
                    <button
                      type="button"
                      onClick={() => loadPreset('TRAUMA')}
                      className="btn btn-secondary"
                      style={{ fontSize: '0.75rem', padding: '0.25rem 0.5rem' }}
                      title="Load high emergency trauma stock"
                    >
                      Trauma Stock (25 Bags)
                    </button>
                  </div>
                </div>

                {/* Rows Table */}
                <div style={{ overflowX: 'auto', border: '1px solid var(--border-subtle)', borderRadius: '8px' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                    <thead>
                      <tr style={{ background: 'var(--color-bg)', borderBottom: '1px solid var(--border-subtle)', textAlign: 'left', color: 'var(--text-muted)' }}>
                        <th style={{ padding: '0.5rem 0.6rem' }}>BLOOD GROUP</th>
                        <th style={{ padding: '0.5rem 0.6rem' }}>COMPONENT</th>
                        <th style={{ padding: '0.5rem 0.6rem', width: '100px' }}>QTY</th>
                        <th style={{ padding: '0.5rem 0.6rem', width: '100px' }}>SHELF (d)</th>
                        <th style={{ padding: '0.5rem 0.6rem', textAlign: 'center', width: '45px' }}>DEL</th>
                      </tr>
                    </thead>
                    <tbody>
                      {multiRows.map((row) => (
                        <tr key={row.id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                          <td style={{ padding: '0.4rem 0.6rem' }}>
                            <select
                              className="select-field"
                              value={row.blood_group}
                              onChange={(e) => updateMultiRow(row.id, 'blood_group', e.target.value)}
                              style={{ padding: '0.35rem 0.5rem', fontSize: '0.8rem' }}
                            >
                              {['O-', 'O+', 'A-', 'A+', 'B-', 'B+', 'AB-', 'AB+'].map((bg) => (
                                <option key={bg} value={bg}>{bg}</option>
                              ))}
                            </select>
                          </td>
                          <td style={{ padding: '0.4rem 0.6rem' }}>
                            <select
                              className="select-field"
                              value={row.component_type}
                              onChange={(e) => updateMultiRow(row.id, 'component_type', e.target.value as BloodComponentType)}
                              style={{ padding: '0.35rem 0.5rem', fontSize: '0.8rem' }}
                            >
                              <option value="PRBC">PRBC (350 mL)</option>
                              <option value="WHOLE_BLOOD">Whole Blood (450 mL)</option>
                              <option value="PLATELETS">Platelets (250 mL)</option>
                              <option value="FFP">FFP (250 mL)</option>
                              <option value="CRYOPRECIPITATE">Cryoprecipitate (20 mL)</option>
                            </select>
                          </td>
                          <td style={{ padding: '0.4rem 0.6rem' }}>
                            <input
                              type="number"
                              min="1"
                              max="100"
                              className="input-field"
                              value={row.quantity}
                              onChange={(e) => updateMultiRow(row.id, 'quantity', Math.max(1, Number(e.target.value) || 1))}
                              style={{ padding: '0.35rem 0.5rem', fontSize: '0.8rem', fontWeight: 700 }}
                            />
                          </td>
                          <td style={{ padding: '0.4rem 0.6rem' }}>
                            <input
                              type="number"
                              min="1"
                              max="365"
                              className="input-field"
                              value={row.expiry_days}
                              onChange={(e) => updateMultiRow(row.id, 'expiry_days', Number(e.target.value) || 42)}
                              style={{ padding: '0.35rem 0.5rem', fontSize: '0.8rem' }}
                            />
                          </td>
                          <td style={{ padding: '0.4rem 0.6rem', textAlign: 'center' }}>
                            {multiRows.length > 1 && (
                              <button
                                type="button"
                                onClick={() => removeMultiRow(row.id)}
                                style={{
                                  background: 'transparent',
                                  border: 'none',
                                  color: 'var(--crimson-500)',
                                  cursor: 'pointer',
                                  padding: '0.2rem',
                                }}
                              >
                                <Trash2 size={15} />
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <button
                    type="button"
                    onClick={addMultiRow}
                    className="btn btn-secondary"
                    style={{ fontSize: '0.8rem', padding: '0.35rem 0.75rem' }}
                  >
                    <Plus size={14} />
                    + Add Blood Type Row
                  </button>
                  <div style={{ fontSize: '0.9rem', fontWeight: 800, color: 'var(--text-main)' }}>
                    Total Packets to Add: <span style={{ color: 'var(--cyan-400)', fontSize: '1.1rem' }}>{totalMultiRowBags} Bags</span>
                  </div>
                </div>

                {/* Actions */}
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '0.5rem' }}>
                  <button type="button" onClick={() => setShowAddModal(false)} className="btn btn-secondary">
                    Cancel
                  </button>
                  <button
                    id="btn-submit-multi-row"
                    type="submit"
                    disabled={submitting || totalMultiRowBags === 0}
                    className="btn btn-cyan"
                    style={{ fontWeight: 800, padding: '0.55rem 1.25rem' }}
                  >
                    {submitting ? 'Registering...' : `+ Batch Register All ${totalMultiRowBags} Packets`}
                  </button>
                </div>
              </form>
            )}

            {/* TAB 3: Single Unit Form */}
            {modalTab === 'SINGLE' && (
              <form onSubmit={handleAddSingleUnit} style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
                <div>
                  <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted)' }}>Custom Barcode / Batch Number (optional)</label>
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
                    <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted)' }}>Blood Group</label>
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
                    <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted)' }}>Component Type</label>
                    <select
                      className="select-field"
                      value={newComponent}
                      onChange={(e) => {
                        const comp = e.target.value as BloodComponentType;
                        setNewComponent(comp);
                        const spec = STANDARD_COMPONENT_SPEC[comp];
                        if (spec) {
                          setNewVolume(spec.volume_ml);
                          setNewExpiryDays(spec.expiry_days);
                        }
                      }}
                    >
                      <option value="PRBC">PRBC (Packed Red Blood Cells - 350 mL)</option>
                      <option value="WHOLE_BLOOD">Whole Blood (450 mL)</option>
                      <option value="PLATELETS">Platelets (250 mL)</option>
                      <option value="FFP">Fresh Frozen Plasma - FFP (250 mL)</option>
                      <option value="CRYOPRECIPITATE">Cryoprecipitate (20 mL)</option>
                    </select>
                  </div>
                </div>
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted)' }}>Shelf Life (Days)</label>
                    <span className="badge" style={{ fontSize: '0.68rem', padding: '0.1rem 0.35rem', background: 'var(--color-surface)' }}>Auto</span>
                  </div>
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
                  <button type="submit" disabled={submitting} className="btn btn-cyan">
                    {submitting ? 'Registering...' : 'Register Single Unit'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

