import React, { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useWebSocket } from '../context/WebSocketContext';
import { api } from '../lib/api';
import { BloodRequest, Donor, DonorRespondResult } from '../types';
import { UserCheck, MapPin, CheckCircle, XCircle, AlertCircle, X, Radio, Navigation } from 'lucide-react';

export const DonorDashboard: React.FC = () => {
  const { user } = useAuth();
  const { lastEvent } = useWebSocket();

  const [donorProfile, setDonorProfile] = useState<Donor | null>(null);
  const [activeAlerts, setActiveAlerts] = useState<BloodRequest[]>([]);
  const [responseStatus, setResponseStatus] = useState<{ text: string; ok: boolean } | null>(null);
  const [lastResult, setLastResult] = useState<DonorRespondResult | null>(null);
  /** Alerts the donor has pushed aside, so the full-screen panel is not permanent. */
  const [dismissedAlertIds, setDismissedAlertIds] = useState<string[]>([]);

  // Pagination for alerts
  const PAGE_SIZE = 5;
  const [alertsPage, setAlertsPage] = useState(1);

  // GPS & Telemetry Tracking State
  const [gpsSyncing, setGpsSyncing] = useState(false);
  const [gpsMessage, setGpsMessage] = useState<string | null>(null);
  const [telemetrySending, setTelemetrySending] = useState(false);
  const [telemetryStatus, setTelemetryStatus] = useState<string | null>(null);

  const fetchDonorData = useCallback(async () => {
    try {
      const [profile, alerts] = await Promise.all([
        api.get<Donor>('/donors/me'),
        api.get<BloodRequest[]>('/donors/requests/active'),
      ]);
      setDonorProfile(profile);
      setActiveAlerts(alerts);

      // Drop dismissals for alerts that no longer exist, so a re-issued alert reopens.
      setDismissedAlertIds((prev) => prev.filter((id) => alerts.some((a) => a.id === id)));
    } catch (err) {
      console.error('Error fetching donor data:', err);
    }
  }, []);

  useEffect(() => {
    fetchDonorData();
  }, [fetchDonorData, user]);

  useEffect(() => {
    if (
      lastEvent &&
      [
        'EMERGENCY_DISPATCH_ALERT',
        'REQUEST_CREATED',
        'DONOR_CLAIM_SUCCESS',
        'DONOR_STAND_DOWN',
        'DONOR_AVAILABILITY_CHANGED',
        'RE_PLANNING_TRIGGERED',
        'SYSTEM_RESET',
      ].includes(lastEvent.type)
    ) {
      fetchDonorData();
    }
  }, [lastEvent, fetchDonorData]);

  const syncBrowserGps = () => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setGpsMessage('Browser geolocation is not available in this environment.');
      return;
    }
    setGpsSyncing(true);
    setGpsMessage(null);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const lat = Number(pos.coords.latitude.toFixed(6));
          const lon = Number(pos.coords.longitude.toFixed(6));
          const updated = await api.patch<Donor>('/donors/availability', {
            is_available: true,
            latitude: lat,
            longitude: lon,
          });
          setDonorProfile(updated);
          setGpsMessage(`Live GPS locked: ${lat}, ${lon} (±${Math.round(pos.coords.accuracy)}m)`);
        } catch (err) {
          setGpsMessage(err instanceof Error ? err.message : 'Could not save GPS coordinates.');
        } finally {
          setGpsSyncing(false);
        }
      },
      (err) => {
        setGpsSyncing(false);
        setGpsMessage(`GPS Error: ${err.message}`);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const transmitTelemetry = async (simulateNearHospital = false) => {
    setTelemetrySending(true);
    try {
      // Default to Bangalore clinical geofence center if coordinates not yet acquired
      let lat = donorProfile?.latitude ?? 12.9716;
      let lon = donorProfile?.longitude ?? 77.5946;

      if (simulateNearHospital) {
        // Position ~300m north of Metro General Hospital (12.9716, 77.5946) to trigger 500m ward proximity alert
        lat = 12.9740;
        lon = 77.5946;
      }

      const res = await api.post<{
        donor_id: string;
        distance_km?: number;
        estimated_transit_minutes?: number;
        geofence_triggered?: boolean;
        message?: string;
      }>('/donors/me/telemetry', {
        latitude: lat,
        longitude: lon,
        speed_kmh: 40.0,
      });

      setTelemetryStatus(
        res.message ||
        `Telemetry synced: ${res.distance_km ?? 0} km away, ETA ~${res.estimated_transit_minutes ?? 1} min`
      );
      await fetchDonorData();
    } catch (err) {
      setTelemetryStatus(err instanceof Error ? err.message : 'Telemetry transmission failed.');
    } finally {
      setTelemetrySending(false);
    }
  };

  /** Per-alert bag count the donor has selected. */
  const [bagCounts, setBagCounts] = useState<Record<string, number>>({});
  /** Which alert is currently in the "confirm bags" inline flow. */
  const [pendingAccept, setPendingAccept] = useState<string | null>(null);

  const toggleAvailability = async () => {
    if (!donorProfile) return;
    try {
      const updated = await api.patch<Donor>('/donors/availability', {
        is_available: !donorProfile.is_available,
      });
      setDonorProfile(updated);
    } catch (err) {
      console.error('Error updating availability:', err);
      setResponseStatus({
        text: err instanceof Error ? err.message : 'Could not update your availability.',
        ok: false,
      });
    }
  };

  const handleRespond = async (requestId: string, action: 'ACCEPT' | 'DECLINE', bagsOffered?: number) => {
    setPendingAccept(null);
    try {
      const payload: Record<string, unknown> = { action };
      if (action === 'ACCEPT') {
        payload.bags_offered = bagsOffered ?? 1;
      }
      const result = await api.post<DonorRespondResult>(
        `/donors/requests/${requestId}/respond`,
        payload
      );

      if (action === 'ACCEPT') {
        setLastResult(result);
        const bagsText = bagsOffered && bagsOffered > 1 ? ` for ${bagsOffered} bags` : '';
        setResponseStatus({
          text: `Thank you! Your commitment${bagsText} is confirmed. Please head toward the hospital.`,
          ok: true,
        });
      } else {
        setResponseStatus({ text: 'You declined. We will notify other nearby volunteers.', ok: true });
      }
      await fetchDonorData();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to submit your response.';
      setResponseStatus({ text: message, ok: false });
    }
  };

  /** Opens the inline bag-count picker for a specific alert. */
  const handleAcceptClick = (requestId: string, maxBags: number) => {
    // If only 1 bag needed, skip the picker and accept immediately
    if (maxBags <= 1) {
      handleRespond(requestId, 'ACCEPT', 1);
      return;
    }
    setBagCounts((prev) => ({ ...prev, [requestId]: prev[requestId] ?? 1 }));
    setPendingAccept(requestId);
  };

  const dismissAlert = (requestId: string) => {
    setDismissedAlertIds((prev) => [...prev, requestId]);
  };

  const visibleAlerts = activeAlerts.filter(
    (alert) => !dismissedAlertIds.includes(alert.id)
  );

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(280px, 360px) 1fr', gap: '1.5rem' }}>
      {/* Donor Profile Summary */}
      <div className="glass-panel" style={{ height: 'fit-content' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem', marginBottom: '1.25rem' }}>
          <div style={{
            width: '48px',
            height: '48px',
            borderRadius: '50%',
            background: 'linear-gradient(135deg, var(--crimson-500), #991b1b)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'white',
            fontWeight: 800,
            fontSize: '1.2rem',
          }}>
            {donorProfile ? donorProfile.blood_group : '🩸'}
          </div>
          <div>
            <h2 style={{ fontSize: '1.15rem', fontWeight: 700 }}>{user?.full_name || 'Donor Profile'}</h2>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{user?.email}</p>
          </div>
        </div>

        {donorProfile && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.5rem 0', borderBottom: '1px solid var(--border-subtle)' }}>
              <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Blood Group</span>
              <span style={{ fontWeight: 800, color: 'var(--crimson-500)', fontSize: '1.1rem' }}>{donorProfile.blood_group}</span>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.5rem 0', borderBottom: '1px solid var(--border-subtle)' }}>
              <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Reliability Rating</span>
              <span style={{ fontWeight: 700, color: 'var(--emerald-400)' }}>
                {(donorProfile.reliability_score * 100).toFixed(0)}%
              </span>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.5rem 0', borderBottom: '1px solid var(--border-subtle)' }}>
              <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Completed Donations</span>
              <span style={{ fontWeight: 700, color: 'var(--text-main)' }}>{donorProfile.total_successful_donations}</span>
            </div>

            <div style={{
              background: 'var(--color-bg)',
              padding: '0.65rem 0.75rem',
              borderRadius: '8px',
              border: '1px solid var(--border-subtle)',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.35rem',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                  <MapPin size={13} color="var(--cyan-400)" />
                  GPS Location
                </span>
                <button
                  type="button"
                  onClick={syncBrowserGps}
                  disabled={gpsSyncing}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--cyan-400)',
                    fontSize: '0.75rem',
                    fontWeight: 700,
                    cursor: gpsSyncing ? 'wait' : 'pointer',
                    textDecoration: 'underline',
                    padding: 0,
                  }}
                >
                  {gpsSyncing ? 'Locking GPS...' : 'Sync Browser GPS'}
                </button>
              </div>
              <div style={{ fontSize: '0.8rem', fontFamily: 'var(--font-mono)', color: 'var(--text-main)' }}>
                {donorProfile.latitude != null && donorProfile.longitude != null
                  ? `${donorProfile.latitude.toFixed(4)}°, ${donorProfile.longitude.toFixed(4)}°`
                  : 'Coordinates not synchronized'}
              </div>
              {gpsMessage && (
                <div style={{ fontSize: '0.7rem', color: 'var(--emerald-400)', marginTop: '0.1rem' }}>
                  {gpsMessage}
                </div>
              )}
            </div>

            {/* Availability Status */}
            <div style={{
              background: donorProfile.is_available ? 'rgba(16, 185, 129, 0.1)' : 'rgba(100, 116, 139, 0.1)',
              padding: '1rem',
              borderRadius: '8px',
              border: `1px solid ${donorProfile.is_available ? 'var(--emerald-500)' : 'var(--border-subtle)'}`,
              marginTop: '0.5rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.75rem',
              alignItems: 'center',
              textAlign: 'center'
            }}>
              <div>
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.5rem',
                  fontSize: '1.1rem',
                  fontWeight: 800,
                  color: donorProfile.is_available ? 'var(--emerald-600)' : 'var(--text-muted)'
                }}>
                  <div style={{
                    width: '12px', height: '12px', borderRadius: '50%',
                    background: donorProfile.is_available ? 'var(--emerald-500)' : 'var(--text-dim)',
                    boxShadow: donorProfile.is_available ? '0 0 10px var(--emerald-500)' : 'none',
                    animation: donorProfile.is_available ? 'pulseGlow 2s infinite' : 'none'
                  }} />
                  {donorProfile.is_available ? 'ONLINE & READY' : 'OFFLINE (PAUSED)'}
                </div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.35rem', lineHeight: 1.4 }}>
                  {donorProfile.is_available
                    ? 'You are actively monitoring for nearby emergency requests.'
                    : 'You will not receive any emergency broadcast alerts.'}
                </div>
              </div>

              <button
                id="btn-toggle-availability"
                onClick={toggleAvailability}
                className={`btn ${donorProfile.is_available ? 'btn-secondary' : 'btn-primary'}`}
                style={{ width: '100%', padding: '0.6rem', fontSize: '0.9rem', marginTop: '0.25rem' }}
              >
                {donorProfile.is_available ? 'Pause Emergency Alerts' : 'Go Online to Help'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Active Broadcasts Feed */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
          <h2 style={{ fontSize: '1.25rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <AlertCircle size={22} color="var(--crimson-500)" />
            Urgent Blood Requests Near You
          </h2>
          <span className="badge badge-red">
            {activeAlerts.length} Urgent Request{activeAlerts.length !== 1 ? 's' : ''}
          </span>
        </div>

        {lastResult && (
          <div style={{
            background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.12), rgba(6, 182, 212, 0.08))',
            border: '1px solid var(--emerald-500)',
            padding: '1.25rem',
            borderRadius: '12px',
            marginBottom: '1.25rem',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Navigation size={18} color="var(--emerald-400)" />
                <span style={{ fontWeight: 800, color: 'var(--emerald-400)', fontSize: '1rem' }}>
                  En-Route to Recipient Hospital
                </span>
              </div>
              <span className="badge badge-green">DISPATCH CONFIRMED</span>
            </div>

            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', lineHeight: 1.4 }}>
              Thank you! You are confirmed to help this patient. Please head toward the hospital. Live GPS telemetry streams your position to calculate real-time ETA and trigger the trauma bay thaw alert.
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '0.75rem', marginTop: '0.85rem', marginBottom: '0.85rem' }}>
              <div style={{ background: 'var(--color-bg)', padding: '0.6rem', borderRadius: '8px', border: '1px solid var(--border-subtle)' }}>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-dim)' }}>DISTANCE TO WARD</div>
                <div style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--text-main)', marginTop: '0.15rem' }}>
                  {lastResult.distance_km != null ? `${lastResult.distance_km} km` : 'In Transit'}
                </div>
              </div>
              <div style={{ background: 'var(--color-bg)', padding: '0.6rem', borderRadius: '8px', border: '1px solid var(--border-subtle)' }}>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-dim)' }}>ESTIMATED TRANSIT (ETA)</div>
                <div style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--cyan-400)', marginTop: '0.15rem' }}>
                  {lastResult.estimated_transit_minutes != null ? `~${lastResult.estimated_transit_minutes} min` : 'Calculating...'}
                </div>
              </div>
              <div style={{ background: 'var(--color-bg)', padding: '0.6rem', borderRadius: '8px', border: '1px solid var(--border-subtle)' }}>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-dim)' }}>HOSPITAL COVERAGE</div>
                <div style={{ fontSize: '0.85rem', fontWeight: 800, color: 'var(--emerald-400)', marginTop: '0.25rem' }}>
                  {lastResult.units_covered != null && lastResult.units_requested != null
                    ? `${lastResult.units_covered} / ${lastResult.units_requested} Bags Covered`
                    : '1 Bag Covered'}
                </div>
              </div>
            </div>

            {telemetryStatus && (
              <div style={{ fontSize: '0.8rem', color: 'var(--cyan-400)', padding: '0.4rem 0.6rem', background: 'rgba(6, 182, 212, 0.1)', borderRadius: '6px', marginBottom: '0.75rem' }}>
                📡 {telemetryStatus}
              </div>
            )}

            <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={() => transmitTelemetry(false)}
                disabled={telemetrySending}
                className="btn btn-secondary"
                style={{ fontSize: '0.8rem', padding: '0.4rem 0.85rem' }}
              >
                <Radio size={14} />
                {telemetrySending ? 'Pinging GPS...' : 'Transmit Live GPS Telemetry'}
              </button>
              <button
                type="button"
                onClick={() => transmitTelemetry(true)}
                disabled={telemetrySending}
                className="btn btn-cyan"
                style={{ fontSize: '0.8rem', padding: '0.4rem 0.85rem' }}
                title="Simulates moving to within 350m of hospital ward to trigger the 500m proximity trauma thaw alert"
              >
                <Navigation size={14} />
                Simulate Ward Approach (&lt;500m)
              </button>
            </div>
          </div>
        )}

        {responseStatus && (
          <div style={{
            background: responseStatus.ok ? 'rgba(16, 185, 129, 0.2)' : 'rgba(239, 68, 68, 0.2)',
            border: `1px solid ${responseStatus.ok ? 'var(--emerald-500)' : 'var(--crimson-500)'}`,
            padding: '0.75rem 1rem',
            borderRadius: '8px',
            marginBottom: '1rem',
            fontSize: '0.85rem',
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '0.75rem',
          }}>
            <span>{responseStatus.text}</span>
            <button
              onClick={() => setResponseStatus(null)}
              aria-label="Dismiss message"
              style={{ background: 'transparent', border: 'none', color: 'inherit', cursor: 'pointer' }}
            >
              <X size={16} />
            </button>
          </div>
        )}

        {activeAlerts.length === 0 && (
          <div className="glass-panel" style={{ textAlign: 'center', padding: '3.5rem', color: 'var(--text-muted)' }}>
            <UserCheck size={36} color="var(--text-dim)" style={{ marginBottom: '0.75rem' }} />
            <p>No open emergency blood requests matching your group right now.</p>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-dim)', marginTop: '0.5rem' }}>
              When a hospital runs out of blood bags in storage, an urgent alert will buzz here so you can accept and help save a life.
            </p>
          </div>
        )}

        {/* Alerts that were dismissed stay reachable here instead of vanishing. */}
        {activeAlerts.length > 0 && visibleAlerts.length === 0 && (
          <div className="glass-panel" style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
            <p>You have set aside {activeAlerts.length} alert(s).</p>
            <button
              onClick={() => setDismissedAlertIds([])}
              className="btn btn-secondary"
              style={{ marginTop: '0.75rem', fontSize: '0.85rem' }}
            >
              Show my alerts again
            </button>
          </div>
        )}

        {visibleAlerts.length > 0 && (
          (() => {
            const totalAlerts = visibleAlerts.length;
            const pagedAlerts = visibleAlerts.slice(0, alertsPage * PAGE_SIZE);
            const hasMoreAlerts = totalAlerts > pagedAlerts.length;
            const totalAlertPages = Math.ceil(totalAlerts / PAGE_SIZE);
            return (
              <div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  {pagedAlerts.map((alert) => {
                    const stillNeeded = alert.units_shortfall ?? alert.units_requested;
                    return (
                      <div key={alert.id} id={`donor-alert-${alert.id}`} className="glass-panel highlight-red" style={{ border: '2px solid var(--crimson-500)', position: 'relative', overflow: 'hidden' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '0.5rem' }}>
                          <div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.35rem', flexWrap: 'wrap' }}>
                              <span className="badge badge-red" style={{ fontSize: '0.8rem' }}>URGENT DONOR NEEDED</span>
                              <span style={{ fontSize: '1.3rem', fontWeight: 800, color: 'var(--text-main)' }}>
                                {stillNeeded}x {alert.required_blood_group} ({alert.component_type === 'PRBC' ? 'Red Blood Cells' : alert.component_type})
                              </span>
                            </div>
                            <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                              {alert.hospital_name || 'Hospital'} | Urgency: <b>{alert.calculated_urgency_score.toFixed(0)}/100</b>
                            </div>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', background: 'rgba(16, 185, 129, 0.12)', padding: '0.4rem 0.8rem', borderRadius: '8px', border: '1px solid rgba(16, 185, 129, 0.3)' }}>
                              <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--emerald-500)', boxShadow: '0 0 6px var(--emerald-500)', animation: 'pulseGlow 2s infinite' }} />
                              <span style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--emerald-500)' }}>Open — Respond when ready</span>
                            </div>
                            <button onClick={() => dismissAlert(alert.id)} aria-label="Set this alert aside" title="Set aside" style={{ background: 'transparent', border: '1px solid var(--border-subtle)', borderRadius: '6px', color: 'var(--text-muted)', cursor: 'pointer', padding: '0.35rem', display: 'flex', alignItems: 'center' }}>
                              <X size={15} />
                            </button>
                          </div>
                        </div>

                        <div style={{ marginTop: '1rem', background: 'var(--color-bg)', padding: '0.75rem', borderRadius: '8px', fontSize: '0.85rem' }}>
                          <p style={{ color: 'var(--text-main)', lineHeight: 1.4 }}>
                            A patient at <b>{alert.hospital_name || 'a nearby hospital'}</b> urgently needs{' '}
                            <b>{stillNeeded} more bag(s) of {alert.required_blood_group} blood</b>.
                            {alert.units_covered > 0 && (<> {alert.units_covered} of {alert.units_requested} bag(s) are already covered.</>)}{' '}
                            Each volunteer who accepts covers one bag. Accept only if your blood type ({donorProfile?.blood_group}) is compatible.
                          </p>
                        </div>

                        {pendingAccept === alert.id ? (
                          <div style={{ marginTop: '1.25rem', background: 'rgba(239, 68, 68, 0.06)', border: '1px solid rgba(239, 68, 68, 0.25)', borderRadius: '10px', padding: '1rem 1.25rem' }}>
                            <div style={{ fontSize: '0.88rem', fontWeight: 700, color: 'var(--text-main)', marginBottom: '0.75rem' }}>
                              How many bags can you donate?
                              <span style={{ fontWeight: 400, color: 'var(--text-muted)', marginLeft: '0.4rem' }}>(max {stillNeeded} — the current shortfall)</span>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
                              <button onClick={() => setBagCounts(prev => ({ ...prev, [alert.id]: Math.max(1, (prev[alert.id] ?? 1) - 1) }))} disabled={(bagCounts[alert.id] ?? 1) <= 1} style={{ width: '36px', height: '36px', borderRadius: '8px', border: '1.5px solid var(--border-subtle)', background: 'var(--color-bg)', fontSize: '1.2rem', fontWeight: 700, color: (bagCounts[alert.id] ?? 1) <= 1 ? 'var(--text-dim)' : 'var(--text-main)', cursor: (bagCounts[alert.id] ?? 1) <= 1 ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>−</button>
                              <div style={{ minWidth: '56px', textAlign: 'center', fontSize: '1.6rem', fontWeight: 800, color: 'var(--crimson-500)', lineHeight: 1 }}>
                                {bagCounts[alert.id] ?? 1}
                                <div style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-muted)', marginTop: '0.15rem' }}>{(bagCounts[alert.id] ?? 1) === 1 ? 'bag' : 'bags'}</div>
                              </div>
                              <button onClick={() => setBagCounts(prev => ({ ...prev, [alert.id]: Math.min(stillNeeded, (prev[alert.id] ?? 1) + 1) }))} disabled={(bagCounts[alert.id] ?? 1) >= stillNeeded} style={{ width: '36px', height: '36px', borderRadius: '8px', border: '1.5px solid var(--border-subtle)', background: 'var(--color-bg)', fontSize: '1.2rem', fontWeight: 700, color: (bagCounts[alert.id] ?? 1) >= stillNeeded ? 'var(--text-dim)' : 'var(--text-main)', cursor: (bagCounts[alert.id] ?? 1) >= stillNeeded ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>+</button>
                              {stillNeeded > 1 && (
                                <div style={{ display: 'flex', gap: '0.35rem', marginLeft: '0.5rem', flexWrap: 'wrap' }}>
                                  {Array.from({ length: stillNeeded }, (_, i) => i + 1).map(n => (
                                    <button key={n} onClick={() => setBagCounts(prev => ({ ...prev, [alert.id]: n }))} style={{ padding: '0.2rem 0.55rem', borderRadius: '6px', border: '1.5px solid', borderColor: (bagCounts[alert.id] ?? 1) === n ? 'var(--crimson-500)' : 'var(--border-subtle)', background: (bagCounts[alert.id] ?? 1) === n ? 'rgba(239,68,68,0.12)' : 'var(--color-bg)', color: (bagCounts[alert.id] ?? 1) === n ? 'var(--crimson-500)' : 'var(--text-muted)', fontWeight: 700, fontSize: '0.8rem', cursor: 'pointer' }}>{n}</button>
                                  ))}
                                </div>
                              )}
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.6rem' }}>
                              <button onClick={() => setPendingAccept(null)} className="btn btn-secondary" style={{ fontSize: '0.82rem', padding: '0.45rem 0.9rem' }}>Cancel</button>
                              <button onClick={() => handleRespond(alert.id, 'ACCEPT', bagCounts[alert.id] ?? 1)} className="btn btn-primary" style={{ fontSize: '0.85rem', padding: '0.45rem 1.2rem' }}>
                                <CheckCircle size={15} /> Confirm — {bagCounts[alert.id] ?? 1} bag{(bagCounts[alert.id] ?? 1) > 1 ? 's' : ''} &amp; Head to Hospital
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div style={{ marginTop: '1.25rem', display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
                            <button id={`btn-decline-${alert.id}`} onClick={() => handleRespond(alert.id, 'DECLINE')} className="btn btn-secondary" style={{ fontSize: '0.85rem', padding: '0.5rem 1rem' }}>
                              <XCircle size={16} /> I Can't Make It
                            </button>
                            <button id={`btn-accept-${alert.id}`} onClick={() => handleAcceptClick(alert.id, stillNeeded)} className="btn btn-primary" style={{ fontSize: '0.85rem', padding: '0.5rem 1.25rem' }}>
                              <CheckCircle size={16} /> I Can Help! — Select Bags
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                {(hasMoreAlerts || totalAlerts > PAGE_SIZE) && (
                  <div style={{ marginTop: '1rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' }}>
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Showing {pagedAlerts.length} of {totalAlerts} alerts</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                      {totalAlerts > 10 ? (
                        Array.from({ length: totalAlertPages }, (_, i) => i + 1).map((p) => (
                          <button key={p} onClick={() => setAlertsPage(p)} className={`btn ${alertsPage === p ? 'btn-primary' : 'btn-secondary'}`} style={{ minWidth: '32px', padding: '0.25rem 0.5rem', fontSize: '0.78rem' }}>{p}</button>
                        ))
                      ) : hasMoreAlerts ? (
                        <button onClick={() => setAlertsPage(p => p + 1)} className="btn btn-secondary" style={{ fontSize: '0.8rem', padding: '0.3rem 0.85rem' }}>Show More</button>
                      ) : null}
                    </div>
                  </div>
                )}
              </div>
            );
          })()
        )}
      </div>
    </div>
  );
};
