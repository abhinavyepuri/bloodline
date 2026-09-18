import React from 'react';
import { useAuth } from '../context/AuthContext';
import { useWebSocket } from '../context/WebSocketContext';
import { Activity, Building2, Droplet, Heart, Radio, LogOut, Wifi, WifiOff, Shield } from 'lucide-react';
import { UserRole } from '../types';

export const Header: React.FC = () => {
  const { user, activeRole, logout } = useAuth();
  const { isConnected } = useWebSocket();

  const getRoleBadge = (role: UserRole | null) => {
    switch (role) {
      case 'HOSPITAL':
        return {
          label: 'Hospital Trauma Desk',
          icon: <Building2 size={15} />,
          bg: 'rgba(239, 68, 68, 0.12)',
          border: 'rgba(239, 68, 68, 0.3)',
          color: 'var(--crimson-500)',
        };
      case 'BLOOD_BANK':
        return {
          label: 'Cold-Chain Blood Bank',
          icon: <Droplet size={15} />,
          bg: 'rgba(217, 119, 6, 0.12)',
          border: 'rgba(217, 119, 6, 0.3)',
          color: 'var(--amber-500)',
        };
      case 'DONOR':
        return {
          label: 'Volunteer Donor',
          icon: <Heart size={15} />,
          bg: 'rgba(22, 163, 74, 0.12)',
          border: 'rgba(22, 163, 74, 0.3)',
          color: 'var(--emerald-500)',
        };
      case 'COORDINATOR':
      case 'ADMIN':
        return {
          label: role === 'ADMIN' ? 'System Administrator' : 'Emergency Operations Center',
          icon: role === 'ADMIN' ? <Shield size={15} /> : <Radio size={15} />,
          bg: 'rgba(37, 99, 235, 0.12)',
          border: 'rgba(37, 99, 235, 0.3)',
          color: 'var(--cyan-500)',
        };
      default:
        return {
          label: 'Authorized User',
          icon: <Activity size={15} />,
          bg: 'rgba(100, 116, 139, 0.1)',
          border: 'var(--border-subtle)',
          color: 'var(--text-muted)',
        };
    }
  };

  const badge = getRoleBadge(activeRole);

  return (
    <header
      style={{
        background: 'rgba(255, 255, 255, 0.95)',
        backdropFilter: 'blur(16px)',
        borderBottom: '1px solid var(--border-subtle)',
        position: 'sticky',
        top: 0,
        zIndex: 50,
        padding: '0.75rem 1.5rem',
      }}
    >
      <div
        style={{
          maxWidth: '1440px',
          margin: '0 auto',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '1rem',
        }}
      >
        {/* Brand & Mission Statement */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '42px',
              height: '42px',
              borderRadius: '12px',
              background: 'linear-gradient(135deg, var(--crimson-500), #991b1b)',
              boxShadow: '0 4px 14px var(--crimson-glow)',
              color: 'white',
            }}
          >
            <Activity size={24} />
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
              <span style={{ fontSize: '1.2rem', fontWeight: 800, letterSpacing: '-0.02em', color: 'var(--text-main)' }}>
                SmartBlood
              </span>
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.35rem',
                  fontSize: '0.72rem',
                  fontWeight: 700,
                  padding: '0.2rem 0.55rem',
                  borderRadius: '12px',
                  background: isConnected ? 'rgba(22, 163, 74, 0.12)' : 'rgba(239, 68, 68, 0.12)',
                  color: isConnected ? 'var(--emerald-600)' : 'var(--crimson-500)',
                  border: `1px solid ${isConnected ? 'rgba(22, 163, 74, 0.25)' : 'rgba(239, 68, 68, 0.25)'}`,
                }}
              >
                {isConnected ? <Wifi size={12} /> : <WifiOff size={12} />}
                {isConnected ? 'LIVE CONNECTED' : 'RECONNECTING...'}
              </span>
            </div>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              Unified Emergency Blood Coordination & Dispatch Network
            </p>
          </div>
        </div>

        {/* Authenticated User Status & Controls */}
        {user && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            {/* Role Badge */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.45rem',
                padding: '0.35rem 0.75rem',
                borderRadius: '8px',
                background: badge.bg,
                border: `1px solid ${badge.border}`,
                color: badge.color,
                fontSize: '0.78rem',
                fontWeight: 700,
              }}
            >
              {badge.icon}
              <span>{badge.label}</span>
            </div>

            {/* User Profile Card */}
            <div style={{ textAlign: 'right', lineHeight: 1.2 }}>
              <div style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-main)' }}>
                {user.full_name}
              </div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-dim)' }}>
                {user.email}
              </div>
            </div>

            {/* Sign Out Button */}
            <button
              onClick={logout}
              title="Sign Out"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.35rem',
                padding: '0.45rem 0.85rem',
                fontSize: '0.8rem',
                fontWeight: 600,
                borderRadius: '8px',
                border: '1px solid var(--border-subtle)',
                background: 'var(--color-bg)',
                color: 'var(--text-muted)',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
            >
              <LogOut size={15} />
              Sign Out
            </button>
          </div>
        )}
      </div>
    </header>
  );
};
