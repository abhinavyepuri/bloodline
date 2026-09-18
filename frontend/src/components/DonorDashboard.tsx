import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useWebSocket } from '../context/WebSocketContext';
import { api } from '../lib/api';
import { BloodRequest, Donor, DonorRespondResult } from '../types';
import { UserCheck, MapPin, CheckCircle, XCircle, Clock, AlertCircle, X, Radio, Navigation } from 'lucide-react';

const RESPONSE_WINDOW_SECONDS = 180;

/** mm:ss for a remaining number of seconds. */
function formatCountdown(seconds: number): string {
  const safe = Math.max(0, seconds);
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Ticking clock used for response countdowns.
 *
 * Runs a single interval for the whole dashboard rather than one per alert.
 */
function useCountdown(active: boolean): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const interval = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(interval);
  }, [active]);
  return tick;
}

export const DonorDashboard: React.FC = () => {
  const { user } = useAuth();
  const { lastEvent } = useWebSocket();

  const [donorProfile, setDonorProfile] = useState<Donor | null>(null);
  const [activeAlerts, setActiveAlerts] = useState<BloodRequest[]>([]);
  const [responseStatus, setResponseStatus] = useState<{ text: string; ok: boolean } | null>(null);
  const [lastResult, setLastResult] = useState<DonorRespondResult | null>(null);
  /** Alerts the donor has pushed aside, so the full-screen panel is not permanent. */
  const [dismissedAlertIds, setDismissedAlertIds] = useState<string[]>([]);
  /** Local anchors so the countdown keeps moving between server refreshes. */
  const alertDeadlinesRef = useRef<Record<string, number>>({});

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

      const now = Date.now();
      const deadlines: Record<string, number> = {};
      for (const alert of alerts) {
        const seconds = alert.alert_expires_in_seconds ?? RESPONSE_WINDOW_SECONDS;
        deadlines[alert.id] = now + seconds * 1000;
      }
      alertDeadlinesRef.current = deadlines;

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

  // Re-render every second while a response window is open.
  const tick = useCountdown(activeAlerts.length > 0);

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

  const handleRespond = async (requestId: string, action: 'ACCEPT' | 'DECLINE') => {
    try {
      const result = await api.post<DonorRespondResult>(
        `/donors/requests/${requestId}/respond`,
        { action }
      );

      if (action === 'ACCEPT') {
        setLastResult(result);
        setResponseStatus({
          text: 'Thank you! You are confirmed to help this patient. Please head toward the hospital.',
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

  const dismissAlert = (requestId: string) => {
    setDismissedAlertIds((prev) => [...prev, requestId]);
  };

  const visibleAlerts = activeAlerts.filter(
    (alert) => !dismissedAlertIds.includes(alert.id)
  );

  const deadlineFor = (alert: BloodRequest): number => {
    return alertDeadlinesRef.current[alert.id] ?? Date.now() + RESPONSE_WINDOW_SECONDS * 1000;
  };

  // `tick` is read here so the countdown re-renders each second.
  void tick;

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
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {visibleAlerts.map((alert) => {
              const remaining = Math.round((deadlineFor(alert) - Date.now()) / 1000);
              const expired = remaining <= 0;
              const stillNeeded = alert.units_shortfall ?? alert.units_requested;

              return (
                <div
                  key={alert.id}
                  id={`donor-alert-${alert.id}`}
                  className="glass-panel highlight-red"
                  style={{
                    border: '2px solid var(--crimson-500)',
                    position: 'relative',
                    overflow: 'hidden',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '0.5rem' }}>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.35rem', flexWrap: 'wrap' }}>
                        <span className="badge badge-red" style={{ fontSize: '0.8rem' }}>
                          URGENT DONOR NEEDED
                        </span>
                        <span style={{ fontSize: '1.3rem', fontWeight: 800, color: 'var(--text-main)' }}>
                          {stillNeeded}x {alert.required_blood_group} ({alert.component_type === 'PRBC' ? 'Red Blood Cells' : alert.component_type})
                        </span>
                      </div>
                      <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                        {alert.hospital_name || 'Hospital'} | Urgency: <b>{alert.calculated_urgency_score.toFixed(0)}/100</b>
                      </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.4rem',
                        background: expired ? 'rgba(100, 116, 139, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                        padding: '0.4rem 0.8rem',
                        borderRadius: '8px',
                      }}>
                        <Clock size={16} color={expired ? 'var(--text-muted)' : 'var(--crimson-500)'} />
                        <span style={{
                          fontSize: '0.85rem',
                          fontWeight: 800,
                          color: expired ? 'var(--text-muted)' : 'var(--color-primary)',
                        }}>
                          {expired ? 'Window closed' : `Respond in ${formatCountdown(remaining)}`}
                        </span>
                      </div>
                      <button
                        onClick={() => dismissAlert(alert.id)}
                        aria-label="Set this alert aside"
                        title="Set aside"
                        style={{
                          background: 'transparent',
                          border: '1px solid var(--border-subtle)',
                          borderRadius: '6px',
                          color: 'var(--text-muted)',
                          cursor: 'pointer',
                          padding: '0.35rem',
                          display: 'flex',
                          alignItems: 'center',
                        }}
                      >
                        <X size={15} />
                      </button>
                    </div>
                  </div>

                  <div style={{ marginTop: '1rem', background: 'var(--color-bg)', padding: '0.75rem', borderRadius: '8px', fontSize: '0.85rem' }}>
                    <p style={{ color: 'var(--text-main)', lineHeight: 1.4 }}>
                      A patient at <b>{alert.hospital_name || 'a nearby hospital'}</b> urgently needs{' '}
                      <b>{stillNeeded} more bag(s) of {alert.required_blood_group} blood</b>.
                      {alert.units_covered > 0 && (
                        <> {alert.units_covered} of {alert.units_requested} bag(s) are already covered.</>
                      )}{' '}
                      Each volunteer who accepts covers one bag.
                    </p>
                  </div>

                  <div style={{ marginTop: '1.25rem', display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
                    <button
                      id={`btn-decline-${alert.id}`}
                      onClick={() => handleRespond(alert.id, 'DECLINE')}
                      className="btn btn-secondary"
                      style={{ fontSize: '0.85rem', padding: '0.5rem 1rem' }}
                    >
                      <XCircle size={16} />
                      I Can't Make It
                    </button>
                    <button
                      id={`btn-accept-${alert.id}`}
                      onClick={() => handleRespond(alert.id, 'ACCEPT')}
                      disabled={expired}
                      className="btn btn-primary"
                      style={{
                        fontSize: '0.85rem',
                        padding: '0.5rem 1.25rem',
                        opacity: expired ? 0.6 : 1,
                        cursor: expired ? 'not-allowed' : 'pointer',
                      }}
                    >
                      <CheckCircle size={16} />
                      I Can Help! (Accept & Head to Hospital)
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
