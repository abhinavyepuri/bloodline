import React from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { WebSocketProvider, useWebSocket } from './context/WebSocketContext';
import { Header } from './components/Header';
import { LoginScreen } from './components/LoginScreen';
import { HospitalDashboard } from './components/HospitalDashboard';
import { BloodBankDashboard } from './components/BloodBankDashboard';
import { DonorDashboard } from './components/DonorDashboard';
import { CoordinatorDashboard } from './components/CoordinatorDashboard';
import { AlertCircle, CheckCircle, Bell, X } from 'lucide-react';

const DashboardSwitch: React.FC = () => {
  const { activeRole } = useAuth();
  const { toastMessage, dismissToast } = useWebSocket();

  return (
    <div className="app-container">
      <Header />

      <main className="main-content">
        {/* Active Toast Notification */}
        {toastMessage && (
          <div
            style={{
              position: 'fixed',
              bottom: '1.5rem',
              right: '1.5rem',
              maxWidth: '420px',
              width: 'calc(100% - 3rem)',
              background:
                toastMessage.type === 'urgent'
                  ? 'linear-gradient(135deg, rgba(220, 38, 38, 0.95), rgba(153, 27, 27, 0.95))'
                  : toastMessage.type === 'success'
                  ? 'linear-gradient(135deg, rgba(16, 185, 129, 0.95), rgba(5, 150, 105, 0.95))'
                  : 'linear-gradient(135deg, rgba(6, 182, 212, 0.95), rgba(3, 105, 161, 0.95))',
              backdropFilter: 'blur(12px)',
              border: '1px solid rgba(255, 255, 255, 0.2)',
              borderRadius: '12px',
              padding: '1rem',
              boxShadow: '0 10px 35px rgba(0,0,0,0.5)',
              zIndex: 9999,
              animation: 'toastSlide 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
              display: 'flex',
              alignItems: 'flex-start',
              gap: '0.75rem',
              color: 'white',
            }}
          >
            {toastMessage.type === 'urgent' ? (
              <AlertCircle size={24} style={{ flexShrink: 0 }} />
            ) : toastMessage.type === 'success' ? (
              <CheckCircle size={24} style={{ flexShrink: 0 }} />
            ) : (
              <Bell size={24} style={{ flexShrink: 0 }} />
            )}

            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '0.85rem', fontWeight: 800, letterSpacing: '0.04em' }}>
                {toastMessage.title}
              </div>
              <div style={{ fontSize: '0.8rem', marginTop: '0.2rem', opacity: 0.95, lineHeight: 1.3 }}>
                {toastMessage.text}
              </div>
            </div>

            <button
              onClick={dismissToast}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'white',
                cursor: 'pointer',
                opacity: 0.8,
                padding: '0.2rem',
              }}
            >
              <X size={16} />
            </button>
          </div>
        )}

        {/* Dynamic Role Dashboard */}
        {activeRole === 'HOSPITAL' && <HospitalDashboard />}
        {activeRole === 'BLOOD_BANK' && <BloodBankDashboard />}
        {activeRole === 'DONOR' && <DonorDashboard />}
        {(activeRole === 'COORDINATOR' || activeRole === 'ADMIN') && <CoordinatorDashboard />}
      </main>

      <footer style={{
        borderTop: '1px solid var(--border-subtle)',
        padding: '1.25rem 1.5rem',
        textAlign: 'center',
        fontSize: '0.75rem',
        color: 'var(--text-dim)',
        background: 'var(--color-bg)',
      }}>
        <p>
          SmartBlood Emergency Blood Coordination & Dispatch Network • Real-time clinical blood logistics for hospitals, blood banks, and volunteer donors.
        </p>
        <p style={{ marginTop: '0.35rem', color: 'var(--text-muted)' }}>
          Connected via WebSockets, FastAPI, PostgreSQL + PostGIS, and Redis Pub/Sub.
        </p>
      </footer>
    </div>
  );
};

export function App() {
  return (
    <AuthProvider>
      <AppShell />
    </AuthProvider>
  );
}

/**
 * Chooses between the login screen and the dashboards.
 *
 * The WebSocket provider sits below the auth gate on purpose: a socket needs a token
 * to authenticate with, and it should not be opened at all while signed out.
 */
const AppShell: React.FC = () => {
  const { token, isBootstrapping } = useAuth();

  if (isBootstrapping) {
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--text-muted)',
          fontSize: '0.9rem',
        }}
      >
        Restoring your session…
      </div>
    );
  }

  if (!token) {
    return <LoginScreen />;
  }

  return (
    <WebSocketProvider>
      <DashboardSwitch />
    </WebSocketProvider>
  );
};

export default App;
