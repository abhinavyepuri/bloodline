import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useWebSocket } from '../context/WebSocketContext';
import { Donor, BloodRequest } from '../types';
import { UserCheck, MapPin, Award, CheckCircle, XCircle, Clock, AlertCircle } from 'lucide-react';

export const DonorDashboard: React.FC = () => {
  const { user, token } = useAuth();
  const { lastEvent } = useWebSocket();

  const [donorProfile, setDonorProfile] = useState<Donor | null>(null);
  const [activeAlerts, setActiveAlerts] = useState<BloodRequest[]>([]);
  const [loading, setLoading] = useState(false);
  const [responseStatus, setResponseStatus] = useState<string | null>(null);

  const fetchDonorData = async () => {
    setLoading(true);
    try {
      // Fetch donor profile
      const profRes = await fetch('http://localhost:8000/api/v1/donors/me', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (profRes.ok) {
        const prof = await profRes.json();
        setDonorProfile(prof);
      }

      // Fetch active broadcast alerts
      const alertsRes = await fetch('http://localhost:8000/api/v1/donors/requests/active', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (alertsRes.ok) {
        const alerts = await alertsRes.json();
        setActiveAlerts(alerts);
      }
    } catch (err) {
      console.error('Error fetching donor data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDonorData();
  }, [user, token]);

  useEffect(() => {
    if (
      lastEvent &&
      [
        'EMERGENCY_DISPATCH_ALERT',
        'DONOR_CLAIM_SUCCESS',
        'DONOR_STAND_DOWN',
        'DONOR_AVAILABILITY_CHANGED',
        'RE_PLANNING_TRIGGERED',
        'SYSTEM_RESET',
      ].includes(lastEvent.type)
    ) {
      fetchDonorData();
    }
  }, [lastEvent]);

  const toggleAvailability = async () => {
    if (!donorProfile) return;
    try {
      const res = await fetch('http://localhost:8000/api/v1/donors/availability', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ is_available: !donorProfile.is_available }),
      });
      if (res.ok) {
        const updated = await res.json();
        setDonorProfile(updated);
      }
    } catch (err) {
      console.error('Error updating availability:', err);
    }
  };

  const handleRespond = async (requestId: string, action: 'ACCEPT' | 'DECLINE') => {
    try {
      const res = await fetch(`http://localhost:8000/api/v1/donors/requests/${requestId}/respond`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ action }),
      });

      if (res.status === 409) {
        setResponseStatus('Someone else already agreed to donate. Thank you for your willingness to help!');
        return;
      }

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.detail || 'Failed to submit response');
      }

      const result = await res.json();
      if (action === 'ACCEPT') {
        setResponseStatus('Thank you! You are confirmed to help this patient. Please head toward the hospital.');
      } else {
        setResponseStatus('You declined. We will notify other nearby volunteers.');
      }
      await fetchDonorData();
    } catch (err: any) {
      setResponseStatus(`Error: ${err.message}`);
    }
  };

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
              <span style={{ fontWeight: 700, color: 'white' }}>{donorProfile.total_successful_donations}</span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.8rem', color: 'var(--cyan-400)' }}>
              <MapPin size={14} />
              <span>
                Location: City Center Area
              </span>
            </div>

            {/* Availability Toggle */}
            <div style={{
              background: 'rgba(10, 13, 20, 0.6)',
              padding: '0.85rem',
              borderRadius: '8px',
              border: '1px solid var(--border-subtle)',
              marginTop: '0.5rem',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontSize: '0.85rem', fontWeight: 600 }}>Ready to Donate</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>
                    {donorProfile.is_available ? 'Available for emergency alerts' : 'Paused alerts'}
                  </div>
                </div>
                <button
                  id="btn-toggle-availability"
                  onClick={toggleAvailability}
                  className={`btn ${donorProfile.is_available ? 'btn-cyan' : 'btn-secondary'}`}
                  style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem' }}
                >
                  {donorProfile.is_available ? 'AVAILABLE' : 'PAUSED'}
                </button>
              </div>
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

        {responseStatus && (
          <div style={{
            background: responseStatus.includes('Thank') ? 'rgba(16, 185, 129, 0.2)' : 'rgba(239, 68, 68, 0.2)',
            border: `1px solid ${responseStatus.includes('Thank') ? 'var(--emerald-500)' : 'var(--crimson-500)'}`,
            padding: '0.75rem 1rem',
            borderRadius: '8px',
            marginBottom: '1rem',
            fontSize: '0.85rem',
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}>
            <span>{responseStatus}</span>
            <button onClick={() => setResponseStatus(null)} style={{ background: 'transparent', border: 'none', color: 'white', cursor: 'pointer' }}>
              ✕
            </button>
          </div>
        )}

        {activeAlerts.length === 0 ? (
          <div className="glass-panel" style={{ textAlign: 'center', padding: '3.5rem', color: 'var(--text-muted)' }}>
            <UserCheck size={36} color="var(--text-dim)" style={{ marginBottom: '0.75rem' }} />
            <p>No open emergency blood requests matching your group right now.</p>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-dim)', marginTop: '0.5rem' }}>
              When a hospital runs out of blood bags in storage, an urgent alert will buzz here so you can accept and help save a life.
            </p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            {activeAlerts.map((alert) => (
              <div
                key={alert.id}
                id={`donor-alert-${alert.id}`}
                className="glass-panel highlight-red"
                style={{
                  border: '2px solid var(--crimson-500)',
                  animation: 'pulseGlow 2.5s infinite',
                  position: 'relative',
                  overflow: 'hidden',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '0.5rem' }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.35rem' }}>
                      <span className="badge badge-red" style={{ fontSize: '0.8rem' }}>
                        URGENT DONOR NEEDED
                      </span>
                      <span style={{ fontSize: '1.3rem', fontWeight: 800, color: 'white' }}>
                        {alert.units_requested}x {alert.required_blood_group} ({alert.component_type === 'PRBC' ? 'Red Blood Cells' : alert.component_type})
                      </span>
                    </div>
                    <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                      Metro General Hospital | Urgency: <b>{alert.calculated_urgency_score.toFixed(0)}/100</b>
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: 'rgba(239, 68, 68, 0.2)', padding: '0.4rem 0.8rem', borderRadius: '8px' }}>
                    <Clock size={16} color="var(--crimson-500)" />
                    <span style={{ fontSize: '0.85rem', fontWeight: 800, color: '#fca5a5' }}>
                      Respond in 3 min
                    </span>
                  </div>
                </div>

                <div style={{ marginTop: '1rem', background: 'rgba(10, 13, 20, 0.6)', padding: '0.75rem', borderRadius: '8px', fontSize: '0.85rem' }}>
                  <p style={{ color: '#e5e7eb', lineHeight: 1.4 }}>
                    You are nearby (~2.1 km away, about 4 minutes drive). A patient at the hospital urgently needs this blood type.
                    <b> The first volunteer to tap Accept will be assigned to donate.</b>
                  </p>
                </div>

                {/* Respond Buttons */}
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
                    className="btn btn-primary"
                    style={{ fontSize: '0.85rem', padding: '0.5rem 1.25rem' }}
                  >
                    <CheckCircle size={16} />
                    I Can Help! (Accept & Head to Hospital)
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
