import React, { useState } from 'react';
import { Activity, AlertCircle, Building2, Droplet, Heart, LogIn, Shield, UserPlus } from 'lucide-react';
import { useAuth, RegisterPayload } from '../context/AuthContext';

interface SeededAccount {
  label: string;
  email: string;
  role: string;
}

const PRESET_ACCOUNTS: SeededAccount[] = [
  { label: 'Hospital Desk (Metro General)', email: 'hospital@smartblood.org', role: 'HOSPITAL' },
  { label: 'Blood Bank Storage', email: 'bloodbank@smartblood.org', role: 'BLOOD_BANK' },
  { label: 'Volunteer Donor (Alice - O-)', email: 'alice@donor.org', role: 'DONOR' },
  { label: 'Volunteer Donor (Bob - O-)', email: 'bob@donor.org', role: 'DONOR' },
  { label: 'Emergency Operations (Coordinator)', email: 'coordinator@smartblood.org', role: 'COORDINATOR' },
  { label: 'System Administrator', email: 'admin@smartblood.org', role: 'ADMIN' },
];

export const LoginScreen: React.FC = () => {
  const { login, register, isLoading, error } = useAuth();

  const [isRegistering, setIsRegistering] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  // Registration fields
  const [fullName, setFullName] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [regRole, setRegRole] = useState<'HOSPITAL' | 'BLOOD_BANK' | 'DONOR'>('HOSPITAL');
  const [regBloodGroup, setRegBloodGroup] = useState('O-');
  const [facilityAddress, setFacilityAddress] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);

    if (isRegistering) {
      if (!fullName.trim()) {
        setLocalError('Please enter your full name or facility name.');
        return;
      }
      if (!phoneNumber.trim()) {
        setLocalError('Please enter a valid contact phone number.');
        return;
      }
      try {
        const payload: RegisterPayload = {
          email: email.trim(),
          password,
          full_name: fullName.trim(),
          phone_number: phoneNumber.trim(),
          role: regRole,
          blood_group: regRole === 'DONOR' ? regBloodGroup : undefined,
          facility_address: facilityAddress.trim() || undefined,
        };
        await register(payload);
      } catch (err) {
        setLocalError(err instanceof Error ? err.message : 'Registration failed.');
      }
      return;
    }

    try {
      await login(email.trim(), password);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Sign-in failed.');
    }
  };

  const handleSelectPreset = (preset: SeededAccount) => {
    setIsRegistering(false);
    setEmail(preset.email);
    setPassword('password123');
    setLocalError(null);
  };

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '0.75rem 0.95rem',
    fontSize: '0.9rem',
    borderRadius: '8px',
    border: '1px solid var(--border-subtle)',
    background: 'var(--color-bg)',
    color: 'var(--text-main)',
    outline: 'none',
    transition: 'border-color 0.15s ease',
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
      <div style={{ width: '100%', maxWidth: '460px' }}>
        {/* Brand Header */}
        <div style={{ textAlign: 'center', marginBottom: '1.75rem' }}>
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '60px',
              height: '60px',
              borderRadius: '16px',
              background: 'linear-gradient(135deg, var(--crimson-500), #991b1b)',
              boxShadow: '0 8px 24px var(--crimson-glow)',
              color: 'white',
              marginBottom: '0.85rem',
            }}
          >
            <Activity size={32} />
          </div>
          <h1 style={{ fontSize: '1.75rem', fontWeight: 800, letterSpacing: '-0.02em', color: 'var(--text-main)' }}>
            SmartBlood
          </h1>
          <p style={{ fontSize: '0.88rem', color: 'var(--text-muted)', marginTop: '0.35rem' }}>
            Unified Emergency Blood Coordination & Dispatch Network
          </p>
        </div>

        {/* Card Form */}
        <div
          style={{
            background: 'var(--color-surface, #fff)',
            border: '1px solid var(--border-subtle)',
            borderRadius: '16px',
            padding: '1.75rem',
            boxShadow: '0 12px 36px rgba(0, 0, 0, 0.06)',
          }}
        >
          {/* Mode Switch Tabs */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: '0.5rem',
              marginBottom: '1.5rem',
              background: 'var(--color-bg)',
              padding: '0.3rem',
              borderRadius: '10px',
            }}
          >
            <button
              type="button"
              onClick={() => {
                setIsRegistering(false);
                setLocalError(null);
              }}
              style={{
                padding: '0.55rem',
                fontSize: '0.85rem',
                fontWeight: 700,
                borderRadius: '8px',
                border: 'none',
                background: !isRegistering ? 'var(--crimson-500)' : 'transparent',
                color: !isRegistering ? 'white' : 'var(--text-muted)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.4rem',
                transition: 'all 0.15s ease',
              }}
            >
              <LogIn size={15} />
              Sign In
            </button>
            <button
              type="button"
              onClick={() => {
                setIsRegistering(true);
                setLocalError(null);
              }}
              style={{
                padding: '0.55rem',
                fontSize: '0.85rem',
                fontWeight: 700,
                borderRadius: '8px',
                border: 'none',
                background: isRegistering ? 'var(--crimson-500)' : 'transparent',
                color: isRegistering ? 'white' : 'var(--text-muted)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.4rem',
                transition: 'all 0.15s ease',
              }}
            >
              <UserPlus size={15} />
              Create Account
            </button>
          </div>

          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {isRegistering && (
              <>
                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, marginBottom: '0.35rem' }}>
                    Full Name / Facility Name
                  </label>
                  <input
                    type="text"
                    required
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="e.g. Metro Trauma Center / Dr. Sarah Smith"
                    style={inputStyle}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, marginBottom: '0.35rem' }}>
                    Contact Phone Number
                  </label>
                  <input
                    type="tel"
                    required
                    value={phoneNumber}
                    onChange={(e) => setPhoneNumber(e.target.value)}
                    placeholder="e.g. +1-555-0199"
                    style={inputStyle}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, marginBottom: '0.35rem' }}>
                    Select Your Role / Operation
                  </label>
                  <select
                    className="select-field"
                    value={regRole}
                    onChange={(e) => setRegRole(e.target.value as any)}
                    style={inputStyle}
                  >
                    <option value="HOSPITAL">Hospital Emergency Department</option>
                    <option value="BLOOD_BANK">Blood Bank & Cold-Chain Logistics</option>
                    <option value="DONOR">Voluntary Blood Donor</option>
                  </select>
                </div>

                {regRole === 'DONOR' && (
                  <div>
                    <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, marginBottom: '0.35rem' }}>
                      Your Blood Group
                    </label>
                    <select
                      className="select-field"
                      value={regBloodGroup}
                      onChange={(e) => setRegBloodGroup(e.target.value)}
                      style={inputStyle}
                    >
                      {['O-', 'O+', 'A-', 'A+', 'B-', 'B+', 'AB-', 'AB+'].map((bg) => (
                        <option key={bg} value={bg}>{bg}</option>
                      ))}
                    </select>
                  </div>
                )}

                {(regRole === 'HOSPITAL' || regRole === 'BLOOD_BANK') && (
                  <div>
                    <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, marginBottom: '0.35rem' }}>
                      Facility Physical Address
                    </label>
                    <input
                      type="text"
                      value={facilityAddress}
                      onChange={(e) => setFacilityAddress(e.target.value)}
                      placeholder="e.g. 100 Medical Center Blvd"
                      style={inputStyle}
                    />
                  </div>
                )}
              </>
            )}

            <div>
              <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, marginBottom: '0.35rem' }}>
                Email Address
              </label>
              <input
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@smartblood.org"
                style={inputStyle}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, marginBottom: '0.35rem' }}>
                Password
              </label>
              <input
                type="password"
                autoComplete={isRegistering ? 'new-password' : 'current-password'}
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="•••••••• (minimum 6 characters)"
                style={inputStyle}
              />
            </div>

            {(error || localError) && (
              <div
                role="alert"
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '0.5rem',
                  padding: '0.75rem',
                  borderRadius: '8px',
                  background: 'rgba(239, 68, 68, 0.1)',
                  border: '1px solid rgba(239, 68, 68, 0.25)',
                  color: 'var(--crimson-500)',
                  fontSize: '0.82rem',
                }}
              >
                <AlertCircle size={16} style={{ flexShrink: 0, marginTop: '2px' }} />
                <span>{localError || error}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={isLoading}
              style={{
                width: '100%',
                marginTop: '0.5rem',
                padding: '0.85rem',
                fontSize: '0.92rem',
                fontWeight: 700,
                borderRadius: '8px',
                border: 'none',
                background: 'var(--crimson-500)',
                color: 'white',
                cursor: isLoading ? 'wait' : 'pointer',
                opacity: isLoading ? 0.7 : 1,
                boxShadow: '0 4px 14px var(--crimson-glow)',
                transition: 'all 0.15s ease',
              }}
            >
              {isLoading
                ? 'Authenticating...'
                : isRegistering
                ? 'Create Account & Enter Portal'
                : 'Sign In to Portal'}
            </button>
          </form>

          {/* Quick Sign-In Persona Drawer for Fast Verification */}
          <div
            style={{
              marginTop: '1.5rem',
              paddingTop: '1.25rem',
              borderTop: '1px solid var(--border-subtle)',
            }}
          >
            <div
              style={{
                fontSize: '0.75rem',
                fontWeight: 700,
                color: 'var(--text-muted)',
                marginBottom: '0.65rem',
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
              }}
            >
              Quick Sign-In with Pre-Seeded Personnel:
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.45rem' }}>
              {PRESET_ACCOUNTS.map((preset) => (
                <button
                  key={preset.email}
                  type="button"
                  disabled={isLoading}
                  onClick={() => handleSelectPreset(preset)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.4rem',
                    padding: '0.45rem 0.65rem',
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    borderRadius: '6px',
                    border: '1px solid var(--border-subtle)',
                    background: 'var(--color-bg)',
                    color: 'var(--text-main)',
                    cursor: 'pointer',
                    textAlign: 'left',
                    transition: 'all 0.15s ease',
                  }}
                >
                  {preset.role === 'HOSPITAL' && <Building2 size={13} color="var(--crimson-500)" style={{ flexShrink: 0 }} />}
                  {preset.role === 'BLOOD_BANK' && <Droplet size={13} color="var(--amber-500)" style={{ flexShrink: 0 }} />}
                  {preset.role === 'DONOR' && <Heart size={13} color="var(--emerald-500)" style={{ flexShrink: 0 }} />}
                  {preset.role === 'COORDINATOR' && <Activity size={13} color="var(--cyan-400)" style={{ flexShrink: 0 }} />}
                  {preset.role === 'ADMIN' && <Shield size={13} color="var(--purple-400)" style={{ flexShrink: 0 }} />}
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={preset.label}>
                    {preset.label}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
