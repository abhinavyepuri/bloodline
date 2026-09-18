import React from 'react';
import { useAuth } from '../context/AuthContext';
import { useWebSocket } from '../context/WebSocketContext';
import { Activity, ShieldAlert, Building2, Droplet, UserCheck, Radio } from 'lucide-react';
import { UserRole } from '../types';

export const Header: React.FC = () => {
  const { user, activeRole, switchRole, isLoading } = useAuth();
  const { isConnected } = useWebSocket();

  const roleConfigs: { label: string; role: UserRole; email?: string; icon: React.ReactNode }[] = [
    { label: 'City Overview', role: 'COORDINATOR', icon: <Radio size={16} /> },
    { label: 'Hospital Desk', role: 'HOSPITAL', icon: <Building2 size={16} /> },
    { label: 'Blood Bank Storage', role: 'BLOOD_BANK', icon: <Droplet size={16} /> },
    { label: 'Volunteer: Alice', role: 'DONOR', email: 'alice@donor.org', icon: <UserCheck size={16} /> },
    { label: 'Volunteer: Bob', role: 'DONOR', email: 'bob@donor.org', icon: <UserCheck size={16} /> },
  ];

  return (
    <header style={{
      background: 'rgba(17, 23, 38, 0.9)',
      backdropFilter: 'blur(16px)',
      borderBottom: '1px solid var(--border-subtle)',
      position: 'sticky',
      top: 0,
      zIndex: 50,
      padding: '0.75rem 1.5rem'
    }}>
      <div style={{
        maxWidth: '1400px',
        margin: '0 auto',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: '1rem'
      }}>
        {/* Brand & Connection Status */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '40px',
            height: '40px',
            borderRadius: '10px',
            background: 'linear-gradient(135deg, var(--crimson-500), #991b1b)',
            boxShadow: '0 0 15px var(--crimson-glow)',
            color: 'white'
          }}>
            <Activity size={24} />
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <h1 style={{ fontSize: '1.25rem', fontWeight: 800, letterSpacing: '-0.02em' }}>
                SmartBlood <span style={{ color: 'var(--crimson-500)', fontSize: '0.85rem', fontWeight: 600 }}>LIVE</span>
              </h1>
              <span className={`pulse-dot ${isConnected ? '' : 'pulse-red'}`} title={isConnected ? 'Real-time WebSocket active' : 'Connecting...'} />
              <span style={{ fontSize: '0.75rem', color: isConnected ? 'var(--emerald-400)' : 'var(--crimson-500)', fontWeight: 600 }}>
                {isConnected ? 'ONLINE & READY' : 'CONNECTING...'}
              </span>
            </div>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              Fast Blood Delivery & Volunteer Donor Emergency Network
            </p>
          </div>
        </div>

        {/* Role Switcher */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: 'rgba(10, 13, 20, 0.7)', padding: '0.35rem', borderRadius: '10px', border: '1px solid var(--border-subtle)' }}>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)', padding: '0 0.5rem', fontWeight: 600 }}>
            SWITCH VIEW:
          </span>
          {roleConfigs.map((cfg) => {
            const isSelected =
              activeRole === cfg.role &&
              (!cfg.email || (user && user.email === cfg.email));

            return (
              <button
                key={cfg.label}
                id={`role-btn-${cfg.label.toLowerCase().replace(/[^a-z0-9]/g, '-')}`}
                disabled={isLoading}
                onClick={() => switchRole(cfg.role, cfg.email)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.4rem',
                  padding: '0.4rem 0.75rem',
                  fontSize: '0.8rem',
                  fontWeight: 600,
                  borderRadius: '6px',
                  border: isSelected ? '1px solid rgba(239, 68, 68, 0.5)' : '1px solid transparent',
                  background: isSelected ? 'rgba(239, 68, 68, 0.2)' : 'transparent',
                  color: isSelected ? '#fca5a5' : 'var(--text-muted)',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease'
                }}
              >
                {cfg.icon}
                {cfg.label}
              </button>
            );
          })}
        </div>

        {/* Synthetic Notice */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.75rem', color: 'var(--amber-400)', background: 'rgba(245, 158, 11, 0.1)', padding: '0.35rem 0.65rem', borderRadius: '6px', border: '1px solid rgba(245, 158, 11, 0.2)' }}>
          <ShieldAlert size={14} />
          <span>Demo Practice Mode</span>
        </div>
      </div>
    </header>
  );
};
