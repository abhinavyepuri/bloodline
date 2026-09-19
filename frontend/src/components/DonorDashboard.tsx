import React, { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useWebSocket } from '../context/WebSocketContext';
import { api } from '../lib/api';
import { BloodRequest, Donor, DonorHealthReport, DonorRespondResult, DonorTelemetry, DonationHistoryItem } from '../types';
import {
  UserCheck,
  MapPin,
  CheckCircle,
  XCircle,
  AlertCircle,
  X,
  Radio,
  Navigation,
  Activity,
  Heart,
  ShieldCheck,
  AlertTriangle,
  FileText,
  Thermometer,
  Scale,
  Printer,
  Stethoscope,
  Sparkles,
  Calendar,
  Building2,
  Clock,
  Info,
  Award,
  CheckCircle2,
  Droplet,
} from 'lucide-react';

export const DonorDashboard: React.FC = () => {
  const { user } = useAuth();
  const { lastEvent } = useWebSocket();

  const [donorProfile, setDonorProfile] = useState<Donor | null>(null);
  const [activeAlerts, setActiveAlerts] = useState<BloodRequest[]>([]);
  const [donationHistory, setDonationHistory] = useState<DonationHistoryItem[]>([]);
  const [fulfilledNotification, setFulfilledNotification] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [responseStatus, setResponseStatus] = useState<{ text: string; ok: boolean } | null>(null);
  const [lastResult, setLastResult] = useState<DonorRespondResult | null>(null);
  /** Alerts the donor has pushed aside, so the full-screen panel is not permanent. */
  const [dismissedAlertIds, setDismissedAlertIds] = useState<string[]>([]);


  // GPS & Telemetry Tracking State
  const [gpsSyncing, setGpsSyncing] = useState(false);
  const [gpsMessage, setGpsMessage] = useState<string | null>(null);
  const [telemetrySending, setTelemetrySending] = useState(false);
  const [telemetryStatus, setTelemetryStatus] = useState<string | null>(null);

  // Health Report & Donation Eligibility State
  const [healthReport, setHealthReport] = useState<DonorHealthReport | null>(null);
  const [isUpdatingHealth, setIsUpdatingHealth] = useState(false);
  const [isCertificateOpen, setIsCertificateOpen] = useState(false);
  const [healthSubmitting, setHealthSubmitting] = useState(false);
  const [healthFormError, setHealthFormError] = useState<string | null>(null);

  // Health Form State
  const [hbInput, setHbInput] = useState<number>(14.2);
  const [sysInput, setSysInput] = useState<number>(120);
  const [diaInput, setDiaInput] = useState<number>(80);
  const [pulseInput, setPulseInput] = useState<number>(72);
  const [tempInput, setTempInput] = useState<number>(36.6);
  const [weightInput, setWeightInput] = useState<number>(65.0);
  const [glucoseInput, setGlucoseInput] = useState<number>(95.0);
  const [doctorRemarksInput, setDoctorRemarksInput] = useState<string>('');

  const fetchDonorData = useCallback(async () => {
    try {
      const [profile, alerts, report, history] = await Promise.all([
        api.get<Donor>('/donors/me'),
        api.get<BloodRequest[]>('/donors/requests/active'),
        api.get<DonorHealthReport>('/donors/me/health-report'),
        api.get<DonationHistoryItem[]>('/donors/me/history').catch(() => [] as DonationHistoryItem[]),
      ]);
      setDonorProfile(profile);
      setActiveAlerts(alerts);
      setHealthReport(report);
      setDonationHistory(history);
      setLoadError(null);

      // Drop dismissals for alerts that no longer exist, so a re-issued alert reopens.
      setDismissedAlertIds((prev) => prev.filter((id) => alerts.some((a) => a.id === id)));
    } catch (err) {
      console.error('Error fetching donor data:', err);
      setLoadError(err instanceof Error ? err.message : 'Could not load your donor profile.');
    }
  }, []);

  useEffect(() => {
    fetchDonorData();
    const interval = setInterval(fetchDonorData, 4000);
    return () => clearInterval(interval);
  }, [fetchDonorData, user]);

  useEffect(() => {
    if (lastEvent) {
      if (lastEvent.type === 'REQUEST_FULFILLED') {
        setFulfilledNotification(
          (lastEvent.message as string) || '🎉 Blood Donation Fulfilled & Received! The hospital confirmed that your blood was received and the request has been fulfilled. Thank you for your heroism!'
        );
        setLastResult(null);
      }
      if (
        [
          'EMERGENCY_DISPATCH_ALERT',
          'REQUEST_CREATED',
          'REQUEST_UPDATED',
          'REQUEST_FULFILLED',
          'REQUEST_CANCELLED',
          'DONOR_CLAIM_SUCCESS',
          'DONOR_STAND_DOWN',
          'DONOR_AVAILABILITY_CHANGED',
          'DONOR_HEALTH_EVALUATED',
          'RE_PLANNING_TRIGGERED',
          'SYSTEM_RESET',
        ].includes(lastEvent.type)
      ) {
        fetchDonorData();
      }
    }
  }, [lastEvent, fetchDonorData]);

  const openHealthModal = () => {
    if (healthReport) {
      setHbInput(healthReport.hemoglobin_g_dl);
      setSysInput(healthReport.systolic_bp);
      setDiaInput(healthReport.diastolic_bp);
      setPulseInput(healthReport.pulse_bpm);
      setTempInput(healthReport.temperature_c);
      setWeightInput(healthReport.weight_kg);
      setGlucoseInput(healthReport.blood_glucose_mg_dl ?? 95.0);
      setDoctorRemarksInput(healthReport.doctor_remarks ?? '');
    }
    setHealthFormError(null);
    setIsUpdatingHealth(true);
  };

  const applyPreset = (type: 'fit' | 'anemia' | 'hypertension' | 'underweight') => {
    if (type === 'fit') {
      setHbInput(14.2);
      setSysInput(120);
      setDiaInput(80);
      setPulseInput(72);
      setTempInput(36.6);
      setWeightInput(65.0);
      setDoctorRemarksInput('Clinically cleared. Optimal vitals for whole-blood or platelet donation.');
    } else if (type === 'anemia') {
      setHbInput(11.2);
      setSysInput(118);
      setDiaInput(76);
      setPulseInput(74);
      setTempInput(36.6);
      setWeightInput(60.0);
      setDoctorRemarksInput('Mild nutritional iron deficiency anemia. Deferral recommended for donor safety.');
    } else if (type === 'hypertension') {
      setHbInput(14.0);
      setSysInput(152);
      setDiaInput(96);
      setPulseInput(88);
      setTempInput(36.8);
      setWeightInput(78.0);
      setDoctorRemarksInput('Elevated blood pressure recorded during examination. Rest and physician consultation advised.');
    } else if (type === 'underweight') {
      setHbInput(13.5);
      setSysInput(110);
      setDiaInput(70);
      setPulseInput(75);
      setTempInput(36.5);
      setWeightInput(46.0);
      setDoctorRemarksInput('Body weight is under 50.0 kg safety threshold for standard blood collection.');
    }
  };

  const handleSubmitHealth = async (e: React.FormEvent) => {
    e.preventDefault();
    setHealthFormError(null);
    setHealthSubmitting(true);
    try {
      const payload = {
        hemoglobin_g_dl: Number(hbInput),
        systolic_bp: Number(sysInput),
        diastolic_bp: Number(diaInput),
        pulse_bpm: Number(pulseInput),
        temperature_c: Number(tempInput),
        weight_kg: Number(weightInput),
        blood_glucose_mg_dl: glucoseInput ? Number(glucoseInput) : undefined,
        hiv_status: 'NEGATIVE',
        hepb_status: 'NEGATIVE',
        hepc_status: 'NEGATIVE',
        syphilis_status: 'NEGATIVE',
        malaria_status: 'NEGATIVE',
        doctor_remarks: doctorRemarksInput.trim() || undefined,
      };
      const updated = await api.post<DonorHealthReport>('/donors/me/health-report', payload);
      setHealthReport(updated);
      setIsUpdatingHealth(false);
      setResponseStatus({
        text: updated.eligibility_status === 'ELIGIBLE'
          ? 'Health screening saved: Clinically cleared for blood donation!'
          : `Health screening saved: Temporarily deferred due to ${updated.deferral_reason}`,
        ok: updated.eligibility_status === 'ELIGIBLE',
      });
      await fetchDonorData();
    } catch (err) {
      setHealthFormError(err instanceof Error ? err.message : 'Failed to save health screening.');
    } finally {
      setHealthSubmitting(false);
    }
  };

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
          const updated = await api.post<Donor>('/donors/me/heartbeat', {
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
      let lat = donorProfile?.latitude ?? 12.9716;
      let lon = donorProfile?.longitude ?? 77.5946;

      if (simulateNearHospital) {
        lat = 12.9740;
        lon = 77.5946;
      }

      const res = await api.post<DonorTelemetry>('/donors/me/telemetry', {
        latitude: lat,
        longitude: lon,
        speed_kmh: 40.0,
      });

      const distanceKm = res.distance_to_hospital_km ?? res.distance_km;
      const etaMinutes = res.estimated_eta_minutes ?? res.estimated_transit_minutes;
      setTelemetryStatus(
        res.message ||
        (distanceKm != null
          ? `Telemetry synced: ${distanceKm} km away, ETA ~${etaMinutes ?? 1} min`
          : 'Telemetry recorded.')
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
        payload.bags_offered = bagsOffered && bagsOffered > 0 ? bagsOffered : 1;
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

  const handleAcceptClick = (requestId: string, maxBags: number) => {
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

  const matchingAlerts = activeAlerts.filter(
    (alert) => !donorProfile || alert.required_blood_group === donorProfile.blood_group
  );

  const visibleAlerts = matchingAlerts.filter(
    (alert) => !dismissedAlertIds.includes(alert.id)
  );

  const activeCommitments = donationHistory.filter(
    (item) => item.status !== 'COMPLETED' && item.status !== 'CANCELLED' && item.status !== 'TIMED_OUT' && item.status !== 'RE_OPTIMIZED'
  );
  const completedHistory = donationHistory.filter(
    (item) => item.status === 'COMPLETED'
  );

  // Clinical Clearance & Cooling Interval calculations (Standard Whole Blood recovery: 56 days)
  const lastDonation = donorProfile?.last_donation_date ? new Date(donorProfile.last_donation_date) : null;
  const today = new Date();
  const daysSinceLast = lastDonation ? Math.max(0, Math.floor((today.getTime() - lastDonation.getTime()) / (1000 * 3600 * 24))) : null;
  const COOLDOWN_DAYS = 56;
  const isCoolingActive = Boolean(
    donorProfile?.cooling_period_active || (daysSinceLast !== null && daysSinceLast < COOLDOWN_DAYS)
  );
  const daysUntilEligible = donorProfile?.days_until_eligible ?? (isCoolingActive && daysSinceLast !== null ? COOLDOWN_DAYS - daysSinceLast : 0);
  const nextEligibleDate = donorProfile?.next_eligible_date || (lastDonation ? new Date(lastDonation.getTime() + COOLDOWN_DAYS * 24 * 3600 * 1000).toISOString().split('T')[0] : null);

  const isHealthEligible = healthReport?.eligibility_status === 'ELIGIBLE';
  const isEligible = isHealthEligible;
  const isPermanentlyDeferred = healthReport?.eligibility_status === 'PERMANENTLY_DEFERRED';
  const isDeferred = Boolean(healthReport && healthReport.eligibility_status !== 'ELIGIBLE');
  const isFitToDonate = isHealthEligible && !isCoolingActive;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(280px, 350px) 1fr', gap: '1.5rem', alignItems: 'start' }}>
      {/* ── Left Column: Donor Profile & Donation History ── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
        {/* 1. Donor Profile Card */}
        <div className="glass-panel" style={{ height: 'fit-content' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem', marginBottom: '1.25rem' }}>
            <div
              style={{
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
              }}
            >
              {donorProfile ? donorProfile.blood_group : '🩸'}
            </div>
            <div>
              <h2 style={{ fontSize: '1.15rem', fontWeight: 700 }}>{user?.full_name || 'Donor Profile'}</h2>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{user?.email}</p>
            </div>
          </div>

          {donorProfile && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.45rem 0', borderBottom: '1px solid var(--border-subtle)' }}>
                <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Blood Group</span>
                <span style={{ fontWeight: 800, color: 'var(--crimson-500)', fontSize: '1.1rem' }}>{donorProfile.blood_group}</span>
              </div>

              {/* Account Donation Status */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.45rem 0', borderBottom: '1px solid var(--border-subtle)' }}>
                <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Account Donation Status</span>
                <span
                  style={{
                    fontWeight: 800,
                    fontSize: '0.78rem',
                    color: isPermanentlyDeferred
                      ? 'var(--crimson-400)'
                      : isDeferred
                      ? 'var(--amber-400)'
                      : isCoolingActive
                      ? 'var(--amber-400)'
                      : donorProfile.is_available
                      ? 'var(--emerald-400)'
                      : 'var(--text-muted)',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.3rem',
                  }}
                >
                  {isPermanentlyDeferred ? (
                    <XCircle size={14} />
                  ) : isDeferred ? (
                    <AlertTriangle size={14} />
                  ) : isCoolingActive ? (
                    <Clock size={14} />
                  ) : donorProfile.is_available ? (
                    <ShieldCheck size={14} />
                  ) : (
                    <Clock size={14} />
                  )}
                  {isPermanentlyDeferred
                    ? 'Not Eligible'
                    : isDeferred
                    ? 'Temporarily Deferred'
                    : isCoolingActive
                    ? `Cooling Active (${daysUntilEligible}d left)`
                    : donorProfile.is_available
                    ? 'Eligible (Active)'
                    : 'Eligible (Standby)'}
                </span>
              </div>

              {/* Interval Since Previous Donation */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.45rem 0', borderBottom: '1px solid var(--border-subtle)' }}>
                <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Interval Since Previous Donation</span>
                <span style={{ fontWeight: 700, fontSize: '0.82rem', color: 'var(--text-main)', textAlign: 'right' }}>
                  {donorProfile.last_donation_date
                    ? `${daysSinceLast ?? 0} days`
                    : 'Initial Draw (0 days)'}
                </span>
              </div>

              {/* Next Safe Draw Date */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.45rem 0', borderBottom: '1px solid var(--border-subtle)' }}>
                <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Next Safe Draw</span>
                <span
                  style={{
                    fontWeight: 700,
                    fontSize: '0.8rem',
                    color: isCoolingActive ? 'var(--amber-400)' : 'var(--emerald-400)',
                  }}
                >
                  {isCoolingActive ? `${nextEligibleDate} (${daysUntilEligible}d left)` : 'Eligible Today'}
                </span>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.45rem 0', borderBottom: '1px solid var(--border-subtle)' }}>
                <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Reliability Rating</span>
                <span style={{ fontWeight: 700, color: 'var(--emerald-400)' }}>
                  {(donorProfile.reliability_score * 100).toFixed(0)}%
                </span>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.45rem 0', borderBottom: '1px solid var(--border-subtle)' }}>
                <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Completed Donations</span>
                <span style={{ fontWeight: 700, color: 'var(--text-main)' }}>{donorProfile.total_successful_donations}</span>
              </div>

              {/* GPS Location Box */}
              <div
                style={{
                  background: 'var(--color-bg)',
                  padding: '0.65rem 0.75rem',
                  borderRadius: '8px',
                  border: '1px solid var(--border-subtle)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.35rem',
                }}
              >
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
              <div
                style={{
                  background: donorProfile.is_available ? 'rgba(16, 185, 129, 0.1)' : 'rgba(100, 116, 139, 0.1)',
                  padding: '1rem',
                  borderRadius: '8px',
                  border: `1px solid ${donorProfile.is_available ? 'var(--emerald-500)' : 'var(--border-subtle)'}`,
                  marginTop: '0.5rem',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.75rem',
                  alignItems: 'center',
                  textAlign: 'center',
                }}
              >
                <div>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '0.5rem',
                      fontSize: '1.1rem',
                      fontWeight: 800,
                      color: donorProfile.is_available ? 'var(--emerald-600)' : 'var(--text-muted)',
                    }}
                  >
                    <div
                      style={{
                        width: '12px',
                        height: '12px',
                        borderRadius: '50%',
                        background: donorProfile.is_available ? 'var(--emerald-500)' : 'var(--text-dim)',
                        boxShadow: donorProfile.is_available ? '0 0 10px var(--emerald-500)' : 'none',
                        animation: donorProfile.is_available ? 'pulseGlow 2s infinite' : 'none',
                      }}
                    />
                    {donorProfile.is_available ? 'ONLINE & READY' : 'OFFLINE (PAUSED)'}
                  </div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.35rem', lineHeight: 1.4 }}>
                    {isDeferred
                      ? 'Availability is locked while health screening deferral is active.'
                      : isCoolingActive
                      ? `In ${COOLDOWN_DAYS}-day cooling recovery period (${daysUntilEligible}d remaining).`
                      : donorProfile.is_available
                      ? 'You are actively monitoring for nearby emergency requests.'
                      : 'You will not receive emergency broadcast alerts.'}
                  </div>
                </div>

                <button
                  id="btn-toggle-availability"
                  onClick={toggleAvailability}
                  disabled={(isDeferred || isCoolingActive) && !donorProfile.is_available}
                  className={`btn ${donorProfile.is_available ? 'btn-secondary' : 'btn-primary'}`}
                  style={{
                    width: '100%',
                    padding: '0.6rem',
                    fontSize: '0.9rem',
                    marginTop: '0.25rem',
                    opacity: (isDeferred || isCoolingActive) && !donorProfile.is_available ? 0.6 : 1,
                    cursor: (isDeferred || isCoolingActive) && !donorProfile.is_available ? 'not-allowed' : 'pointer',
                  }}
                  title={isDeferred ? 'Health deferral active.' : isCoolingActive ? 'Cooling period active.' : undefined}
                >
                  {donorProfile.is_available ? 'Pause Emergency Alerts' : 'Go Online to Help'}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* ── 2. Donation History Widget (Below Profile) ── */}
        <div className="glass-panel" style={{ height: 'fit-content' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Clock size={18} color="var(--crimson-500)" />
              <h3 style={{ fontSize: '1.05rem', fontWeight: 700, margin: 0 }}>Donation History</h3>
            </div>
            <span
              className="badge"
              style={{
                background: 'rgba(239, 68, 68, 0.12)',
                color: 'var(--crimson-500)',
                border: '1px solid rgba(239, 68, 68, 0.3)',
                fontSize: '0.75rem',
                fontWeight: 700,
                padding: '0.2rem 0.55rem',
              }}
            >
              {completedHistory.length} Record{completedHistory.length === 1 ? '' : 's'}
            </span>
          </div>

          {/* Active Missions Notice */}
          {activeCommitments.length > 0 && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.45rem',
                padding: '0.5rem 0.75rem',
                background: 'rgba(6, 182, 212, 0.12)',
                border: '1px solid rgba(6, 182, 212, 0.35)',
                borderRadius: '8px',
                marginBottom: '1rem',
                fontSize: '0.78rem',
                color: 'var(--cyan-400)',
              }}
            >
              <Navigation size={14} style={{ flexShrink: 0 }} />
              <span><b>{activeCommitments.length} Active Commitment:</b> En-route to hospital to donate blood (Get to it!)</span>
            </div>
          )}

          {/* Cooldown / Interval Summary Pill */}
          <div
            style={{
              background: 'var(--color-bg)',
              border: '1px solid var(--border-subtle)',
              borderRadius: '8px',
              padding: '0.75rem',
              marginBottom: '1rem',
              fontSize: '0.8rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.45rem',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ color: 'var(--text-muted)' }}>Account Donation Status:</span>
              <span
                style={{
                  fontWeight: 800,
                  fontSize: '0.78rem',
                  color: isPermanentlyDeferred
                    ? 'var(--crimson-400)'
                    : isDeferred
                    ? 'var(--amber-400)'
                    : isCoolingActive
                    ? 'var(--amber-400)'
                    : 'var(--emerald-400)',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.3rem',
                }}
              >
                {isPermanentlyDeferred
                  ? 'Not Eligible'
                  : isDeferred
                  ? 'Temporarily Deferred'
                  : isCoolingActive
                  ? `Cooling Active (${daysUntilEligible}d left)`
                  : 'Eligible & Cleared'}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ color: 'var(--text-muted)' }}>Interval Since Previous Donation:</span>
              <span style={{ fontWeight: 700, color: 'var(--text-main)' }}>
                {donorProfile?.last_donation_date
                  ? `${daysSinceLast ?? 0} days (${donorProfile.last_donation_date})`
                  : '0 days (Initial / First Draw)'}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ color: 'var(--text-muted)' }}>Next Safe Draw Date:</span>
              <span
                style={{
                  fontWeight: 700,
                  color: isCoolingActive ? 'var(--amber-400)' : 'var(--emerald-400)',
                }}
              >
                {isCoolingActive ? `${nextEligibleDate} (${daysUntilEligible}d remaining)` : 'Eligible Today'}
              </span>
            </div>
          </div>

          {/* History Records List */}
          {completedHistory.length === 0 ? (
            <div
              style={{
                textAlign: 'center',
                padding: '1.5rem 1rem',
                color: 'var(--text-muted)',
                background: 'var(--color-bg)',
                borderRadius: '8px',
                border: '1px dashed var(--border-subtle)',
              }}
            >
              <Heart size={24} color="var(--text-dim)" style={{ marginBottom: '0.4rem' }} />
              <p style={{ fontSize: '0.82rem', margin: 0 }}>No past fulfilled donations yet.</p>
              <p style={{ fontSize: '0.74rem', color: 'var(--text-dim)', marginTop: '0.2rem' }}>
                Once you accept a request and the hospital marks it as fulfilled/received, your verified donation record will appear here.
              </p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem', maxHeight: '380px', overflowY: 'auto', paddingRight: '0.25rem' }}>
              {completedHistory.map((item) => (
                <div
                  key={item.id}
                  style={{
                    background: 'var(--color-bg)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: '8px',
                    padding: '0.65rem 0.75rem',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.35rem',
                    transition: 'border-color 0.15s ease',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-main)' }}>
                      {item.hospital_name || 'Medical Center'}
                    </span>
                    <span
                      style={{
                        fontSize: '0.7rem',
                        fontWeight: 800,
                        padding: '0.15rem 0.45rem',
                        borderRadius: '4px',
                        background: 'rgba(16, 185, 129, 0.15)',
                        color: 'var(--emerald-400)',
                        border: '1px solid rgba(16, 185, 129, 0.3)',
                      }}
                    >
                      FULFILLED / COMPLETED
                    </span>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontWeight: 600, color: 'var(--text-main)' }}>
                      <Droplet size={11} color="var(--crimson-500)" />
                      {item.units} x {item.blood_group} ({item.component_type === 'PRBC' ? 'Red Blood Cells' : item.component_type})
                    </span>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                      <span>{item.donated_at.split('T')[0]}</span>
                      <span style={{ color: 'var(--text-dim)', fontSize: '0.68rem' }}>
                        ({Math.max(0, Math.floor((today.getTime() - new Date(item.donated_at).getTime()) / (1000 * 3600 * 24)))}d ago)
                      </span>
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Right Column: Health Report & Urgent Broadcasts ── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
        {/* ── 1. Volunteer Clinical Health Report & Donation Clearance Card ── */}
        <div
          className="glass-panel"
          style={{
            border: isEligible ? '1px solid rgba(16, 185, 129, 0.4)' : '1px solid rgba(245, 158, 11, 0.5)',
            background: isEligible
              ? 'linear-gradient(135deg, rgba(16, 185, 129, 0.05), rgba(15, 23, 42, 0.6))'
              : 'linear-gradient(135deg, rgba(245, 158, 11, 0.07), rgba(15, 23, 42, 0.6))',
            padding: '1.25rem 1.5rem',
          }}
        >
          {/* Health Card Header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '1.25rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
              <div
                style={{
                  width: '42px',
                  height: '42px',
                  borderRadius: '10px',
                  background: isEligible ? 'rgba(16, 185, 129, 0.15)' : 'rgba(245, 158, 11, 0.15)',
                  border: isEligible ? '1px solid var(--emerald-500)' : '1px solid var(--amber-500)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Stethoscope size={22} color={isEligible ? 'var(--emerald-400)' : 'var(--amber-400)'} />
              </div>
              <div>
                <h3 style={{ fontSize: '1.15rem', fontWeight: 800, display: 'flex', alignItems: 'center', gap: '0.5rem', margin: 0 }}>
                  Volunteer Health Screening & Donation Clearance
                </h3>
                <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: '0.15rem 0 0 0' }}>
                  AABB & Transfusion Medicine Clinical Protocol | Dictates Safe Donation Eligibility
                </p>
              </div>
            </div>

            {/* Status Clearance Pill */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.4rem',
                  padding: '0.35rem 0.85rem',
                  borderRadius: '8px',
                  fontSize: '0.82rem',
                  fontWeight: 800,
                  background: isEligible ? 'rgba(16, 185, 129, 0.15)' : 'rgba(245, 158, 11, 0.15)',
                  color: isEligible ? 'var(--emerald-400)' : 'var(--amber-400)',
                  border: `1px solid ${isEligible ? 'var(--emerald-500)' : 'var(--amber-500)'}`,
                }}
              >
                {isEligible ? <ShieldCheck size={16} /> : <AlertTriangle size={16} />}
                {isEligible ? 'MEDICALLY FIT TO DONATE' : 'TEMPORARILY DEFERRED'}
              </span>

              <button
                type="button"
                onClick={() => setIsCertificateOpen(true)}
                className="btn btn-secondary"
                style={{ fontSize: '0.78rem', padding: '0.35rem 0.75rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}
                title="View Official Certificate"
              >
                <FileText size={14} />
                Certificate
              </button>
            </div>
          </div>

          {/* Account Donation Status & Interval Bar */}
          <div
            style={{
              background: 'var(--color-bg)',
              border: '1px solid var(--border-subtle)',
              borderRadius: '8px',
              padding: '0.85rem 1rem',
              marginBottom: '1.25rem',
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
              gap: '1rem',
            }}
          >
            <div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Account Donation Status
              </div>
              <div
                style={{
                  fontSize: '0.95rem',
                  fontWeight: 800,
                  marginTop: '0.2rem',
                  color: isPermanentlyDeferred
                    ? 'var(--crimson-400)'
                    : isDeferred
                    ? 'var(--amber-400)'
                    : isCoolingActive
                    ? 'var(--amber-400)'
                    : 'var(--emerald-400)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.35rem',
                }}
              >
                {isPermanentlyDeferred ? (
                  <XCircle size={15} />
                ) : isDeferred ? (
                  <AlertTriangle size={15} />
                ) : isCoolingActive ? (
                  <Clock size={15} />
                ) : (
                  <ShieldCheck size={15} />
                )}
                {isPermanentlyDeferred
                  ? 'Not Eligible'
                  : isDeferred
                  ? 'Temporarily Deferred'
                  : isCoolingActive
                  ? `Cooling Active (${daysUntilEligible}d left)`
                  : 'Eligible & Cleared'}
              </div>
            </div>

            <div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Interval Since Previous Donation
              </div>
              <div style={{ fontSize: '0.95rem', fontWeight: 800, color: 'var(--text-main)', marginTop: '0.2rem' }}>
                {donorProfile?.last_donation_date
                  ? `${daysSinceLast ?? 0} days elapsed`
                  : 'Initial Draw (0 days)'}
              </div>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-dim)', marginTop: '0.1rem' }}>
                {donorProfile?.last_donation_date ? `Last: ${donorProfile.last_donation_date}` : 'No prior donations recorded'}
              </div>
            </div>

            <div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Required Recovery Interval
              </div>
              <div style={{ fontSize: '0.95rem', fontWeight: 800, color: isCoolingActive ? 'var(--amber-400)' : 'var(--emerald-400)', marginTop: '0.2rem' }}>
                {isCoolingActive ? `Next: ${nextEligibleDate}` : 'Eligible for Draw Today'}
              </div>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-dim)', marginTop: '0.1rem' }}>
                56-Day Whole Blood Standard
              </div>
            </div>
          </div>

          {/* Active Deferral Alert Box (When in deferral state) */}
          {isDeferred && healthReport && (
            <div
              style={{
                background: 'rgba(245, 158, 11, 0.12)',
                border: '1px solid var(--amber-500)',
                borderRadius: '8px',
                padding: '0.85rem 1rem',
                marginBottom: '1.25rem',
                display: 'flex',
                alignItems: 'flex-start',
                gap: '0.65rem',
              }}
            >
              <AlertTriangle size={18} color="var(--amber-400)" style={{ flexShrink: 0, marginTop: '0.1rem' }} />
              <div style={{ fontSize: '0.82rem' }}>
                <div style={{ fontWeight: 700, color: 'var(--amber-400)', marginBottom: '0.2rem' }}>
                  Further Blood Donations Paused for Volunteer Safety
                </div>
                <div style={{ color: 'var(--text-main)', lineHeight: 1.4 }}>
                  {healthReport.deferral_reason}
                </div>
                {healthReport.deferral_end_date && (
                  <div style={{ color: 'var(--text-muted)', marginTop: '0.3rem', fontSize: '0.76rem' }}>
                    Eligible for clinical re-check on or after: <b>{healthReport.deferral_end_date}</b>.
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Vitals Grid */}
          {healthReport && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
              {/* Hemoglobin */}
              <div
                style={{
                  background: 'var(--color-bg)',
                  padding: '0.75rem',
                  borderRadius: '8px',
                  border: `1px solid ${healthReport.hemoglobin_g_dl >= 12.5 ? 'var(--border-subtle)' : 'var(--amber-500)'}`,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
                  <span style={{ fontSize: '0.72rem', color: 'var(--text-dim)', fontWeight: 700 }}>HEMOGLOBIN (Hb)</span>
                  <span
                    style={{
                      fontSize: '0.65rem',
                      fontWeight: 800,
                      padding: '0.1rem 0.4rem',
                      borderRadius: '4px',
                      background: healthReport.hemoglobin_g_dl >= 12.5 ? 'rgba(16,185,129,0.15)' : 'rgba(245,158,11,0.2)',
                      color: healthReport.hemoglobin_g_dl >= 12.5 ? 'var(--emerald-400)' : 'var(--amber-400)',
                    }}
                  >
                    {healthReport.hemoglobin_g_dl >= 12.5 ? 'Optimal' : 'Low (<12.5)'}
                  </span>
                </div>
                <div style={{ fontSize: '1.25rem', fontWeight: 800, color: healthReport.hemoglobin_g_dl >= 12.5 ? 'var(--text-main)' : 'var(--amber-400)' }}>
                  {healthReport.hemoglobin_g_dl.toFixed(1)} <span style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-muted)' }}>g/dL</span>
                </div>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-dim)', marginTop: '0.2rem' }}>
                  Min 12.5 g/dL required
                </div>
              </div>

              {/* Blood Pressure */}
              <div
                style={{
                  background: 'var(--color-bg)',
                  padding: '0.75rem',
                  borderRadius: '8px',
                  border: '1px solid var(--border-subtle)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
                  <span style={{ fontSize: '0.72rem', color: 'var(--text-dim)', fontWeight: 700 }}>BLOOD PRESSURE</span>
                  <span
                    style={{
                      fontSize: '0.65rem',
                      fontWeight: 800,
                      padding: '0.1rem 0.4rem',
                      borderRadius: '4px',
                      background: 'rgba(16,185,129,0.15)',
                      color: 'var(--emerald-400)',
                    }}
                  >
                    Normal
                  </span>
                </div>
                <div style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--text-main)' }}>
                  {healthReport.systolic_bp} / {healthReport.diastolic_bp} <span style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-muted)' }}>mmHg</span>
                </div>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-dim)', marginTop: '0.2rem' }}>
                  Target: 90-140 / 60-90
                </div>
              </div>

              {/* Pulse */}
              <div
                style={{
                  background: 'var(--color-bg)',
                  padding: '0.75rem',
                  borderRadius: '8px',
                  border: '1px solid var(--border-subtle)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
                  <span style={{ fontSize: '0.72rem', color: 'var(--text-dim)', fontWeight: 700 }}>RESTING PULSE</span>
                  <Heart size={12} color="var(--crimson-500)" />
                </div>
                <div style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--text-main)' }}>
                  {healthReport.pulse_bpm} <span style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-muted)' }}>bpm</span>
                </div>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-dim)', marginTop: '0.2rem' }}>
                  Target: 60-100 bpm
                </div>
              </div>

              {/* Body Weight */}
              <div
                style={{
                  background: 'var(--color-bg)',
                  padding: '0.75rem',
                  borderRadius: '8px',
                  border: `1px solid ${healthReport.weight_kg >= 50.0 ? 'var(--border-subtle)' : 'var(--amber-500)'}`,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
                  <span style={{ fontSize: '0.72rem', color: 'var(--text-dim)', fontWeight: 700 }}>BODY WEIGHT</span>
                  <Scale size={12} color="var(--cyan-400)" />
                </div>
                <div style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--text-main)' }}>
                  {healthReport.weight_kg.toFixed(1)} <span style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-muted)' }}>kg</span>
                </div>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-dim)', marginTop: '0.2rem' }}>
                  Safe draw ≥ 50 kg
                </div>
              </div>

              {/* Serology Screening */}
              <div
                style={{
                  background: 'var(--color-bg)',
                  padding: '0.75rem',
                  borderRadius: '8px',
                  border: '1px solid var(--border-subtle)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
                  <span style={{ fontSize: '0.72rem', color: 'var(--text-dim)', fontWeight: 700 }}>SEROLOGY / LAB</span>
                  <CheckCircle size={12} color="var(--emerald-400)" />
                </div>
                <div style={{ fontSize: '0.95rem', fontWeight: 800, color: 'var(--emerald-400)', marginTop: '0.25rem' }}>
                  All Cleared
                </div>
                <div style={{ fontSize: '0.68rem', color: 'var(--text-dim)', marginTop: '0.35rem', display: 'flex', gap: '0.25rem', flexWrap: 'wrap' }}>
                  <span style={{ background: 'rgba(16,185,129,0.1)', color: 'var(--emerald-400)', padding: '0.05rem 0.25rem', borderRadius: '3px' }}>HIV -</span>
                  <span style={{ background: 'rgba(16,185,129,0.1)', color: 'var(--emerald-400)', padding: '0.05rem 0.25rem', borderRadius: '3px' }}>HepB -</span>
                  <span style={{ background: 'rgba(16,185,129,0.1)', color: 'var(--emerald-400)', padding: '0.05rem 0.25rem', borderRadius: '3px' }}>HepC -</span>
                </div>
              </div>
            </div>
          )}

          {/* Doctor Remarks & Quick Actions */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem', paddingTop: '0.75rem', borderTop: '1px solid var(--border-subtle)' }}>
            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
              Report Code: <b style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-main)' }}>{healthReport?.report_code || '—'}</b> | {healthReport?.doctor_name || 'Dr. Sarah Lin, MD'} ({healthReport?.facility_name || 'Transfusion Lab'})
            </div>

            <button
              type="button"
              onClick={openHealthModal}
              className="btn btn-primary"
              style={{ fontSize: '0.8rem', padding: '0.4rem 0.85rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}
            >
              <Activity size={14} />
              Update Vitals / Clinical Checkup
            </button>
          </div>
        </div>

        {/* ── 2. Active Emergency Requests Near You ── */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
              <AlertCircle size={22} color="var(--crimson-500)" />
              Urgent Blood Requests Near You
            </h2>
            <span className="badge badge-red">
              {matchingAlerts.length} Urgent Request{matchingAlerts.length !== 1 ? 's' : ''}
            </span>
          </div>

          {loadError && (
            <div
              style={{
                background: 'rgba(239, 68, 68, 0.12)',
                border: '1px solid var(--crimson-500)',
                padding: '0.75rem 1rem',
                borderRadius: '8px',
                marginBottom: '1rem',
                color: 'var(--crimson-500)',
                fontSize: '0.85rem',
              }}
            >
              {loadError}
            </div>
          )}

          {/* Hospital Fulfillment Success Celebration Banner */}
          {fulfilledNotification && (
            <div
              style={{
                background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.22), rgba(6, 182, 212, 0.18))',
                border: '1.5px solid var(--emerald-500)',
                padding: '1rem 1.25rem',
                borderRadius: '12px',
                marginBottom: '1.25rem',
                fontSize: '0.92rem',
                fontWeight: 700,
                color: 'var(--text-main)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '0.75rem',
                boxShadow: '0 0 25px rgba(16, 185, 129, 0.25)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                <CheckCircle size={22} color="var(--emerald-400)" style={{ flexShrink: 0 }} />
                <span>{fulfilledNotification}</span>
              </div>
              <button
                onClick={() => setFulfilledNotification(null)}
                aria-label="Dismiss message"
                style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
              >
                <X size={18} />
              </button>
            </div>
          )}

          {/* ── Active In-Progress Commitments ("Get to It!") ── */}
          {activeCommitments.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginBottom: '1.5rem' }}>
              {activeCommitments.map((comm) => (
                <div
                  key={comm.id}
                  id={`active-mission-${comm.request_id || comm.id}`}
                  className="glass-panel"
                  style={{
                    border: '2px solid var(--cyan-500)',
                    background: 'linear-gradient(135deg, rgba(6, 182, 212, 0.12), rgba(15, 23, 42, 0.75))',
                    padding: '1.25rem 1.5rem',
                    position: 'relative',
                    boxShadow: '0 0 25px rgba(6, 182, 212, 0.18)',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '0.75rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                      <div
                        style={{
                          width: '44px',
                          height: '44px',
                          borderRadius: '10px',
                          background: 'rgba(6, 182, 212, 0.2)',
                          border: '1.5px solid var(--cyan-400)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        <Navigation size={22} color="var(--cyan-400)" />
                      </div>
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                          <span className="badge badge-cyan" style={{ fontSize: '0.75rem', fontWeight: 800 }}>
                            🚨 ACTIVE MISSION — GET TO IT!
                          </span>
                          <span style={{ fontSize: '1.2rem', fontWeight: 800, color: 'var(--text-main)' }}>
                            {comm.units}x {comm.blood_group} ({comm.component_type === 'PRBC' ? 'Red Blood Cells' : comm.component_type})
                          </span>
                        </div>
                        <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>
                          Request Identifier: <b style={{ fontFamily: 'var(--font-mono)', color: 'var(--cyan-300)' }}>{comm.request_code || (comm.request_id ? `REQ-${comm.request_id.slice(0, 6).toUpperCase()}` : 'EMERGENCY-REQ')}</b>
                        </div>
                      </div>
                    </div>

                    <div
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '0.4rem',
                        padding: '0.4rem 0.85rem',
                        borderRadius: '8px',
                        fontSize: '0.8rem',
                        fontWeight: 700,
                        background: 'rgba(245, 158, 11, 0.15)',
                        color: 'var(--amber-400)',
                        border: '1px solid rgba(245, 158, 11, 0.35)',
                      }}
                    >
                      <Clock size={14} />
                      Awaiting Blood Donation at Ward
                    </div>
                  </div>

                  {/* Destination & Actionable Instructions */}
                  <div
                    style={{
                      background: 'rgba(15, 23, 42, 0.75)',
                      border: '1px solid var(--border-subtle)',
                      borderRadius: '8px',
                      padding: '0.9rem 1.1rem',
                      marginTop: '0.5rem',
                      marginBottom: '1rem',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', fontSize: '0.98rem', fontWeight: 700, color: 'var(--cyan-300)', marginBottom: '0.25rem' }}>
                      <MapPin size={16} color="var(--cyan-400)" />
                      Destination: {comm.hospital_name || 'Emergency Partner Hospital'}
                    </div>
                    <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginBottom: '0.6rem' }}>
                      📍 {comm.hospital_address || 'Central District Hospital Emergency Transfusion Ward'}
                    </div>
                    <div style={{ fontSize: '0.86rem', color: 'var(--text-main)', lineHeight: 1.45, background: 'rgba(6, 182, 212, 0.08)', padding: '0.6rem 0.8rem', borderRadius: '6px', borderLeft: '3px solid var(--cyan-400)' }}>
                      <b>Get to it!</b> You accepted this blood donation commitment. Please head to <b>{comm.hospital_name || 'the hospital'}</b> immediately to donate your blood. Once you arrive at the transfusion ward and donate blood, hospital clinical staff will confirm receipt and mark this request as <b>Fulfilled</b>.
                    </div>
                  </div>

                  {/* Distance / ETA / Commitment Metrics */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.75rem', marginBottom: '1rem' }}>
                    <div style={{ background: 'var(--color-bg)', padding: '0.65rem 0.85rem', borderRadius: '8px', border: '1px solid var(--border-subtle)' }}>
                      <div style={{ fontSize: '0.7rem', color: 'var(--text-dim)', fontWeight: 700 }}>DISTANCE TO WARD</div>
                      <div style={{ fontSize: '1.15rem', fontWeight: 800, color: 'var(--text-main)', marginTop: '0.15rem' }}>
                        {comm.distance_km != null ? `${comm.distance_km} km` : '~3.5 km'}
                      </div>
                    </div>
                    <div style={{ background: 'var(--color-bg)', padding: '0.65rem 0.85rem', borderRadius: '8px', border: '1px solid var(--border-subtle)' }}>
                      <div style={{ fontSize: '0.7rem', color: 'var(--text-dim)', fontWeight: 700 }}>ESTIMATED TRANSIT (ETA)</div>
                      <div style={{ fontSize: '1.15rem', fontWeight: 800, color: 'var(--cyan-400)', marginTop: '0.15rem' }}>
                        ~{Math.round((comm.distance_km ?? 3.5) * 2.5 + 5)} min
                      </div>
                    </div>
                    <div style={{ background: 'var(--color-bg)', padding: '0.65rem 0.85rem', borderRadius: '8px', border: '1px solid var(--border-subtle)' }}>
                      <div style={{ fontSize: '0.7rem', color: 'var(--text-dim)', fontWeight: 700 }}>YOUR COMMITMENT</div>
                      <div style={{ fontSize: '1.05rem', fontWeight: 800, color: 'var(--emerald-400)', marginTop: '0.15rem' }}>
                        {comm.units} Bag{comm.units > 1 ? 's' : ''} Confirmed
                      </div>
                    </div>
                  </div>

                  {telemetryStatus && (
                    <div style={{ fontSize: '0.8rem', color: 'var(--cyan-400)', padding: '0.45rem 0.75rem', background: 'rgba(6, 182, 212, 0.1)', borderRadius: '6px', marginBottom: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                      <Radio size={14} /> {telemetryStatus}
                    </div>
                  )}

                  {/* Live Telemetry Actions */}
                  <div style={{ display: 'flex', gap: '0.65rem', flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      onClick={() => transmitTelemetry(false)}
                      disabled={telemetrySending}
                      className="btn btn-secondary"
                      style={{ fontSize: '0.8rem', padding: '0.45rem 0.9rem' }}
                    >
                      <Radio size={14} />
                      {telemetrySending ? 'Pinging GPS...' : 'Transmit Live GPS Telemetry'}
                    </button>
                    <button
                      type="button"
                      onClick={() => transmitTelemetry(true)}
                      disabled={telemetrySending}
                      className="btn btn-cyan"
                      style={{ fontSize: '0.8rem', padding: '0.45rem 0.9rem' }}
                      title="Simulates moving within 350m of hospital ward to trigger trauma thaw alert"
                    >
                      <Navigation size={14} />
                      Simulate Ward Approach (&lt;500m)
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {activeCommitments.length === 0 && lastResult && (
            <div
              style={{
                background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.12), rgba(6, 182, 212, 0.08))',
                border: '1px solid var(--emerald-500)',
                padding: '1.25rem',
                borderRadius: '12px',
                marginBottom: '1.25rem',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <Navigation size={18} color="var(--emerald-400)" />
                  <span style={{ fontWeight: 800, color: 'var(--emerald-400)', fontSize: '1rem' }}>
                    En-Route to Recipient Hospital — Get To It!
                  </span>
                </div>
                <span className="badge badge-green">DISPATCH CONFIRMED</span>
              </div>

              <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', lineHeight: 1.4 }}>
                Thank you! You are confirmed to help this patient. Please head toward the hospital immediately. Live GPS telemetry streams your position to calculate real-time ETA.
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
                    {lastResult.bags_committed
                      ? `${lastResult.bags_committed} Bag${lastResult.bags_committed > 1 ? 's' : ''} Committed (${lastResult.units_covered ?? 1}/${lastResult.units_requested ?? 1} Covered)`
                      : lastResult.units_covered != null && lastResult.units_requested != null
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
            <div
              style={{
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
              }}
            >
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

          {matchingAlerts.length === 0 && (
            <div className="glass-panel" style={{ textAlign: 'center', padding: '3.5rem', color: 'var(--text-muted)' }}>
              <UserCheck size={36} color="var(--text-dim)" style={{ marginBottom: '0.75rem' }} />
              <p>No open emergency blood requests matching your group right now.</p>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-dim)', marginTop: '0.5rem' }}>
                {isDeferred
                  ? 'Your account has an active health screening deferral. Donations are paused for volunteer safety.'
                  : 'When a hospital runs out of blood bags in storage, an urgent alert will buzz here so you can accept and help save a life.'}
              </p>
            </div>
          )}

          {/* Alerts that were dismissed stay reachable here */}
          {matchingAlerts.length > 0 && visibleAlerts.length === 0 && (
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
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.4rem',
                            background: 'rgba(16, 185, 129, 0.12)',
                            padding: '0.4rem 0.8rem',
                            borderRadius: '8px',
                            border: '1px solid rgba(16, 185, 129, 0.3)',
                          }}
                        >
                          <div
                            style={{
                              width: '8px',
                              height: '8px',
                              borderRadius: '50%',
                              background: 'var(--emerald-500)',
                              boxShadow: '0 0 6px var(--emerald-500)',
                              animation: 'pulseGlow 2s infinite',
                            }}
                          />
                          <span style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--emerald-500)' }}>
                            Open — Respond when ready
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
                        You can commit {stillNeeded > 1 ? `up to ${stillNeeded} bags` : '1 bag'} to help save this patient.
                      </p>
                    </div>

                    {/* Stepper or Action Buttons */}
                    {pendingAccept === alert.id ? (
                      <div
                        style={{
                          marginTop: '1.25rem',
                          background: 'rgba(239, 68, 68, 0.06)',
                          border: '1px solid rgba(239, 68, 68, 0.25)',
                          borderRadius: '10px',
                          padding: '1rem 1.25rem',
                        }}
                      >
                        <div style={{ fontSize: '0.88rem', fontWeight: 700, color: 'var(--text-main)', marginBottom: '0.75rem' }}>
                          How many bags can you donate?
                          <span style={{ fontWeight: 400, color: 'var(--text-muted)', marginLeft: '0.4rem' }}>
                            (max {stillNeeded} — current shortfall)
                          </span>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
                          <button
                            onClick={() => setBagCounts((prev) => ({ ...prev, [alert.id]: Math.max(1, (prev[alert.id] ?? 1) - 1) }))}
                            disabled={(bagCounts[alert.id] ?? 1) <= 1}
                            style={{
                              width: '36px',
                              height: '36px',
                              borderRadius: '8px',
                              border: '1.5px solid var(--border-subtle)',
                              background: 'var(--color-bg)',
                              fontSize: '1.2rem',
                              fontWeight: 700,
                              color: (bagCounts[alert.id] ?? 1) <= 1 ? 'var(--text-dim)' : 'var(--text-main)',
                              cursor: (bagCounts[alert.id] ?? 1) <= 1 ? 'not-allowed' : 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                            }}
                          >
                            −
                          </button>

                          <div
                            style={{
                              minWidth: '56px',
                              textAlign: 'center',
                              fontSize: '1.6rem',
                              fontWeight: 800,
                              color: 'var(--crimson-500)',
                              lineHeight: 1,
                            }}
                          >
                            {bagCounts[alert.id] ?? 1}
                            <div style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-muted)', marginTop: '0.15rem' }}>
                              {(bagCounts[alert.id] ?? 1) === 1 ? 'bag' : 'bags'}
                            </div>
                          </div>

                          <button
                            onClick={() => setBagCounts((prev) => ({ ...prev, [alert.id]: Math.min(stillNeeded, (prev[alert.id] ?? 1) + 1) }))}
                            disabled={(bagCounts[alert.id] ?? 1) >= stillNeeded}
                            style={{
                              width: '36px',
                              height: '36px',
                              borderRadius: '8px',
                              border: '1.5px solid var(--border-subtle)',
                              background: 'var(--color-bg)',
                              fontSize: '1.2rem',
                              fontWeight: 700,
                              color: (bagCounts[alert.id] ?? 1) >= stillNeeded ? 'var(--text-dim)' : 'var(--text-main)',
                              cursor: (bagCounts[alert.id] ?? 1) >= stillNeeded ? 'not-allowed' : 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                            }}
                          >
                            +
                          </button>

                          {stillNeeded > 1 && (
                            <div style={{ display: 'flex', gap: '0.35rem', marginLeft: '0.5rem', flexWrap: 'wrap' }}>
                              {Array.from({ length: stillNeeded }, (_, i) => i + 1).map((n) => (
                                <button
                                  key={n}
                                  onClick={() => setBagCounts((prev) => ({ ...prev, [alert.id]: n }))}
                                  style={{
                                    padding: '0.2rem 0.55rem',
                                    borderRadius: '6px',
                                    border: '1.5px solid',
                                    borderColor: (bagCounts[alert.id] ?? 1) === n ? 'var(--crimson-500)' : 'var(--border-subtle)',
                                    background: (bagCounts[alert.id] ?? 1) === n ? 'rgba(239,68,68,0.12)' : 'var(--color-bg)',
                                    color: (bagCounts[alert.id] ?? 1) === n ? 'var(--crimson-500)' : 'var(--text-muted)',
                                    fontWeight: 700,
                                    fontSize: '0.8rem',
                                    cursor: 'pointer',
                                  }}
                                >
                                  {n}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>

                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.6rem' }}>
                          <button
                            onClick={() => setPendingAccept(null)}
                            className="btn btn-secondary"
                            style={{ fontSize: '0.82rem', padding: '0.45rem 0.9rem' }}
                          >
                            Cancel
                          </button>
                          <button
                            onClick={() => handleRespond(alert.id, 'ACCEPT', bagCounts[alert.id] ?? 1)}
                            className="btn btn-primary"
                            style={{ fontSize: '0.85rem', padding: '0.45rem 1.2rem' }}
                          >
                            <CheckCircle size={15} />
                            Confirm — {bagCounts[alert.id] ?? 1} bag{(bagCounts[alert.id] ?? 1) > 1 ? 's' : ''} & Head to Hospital
                          </button>
                        </div>
                      </div>
                    ) : (
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

                        {/* Health Deferral Guard on Action Button */}
                        {isDeferred ? (
                          <button
                            disabled
                            className="btn btn-secondary"
                            style={{
                              fontSize: '0.85rem',
                              padding: '0.5rem 1.25rem',
                              opacity: 0.6,
                              cursor: 'not-allowed',
                              border: '1px dashed var(--amber-500)',
                              color: 'var(--amber-400)',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '0.4rem',
                            }}
                            title={`Donation paused: ${healthReport?.deferral_reason || 'Medical deferral active'}`}
                          >
                            <AlertTriangle size={15} color="var(--amber-400)" />
                            Donation Paused (Health Deferral)
                          </button>
                        ) : (
                          <button
                            id={`btn-accept-${alert.id}`}
                            onClick={() => handleAcceptClick(alert.id, stillNeeded)}
                            className="btn btn-primary"
                            style={{ fontSize: '0.85rem', padding: '0.5rem 1.25rem' }}
                          >
                            <CheckCircle size={16} />
                            {stillNeeded > 1 ? 'I Can Help! — Select Bags' : 'I Can Help! (1 Bag)'}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ── Modal: Update Vitals / Clinical Checkup ── */}
      {isUpdatingHealth && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.75)',
            backdropFilter: 'blur(5px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '1rem',
          }}
        >
          <div
            className="glass-panel"
            style={{
              maxWidth: '560px',
              width: '100%',
              maxHeight: '90vh',
              overflowY: 'auto',
              border: '1px solid var(--border-subtle)',
              borderRadius: '12px',
              padding: '1.5rem',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                <Stethoscope size={22} color="var(--crimson-500)" />
                <h3 style={{ fontSize: '1.15rem', fontWeight: 800, margin: 0 }}>
                  Log Clinical Health Screening
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setIsUpdatingHealth(false)}
                style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
              >
                <X size={20} />
              </button>
            </div>

            {healthFormError && (
              <div
                style={{
                  background: 'rgba(239, 68, 68, 0.15)',
                  border: '1px solid var(--crimson-500)',
                  borderRadius: '8px',
                  padding: '0.65rem 0.85rem',
                  fontSize: '0.82rem',
                  color: 'var(--crimson-500)',
                  marginBottom: '1rem',
                }}
              >
                {healthFormError}
              </div>
            )}

            {/* Quick Test Presets */}
            <div style={{ marginBottom: '1.25rem', padding: '0.75rem', background: 'var(--color-bg)', borderRadius: '8px', border: '1px solid var(--border-subtle)' }}>
              <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '0.45rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                <Sparkles size={13} color="var(--amber-400)" />
                QUICK CLINICAL SIMULATION PRESETS:
              </div>
              <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  onClick={() => applyPreset('fit')}
                  className="btn btn-secondary"
                  style={{ fontSize: '0.74rem', padding: '0.25rem 0.55rem', border: '1px solid var(--emerald-500)', color: 'var(--emerald-400)' }}
                >
                  ✓ Fit (Hb 14.2 g/dL)
                </button>
                <button
                  type="button"
                  onClick={() => applyPreset('anemia')}
                  className="btn btn-secondary"
                  style={{ fontSize: '0.74rem', padding: '0.25rem 0.55rem', border: '1px solid var(--amber-500)', color: 'var(--amber-400)' }}
                >
                  ⚠️ Low Hb (11.2 g/dL)
                </button>
                <button
                  type="button"
                  onClick={() => applyPreset('hypertension')}
                  className="btn btn-secondary"
                  style={{ fontSize: '0.74rem', padding: '0.25rem 0.55rem', border: '1px solid var(--crimson-500)', color: 'var(--crimson-500)' }}
                >
                  ⚠️ High BP (152/96)
                </button>
                <button
                  type="button"
                  onClick={() => applyPreset('underweight')}
                  className="btn btn-secondary"
                  style={{ fontSize: '0.74rem', padding: '0.25rem 0.55rem', border: '1px solid var(--cyan-400)', color: 'var(--cyan-400)' }}
                >
                  ⚠️ Underweight (46 kg)
                </button>
              </div>
            </div>

            <form onSubmit={handleSubmitHealth} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.85rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 700, marginBottom: '0.3rem', color: 'var(--text-muted)' }}>
                    Hemoglobin Level (g/dL) *
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    min="5.0"
                    max="22.0"
                    value={hbInput}
                    onChange={(e) => setHbInput(parseFloat(e.target.value) || 0)}
                    required
                    style={{
                      width: '100%',
                      padding: '0.55rem 0.75rem',
                      borderRadius: '6px',
                      border: `1px solid ${hbInput >= 12.5 ? 'var(--border-subtle)' : 'var(--amber-500)'}`,
                      background: 'var(--color-bg)',
                      color: 'var(--text-main)',
                      fontSize: '0.88rem',
                    }}
                  />
                  <span style={{ fontSize: '0.7rem', color: hbInput >= 12.5 ? 'var(--emerald-400)' : 'var(--amber-400)', marginTop: '0.2rem', display: 'block' }}>
                    {hbInput >= 12.5 ? '✓ Meets minimum safe threshold (≥12.5)' : '⚠️ Below minimum 12.5 g/dL (will defer)'}
                  </span>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 700, marginBottom: '0.3rem', color: 'var(--text-muted)' }}>
                    Body Weight (kg) *
                  </label>
                  <input
                    type="number"
                    step="0.5"
                    min="30.0"
                    max="250.0"
                    value={weightInput}
                    onChange={(e) => setWeightInput(parseFloat(e.target.value) || 0)}
                    required
                    style={{
                      width: '100%',
                      padding: '0.55rem 0.75rem',
                      borderRadius: '6px',
                      border: `1px solid ${weightInput >= 50.0 ? 'var(--border-subtle)' : 'var(--amber-500)'}`,
                      background: 'var(--color-bg)',
                      color: 'var(--text-main)',
                      fontSize: '0.88rem',
                    }}
                  />
                  <span style={{ fontSize: '0.7rem', color: weightInput >= 50.0 ? 'var(--text-dim)' : 'var(--amber-400)', marginTop: '0.2rem', display: 'block' }}>
                    {weightInput >= 50.0 ? 'Safe for standard collection (≥50 kg)' : '⚠️ Below 50 kg (will defer)'}
                  </span>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.85rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 700, marginBottom: '0.3rem', color: 'var(--text-muted)' }}>
                    Systolic BP (mmHg) *
                  </label>
                  <input
                    type="number"
                    min="60"
                    max="220"
                    value={sysInput}
                    onChange={(e) => setSysInput(parseInt(e.target.value) || 0)}
                    required
                    style={{
                      width: '100%',
                      padding: '0.55rem 0.75rem',
                      borderRadius: '6px',
                      border: '1px solid var(--border-subtle)',
                      background: 'var(--color-bg)',
                      color: 'var(--text-main)',
                      fontSize: '0.88rem',
                    }}
                  />
                  <span style={{ fontSize: '0.7rem', color: 'var(--text-dim)' }}>Safe range: 90–140 mmHg</span>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 700, marginBottom: '0.3rem', color: 'var(--text-muted)' }}>
                    Diastolic BP (mmHg) *
                  </label>
                  <input
                    type="number"
                    min="40"
                    max="140"
                    value={diaInput}
                    onChange={(e) => setDiaInput(parseInt(e.target.value) || 0)}
                    required
                    style={{
                      width: '100%',
                      padding: '0.55rem 0.75rem',
                      borderRadius: '6px',
                      border: '1px solid var(--border-subtle)',
                      background: 'var(--color-bg)',
                      color: 'var(--text-main)',
                      fontSize: '0.88rem',
                    }}
                  />
                  <span style={{ fontSize: '0.7rem', color: 'var(--text-dim)' }}>Safe range: 60–90 mmHg</span>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.85rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 700, marginBottom: '0.3rem', color: 'var(--text-muted)' }}>
                    Resting Pulse (bpm) *
                  </label>
                  <input
                    type="number"
                    min="40"
                    max="180"
                    value={pulseInput}
                    onChange={(e) => setPulseInput(parseInt(e.target.value) || 0)}
                    required
                    style={{
                      width: '100%',
                      padding: '0.55rem 0.75rem',
                      borderRadius: '6px',
                      border: '1px solid var(--border-subtle)',
                      background: 'var(--color-bg)',
                      color: 'var(--text-main)',
                      fontSize: '0.88rem',
                    }}
                  />
                  <span style={{ fontSize: '0.7rem', color: 'var(--text-dim)' }}>Target: 60–100 bpm</span>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 700, marginBottom: '0.3rem', color: 'var(--text-muted)' }}>
                    Body Temp (°C) *
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    min="34.0"
                    max="41.0"
                    value={tempInput}
                    onChange={(e) => setTempInput(parseFloat(e.target.value) || 0)}
                    required
                    style={{
                      width: '100%',
                      padding: '0.55rem 0.75rem',
                      borderRadius: '6px',
                      border: '1px solid var(--border-subtle)',
                      background: 'var(--color-bg)',
                      color: 'var(--text-main)',
                      fontSize: '0.88rem',
                    }}
                  />
                  <span style={{ fontSize: '0.7rem', color: 'var(--text-dim)' }}>Normal: 36.0–37.5 °C</span>
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 700, marginBottom: '0.3rem', color: 'var(--text-muted)' }}>
                  Doctor / Clinical Remarks
                </label>
                <textarea
                  rows={2}
                  value={doctorRemarksInput}
                  onChange={(e) => setDoctorRemarksInput(e.target.value)}
                  placeholder="Physician notes, recommendations, or recovery advice..."
                  style={{
                    width: '100%',
                    padding: '0.55rem 0.75rem',
                    borderRadius: '6px',
                    border: '1px solid var(--border-subtle)',
                    background: 'var(--color-bg)',
                    color: 'var(--text-main)',
                    fontSize: '0.85rem',
                    resize: 'none',
                  }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '0.5rem' }}>
                <button
                  type="button"
                  onClick={() => setIsUpdatingHealth(false)}
                  className="btn btn-secondary"
                  style={{ fontSize: '0.85rem', padding: '0.5rem 1rem' }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={healthSubmitting}
                  className="btn btn-primary"
                  style={{ fontSize: '0.85rem', padding: '0.5rem 1.25rem' }}
                >
                  {healthSubmitting ? 'Evaluating Vitals...' : 'Save & Evaluate Clearance'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Modal: Official Medical Clearance Certificate ── */}
      {isCertificateOpen && healthReport && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.8)',
            backdropFilter: 'blur(6px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '1rem',
          }}
        >
          <div
            className="glass-panel"
            style={{
              maxWidth: '620px',
              width: '100%',
              maxHeight: '92vh',
              overflowY: 'auto',
              border: '2px solid rgba(255, 255, 255, 0.15)',
              borderRadius: '16px',
              padding: '2rem',
              background: '#0f172a',
              color: '#f8fafc',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '2px solid var(--border-subtle)', paddingBottom: '1rem', marginBottom: '1.25rem' }}>
              <div>
                <div style={{ fontSize: '0.75rem', fontWeight: 800, color: 'var(--crimson-500)', letterSpacing: '0.1em' }}>
                  CENTRAL TRANSFUSION CLINICAL NETWORK
                </div>
                <h2 style={{ fontSize: '1.4rem', fontWeight: 800, margin: '0.25rem 0 0 0' }}>
                  Volunteer Health & Donation Clearance Certificate
                </h2>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>
                  Official Record ID: <span style={{ fontFamily: 'var(--font-mono)', color: '#f8fafc' }}>{healthReport.report_code}</span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsCertificateOpen(false)}
                style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
              >
                <X size={20} />
              </button>
            </div>

            {/* Donor Demographic summary */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', background: 'rgba(255, 255, 255, 0.03)', padding: '0.85rem', borderRadius: '8px', marginBottom: '1.25rem' }}>
              <div>
                <span style={{ fontSize: '0.72rem', color: 'var(--text-dim)' }}>DONOR NAME</span>
                <div style={{ fontWeight: 700, fontSize: '0.95rem' }}>{user?.full_name || 'Volunteer Donor'}</div>
              </div>
              <div>
                <span style={{ fontSize: '0.72rem', color: 'var(--text-dim)' }}>BLOOD GROUP</span>
                <div style={{ fontWeight: 800, fontSize: '1rem', color: 'var(--crimson-500)' }}>{donorProfile?.blood_group}</div>
              </div>
              <div>
                <span style={{ fontSize: '0.72rem', color: 'var(--text-dim)' }}>DATE OF EXAMINATION</span>
                <div style={{ fontWeight: 600, fontSize: '0.85rem' }}>{new Date(healthReport.created_at).toLocaleDateString()}</div>
              </div>
              <div>
                <span style={{ fontSize: '0.72rem', color: 'var(--text-dim)' }}>FACILITY</span>
                <div style={{ fontWeight: 600, fontSize: '0.85rem' }}>{healthReport.facility_name}</div>
              </div>
            </div>

            {/* Vitals Table */}
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem', marginBottom: '1.25rem' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-subtle)', textAlign: 'left', color: 'var(--text-dim)' }}>
                  <th style={{ padding: '0.45rem 0' }}>Clinical Parameter</th>
                  <th style={{ padding: '0.45rem 0' }}>Recorded Value</th>
                  <th style={{ padding: '0.45rem 0' }}>Reference Threshold</th>
                  <th style={{ padding: '0.45rem 0', textAlign: 'right' }}>Status</th>
                </tr>
              </thead>
              <tbody>
                <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                  <td style={{ padding: '0.5rem 0', fontWeight: 600 }}>Hemoglobin (Hb)</td>
                  <td style={{ padding: '0.5rem 0', fontWeight: 700 }}>{healthReport.hemoglobin_g_dl} g/dL</td>
                  <td style={{ padding: '0.5rem 0', color: 'var(--text-muted)' }}>≥ 12.5 g/dL</td>
                  <td style={{ padding: '0.5rem 0', textAlign: 'right' }}>
                    <span style={{ color: healthReport.hemoglobin_g_dl >= 12.5 ? 'var(--emerald-400)' : 'var(--amber-400)', fontWeight: 700 }}>
                      {healthReport.hemoglobin_g_dl >= 12.5 ? 'PASSED' : 'DEFERRED'}
                    </span>
                  </td>
                </tr>
                <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                  <td style={{ padding: '0.5rem 0', fontWeight: 600 }}>Blood Pressure</td>
                  <td style={{ padding: '0.5rem 0', fontWeight: 700 }}>{healthReport.systolic_bp} / {healthReport.diastolic_bp} mmHg</td>
                  <td style={{ padding: '0.5rem 0', color: 'var(--text-muted)' }}>90-140 / 60-90</td>
                  <td style={{ padding: '0.5rem 0', textAlign: 'right' }}>
                    <span style={{ color: 'var(--emerald-400)', fontWeight: 700 }}>PASSED</span>
                  </td>
                </tr>
                <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                  <td style={{ padding: '0.5rem 0', fontWeight: 600 }}>Resting Pulse</td>
                  <td style={{ padding: '0.5rem 0', fontWeight: 700 }}>{healthReport.pulse_bpm} bpm</td>
                  <td style={{ padding: '0.5rem 0', color: 'var(--text-muted)' }}>60 - 100 bpm</td>
                  <td style={{ padding: '0.5rem 0', textAlign: 'right' }}>
                    <span style={{ color: 'var(--emerald-400)', fontWeight: 700 }}>PASSED</span>
                  </td>
                </tr>
                <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                  <td style={{ padding: '0.5rem 0', fontWeight: 600 }}>Body Temperature</td>
                  <td style={{ padding: '0.5rem 0', fontWeight: 700 }}>{healthReport.temperature_c} °C</td>
                  <td style={{ padding: '0.5rem 0', color: 'var(--text-muted)' }}>≤ 37.5 °C</td>
                  <td style={{ padding: '0.5rem 0', textAlign: 'right' }}>
                    <span style={{ color: 'var(--emerald-400)', fontWeight: 700 }}>PASSED</span>
                  </td>
                </tr>
                <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                  <td style={{ padding: '0.5rem 0', fontWeight: 600 }}>Body Weight</td>
                  <td style={{ padding: '0.5rem 0', fontWeight: 700 }}>{healthReport.weight_kg} kg</td>
                  <td style={{ padding: '0.5rem 0', color: 'var(--text-muted)' }}>≥ 50.0 kg</td>
                  <td style={{ padding: '0.5rem 0', textAlign: 'right' }}>
                    <span style={{ color: healthReport.weight_kg >= 50 ? 'var(--emerald-400)' : 'var(--amber-400)', fontWeight: 700 }}>
                      {healthReport.weight_kg >= 50 ? 'PASSED' : 'DEFERRED'}
                    </span>
                  </td>
                </tr>
                <tr>
                  <td style={{ padding: '0.5rem 0', fontWeight: 600 }}>Infectious Screenings</td>
                  <td style={{ padding: '0.5rem 0', fontWeight: 700 }} colSpan={2}>
                    HIV, HepB, HepC, Syphilis, Malaria
                  </td>
                  <td style={{ padding: '0.5rem 0', textAlign: 'right' }}>
                    <span style={{ color: 'var(--emerald-400)', fontWeight: 700 }}>ALL NEGATIVE</span>
                  </td>
                </tr>
              </tbody>
            </table>

            {/* Official Clearance Conclusion Stamp */}
            <div
              style={{
                padding: '1rem',
                borderRadius: '8px',
                border: `2px dashed ${isEligible ? 'var(--emerald-500)' : 'var(--amber-500)'}`,
                background: isEligible ? 'rgba(16, 185, 129, 0.1)' : 'rgba(245, 158, 11, 0.1)',
                textAlign: 'center',
                marginBottom: '1.25rem',
              }}
            >
              <div style={{ fontSize: '0.8rem', fontWeight: 800, letterSpacing: '0.05em', color: isEligible ? 'var(--emerald-400)' : 'var(--amber-400)' }}>
                {isEligible ? 'OFFICIAL CLINICAL CLEARANCE: MEDICALLY FIT TO DONATE' : 'OFFICIAL CLINICAL CLEARANCE: TEMPORARILY DEFERRED'}
              </div>
              <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.35rem' }}>
                {healthReport.doctor_remarks || 'Clearance verified according to clinical transfusion medicine standards.'}
              </div>
              {healthReport.deferral_end_date && (
                <div style={{ fontSize: '0.78rem', color: 'var(--amber-400)', marginTop: '0.35rem', fontWeight: 700 }}>
                  Recommended re-evaluation date: {healthReport.deferral_end_date}
                </div>
              )}
            </div>

            {/* Signature Area */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
              <div>
                <div>Transfusion Board Examiner:</div>
                <div style={{ fontWeight: 800, color: '#f8fafc', fontSize: '0.9rem', marginTop: '0.2rem' }}>{healthReport.doctor_name}</div>
                <div>Transfusion Medicine Specialist</div>
              </div>
              <div style={{ display: 'flex', gap: '0.6rem' }}>
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="btn btn-primary"
                  style={{ fontSize: '0.82rem', padding: '0.45rem 0.95rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}
                >
                  <Printer size={15} />
                  Print Record
                </button>
                <button
                  type="button"
                  onClick={() => setIsCertificateOpen(false)}
                  className="btn btn-secondary"
                  style={{ fontSize: '0.82rem', padding: '0.45rem 0.95rem' }}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
