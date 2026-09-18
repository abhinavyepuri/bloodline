import React, { useState } from 'react';
import { Activity, AlertCircle, Droplet, UserPlus, LogIn } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { DEV_ROLE_SWITCHER } from '../config';
import { api } from '../lib/api';

/** Demo accounts, shown only in development to make the walkthrough quick. */
const DEMO_ACCOUNTS: { label: string; email: string }[] = [
  { label: 'Coordinator (City Overview)', email: 'coordinator@smartblood.org' },
  { label: 'Hospital Desk (Metro General)', email: 'hospital@smartblood.org' },
  { label: 'Blood Bank Storage', email: 'bloodbank@smartblood.org' },
  { label: 'Volunteer Donor (Alice)', email: 'alice@donor.org' },
  { label: 'Volunteer Donor (Bob)', email: 'bob@donor.org' },
  { label: 'System Administrator', email: 'admin@smartblood.org' },
];

const DEMO_PASSWORD = 'password123';

export const LoginScreen: React.FC = () => {
  const { login, isLoading, error } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isRegistering, setIsRegistering] = useState(false);
  const [fullName, setFullName] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [regRole, setRegRole] = useState<'DONOR' | 'HOSPITAL' | 'BLOOD_BANK'>('DONOR');
  const [regError, setRegError] = useState<string | null>(null);
  const [registering, setRegistering] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isRegistering) {
      setRegError(null);
      setRegistering(true);
      try {
        await api.post('/auth/register', {
          email: email.trim(),
          password,
          full_name: fullName.trim(),
          phone_number: phoneNumber.trim(),
          role: regRole,
        });
        await login(email.trim(), password);
      } catch (err) {
        setRegError(err instanceof Error ? err.message : 'Registration failed.');
      } finally {
        setRegistering(false);
      }
      return;
    }

    try {
      await login(email.trim(), password);
    } catch {
      // The context already surfaced the message; stay on this screen.
    }
  };

  const signInAs = async (demoEmail: string) => {
    setIsRegistering(false);
    setEmail(demoEmail);
    setPassword(DEMO_PASSWORD);
    try {
      await login(demoEmail, DEMO_PASSWORD);
    } catch {
      // handled by the context
    }
  };

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '0.7rem 0.85rem',
    fontSize: '0.9rem',
    borderRadius: '8px',
    border: '1px solid var(--border-subtle)',
    background: 'var(--color-bg)',
    color: 'var(--text-main)',
    outline: 'none',
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '2rem 1rem',
        background: 'var(--color-bg)',
      }}
    >
      <div style={{ width: '100%', maxWidth: '420px' }}>
        <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '56px',
              height: '56px',
              borderRadius: '14px',
              background: 'linear-gradient(135deg, var(--crimson-500), #991b1b)',
              color: 'white',
              marginBottom: '0.75rem',
            }}
          >
            <Activity size={30} />
          </div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 800, letterSpacing: '-0.02em' }}>
            SmartBlood
          </h1>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
            Fast Blood Delivery & Volunteer Donor Emergency Network
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          style={{
            background: 'var(--color-surface, #fff)',
            border: '1px solid var(--border-subtle)',
            borderRadius: '14px',
            padding: '1.5rem',
            boxShadow: '0 10px 30px rgba(0,0,0,0.06)',
          }}
        >
          {/* Mode Switcher */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', marginBottom: '1.25rem', background: 'var(--color-bg)', padding: '0.25rem', borderRadius: '8px' }}>
            <button
              type="button"
              onClick={() => setIsRegistering(false)}
              style={{
                padding: '0.45rem',
                fontSize: '0.8rem',
                fontWeight: 700,
                borderRadius: '6px',
                border: 'none',
                background: !isRegistering ? 'var(--crimson-500)' : 'transparent',
                color: !isRegistering ? 'white' : 'var(--text-muted)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.35rem',
              }}
            >
              <LogIn size={13} />
              Sign In
            </button>
            <button
              type="button"
              onClick={() => setIsRegistering(true)}
              style={{
                padding: '0.45rem',
                fontSize: '0.8rem',
                fontWeight: 700,
                borderRadius: '6px',
                border: 'none',
                background: isRegistering ? 'var(--crimson-500)' : 'transparent',
                color: isRegistering ? 'white' : 'var(--text-muted)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.35rem',
              }}
            >
              <UserPlus size={13} />
              Register
            </button>
          </div>

          {isRegistering && (
            <>
              <label
                htmlFor="reg-fullname"
                style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, marginBottom: '0.35rem' }}
              >
                Full Name / Organization Name
              </label>
              <input
                id="reg-fullname"
                type="text"
                required
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Dr. Jane Doe / City Donor"
                style={inputStyle}
              />

              <label
                htmlFor="reg-phone"
                style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, margin: '0.75rem 0 0.35rem' }}
              >
                Contact Phone Number
              </label>
              <input
                id="reg-phone"
                type="tel"
                required
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value)}
                placeholder="+1-555-0199"
                style={inputStyle}
              />

              <label
                htmlFor="reg-role"
                style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, margin: '0.75rem 0 0.35rem' }}
              >
                Account Type
              </label>
              <select
                id="reg-role"
                className="select-field"
                value={regRole}
                onChange={(e) => setRegRole(e.target.value as any)}
                style={{ ...inputStyle, marginBottom: '0.75rem' }}
              >
                <option value="DONOR">Volunteer Donor (Mobile & Web)</option>
                <option value="HOSPITAL">Hospital Emergency Desk</option>
                <option value="BLOOD_BANK">Blood Bank Storage & Logistics</option>
              </select>
            </>
          )}

          <label
            htmlFor="login-email"
            style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, marginBottom: '0.35rem' }}
          >
            Email Address
          </label>
          <input
            id="login-email"
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@smartblood.org"
            style={inputStyle}
          />

          <label
            htmlFor="login-password"
            style={{
              display: 'block',
              fontSize: '0.8rem',
              fontWeight: 700,
              margin: '0.9rem 0 0.35rem',
            }}
          >
            Password
          </label>
          <input
            id="login-password"
            type="password"
            autoComplete={isRegistering ? 'new-password' : 'current-password'}
            required
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="•••••••• (min 6 chars)"
            style={inputStyle}
          />

          {(error || regError) && (
            <div
              role="alert"
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: '0.5rem',
                marginTop: '1rem',
                padding: '0.65rem 0.75rem',
                borderRadius: '8px',
                background: 'rgba(239, 68, 68, 0.1)',
                border: '1px solid rgba(239, 68, 68, 0.25)',
                color: 'var(--crimson-500)',
                fontSize: '0.8rem',
              }}
            >
              <AlertCircle size={16} style={{ flexShrink: 0, marginTop: '1px' }} />
              <span>{regError || error}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={isLoading || registering}
            style={{
              width: '100%',
              marginTop: '1.25rem',
              padding: '0.75rem',
              fontSize: '0.9rem',
              fontWeight: 700,
              borderRadius: '8px',
              border: 'none',
              background: 'var(--crimson-500)',
              color: 'white',
              cursor: (isLoading || registering) ? 'wait' : 'pointer',
              opacity: (isLoading || registering) ? 0.7 : 1,
            }}
          >
            {registering
              ? 'Creating Account...'
              : isLoading
              ? 'Signing in…'
              : isRegistering
              ? 'Register & Sign In'
              : 'Sign in'}
          </button>
        </form>

        {DEV_ROLE_SWITCHER && (
          <div
            style={{
              marginTop: '1.25rem',
              padding: '1rem',
              borderRadius: '12px',
              border: '1px dashed var(--border-subtle)',
              background: 'rgba(245, 158, 11, 0.06)',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.4rem',
                fontSize: '0.75rem',
                fontWeight: 700,
                color: 'var(--amber-400)',
                marginBottom: '0.6rem',
              }}
            >
              <Droplet size={14} />
              DEMO ACCOUNTS (development only)
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
              {DEMO_ACCOUNTS.map((acct) => (
                <button
                  key={acct.email}
                  type="button"
                  disabled={isLoading}
                  onClick={() => signInAs(acct.email)}
                  style={{
                    padding: '0.35rem 0.6rem',
                    fontSize: '0.72rem',
                    fontWeight: 600,
                    borderRadius: '6px',
                    border: '1px solid var(--border-subtle)',
                    background: 'var(--color-bg)',
                    color: 'var(--text-muted)',
                    cursor: 'pointer',
                  }}
                >
                  {acct.label}
                </button>
              ))}
            </div>
            <p style={{ fontSize: '0.7rem', color: 'var(--text-dim)', marginTop: '0.6rem' }}>
              All demo accounts use the password <code>{DEMO_PASSWORD}</code>. This panel is
              removed from production builds.
            </p>
          </div>
        )}
      </div>
    </div>
  );
};
